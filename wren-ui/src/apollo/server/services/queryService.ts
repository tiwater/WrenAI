import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { Client as PgClient } from 'pg';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  ValidationRules,
  IbisResponse,
} from '../adaptors/ibisAdaptor';
import { getLogger } from '@server/utils';
import { Project } from '../repositories';
import { PostHogTelemetry, TelemetryEvent } from '../telemetry/telemetry';
import { toIbisConnectionInfo } from '../dataSource';

const logger = getLogger('QueryService');
logger.level = 'debug';

export const DEFAULT_PREVIEW_LIMIT = 500;

export interface ColumnMetadata {
  name: string;
  type: string;
}

export interface PreviewDataResponse extends IbisResponse {
  columns: ColumnMetadata[];
  data: any[][];
  cacheHit?: boolean;
  cacheCreatedAt?: string;
  cacheOverrodeAt?: string;
  override?: boolean;
}

export interface DescribeStatementResponse {
  columns: ColumnMetadata[];
}

export interface PreviewOptions {
  project: Project;
  modelingOnly?: boolean;
  // if not given, will use the deployed manifest
  manifest: Manifest;
  limit?: number;
  dryRun?: boolean;
  refresh?: boolean;
  cacheEnabled?: boolean;
}

export interface SqlValidateOptions {
  project: Project;
  mdl: Manifest;
  modelingOnly?: boolean;
}

export interface ValidateResponse {
  valid: boolean;
  message?: string;
}

export interface IQueryService {
  preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean>;

  describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse>;

  validate(
    project: Project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse>;
}

export class QueryService implements IQueryService {
  private readonly ibisAdaptor: IIbisAdaptor;
  private readonly wrenEngineAdaptor: IWrenEngineAdaptor;
  private readonly telemetry: PostHogTelemetry;

  private pgOidToDType(oid: number): string {
    // https://www.postgresql.org/docs/current/datatype-oid.html
    // Map to the same coarse dtypes shape that ibis returns.
    switch (oid) {
      case 16: // bool
        return 'bool';
      case 20: // int8
      case 21: // int2
      case 23: // int4
        return 'int64';
      case 700: // float4
      case 701: // float8
        return 'float64';
      case 1700: // numeric
        return 'float64';
      case 1082: // date
        return 'date';
      case 1114: // timestamp
      case 1184: // timestamptz
        return 'timestamp';
      case 2950: // uuid
        return 'string';
      case 114: // json
      case 3802: // jsonb
        return 'string';
      default:
        return 'string';
    }
  }

  constructor({
    ibisAdaptor,
    wrenEngineAdaptor,
    telemetry,
  }: {
    ibisAdaptor: IIbisAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    telemetry: PostHogTelemetry;
  }) {
    this.ibisAdaptor = ibisAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.telemetry = telemetry;
  }

  public async preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean> {
    const {
      project,
      manifest: mdl,
      limit,
      dryRun,
      refresh,
      cacheEnabled,
    } = options;
    const { type: dataSource, connectionInfo } = project;
    if (this.useEngine(dataSource)) {
      if (dryRun) {
        logger.debug('Using wren engine to dry run');
        await this.wrenEngineAdaptor.dryRun(sql, {
          manifest: mdl,
          limit,
        });
        return true;
      } else {
        logger.debug('Using wren engine to preview');
        const data = await this.wrenEngineAdaptor.previewData(sql, mdl, limit);
        return data as PreviewDataResponse;
      }
    } else {
      this.checkDataSourceIsSupported(dataSource);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(sql, dataSource, connectionInfo, mdl);
      } else {
        return await this.ibisQuery(
          sql,
          dataSource,
          connectionInfo,
          mdl,
          limit,
          refresh,
          cacheEnabled,
        );
      }
    }
  }

  public async describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse> {
    try {
      // preview data with limit 1 to get column metadata
      options.limit = 1;
      const res = (await this.preview(sql, options)) as PreviewDataResponse;
      return { columns: res.columns };
    } catch (err: any) {
      logger.debug(`Got error when describing statement: ${err.message}`);
      throw err;
    }
  }

