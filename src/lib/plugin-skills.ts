import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { getSxqDir } from './config.js';
import type { ProjectPluginSkillResult } from '../types/index.js';

const SKILL_ROOT = '.superun/skills';
const MANIFEST_FILE = 'plugin-skills.json';

interface InstalledSkill {
  version?: number;
  files: string[];
}

interface InstalledPlugin {
  installedAt: string;
  skills: Record<string, InstalledSkill>;
}

interface PluginSkillManifest {
  schemaVersion: 1;
  plugins: Record<string, InstalledPlugin>;
}

export interface PluginSkillInstallResult {
  pluginId: string;
  files: string[];
  skills: Array<{ skillId: string; version?: number }>;
}

function emptyManifest(): PluginSkillManifest {
  return { schemaVersion: 1, plugins: {} };
}

async function loadManifest(): Promise<PluginSkillManifest> {
  const path = join(getSxqDir(), MANIFEST_FILE);
  if (!existsSync(path)) return emptyManifest();
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as PluginSkillManifest;
    if (parsed?.schemaVersion === 1 && parsed.plugins && typeof parsed.plugins === 'object') {
      return parsed;
    }
  } catch {
    // 损坏的本地缓存不能授权删除任何旧文件；从空清单重新建立所有权。
  }
  return emptyManifest();
}

async function saveManifest(manifest: PluginSkillManifest): Promise<void> {
  const dir = getSxqDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, MANIFEST_FILE);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf-8');
  await rename(temporary, path);
}

function validateSkillId(skillId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(skillId) || skillId === '.' || skillId === '..') {
    throw new Error(`Unsafe skill id returned by server: ${skillId}`);
  }
}

function validateSkillFileName(name: string): string[] {
  if (!name || name.startsWith('/') || name.includes('\\')) {
    throw new Error(`Unsafe skill file path returned by server: ${name}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe skill file path returned by server: ${name}`);
  }
  return parts;
}

function targetPath(skillId: string, fileName: string): { absolute: string; relative: string } {
  validateSkillId(skillId);
  const parts = validateSkillFileName(fileName);
  const root = resolve(process.cwd(), SKILL_ROOT);
  const absolute = resolve(root, skillId, ...parts);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe skill file path returned by server: ${fileName}`);
  }
  return {
    absolute,
    relative: [SKILL_ROOT, skillId, ...parts].join('/'),
  };
}

function otherOwnedFiles(manifest: PluginSkillManifest, currentPluginId: string): Set<string> {
  const owned = new Set<string>();
  for (const [pluginId, plugin] of Object.entries(manifest.plugins)) {
    if (pluginId === currentPluginId) continue;
    for (const skill of Object.values(plugin.skills ?? {})) {
      for (const file of skill.files ?? []) owned.add(file);
    }
  }
  return owned;
}

/**
 * 强制安装/升级一个白名单插件的全部私有 skill 文件。
 * 远端内容是权威来源；只删除旧清单明确归属于该插件、且未被其他插件共享的文件。
 */
export async function installProjectPluginSkills(
  result: ProjectPluginSkillResult
): Promise<PluginSkillInstallResult> {
  const missing = result.missingSkillIds ?? [];
  if (missing.length > 0) {
    throw new Error(`Plugin skill content is incomplete: ${missing.join(', ')}`);
  }

  const planned: Array<{ absolute: string; relative: string; content: string }> = [];
  const nextSkills: Record<string, InstalledSkill> = {};
  for (const skill of result.skills ?? []) {
    validateSkillId(skill.skillId);
    const files: string[] = [];
    for (const [name, content] of Object.entries(skill.files ?? {})) {
      const target = targetPath(skill.skillId, name);
      planned.push({ ...target, content: String(content ?? '') });
      files.push(target.relative);
    }
    if (!files.some((file) => file.endsWith('/SKILL.md'))) {
      throw new Error(`Plugin skill ${skill.skillId} does not contain SKILL.md`);
    }
    nextSkills[skill.skillId] = { version: skill.version, files: files.sort() };
  }

  const manifest = await loadManifest();
  const previous = manifest.plugins[result.pluginId];
  const nextFiles = new Set(planned.map((file) => file.relative));
  const sharedFiles = otherOwnedFiles(manifest, result.pluginId);

  for (const file of planned) {
    await mkdir(dirname(file.absolute), { recursive: true });
    const temporary = `${file.absolute}.sxq-tmp`;
    await writeFile(temporary, file.content, 'utf-8');
    await rename(temporary, file.absolute);
  }

  for (const skill of Object.values(previous?.skills ?? {})) {
    for (const relativePath of skill.files ?? []) {
      if (nextFiles.has(relativePath) || sharedFiles.has(relativePath)) continue;
      const absolute = resolve(process.cwd(), ...relativePath.split('/'));
      const root = resolve(process.cwd(), SKILL_ROOT);
      if (absolute.startsWith(`${root}${sep}`) && existsSync(absolute)) {
        await unlink(absolute);
      }
    }
  }

  manifest.plugins[result.pluginId] = {
    installedAt: new Date().toISOString(),
    skills: nextSkills,
  };
  await saveManifest(manifest);

  return {
    pluginId: result.pluginId,
    files: [...nextFiles].sort(),
    skills: (result.skills ?? []).map((skill) => ({
      skillId: skill.skillId,
      version: skill.version,
    })),
  };
}
