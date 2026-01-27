import {
  AnalysisRelationInfo,
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  RelationType,
  SampleDatasetData,
} from '../types';
import {
  trim,
  getLogger,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
  handleNestedColumns,
} from '@server/utils';
import {
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  Project,
} from '../repositories';
import {
  SampleDatasetName,
  SampleDatasetRelationship,
  buildInitSql,
  getRelations,
  sampleDatasets,
} from '@server/data';
import { snakeCase } from 'lodash';
import { CompactTable, ProjectData } from '../services';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import DataSourceSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';
import { encryptConnectionInfo } from '../dataSource';
import { TelemetryEvent } from '../telemetry/telemetry';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

// Helper function to safely convert date to string
const toDateString = (
  date: Date | string | null | undefined | any,
): string | null => {
  if (!date) return null;
  if (typeof date === 'string') return date;
  // Check if it's a valid Date object
  if (date instanceof Date && !isNaN(date.getTime())) {
    return date.toISOString();
  }
  // Try to parse as date if it's an object with toString
  if (typeof date === 'object' && date.toString) {
    const str = date.toString();
    // If it looks like a date string, return it
    if (str && str !== '[object Object]') {
      return str;
    }
  }
  // If all else fails, try to create a Date from it
  try {
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  } catch (_e) {
    // Ignore parse errors
  }
  return null;
};

// Helper function to format project for GraphQL response
const formatProjectInfo = (project: any) => ({
  id: project.id,
  name: project.name || project.displayName || 'Unnamed Project', // Ensure name is never null
  displayName: project.displayName || '',
  type: project.type,
  language: project.language || 'EN',
  lastAccessedAt: toDateString(project.lastAccessedAt),
  createdAt: toDateString(project.createdAt),
  sampleDataset: project.sampleDataset,
});

export class ProjectResolver {
  constructor() {
    this.getSettings = this.getSettings.bind(this);
    this.updateCurrentProject = this.updateCurrentProject.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveDataSource = this.saveDataSource.bind(this);
    this.updateDataSource = this.updateDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerDataSourceDetection =
      this.triggerDataSourceDetection.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
    this.getProjectRecommendationQuestions =
      this.getProjectRecommendationQuestions.bind(this);

    // New multi-project methods
    this.listProjects = this.listProjects.bind(this);
    this.getProject = this.getProject.bind(this);
    this.createProject = this.createProject.bind(this);
    this.updateProject = this.updateProject.bind(this);
    this.deleteProject = this.deleteProject.bind(this);
    this.duplicateProject = this.duplicateProject.bind(this);
  }

  public async getSettings(
    _root: any,
    _arg: { projectId: number },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getProjectById(_arg.projectId);
    const generalConnectionInfo =
      ctx.projectService.getGeneralConnectionInfo(project);
    const dataSourceType = project.type;

    return {
      productVersion: ctx.config.wrenProductVersion || '',
      dataSource: {
        type: dataSourceType,
        properties: {
          displayName: project.displayName,
          ...generalConnectionInfo,
        } as DataSourceProperties,
        sampleDataset: project.sampleDataset,
      },
      language: project.language,
    };
  }

  public async getProjectRecommendationQuestions(
    _root: any,
    _arg: { projectId: number },
    ctx: IContext,
  ) {
    return ctx.projectService.getProjectRecommendationQuestions(_arg.projectId);
  }

