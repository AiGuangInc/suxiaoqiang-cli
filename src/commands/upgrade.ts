import ora from 'ora';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';
import { compareSemver } from '../lib/semver.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';
import { getApiBase } from '../lib/config.js';
import { name as PKG_NAME, version as CURRENT } from '../../package.json';

const execFileAsync = promisify(execFile);
/** Windows 下 npm 是 npm.cmd，需经 shell 解析 */
const USE_SHELL = process.platform === 'win32';
const MAIN_SKILL_DOC_URL = 'https://docs.superun.com/superun/cli/suxiaoqiang-cli.md';
const INTERNATIONAL_SKILL_DOC_URL = 'https://docs.superun.ai/superun/cli/suxiaoqiang-cli.md';

function getSkillDocUrl(): string {
  try {
    const hostname = new URL(getApiBase()).hostname.toLowerCase();
    if (hostname === 'superun.ai' || hostname.endsWith('.superun.ai')) {
      return INTERNATIONAL_SKILL_DOC_URL;
    }
  } catch {
    // host 配置无法解析时仍按默认主站提示，不影响 CLI 升级结果。
  }
  return MAIN_SKILL_DOC_URL;
}

export async function upgradeCommand(): Promise<void> {
  const spinner = ora(t('upgrade.checking')).start();

  let latest: string;
  try {
    const { stdout } = await execFileAsync('npm', ['view', PKG_NAME, 'version'], {
      shell: USE_SHELL,
    });
    latest = stdout.trim();
    debug('npm view version', { current: CURRENT, latest });
  } catch (error) {
    spinner.fail(t('upgrade.checkFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }

  if (compareSemver(latest, CURRENT) <= 0) {
    spinner.succeed(t('upgrade.latest', { version: CURRENT }));
    return;
  }

  spinner.info(t('upgrade.found', { current: CURRENT, latest }));

  // 交给 npm 全局安装，继承 stdio 让用户看到进度
  const code = await new Promise<number>((resolve) => {
    const child = spawn('npm', ['install', '-g', `${PKG_NAME}@${latest}`], {
      stdio: 'inherit',
      shell: USE_SHELL,
    });
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
    child.on('error', () => resolve(1));
  });

  if (code !== 0) {
    logger.error(t('upgrade.failed', { pkg: PKG_NAME }));
    process.exit(1);
  }
  logger.success(t('upgrade.success', { latest }));
  logger.info(t('upgrade.updateSkill', { url: getSkillDocUrl() }));
}
