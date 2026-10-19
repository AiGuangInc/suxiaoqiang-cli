import { queryProjectPluginSkill, queryProjectPluginStatus } from './api.js';
import { installProjectPluginSkills, type PluginSkillInstallResult } from './plugin-skills.js';
import { t } from './i18n.js';

export const SUPERUN_CLOUD_PLUGIN_ID = 'SUPERUN_CLOUD';

export async function fetchAndInstallProjectPluginSkills(
  sessionId: string,
  pluginId: string
): Promise<PluginSkillInstallResult> {
  const result = await queryProjectPluginSkill(sessionId, pluginId);
  return installProjectPluginSkills(result);
}

/** 插件能力命令的统一前置：等待 Cloud 自动恢复，检查启用状态并升级私有 skill。 */
export async function requireEnabledPluginAndUpgradeSkills(
  sessionId: string,
  pluginId: string
): Promise<PluginSkillInstallResult> {
  let status = await queryProjectPluginStatus(sessionId, pluginId);
  // Cloud 的暂停是闲置回收；服务端收到真实访问后会启动恢复，等待状态机完成。
  const deadline = Date.now() + 25 * 60 * 1000;
  while (pluginId === SUPERUN_CLOUD_PLUGIN_ID
    && ['ENABLING', 'RESTORING', 'PAUSING'].includes(status.state)) {
    if (Date.now() >= deadline) throw new Error(t('db.cloudWaitTimeout', { state: status.state }));
    await new Promise((resolve) => setTimeout(resolve, 5000));
    status = await queryProjectPluginStatus(sessionId, pluginId);
  }
  if (pluginId === SUPERUN_CLOUD_PLUGIN_ID && status.state === 'PAUSED') {
    throw new Error(t('db.cloudRestoreRejected'));
  }
  if (status.state !== 'ENABLED') {
    throw new Error(t('plugin.requiredNotEnabled', { pluginId, state: status.state }));
  }
  return fetchAndInstallProjectPluginSkills(sessionId, pluginId);
}
