import ora from 'ora';
import { setProjectConfig, isProjectLinked } from '../lib/config.js';
import { canDownloadCode, pageQuerySessionByLastId } from '../lib/api.js';
import { logger } from '../lib/logger.js';
import { confirm } from '../lib/prompt.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';

export interface LinkOptions {
  /** 已关联时直接覆盖，跳过确认 */
  yes?: boolean;
}

export async function linkCommand(sessionId: string, options: LinkOptions = {}): Promise<void> {
  if (!sessionId) {
    logger.error(t('link.needSessionId'));
    process.exit(1);
  }

  if (isProjectLinked() && !options.yes) {
    const overwrite = await confirm(t('link.overwriteConfirm'), t('link.overwriteHint'));
    if (!overwrite) {
      logger.info(t('link.keep'));
      return;
    }
  }

  const spinner = ora(t('link.checkingDownloadPermission')).start();

  try {
    const downloadable = await canDownloadCode({ sessionId });
    debug('canDownloadCode', downloadable);
    if (!downloadable) {
      throw new Error(t('common.codeDownloadDenied'));
    }

    // 归属校验：接口按登录账号过滤，查不到说明 session 不存在或不属于当前账号
    spinner.text = t('link.verifying');
    const page = await pageQuerySessionByLastId({ keyword: sessionId, pageSize: 1 });
    debug('pageQuerySessionByLastId', page);
    const session = page.data?.find((s) => s.sessionId === sessionId);
    if (!session) {
      spinner.fail(t('link.notOwned', { sessionId }));
      process.exit(1);
    }

    spinner.text = t('link.linking');
    await setProjectConfig({
      sessionId,
      linkedAt: new Date().toISOString(),
      session,
    });
    spinner.succeed(t('link.success', { sessionId }));
    if (session.topic) logger.dim(t('link.topicLabel', { topic: session.topic }));
    if (session.ownerName) logger.dim(t('link.ownerLabel', { owner: session.ownerName }));
  } catch (error) {
    spinner.fail(t('link.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
