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
import { getLogger } from '@server/utils';

const logger = getLogger('TextBasedAnswerBackgroundTracker');
logger.level = 'debug';

export class TextBasedAnswerBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private threadRepository: IThreadRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
    threadRepository,
    projectService,
    deployService,
    queryService,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
    threadRepository: IThreadRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.threadRepository = threadRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.intervalTime = 1000;
    this.start();
  }

  private start() {
    setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (
            this.runningJobs.has(threadResponse.id) ||
            !threadResponse.answerDetail
          ) {
            return;
          }
          this.runningJobs.add(threadResponse.id);

          try {
            const latestThreadResponse = await this.threadResponseRepository.findOneBy({
              id: threadResponse.id,
            });
            if (!latestThreadResponse) {
              delete this.tasks[threadResponse.id];
              return;
            }

            // Refresh cached task payload to avoid using stale sql/answerDetail.
            this.tasks[threadResponse.id] = latestThreadResponse;

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
              data = (await this.queryService.preview(latestThreadResponse.sql, {
                project,
                manifest: mdl,
                modelingOnly: false,
                limit: 500,
              })) as PreviewDataResponse;
            } catch (error) {
              logger.error(`Error when query sql data: ${error}`);
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: {
                  ...latestThreadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FAILED,
                  error: error?.extensions || error,
                },
              });
              throw error;
            }

            // request AI service
            logger.info(`[DEBUG] TextBasedAnswerBackgroundTracker: processing responseId ${latestThreadResponse.id} with SQL: ${latestThreadResponse.sql}`);
            const response = await this.wrenAIAdaptor.createTextBasedAnswer({
              query: latestThreadResponse.question,
              sql: latestThreadResponse.sql,
              sqlData: data,
              threadId: latestThreadResponse.threadId.toString(),
              configurations: {
                language: WrenAILanguage[project.language] || WrenAILanguage.EN,
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
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }
}
