import {
  getApiBase,
  setApiBase,
  deleteApiBase,
  getServiceChain,
  setServiceChain,
  deleteServiceChain,
  getTsid,
  setTsid,
  deleteTsid,
  getLang,
  setLang,
  deleteLang,
} from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { t } from '../lib/i18n.js';

/** 配置项定义：get/set/unset 的统一入口 */
interface ConfigEntry {
  get: () => string | undefined;
  set: (value: string) => void;
  unset: () => void;
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
  'x-service-chain': {
    get: getServiceChain,
    set: setServiceChain,
    unset: deleteServiceChain,
    visible: false,
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

export function configSetCommand(key: string, value: string): void {
  const entry = resolveEntry(key);
  entry.set(value);
  logger.success(
    entry.secret ? t('config.setSecret', { key }) : t('config.set', { key, value: entry.get() ?? '' })
  );
}

export function configGetCommand(key: string): void {
  const entry = resolveEntry(key);
  const value = entry.get();
  if (value === undefined) {
    logger.dim(t('config.notSet', { key }));
  } else {
    console.log(value);
  }
}

export function configUnsetCommand(key: string): void {
  const entry = resolveEntry(key);
  entry.unset();
  logger.success(t('config.cleared', { key }));
}

export function configListCommand(): void {
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.secret) continue;
    const value = entry.get();
    // 隐藏项仅在已设置时展示
    if (!entry.visible && value === undefined) continue;
    console.log(`${key} = ${value ?? ''}`);
  }
}
