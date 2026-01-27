import {
  CreateModelData,
  UpdateModelData,
  UpdateModelMetadataInput,
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
  UpdateViewMetadataInput,
  PreviewSQLData,
} from '../models';
import {
  DataSourceName,
  IContext,
  RelationData,
  UpdateRelationData,
} from '../types';
import { getLogger, transformInvalidColumnName } from '@server/utils';
import { DeployResponse } from '../services/deployService';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { isEmpty, isNil } from 'lodash';
import { replaceAllowableSyntax, validateDisplayName } from '../utils/regex';
import { Model, ModelColumn } from '../repositories';
import {
  findColumnsToUpdate,
  getPreviewColumnsStr,
  handleNestedColumns,
  replaceInvalidReferenceName,
  updateModelPrimaryKey,
} from '../utils/model';
import { CompactTable, PreviewDataResponse } from '@server/services';
import { TelemetryEvent } from '../telemetry/telemetry';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

export enum SyncStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}

export class ModelResolver {
  constructor() {
    // model & model column
    this.listModels = this.listModels.bind(this);
    this.getModel = this.getModel.bind(this);
    this.createModel = this.createModel.bind(this);
    this.updateModel = this.updateModel.bind(this);
    this.deleteModel = this.deleteModel.bind(this);
    this.updateModelMetadata = this.updateModelMetadata.bind(this);
    this.deploy = this.deploy.bind(this);
    this.getMDL = this.getMDL.bind(this);
    this.checkModelSync = this.checkModelSync.bind(this);

    // view
    this.listViews = this.listViews.bind(this);
    this.getView = this.getView.bind(this);
    this.validateView = this.validateView.bind(this);
    this.createView = this.createView.bind(this);
    this.deleteView = this.deleteView.bind(this);
    this.updateViewMetadata = this.updateViewMetadata.bind(this);

    // preview
    this.previewModelData = this.previewModelData.bind(this);
    this.previewViewData = this.previewViewData.bind(this);
    this.previewSql = this.previewSql.bind(this);
    this.getNativeSql = this.getNativeSql.bind(this);

    // calculated field
    this.createCalculatedField = this.createCalculatedField.bind(this);
    this.validateCalculatedField = this.validateCalculatedField.bind(this);
    this.updateCalculatedField = this.updateCalculatedField.bind(this);
    this.deleteCalculatedField = this.deleteCalculatedField.bind(this);

    // relation
    this.createRelation = this.createRelation.bind(this);
    this.updateRelation = this.updateRelation.bind(this);
    this.deleteRelation = this.deleteRelation.bind(this);
  }