  public async updateCurrentProject(
    _root: any,
    arg: { projectId: number; data: { language: string } },
    ctx: IContext,
  ) {
    const { language } = arg.data;
    const project = await ctx.projectService.getProjectById(arg.projectId);
    await ctx.projectRepository.updateOne(project.id, {
      language,
    });

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        project.id,
      );
    }
    return true;
  }

  public async resetCurrentProject(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    let project;
    try {
      project = await ctx.projectService.getProjectById(arg.projectId);
    } catch {
      // no project found
      return true;
    }
    const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
    try {
      const id = project.id;
      await ctx.schemaChangeRepository.deleteAllBy({ projectId: id });
      await ctx.deployService.deleteAllByProjectId(id);
      await ctx.askingService.deleteAllByProjectId(id);
      await ctx.modelService.deleteAllViewsByProjectId(id);
      await ctx.modelService.deleteAllModelsByProjectId(id);
      await ctx.projectService.deleteProject(id);
      await ctx.wrenAIAdaptor.delete(id);

      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        projectId: id,
        dataSourceType: project.type,
      });
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return true;
  }

  public async startSampleDataset(
    _root: any,
    _arg: { projectId: number; data: SampleDatasetData },
    ctx: IContext,
  ) {
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
    const eventProperties = {
      datasetName: name,
    };
    try {
      // create duckdb datasource
      const initSql = buildInitSql(name as SampleDatasetName);

      // Get project name from sessionStorage if available
      const projectName = _arg.data['projectName'] || name;

      const duckdbDatasourceProperties = {
        name: projectName, // Add project name
        displayName: name, // Display name is the dataset name
        initSql,
        extensions: [],
        configurations: {},
      };
      const dataSourceResult = await this.saveDataSource(
        _root,
        {
          projectId: 0, // Will create a new project
          data: {
            type: DataSourceName.DUCKDB,
            properties: duckdbDatasourceProperties,
          } as DataSource,
        },
        ctx,
      );
      const project = await ctx.projectService.getProjectById(
        dataSourceResult.projectId,
      );

      // list all the tables in the data source
      const tables = await this.listDataSourceTables(
        _root,
        { projectId: project.id },
        ctx,
      );
      const tableNames = tables.map((table) => table.name);

      // save tables as model and modelColumns
      await this.overwriteModelsAndColumns(tableNames, ctx, project);

      await ctx.modelService.updatePrimaryKeys(project.id, dataset.tables);
      await ctx.modelService.batchUpdateModelProperties(
        project.id,
        dataset.tables,
      );
      await ctx.modelService.batchUpdateColumnProperties(
        project.id,
        dataset.tables,
      );

      // save relations
      const relations = getRelations(name as SampleDatasetName);
      const models = await ctx.modelRepository.findAll();
      const columns = await ctx.modelColumnRepository.findAll();
      const mappedRelations = this.buildRelationInput(
        relations,
        models,
        columns,
      );
      await ctx.modelService.saveRelations(project.id, mappedRelations);

      // mark current project as using sample dataset
      await ctx.projectRepository.updateOne(project.id, {
        sampleDataset: name,
      });
      await this.deploy(ctx, project.id);
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      return { name, projectId: project.id };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { ...eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getOnboardingStatus(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    let project: Project | null;
    try {
      project = await ctx.projectService.getProjectById(arg.projectId);
    } catch (_err: any) {
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }
    const { id, sampleDataset } = project;
    if (sampleDataset) {
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      return {
        status: OnboardingStatusEnum.ONBOARDING_FINISHED,
      };
    }
  }

  public async saveDataSource(
    _root: any,
    args: {
      projectId: number;
      data: DataSource;
    },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    // Don't reset project in multi-project mode
    // await this.resetCurrentProject(_root, args, ctx);

    const { displayName, ...connectionInfo } = properties as any;
    const project = await ctx.projectService.createProject({
      name: (properties as any).name || displayName,
      displayName,
      type,
      connectionInfo,
    } as ProjectData);
    logger.debug(`Project created.`);

    // Update last accessed time for the new project
    await ctx.projectRepository.updateLastAccessed(project.id);

    // init dashboard
    logger.debug('Dashboard init...');
    await ctx.dashboardService.initDashboard(project.id);
    logger.debug('Dashboard created.');

    const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
    const eventProperties = {
      dataSourceType: type,
    };

    // try to connect to the data source
    try {
      // handle duckdb connection
      if (type === DataSourceName.DUCKDB) {
        connectionInfo as DUCKDB_CONNECTION_INFO;
        await this.buildDuckDbEnvironment(ctx, {
          initSql: connectionInfo.initSql,
          extensions: connectionInfo.extensions,
          configurations: connectionInfo.configurations,
        });
      } else {
        // handle other data source
        await ctx.projectService.getProjectDataSourceTables(project);
        const version =
          await ctx.projectService.getProjectDataSourceVersion(project);
        await ctx.projectService.updateProject(project.id, {
          version,
        });
        logger.debug(`Data source tables fetched`);
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
    } catch (err) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      await ctx.projectRepository.deleteOne(project.id);
      ctx.telemetry.sendEvent(
        eventName,
        { eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return {
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
      projectId: project.id,
    };
  }

  public async updateDataSource(
    _root: any,
    args: { projectId: number; data: DataSource },
    ctx: IContext,
  ) {
    const { properties } = args.data;
    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.getProjectById(args.projectId);
    const dataSourceType = project.type;

    // only new connection info needed to encrypt
    const toUpdateConnectionInfo = encryptConnectionInfo(
      dataSourceType,
      connectionInfo as any,
    );

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions, configurations } =
        toUpdateConnectionInfo as DUCKDB_CONNECTION_INFO;
      await this.buildDuckDbEnvironment(ctx, {
        initSql,
        extensions,
        configurations,
      });
    } else {
      const updatedProject = {
        ...project,
        displayName,
        connectionInfo: {
          ...project.connectionInfo,
          ...toUpdateConnectionInfo,
        },
      } as Project;

      await ctx.projectService.getProjectDataSourceTables(updatedProject);
      logger.debug(`Data source tables fetched`);
    }
    const updatedProject = await ctx.projectRepository.updateOne(project.id, {
      displayName,
      connectionInfo: { ...project.connectionInfo, ...toUpdateConnectionInfo },
    });
    return {
      type: updatedProject.type,
      properties: {
        displayName: updatedProject.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
      },
    };
  }

  public async listDataSourceTables(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    return await ctx.projectService.getProjectDataSourceTables(
      null,
      arg.projectId,
    );
  }

  public async saveTables(
    _root: any,
    arg: {
      projectId: number;
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;

    // get current project
    const project = await ctx.projectService.getProjectById(arg.projectId);
    try {
      // delete existing models and columns
      const { models, columns } = await this.overwriteModelsAndColumns(
        arg.data.tables,
        ctx,
        project,
      );
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        dataSourceType: project.type,
        tablesCount: models.length,
        columnsCount: columns.length,
      });

      // async deploy to wren-engine and ai service
      this.deploy(ctx, project.id);
      return { models: models, columns };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async autoGenerateRelation(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getProjectById(arg.projectId);

    // get models and columns
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const constraints =
      await ctx.projectService.getProjectSuggestedConstraint(project);

    // generate relation
    const relations = [];
    for (const constraint of constraints) {
      const {
        constraintTable,
        constraintColumn,
        constraintedTable,
        constraintedColumn,
      } = constraint;
      // validate tables and columns exists in our models and model columns
      const fromModel = models.find(
        (m) => m.sourceTableName === constraintTable,
      );
      const toModel = models.find(
        (m) => m.sourceTableName === constraintedTable,
      );
      if (!fromModel || !toModel) {
        continue;
      }
      const fromColumn = columns.find(
        (c) =>
          c.modelId === fromModel.id && c.sourceColumnName === constraintColumn,
      );
      const toColumn = columns.find(
        (c) =>
          c.modelId === toModel.id && c.sourceColumnName === constraintedColumn,
      );
      if (!fromColumn || !toColumn) {
        continue;
      }
      // create relation
      const relation: AnalysisRelationInfo = {
        // upper case the first letter of the sourceTableName
        name: constraint.constraintName,
        fromModelId: fromModel.id,
        fromModelReferenceName: fromModel.referenceName,
        fromColumnId: fromColumn.id,
        fromColumnReferenceName: fromColumn.referenceName,
        toModelId: toModel.id,
        toModelReferenceName: toModel.referenceName,
        toColumnId: toColumn.id,
        toColumnReferenceName: toColumn.referenceName,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    // group by model
    return models.map(({ id, displayName, referenceName }) => ({
      id,
      displayName,
      referenceName,
      relations: relations.filter(
        (relation) =>
          relation.fromModelId === id &&
          // exclude self-referential relationship
          relation.toModelId !== relation.fromModelId,
      ),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { projectId: number; data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
    try {
      const savedRelations = await ctx.modelService.saveRelations(
        arg.projectId,
        arg.data.relations,
      );
      // async deploy
      this.deploy(ctx, arg.projectId);
      ctx.telemetry.sendEvent(eventName, {
        relationCount: savedRelations.length,
      });
      return savedRelations;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getSchemaChange(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getProjectById(arg.projectId);
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (!lastSchemaChange) {
      return {
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      };
    }

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships = await ctx.relationRepository.findRelationInfoBy({
      modelIds,
    });

    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });

    const resolves = lastSchemaChange.resolve;
    const unresolvedChanges = Object.keys(resolves).reduce((result, key) => {
      const isResolved = resolves[key];
      const changes = lastSchemaChange.change[key];
      // return if resolved or no changes
      if (isResolved || !changes) return result;

      // Mapping with affected models and columns and affected calculated fields and relationships data into schema change
      const affecteds = schemaDetector.getAffectedResources(changes, {
        models,
        modelColumns,
        modelRelationships,
      });

      const affectedChanges = affecteds.length ? affecteds : null;
      return { ...result, [key]: affectedChanges };
    }, {});

    return {
      ...unresolvedChanges,
      lastSchemaChangeTime: lastSchemaChange.createdAt,
    };
  }

  public async triggerDataSourceDetection(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getProjectById(arg.projectId);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
    try {
      const hasSchemaChange = await schemaDetector.detectSchemaChange();
      ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
      return hasSchemaChange;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { projectId: number; where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await ctx.projectService.getProjectById(arg.projectId);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
    try {
      await schemaDetector.resolveSchemaChange(type);
      ctx.telemetry.sendEvent(eventName, { type });
    } catch (error) {
      ctx.telemetry.sendEvent(
        eventName,
        { type, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
    return true;
  }

  private async deploy(ctx: IContext, projectId: number) {
    const project = await ctx.projectService.getProjectById(projectId);
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);
    const deployRes = await ctx.deployService.deploy(manifest, project.id);

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        projectId,
      );
    }
    return deployRes;
  }

  private buildRelationInput(
    relations: SampleDatasetRelationship[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    const relationInput = relations.map((relation) => {
      const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
        relation;
      const fromModelId = models.find(
        (model) => model.sourceTableName === fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === toModelName,
      )?.id;
      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.referenceName === fromColumnName &&
          column.modelId === fromModelId,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.referenceName === toColumnName && column.modelId === toModelId,
      )?.id;
      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
        );
      }
      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type,
        description: relation.description,
      } as RelationData;
    });
    return relationInput;
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    const compactTables: CompactTable[] =
      await ctx.projectService.getProjectDataSourceTables(project);

    const selectedTables = compactTables.filter((table) =>
      tables.includes(table.name),
    );

    // create models
    const modelValues = selectedTables.map((table) => {
      const properties = table?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: table.name, // use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(table.name),
        sourceTableName: table.name,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    // create columns
    const columnValues = selectedTables.flatMap((table) => {
      const compactColumns = table.columns;
      const primaryKey = table.primaryKey;
      const model = models.find((m) => m.sourceTableName === table.name);
      return compactColumns.map(
        (column) =>
          ({
            modelId: model.id,
            isCalculated: false,
            displayName: column.name,
            referenceName: transformInvalidColumnName(column.name),
            sourceColumnName: column.name,
            type: column.type || 'string',
            notNull: column.notNull || false,
            isPk: primaryKey === column.name,
            properties: column.properties
              ? JSON.stringify(column.properties)
              : null,
          }) as Partial<ModelColumn>,
      );
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const compactColumns = selectedTables.flatMap((table) => table.columns);
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);

    return { models, columns };
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async buildDuckDbEnvironment(
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ): Promise<void> {
    const { initSql, extensions, configurations } = options;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
    await ctx.wrenEngineAdaptor.prepareDuckDB({
      sessionProps: configurations,
      initSql: initSqlWithExtensions,
    } as DuckDBPrepareOptions);

    // check can list dataset table
    await ctx.wrenEngineAdaptor.listTables();

    // patch wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await ctx.wrenEngineAdaptor.patchConfig(config);
  }

  // New multi-project resolver methods
  public async listProjects(_root: any, _arg: any, ctx: IContext) {
    const projects = await ctx.projectService.listProjects();
    const projectInfos = projects.map(formatProjectInfo);

    return {
      projects: projectInfos,
    };
  }

  public async getProject(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getProjectById(arg.projectId);
    return formatProjectInfo(project);
  }

  // getActiveProject removed - project selection is now handled on client side

  public async createProject(
    _root: any,
    arg: { data: { name: string; type: DataSourceName; properties: any } },
    ctx: IContext,
  ) {
    const { name, type, properties } = arg.data;
    const { displayName, ...connectionInfo } = properties;

    const project = await ctx.projectService.createProject({
      name,
      displayName,
      type,
      connectionInfo,
    } as ProjectData);

    // Update last accessed time for the new project
    await ctx.projectRepository.updateLastAccessed(project.id);

    // Initialize dashboard for new project
    await ctx.dashboardService.initDashboard(project.id);

    return formatProjectInfo(project);
  }

  public async updateProject(
    _root: any,
    arg: { projectId: number; data: { name?: string; language?: string } },
    ctx: IContext,
  ) {
    const { projectId, data } = arg;
    const project = await ctx.projectService.updateProject(projectId, data);
    return formatProjectInfo(project);
  }

  // switchProject removed - project selection is now handled on client side

  public async deleteProject(
    _root: any,
    arg: { projectId: number },
    ctx: IContext,
  ) {
    const { projectId } = arg;

    // Delete all related data
    await ctx.schemaChangeRepository.deleteAllBy({ projectId });
    await ctx.deployService.deleteAllByProjectId(projectId);
    await ctx.askingService.deleteAllByProjectId(projectId);
    await ctx.modelService.deleteAllViewsByProjectId(projectId);
    await ctx.modelService.deleteAllModelsByProjectId(projectId);
    await ctx.projectService.deleteProject(projectId);
    await ctx.wrenAIAdaptor.delete(projectId);

    return true;
  }

  public async duplicateProject(
    _root: any,
    arg: { projectId: number; name: string },
    ctx: IContext,
  ) {
    const { projectId, name } = arg;
    const project = await ctx.projectService.duplicateProject(projectId, name);
    return formatProjectInfo(project);
  }
}
