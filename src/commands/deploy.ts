import ora from 'ora';
import { logger } from '../lib/logger.js';
import { confirm } from '../lib/prompt.js';
import { getProjectConfig } from '../lib/config.js';
import { publishNewLog, queryPublishLogInfo } from '../lib/api.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';
import type { PublishVersion } from '../types/index.js';

/** 上线后轮询间隔与超时 */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface DeployOptions {
  /** 变动记录，默认沿用待上线版本已有的 changeLog */
  message?: string;
  /** 目标机房：CN 主站 / INTL 国际站，默认当前机房 */
  region?: string;
  /** 跳过确认（含云服务费确认） */
  yes?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms?: number): string {
  return ms ? new Date(ms).toLocaleString() : '';
}

/** 展示预览/线上地址（字段存在才输出） */
function printUrls(source: { previewUrl?: string; publishUrl?: string }): void {
  if (source.previewUrl) logger.info(t('common.previewUrl', { url: source.previewUrl }));
  if (source.publishUrl) logger.info(t('common.publishUrl', { url: source.publishUrl }));
}

export async function deployCommand(options: DeployOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const { sessionId } = config;
  const spinner = ora(t('deploy.querying')).start();

  try {
    // ── 1. 查询版本信息，优先待上线版本，否则取最新已发布版本重新发布 ─
    const info = await queryPublishLogInfo(sessionId);
    debug('queryPublishLogInfo', info);
    const latestPublished = (info.publishedVersions ?? []).reduce<PublishVersion | null>(
      (latest, v) => (!latest || (v.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? v : latest),
      null
    );
    const isRepublish = !info.unPublishedVersion;
    const version = info.unPublishedVersion ?? latestPublished;
    if (!version) {
      spinner.fail(t('deploy.noVersion'));
      logger.info(t('deploy.noVersionHint'));
      process.exit(1);
    }

    spinner.stop();
    logger.info(isRepublish ? t('deploy.republishHeader') : t('deploy.pendingHeader'));
    if (version.changeLogSummary) {
      logger.dim(t('deploy.summaryLabel', { text: version.changeLogSummary.split('\n')[0] }));
    }
    if (version.updatedAt) {
      logger.dim(t('deploy.updatedAtLabel', { time: formatTime(version.updatedAt) }));
    }
    if (options.region) {
      logger.dim(t('deploy.regionLabel', { region: options.region }));
    }

    // ── 2. 确认上线（含云服务费确认） ────────────────────
    if (!options.yes) {
      const confirmed = await confirm(
        isRepublish ? t('deploy.confirmRepublish') : t('deploy.confirm'),
        t('deploy.confirmHint')
      );
      if (!confirmed) {
        logger.info(t('deploy.cancelled'));
        return;
      }
    }

    // ── 3. 触发上线 ─────────────────────────────────────
    spinner.start(t('deploy.triggering'));
    const result = await publishNewLog({
      sessionId,
      encryptedId: version.encryptedId,
      changeLog: options.message ?? version.changeLog,
      changeLogSummary: version.changeLogSummary,
      websiteIntroduction: version.websiteIntroduction,
      targetRegion: options.region,
      acknowledgedCloudServiceFee: true,
    });
    if (!result) {
      throw new Error(t('common.serverFalse'));
    }
    // 新版响应带地址字段，旧版仅 boolean
    let urls = typeof result === 'object' ? result : {};

    // 重新发布时该版本本就在已发布列表（deployStatus=1），无任何可轮询的进度信号
    if (isRepublish) {
      spinner.succeed(t('deploy.republishTriggered'));
      printUrls({ ...info, ...urls });
      logger.info(t('deploy.republishNoPoll'));
      return;
    }

    // ── 4. 轮询版本状态直到上线完成（上线接口无 messageId 回执，
    //       只能盯 queryPublishLogInfo 里该版本的 deployStatus） ──
    spinner.text = t('deploy.waiting');
    const startedAt = Date.now();
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (true) {
      await sleep(POLL_INTERVAL_MS);
      const latest = await queryPublishLogInfo(sessionId);
      const published = latest.publishedVersions?.find(
        (v) => v.encryptedId === version.encryptedId && v.deployStatus === 1
      );
      if (published) {
        urls = { ...latest, ...urls };
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(t('deploy.timeout', { minutes: POLL_TIMEOUT_MS / 60000 }));
      }
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      spinner.text = t('deploy.waitingSeconds', { seconds });
    }

    spinner.succeed(t('deploy.success'));
    printUrls(urls);
  } catch (error) {
    spinner.fail(t('deploy.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}

/** sxq deploy --status: 只查询版本状态，不触发上线 */
export async function deployStatusCommand(): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const spinner = ora(t('deploy.statusQuerying')).start();
  try {
    const info = await queryPublishLogInfo(config.sessionId);
    debug('queryPublishLogInfo', info);
    spinner.stop();

    if (info.targetRegion) logger.info(t('deploy.statusRegion', { region: info.targetRegion }));
    printUrls(info);
    if (info.unPublishedVersion) {
      const v = info.unPublishedVersion;
      logger.info(t('deploy.statusPending', { time: formatTime(v.updatedAt) }));
      if (v.changeLogSummary) logger.dim(`  ${v.changeLogSummary.split('\n')[0]}`);
    } else {
      logger.info(t('deploy.statusNoPending'));
    }

    const published = info.publishedVersions ?? [];
    if (published.length > 0) {
      logger.info(t('deploy.statusPublished', { count: published.length }));
      for (const v of published) {
        const summary = v.changeLogSummary?.split('\n')[0] ?? '';
        logger.dim(`  ${formatTime(v.updatedAt)} ${summary}`);
      }
    } else {
      logger.info(t('deploy.statusNoPublished'));
    }
  } catch (error) {
    spinner.fail(t('deploy.statusFailed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