  public async createRelation(
    _root: any,
    args: { projectId: number; data: RelationData },
    ctx: IContext,
  ) {
    const { projectId, data } = args;

    const eventName = TelemetryEvent.MODELING_CREATE_RELATION;
    try {
      const relation = await ctx.modelService.createRelation(projectId, data);
      ctx.telemetry.sendEvent(eventName, { data });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async updateRelation(
    _root: any,
    args: {
      projectId: number;
      data: UpdateRelationData;
      where: { id: number };
    },
    ctx: IContext,
  ) {
    const { data, where } = args;
    const eventName = TelemetryEvent.MODELING_UPDATE_RELATION;
    try {
      const relation = await ctx.modelService.updateRelation(data, where.id);
      ctx.telemetry.sendEvent(eventName, { data });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteRelation(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const relationId = args.where.id;
    await ctx.modelService.deleteRelation(relationId);
    return true;
  }

  public async createCalculatedField(
    _root: any,
    _args: { projectId: number; data: CreateCalculatedFieldData },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.MODELING_CREATE_CF;
    try {
      const column = await ctx.modelService.createCalculatedField(_args.data);
      ctx.telemetry.sendEvent(eventName, { data: _args.data });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: _args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async validateCalculatedField(
    _root: any,
    args: { projectId: number; data: any },
    ctx: IContext,
  ) {
    const { name, modelId, columnId } = args.data;
    return await ctx.modelService.validateCalculatedFieldNaming(
      name,
      modelId,
      columnId,
    );
  }

  public async updateCalculatedField(
    _root: any,
    _args: {
      projectId: number;
      data: UpdateCalculatedFieldData;
      where: { id: number };
    },
    ctx: IContext,
  ) {
    const { data, where } = _args;

    const eventName = TelemetryEvent.MODELING_UPDATE_CF;
    try {
      const column = await ctx.modelService.updateCalculatedField(
        data,
        where.id,
      );
      ctx.telemetry.sendEvent(eventName, { data });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteCalculatedField(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const columnId = args.where.id;
    const projectId = args.projectId;
    // check column exist and is calculated field
    const column = await ctx.modelColumnRepository.findOneBy({ id: columnId });
    if (!column || !column.isCalculated) {
      throw new Error('Calculated field not found');
    }
    await ctx.modelColumnRepository.deleteOne(columnId);

    // async deploy
    this.deploy(null, { projectId, force: true }, ctx);

    return true;
  }

  public async checkModelSync(
    _root: any,
    args: { projectId: number },
    ctx: IContext,
  ) {
    const projectId = args.projectId;
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);
    const currentHash = ctx.deployService.createMDLHash(manifest, projectId);
    const lastDeploy = await ctx.deployService.getLastDeployment(projectId);
    const lastDeployHash = lastDeploy?.hash;
    const inProgressDeployment =
      await ctx.deployService.getInProgressDeployment(projectId);
    if (inProgressDeployment) {
      return { status: SyncStatusEnum.IN_PROGRESS };
    }
    return currentHash == lastDeployHash
      ? { status: SyncStatusEnum.SYNCRONIZED }
      : { status: SyncStatusEnum.UNSYNCRONIZED };
  }

  public async deploy(
    _root: any,
    args: { projectId: number; force: boolean },
    ctx: IContext,
  ): Promise<DeployResponse> {
    const projectId = args.projectId;
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);
    const deployRes = await ctx.deployService.deploy(
      manifest,
      project.id,
      args.force,
    );

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        projectId,
      );
    }
    return deployRes;
  }

  public async getMDL(
    _root: any,
    args: { projectId: number; hash: string },
    ctx: IContext,
  ) {
    const mdl = await ctx.deployService.getMDLByHash(args.hash);
    return {
      hash: args.hash,
      mdl,
    };
  }

  public async listModels(
    _root: any,
    args: { projectId: number },
    ctx: IContext,
  ) {
    const projectId = args.projectId;
    const models = await ctx.modelRepository.findAllBy({ projectId });
    const modelIds = models.map((m) => m.id);
    const modelColumnList =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumnList =
      await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const result = [];
    for (const model of models) {
      const modelFields = modelColumnList
        .filter((c) => c.modelId === model.id)
        .map((c) => ({
          ...c,
          properties: JSON.parse(c.properties),
          nestedColumns: c.type.includes('STRUCT')
            ? modelNestedColumnList.filter((nc) => nc.columnId === c.id)
            : undefined,
        }));
      const fields = modelFields.filter((c) => !c.isCalculated);
      const calculatedFields = modelFields.filter((c) => c.isCalculated);
      result.push({
        ...model,
        fields,
        calculatedFields,
        properties: {
          ...JSON.parse(model.properties),
        },
      });
    }
    return result;
  }

  public async getModel(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const modelId = args.where.id;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }

    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const modelNestedColumns = await ctx.modelNestedColumnRepository.findAllBy({
      modelId: model.id,
    });

    const columns = modelColumns.map((c) => ({
      ...c,
      properties: JSON.parse(c.properties),
      nestedColumns: c.type.includes('STRUCT')
        ? modelNestedColumns.filter((nc) => nc.columnId === c.id)
        : undefined,
    }));
    const relations = (
      await ctx.relationRepository.findRelationsBy({
        columnIds: modelColumns.map((c) => c.id),
      })
    ).map((r) => ({
      ...r,
      type: r.joinType,
      properties: r.properties ? JSON.parse(r.properties) : {},
    }));

    return {
      ...model,
      fields: columns.filter((c) => !c.isCalculated),
      calculatedFields: columns.filter((c) => c.isCalculated),
      relations,
      properties: {
        ...JSON.parse(model.properties),
      },
    };
  }

  public async createModel(
    _root: any,
    args: { projectId: number; data: CreateModelData },
    ctx: IContext,
  ) {
    const { sourceTableName, fields, primaryKey } = args.data;
    const projectId = args.projectId;
    try {
      const model = await this.handleCreateModel(
        ctx,
        projectId,
        sourceTableName,
        fields,
        primaryKey,
      );
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_CREATE_MODEL, {
        data: args.data,
      });
      return model;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_CREATE_MODEL,
        { data: args.data, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  private async handleCreateModel(
    ctx: IContext,
    projectId: number,
    sourceTableName: string,
    fields: [string],
    primaryKey: string,
  ) {
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    // create model
    const dataSourceTable = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    );
    if (!dataSourceTable) {
      throw new Error('Table not found in the data source');
    }
    const properties = dataSourceTable?.properties;
    const modelValue = {
      projectId: project.id,
      displayName: sourceTableName, //use table name as displayName, referenceName and tableName
      referenceName: replaceInvalidReferenceName(sourceTableName),
      sourceTableName: sourceTableName,
      cached: false,
      refreshTime: null,
      properties: properties ? JSON.stringify(properties) : null,
    } as Partial<Model>;
    const model = await ctx.modelRepository.createOne(modelValue);

    // create columns
    const compactColumns = dataSourceTable.columns.filter((c) =>
      fields.includes(c.name),
    );
    const columnValues = compactColumns.map(
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
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      if (!column) return [];
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);
    logger.info(`Model created: ${JSON.stringify(model)}`);

    return model;
  }

  public async updateModel(
    _root: any,
    args: { projectId: number; data: UpdateModelData; where: { id: number } },
    ctx: IContext,
  ) {
    const { fields, primaryKey } = args.data;
    const projectId = args.projectId;
    try {
      const model = await this.handleUpdateModel(
        ctx,
        projectId,
        args,
        fields,
        primaryKey,
      );
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_UPDATE_MODEL, {
        data: args.data,
      });
      return model;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_UPDATE_MODEL,
        { data: args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModel(
    ctx: IContext,
    projectId: number,
    args: { data: UpdateModelData; where: { id: number } },
    fields: [string],
    primaryKey: string,
  ) {
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    const model = await ctx.modelRepository.findOneBy({ id: args.where.id });
    const existingColumns = await ctx.modelColumnRepository.findAllBy({
      modelId: model.id,
      isCalculated: false,
    });
    const { sourceTableName } = model;
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    const sourceTableColumns = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    )?.columns;
    const { toDeleteColumnIds, toCreateColumns, toUpdateColumns } =
      findColumnsToUpdate(fields, existingColumns, sourceTableColumns);
    await updateModelPrimaryKey(
      ctx.modelColumnRepository,
      model.id,
      primaryKey,
    );

    // delete columns
    if (toDeleteColumnIds.length) {
      await ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
    }

    // create columns
    if (toCreateColumns.length) {
      const compactColumns = sourceTableColumns.filter((sourceColumn) =>
        toCreateColumns.includes(sourceColumn.name),
      );
      const columnValues = compactColumns.map((column) => {
        const columnValue = {
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          sourceColumnName: column.name,
          referenceName: transformInvalidColumnName(column.name),
          type: column.type || 'string',
          notNull: column.notNull,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        } as Partial<ModelColumn>;
        return columnValue;
      });
      const columns = await ctx.modelColumnRepository.createMany(columnValues);

      // create nested columns
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
    }

    // update columns
    if (toUpdateColumns.length) {
      for (const { id, sourceColumnName, type } of toUpdateColumns) {
        const column = await ctx.modelColumnRepository.updateOne(id, { type });

        // if the struct type is changed, need to re-create nested columns
        if (type.includes('STRUCT')) {
          const sourceColumn = sourceTableColumns.find(
            (sourceColumn) => sourceColumn.name === sourceColumnName,
          );
          await ctx.modelNestedColumnRepository.deleteAllBy({
            columnId: column.id,
          });
          await ctx.modelNestedColumnRepository.createMany(
            handleNestedColumns(sourceColumn, {
              modelId: column.modelId,
              columnId: column.id,
              sourceColumnName: sourceColumnName,
            }),
          );
        }
      }
    }

    logger.info(`Model updated: ${JSON.stringify(model)}`);
    return model;
  }

  // delete model
  public async deleteModel(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const modelId = args.where.id;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }

    // related columns and relationships will be deleted in cascade
    await ctx.modelRepository.deleteOne(modelId);
    return true;
  }

  // update model metadata
  public async updateModelMetadata(
    _root: any,
    args: {
      projectId: number;
      where: { id: number };
      data: UpdateModelMetadataInput;
    },
    ctx: IContext,
  ): Promise<boolean> {
    const modelId = args.where.id;
    const data = args.data;

    // check if model exists
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }
    const eventName = TelemetryEvent.MODELING_UPDATE_MODEL_METADATA;
    try {
      // update model metadata
      await this.handleUpdateModelMetadata(data, model, ctx, modelId);

      // todo: considering using update ... from statement to do a batch update
      // update column metadata
      if (!isEmpty(data.columns)) {
        // find the columns that match the user requested columns
        await this.handleUpdateColumnMetadata(data, ctx);
      }

      // update nested column metadata
      if (!isEmpty(data.nestedColumns)) {
        await this.handleUpdateNestedColumnMetadata(data, ctx);
      }

      // update calculated field metadata
      if (!isEmpty(data.calculatedFields)) {
        await this.handleUpdateCFMetadata(data, ctx);
      }

      // update relationship metadata
      if (!isEmpty(data.relationships)) {
        await this.handleUpdateRelationshipMetadata(data, ctx);
      }

      ctx.telemetry.sendEvent(eventName, { data });
      return true;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModelMetadata(
    data: UpdateModelMetadataInput,
    model: Model,
    ctx: IContext,
    modelId: number,
  ) {
    const modelMetadata: any = {};

    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      modelMetadata.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      const properties = isNil(model.properties)
        ? {}
        : JSON.parse(model.properties);

      properties.description = this.determineMetadataValue(data.description);
      modelMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(modelMetadata)) {
      await ctx.modelRepository.updateOne(modelId, modelMetadata);
    }
  }

  private async handleUpdateRelationshipMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const relationshipIds = data.relationships.map((r) => r.id);
    const relationships =
      await ctx.relationRepository.findRelationsByIds(relationshipIds);
    for (const rel of relationships) {
      const requestedMetadata = data.relationships.find((r) => r.id === rel.id);

      const relationMetadata: any = {};

      if (!isNil(requestedMetadata.description)) {
        const properties = rel.properties ? JSON.parse(rel.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        relationMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(relationMetadata)) {
        await ctx.relationRepository.updateOne(rel.id, relationMetadata);
      }
    }
  }

  private async handleUpdateCFMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const calculatedFieldIds = data.calculatedFields.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(calculatedFieldIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.calculatedFields.find(
        (c) => c.id === col.id,
      );

      const columnMetadata: any = {};
      // check if description is empty
      // if description is empty, skip the update
      // if description is not empty, update the description in properties
      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const columnIds = data.columns.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(columnIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.columns.find((c) => c.id === col.id);

      // update metadata
      const columnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        columnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateNestedColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const nestedColumnIds = data.nestedColumns.map((nc) => nc.id);
    const modelNestedColumns =
      await ctx.modelNestedColumnRepository.findNestedColumnsByIds(
        nestedColumnIds,
      );
    for (const col of modelNestedColumns) {
      const requestedMetadata = data.nestedColumns.find((c) => c.id === col.id);

      const nestedColumnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        nestedColumnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        nestedColumnMetadata.properties = {
          ...col.properties,
          description: this.determineMetadataValue(
            requestedMetadata.description,
          ),
        };
      }

      if (!isEmpty(nestedColumnMetadata)) {
        await ctx.modelNestedColumnRepository.updateOne(
          col.id,
          nestedColumnMetadata,
        );
      }
    }
  }

  // list views
  public async listViews(
    _root: any,
    args: { projectId: number },
    ctx: IContext,
  ) {
    const projectId = args.projectId;
    const views = await ctx.viewRepository.findAllBy({ projectId });
    return views.map((view) => ({
      ...view,
      displayName: view.properties
        ? JSON.parse(view.properties)?.displayName
        : view.name,
    }));
  }

  public async getView(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const viewId = args.where.id;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }
    const displayName = view.properties
      ? JSON.parse(view.properties)?.displayName
      : view.name;
    return { ...view, displayName };
  }

  // validate a view name
  public async validateView(
    _root: any,
    args: { projectId: number; data: any },
    ctx: IContext,
  ) {
    const { name } = args.data;
    const { valid, message } = validateDisplayName(name);
    if (!valid) {
      return { valid, message };
    }
    const referenceName = replaceAllowableSyntax(name);
    const views = await ctx.viewRepository.findAllBy({
      projectId: args.projectId,
    });
    if (views.find((v) => v.name === referenceName)) {
      return {
        valid: false,
        message: `Generated view name "${referenceName}" is duplicated`,
      };
    }
    return { valid: true };
  }
  // create view from sql of a response
  public async createView(
    _root: any,
    args: { projectId: number; data: any },
    ctx: IContext,
  ) {
    const { name: displayName, responseId, rephrasedQuestion } = args.data;
    const projectId = args.projectId;

    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment?.manifest;

    const response = await ctx.askingService.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    const statement = safeFormatSQL(response.sql);
    const { columns } = await ctx.queryService.describeStatement(statement, {
      project,
      limit: 1,
      modelingOnly: false,
      manifest,
    });

    const properties = {
      displayName,
      columns,
      responseId,
      question: rephrasedQuestion,
    };

    const name = replaceAllowableSyntax(displayName);
    const view = await ctx.viewRepository.createOne({
      projectId: project.id,
      name,
      statement,
      properties: JSON.stringify(properties),
    });

    ctx.telemetry.sendEvent(TelemetryEvent.MODELING_CREATE_CF, {
      name,
      responseId,
    }); // Fallback to CREATE_CF if CREATE_VIEW is missing

    // async deploy
    this.deploy(null, { projectId, force: true }, ctx);

    return { ...view, displayName };
  }

  // delete view
  public async deleteView(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const viewId = args.where.id;
    const projectId = args.projectId;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }
    await ctx.viewRepository.deleteOne(viewId);

    // async deploy
    this.deploy(null, { projectId, force: true }, ctx);

    return true;
  }

  public async previewModelData(
    _root: any,
    args: { projectId: number; where: { id: number } },
    ctx: IContext,
  ) {
    const modelId = args.where.id;
    const projectId = args.projectId;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);
    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const sql = `select ${getPreviewColumnsStr(modelColumns)} from "${model.referenceName}"`;

    const data = (await ctx.queryService.preview(sql, {
      project,
      modelingOnly: false,
      manifest,
    })) as PreviewDataResponse;

    return data;
  }

  public async previewViewData(
    _root: any,
    args: { projectId: number; where: any },
    ctx: IContext,
  ) {
    const { id: viewId, limit } = args.where;
    const projectId = args.projectId;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);
    const project = await ctx.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new Error('Project not found');
    }

