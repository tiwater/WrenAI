import { getLogger } from '@server/utils';
import {
  AskResult,
  AskResultType,
  AskResultStatus,
  AskInput,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  IThreadResponseRepository,
  IViewRepository,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';
import * as Errors from '@server/utils/error';
import { ThreadResponseAnswerStatus } from './askingService';

const logger = getLogger('AskingTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  createdAt: number;
  question?: string;
  result?: AskResult;
  isFinalized: boolean;
  threadResponseId?: number;
  rerunFromCancelled?: boolean;
}

export type TrackedAskingResult = AskResult & {
  taskId?: number;
  queryId: string;
  question: string;
};

export type CreateAskingTaskInput = AskInput & {
  rerunFromCancelled?: boolean;
  previousTaskId?: number;
  threadResponseId?: number;
};

export interface IAskingTaskTracker {
  createAskingTask(input: CreateAskingTaskInput): Promise<{ queryId: string }>;
  getAskingResult(queryId: string): Promise<TrackedAskingResult | null>;
  getAskingResultById(id: number): Promise<TrackedAskingResult | null>;
  cancelAskingTask(queryId: string): Promise<void>;
  bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void>;
}

export class AskingTaskTracker implements IAskingTaskTracker {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private timeout: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private viewRepository: IViewRepository;

  constructor({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
    timeout = 10 * 60 * 1000, // 10 minutes
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    viewRepository: IViewRepository;
    pollingInterval?: number;
    memoryRetentionTime?: number;
    timeout?: number;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.viewRepository = viewRepository;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.timeout = timeout;
    this.startPolling();
  }

  public async createAskingTask(
    input: CreateAskingTaskInput,
  ): Promise<{ queryId: string }> {
    try {
      // Call the AI service to create a task
      const response = await this.wrenAIAdaptor.ask(input);
      const queryId = response.queryId;

      // validate the input
      if (
        input.rerunFromCancelled &&
        (!input.previousTaskId || !input.threadResponseId)
      ) {
        throw new Error(
          'Previous task id and thread response id are required if rerun from cancelled',
        );
      }

      // Start tracking this task
      const task = {
        queryId,
        lastPolled: Date.now(),
        createdAt: Date.now(),
        question: input.query,
        threadResponseId: input.threadResponseId,
        isFinalized: false,
        rerunFromCancelled: input.rerunFromCancelled,
      } as TrackedTask;
      this.trackedTasks.set(queryId, task);

      // Persist a DB record immediately so follow-up requests (e.g. createThreadResponse)
      // can resolve the asking task by queryId even before the first poll updates the DB.
      // This avoids a race where createThreadResponse throws "Asking task ... not found".
      const existingTaskRecord =
        await this.askingTaskRepository.findByQueryId(queryId);
      if (!existingTaskRecord) {
        const createdTask = await this.askingTaskRepository.createOne({
          queryId,
          question: input.query,
          detail: {
            status: AskResultStatus.UNDERSTANDING,
          } as any,
        });
        task.taskId = createdTask.id;
        this.trackedTasksById.set(createdTask.id, task);
      } else {
        task.taskId = existingTaskRecord.id;
        this.trackedTasksById.set(existingTaskRecord.id, task);
      }

      // if rerun from cancelled, we update the query id to the previous task
      if (
        input.rerunFromCancelled &&
        input.previousTaskId &&
        input.threadResponseId
      ) {
        // set the thread response id in memory to bind the task to the thread response
        // we don't have to update to database here because the thread response id is already set in database
        task.threadResponseId = input.threadResponseId;

        // update the task id in memory
        this.trackedTasksById.set(input.previousTaskId, task);

        // get the latest result from the AI service
        // we get the latest result first to make it more responsive to client-side
        const result = await this.wrenAIAdaptor.getAskResult(queryId);

        // update the result in memory
        task.result = result;

        // update the query id in database
        await this.askingTaskRepository.updateOne(input.previousTaskId, {
          queryId,
        });
      }

      logger.info(`Created asking task with queryId: ${queryId}`);
      return { queryId };
    } catch (err) {
      logger.error(`Failed to create asking task: ${err}`);
      throw err;
    }
  }

  public async getAskingResult(
    queryId: string,
  ): Promise<TrackedAskingResult | null> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        queryId,
        question: trackedTask.question,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAskingResultFromDB({ queryId });
  }

  public async getAskingResultById(
    id: number,
  ): Promise<TrackedAskingResult | null> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAskingResult(task.queryId);
    }

    return this.getAskingResultFromDB({ taskId: id });
  }

  public async cancelAskingTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAsk(queryId);

    // Update the threadResponse status to INTERRUPTED if it exists
    const task = this.trackedTasks.get(queryId);
    if (task?.threadResponseId) {
      logger.info(
        `[DEBUG] cancelAskingTask: Marking threadResponse ${task.threadResponseId} as INTERRUPTED for task ${queryId}`,
      );

      const threadResponse = await this.threadResponseRepository.findOneBy({
        id: task.threadResponseId,
      });

      if (threadResponse) {
        await this.threadResponseRepository.updateOne(task.threadResponseId, {
          answerDetail: {
            ...threadResponse.answerDetail,
            status: ThreadResponseAnswerStatus.INTERRUPTED,
            error: {
              code: 'USER_CANCELLED',
              message: 'The task was cancelled by the user.',
              shortMessage: 'Task cancelled',
            },
          },
        });
        logger.info(
          `[DEBUG] cancelAskingTask: Successfully marked threadResponse ${task.threadResponseId} as INTERRUPTED`,
        );
      } else {
        logger.warn(
          `[DEBUG] cancelAskingTask: ThreadResponse ${task.threadResponseId} not found`,
        );
      }
    }

    // Remove the task from tracked tasks
    this.trackedTasks.delete(queryId);
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  public async bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void> {
    logger.info(
      `[DEBUG] bindThreadResponse called: taskId=${id}, queryId=${queryId}, ` +
        `threadId=${threadId}, threadResponseId=${threadResponseId}`,
    );
    const task = this.trackedTasks.get(queryId);
    if (!task) {
      logger.error(
        `[DEBUG] bindThreadResponse: Task ${queryId} not found in trackedTasks`,
      );
      throw new Error(`Task ${queryId} not found`);
    }

    logger.info(
      `[DEBUG] bindThreadResponse: Task ${queryId} found. isFinalized=${task.isFinalized}, ` +
        `hasResult=${!!task.result}, resultStatus=${task.result?.status}`,
    );

    task.threadResponseId = threadResponseId;
    this.trackedTasksById.set(id, task);
    await this.askingTaskRepository.updateOne(id, {
      threadId,
      threadResponseId,
    });

    // check if the task is finalized and has a sql
    if (task.isFinalized) {
      logger.info(
        `[DEBUG] bindThreadResponse: Task ${queryId} is already finalized. ` +
          `Calling updateThreadResponseWhenTaskFinalized immediately.`,
      );
      await this.updateThreadResponseWhenTaskFinalized(task);
    } else {
      logger.info(
        `[DEBUG] bindThreadResponse: Task ${queryId} not yet finalized. ` +
          `Will update threadResponse when task completes.`,
      );
    }
  }

  private startPolling(): void {
    this.pollingIntervalId = setInterval(() => {
      this.pollTasks();
    }, this.pollingInterval);
  }

  private async pollTasks(): Promise<void> {
    const now = Date.now();
    const tasksToRemove: string[] = [];

    // Create an array of job functions
    const jobs = Array.from(this.trackedTasks.entries()).map(
      ([queryId, task]) =>
        async () => {
          try {
            // Skip if the job is already running
            if (this.runningJobs.has(queryId)) {
              return;
            }

            // Skip finalized tasks that have been in memory too long
            if (
              task.isFinalized &&
              now - task.lastPolled > this.memoryRetentionTime
            ) {
              tasksToRemove.push(queryId);
              return;
            }

            // Skip finalized tasks
            if (task.isFinalized) {
              return;
            }

            // Mark the job as running
            this.runningJobs.add(queryId);

            // Check for timeout
            if (now - task.createdAt > this.timeout) {
              logger.warn(`AskingTaskTracker: Task ${queryId} timed out.`);
              const error = {
                code: 'TIMEOUT',
                message: 'Asking task timed out',
                shortMessage: 'Asking task timed out',
              };
              task.isFinalized = true;
              task.result = {
                ...task.result,
                status: AskResultStatus.FAILED,
                error,
              } as AskResult;

              await this.updateTaskInDatabase({ queryId }, task);

              if (task.threadResponseId) {
                await this.updateThreadResponseWhenTaskFinalized(task);
              }
              this.runningJobs.delete(queryId);
              return;
            }

            // Poll for updates
            logger.info(`Polling for updates for task ${queryId}`);
            const result = await this.wrenAIAdaptor.getAskResult(queryId);
            task.lastPolled = now;

            logger.info(
              `[DEBUG] Polled task ${queryId}: ` +
                `oldStatus=${task.result?.status}, newStatus=${result.status}, ` +
                `oldType=${task.result?.type}, newType=${result.type}`,
            );

            // if result is not changed, we don't need to update the database
            const resultChanged = this.isResultChanged(task.result, result);
            logger.info(
              `[DEBUG] isResultChanged for task ${queryId}: ${resultChanged}`,
            );
            if (!resultChanged) {
              this.runningJobs.delete(queryId);
              return;
            }

            // update task in memory if any change
            task.result = result;

            // if result is still understanding, we don't need to update the database
            if (result.status === AskResultStatus.UNDERSTANDING) {
              this.runningJobs.delete(queryId);
              return;
            }

            // if it's identified as GENERAL or MISLEADING_QUERY
            // we need to finalize the task and notify the frontend
            if (
              result.type === AskResultType.GENERAL ||
              result.type === AskResultType.MISLEADING_QUERY
            ) {
              task.isFinalized = true;
              logger.info(
                `[DEBUG] Task ${queryId} identified as ${result.type}. ` +
                  `threadResponseId=${task.threadResponseId}`,
              );

              const errorCode =
                result.type === AskResultType.GENERAL
                  ? Errors.GeneralErrorCodes.IDENTIED_AS_GENERAL
                  : Errors.GeneralErrorCodes.IDENTIED_AS_MISLEADING_QUERY;
              const error = {
                code: errorCode,
                message: Errors.errorMessages[errorCode],
                shortMessage: Errors.shortMessages[errorCode],
              };

              // Update task result to FAILED
              task.result = {
                ...task.result,
                status: AskResultStatus.FAILED,
                error,
              };

              // Update database
              await this.updateTaskInDatabase({ queryId }, task);

              // Notify frontend by updating threadResponse
              if (task.threadResponseId) {
                logger.info(
                  `[DEBUG] Calling updateThreadResponseWhenTaskFinalized for GENERAL/MISLEADING task ${queryId}`,
                );
                await this.updateThreadResponseWhenTaskFinalized(task);
              } else {
                logger.warn(
                  `[DEBUG] Task ${queryId} identified as ${result.type} but threadResponseId not set. ` +
                    `Frontend will not be notified.`,
                );
              }

              this.runningJobs.delete(queryId);
              return;
            }

            // update the database
            // note: type could be null if it's still being understood or it's stopped
            // we already filtered out the understanding status above
            // so we update to database if it's stopped as well here.
            logger.info(`Updating task ${queryId} in database`);
            await this.updateTaskInDatabase({ queryId }, task);

            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              task.isFinalized = true;
              logger.info(
                `[DEBUG] Task ${queryId} is finalized with status: ${result.status}. ` +
                  `threadResponseId=${task.threadResponseId}`,
              );
              // update thread response if threadResponseId is provided
              if (task.threadResponseId) {
                logger.info(
                  `[DEBUG] Calling updateThreadResponseWhenTaskFinalized for task ${queryId}`,
                );
                await this.updateThreadResponseWhenTaskFinalized(task);
              } else {
                logger.warn(
                  `[DEBUG] Task ${queryId} finalized but threadResponseId not set. ` +
                    `SQL will not be written to threadResponse. This may cause the UI to hang.`,
                );
              }

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            }

            // Mark the job as finished
            this.runningJobs.delete(queryId);
          } catch (err) {
            this.runningJobs.delete(queryId);
            logger.error(err.stack);
            throw err;
          }
        },
    );

    // Run all jobs in parallel
    Promise.allSettled(jobs.map((job) => job())).then((results) => {
      // Log any rejected promises
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Job ${index} failed: ${result.reason}`);
        }
      });

      // Clean up tasks that have been in memory too long
      if (tasksToRemove.length > 0) {
        logger.info(
          `Cleaning up tasks that have been in memory too long. Tasks: ${tasksToRemove.join(
            ', ',
          )}`,
        );
      }
      for (const queryId of tasksToRemove) {
        this.trackedTasks.delete(queryId);
      }
    });
  }

  private async updateThreadResponseWhenTaskFinalized(
    task: TrackedTask,
  ): Promise<void> {
    logger.info(
      `[DEBUG] updateThreadResponseWhenTaskFinalized called for task ${task.queryId}, ` +
        `threadResponseId=${task.threadResponseId}`,
    );
    const response = task?.result?.response?.[0];
    logger.info(
      `[DEBUG] updateThreadResponseWhenTaskFinalized: response exists=${!!response}, ` +
        `hasViewId=${!!response?.viewId}, hasSql=${!!response?.sql}`,
    );

    // Helper to fail the thread response
    const failThreadResponse = async (error: any) => {
      logger.info(
        `[DEBUG] updateThreadResponseWhenTaskFinalized: Marking response ${task.threadResponseId} as FAILED due to: ${JSON.stringify(error)}`,
      );
      const threadResponse = await this.threadResponseRepository.findOneBy({
        id: task.threadResponseId,
      });
      if (threadResponse) {
        const updatedAnswerDetail = {
          ...threadResponse.answerDetail,
          status: ThreadResponseAnswerStatus.FAILED,
          error: error,
        };
        logger.info(
          `[DEBUG] updateThreadResponseWhenTaskFinalized: Updating answerDetail for response ${task.threadResponseId}: ` +
            `oldStatus=${threadResponse.answerDetail?.status}, newStatus=${updatedAnswerDetail.status}`,
        );
        await this.threadResponseRepository.updateOne(task.threadResponseId, {
          answerDetail: updatedAnswerDetail,
        });
        logger.info(
          `[DEBUG] updateThreadResponseWhenTaskFinalized: Successfully updated response ${task.threadResponseId} to FAILED`,
        );
      } else {
        logger.error(
          `[DEBUG] updateThreadResponseWhenTaskFinalized: ThreadResponse ${task.threadResponseId} not found!`,
        );
      }
    };

    if (!response) {
      if (task.result?.status === AskResultStatus.FAILED) {
        await failThreadResponse(
          task.result.error || { message: 'Asking task failed' },
        );
      } else if (task.result?.status === AskResultStatus.FINISHED) {
        await failThreadResponse({
          message: 'Asking task finished but returned no response data',
        });
      }
      return;
    }

    // if the generated response of asking task is not null, update the thread response
    if (response.viewId) {
      logger.info(
        `[DEBUG] updateThreadResponseWhenTaskFinalized: Updating with viewId ${response.viewId}`,
      );
      // get sql from the view
      const view = await this.viewRepository.findOneBy({
        id: response.viewId,
      });
      if (view) {
        await this.threadResponseRepository.updateOne(task.threadResponseId, {
          sql: view.statement,
          viewId: response.viewId,
        });
      } else {
        await failThreadResponse({
          message: `View ${response.viewId} not found`,
        });
      }
    } else if (response.sql) {
      logger.info(
        `[DEBUG] updateThreadResponseWhenTaskFinalized: Updating with SQL: ${response.sql}`,
      );
      await this.threadResponseRepository.updateOne(task.threadResponseId, {
        sql: response.sql,
      });
    } else {
      logger.info(
        `[DEBUG] updateThreadResponseWhenTaskFinalized: No SQL or ViewID in response. Skipping update. Response keys: ${Object.keys(response)}`,
      );
      await failThreadResponse({
        message: 'Asking task finished but returned no SQL or ViewID',
      });
    }
  }

  private async getAskingResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAskingResult | null> {
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      return null;
    }

    return {
      ...(taskRecord?.detail as AskResult),
      queryId: queryId || taskRecord?.queryId,
      question: taskRecord?.question,
      taskId: taskRecord?.id,
    };
  }

  private async updateTaskInDatabase(
    filter: { queryId?: string; taskId?: number },
    trackedTask: TrackedTask,
  ): Promise<void> {
    const { queryId, taskId } = filter;
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      // if record not found, create one
      const task = await this.askingTaskRepository.createOne({
        queryId,
        question: trackedTask.question,
        detail: trackedTask.result,
      });
      // update the task id in memory
      let existingTask: TrackedTask;
      if (queryId) {
        existingTask = this.trackedTasks.get(queryId);
      } else if (taskId) {
        existingTask = this.trackedTasksById.get(taskId);
      }
      if (existingTask) {
        existingTask.taskId = task.id;
      }
      return;
    }

    // update the task
    await this.askingTaskRepository.updateOne(taskRecord.id, {
      detail: trackedTask.result,
    });
  }

  private isTaskFinalized(status: AskResultStatus): boolean {
    return [
      AskResultStatus.FINISHED,
      AskResultStatus.FAILED,
      AskResultStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskResult,
    newResult: AskResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }
}
