import { IProjectRepository } from '../repositories/projectRepository';
import { RecommendationQuestionStatus } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import { IThreadRepository, Project, Thread } from '../repositories';
import {
  ITelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import { getLogger } from '../utils/logger';
import { Logger } from 'log4js';

// PRQ background tracker : project recommend question background tracker
const loggerPrefix = 'PRQBT:';

const isFinalized = (status: RecommendationQuestionStatus) => {
  return [
    RecommendationQuestionStatus.FINISHED,
    RecommendationQuestionStatus.FAILED,
  ].includes(status);
};

export class ProjectRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Project> = {};
  private intervalTime: number;
  private interval?: ReturnType<typeof setInterval>;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRepository: IProjectRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;

  constructor({
    telemetry,
    wrenAIAdaptor,
    projectRepository,
  }: {
    telemetry: ITelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    projectRepository: IProjectRepository;
  }) {
    this.logger = getLogger('PRQ Background Tracker');
    this.logger.level = 'debug';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRepository = projectRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    if (this.interval) {
      return;
    }
    this.logger.info('Recommend question background tracker started');
    this.interval = setInterval(() => {
      const jobs = Object.values(this.tasks).map((project) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(project))) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(project));

        try {
          const latestProject = await this.projectRepository.findOneBy({
            id: project.id,
          });
          if (!latestProject?.queryId) {
            delete this.tasks[this.taskKey(project)];
            return;
          }
          // Refresh cached payload to avoid using stale status/questions.
          this.tasks[this.taskKey(project)] = latestProject;

          const result =
            await this.wrenAIAdaptor.getRecommendationQuestionsResult(
              latestProject.queryId,
            );

          const nextQuestions = result.response?.questions || [];
          const prevQuestions = latestProject.questions || [];

          // check if status change
          if (
            latestProject.questionsStatus === result.status &&
            nextQuestions.length === prevQuestions.length
          ) {
            this.logger.debug(
              `${loggerPrefix}job ${this.taskKey(project)} status not changed, returning question count: ${nextQuestions.length || 0}`,
            );
            return;
          }

          // update database
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(project)} have changes, returning question count: ${nextQuestions.length || 0}, updating`,
          );
          await this.projectRepository.updateOne(project.id, {
            questionsStatus: result.status.toUpperCase(),
            questions: nextQuestions,
            questionsError: result.error,
          });
          latestProject.questionsStatus = result.status;
          latestProject.questions = nextQuestions;

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            const eventProperties = {
              projectId: latestProject.id,
              projectType: latestProject.type,
              status: result.status,
              questions: latestProject.questions,
              error: result.error,
            };
            if (result.status === RecommendationQuestionStatus.FINISHED) {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_GENERATE_PROJECT_RECOMMENDATION_QUESTIONS,
                eventProperties,
              );
            } else {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_GENERATE_PROJECT_RECOMMENDATION_QUESTIONS,
                eventProperties,
                WrenService.AI,
                false,
              );
            }
            this.logger.debug(
              `${loggerPrefix}job ${this.taskKey(project)} is finalized, removing`,
            );
            delete this.tasks[this.taskKey(project)];
          }
        } finally {
          this.runningJobs.delete(this.taskKey(project));
        }
      });

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(project: Project) {
    this.tasks[this.taskKey(project)] = project;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const projects = await this.projectRepository.findAll();
    for (const project of projects) {
      if (
        this.taskKey(project) &&
        !isFinalized(project.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(project);
      }
    }
  }

  public taskKey(project: Project) {
    return project.id;
  }

  public isExist(project: Project) {
    return this.tasks[this.taskKey(project)];
  }
}

export class ThreadRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Thread> = {};
  private intervalTime: number;
  private interval?: ReturnType<typeof setInterval>;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadRepository: IThreadRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadRepository,
  }: {
    telemetry: ITelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadRepository: IThreadRepository;
  }) {
    this.logger = getLogger('TRQ Background Tracker');
    this.logger.level = 'debug';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadRepository = threadRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    if (this.interval) {
      return;
    }
    this.logger.info('Recommend question background tracker started');
    this.interval = setInterval(() => {
      const jobs = Object.values(this.tasks).map((thread) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(thread))) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(thread));

        try {
          const latestThread = await this.threadRepository.findOneBy({
            id: thread.id,
          });
          if (!latestThread?.queryId) {
            delete this.tasks[this.taskKey(thread)];
            return;
          }
          // Refresh cached payload to avoid using stale status/questions.
          this.tasks[this.taskKey(thread)] = latestThread;

          const result =
            await this.wrenAIAdaptor.getRecommendationQuestionsResult(
              latestThread.queryId,
            );

          const nextQuestions = result.response?.questions || [];
          const prevQuestions = latestThread.questions || [];

          // check if status change
          if (
            latestThread.questionsStatus === result.status &&
            nextQuestions.length === prevQuestions.length
          ) {
            this.logger.debug(
              `${loggerPrefix}job ${this.taskKey(thread)} status not changed, returning question count: ${nextQuestions.length || 0}`,
            );
            return;
          }

          // update database
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(thread)} have changes, returning question count: ${nextQuestions.length || 0}, updating`,
          );
          await this.threadRepository.updateOne(thread.id, {
            questionsStatus: result.status.toUpperCase(),
            questions: nextQuestions,
            questionsError: result.error,
          });
          latestThread.questionsStatus = result.status;
          latestThread.questions = nextQuestions;

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            const eventProperties = {
              thread_id: latestThread.id,
              status: result.status,
              questions: latestThread.questions,
              error: result.error,
            };
            if (result.status === RecommendationQuestionStatus.FINISHED) {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
                eventProperties,
              );
            } else {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
                eventProperties,
                WrenService.AI,
                false,
              );
            }
            this.logger.debug(
              `${loggerPrefix}job ${this.taskKey(thread)} is finalized, removing`,
            );
            delete this.tasks[this.taskKey(thread)];
          }
        } finally {
          this.runningJobs.delete(this.taskKey(thread));
        }
      });

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(thread: Thread) {
    this.tasks[this.taskKey(thread)] = thread;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const threads = await this.threadRepository.findAll();
    for (const thread of threads) {
      if (
        !this.tasks[this.taskKey(thread)] &&
        thread.queryId &&
        !isFinalized(thread.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(thread);
      }
    }
  }

  public taskKey(thread: Thread) {
    return thread.id;
  }

  public isExist(thread: Thread) {
    return this.tasks[this.taskKey(thread)];
  }
}
