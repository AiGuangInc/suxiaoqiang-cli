import ora from 'ora';
import { logger } from '../lib/logger.js';
import { getProjectConfig } from '../lib/config.js';
import { publishDebug, queryPublishDebugResult } from '../lib/api.js';
import { debug, isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';
import type { PublishDebugResult } from '../types/index.js';

/** 轮询间隔与超时（重编译可能较慢，给足 10 分钟） */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
/** NONE（无发布记录）持续超过该时长即认定任务未触发，不再傻等到总超时 */
const NONE_TIMEOUT_MS = 3 * 60 * 1000;

export interface PublishOptions {
  /** 指定 replyMessageId；为空走默认"最近一条已完成 AGENT 消息" */
  messageId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询 debug 发布结果直到出结果或超时 */
export async function pollPublishDebugResult(
  sessionId: string,
  messageId: string,
  onTick?: (result: PublishDebugResult) => void
): Promise<PublishDebugResult> {
  const startedAt = Date.now();
  const deadline = startedAt + POLL_TIMEOUT_MS;
  while (true) {
    const result = await queryPublishDebugResult({ sessionId, messageId });
    debug('queryPublishDebugResult', result);
    onTick?.(result);
    // NONE 可能是任务刚触发还没落记录，短暂容忍；只有 SUCCESS/FAILED 才终态
    if (result.status === 'SUCCESS' || result.status === 'FAILED') {
      return result;
    }
    if (result.status === 'NONE' && Date.now() - startedAt >= NONE_TIMEOUT_MS) {
      throw new Error(t('publish.noneTimeout'));
    }
    if (Date.now() >= deadline) {
      throw new Error(
        t('publish.timeout', { minutes: POLL_TIMEOUT_MS / 60000, status: result.status })
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function publishCommand(options: PublishOptions = {}): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const { sessionId } = config;
  const spinner = ora(t('publish.triggering')).start();

  try {
    const messageId = await publishDebug({ sessionId, messageId: options.messageId });
    if (!messageId) {
      throw new Error(t('publish.noMessageId'));
    }
    debug('publishDebug replyMessageId', messageId);

    spinner.text = t('publish.waiting');
    const startedAt = Date.now();
    const result = await pollPublishDebugResult(sessionId, messageId, () => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      spinner.text = t('publish.waitingSeconds', { seconds });
    });

    if (result.status === 'FAILED') {
      spinner.fail(t('publish.failed'));
      if (result.errorMsg) logger.error(result.errorMsg);
      process.exit(1);
    }

    spinner.succeed(t('publish.success'));
    if (result.previewUrl) logger.info(t('common.previewUrl', { url: result.previewUrl }));
    if (result.publishUrl) logger.info(t('common.publishUrl', { url: result.publishUrl }));
  } catch (error) {
    spinner.fail(t('publish.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
