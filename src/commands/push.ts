import ora from 'ora';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { getProjectConfig } from '../lib/config.js';
import { batchManualModifyForSync, querySessionAttachmentsForSync } from '../lib/api.js';
import {
  buildAttachmentTree,
  flattenTree,
  hashContent,
  loadManifest,
  saveManifest,
} from '../lib/manifest.js';
import { runPull } from './pull.js';
import { MIGRATIONS_DIR } from './db/push.js';
import { debug, isDebug } from '../lib/debug.js';
import { loadSyncIgnore, type SyncIgnore } from '../lib/ignore.js';
import { t } from '../lib/i18n.js';
import { confirm } from '../lib/prompt.js';
import type {
  AttachmentMeta,
  ManualModifyFile,
  SyncConflict,
} from '../types/index.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** 服务端托管或本地工具专用的受保护目录。 */
export const PROTECTED_DIRS = [
  'internal',
  'memory',
  '.superun',
  '.shared',
  '.sxq',
  '.git',
];

function isProtectedPath(path: string): boolean {
  return PROTECTED_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

export interface PushOptions {
  message?: string;
  /** 忽略 Git 推送分支限制；其他 Git 安全检查仍然生效。 */
  force?: boolean;
  /** 展示清单后直接确认推送；破坏性冲突仍要求交互确认。 */
  yes?: boolean;
}

interface PushPlan {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface DestructiveConflict {
  path: string;
  conflict: SyncConflict;
  action: 'restore-remote' | 'delete-remote-version' | 'replace-remote-version';
}

function buildPushPlan(
  files: ManualModifyFile[],
  baseline: Map<string, AttachmentMeta>
): PushPlan {
  const plan: PushPlan = { added: [], modified: [], deleted: [] };
  for (const file of files) {
    if (file.deleted) plan.deleted.push(file.filename);
    else if (baseline.has(file.filename)) plan.modified.push(file.filename);
    else plan.added.push(file.filename);
  }
  plan.added.sort();
  plan.modified.sort();
  plan.deleted.sort();
  return plan;
}

function printPushPlan(plan: PushPlan): void {
  logger.info(
    t('push.planHeader', {
      added: plan.added.length,
      modified: plan.modified.length,
      deleted: plan.deleted.length,
    })
  );
  for (const path of plan.added) logger.dim(`  + ${path}`);
  for (const path of plan.modified) logger.dim(`  M ${path}`);
  for (const path of plan.deleted) logger.dim(`  D ${path}`);
}

async function validateLocalPlan(
  originalPaths: string[],
  files: ManualModifyFile[],
  ig: SyncIgnore,
  trackedPaths: Set<string>,
  trackedDirectories: Set<string>
): Promise<void> {
  const currentPaths = await collectLocalFiles(
    process.cwd(),
    ig,
    trackedPaths,
    trackedDirectories
  );
  const originalKey = [...originalPaths].sort().join('\n');
  const currentKey = currentPaths.sort().join('\n');
  if (originalKey !== currentKey) throw new Error(t('push.localChangedAfterConfirm'));

  for (const file of files) {
    const path = join(process.cwd(), file.filename);
    if (file.deleted) {
      if (existsSync(path)) throw new Error(t('push.localChangedAfterConfirm'));
      continue;
    }
    const current = await readFile(path, 'utf-8');
    if (current !== file.content) throw new Error(t('push.localChangedAfterConfirm'));
  }
}

/**
 * 收集本地文件。Git 语义下 ignore 只排除未跟踪文件；manifest 中已 materialize 的路径
 * 即使后来命中 .gitignore，仍会继续参与 diff。
 */
async function collectLocalFiles(
  dir: string,
  ig: SyncIgnore,
  trackedPaths: Set<string>,
  trackedDirectories: Set<string>,
  prefix = ''
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ig.ignoresDir(path) && !trackedDirectories.has(path)) continue;
      files.push(...(await collectLocalFiles(
        join(dir, entry.name),
        ig,
        trackedPaths,
        trackedDirectories,
        path
      )));
    } else if (entry.isFile()) {
      if (!trackedPaths.has(path) && ig.ignores(path)) continue;
      files.push(path);
    }
  }
  return files;
}

/** 精确匹配 threeWayMerge 写入的冲突标记。 */
function hasConflictMarker(content: string): boolean {
  return (
    /^<{7} local\r?$/m.test(content) &&
    /^={7}\r?$/m.test(content) &&
    /^>{7} remote\r?$/m.test(content)
  );
}

function describeDestructiveConflict(conflict: DestructiveConflict): string {
  if (conflict.action === 'restore-remote') return `R ${conflict.path}`;
  if (conflict.action === 'delete-remote-version') return `D! ${conflict.path}`;
  return `M! ${conflict.path}`;
}

