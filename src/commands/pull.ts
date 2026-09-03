import ora, { type Ora } from 'ora';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectConfig, getProjectPushBranch } from '../lib/config.js';
import { canSyncCode, queryAttachment, querySessionAttachmentsForSync } from '../lib/api.js';
import {
  buildAttachmentTree,
  flattenTree,
  getManifestPath,
  hashContent,
  loadManifest,
  saveManifest,
} from '../lib/manifest.js';
import { threeWayMerge } from '../lib/merge.js';
import { logger } from '../lib/logger.js';
import { debug, isDebug } from '../lib/debug.js';
import { loadSyncIgnore, type SyncIgnore } from '../lib/ignore.js';
import { t } from '../lib/i18n.js';
import type {
  AttachmentMeta,
  SessionAttachment,
  SyncConflict,
  SyncConflictType,
} from '../types/index.js';
import { validateGitSync } from '../lib/git.js';

/** 本地工具元数据和 Git 元数据不接受远程写入。 */
function isProtectedPath(name: string): boolean {
  return (
    name === '.sxq' ||
    name.startsWith('.sxq/') ||
    name === '.git' ||
    name.startsWith('.git/') ||
    name === '.superun/skills' ||
    name.startsWith('.superun/skills/')
  );
}

/** 防路径穿越：绝对路径或含 .. 段的远端文件名一律拒绝写盘。 */
function isUnsafePath(name: string): boolean {
  return name.startsWith('/') || name.split('/').includes('..');
}

