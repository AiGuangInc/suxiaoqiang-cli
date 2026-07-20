import { getApiBase, getToken, getServiceChain, getTsid } from './config.js';
import { logger } from './logger.js';
import { debug, isDebug } from './debug.js';
import { t } from './i18n.js';
import type { ApiResponse, BatchManualModifyParams, CanDownloadCodeParams, GlowConsultChatParams, GlowConsultChatResult, PageQuerySessionParams, PageResult, PublishDebugParams, PublishDebugResult, PublishLogInfo, PublishNewLogParams, PublishNewLogResult, QueryAttachmentParams, QueryPublishDebugResultParams, QuerySessionAttachmentsParams, SessionAttachment, SessionInfo, SupabaseMigrationParams, SupabaseMigrationResult } from '../types/index.js';

/** 解析 JSON 响应；网关/登录页拦截时服务端会返回 HTML，给出可操作的报错而非 JSON 解析异常 */
async function parseJsonResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as ApiResponse<T>;
  } catch {
    debug('Non-JSON Response Body', raw.slice(0, 300));
    throw new Error(t('api.nonJson'));
  }
}

/** 通用请求方法 */
async function request<T>(path: string, body: Record<string, unknown>): Promise<ApiResponse<T>> {
  const token = getToken();
  if (!token) {
    logger.error(t('api.notLoggedIn'));
    process.exit(1);
  }

  const apiBase = getApiBase();
  const url = `${apiBase}${path}`;

  // 注意：服务端只认连字符的 access-token，下划线的 access_token 会被鉴权拒绝
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'access-token': token,
  };

  const serviceChain = getServiceChain();
  if (serviceChain) {
    headers['x-service-chain'] = serviceChain;
  }

  // cookie 名是大写 TSID，配置项名用小写 tsid
  const tsid = getTsid();
  if (tsid) {
    headers['Cookie'] = `TSID=${tsid}`;
  }

  debug('Request URL', url);
  debug('Request Headers', { ...headers, 'access-token': '***', ...(tsid ? { Cookie: 'TSID=***' } : {}) });
  debug('Request Body', body);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  debug('Response Status', `${res.status} ${res.statusText}`);
  debug('Response Headers', Object.fromEntries(res.headers.entries()));

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    debug('Response Error Body', errorBody);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await parseJsonResponse<T>(res);
  debug('Response Data', {
    success: json.success,
    code: json.code,
    message: json.message ?? json.msg,
    statusCode: json.statusCode,
    dataLength: Array.isArray(json.data) ? json.data.length : typeof json.data,
  });

  if (json.code !== 0) {
    // 部分接口错误信息在 msg 字段（如 batchManualModify）
    const message = json.message || json.msg;
    if (json.code === 1000011) {
      throw new Error(t('api.tokenExpired', { detail: message ? ` (${message})` : '' }));
    }
    throw new Error(message || t('api.requestFailed', { code: json.code }));
  }

  return json;
}

/** CLI 登录 token 轮询（免鉴权，服务端取到后即删，token 未就绪时返回空） */
export async function pollCliToken(uuid: string): Promise<string | null> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/uxa-center/support/UserAccount/pollCliToken`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tsid = getTsid();
  if (tsid) {
    headers['Cookie'] = `TSID=${tsid}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ uuid }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    debug('pollCliToken Error Body', errorBody);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await parseJsonResponse<string>(res);
  debug('pollCliToken Response', {
    success: json.success,
    code: json.code,
    message: json.message ?? json.msg,
  });

  // token 未就绪：code 非 0 或 data 为空，返回 null 由调用方继续轮询
  if (json.code !== 0 || !json.data) {
    return null;
  }
  return json.data;
}

/** 检查当前账号是否可以下载指定会话的代码 */
export async function canDownloadCode(params: CanDownloadCodeParams): Promise<boolean> {
  const response = await request<boolean>(
    '/api/uxa-center/agent/AgentQuery/canDownloadCode',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 查询 Session 附件（排除内部和编译产物） */
export async function querySessionAttachments(
  params: QuerySessionAttachmentsParams
): Promise<SessionAttachment[]> {
  const response = await request<SessionAttachment[]>(
    '/api/uxa-center/agent/AgentQuery/querySessionAttachmentsExcludeInternalAndCompiled',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 拉取单个附件内容 */
export async function queryAttachment(params: QueryAttachmentParams): Promise<string> {
  const response = await request<string>(
    '/api/uxa-center/agent/AgentQuery/queryAttachment',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 向会话发送消息（push 后告知模型本次修改了哪些文件） */
export async function glowConsultChat(params: GlowConsultChatParams): Promise<GlowConsultChatResult> {
  const response = await request<GlowConsultChatResult>(
    '/api/uxa-center/agent/AgentCommand/glowConsultChat',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 批量保存/删除附件（push） */
export async function batchManualModify(params: BatchManualModifyParams): Promise<boolean> {
  const response = await request<boolean>(
    '/api/uxa-center/agent/AgentCommand/batchManualModify',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** debug 发布（预览重编译），返回用于轮询结果的 replyMessageId */
export async function publishDebug(params: PublishDebugParams): Promise<string> {
  const response = await request<string>(
    '/api/uxa-center/agent/AgentCommand/publishDebug',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** debug 发布结果轮询 */
export async function queryPublishDebugResult(
  params: QueryPublishDebugResultParams
): Promise<PublishDebugResult> {
  const response = await request<PublishDebugResult>(
    '/api/uxa-center/agent/AgentQuery/queryPublishDebugResult',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 正式上线（发布新版本） */
export async function publishNewLog(params: PublishNewLogParams): Promise<PublishNewLogResult> {
  const response = await request<PublishNewLogResult>(
    '/api/uxa-center/agent/AgentCommand/publishNewLogV2',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 执行 Supabase 数据库迁移（成功后服务端会自动把迁移文件写入会话附件） */
export async function supabaseExecuteMigration(
  params: SupabaseMigrationParams
): Promise<SupabaseMigrationResult> {
  const response = await request<SupabaseMigrationResult>(
    '/api/uxa-center/agent/SessionIntegration/supabaseExecuteMigration',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 分页查询当前账号的会话（keyword 精确匹配 sessionId；接口校验登录，可用于归属校验） */
export async function pageQuerySessionByLastId(
  params: PageQuerySessionParams
): Promise<PageResult<SessionInfo>> {
  const response = await request<PageResult<SessionInfo>>(
    '/api/uxa-center/agent/AgentQuery/pageQuerySessionByLastId',
    params as unknown as Record<string, unknown>
  );
  return response.data;
}

/** 查询发布版本信息（未发布版本 + 已发布历史），上线后轮询 deployStatus 用 */
export async function queryPublishLogInfo(sessionId: string): Promise<PublishLogInfo> {
  const response = await request<PublishLogInfo>(
    '/api/uxa-center/agent/AgentQuery/queryPublishLogInfo',
    { sessionId }
  );
  return response.data;
}
