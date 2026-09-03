import ora from 'ora';
import { readFile } from 'node:fs/promises';
import { getProjectConfig } from '../../lib/config.js';
import { supabaseRunQuery } from '../../lib/api.js';
import { logger } from '../../lib/logger.js';
import { isDebug } from '../../lib/debug.js';
import { t } from '../../lib/i18n.js';
import {
  prepareDatabasePlugin,
  printDatabaseTarget,
  resolveDatabaseEnvironment,
} from './common.js';

export interface DbQueryOptions {
  file?: string;
  prod?: boolean;
  limit?: number;
  json?: boolean;
}

async function readSql(argument: string | undefined, file: string | undefined): Promise<string> {
  if (argument && file) throw new Error(t('db.queryMultipleInputs'));
  if (file) return (await readFile(file, 'utf-8')).trim();
  if (argument) return argument.trim();
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
  }
  throw new Error(t('db.queryMissing'));
}

function assertReadQuery(sql: string): void {
  const normalized = sql
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, '')
    .trimStart()
    .toLowerCase();
  if (!/^(select|with|explain|show)\b/.test(normalized)) {
    throw new Error(t('db.queryReadOnly'));
  }
}

function printQueryResult(raw: string, json: boolean): void {
  if (!json) {
    console.log(raw);
    return;
  }
  try {
    console.log(JSON.stringify(JSON.parse(raw), null, 2));
  } catch {
    console.log(raw);
  }
}

export async function dbQueryCommand(
  sqlArgument: string | undefined,
  options: DbQueryOptions = {}
): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }
  let querySpinner: ReturnType<typeof ora> | undefined;
  try {
    const sql = await readSql(sqlArgument, options.file);
    if (!sql) throw new Error(t('db.queryMissing'));
    if (options.prod) assertReadQuery(sql);
    await prepareDatabasePlugin(config.sessionId, { json: options.json });
    const target = await resolveDatabaseEnvironment(config.sessionId, options.prod ?? false);
    printDatabaseTarget(t(target.env === 'prod'
      ? 'db.targetProd'
      : target.isolated ? 'db.targetDebug' : 'db.targetCurrent'), options.json ?? false);
    querySpinner = ora(t('db.querying')).start();
    const result = await supabaseRunQuery({
      sessionId: config.sessionId,
      env: target.env,
      query: sql,
      limit: options.limit,
    });
    querySpinner.stop();
    printQueryResult(result, options.json ?? false);
  } catch (error) {
    if (querySpinner?.isSpinning) querySpinner.fail(t('db.queryFailed'));
    else logger.error(t('db.queryFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}
