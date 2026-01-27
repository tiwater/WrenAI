import { IContext } from '@server/types/context';
import { SqlPair } from '@server/repositories';
import * as Errors from '@server/utils/error';
import { TelemetryEvent, TrackTelemetry } from '@server/telemetry/telemetry';
import { DialectSQL, WrenSQL } from '@server/models/adaptor';
import { safeFormatSQL } from '@server/utils/sqlFormat';

export class SqlPairResolver {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPair = this.createSqlPair.bind(this);
    this.updateSqlPair = this.updateSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
    this.generateQuestion = this.generateQuestion.bind(this);
    this.modelSubstitute = this.modelSubstitute.bind(this);
  }

  public async getProjectSqlPairs(
    _root: unknown,
    args: { projectId: number },
    ctx: IContext,
  ): Promise<SqlPair[]> {
    return ctx.sqlPairService.getProjectSqlPairs(args.projectId);
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_CREATE_SQL_PAIR)
  public async createSqlPair(
    _root: unknown,
    arg: {
      projectId: number;
      data: {
        sql: string;
        question: string;
      };
    },
    ctx: IContext,
  ): Promise<SqlPair> {
    await this.validateSql(arg.data.sql, arg.projectId, ctx);
    return await ctx.sqlPairService.createSqlPair(arg.projectId, arg.data);
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_UPDATE_SQL_PAIR)
  public async updateSqlPair(
    _root: unknown,
    arg: {
      projectId: number;
      data: {
        sql?: string;
        question?: string;
      };
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ): Promise<SqlPair> {
    await this.validateSql(arg.data.sql, arg.projectId, ctx);
    return ctx.sqlPairService.editSqlPair(
      arg.projectId,
      arg.where.id,
      arg.data,
    );
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_DELETE_SQL_PAIR)
  public async deleteSqlPair(
    _root: unknown,
    arg: {
      projectId: number;
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ): Promise<boolean> {
    return ctx.sqlPairService.deleteSqlPair(arg.projectId, arg.where.id);
  }

  public async generateQuestion(
    _root: unknown,
    arg: {
      projectId: number;
      data: {
        sql: string;
      };
    },
    ctx: IContext,
  ) {
    const project = await ctx.projectRepository.findOneBy({
      id: arg.projectId,
    });
    if (!project) {
      throw new Error('Project not found');
    }
    const questions = await ctx.sqlPairService.generateQuestions(project, [
      arg.data.sql,
    ]);
    return questions[0];
  }

  public async modelSubstitute(
    _root: unknown,
    arg: {
      projectId: number;
      data: {
        sql: DialectSQL;
      };
    },
    ctx: IContext,
  ): Promise<WrenSQL> {
    const project = await ctx.projectRepository.findOneBy({
      id: arg.projectId,
    });
    if (!project) {
      throw new Error('Project not found');
    }
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;

    const wrenSQL = await ctx.sqlPairService.modelSubstitute(
      arg.data.sql as DialectSQL,
      {
        project,
        manifest,
      },
    );
    return safeFormatSQL(wrenSQL, { language: 'postgresql' }) as WrenSQL;
  }

  private async validateSql(sql: string, projectId: number, ctx: IContext) {
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;
    try {
      await ctx.queryService.preview(sql, {
        manifest,
        project,
        dryRun: true,
      });
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err.message,
      });
    }
  }

  public getSqlPairNestedResolver = () => ({
    createdAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.createdAt).toISOString();
    },
    updatedAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.updatedAt).toISOString();
    },
  });
}
