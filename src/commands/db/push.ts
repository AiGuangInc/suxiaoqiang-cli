import ora from 'ora';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';
import { getProjectConfig } from '../../lib/config.js';
import { supabaseExecuteMigration } from '../../lib/api.js';
import { loadManifest, flattenTree } from '../../lib/manifest.js';
import { runPull } from '../pull.js';
import { debug, isDebug } from '../../lib/debug.js';
import { t } from '../../lib/i18n.js';

export const MIGRATIONS_DIR = 'supabase/migrations';
/** 强制：<数字>_<描述>.sql（首个下划线前必须全是数字）；数字建议用 yyyyMMddHHmmss 保证执行顺序 */
const MIGRATION_NAME_RE = /^\d+_.+\.sql$/;

export interface DbPushOptions {
  message?: string;
}

export async function dbPushCommand(options: DbPushOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const { sessionId } = config;
  const spinner = ora(t('push.checking')).start();

  try {
    // ── 1. 先拉取远程变更（拿到远端已有迁移的基线），有冲突则中断 ─
    const pullResult = await runPull(sessionId, spinner);
    if (pullResult.conflicted.length > 0) {
      spinner.fail(t('push.abortConflict'));
      logger.warn(t('push.conflictMarkerHeader'));
      for (const name of pullResult.conflicted) logger.dim(`  ${name}`);
      process.exit(1);
    }

    // ── 2. diff 出本地新增的迁移文件 ─────────────────────
    spinner.start(t('db.scanning'));
    const dir = join(process.cwd(), MIGRATIONS_DIR);
    if (!existsSync(dir)) {
      spinner.info(t('db.noDir', { dir: MIGRATIONS_DIR }));
      return;
    }

    const manifest = await loadManifest();
    const baseline = manifest ? flattenTree(manifest.tree) : new Map();
    const localFiles = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => e.name);
    const newFiles = localFiles.filter((name) => !baseline.has(`${MIGRATIONS_DIR}/${name}`));

    // ── 3. 过滤命名不合规的文件（与 Supabase CLI 行为一致：不执行）─
    const invalid = newFiles.filter((name) => !MIGRATION_NAME_RE.test(name));
    const newMigrations = newFiles.filter((name) => MIGRATION_NAME_RE.test(name));
    debug('db push diff', { localFiles, newMigrations, invalid });
    if (invalid.length > 0) {
      spinner.stop();
      logger.warn(t('db.invalidNames'));
      for (const name of invalid) logger.dim(`  ${MIGRATIONS_DIR}/${name}`);
      spinner.start();
    }

    if (newMigrations.length === 0) {
      spinner.succeed(t('db.noNew'));
      return;
    }

    // ── 4. 按时间戳顺序逐个执行，失败即停 ──────────────────
    newMigrations.sort();
    let executed = 0;
    for (const name of newMigrations) {
      const fileName = `${MIGRATIONS_DIR}/${name}`;
      spinner.text = t('db.executing', {
        current: executed + 1,
        total: newMigrations.length,
        name,
      });
      const content = await readFile(join(dir, name), 'utf-8');
      const result = await supabaseExecuteMigration({ sessionId, fileName, content });
      debug('supabaseExecuteMigration', { fileName, result });
      if (!result?.success) {
        spinner.fail(t('db.execFailed', { name: fileName }));
        if (result?.errorMsg) logger.error(result.errorMsg);
        if (executed > 0) logger.info(t('db.executedBefore', { count: executed }));
        process.exit(1);
      }
      executed++;
    }

    // ── 5. 服务端已写入迁移附件，再拉一次同步清单 ──────────
    spinner.text = t('db.syncing');
    await runPull(sessionId, spinner);

    spinner.succeed(t('db.success', { count: executed }));
    for (const name of newMigrations) logger.dim(`  ${MIGRATIONS_DIR}/${name}`);
  } catch (error) {
    spinner.fail(t('db.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
