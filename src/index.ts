import { Command, Option } from 'commander';
import { loginCommand } from './commands/login.js';
import { linkCommand } from './commands/link.js';
import { pullCommand } from './commands/pull.js';
import { pushCommand } from './commands/push.js';
import { deprecatedPublishCommand, previewCommand } from './commands/publish.js';
import { deployCommand, deployStatusCommand } from './commands/deploy.js';
import { dbPushCommand } from './commands/db/push.js';
import { dbQueryCommand } from './commands/db/query.js';
import { dbLogsCommand } from './commands/db/logs.js';
import { positiveInteger } from './commands/db/common.js';
import {
  pluginDisableCommand,
  pluginEnableCommand,
  pluginListCommand,
  pluginSkillCommand,
  pluginStatusCommand,
} from './commands/plugin.js';
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

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

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
  .option('-f, --force', t('cmd.gitForce'))
  .action(async (options: { force?: boolean }) => {
    await pullCommand(options);
  });

// ─── sxq push ────────────────────────────────────────────

program
  .command('push')
  .description(t('cmd.push'))
  .option('-m, --message <message>', t('cmd.pushMessage'))
  .option('-f, --force', t('cmd.gitForce'))
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
  .option('-f, --force', t('cmd.gitForce'))
  .action(async (options: { message?: string; force?: boolean }) => {
    await dbPushCommand(options);
  });

db.command('query')
  .description(t('cmd.dbQuery'))
  .argument('[sql]', t('cmd.dbQueryArg'))
  .option('-f, --file <path>', t('cmd.dbQueryFile'))
  .option('--prod', t('cmd.dbProd'))
  .option('--limit <number>', t('cmd.dbLimit'), (value) => positiveInteger(value, '--limit'))
  .option('--json', t('cmd.json'))
  .action(async (
    sql: string | undefined,
    options: { file?: string; prod?: boolean; limit?: number; json?: boolean }
  ) => {
    await dbQueryCommand(sql, options);
  });

db.command('logs')
  .description(t('cmd.dbLogs'))
  .option('--prod', t('cmd.dbProd'))
  .option('--type <type>', t('cmd.dbLogsType'), 'function')
  .option('--since <range>', t('cmd.dbLogsSince'), '15m')
  .option('--filter <keyword>', t('cmd.dbLogsFilter'))
  .option('--limit <number>', t('cmd.dbLimit'), (value) => positiveInteger(value, '--limit'))
  .addOption(new Option('--order <order>', t('cmd.dbLogsOrder')).choices(['asc', 'desc']).default('desc'))
  .option('--json', t('cmd.json'))
  .action(async (options: {
    prod?: boolean;
    type?: string;
    since?: string;
    filter?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    json?: boolean;
  }) => {
    await dbLogsCommand(options);
  });

// ─── sxq plugin ──────────────────────────────────────────

const plugin = program
  .command('plugin')
  .description(t('cmd.plugin'));

plugin.command('list')
  .description(t('cmd.pluginList'))
  .option('--json', t('cmd.json'))
  .action(async (options: { json?: boolean }) => {
    await pluginListCommand(options);
  });

plugin.command('status')
  .description(t('cmd.pluginStatus'))
  .argument('[pluginId]', t('cmd.pluginIdArg'))
  .option('--json', t('cmd.json'))
  .action(async (pluginId: string | undefined, options: { json?: boolean }) => {
    await pluginStatusCommand(pluginId, options);
  });

plugin.command('enable')
  .description(t('cmd.pluginEnable'))
  .argument('<pluginId>', t('cmd.pluginIdArg'))
  .action(async (pluginId: string) => {
    await pluginEnableCommand(pluginId);
  });

plugin.command('skill')
  .description(t('cmd.pluginSkill'))
  .argument('<pluginId>', t('cmd.pluginIdArg'))
  .action(async (pluginId: string) => {
    await pluginSkillCommand(pluginId);
  });

plugin.command('disable')
  .description(t('cmd.pluginDisable'))
  .argument('<pluginId>', t('cmd.pluginIdArg'))
  .action(async (pluginId: string) => {
    await pluginDisableCommand(pluginId);
  });

// ─── 解析 ─────────────────────────────────────────────────

program.parse();
