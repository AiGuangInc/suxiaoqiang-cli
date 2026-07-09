import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** 内置忽略（无 .gitignore 时的兜底，.sxq/.git 无论如何都不同步） */
const BUILTIN_PATTERNS = ['.git', '.sxq', 'node_modules', 'dist', 'build', 'coverage', '.DS_Store'];

export interface SyncIgnore {
  /** 文件是否忽略（posix 相对路径） */
  ignores(path: string): boolean;
  /** 目录是否忽略（整棵子树可剪枝） */
  ignoresDir(path: string): boolean;
}

/** 加载项目根目录 .gitignore（若存在）+ 内置规则，pull/push 共用 */
export async function loadSyncIgnore(cwd: string = process.cwd()): Promise<SyncIgnore> {
  const ig: Ignore = ignore().add(BUILTIN_PATTERNS);
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    ig.add(await readFile(gitignorePath, 'utf-8'));
  }
  return {
    ignores: (path) => ig.ignores(path),
    // 形如 "dist/" 的规则只匹配带斜杠的目录路径，两种写法都测
    ignoresDir: (path) => ig.ignores(path) || ig.ignores(`${path}/`),
  };
}