async function writeLocal(name: string, content: string): Promise<void> {
  const filePath = join(process.cwd(), name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

async function deleteLocal(name: string): Promise<void> {
  const filePath = join(process.cwd(), name);
  if (existsSync(filePath)) await unlink(filePath);
}

async function readLocal(name: string): Promise<string | null> {
  const filePath = join(process.cwd(), name);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, 'utf-8');
}

/** pull 执行结果，push 前置拉取用于判断是否可继续。 */
export interface PullResult {
  conflicted: string[];
  snapshotId: string;
  /** 本次服务端查询返回的完整附件路径，不受本地 .gitignore 过滤。 */
  remoteFiles: string[];
}

export interface RunPullOptions {
  /** 用于 -f 提示中的具体子命令。 */
  gitCommand?: string;
  /** 仅忽略 Git 分支限制；其他 Git 安全检查仍然生效。 */
  gitForce?: boolean;
}

interface PullOperation {
  path: string;
  type: 'write' | 'delete';
  content?: string;
}

function buildConflict(
  path: string,
  type: SyncConflictType,
  remoteSnapshotId: string,
  baseMeta?: AttachmentMeta,
  remote?: SessionAttachment
): SyncConflict {
  return {
    path,
    type,
    remoteSnapshotId,
    baseRowKey: baseMeta?.rowKey,
    remoteRowKey: remote?.rowKey,
  };
}

async function fetchAttachmentContent(
  sessionId: string,
  attachment: SessionAttachment
): Promise<string> {
  if (attachment.content !== undefined && attachment.content !== null) {
    return attachment.content;
  }
  const content = await queryAttachment({
    sessionId,
    rowKey: attachment.rowKey,
    name: attachment.name,
  });
  attachment.content = content;
  return content;
}

/**
 * 单分支 Git-like pull：以 manifest tree 为 Base、本地目录为 Local、远端 HEAD 为 Remote，
 * 先完整规划再落盘。manifest 最终总是精确对应 Remote，未解决意图单独保存在 conflicts。
 */
async function syncPull(
  sessionId: string,
  spinner: Ora,
  ig: SyncIgnore,
  manifestForSession: Awaited<ReturnType<typeof loadManifest>>
): Promise<PullResult> {
  const isInitial = !manifestForSession || manifestForSession.sessionId !== sessionId;
  const manifest = isInitial ? null : manifestForSession;
  const result = await querySessionAttachmentsForSync({
    sessionId,
    withContent: isInitial,
  });
  if (result.snapshotId === null || result.snapshotId === undefined) {
    throw new Error(t('pull.snapshotMissing'));
  }

  const remoteFiles = (result.attachments ?? []).flatMap((file) =>
    file.name ? [file.name] : []
  );
  const remoteAttachments = (result.attachments ?? []).filter(
    (file) =>
      file.name &&
      file.rowKey &&
      !isProtectedPath(file.name) &&
      !isUnsafePath(file.name)
  );
  const remoteByPath = new Map(remoteAttachments.map((file) => [file.name, file]));
  // 插件私有 skill 由 `sxq plugin skill` 独占管理，既不从附件 materialize，也不沿用旧 manifest。
  const baseline = new Map(
    [...(manifest ? flattenTree(manifest.tree) : new Map<string, AttachmentMeta>()).entries()]
      .filter(([path]) => !isProtectedPath(path))
  );
  const conflicts = new Map(
    (manifest?.conflicts ?? [])
      .filter((conflict) => !isProtectedPath(conflict.path))
      .map((conflict) => [conflict.path, conflict])
  );
  const operations: PullOperation[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const autoMerged: string[] = [];

  const paths = new Set<string>([
    ...baseline.keys(),
    ...remoteByPath.keys(),
    ...conflicts.keys(),
  ]);

  for (const path of [...paths].sort()) {
    const baseMeta = baseline.get(path);
    const remote = remoteByPath.get(path);
    const previousConflict = conflicts.get(path);
    const localContent = await readLocal(path);

    if (!remote) {
      // 已经记录过的远程删除冲突：用户删除本地副本即表示接受远程删除。
      if (!baseMeta && previousConflict?.type === 'remote-delete-local-modify') {
        if (localContent === null) conflicts.delete(path);
        continue;
      }
      if (!baseMeta) {
        conflicts.delete(path);
        continue;
      }
      // 未曾落盘的远端附件（例如被 ignore 的文件）删除时无需触碰本地。
      if (!baseMeta.hash) {
        conflicts.delete(path);
        continue;
      }
      if (localContent === null) {
        conflicts.delete(path);
        continue;
      }
      if (hashContent(localContent) === baseMeta.hash) {
        operations.push({ path, type: 'delete' });
        deleted.push(path);
        conflicts.delete(path);
      } else {
        conflicts.set(
          path,
          buildConflict(
            path,
            'remote-delete-local-modify',
            result.snapshotId,
            baseMeta
          )
        );
      }
      continue;
    }

    const remoteChanged = !baseMeta || baseMeta.rowKey !== remote.rowKey;
    const needsFirstMaterialization = Boolean(baseMeta && !baseMeta.hash && !ig.ignores(path));
    const shouldMaterialize = Boolean(baseMeta?.hash) || !ig.ignores(path);

    // 新远端文件被忽略时只进入远端 tree，不写盘、不计算本地 hash。
    if (!shouldMaterialize) {
      remote.content = undefined;
      continue;
    }

    // 远端版本没变时，本地修改/删除都是尚未 push 的工作区状态；不要覆盖。
    if (!remoteChanged && !needsFirstMaterialization) {
      continue;
    }

    spinner.text = t('pull.processing', {
      current: updated.length + deleted.length + 1,
      total: paths.size,
      name: path,
    });
    const remoteContent = await fetchAttachmentContent(sessionId, remote);

    // 过去未 materialize 的路径没有可靠本地基线；同名不同内容按 add/add 冲突处理。
    if (!baseMeta || !baseMeta.hash) {
      if (localContent === null) {
        operations.push({ path, type: 'write', content: remoteContent });
        updated.push(path);
        conflicts.delete(path);
      } else if (localContent === remoteContent) {
        conflicts.delete(path);
      } else {
        const merged = threeWayMerge(localContent, null, remoteContent);
        operations.push({ path, type: 'write', content: merged.content });
        conflicts.set(
          path,
          buildConflict(path, 'add-add', result.snapshotId, baseMeta, remote)
        );
      }
      continue;
    }

    if (localContent === null) {
      // Base 有、本地删除、远端又修改：写出显式的 deleted-vs-remote 冲突文件。
      // 用户保留 remote 内容即可接受远端；再次删除文件则表示坚持删除。
      const merged = threeWayMerge('', null, remoteContent);
      operations.push({ path, type: 'write', content: merged.content });
      conflicts.set(
        path,
        buildConflict(
          path,
          'local-delete-remote-modify',
          result.snapshotId,
          baseMeta,
          remote
        )
      );
      continue;
    }

    if (localContent === remoteContent) {
      conflicts.delete(path);
      continue;
    }

    const localChanged = hashContent(localContent) !== baseMeta.hash;
    if (!localChanged) {
      operations.push({ path, type: 'write', content: remoteContent });
      updated.push(path);
      conflicts.delete(path);
      continue;
    }

    let baseContent: string | null = null;
    try {
      baseContent = await queryAttachment({
        sessionId,
        rowKey: baseMeta.rowKey,
        name: path,
      });
      if (hashContent(baseContent) !== baseMeta.hash) {
        debug('Base content hash mismatch; fail closed with whole-file conflict', {
          name: path,
          baseRowKey: baseMeta.rowKey,
        });
        baseContent = null;
      }
    } catch (error) {
      debug('Base fetch failed; fail closed with whole-file conflict', {
        name: path,
        baseRowKey: baseMeta.rowKey,
        error: (error as Error).message,
      });
    }

    const merged = threeWayMerge(localContent, baseContent, remoteContent);
    operations.push({ path, type: 'write', content: merged.content });
    if (merged.conflicted) {
      conflicts.set(
        path,
        buildConflict(path, 'content', result.snapshotId, baseMeta, remote)
      );
    } else {
      autoMerged.push(path);
      conflicts.delete(path);
    }
  }

  // 所有远端读取和合并均完成后才触碰工作树，降低中途失败造成的半拉取状态。
  for (const operation of operations) {
    if (operation.type === 'delete') {
      await deleteLocal(operation.path);
    } else {
      await writeLocal(operation.path, operation.content ?? '');
    }
  }

  await saveManifest({
    schemaVersion: 2,
    sessionId,
    pulledAt: new Date().toISOString(),
    snapshotId: result.snapshotId,
    tree: buildAttachmentTree(remoteAttachments, baseline),
    conflicts: [...conflicts.values()].sort((a, b) => a.path.localeCompare(b.path)),
  });
  debug('Manifest saved', getManifestPath());

  const conflicted = [...conflicts.keys()].sort();
  if (conflicted.length > 0) {
    spinner.warn(
      t('pull.doneWithConflicts', {
        updated: updated.length + deleted.length,
        merged: autoMerged.length,
        conflicted: conflicted.length,
      })
    );
  } else if (updated.length === 0 && deleted.length === 0 && autoMerged.length === 0) {
    spinner.succeed(t('pull.noChanges'));
  } else if (isInitial) {
    spinner.succeed(
      t('pull.fullDone', {
        written: updated.length,
        skipped: remoteAttachments.length - updated.length,
      })
    );
  } else {
    spinner.succeed(
      t('pull.incrementalDone', {
        updated: updated.length + deleted.length,
        merged: autoMerged.length,
      })
    );
  }

  if (deleted.length > 0) {
    logger.info(t('pull.deletedHeader'));
    for (const name of deleted) logger.dim(`  D ${name}`);
  }
  if (autoMerged.length > 0) {
    logger.info(t('pull.autoMergedHeader'));
    for (const name of autoMerged) logger.dim(`  M ${name}`);
  }
  if (conflicted.length > 0) {
    logger.warn(t('pull.conflictHeader'));
    for (const name of conflicted) {
      logger.dim(`  ! ${name} (${conflicts.get(name)?.type})`);
    }
  }

  return { conflicted, snapshotId: result.snapshotId, remoteFiles };
}

/** 执行一次拉取，供 pull 命令和 push 前置检查复用。 */
export async function runPull(
  sessionId: string,
  spinner: Ora,
  options: RunPullOptions = {}
): Promise<PullResult> {
  const [config, manifest] = await Promise.all([getProjectConfig(), loadManifest()]);
  if (config) {
    await validateGitSync({
      configuredBranch: getProjectPushBranch(config),
      manifestGit: manifest?.git,
      force: options.gitForce ?? false,
      command: options.gitCommand ?? 'pull',
    });
  }

  spinner.text = t('pull.checkingSyncPermission');
  const syncable = await canSyncCode({ sessionId });
  debug('canSyncCode', syncable);
  if (!syncable) throw new Error(t('common.codeDownloadDenied'));

  spinner.text = manifest?.sessionId === sessionId ? t('pull.listing') : t('pull.fullPulling');
  const ig = await loadSyncIgnore();
  return syncPull(sessionId, spinner, ig, manifest);
}

export interface PullOptions {
  force?: boolean;
}

export async function pullCommand(options: PullOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const spinner = ora(t('pull.pulling')).start();
  try {
    await runPull(config.sessionId, spinner, {
      gitCommand: 'pull',
      gitForce: options.force ?? false,
    });
  } catch (error) {
    spinner.fail(t('pull.failed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}
