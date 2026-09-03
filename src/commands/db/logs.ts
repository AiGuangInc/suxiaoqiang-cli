import ora from 'ora';
import { getProjectConfig } from '../../lib/config.js';
import { queryCloudLogs } from '../../lib/api.js';
import { logger } from '../../lib/logger.js';
import { isDebug } from '../../lib/debug.js';
import { t } from '../../lib/i18n.js';
import {
  prepareDatabasePlugin,
  printDatabaseTarget,
  resolveDatabaseEnvironment,
} from './common.js';
import type { CloudLogItem, CloudLogTimeRange, CloudLogType } from '../../types/index.js';

const LOG_TYPES: Record<string, CloudLogType> = {
  function: 'function_logs',
  'function-edge': 'function_edge_logs',
  auth: 'auth_logs',
  postgres: 'postgres_logs',
  realtime: 'realtime_logs',
  storage: 'storage_logs',
  cron: 'cron_job_logs',
  edge: 'edge_logs',
  postgrest: 'postgrest_logs',
  supavisor: 'supavisor_logs',
  pgbouncer: 'pgbouncer_logs',
  'pg-upgrade': 'pg_upgrade_logs',
};

const TIME_RANGES: Record<string, CloudLogTimeRange> = {
  '5m': 'last5minutes',
  '15m': 'last15minutes',
  '30m': 'last30minutes',
  '1h': 'last1hour',
  '3h': 'last3hours',
  '24h': 'last24hours',
  '2d': 'last2days',
  '3d': 'last3days',
  '5d': 'last5days',
};

export interface DbLogsOptions {
  prod?: boolean;
  type?: string;
  since?: string;
  filter?: string;
  limit?: number;
  order?: 'asc' | 'desc';
  json?: boolean;
}

function displayTimestamp(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(value ?? '');
  const millis = numeric > 100_000_000_000_000 ? numeric / 1000 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function formatLog(item: CloudLogItem): string {
  const timestamp = displayTimestamp(item.timestamp);
  const level = item.log_level ? `[${item.log_level}]` : '';
  const request = [item.method, item.pathname ?? item.path, item.status_code]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' ');
  const message = item.event_message ?? JSON.stringify(item);
  return [timestamp, level, request, message].filter(Boolean).join(' ');
}

export async function dbLogsCommand(options: DbLogsOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }
  let logsSpinner: ReturnType<typeof ora> | undefined;
  try {
    const typeName = options.type ?? 'function';
    const type = LOG_TYPES[typeName];
    if (!type) throw new Error(t('db.logsInvalidType', { value: typeName }));
    const sinceName = options.since ?? '15m';
    const timeRange = TIME_RANGES[sinceName];
    if (!timeRange) throw new Error(t('db.logsInvalidSince', { value: sinceName }));
    await prepareDatabasePlugin(config.sessionId, { json: options.json });
    const target = await resolveDatabaseEnvironment(config.sessionId, options.prod ?? false);
    printDatabaseTarget(t(target.env === 'prod'
      ? 'db.logsTargetProd'
      : target.isolated ? 'db.logsTargetDebug' : 'db.logsTargetCurrent'), options.json ?? false);
    logsSpinner = ora(t('db.queryingLogs')).start();
    const result = await queryCloudLogs({
      sessionId: config.sessionId,
      env: target.env,
      type,
      timeRange,
      filter: options.filter,
      limit: options.limit ?? 100,
      orderBy: options.order ?? 'desc',
      paginate: true,
    });
    logsSpinner.stop();
    const items = result.items ?? [];
    if (options.json) console.log(JSON.stringify(items, null, 2));
    else if (items.length === 0) logger.info(t('db.logsEmpty'));
    else for (const item of items) console.log(formatLog(item));
  } catch (error) {
    if (logsSpinner?.isSpinning) logsSpinner.fail(t('db.logsFailed'));
    else logger.error(t('db.logsFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}
