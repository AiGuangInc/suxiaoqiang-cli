import chalk from 'chalk';
import { getLastUpdateCheckAt, setLastUpdateCheckAt } from './config.js';
import { compareSemver } from './semver.js';
import { debug } from './debug.js';
import { t } from './i18n.js';
import { name as PKG_NAME, version as CURRENT } from '../../package.json';

/** 每天最多检查一次 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 检查超时，避免拖慢用户命令 */
const TIMEOUT_MS = 3000;

/**
 * 每日首条命令时检查 npm 上是否有新版本，有则在 stderr 提示升级。
 * 任何失败都静默（更新提醒不该影响正常使用）。
 */
export async function maybeNotifyNewVersion(): Promise<void> {
  try {
    const last = getLastUpdateCheckAt();
    if (last && Date.now() - last < CHECK_INTERVAL_MS) return;
    // 先记录本次检查时间：网络不通时也不会每条命令都等 3 秒
    setLastUpdateCheckAt(Date.now());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;

    const json = (await res.json()) as { version?: string };
    debug('update check', { current: CURRENT, latest: json.version });
    if (json.version && compareSemver(json.version, CURRENT) > 0) {
      // 打到 stderr，不污染命令的 stdout 输出（如 config get 的脚本消费场景）
      console.error(chalk.yellow(t('upgrade.available', { current: CURRENT, latest: json.version })));
    }
  } catch (error) {
    debug('update check failed', (error as Error).message);
  }
}
