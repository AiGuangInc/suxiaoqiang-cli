import { Command, Option } from 'commander';
import { loginCommand } from './commands/login.js';
import { linkCommand } from './commands/link.js';
import { pullCommand } from './commands/pull.js';
import { pushCommand } from './commands/push.js';
import { deprecatedPublishCommand, previewCommand } from './commands/publish.js';
import { deployCommand, deployStatusCommand } from './commands/deploy.js';
import { dbPushCommand } from './commands/db/push.js';
import { upgradeCommand } from './commands/upgrade.js';
import { maybeNotifyNewVersion } from './lib/update-check.js';
import {
  configSetCommand,
  configGetCommand,
  configUnsetCommand,
  configListCommand,
} from './commands/config.js';
import { setDebug } from './lib/debug.js';
import { t } from './lib/i18n.js';
import { visibleConfigKeys } from './commands/config.js';
import { version } from '../package.json';

const program = new Command();

program
  .name('sxq')
  .description(t('cmd.program'))
  .version(version)
  .option('--debug', t('cmd.debugOption'))
  .hook('preAction', async (thisCommand, actionCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) {
      setDebug(true);
    }
    // 每日首条命令时提示新版本；upgrade 自己不用提示
    if (actionCommand.name() !== 'upgrade') {
      await maybeNotifyNewVersion();
    }
  });

// ─── sxq login ───────────────────────────────────────────

program
  .command('login')
  .description(t('cmd.login'))
  .option('-y, --yes', t('cmd.loginYes'))
  .option('--token <token>', t('cmd.loginToken'))
  .action(async (options: { yes?: boolean; token?: string }) => {
    await loginCommand(options);
  });

// ─── sxq link ────────────────────────────────────────────

program
  .command('link')
  .description(t('cmd.link'))
  .argument('<sessionId>', t('cmd.linkArg'))
  .option('-y, --yes', t('cmd.linkYes'))
  .action(async (sessionId: string, options: { yes?: boolean }) => {
    await linkCommand(sessionId, options);
  });

// ─── sxq pull ────────────────────────────────────────────

program
  .command('pull')
  .description(t('cmd.pull'))
  .action(async () => {
    await pullCommand();
  });

// ─── sxq push ────────────────────────────────────────────

program
  .command('push')
  .description(t('cmd.push'))
  .option('-m, --message <message>', t('cmd.pushMessage'))
  .option('-f, --force', t('cmd.pushForce'))
  .option('-y, --yes', t('cmd.pushYes'))
  .action(async (options: { message?: string; force?: boolean; yes?: boolean }) => {
    await pushCommand(options);
  });

// ─── sxq preview ─────────────────────────────────────────

program
  .command('preview')
  .description(t('cmd.preview'))
  .argument('[target]', t('cmd.previewTarget'), 'front')
  .option('--message-id <messageId>', t('cmd.previewMessageId'))
  .action(async (target: string, options: { messageId?: string }) => {
    await previewCommand(target, options);
  });

program
  .command('publish', { hidden: true })
  .description(t('cmd.publishDeprecated'))
  .option('--message-id <messageId>', t('cmd.previewMessageId'))
  .action(async (options: { messageId?: string }) => {
    await deprecatedPublishCommand(options);
  });

// ─── sxq deploy ──────────────────────────────────────────

program
  .command('deploy')
  .description(t('cmd.deploy'))
  // 兼容旧调用，但发布参数不再影响行为，也不会绕过网页确认。
  .addOption(new Option('-m, --message <message>').hideHelp())
  .addOption(new Option('--region <region>').hideHelp())
  .addOption(new Option('-y, --yes').hideHelp())
  .option('--status', t('cmd.deployStatus'))
  .action(async (options: { message?: string; region?: string; yes?: boolean; status?: boolean }) => {
    if (options.status) {
      await deployStatusCommand();
      return;
    }
    await deployCommand();
  });

// ─── sxq upgrade ─────────────────────────────────────────

program
  .command('upgrade')
  .description(t('cmd.upgrade'))
  .action(async () => {
    await upgradeCommand();
  });

// ─── sxq config ──────────────────────────────────────────

const config = program
  .command('config')
  .description(t('cmd.config', { keys: visibleConfigKeys().join(', ') }));

config
  .command('set')
  .description(t('cmd.configSet'))
  .argument('<key>', t('cmd.configKeyArg'))
  .argument('<value>', t('cmd.configValueArg'))
  .action(async (key: string, value: string) => {
    await configSetCommand(key, value);
  });

config
  .command('get')
  .description(t('cmd.configGet'))
  .argument('<key>', t('cmd.configKeyArg'))
  .action(async (key: string) => {
    await configGetCommand(key);
  });

config
  .command('unset')
  .description(t('cmd.configUnset'))
  .argument('<key>', t('cmd.configKeyArg'))
  .action(async (key: string) => {
    await configUnsetCommand(key);
  });

config
  .command('list')
  .description(t('cmd.configList'))
  .action(async () => {
    await configListCommand();
  });

// ─── sxq db ──────────────────────────────────────────────

const db = program
  .command('db')
  .description(t('cmd.db'));

db.command('push')
  .description(t('cmd.dbPush'))
  .option('-m, --message <message>', t('cmd.dbPushMessage'))
  .action(async (options: { message?: string }) => {
    await dbPushCommand(options);
  });

// ─── 解析 ─────────────────────────────────────────────────

program.parse();
