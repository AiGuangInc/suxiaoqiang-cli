import { mergeDiff3 } from 'node-diff3';

export interface MergeResult {
  content: string;
  conflicted: boolean;
}

/**
 * 三方合并本地/基线/远端内容。
 * 改动不同区域自动合并；同区域冲突写 git 风格标记。
 * 基线不可用（base 为 null）时退化为整文件二方冲突标记。
 */
export function threeWayMerge(local: string, base: string | null, remote: string): MergeResult {
  if (base === null) {
    const content = [
      '<<<<<<< local',
      local,
      '=======',
      remote,
      '>>>>>>> remote',
      '',
    ].join('\n');
    return { content, conflicted: true };
  }

  const merged = mergeDiff3(local.split('\n'), base.split('\n'), remote.split('\n'), {
    label: { a: 'local', o: 'base', b: 'remote' },
  });

  return {
    content: merged.result.join('\n'),
    conflicted: merged.conflict,
  };
}
