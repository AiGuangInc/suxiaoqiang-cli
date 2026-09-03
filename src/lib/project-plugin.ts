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

/** 插件能力命令的统一前置：必须已启用，并强制安装服务端最新私有 skill。 */
export async function requireEnabledPluginAndUpgradeSkills(
  sessionId: string,
  pluginId: string
): Promise<PluginSkillInstallResult> {
  const status = await queryProjectPluginStatus(sessionId, pluginId);
  if (status.state !== 'ENABLED') {
    throw new Error(t('plugin.requiredNotEnabled', { pluginId, state: status.state }));
  }
  return fetchAndInstallProjectPluginSkills(sessionId, pluginId);
}
