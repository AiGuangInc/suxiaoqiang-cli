import inquirer from 'inquirer';
import { logger } from './logger.js';
import { t } from './i18n.js';

/**
 * 交互确认。非 TTY 环境（智能体、CI、管道调用）下 inquirer 会挂死等待输入，
 * 这里直接报错退出并提示非交互的替代方案。
 */
export async function confirm(message: string, nonInteractiveHint: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    logger.error(t('prompt.nonInteractive', { message }));
    logger.info(nonInteractiveHint);
    process.exit(1);
  }
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: false,
    },
  ]);
  return confirmed;
}