export async function pushCommand(options: PushOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const { sessionId } = config;
  const spinner = ora(t('push.checking')).start();

  try {
    // 1. 先把工作树合并到当前远端 HEAD；冲突状态由下面的 commit 规划显式处理。
    const pullResult = await runPull(sessionId, spinner, {
      gitCommand: 'push',
      gitForce: options.force ?? false,
    });

    spinner.start(t('push.scanning'));
    const manifest = await loadManifest();
    if (!manifest || manifest.sessionId !== sessionId || !manifest.snapshotId) {
      throw new Error(t('push.manifestInvalid'));
    }
    if (manifest.snapshotId !== pullResult.snapshotId) {
      throw new Error(t('push.manifestSnapshotMismatch'));
    }

    const baseline = flattenTree(manifest.tree);
    const conflicts = new Map(
      (manifest.conflicts ?? []).map((conflict) => [conflict.path, conflict])
    );
    const remainingConflicts = new Map(conflicts);
    const trackedPaths = new Set(
      [...baseline.entries()]
        .filter(([, meta]) => Boolean(meta.hash))
        .map(([path]) => path)
    );
    for (const path of conflicts.keys()) trackedPaths.add(path);
    const trackedDirectories = new Set<string>();
    for (const path of trackedPaths) {
      const parts = path.split('/');
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        trackedDirectories.add(current);
      }
    }

    const ig = await loadSyncIgnore();
    const localPaths = await collectLocalFiles(
      process.cwd(),
      ig,
      trackedPaths,
      trackedDirectories
    );
    const localPathSet = new Set(localPaths);
    const toPush: ManualModifyFile[] = [];
    const unresolved: string[] = [];
    const destructiveConflicts: DestructiveConflict[] = [];
    const skippedBinary: string[] = [];
    const skippedLarge: string[] = [];

    for (const path of localPaths) {
      if (isProtectedPath(path)) continue;
      const buf = await readFile(join(process.cwd(), path));
      const conflict = conflicts.get(path);
      if (buf.length > MAX_FILE_SIZE) {
        skippedLarge.push(path);
        if (conflict) unresolved.push(path);
        continue;
      }
      if (buf.includes(0)) {
        skippedBinary.push(path);
        if (conflict) unresolved.push(path);
        continue;
      }

      const content = buf.toString('utf-8');
      const meta = baseline.get(path);
      if (conflict && hasConflictMarker(content)) {
        unresolved.push(path);
        continue;
      }

      if (conflict?.type === 'remote-delete-local-modify') {
        destructiveConflicts.push({ path, conflict, action: 'restore-remote' });
        remainingConflicts.delete(path);
      } else if (conflict?.type === 'local-delete-remote-modify') {
        if (meta?.hash && meta.hash === hashContent(content)) {
          remainingConflicts.delete(path); // 接受远端新版本，无需提交。
          continue;
        }
        destructiveConflicts.push({ path, conflict, action: 'replace-remote-version' });
        remainingConflicts.delete(path);
      } else if (conflict) {
        // 内容冲突标记已被用户清除，当前文件即为明确解决结果。
        remainingConflicts.delete(path);
      }

      if (meta?.hash && meta.hash === hashContent(content)) continue;
      toPush.push({ filename: path, content });
    }

    // 基线中已 materialize、当前不存在的路径是本地删除。
    const deletedLocally = [...baseline.entries()]
      .filter(([, meta]) => Boolean(meta.hash))
      .map(([path]) => path)
      .filter((path) => !localPathSet.has(path) && !isProtectedPath(path));
    for (const path of deletedLocally) {
      const conflict = conflicts.get(path);
      if (conflict) {
        destructiveConflicts.push({
          path,
          conflict,
          action: 'delete-remote-version',
        });
        remainingConflicts.delete(path);
      }
      toPush.push({ filename: path, deleted: true });
    }

    // 远端已删除且用户也删除了保留副本：接受远端删除，仅清除冲突。
    for (const conflict of conflicts.values()) {
      if (
        conflict.type === 'remote-delete-local-modify' &&
        !localPathSet.has(conflict.path)
      ) {
        remainingConflicts.delete(conflict.path);
      }
    }

    if (unresolved.length > 0) {
      spinner.fail(t('push.abortUnresolved'));
      logger.warn(t('push.unresolvedHeader'));
      for (const name of [...new Set(unresolved)].sort()) logger.dim(`  ${name}`);
      process.exit(1);
    }

    // 数据库迁移继续保持既有边界：普通 push 不处理。
    const blockedMigrations = toPush
      .filter((file) => file.filename.startsWith(`${MIGRATIONS_DIR}/`))
      .map((file) => file.filename);
    for (let index = toPush.length - 1; index >= 0; index--) {
      if (toPush[index].filename.startsWith(`${MIGRATIONS_DIR}/`)) {
        const existingConflict = conflicts.get(toPush[index].filename);
        if (existingConflict) {
          remainingConflicts.set(toPush[index].filename, existingConflict);
        }
        toPush.splice(index, 1);
      }
    }
    const warnBlockedMigrations = () => {
      if (blockedMigrations.length === 0) return;
      logger.warn(t('push.migrationsBlockedHeader'));
      for (const name of blockedMigrations) logger.dim(`  ${name}`);
    };

    debug('Push diff', {
      local: localPaths.length,
      toPush: toPush.map((file) => file.filename),
      deletedLocally,
      conflicts: [...conflicts.values()],
      skippedBinary,
      skippedLarge,
    });

    if (toPush.length === 0) {
      await saveManifest({
        ...manifest,
        conflicts: [...remainingConflicts.values()].sort((a, b) =>
          a.path.localeCompare(b.path)
        ),
      });
      spinner.succeed(t('push.noChanges'));
      warnBlockedMigrations();
      return;
    }

    spinner.stop();
    warnBlockedMigrations();
    const plan = buildPushPlan(toPush, baseline);
    printPushPlan(plan);
    if (!options.yes) {
      const confirmed = await confirm(t('push.confirm'), t('push.confirmHint'));
      if (!confirmed) {
        logger.info(t('push.cancelled'));
        return;
      }
    }

    const pushedPaths = new Set(toPush.map((file) => file.filename));
    const pushedDestructiveConflicts = destructiveConflicts.filter((conflict) =>
      pushedPaths.has(conflict.path)
    );
    if (pushedDestructiveConflicts.length > 0) {
      logger.warn(t('push.destructiveConflictHeader'));
      for (const conflict of pushedDestructiveConflicts) {
        logger.dim(`  ${describeDestructiveConflict(conflict)}`);
      }
      if (options.yes) throw new Error(t('push.destructiveNeedsInteractive'));
      const confirmed = await confirm(
        t('push.destructiveConfirm'),
        t('push.destructiveConfirmHint')
      );
      if (!confirmed) {
        logger.info(t('push.cancelled'));
        return;
      }
    }

    await validateLocalPlan(
      localPaths,
      toPush,
      ig,
      trackedPaths,
      trackedDirectories
    );

    // 2. commit + CAS push：preSnapshotId 永远存在，空仓库使用服务端的 "0" 根快照。
    spinner.start(t('push.pushing', { count: toPush.length }));
    const modifyResult = await batchManualModifyForSync({
      sessionId,
      withSnapshot: true,
      preSnapshotId: pullResult.snapshotId,
      summary: options.message || t('push.defaultSummary', { count: toPush.length }),
      files: toPush,
    });
    if (!modifyResult.snapshotId) throw new Error(t('push.snapshotMissing'));

    // 3. 只读取本次 commit 的不可变 tree，绝不读取“当前最新”再配本次 snapshotId。
    spinner.text = t('push.updatingManifest');
    const refreshResult = await querySessionAttachmentsForSync({
      sessionId,
      snapshotId: modifyResult.snapshotId,
      withContent: false,
    });
    if (refreshResult.snapshotId !== modifyResult.snapshotId) {
      throw new Error(t('push.snapshotMismatch'));
    }
    const list = (refreshResult.attachments ?? []).filter(
      (file) => file.name && file.rowKey && !isProtectedPath(file.name)
    );
    const pushedContent = new Map(
      toPush
        .filter((file) => !file.deleted)
        .map((file) => [file.filename, file.content])
    );
    for (const item of list) {
      const content = pushedContent.get(item.name);
      if (content !== undefined) item.content = content;
    }
    await saveManifest({
      schemaVersion: 2,
      sessionId,
      pulledAt: new Date().toISOString(),
      snapshotId: modifyResult.snapshotId,
      tree: buildAttachmentTree(list, baseline),
      conflicts: [...remainingConflicts.values()].sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
    });

    spinner.succeed(t('push.success', { count: toPush.length }));
    for (const file of toPush) {
      const suffix = file.deleted ? t('push.deletedSuffix') : '';
      logger.dim(`  ${file.filename}${suffix}`);
    }
    if (skippedBinary.length > 0) {
      logger.warn(t('push.skippedBinaryHeader'));
      for (const name of skippedBinary) logger.dim(`  ${name}`);
    }
    if (skippedLarge.length > 0) {
      logger.warn(t('push.skippedLargeHeader', { size: MAX_FILE_SIZE / 1024 / 1024 }));
      for (const name of skippedLarge) logger.dim(`  ${name}`);
    }
  } catch (error) {
    spinner.fail(t('push.failed'));
    logger.error((error as Error).message);
    if (isDebug()) console.error((error as Error).stack);
    process.exit(1);
  }
}
