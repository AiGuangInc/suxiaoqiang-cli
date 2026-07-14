import ora, { type Ora } from 'ora';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectConfig } from '../lib/config.js';
import { canDownloadCode, querySessionAttachments, queryAttachment } from '../lib/api.js';
import { buildAttachmentTree, flattenTree, loadManifest, saveManifest, getManifestPath, hashContent } from '../lib/manifest.js';
import { threeWayMerge } from '../lib/merge.js';
import { logger } from '../lib/logger.js';
import { debug, isDebug } from '../lib/debug.js';
import { loadSyncIgnore, type SyncIgnore } from '../lib/ignore.js';
import { t } from '../lib/i18n.js';
import type { SessionAttachment } from '../types/index.js';

/** 本地元数据目录不接受远程写入 */
function isProtectedPath(name: string): boolean {
  return name === '.sxq' || name.startsWith('.sxq/');
}

/** 防路径穿越：绝对路径或含 .. 段的远端文件名一律拒绝写盘 */
function isUnsafePath(name: string): boolean {
  return name.startsWith('/') || name.split('/').includes('..');
}

async function writeLocal(name: string, content: string): Promise<void> {
  const filePath = join(process.cwd(), name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

async function readLocal(name: string): Promise<string | null> {
  const filePath = join(process.cwd(), name);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, 'utf-8');
}

/** pull 执行结果，push 前置拉取用于判断是否可继续 */
export interface PullResult {
  conflicted: string[];
}

/** 全量拉取：查询时携带内容，写入全部文件（.gitignore 命中的不写盘、不进清单） */
async function fullPull(sessionId: string, spinner: Ora, ig: SyncIgnore): Promise<PullResult> {
  const attachments = await querySessionAttachments({ sessionId, withContent: true });
  debug('Attachments received', attachments?.length ?? 0);

  if (!attachments || attachments.length === 0) {
    spinner.info(t('pull.noRemoteFiles'));
    return { conflicted: [] };
  }

  spinner.text = t('pull.writing', { count: attachments.length });

  let written = 0;
  let skipped = 0;
  const synced: SessionAttachment[] = [];
  for (const file of attachments) {
    if (!file.name || isProtectedPath(file.name) || isUnsafePath(file.name) || ig.ignores(file.name)) {
      skipped++;
      continue;
    }
    // 内容为空的（如二进制）不写盘，但保留在清单中避免下次增量 pull 误判为新文件
    synced.push(file);
    if (file.content === undefined || file.content === null) {
      skipped++;
      continue;
    }
    await writeLocal(file.name, file.content);
    written++;
  }

  await saveManifest({
    sessionId,
    pulledAt: new Date().toISOString(),
    tree: buildAttachmentTree(synced),
    conflicts: [],
  });
  debug('Manifest saved', getManifestPath());

  spinner.succeed(t('pull.fullDone', { written, skipped }));
  return { conflicted: [] };
}

/**
 * 增量拉取：先查列表（不带内容），diff 出 rowKey 变化的文件后逐个拉取。
 * 本地有改动的文件与远端做三方合并（基线按清单旧 rowKey 现拉），冲突写标记。
 */
async function incrementalPull(sessionId: string, spinner: Ora, ig: SyncIgnore): Promise<PullResult> {
  const manifest = await loadManifest();
  if (!manifest) throw new Error(t('pull.manifestMissing'));

  // .gitignore 命中的远端文件不参与同步（不写盘、不进清单、不报"远程已删除"）
  const list = ((await querySessionAttachments({ sessionId, withContent: false })) ?? []).filter(
    (f) => !f.name || !ig.ignores(f.name)
  );
  debug('Attachments received', list.length);

  const baseline = flattenTree(manifest.tree);
  const changed = list.filter(
    (f) =>
      f.name &&
      f.rowKey &&
      !isProtectedPath(f.name) &&
      !isUnsafePath(f.name) &&
      baseline.get(f.name)?.rowKey !== f.rowKey
  );
  const removed = [...baseline.keys()].filter(
    (path) => !ig.ignores(path) && !list.some((f) => f.name === path)
  );

  debug('Diff result', { remote: list.length, changed: changed.map((f) => f.name), removed });

  let updated = 0;
  const restored: string[] = [];
  const autoMerged: string[] = [];
  const conflicted: string[] = [];
  // 上次 pull 遗留的冲突文件；本次被干净覆盖/合并的从中移除，新冲突加入
  const conflictSet = new Set(manifest.conflicts ?? []);

  for (let i = 0; i < changed.length; i++) {
    const file = changed[i];
    const baseMeta = baseline.get(file.name);
    spinner.text = t('pull.processing', { current: i + 1, total: changed.length, name: file.name });

    const remoteContent = await queryAttachment({ sessionId, rowKey: file.rowKey, name: file.name });
    // 清单以远端内容为基线，本地未推送的改动天然表现为 local ≠ base
    file.content = remoteContent;

    const localContent = await readLocal(file.name);

    if (localContent === null) {
      // 本地不存在：远端新文件直接写入；基线里有说明本地删除过，恢复并提示
      await writeLocal(file.name, remoteContent);
      updated++;
      conflictSet.delete(file.name);
      if (baseMeta) restored.push(file.name);
      continue;
    }

    if (localContent === remoteContent) {
      conflictSet.delete(file.name);
      continue; // 内容已一致，只需更新清单
    }

    const localChanged = baseMeta ? hashContent(localContent) !== baseMeta.hash : true;
    if (!localChanged) {
      // 本地未动，安全覆盖
      await writeLocal(file.name, remoteContent);
      updated++;
      conflictSet.delete(file.name);
      continue;
    }

    // 双方都改了 → 拉基线做三方合并
    let base: string | null = null;
    if (baseMeta?.rowKey) {
      try {
        base = await queryAttachment({ sessionId, rowKey: baseMeta.rowKey, name: file.name });
        if (base === '') {
          // 服务端对不存在的 rowKey 返回空串（不报错），按空基线合并：相同行自动合，差异区域出冲突
          debug('Base is empty (history version unavailable?)', { name: file.name, baseRowKey: baseMeta.rowKey });
        }
      } catch (error) {
        debug('Base fetch failed, fallback to 2-way', { name: file.name, error: (error as Error).message });
      }
    }

    const merged = threeWayMerge(localContent, base, remoteContent);
    await writeLocal(file.name, merged.content);
    (merged.conflicted ? conflicted : autoMerged).push(file.name);
    if (merged.conflicted) {
      conflictSet.add(file.name);
    } else {
      conflictSet.delete(file.name);
    }
  }

  for (const path of removed) conflictSet.delete(path);

  await saveManifest({
    sessionId,
    pulledAt: new Date().toISOString(),
    tree: buildAttachmentTree(list, baseline),
    conflicts: [...conflictSet],
  });
  debug('Manifest saved', getManifestPath());

  if (changed.length === 0) {
    spinner.succeed(t('pull.noChanges'));
  } else if (conflicted.length > 0) {
    spinner.warn(t('pull.doneWithConflicts', { updated, merged: autoMerged.length, conflicted: conflicted.length }));
  } else {
    spinner.succeed(t('pull.incrementalDone', { updated, merged: autoMerged.length }));
  }

  if (restored.length > 0) {
    logger.warn(t('pull.restoredHeader'));
    for (const name of restored) logger.dim(`  ${name}`);
  }
  if (autoMerged.length > 0) {
    logger.info(t('pull.autoMergedHeader'));
    for (const name of autoMerged) logger.dim(`  ${name}`);
  }
  if (conflicted.length > 0) {
    logger.warn(t('pull.conflictHeader'));
    for (const name of conflicted) logger.dim(`  ${name}`);
  }
  if (removed.length > 0) {
    logger.warn(t('pull.removedHeader', { count: removed.length }));
    for (const path of removed) logger.dim(`  ${path}`);
  }

  return { conflicted };
}

/** 执行一次拉取（自动判断全量/增量），供 pull 命令和 push 前置检查复用 */
export async function runPull(sessionId: string, spinner: Ora): Promise<PullResult> {
  spinner.text = t('pull.checkingDownloadPermission');
  const downloadable = await canDownloadCode({ sessionId });
  debug('canDownloadCode', downloadable);
  if (!downloadable) {
    throw new Error(t('common.codeDownloadDenied'));
  }

  const manifest = await loadManifest();
  // 清单不存在或 session 不匹配（重新 link 过）时走全量
  const isFull = !manifest || manifest.sessionId !== sessionId;
  debug('Pull session', sessionId);
  debug('Pull mode', isFull ? 'full' : 'incremental');

  const ig = await loadSyncIgnore();
  if (isFull) {
    spinner.text = t('pull.fullPulling');
    return fullPull(sessionId, spinner, ig);
  }
  spinner.text = t('pull.listing');
  return incrementalPull(sessionId, spinner, ig);
}

export async function pullCommand(): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const spinner = ora(t('pull.pulling')).start();

  try {
    await runPull(config.sessionId, spinner);
  } catch (error) {
    spinner.fail(t('pull.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
