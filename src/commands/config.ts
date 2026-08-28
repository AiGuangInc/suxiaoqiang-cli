import {
  getApiBase,
  setApiBase,
  deleteApiBase,
  getServiceChain,
  setServiceChain,
  deleteServiceChain,
  getPrivateToken,
  setPrivateToken,
  deletePrivateToken,
  getTsid,
  setTsid,
  deleteTsid,
  getLang,
  setLang,
  deleteLang,
  DEFAULT_PUSH_BRANCH,
  getProjectConfig,
  setProjectConfig,
} from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { t } from '../lib/i18n.js';

/** 配置项定义：get/set/unset 的统一入口 */
interface ConfigEntry {
  get: () => string | undefined | Promise<string | undefined>;
  set: (value: string) => void | Promise<void>;
  unset: () => void | Promise<void>;
  /** 是否在 list 和帮助中展示 */
  visible: boolean;
  /** 敏感项：list 不展示，set 成功提示不回显值 */
  secret?: boolean;
}

const entries: Record<string, ConfigEntry> = {
  host: {
    get: getApiBase,
    set: (value) => setApiBase(value.replace(/\/+$/, '')),
    unset: deleteApiBase,
    visible: true,
  },
  lang: {
    get: getLang,
    set: (value) => {
      if (value !== 'zh' && value !== 'en') {
        logger.error(t('config.invalidLang'));
        process.exit(1);
      }
      setLang(value);
    },
    unset: deleteLang,
    visible: true,
  },
  'push-branch': {
    get: async () => (await getProjectConfig())?.pushBranch || DEFAULT_PUSH_BRANCH,
    set: async (value) => {
      const branch = value.trim();
      if (!branch || /\s/.test(branch)) {
        logger.error(t('config.invalidPushBranch'));
        process.exit(1);
      }
      const config = await getProjectConfig();
      if (!config) {
        logger.error(t('common.notLinked'));
        process.exit(1);
      }
      await setProjectConfig({ ...config, pushBranch: branch });
    },
    unset: async () => {
      const config = await getProjectConfig();
      if (!config) {
        logger.error(t('common.notLinked'));
        process.exit(1);
      }
      const { pushBranch: _pushBranch, ...rest } = config;
      await setProjectConfig(rest);
    },
    visible: true,
  },
  'x-service-chain': {
    get: getServiceChain,
    set: setServiceChain,
    unset: deleteServiceChain,
    visible: false,
  },
  'private-token': {
    get: getPrivateToken,
    set: setPrivateToken,
    unset: deletePrivateToken,
    visible: false,
    secret: true,
  },
  tsid: {
    get: getTsid,
    set: setTsid,
    unset: deleteTsid,
    visible: false,
    secret: true,
  },
};

/** list/帮助中展示的配置项名 */
export function visibleConfigKeys(): string[] {
  return Object.keys(entries).filter((key) => entries[key].visible);
}

function resolveEntry(key: string): ConfigEntry {
  const entry = entries[key];
  if (!entry) {
    logger.error(t('config.unsupportedKey', { key, keys: visibleConfigKeys().join(', ') }));
    process.exit(1);
  }
  return entry;
}

export async function configSetCommand(key: string, value: string): Promise<void> {
  const entry = resolveEntry(key);
  await entry.set(value);
  const configured = await entry.get();
  logger.success(
    entry.secret ? t('config.setSecret', { key }) : t('config.set', { key, value: configured ?? '' })
  );
}

export async function configGetCommand(key: string): Promise<void> {
  const entry = resolveEntry(key);
  const value = await entry.get();
  if (value === undefined) {
    logger.dim(t('config.notSet', { key }));
  } else {
    console.log(value);
  }
}

export async function configUnsetCommand(key: string): Promise<void> {
  const entry = resolveEntry(key);
  await entry.unset();
  logger.success(t('config.cleared', { key }));
}

export async function configListCommand(): Promise<void> {
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.secret) continue;
    const value = await entry.get();
    // 隐藏项仅在已设置时展示
    if (!entry.visible && value === undefined) continue;
    console.log(`${key} = ${value ?? ''}`);
  }
}
