import { IWrenAIAdaptor } from '../adaptors';
import {
  WrenAILanguage,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '../models/adaptor';
import { ThreadResponse, IThreadResponseRepository } from '../repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
  ThreadResponseAnswerStatus,
  PreviewDataResponse,
} from '../services';
import { IThreadRepository } from '../repositories/threadRepository';
import { IAskingTaskRepository } from '../repositories';
import { getLogger } from '@server/utils';

const logger = getLogger('TextBasedAnswerBackgroundTracker');
logger.level = 'debug';

export class TextBasedAnswerBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, { response: ThreadResponse; addedAt: number }> =
    {};
  private intervalTime: number;
  private timeout: number = 5 * 60 * 1000; // 5 minutes
  private maxSqlExecutionRetries: number = 3; // Maximum SQL execution retry attempts
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private threadRepository: IThreadRepository;
  private askingTaskRepository: IAskingTaskRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
    threadRepository,
    askingTaskRepository,
    projectService,
    deployService,
    queryService,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
    threadRepository: IThreadRepository;
    askingTaskRepository: IAskingTaskRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.threadRepository = threadRepository;
    this.askingTaskRepository = askingTaskRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.intervalTime = 1000;
    this.start();
  }

  private start() {
    setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        ({ response: threadResponse, addedAt }) =>
          async () => {
            if (
              this.runningJobs.has(threadResponse.id) ||
              !threadResponse.answerDetail
            ) {
              return;
            }
            this.runningJobs.add(threadResponse.id);

            try {
              // Check timeout
              if (Date.now() - addedAt > this.timeout) {
                logger.warn(
                  `TextBasedAnswerBackgroundTracker: Task ${threadResponse.id} timed out waiting for SQL.`,
                );
                await this.threadResponseRepository.updateOne(
                  threadResponse.id,
                  {
                    answerDetail: {
                      ...threadResponse.answerDetail,
                      status: ThreadResponseAnswerStatus.FAILED,
                      error: {
                        code: 'TIMEOUT',
                        message: 'Timeout waiting for SQL generation',
                        shortMessage: 'Timeout waiting for SQL generation',
                      },
                    },
                  },
                );
                delete this.tasks[threadResponse.id];
                return;
              }

              const latestThreadResponse =
                await this.threadResponseRepository.findOneBy({
                  id: threadResponse.id,
                });
              if (!latestThreadResponse) {
                delete this.tasks[threadResponse.id];
                return;
              }

              // Check if the task has already failed or been interrupted (e.g. by AskingTaskTracker)
              if (
                latestThreadResponse.answerDetail?.status ===
                  ThreadResponseAnswerStatus.FAILED ||
                latestThreadResponse.answerDetail?.status ===
                  ThreadResponseAnswerStatus.INTERRUPTED
              ) {
                logger.info(
                  `TextBasedAnswerBackgroundTracker: Task ${threadResponse.id} is marked as ${latestThreadResponse.answerDetail?.status}. Stop tracking.`,
                );
                delete this.tasks[threadResponse.id];
                return;
              }

              // Refresh cached task payload to avoid using stale sql/answerDetail.
              if (this.tasks[threadResponse.id]) {
                this.tasks[threadResponse.id].response = latestThreadResponse;
              }

              // SQL might be backfilled asynchronously by AskingTaskTracker.
              // If SQL is not ready yet, keep the task and retry in next interval.
              if (!latestThreadResponse.sql) {
                return;
              }

              // update the status to fetching data
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: {
                  ...latestThreadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FETCHING_DATA,
                },
              });

              // get sql data
              const thread = await this.threadRepository.findOneBy({
                id: threadResponse.threadId,
              });
              if (!thread) {
                throw new Error(`Thread ${threadResponse.threadId} not found`);
              }
              const project = await this.projectService.getProjectById(
                thread.projectId,
              );
              const deployment = await this.deployService.getLastDeployment(
                project.id,
              );
              const mdl = deployment.manifest;
              let data: PreviewDataResponse;
              try {
                data = (await this.queryService.preview(
                  latestThreadResponse.sql,
                  {
                    project,
                    manifest: mdl,
                    modelingOnly: false,
                    limit: 500,
                  },
                )) as PreviewDataResponse;
              } catch (error) {
                logger.error(`Error when query sql data: ${error}`);

                // Get current retry count (default to 0 if not set)
                const currentRetryCount =
                  latestThreadResponse.answerDetail?.sqlExecutionRetryCount ||
                  0;

                // Check if we should retry
                if (currentRetryCount < this.maxSqlExecutionRetries) {
                  logger.info(
                    `SQL execution failed for response ${threadResponse.id}. ` +
                      `Retry attempt ${currentRetryCount + 1}/${this.maxSqlExecutionRetries}. ` +
                      `Error: ${error?.message || JSON.stringify(error)}`,
                  );

                  // Update retry count and store error for context
                  await this.threadResponseRepository.updateOne(
                    threadResponse.id,
                    {
                      answerDetail: {
                        ...latestThreadResponse.answerDetail,
                        sqlExecutionRetryCount: currentRetryCount + 1,
                        lastSqlExecutionError: error?.extensions || error,
                        status: ThreadResponseAnswerStatus.FETCHING_DATA, // Keep in FETCHING_DATA to retry
                      },
                    },
                  );

                  // Trigger SQL regeneration by creating a new asking task with error context
                  try {
                    const errorMessage =
                      error?.message ||
                      JSON.stringify(error?.extensions || error);
                    const retryQuestion = `${latestThreadResponse.question}\n\n[Previous SQL execution failed with error: ${errorMessage}. Please generate a corrected SQL query.]`;

                    const deployment =
                      await this.deployService.getLastDeployment(project.id);
                    const askResponse = await this.wrenAIAdaptor.ask({
                      query: retryQuestion,
                      deployId: deployment.hash,
                      projectId: project.id,
                      threadId: latestThreadResponse.threadId,
                      configurations: {
                        language:
                          WrenAILanguage[project.language] || WrenAILanguage.EN,
                      },
                    });

                    // Create a new asking task record for tracking
                    const askingTask =
                      await this.askingTaskRepository.createOne({
                        queryId: askResponse.queryId,
                        question: retryQuestion,
                        threadId: latestThreadResponse.threadId,
                        threadResponseId: threadResponse.id,
                        detail: { status: 'UNDERSTANDING' } as any,
                      });

                    // Update thread response with new asking task
                    await this.threadResponseRepository.updateOne(
                      threadResponse.id,
                      {
                        askingTaskId: askingTask.id,
                        sql: null, // Clear old SQL to wait for new one
                      },
                    );

                    logger.info(
                      `Created retry asking task ${askingTask.id} (queryId: ${askResponse.queryId}) ` +
                        `for response ${threadResponse.id}`,
                    );

                    // Remove from tracker - will be re-added when new SQL is ready
                    delete this.tasks[threadResponse.id];
                    return;
                  } catch (retryError) {
                    logger.error(
                      `Failed to create retry asking task for response ${threadResponse.id}: ${retryError}`,
                    );
                    // Fall through to mark as FAILED
                  }
                }

                // Max retries exhausted or retry creation failed - mark as FAILED immediately
                logger.warn(
                  `SQL execution failed for response ${threadResponse.id} after ${currentRetryCount} retries. ` +
                    `Marking as FAILED.`,
                );
                await this.threadResponseRepository.updateOne(
                  threadResponse.id,
                  {
                    answerDetail: {
                      ...latestThreadResponse.answerDetail,
                      status: ThreadResponseAnswerStatus.FAILED,
                      error: error?.extensions || error,
                      sqlExecutionRetryCount: currentRetryCount,
                    },
                  },
                );
                delete this.tasks[threadResponse.id];
                return;
              }

              // request AI service
              logger.info(
                `[DEBUG] TextBasedAnswerBackgroundTracker: processing responseId ${latestThreadResponse.id} with SQL: ${latestThreadResponse.sql}`,
              );
              const response = await this.wrenAIAdaptor.createTextBasedAnswer({
                query: latestThreadResponse.question,
                sql: latestThreadResponse.sql,
                sqlData: data,
                threadId: latestThreadResponse.threadId.toString(),
                configurations: {
                  language:
                    WrenAILanguage[project.language] || WrenAILanguage.EN,
                },
              });

              // update the status to preprocessing
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: {
                  ...latestThreadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.PREPROCESSING,
                },
              });

              // polling query id to check the status
              let result: TextBasedAnswerResult;
              do {
                result = await this.wrenAIAdaptor.getTextBasedAnswerResult(
                  response.queryId,
                );
                if (result.status === TextBasedAnswerStatus.PREPROCESSING) {
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              } while (result.status === TextBasedAnswerStatus.PREPROCESSING);

              // update the status to final
              const updatedAnswerDetail = {
                queryId: response.queryId,
                status:
                  result.status === TextBasedAnswerStatus.SUCCEEDED
                    ? ThreadResponseAnswerStatus.STREAMING
                    : ThreadResponseAnswerStatus.FAILED,
                numRowsUsedInLLM: result.numRowsUsedInLLM,
                error: result.error,
              };
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: updatedAnswerDetail,
              });

              delete this.tasks[threadResponse.id];
            } catch (error) {
              logger.error(`Text-based answer job failed: ${error}`);
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: {
                  ...threadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FAILED,
                  error: error?.extensions || error,
                },
              });
              delete this.tasks[threadResponse.id];
            } finally {
              this.runningJobs.delete(threadResponse.id);
            }
          },
      );

      // Run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // Show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = {
      response: threadResponse,
      addedAt: Date.now(),
    };
  }

  public getTasks() {
    return this.tasks;
  }
}
