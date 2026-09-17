import chalk from 'chalk';
import {
  getUpdatePolicyCache,
  setUpdatePolicyCache,
} from './config.js';
import { compareSemver } from './semver.js';
import { debug } from './debug.js';
import { t } from './i18n.js';
import { name as PKG_NAME, version as CURRENT } from '../../package.json';
import type { UpdatePolicyCache } from '../types/index.js';

/** 检查超时，避免拖慢用户命令 */
const TIMEOUT_MS = 3000;
const DIST_TAGS_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(PKG_NAME)}/dist-tags`;

interface RegistryDistTags {
  latest?: unknown;
  required?: unknown;
}

interface LoadedUpdatePolicy {
  policy: UpdatePolicyCache;
  /** 本次命令是否成功从 registry 刷新了策略。 */
  refreshed: boolean;
}

function exactSemver(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : undefined;
}

function isSameLocalDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function cachedPolicyAfterFailedRefresh(
  cache: UpdatePolicyCache | undefined,
  checkedAt: number
): UpdatePolicyCache {
  return {
    checkedAt,
    latestVersion: cache?.latestVersion,
    requiredVersion: cache?.requiredVersion,
  };
}

async function loadUpdatePolicy(): Promise<LoadedUpdatePolicy> {
  const cached = getUpdatePolicyCache();
  const now = Date.now();
  if (cached && isSameLocalDay(now, cached.checkedAt)) {
    return { policy: cached, refreshed: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DIST_TAGS_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`);

    const tags = (await res.json()) as RegistryDistTags;
    const policy: UpdatePolicyCache = {
      checkedAt: now,
      latestVersion: exactSemver(tags.latest),
      requiredVersion: exactSemver(tags.required),
    };
    setUpdatePolicyCache(policy);
    debug('update policy', { current: CURRENT, ...policy });
    return { policy, refreshed: true };
  } catch (error) {
    // npm 暂时不可用时不能让所有 CLI 命令一起瘫痪；但已见过的强更下限必须继续生效。
    const policy = cachedPolicyAfterFailedRefresh(cached, now);
    setUpdatePolicyCache(policy);
    debug('update policy refresh failed', (error as Error).message);
    return { policy, refreshed: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 每天第一次执行命令时读取 npm dist-tags：
 * - 当前版本低于 required 时返回最低版本，由入口自动升级并重跑原命令；
 * - 仅低于 latest 时提示一次，不影响命令执行。
 *
 * npm 暂时不可用时沿用本地缓存；从未成功读取过策略时 fail-open，避免 registry
 * 故障误伤所有用户。
 */
export async function checkUpdatePolicy(): Promise<string | undefined> {
  const { policy, refreshed } = await loadUpdatePolicy();

  if (policy.requiredVersion && compareSemver(policy.requiredVersion, CURRENT) > 0) {
    return policy.requiredVersion;
  }

  if (refreshed && policy.latestVersion && compareSemver(policy.latestVersion, CURRENT) > 0) {
    // 打到 stderr，不污染命令的 stdout 输出（如 config get 的脚本消费场景）。
    console.error(chalk.yellow(t('upgrade.available', {
      current: CURRENT,
      latest: policy.latestVersion,
    })));
  }

  return undefined;
}
