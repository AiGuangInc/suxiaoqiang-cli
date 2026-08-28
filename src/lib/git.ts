import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { logger } from './logger.js';
import { t } from './i18n.js';
import type { GitSyncContext } from '../types/index.js';

interface GitResult {
  code: number;
  stdout: string;
}

function runGit(args: string[], cwd: string = process.cwd()): Promise<GitResult> {
  return new Promise((resolveResult) => {
    execFile('git', args, { cwd, encoding: 'utf-8' }, (error, stdout) => {
      resolveResult({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout.trim(),
      });
    });
  });
}

/** 不依赖 git 可执行文件，检查当前目录或祖先目录是否存在 Git 元数据。 */
export function hasGitMetadata(cwd: string = process.cwd()): boolean {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return false;
    current = parent;
  }
}

/** 当前目录不在 Git 工作树中（或系统没有 Git）时返回 null。 */
export async function getGitContext(cwd: string = process.cwd()): Promise<GitSyncContext | null> {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.code !== 0 || inside.stdout !== 'true') return null;

  const [root, head, branch] = await Promise.all([
    runGit(['rev-parse', '--show-toplevel'], cwd),
    runGit(['rev-parse', 'HEAD'], cwd),
    runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd),
  ]);
  if (root.code !== 0) return null;

  return {
    root: root.stdout,
    head: head.code === 0 && head.stdout ? head.stdout : null,
    branch: branch.code === 0 && branch.stdout ? branch.stdout : null,
  };
}

/** 检测会产生中间态工作树的 Git 操作。 */
export async function getGitOperation(cwd: string = process.cwd()): Promise<string | null> {
  const candidates = [
    ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
  ] as const;

  for (const [gitPath, operation] of candidates) {
    const result = await runGit(['rev-parse', '--git-path', gitPath], cwd);
    if (result.code !== 0 || !result.stdout) continue;
    const path = isAbsolute(result.stdout) ? result.stdout : resolve(cwd, result.stdout);
    if (existsSync(path)) return operation;
  }
  return null;
}

/** ancestor 是否是 descendant 的祖先提交。 */
export async function isGitAncestor(
  ancestor: string,
  descendant: string,
  cwd: string = process.cwd()
): Promise<boolean> {
  const result = await runGit(['merge-base', '--is-ancestor', ancestor, descendant], cwd);
  return result.code === 0;
}

export interface GitSyncValidationOptions {
  configuredBranch: string;
  manifestGit?: GitSyncContext;
  /** 仅忽略 detached HEAD、配置分支和清单分支限制。 */
  force?: boolean;
  /** 用于生成可直接执行的 -f 提示，如 push、pull、db push。 */
  command: string;
}

/**
 * 所有会读取、写入或依据本地项目文件执行的命令共用的 Git 安全门禁。
 * 非 Git 目录跳过；Git 元数据损坏、操作中间态、跨 worktree 和历史改写始终拒绝。
 */
export async function validateGitSync(
  options: GitSyncValidationOptions
): Promise<void> {
  const { configuredBranch, manifestGit, force = false, command } = options;
  const current = await getGitContext();
  if (!current) {
    if (hasGitMetadata()) throw new Error(t('git.inspectFailed'));
    return;
  }

  const operation = await getGitOperation();
  if (operation) throw new Error(t('git.operation', { operation }));

  if (!current.branch) {
    if (!force) throw new Error(t('git.detached', { command }));
    logger.warn(
      t('git.branchForced', { current: 'detached HEAD', configured: configuredBranch })
    );
  } else if (current.branch !== configuredBranch) {
    if (!force) {
      throw new Error(
        t('git.wrongBranch', {
          current: current.branch,
          configured: configuredBranch,
          command,
        })
      );
    }
    logger.warn(
      t('git.branchForced', { current: current.branch, configured: configuredBranch })
    );
  }

  if (!manifestGit) {
    if (!force && current.branch === configuredBranch) {
      logger.info(t('git.validated', { current: current.branch, configured: configuredBranch }));
    }
    return;
  }
  if (manifestGit.root !== current.root) {
    throw new Error(t('git.rootChanged'));
  }
  if (manifestGit.branch !== current.branch) {
    if (!force) {
      throw new Error(
        t('git.manifestBranchChanged', {
          previous: manifestGit.branch ?? 'detached HEAD',
          current: current.branch ?? 'detached HEAD',
          command,
        })
      );
    }
    logger.warn(
      t('git.manifestBranchForced', {
        previous: manifestGit.branch ?? 'detached HEAD',
        current: current.branch ?? 'detached HEAD',
      })
    );
    return;
  }

  if (
    current.branch &&
    manifestGit.head &&
    current.head &&
    manifestGit.head !== current.head &&
    !(await isGitAncestor(manifestGit.head, current.head))
  ) {
    throw new Error(t('git.historyChanged'));
  }

  if (!force && current.branch === configuredBranch) {
    logger.info(t('git.validated', { current: current.branch, configured: configuredBranch }));
  }
}
