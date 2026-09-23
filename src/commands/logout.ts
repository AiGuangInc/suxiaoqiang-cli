import { clearToken } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { t } from '../lib/i18n.js';

export async function logoutCommand(): Promise<void> {
  const storage = await clearToken();
  logger.success(t(storage === 'keyring' ? 'logout.success' : 'logout.localSuccess'));
  if (process.env.SUPERUN_PAT !== undefined) logger.warn(t('logout.envOverride'));
}
