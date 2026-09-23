import Conf from 'conf';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, chmodSync } from 'node:fs';
import { validatePat } from './pat.js';
import { readCredential, writeCredential, deleteCredential, CredentialStoreError, CredentialStoreUnavailableError } from './credential-store.js';
import { t } from './i18n.js';
import type { GlobalConfig, ProjectConfig, UpdatePolicyCache } from '../types/index.js';

/** 项目本地元数据目录，config.json 存关联信息，后续附件版本等数据也存放于此 */
const SXQ_DIR = '.sxq';
const PROJECT_CONFIG_FILE = 'config.json';
export const DEFAULT_PUSH_BRANCH = 'main';

/** 全局配置存储 */
const globalConf = new Conf<GlobalConfig>({
  projectName: 'suxiaoqiang-cli',
  configFileMode: 0o600,
  defaults: {
    apiBase: 'https://www.superun.com',
  },
});

// ─── 全局配置 ─────────────────────────────────────────────

type CredentialStorage = 'keyring' | 'plaintext';
type SavedCredential = { storage: CredentialStorage; token?: string };
const credentials = new Map<string, Promise<SavedCredential>>();

function credentialKey(apiBase: string): string {
  return new URL(apiBase).href.replace(/\/+$/, '');
}

function writeLocalToken(apiBase: string, token?: string): void {
  try {
    const tokens = { ...globalConf.get('localTokens') };
    const key = credentialKey(apiBase);
    if (token === undefined) delete tokens[key];
    else tokens[key] = token;
    if (existsSync(globalConf.path)) chmodSync(globalConf.path, 0o600);
    const { token: _legacyToken, ...config } = globalConf.store;
    globalConf.store = { ...config, localTokens: tokens };
  } catch {
    throw new CredentialStoreError(t('credential.fileFailed'));
  }
}

function removePlaintextToken(apiBase: string): void {
  const key = credentialKey(apiBase);
  if (!globalConf.has('token') && !Object.hasOwn(globalConf.get('localTokens') ?? {}, key)) return;
  try {
    if (existsSync(globalConf.path)) chmodSync(globalConf.path, 0o600);
    const tokens = { ...globalConf.get('localTokens') };
    delete tokens[key];
    const { token: _legacyToken, ...config } = globalConf.store;
    globalConf.store = { ...config, localTokens: tokens };
  } catch {
    throw new CredentialStoreError(t('credential.fileFailed'));
  }
}

function savedCredential(apiBase: string): Promise<SavedCredential> {
  let selected = credentials.get(apiBase);
  if (!selected) {
    selected = (async (): Promise<SavedCredential> => {
      let token: string | undefined;
      try {
        // A missing credential is not an unavailable store: ask the user to log in.
        token = await readCredential(apiBase);
      } catch (error) {
        if (!(error instanceof CredentialStoreUnavailableError)) throw error;
        console.error(t('credential.plaintextFallback'));
        return { storage: 'plaintext', token: globalConf.get('localTokens')?.[credentialKey(apiBase)] };
      }
      // Discard plaintext once the system store is usable; never import it into the keyring.
      // A cleanup error must not select plaintext storage again.
      removePlaintextToken(apiBase);
      return { storage: 'keyring', token };
    })().catch((error) => {
      credentials.delete(apiBase);
      throw error;
    });
    credentials.set(apiBase, selected);
  }
  return selected;
}

export async function getToken(): Promise<string | undefined> {
  if (process.env.SUPERUN_PAT !== undefined) return validatePat(process.env.SUPERUN_PAT);
  return (await savedCredential(getApiBase())).token;
}

export async function setToken(token: string): Promise<CredentialStorage> {
  const apiBase = getApiBase();
  const { storage } = await savedCredential(apiBase);
  if (storage === 'keyring') await writeCredential(apiBase, token);
  else writeLocalToken(apiBase, token);
  credentials.set(apiBase, Promise.resolve({ storage, token }));
  return storage;
}

export async function clearToken(): Promise<CredentialStorage> {
  const apiBase = getApiBase();
  const { storage } = await savedCredential(apiBase);
  if (storage === 'keyring') await deleteCredential(apiBase);
  else writeLocalToken(apiBase);
  credentials.set(apiBase, Promise.resolve({ storage }));
  return storage;
}

export function getApiBase(): string {
  return globalConf.get('apiBase');
}

export function setApiBase(url: string): void {
  credentials.clear();
  globalConf.set('apiBase', url);
}

export function deleteApiBase(): void {
  credentials.clear();
  globalConf.delete('apiBase');
}

export function getServiceChain(): string | undefined {
  return globalConf.get('serviceChain');
}

export function setServiceChain(value: string): void {
  globalConf.set('serviceChain', value);
}

export function deleteServiceChain(): void {
  globalConf.delete('serviceChain');
}

/** 国内预发代理 PAT。环境变量优先，避免必须把敏感值落盘。 */
export function getPrivateToken(): string | undefined {
  return process.env.PRIVATE_TOKEN?.trim() || globalConf.get('privateToken');
}

export function setPrivateToken(value: string): void {
  globalConf.set('privateToken', value.trim());
}

export function deletePrivateToken(): void {
  globalConf.delete('privateToken');
}

export function getLang(): string | undefined {
  return globalConf.get('lang');
}

export function setLang(value: string): void {
  globalConf.set('lang', value);
}

export function deleteLang(): void {
  globalConf.delete('lang');
}

export function getUpdatePolicyCache(): UpdatePolicyCache | undefined {
  return globalConf.get('updatePolicyCache');
}

export function setUpdatePolicyCache(value: UpdatePolicyCache): void {
  globalConf.set('updatePolicyCache', value);
}

export function getTsid(): string | undefined {
  return globalConf.get('tsid');
}

export function setTsid(value: string): void {
  globalConf.set('tsid', value);
}

export function deleteTsid(): void {
  globalConf.delete('tsid');
}

// ─── 项目本地配置 ─────────────────────────────────────────

export function getSxqDir(cwd: string = process.cwd()): string {
  return join(cwd, SXQ_DIR);
}

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(getSxqDir(cwd), PROJECT_CONFIG_FILE);
}

export async function getProjectConfig(cwd: string = process.cwd()): Promise<ProjectConfig | null> {
  const configPath = getProjectConfigPath(cwd);
  if (!existsSync(configPath)) {
    return null;
  }
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content) as ProjectConfig;
}

export function getProjectPushBranch(config: ProjectConfig): string {
  return config.pushBranch?.trim() || DEFAULT_PUSH_BRANCH;
}

export async function setProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): Promise<void> {
  await mkdir(getSxqDir(cwd), { recursive: true });
  const configPath = getProjectConfigPath(cwd);
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function isProjectLinked(cwd: string = process.cwd()): boolean {
  return existsSync(getProjectConfigPath(cwd));
}
