import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import ora from 'ora';
import { setToken, getToken, clearToken, getApiBase } from '../lib/config.js';
import { pollCliToken, pageQuerySessionByLastId } from '../lib/api.js';
import { logger } from '../lib/logger.js';
import { confirm } from '../lib/prompt.js';
import { isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';

/** 轮询间隔与总超时 */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** 跨平台打开浏览器，失败不抛错（终端里已打印 URL 供手动打开） */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LoginOptions {
  /** 已有凭证时直接重新登录，跳过确认 */
  yes?: boolean;
  /** 直接使用已有 token 登录，跳过浏览器授权 */
  token?: string;
}

/** --token 登录：先校验有效性，无效则还原原有凭证 */
async function loginWithToken(token: string): Promise<void> {
  const previous = getToken();
  const spinner = ora(t('login.tokenVerifying')).start();
  setToken(token);
  try {
    // 该接口按登录账号返回数据且校验凭证，仅用于验证 token 可用
    await pageQuerySessionByLastId({ pageSize: 1 });
    spinner.succeed(t('login.success'));
    logger.success(t('login.tokenSaved'));
  } catch (error) {
    if (previous) {
      setToken(previous);
    } else {
      clearToken();
    }
    spinner.fail(t('login.tokenInvalid'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  // 显式传 token 即视为确认覆盖，无需二次确认
  if (options.token) {
    await loginWithToken(options.token);
    return;
  }

  const existing = getToken();
  if (existing && !options.yes) {
    const overwrite = await confirm(t('login.reloginConfirm'), t('login.reloginHint'));
    if (!overwrite) {
      logger.info(t('login.keepCurrent'));
      return;
    }
  }

  const uuid = randomUUID();
  const authUrl = `${getApiBase()}/web/cli-token-callback?uuid=${uuid}`;

  logger.info(t('login.openBrowser'));
  logger.info(authUrl);
  openBrowser(authUrl);

  const spinner = ora(t('login.waiting')).start();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const token = await pollCliToken(uuid).catch(() => null);
      if (token) {
        setToken(token);
        spinner.succeed(t('login.success'));
        logger.success(t('login.tokenSaved'));
        return;
      }
    }
    spinner.fail(t('login.timeout'));
    logger.info(t('login.timeoutTokenHint'));
    process.exit(1);
  } catch (error) {
    spinner.fail(t('login.failed'));
    logger.error((error as Error).message);
    process.exit(1);
  }
}