    const data = (await ctx.queryService.preview(view.statement, {
      project,
      limit,
      manifest,
      modelingOnly: false,
    })) as PreviewDataResponse;
    return data;
  }

  // Notice: this is used by AI service.
  // any change to this resolver should be synced with AI service.
  public async previewSql(
    _root: any,
    args: { projectId: number; data: PreviewSQLData },
    ctx: IContext,
  ) {
    const { sql, limit, dryRun } = args.data;
    const pid = args.projectId || args.data.projectId;
    const project = await ctx.projectService.getProjectById(
      typeof pid === 'string' ? parseInt(pid) : pid,
    );
    const { manifest } = await ctx.deployService.getLastDeployment(project.id);
    return await ctx.queryService.preview(sql, {
      project,
      limit: limit,
      modelingOnly: false,
      manifest,
      dryRun,
    });
  }

  public async getNativeSql(
    _root: any,
    args: { projectId: number; responseId: number },
    ctx: IContext,
  ): Promise<string> {
    const { projectId, responseId } = args;

    // If using a sample dataset, native SQL is not supported
    const project = await ctx.projectService.getProjectById(projectId);
    if (project.sampleDataset) {
      throw new Error(`Doesn't support Native SQL`);
    }
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(projectId);

    // get sql statement of a response
    const response = await ctx.askingService.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // construct cte sql and format it
    let nativeSql: string;
    if (project.type === DataSourceName.DUCKDB) {
      logger.info(`Getting native sql from wren engine`);
      nativeSql = await ctx.wrenEngineAdaptor.getNativeSQL(response.sql, {
        manifest,
        modelingOnly: false,
      });
    } else {
      logger.info(`Getting native sql from ibis server`);
      nativeSql = await ctx.ibisServerAdaptor.getNativeSql({
        dataSource: project.type,
        sql: response.sql,
        mdl: manifest,
      });
    }
    const language = project.type === DataSourceName.MSSQL ? 'tsql' : undefined;
    return safeFormatSQL(nativeSql, { language });
  }

  public async updateViewMetadata(
    _root: any,
    args: {
      projectId: number;
      where: { id: number };
      data: UpdateViewMetadataInput;
    },
    ctx: IContext,
  ): Promise<boolean> {
    const viewId = args.where.id;
    const projectId = args.projectId;
    const { displayName, description, columns } = args.data;

    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }

    const properties = JSON.parse(view.properties || '{}');
    let newName = view.name;

    if (displayName) {
      newName = replaceAllowableSyntax(displayName);
      properties.displayName = displayName;
    }
    if (description) {
      properties.description = description;
    }
    if (columns) {
      // update view column metadata
      const viewColumns = properties.columns || [];
      for (const col of viewColumns) {
        const requestedMetadata = columns.find(
          (c) => c.referenceName === col.name,
        );

        if (requestedMetadata && !isNil(requestedMetadata.description)) {
          col.properties = col.properties || {};
          col.properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
        }
      }
      properties.columns = viewColumns;
    }

    await ctx.viewRepository.updateOne(viewId, {
      name: newName,
      properties: JSON.stringify(properties),
    });

    // async deploy
    this.deploy(null, { projectId, force: true }, ctx);

    return true;
  }

  private determineMetadataValue(value: string) {
    // if it's empty string, meaning users want to remove the value
    // so we return null
    if (value === '') {
      return null;
    }

    // otherwise, return the value
    return value;
  }

  private validateTableExist(
    tableName: string,
    dataSourceTables: CompactTable[],
  ) {
    if (!dataSourceTables.find((c) => c.name === tableName)) {
      throw new Error(`Table ${tableName} not found in the data Source`);
    }
  }

  private validateColumnsExist(
    tableName: string,
    fields: string[],
    dataSourceTables: CompactTable[],
  ) {
    const tableColumns = dataSourceTables.find(
      (c) => c.name === tableName,
    )?.columns;
    for (const field of fields) {
      if (!tableColumns.find((c) => c.name === field)) {
        throw new Error(
          `Column "${field}" not found in table "${tableName}" in the data Source`,
        );
      }
    }
  }
}
