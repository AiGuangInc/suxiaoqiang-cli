import ora from 'ora';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

export interface UpgradeOptions {
  /** 强更触发时必须至少安装到此版本；正常 sxq upgrade 不传。 */
  minimumVersion?: string;
}

export interface UpgradeResult {
  version: string;
  /** npm 全局安装完成后的 CLI 入口，用于重新执行原命令。 */
  cliEntryPath: string;
}

async function resolveGlobalCliEntry(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npm', ['root', '-g'], { shell: USE_SHELL });
    const entry = join(stdout.trim(), PKG_NAME, 'dist', 'index.js');
    if (existsSync(entry)) return entry;
    debug('global CLI entry missing after upgrade', entry);
  } catch (error) {
    debug('resolve global CLI entry failed', (error as Error).message);
  }
  return process.argv[1];
}

export async function upgradeCommand(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const spinner = ora(t('upgrade.checking')).start();

  let latest: string;
  try {
    const { stdout } = await execFileAsync('npm', ['view', PKG_NAME, 'version'], {
      shell: USE_SHELL,
    });
    latest = stdout.trim();
    debug('npm view version', { current: CURRENT, latest, minimum: options.minimumVersion });
  } catch (error) {
    spinner.fail(t('upgrade.checkFailed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }

  const target = options.minimumVersion && compareSemver(options.minimumVersion, latest) > 0
    ? options.minimumVersion
    : latest;

  if (compareSemver(target, CURRENT) <= 0) {
    spinner.succeed(t('upgrade.latest', { version: CURRENT }));
    return { version: CURRENT, cliEntryPath: process.argv[1] };
  }

  spinner.info(t('upgrade.found', { current: CURRENT, latest: target }));

  // 交给 npm 全局安装，继承 stdio 让用户看到进度
  const code = await new Promise<number>((resolve) => {
    const child = spawn('npm', ['install', '-g', `${PKG_NAME}@${target}`], {
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
  logger.success(t('upgrade.success', { latest: target }));
  logger.info(t('upgrade.updateSkill', { url: getSkillDocUrl() }));
  return { version: target, cliEntryPath: await resolveGlobalCliEntry() };
}
