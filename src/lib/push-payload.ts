import { batchSaveContentAndGetRowKeys } from './api.js';
import { t } from './i18n.js';
import type { BatchManualModifyParams } from '../types/index.js';

// RPC 上限 8 MiB；预留鉴权注入、Dubbo 编码等开销。正文分批留出更多余量。
const DIRECT_LIMIT = 8 * 1024 * 1024 - 64 * 1024;
const BATCH_LIMIT = 7 * 1024 * 1024;
const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** 保留调用方的原始正文，成功提交后仍用它建立本地同步基线。 */
export async function preparePushPayload(
  params: BatchManualModifyParams,
  onBatch: (batch: number, total: number) => void
): Promise<BatchManualModifyParams> {
  if (jsonBytes(params) <= DIRECT_LIMIT) return params;

  // 所有大小检查均在第一次上传前完成，避免上传一半才发现单文件无法发送。
  const referenceFiles = params.files.map(file => file.deleted
    ? { filename: file.filename, deleted: true }
    : { filename: file.filename, rowKey: 'x'.repeat(256) });
  if (jsonBytes({ ...params, files: referenceFiles }) > DIRECT_LIMIT) {
    throw new Error(t('push.payloadTooLarge', { filename: 'commit metadata' }));
  }

  const batches: Record<string, string>[] = [];
  let batch: Record<string, string> = Object.create(null);
  const overhead = jsonBytes({ sessionId: params.sessionId, files: {} });
  let bytes = overhead;
  let count = 0;
  for (const file of params.files) {
    if (file.deleted) continue;
    if (file.content === undefined) throw new Error(t('push.uploadInvalid', { filename: file.filename }));
    const entryBytes = jsonBytes(file.filename) + 1 + jsonBytes(file.content);
    if (overhead + entryBytes > BATCH_LIMIT) {
      throw new Error(t('push.payloadTooLarge', { filename: file.filename }));
    }
    if (bytes + entryBytes + (count ? 1 : 0) > BATCH_LIMIT) {
      batches.push(batch);
      batch = Object.create(null);
      bytes = overhead;
      count = 0;
    }
    batch[file.filename] = file.content;
    bytes += entryBytes + (count ? 1 : 0);
    count++;
  }
  if (count) batches.push(batch);

  const rowKeys = new Map<string, string>();
  for (const [index, files] of batches.entries()) {
    onBatch(index + 1, batches.length);
    const result = await batchSaveContentAndGetRowKeys(params.sessionId, files);
    for (const filename of Object.keys(files)) {
      const rowKey = result?.[filename];
      if (typeof rowKey !== 'string' || !rowKey.trim() || Buffer.byteLength(rowKey) > 256) {
        throw new Error(t('push.uploadInvalid', { filename }));
      }
      rowKeys.set(filename, rowKey);
    }
  }
  return {
    ...params,
    files: params.files.map(file => file.deleted
      ? { filename: file.filename, deleted: true }
      : { filename: file.filename, rowKey: rowKeys.get(file.filename)! }),
  };
}
