import ora from 'ora';
import { getProjectConfig } from '../lib/config.js';
import { deployEdgeFunction } from '../lib/api.js';
import { logger } from '../lib/logger.js';
import { isDebug } from '../lib/debug.js';
import { t } from '../lib/i18n.js';

export async function deployEdgeFunctionCommand(): Promise<void> {
  const config = await getProjectConfig();
  if (!config) {
    logger.error(t('common.notLinked'));
    process.exit(1);
  }

  const spinner = ora(t('edgeFunction.deploying')).start();

  try {
    const result = await deployEdgeFunction({ sessionId: config.sessionId });
    if (!result.allSuccess) {
      throw new Error(result.errorMessages || t('edgeFunction.serverFailed'));
    }
    spinner.succeed(t('edgeFunction.success'));
  } catch (error) {
    spinner.fail(t('edgeFunction.failed'));
    logger.error((error as Error).message);
    if (isDebug()) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
