import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { getApiBase, getSxqDir } from './config.js';
import { debug } from './debug.js';
import { hashContent } from './manifest.js';
import { t } from './i18n.js';

export const MAX_SYNC_FILE_SIZE = 5 * 1024 * 1024;

interface CachedFile {
  stat: string;
  hash: string;
  verifiedAtMs: number;
}

interface FileCacheData {
  version: 1;
  root: string;
  apiBase: string;
  sessionId: string;
  files: Record<string, CachedFile>;
}

function statKey(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

type ScannedFile =
  | { kind: 'unchanged' }
  | { kind: 'large' }
  | { kind: 'binary' }
  | { kind: 'text'; content: string; hash: string };

/** 可丢弃的扫描缓存；远端 manifest 仍是判断待提交修改的唯一基线。 */
export class FileScanCache {
  private previous: Record<string, CachedFile> = Object.create(null);
  private current: Record<string, CachedFile> = Object.create(null);
  readonly stats = { hits: 0, reads: 0, bytesRead: 0 };

  private constructor(
    private sessionId: string,
    private cwd: string,
    private apiBase: string
  ) {}

  static async load(sessionId: string, cwd = process.cwd()): Promise<FileScanCache> {
    const cache = new FileScanCache(sessionId, resolve(cwd), getApiBase());
    try {
      const data = JSON.parse(await readFile(cache.path, 'utf-8')) as FileCacheData;
      if (data.version === 1 && data.root === cache.cwd && data.apiBase === cache.apiBase &&
          data.sessionId === sessionId && data.files &&
          typeof data.files === 'object' && !Array.isArray(data.files)) {
        cache.previous = data.files;
      }
    } catch {
      // 缓存缺失、损坏或不可读时重新读盘，不影响同步语义。
    }
    return cache;
  }

  private get path(): string {
    return join(getSxqDir(this.cwd), 'file-cache.json');
  }

  async scan(path: string, baselineHash?: string, conflicted = false): Promise<ScannedFile> {
    const absolute = join(this.cwd, path);
    const before = await lstat(absolute, { bigint: true });
    if (!before.isFile()) throw new Error(t('push.localChangedAfterConfirm'));
    if (before.size > BigInt(MAX_SYNC_FILE_SIZE)) return { kind: 'large' };

    const key = statKey(before);
    const cached = Object.hasOwn(this.previous, path) ? this.previous[path] : undefined;
    // 粗粒度时间戳可能把快速、同大小的修改误判为未变，保守留出一秒窗口。
    // 命中时保留原验证时间，不能随缓存重写把可疑时间戳变为可信。
    if (!conflicted && baselineHash && cached && cached.stat === key &&
        cached.hash === baselineHash && /^[a-f0-9]{64}$/.test(cached.hash) &&
        Number.isFinite(cached.verifiedAtMs) && cached.verifiedAtMs <= Date.now() &&
        Number(before.mtimeNs / 1_000_000n) < cached.verifiedAtMs - 1000 &&
        Number(before.ctimeNs / 1_000_000n) < cached.verifiedAtMs - 1000) {
      this.current[path] = cached;
      this.stats.hits++;
      return { kind: 'unchanged' };
    }

    const verifiedAtMs = Date.now();
    const buffer = await readFile(absolute);
    const after = await lstat(absolute, { bigint: true });
    if (statKey(after) !== key || BigInt(buffer.length) !== before.size) {
      throw new Error(t('push.localChangedAfterConfirm'));
    }
    this.stats.reads++;
    this.stats.bytesRead += buffer.length;
    if (buffer.includes(0)) return { kind: 'binary' };
    const content = buffer.toString('utf-8');
    const hash = hashContent(content);
    this.current[path] = { stat: key, hash, verifiedAtMs };
    return { kind: 'text', content, hash };
  }

  async save(): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(getSxqDir(this.cwd), { recursive: true });
      const data: FileCacheData = {
        version: 1, root: this.cwd, apiBase: this.apiBase,
        sessionId: this.sessionId, files: this.current,
      };
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      debug('File scan cache save skipped', (error as Error).message);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
