import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getSxqDir } from './config.js';
import type { AttachmentManifest, AttachmentMeta, AttachmentTree, SessionAttachment } from '../types/index.js';

const MANIFEST_FILE = 'attachments.json';

export function getManifestPath(cwd: string = process.cwd()): string {
  return join(getSxqDir(cwd), MANIFEST_FILE);
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** 判断树节点是否为附件叶子（含 rowKey 的即视为文件） */
export function isAttachmentMeta(node: AttachmentTree | AttachmentMeta): node is AttachmentMeta {
  return typeof (node as AttachmentMeta).rowKey === 'string';
}

/**
 * 将附件列表按路径组装为目录树。
 * 有内容的附件计算 sha256；无内容但 rowKey 与基线一致的沿用基线 hash。
 */
export function buildAttachmentTree(
  attachments: SessionAttachment[],
  baseline?: Map<string, AttachmentMeta>
): AttachmentTree {
  const tree: AttachmentTree = {};

  for (const file of attachments) {
    if (!file.name || !file.rowKey) continue;

    const parts = file.name.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;

    let node = tree;
    for (const dir of parts) {
      const existing = node[dir];
      if (existing && !isAttachmentMeta(existing)) {
        node = existing;
      } else {
        const child: AttachmentTree = {};
        node[dir] = child;
        node = child;
      }
    }

    const meta: AttachmentMeta = { rowKey: file.rowKey };
    if (file.content !== undefined && file.content !== null) {
      meta.hash = hashContent(file.content);
    } else {
      const base = baseline?.get(file.name);
      if (base && base.rowKey === file.rowKey && base.hash) {
        meta.hash = base.hash;
      }
    }
    node[fileName] = meta;
  }

  return tree;
}

/** 将附件树摊平为 路径 → 元信息 的映射，便于 diff */
export function flattenTree(tree: AttachmentTree, prefix = ''): Map<string, AttachmentMeta> {
  const map = new Map<string, AttachmentMeta>();
  for (const [name, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (isAttachmentMeta(node)) {
      map.set(path, node);
    } else {
      for (const [childPath, meta] of flattenTree(node, path)) {
        map.set(childPath, meta);
      }
    }
  }
  return map;
}

export async function saveManifest(manifest: AttachmentManifest, cwd: string = process.cwd()): Promise<void> {
  await mkdir(getSxqDir(cwd), { recursive: true });
  await writeFile(getManifestPath(cwd), JSON.stringify(manifest, null, 2), 'utf-8');
}

export async function loadManifest(cwd: string = process.cwd()): Promise<AttachmentManifest | null> {
  const path = getManifestPath(cwd);
  if (!existsSync(path)) {
    return null;
  }
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as AttachmentManifest;
}
