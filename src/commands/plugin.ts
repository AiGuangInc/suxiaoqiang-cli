import ora from 'ora';
import { getProjectConfig } from '../lib/config.js';
import {
  disableProjectPlugin,
  enableProjectPlugin,
  listProjectPlugins,
  queryProjectPluginStatus,
} from '../lib/api.js';
import { fetchAndInstallProjectPluginSkills } from '../lib/project-plugin.js';
import { logger } from '../lib/logger.js';
import { confirm } from '../lib/prompt.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';
import type { ProjectPlugin, ProjectPluginState } from '../types/index.js';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

async function linkedSessionId(): Promise<string> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }
  return config.sessionId;
}

function printPlugin(plugin: ProjectPlugin): void {
  logger.info(`${plugin.pluginId}  ${plugin.state}`);
  logger.dim(`  ${plugin.displayName}${plugin.oneliner ? ` — ${plugin.oneliner}` : ''}`);
  if (plugin.dependencies?.length) {
    logger.dim(`  ${t('plugin.dependencies', { values: plugin.dependencies.join(', ') })}`);
  }
  if (plugin.skillIds?.length) {
    logger.dim(`  ${t('plugin.skills', { values: plugin.skillIds.join(', ') })}`);
  }
}

export async function pluginListCommand(options: { json?: boolean } = {}): Promise<void> {
  const sessionId = await linkedSessionId();
  const spinner = ora(t('plugin.listing')).start();
  try {
    const result = await listProjectPlugins(sessionId);
    spinner.stop();
    if (options.json) {
      console.log(JSON.stringify(result.plugins ?? [], null, 2));
      return;
    }
    for (const plugin of result.plugins ?? []) printPlugin(plugin);
    logger.info(t('plugin.installHint'));
  } catch (error) {
    spinner.fail(t('plugin.listFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}

export async function pluginStatusCommand(
  pluginId: string | undefined,
  options: { json?: boolean } = {}
): Promise<void> {
  if (!pluginId) {
    await pluginListCommand(options);
    return;
  }
  const sessionId = await linkedSessionId();
  const spinner = ora(t('plugin.queryingStatus')).start();
  try {
    const result = await queryProjectPluginStatus(sessionId, pluginId);
    spinner.stop();
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else logger.info(`${result.pluginId}  ${result.state}`);
  } catch (error) {
    spinner.fail(t('plugin.statusFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}

async function waitForState(
  sessionId: string,
  pluginId: string,
  expected: 'ENABLED' | 'DISABLED',
  initial: ProjectPluginState,
  update: (state: ProjectPluginState) => void
): Promise<ProjectPluginState> {
  const startedAt = Date.now();
  let state = initial;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    if (expected === 'ENABLED' && state === 'ENABLED') return state;
    if (
      expected === 'DISABLED' &&
      ['DISABLED', 'PAUSED', 'NOT_ENABLED', 'UNKNOWN'].includes(state)
    ) return state;
    if (
      expected === 'DISABLED' &&
      !['DISABLING', 'PAUSING', 'DISABLED', 'PAUSED', 'NOT_ENABLED', 'UNKNOWN'].includes(state)
    ) {
      throw new Error(t('plugin.disableTerminalFailure', { pluginId, state }));
    }
    if (
      expected === 'ENABLED' &&
      !['ENABLING', 'RESTORING', 'ENABLED'].includes(state)
    ) {
      throw new Error(t('plugin.enableTerminalFailure', { pluginId, state }));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    state = (await queryProjectPluginStatus(sessionId, pluginId)).state;
    update(state);
  }
  throw new Error(t('plugin.waitTimeout', { pluginId, state }));
}

function printSkillInstall(files: string[]): void {
  if (files.length === 0) {
    logger.info(t('plugin.noSkills'));
    return;
  }
  logger.success(t('plugin.skillUpgraded'));
  for (const file of files) logger.dim(`  ${file}`);
}

export async function pluginSkillCommand(pluginId: string): Promise<void> {
  const sessionId = await linkedSessionId();
  const spinner = ora(t('plugin.installingSkill')).start();
  try {
    const installed = await fetchAndInstallProjectPluginSkills(sessionId, pluginId);
    spinner.stop();
    printSkillInstall(installed.files);
  } catch (error) {
    spinner.fail(t('plugin.skillFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}

export async function pluginEnableCommand(pluginId: string): Promise<void> {
  const sessionId = await linkedSessionId();
  const spinner = ora(t('plugin.enabling', { pluginId })).start();
  try {
    const result = await enableProjectPlugin(sessionId, pluginId);
    debug('enableProjectPlugin', result);
    const state = await waitForState(sessionId, result.pluginId, 'ENABLED', result.state, (current) => {
      spinner.text = t('plugin.waiting', { pluginId: result.pluginId, state: current });
    });
    spinner.text = t('plugin.installingSkill');
    const installed = await fetchAndInstallProjectPluginSkills(sessionId, result.pluginId);
    spinner.succeed(t('plugin.enabled', { pluginId: result.pluginId, state }));
    printSkillInstall(installed.files);
  } catch (error) {
    spinner.fail(t('plugin.enableFailed', { pluginId }));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}

export async function pluginDisableCommand(pluginId: string): Promise<void> {
  const sessionId = await linkedSessionId();
  const accepted = await confirm(
    t('plugin.disableConfirm', { pluginId }),
    t('plugin.disableHint')
  );
  if (!accepted) {
    logger.info(t('plugin.disableCancelled'));
    return;
  }
  const spinner = ora(t('plugin.disabling', { pluginId })).start();
  try {
    const result = await disableProjectPlugin(sessionId, pluginId);
    debug('disableProjectPlugin', result);
    const state = await waitForState(sessionId, result.pluginId, 'DISABLED', result.state, (current) => {
      spinner.text = t('plugin.waiting', { pluginId: result.pluginId, state: current });
    });
    spinner.succeed(t('plugin.disabled', { pluginId: result.pluginId, state }));
  } catch (error) {
    spinner.fail(t('plugin.disableFailed', { pluginId }));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}
