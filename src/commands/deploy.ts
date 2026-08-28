import ora from 'ora';
import { logger } from '../lib/logger.js';
import { getApiBase, getProjectConfig } from '../lib/config.js';
import { queryPublishLogInfo } from '../lib/api.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';
import { openBrowser } from '../lib/browser.js';

function formatTime(ms?: number): string {
  return ms ? new Date(ms).toLocaleString() : '';
}

/** 展示预览/线上地址（字段存在才输出） */
function printUrls(source: { previewUrl?: string; publishUrl?: string }): void {
  if (source.previewUrl) logger.info(t('common.previewUrl', { url: source.previewUrl }));
  if (source.publishUrl) logger.info(t('common.publishUrl', { url: source.publishUrl }));
}

export async function deployCommand(): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const url = new URL(`/web/project/${encodeURIComponent(config.sessionId)}`, getApiBase());
  url.searchParams.set('withDeploy', '1');

  logger.info(t('deploy.openBrowser'));
  logger.info(url.toString());
  openBrowser(url.toString());
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
