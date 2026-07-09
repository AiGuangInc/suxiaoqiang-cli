import Conf from 'conf';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { GlobalConfig, ProjectConfig } from '../types/index.js';

/** 项目本地元数据目录，config.json 存关联信息，后续附件版本等数据也存放于此 */
const SXQ_DIR = '.sxq';
const PROJECT_CONFIG_FILE = 'config.json';

/** 全局配置存储 */
const globalConf = new Conf<GlobalConfig>({
  projectName: 'suxiaoqiang-cli',
  defaults: {
    apiBase: 'https://www.superun.com',
  },
});

// ─── 全局配置 ─────────────────────────────────────────────

export function getToken(): string | undefined {
  return globalConf.get('token');
}

export function setToken(token: string): void {
  globalConf.set('token', token);
}

export function clearToken(): void {
  globalConf.delete('token');
}

export function getApiBase(): string {
  return globalConf.get('apiBase');
}

export function setApiBase(url: string): void {
  globalConf.set('apiBase', url);
}

export function deleteApiBase(): void {
  // 删除后 get 会回落到 defaults 中的默认 host
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

export function getLang(): string | undefined {
  return globalConf.get('lang');
}

export function setLang(value: string): void {
  globalConf.set('lang', value);
}

export function deleteLang(): void {
  globalConf.delete('lang');
}

export function getLastUpdateCheckAt(): number | undefined {
  return globalConf.get('lastUpdateCheckAt');
}

export function setLastUpdateCheckAt(value: number): void {
  globalConf.set('lastUpdateCheckAt', value);
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

export async function setProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): Promise<void> {
  await mkdir(getSxqDir(cwd), { recursive: true });
  const configPath = getProjectConfigPath(cwd);
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function isProjectLinked(cwd: string = process.cwd()): boolean {
  return existsSync(getProjectConfigPath(cwd));
}
