/** API 响应基础结构 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  success?: boolean;
  requestId?: string;
  message?: string;
  /** 部分接口（如 AgentCommand）错误信息放在 msg 字段 */
  msg?: string;
  errorData?: string | null;
  statusCode?: string;
}

/** canDownloadCode 请求参数 */
export interface CanDownloadCodeParams {
  sessionId: string;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** Session 附件项 */
export interface SessionAttachment {
  createdAt: string;
  size: string;
  name: string;
  type: string;
  rowKey: string;
  content: string;
  updatedAt: string;
}

/** querySessionAttachments 请求参数 */
export interface QuerySessionAttachmentsParams {
  sessionId: string;
  nameStartWith?: string;
  replyMessageId?: string;
  existFileNames?: string[];
  withContent?: boolean;
  nameNotStartWiths?: string[];
  nameNotStartWith?: string;
  userId?: number;
  __product?: number;
  orgId?: number;
  filenamesForAttachmentContent?: string[];
  nameLike?: string;
  nameNotLikes?: string[];
  accId?: number;
  refreshFileNames?: string[];
  nameStartWiths?: string[];
}

/** queryAttachment 请求参数（拉取单个附件内容） */
export interface QueryAttachmentParams {
  sessionId: string;
  rowKey?: string;
  name?: string;
  fallbackName?: string;
}

/** batchManualModify 中的单个文件 */
export interface ManualModifyFile {
  filename: string;
  content: string;
}

/** batchManualModify 请求参数（批量保存附件） */
export interface BatchManualModifyParams {
  sessionId: string;
  withSnapshot: boolean;
  summary?: string;
  files: ManualModifyFile[];
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** glowConsultChat 请求参数（向会话发送消息，告知模型信息） */
export interface GlowConsultChatParams {
  sessionId: string;
  content: string;
  /** 是否后台运行（不在对话中展示） */
  background?: boolean;
  attachments?: unknown[];
  /** 模式: 1 默认, 2 快速 */
  mode?: number;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** glowConsultChat 响应 data */
export interface GlowConsultChatResult {
  messageId?: string;
  sessionId?: string;
  status?: number;
}

/** publishDebug 请求参数（debug 发布，预览重编译） */
export interface PublishDebugParams {
  sessionId: string;
  /** 指定 replyMessageId；为空走默认"最近一条已完成 AGENT 消息" */
  messageId?: string;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** queryPublishDebugResult 请求参数（debug 发布结果轮询） */
export interface QueryPublishDebugResultParams {
  sessionId: string;
  /** publishDebug 返回的 replyMessageId */
  messageId: string;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** debug 发布状态 */
export type PublishDebugStatus = 'NONE' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/** queryPublishDebugResult 响应 data */
export interface PublishDebugResult {
  /** NONE 无记录（未触发或已过期）/ RUNNING 发布中 / SUCCESS 成功 / FAILED 失败 */
  status: PublishDebugStatus;
  errorMsg?: string;
  /** 预览地址（发布成功后返回） */
  previewUrl?: string;
  /** 线上地址（发布成功后返回） */
  publishUrl?: string;
}

/** publishNewLogV2 请求参数（正式上线）。文档里的 logId 是错的，实际字段是 encryptedId */
export interface PublishNewLogParams {
  sessionId: string;
  /** queryPublishLogInfo 返回的待上线版本 encryptedId */
  encryptedId: string;
  changeLog?: string;
  changeLogSummary?: string;
  websiteIntroduction?: string;
  /** 指定 replyMessageId 重发；为空走默认"最近一条已完成 AGENT 消息" */
  messageId?: string;
  /** 目标机房，默认当前机房。CN 主站 / INTL 国际站 */
  targetRegion?: string;
  /** 用户已确认云服务费 */
  acknowledgedCloudServiceFee?: boolean;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** 发布版本记录（文档写的是数字 id，实际返回加密串 encryptedId；updatedAt 为毫秒时间戳） */
export interface PublishVersion {
  encryptedId: string;
  changeLog?: string;
  changeLogSummary?: string;
  websiteIntroduction?: string;
  updatedAt?: number;
  /** 发布状态 0未发布 1发布 */
  deployStatus?: number;
}

/** queryPublishLogInfo 响应 data */
export interface PublishLogInfo {
  unPublishedVersion?: PublishVersion | null;
  publishedVersions?: PublishVersion[];
  targetRegion?: string;
  /** 预览地址 */
  previewUrl?: string;
  /** 线上地址 */
  publishUrl?: string;
}

/** publishNewLogV2 响应 data：旧版为 boolean，新版为含地址的对象 */
export type PublishNewLogResult =
  | boolean
  | {
      previewUrl?: string;
      publishUrl?: string;
    };

/** 附件树叶子节点：仅记录比较所需的字段 */
export interface AttachmentMeta {
  rowKey: string;
  /** 拉取时文件内容的 sha256，push 时用于判断本地是否修改过 */
  hash?: string;
}

/** 附件树：key 为文件/目录名，目录为嵌套子树，文件为 AttachmentMeta 叶子 */
export interface AttachmentTree {
  [name: string]: AttachmentTree | AttachmentMeta;
}

/** pull 后记录在 .sxq/attachments.json 的清单，push 合并时使用 */
export interface AttachmentManifest {
  sessionId: string;
  pulledAt: string;
  tree: AttachmentTree;
  /** pull 合并时写入了冲突标记、尚未确认解决的文件；push 只对这些文件做残留标记检查 */
  conflicts?: string[];
}

/** supabaseExecuteMigration 请求参数（执行数据库迁移） */
export interface SupabaseMigrationParams {
  sessionId: string;
  /** 迁移文件名（附件全路径，如 supabase/migrations/20260709120000_xxx.sql） */
  fileName: string;
  /** 迁移文件内容（DDL SQL） */
  content: string;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** supabaseExecuteMigration 响应 data */
export interface SupabaseMigrationResult {
  success: boolean;
  errorMsg?: string;
}

/** pageQuerySessionByLastId 请求参数（keyword 精确匹配 sessionId 或模糊匹配项目名） */
export interface PageQuerySessionParams {
  pageSize: number;
  keyword?: string;
  idLT?: number;
  modes?: string[];
  workspaceId?: string;
  accId?: number;
  userId?: number;
  __product?: number;
  orgId?: number;
}

/** 会话信息（pageQuerySessionByLastId 返回项，仅声明 CLI 使用的字段；时间为毫秒时间戳） */
export interface SessionInfo {
  id: number;
  sessionId: string;
  /** 会话主题（项目名） */
  topic?: string;
  sessionKey?: string;
  ownerId?: string;
  ownerName?: string;
  ownerType?: string;
  /** 项目阶段: 1初始 2演示 3研发 4运营 5上线 */
  stage?: number;
  /** 状态 0初始化 1运行中 2暂停 3结束 -1异常结束 4 pending */
  status?: number;
  /** 分享状态 0未公开 1公开 */
  publicStatus?: number;
  /** 归档状态 0未归档 1已归档 2归档恢复中 */
  archiveStatus?: number;
  previewImage?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 分页结果 */
export interface PageResult<T> {
  data: T[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
}

/** 本地项目配置 */
export interface ProjectConfig {
  sessionId: string;
  linkedAt: string;
  /** link 时从服务端取回的会话信息快照 */
  session?: SessionInfo;
}

/** 全局配置 */
export interface GlobalConfig {
  token?: string;
  apiBase: string;
  serviceChain?: string;
  /** 预发环境网关 cookie，设置后随请求以 Cookie: TSID=xxx 携带 */
  tsid?: string;
  /** 界面语言 zh/en，未设置时按环境变量自动检测 */
  lang?: string;
  /** 上次检查新版本的时间（毫秒时间戳），每日提示用 */
  lastUpdateCheckAt?: number;
}