  public async validate(
    project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse> {
    const { type: dataSource, connectionInfo } = project;
    const res = await this.ibisAdaptor.validate(
      dataSource,
      rule,
      connectionInfo,
      manifest,
      parameters,
    );
    return res;
  }

  private useEngine(dataSource: DataSourceName): boolean {
    if (dataSource === DataSourceName.DUCKDB) {
      return true;
    } else {
      return false;
    }
  }

  private checkDataSourceIsSupported(dataSource: DataSourceName) {
    if (
      !Object.prototype.hasOwnProperty.call(SupportedDataSource, dataSource)
    ) {
      throw new Error(`Unsupported datasource for ibis: "${dataSource}"`);
    }
  }

  private async ibisDryRun(
    sql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
  ): Promise<IbisResponse> {
    const event = TelemetryEvent.IBIS_DRY_RUN;
    try {
      const res = await this.ibisAdaptor.dryRun(sql, {
        dataSource,
        connectionInfo,
        mdl,
      });
      this.sendIbisEvent(event, res, { dataSource, sql });
      return {
        correlationId: res.correlationId,
      };
    } catch (err: any) {
      // Fallback for PostgreSQL when Ibis dry-run fails (e.g. CTE column resolution issues).
      // We validate using PostgreSQL's own planner via EXPLAIN, without executing the query.
      if (dataSource === DataSourceName.POSTGRES) {
        logger.debug(
          'Ibis dry-run failed, falling back to native PostgreSQL EXPLAIN validation',
        );

        const ibisConnInfo = toIbisConnectionInfo(
          dataSource,
          connectionInfo,
        ) as any;
        const connectionUrl = ibisConnInfo?.connectionUrl;

        if (!connectionUrl) {
          this.sendIbisFailedEvent(event, err, { dataSource, sql });
          throw err;
        }

        const trimmedSql = sql.replace(/;+\s*$/g, '').trim();
        if (trimmedSql.includes(';')) {
          const multiStmtError = new Error(
            'Validation failed: multiple SQL statements are not supported',
          );
          this.sendIbisFailedEvent(event, multiStmtError, { dataSource, sql });
          throw multiStmtError;
        }

        const parsedUrl = new URL(connectionUrl);
        const sslMode = parsedUrl.searchParams.get('sslmode');
        const pgClient = new PgClient({
          connectionString: connectionUrl,
          ...(sslMode === 'require'
            ? { ssl: { rejectUnauthorized: false } }
            : {}),
        });

        try {
          await pgClient.connect();
          await pgClient.query(`EXPLAIN (FORMAT JSON) ${trimmedSql}`);
          this.sendIbisEvent(
            event,
            { correlationId: 'native-pg-explain' },
            { dataSource, sql },
          );
          return { correlationId: 'native-pg-explain' };
        } catch (nativeErr: any) {
          this.sendIbisFailedEvent(event, nativeErr, { dataSource, sql });
          throw nativeErr;
        } finally {
          await pgClient.end().catch(() => undefined);
        }
      }
      this.sendIbisFailedEvent(event, err, { dataSource, sql });
      throw err;
    }
  }

  private async ibisQuery(
    sql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
    limit: number,
    refresh?: boolean,
    cacheEnabled?: boolean,
  ): Promise<PreviewDataResponse> {
    const event = TelemetryEvent.IBIS_QUERY;
    try {
      const res = await this.ibisAdaptor.query(sql, {
        dataSource,
        connectionInfo,
        mdl,
        limit,
        refresh,
        cacheEnabled,
      });
      this.sendIbisEvent(event, res, { dataSource, sql });
      const data = this.transformDataType(res);
      return {
        correlationId: res.correlationId,
        cacheHit: res.cacheHit,
        cacheCreatedAt: res.cacheCreatedAt,
        cacheOverrodeAt: res.cacheOverrodeAt,
        override: res.override,
        ...data,
      };
    } catch (err: any) {
      // Native PostgreSQL execution fallback.
      // If Ibis server cannot execute complex SQL (e.g. CTE column resolution limitations),
      // we fall back to executing the SQL directly on PostgreSQL via node-postgres.
      if (dataSource === DataSourceName.POSTGRES) {
        logger.debug(
          'Ibis query failed, falling back to native PostgreSQL execution',
        );

        const ibisConnInfo = toIbisConnectionInfo(
          dataSource,
          connectionInfo,
        ) as any;
        const connectionUrl = ibisConnInfo?.connectionUrl;

        if (!connectionUrl) {
          this.sendIbisFailedEvent(event, err, { dataSource, sql });
          throw err;
        }

        const trimmedSql = sql.replace(/;+\s*$/g, '').trim();
        if (trimmedSql.includes(';')) {
          const multiStmtError = new Error(
            'Query failed: multiple SQL statements are not supported',
          );
          this.sendIbisFailedEvent(event, multiStmtError, { dataSource, sql });
          throw multiStmtError;
        }

        const parsedUrl = new URL(connectionUrl);
        const sslMode = parsedUrl.searchParams.get('sslmode');
        const pgClient = new PgClient({
          connectionString: connectionUrl,
          ...(sslMode === 'require'
            ? { ssl: { rejectUnauthorized: false } }
            : {}),
        });

        const safeLimit = Math.max(
          0,
          Math.floor(limit ?? DEFAULT_PREVIEW_LIMIT),
        );
        const wrappedSql = `SELECT * FROM (${trimmedSql}) AS _wren_subquery LIMIT ${safeLimit}`;

        try {
          await pgClient.connect();
          const result = await pgClient.query(wrappedSql);

          const columns = result.fields.map((f) => f.name);
          const dtypes = result.fields.reduce(
            (acc, f) => {
              acc[f.name] = this.pgOidToDType(f.dataTypeID);
              return acc;
            },
            {} as Record<string, string>,
          );
          const data = result.rows.map((row) => columns.map((c) => row[c]));

          const response: PreviewDataResponse = {
            correlationId: 'native-pg-query',
            columns: columns.map((name) => ({
              name,
              type: dtypes[name] ?? 'unknown',
            })),
            data,
          };

          this.sendIbisEvent(
            event,
            { correlationId: response.correlationId },
            { dataSource, sql },
          );

          return response;
        } catch (nativeErr: any) {
          this.sendIbisFailedEvent(event, nativeErr, { dataSource, sql });
          throw nativeErr;
        } finally {
          await pgClient.end().catch(() => undefined);
        }
      }
      this.sendIbisFailedEvent(event, err, { dataSource, sql });
      throw err;
    }
  }

  private transformDataType(data: IbisQueryResponse): PreviewDataResponse {
    const columns = data.columns;
    const dtypes = data.dtypes;
    const transformedColumns = columns.map((column) => {
      let type = 'unknown';
      if (dtypes && dtypes[column]) {
        type = dtypes[column] === 'object' ? 'string' : dtypes[column];
      }
      if (type === 'unknown') {
        logger.debug(`Did not find type mapping for "${column}"`);
        logger.debug(
          `dtypes mapping: ${dtypes ? JSON.stringify(dtypes, null, 2) : 'undefined'} `,
        );
      }
      return {
        name: column,
        type,
      } as ColumnMetadata;
    });
    return {
      columns: transformedColumns,
      data: data.data,
    } as PreviewDataResponse;
  }

  private sendIbisEvent(
    event: TelemetryEvent,
    res: IbisResponse,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(event, {
      correlationId: res.correlationId,
      processTime: res.processTime,
      ...others,
    });
  }

  private sendIbisFailedEvent(
    event: TelemetryEvent,
    err: any,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(
      event,
      {
        correlationId: err.extensions?.other?.correlationId,
        processTime: err.extensions?.other?.processTime,
        error: err.message,
        ...others,
      },
      err.extensions?.service,
      false,
    );
  }
}
