import ora from 'ora';
import { queryIsolatedDebugStatus } from '../../lib/api.js';
import {
  requireEnabledPluginAndUpgradeSkills,
  SUPERUN_CLOUD_PLUGIN_ID,
} from '../../lib/project-plugin.js';
import { logger } from '../../lib/logger.js';
import { t } from '../../lib/i18n.js';

/** 所有数据库能力统一检查 Cloud 插件，并强制覆盖为服务端最新私有 skill。 */
export async function prepareDatabasePlugin(
  sessionId: string,
  options: { json?: boolean } = {}
): Promise<void> {
  const spinner = ora(t('db.preparingPlugin')).start();
  try {
    const installed = await requireEnabledPluginAndUpgradeSkills(
      sessionId,
      SUPERUN_CLOUD_PLUGIN_ID
    );
    spinner.succeed(t('db.pluginReady', { count: installed.files.length }));
    if (!options.json) {
      for (const file of installed.files) logger.dim(`  ${file}`);
    }
  } catch (error) {
    spinner.fail(t('db.pluginNotReady'));
    throw error;
  }
}

/** JSON 模式保持 stdout 只有数据；进度/目标提示写 stderr。 */
export function printDatabaseTarget(message: string, json: boolean): void {
  if (json) console.error(message);
  else logger.info(message);
}

/** --prod 只在已开启独立部署时成立；不允许静默回落到当前唯一数据库。 */
export async function resolveDatabaseEnvironment(
  sessionId: string,
  prod: boolean
): Promise<{ env: 'debug' | 'prod'; isolated: boolean }> {
  const status = await queryIsolatedDebugStatus(sessionId);
  const isolated = status.enabled === true;
  if (prod && !isolated) throw new Error(t('db.prodRequiresIsolation'));
  return { env: prod ? 'prod' : 'debug', isolated };
}

export function positiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(t('db.invalidPositiveInteger', { option: optionName, value }));
  }
  if (parsed > 1000) {
    throw new Error(t('db.limitTooLarge', { value }));
  }
  return parsed;
}
