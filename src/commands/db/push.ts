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
/** 强制：<14 位 yyyyMMddHHmmss>_<标识>.sql；时间戳是迁移回放排序键 */
const MIGRATION_NAME_RE = /^\d{14}_.+\.sql$/;

interface MigrationTimestampConflict {
  existing: string[];
  pending: string[];
}

function addMigrationsByTimestamp(
  groups: Map<string, MigrationTimestampConflict>,
  names: string[],
  source: keyof MigrationTimestampConflict
): void {
  for (const name of names) {
    const timestamp = name.slice(0, name.indexOf('_'));
    const migrations = groups.get(timestamp) ?? { existing: [], pending: [] };
    migrations[source].push(name);
    groups.set(timestamp, migrations);
  }
}

function findTimestampConflicts(
  pendingNames: string[],
  existingNames: string[]
): Map<string, MigrationTimestampConflict> {
  const migrationsByTimestamp = new Map<string, MigrationTimestampConflict>();
  addMigrationsByTimestamp(migrationsByTimestamp, existingNames, 'existing');
  addMigrationsByTimestamp(migrationsByTimestamp, pendingNames, 'pending');

  return new Map(
    [...migrationsByTimestamp.entries()]
      // 只拦截与本次待执行迁移相关的冲突；远端历史遗留冲突不阻塞其他新迁移。
      .filter(
        ([, migrations]) =>
          migrations.pending.length > 0 &&
          migrations.existing.length + migrations.pending.length > 1
      )
      .map(([timestamp, migrations]) => [
        timestamp,
        {
          existing: migrations.existing.sort(),
          pending: migrations.pending.sort(),
        },
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export interface DbPushOptions {
  message?: string;
  force?: boolean;
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
    const pullResult = await runPull(sessionId, spinner, {
      gitCommand: 'db push',
      gitForce: options.force ?? false,
    });
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
    const migrationPathPrefix = `${MIGRATIONS_DIR}/`;
    const existingMigrations = pullResult.remoteFiles
      .filter((path) => path.startsWith(migrationPathPrefix))
      .map((path) => path.slice(migrationPathPrefix.length))
      .filter((name) => !name.includes('/') && MIGRATION_NAME_RE.test(name));
    const localFiles = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => e.name);
    const newFiles = localFiles.filter((name) => !baseline.has(`${MIGRATIONS_DIR}/${name}`));

    // ── 3. 严格校验命名；任一不合规文件都会让回放顺序失真，整批中止 ─
    const invalid = newFiles.filter((name) => !MIGRATION_NAME_RE.test(name));
    const newMigrations = newFiles.filter((name) => MIGRATION_NAME_RE.test(name));
    debug('db push diff', { localFiles, existingMigrations, newMigrations, invalid });
    if (invalid.length > 0) {
      spinner.fail(t('db.invalidNames'));
      for (const name of invalid) logger.dim(`  ${MIGRATIONS_DIR}/${name}`);
      process.exit(1);
    }

    if (newMigrations.length === 0) {
      spinner.succeed(t('db.noNew'));
      return;
    }

    // 时间戳是迁移回放的全局唯一键；与远端已有或本批其他迁移重复时，执行 SQL 前中止。
    const timestampConflicts = findTimestampConflicts(newMigrations, existingMigrations);
    if (timestampConflicts.size > 0) {
      spinner.fail(t('db.timestampConflicts'));
      for (const [timestamp, migrations] of timestampConflicts) {
        logger.error(t('db.timestampConflict', { timestamp }));
        for (const name of migrations.existing) {
          logger.dim(`  ${MIGRATIONS_DIR}/${name}${t('db.remoteExistingSuffix')}`);
        }
        for (const name of migrations.pending) {
          logger.dim(`  ${MIGRATIONS_DIR}/${name}${t('db.pendingSuffix')}`);
        }
      }
      process.exit(1);
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
        if (result?.errorDetail && result.errorDetail !== result.errorMsg) {
          logger.error(t('db.errorDetail', { detail: result.errorDetail }));
        }
        if (result?.errorHint) {
          logger.info(t('db.errorHint', { hint: result.errorHint }));
        }
        if (!result?.errorMsg && !result?.errorDetail && !result?.errorHint) {
          logger.error(t('db.unknownError'));
        }
        if (executed > 0) logger.info(t('db.executedBefore', { count: executed }));
        process.exit(1);
      }
      executed++;
    }

    // ── 5. 服务端已写入迁移附件，再拉一次同步清单 ──────────
    spinner.text = t('db.syncing');
    await runPull(sessionId, spinner, {
      gitCommand: 'db push',
      gitForce: options.force ?? false,
    });

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
