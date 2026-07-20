import ora from 'ora';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { getProjectConfig } from '../lib/config.js';
import { batchManualModify, querySessionAttachments } from '../lib/api.js';
import { buildAttachmentTree, flattenTree, hashContent, loadManifest, saveManifest } from '../lib/manifest.js';
import { runPull } from './pull.js';
import { MIGRATIONS_DIR } from './db/push.js';
import { debug, isDebug } from '../lib/debug.js';
import { loadSyncIgnore, type SyncIgnore } from '../lib/ignore.js';
import { t } from '../lib/i18n.js';
import type { ManualModifyFile } from '../types/index.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface PushOptions {
  message?: string;
}

/** 递归收集本地文件相对路径（posix 风格，与远端附件 name 对齐），按 .gitignore + 内置规则过滤 */
async function collectLocalFiles(dir: string, ig: SyncIgnore, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ig.ignoresDir(path)) continue;
      files.push(...(await collectLocalFiles(join(dir, entry.name), ig, path)));
    } else if (entry.isFile()) {
      if (ig.ignores(path)) continue;
      files.push(path);
    }
  }
  return files;
}

/**
 * 是否残留 pull 合并写入的冲突标记（精确匹配 threeWayMerge 的输出格式）。
 * 只对清单 conflicts 列表里的文件调用，用户代码/文档里自带的类似标记不受影响。
 */
function hasConflictMarker(content: string): boolean {
  return (
    /^<{7} local\r?$/m.test(content) &&
    /^={7}\r?$/m.test(content) &&
    /^>{7} remote\r?$/m.test(content)
  );
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
    // ── 1. 先拉取远程变更，有冲突则中断 ──────────────────
    const pullResult = await runPull(sessionId, spinner);
    if (pullResult.conflicted.length > 0) {
      spinner.fail(t('push.abortConflict'));
      logger.warn(t('push.conflictMarkerHeader'));
      for (const name of pullResult.conflicted) logger.dim(`  ${name}`);
      process.exit(1);
    }

    // ── 2. 对比清单，找出本地新增/修改/删除的文件 ───────
    spinner.start(t('push.scanning'));
    const manifest = await loadManifest();
    const baseline = manifest ? flattenTree(manifest.tree) : new Map();
    // 只有 pull 时被写入过冲突标记的文件才做残留检查，避免误伤内容本身含类似标记的文件
    const conflictSet = new Set(manifest?.conflicts ?? []);

    const ig = await loadSyncIgnore();
    const localPaths = await collectLocalFiles(process.cwd(), ig);
    const toPush: ManualModifyFile[] = [];
    const unresolved: string[] = [];
    const skippedBinary: string[] = [];
    const skippedLarge: string[] = [];

    for (const path of localPaths) {
      const buf = await readFile(join(process.cwd(), path));
      if (buf.length > MAX_FILE_SIZE) {
        skippedLarge.push(path);
        continue;
      }
      if (buf.includes(0)) {
        skippedBinary.push(path);
        continue;
      }
      const content = buf.toString('utf-8');
      const meta = baseline.get(path);
      if (meta?.hash && meta.hash === hashContent(content)) {
        conflictSet.delete(path); // 与远端基线一致，冲突已按远端版本解决
        continue;
      }
      if (conflictSet.has(path)) {
        if (hasConflictMarker(content)) {
          unresolved.push(path);
          continue;
        }
        conflictSet.delete(path); // 标记已清除，视为冲突解决
      }
      toPush.push({ filename: path, content });
    }

    // 上次 pull 留下的冲突标记未解决，同样中断
    if (unresolved.length > 0) {
      spinner.fail(t('push.abortUnresolved'));
      logger.warn(t('push.unresolvedHeader'));
      for (const name of unresolved) logger.dim(`  ${name}`);
      process.exit(1);
    }

    // 只有带 hash 的清单项才是曾写入本地的文本文件；无 hash 的项可能是未落盘的二进制附件，不能误删
    // 被忽略的文件也不参与删除判定（可能只是新加了 ignore 规则）
    const deletedLocally = [...baseline.entries()]
      .filter(([path, meta]) => meta.hash && !ig.ignores(path) && !existsSync(join(process.cwd(), path)))
      .map(([path]) => path);

    // 迁移文件必须走 sxq db push（服务端执行成功后自动落附件），普通 push 的新增/修改/删除一律拦下
    const blockedMigrations = [
      ...toPush
        .filter((f) => f.filename.startsWith(`${MIGRATIONS_DIR}/`))
        .map((f) => f.filename),
      ...deletedLocally.filter((path) => path.startsWith(`${MIGRATIONS_DIR}/`)),
    ];
    if (blockedMigrations.length > 0) {
      for (const name of blockedMigrations) {
        const index = toPush.findIndex((f) => f.filename === name);
        if (index >= 0) toPush.splice(index, 1);
      }
    }
    const warnBlockedMigrations = () => {
      if (blockedMigrations.length === 0) return;
      logger.warn(t('push.migrationsBlockedHeader'));
      for (const name of blockedMigrations) logger.dim(`  ${name}`);
    };

    const deletionsToPush = deletedLocally.filter(
      (path) => !path.startsWith(`${MIGRATIONS_DIR}/`)
    );
    for (const path of deletionsToPush) {
      conflictSet.delete(path);
      toPush.push({ filename: path, deleted: true });
    }

    debug('Push diff', {
      local: localPaths.length,
      toPush: toPush.map((f) => f.filename),
      deletedLocally,
      skippedBinary,
      skippedLarge,
    });

    if (toPush.length === 0) {
      if (manifest && (manifest.conflicts?.length ?? 0) !== conflictSet.size) {
        await saveManifest({ ...manifest, conflicts: [...conflictSet] });
      }
      spinner.succeed(t('push.noChanges'));
      warnBlockedMigrations();
      return;
    }

    // ── 3. 无冲突，批量推送 ─────────────────────────────
    spinner.text = t('push.pushing', { count: toPush.length });
    const ok = await batchManualModify({
      sessionId,
      withSnapshot: true,
      summary: options.message || t('push.defaultSummary', { count: toPush.length }),
      files: toPush,
    });
    if (!ok) {
      throw new Error(t('common.serverFalse'));
    }

    // ── 4. 推送成功，回查新 rowKey 并更新清单 ────────────
    spinner.text = t('push.updatingManifest');
    // 清单与同步范围保持一致：忽略的远端文件不进清单
    const list = ((await querySessionAttachments({ sessionId, withContent: false })) ?? []).filter(
      (f) => !f.name || !ig.ignores(f.name)
    );
    const pushedContent = new Map(
      toPush.filter((f) => !f.deleted).map((f) => [f.filename, f.content])
    );
    for (const item of list) {
      const content = pushedContent.get(item.name);
      if (content !== undefined) item.content = content;
    }
    await saveManifest({
      sessionId,
      pulledAt: new Date().toISOString(),
      tree: buildAttachmentTree(list, baseline),
      conflicts: [...conflictSet],
    });

    spinner.succeed(t('push.success', { count: toPush.length }));
    for (const file of toPush) {
      const suffix = file.deleted ? t('push.deletedSuffix') : '';
      logger.dim(`  ${file.filename}${suffix}`);
    }
    warnBlockedMigrations();

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
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
