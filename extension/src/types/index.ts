// 文章基础信息（article-list Content Script 返回）
export interface ArticleInfo {
  articleId: string        // 从留言页 URL query param 中提取（如 ?appmsgid=xxx）
  articleTitle: string     // 文章标题
  commentPageUrl: string   // 留言管理页完整 URL
}

// 单条留言
export interface Comment {
  id: string        // 留言唯一 ID（DOM data 属性；若不存在则合成为 articleId_index）
  author: string    // 用户昵称
  content: string   // 留言内容
  timestamp: string // 发布时间
}

// 文章及其留言（汇总结构）
export interface ArticleComments {
  articleId: string
  articleTitle: string
  commentPageUrl: string
  comments: Comment[]
}

// 单条违规结果
export interface AnalysisResult {
  commentId: string
  articleId: string
  isViolation: boolean
  reason: string
}

// ===== 消息协议类型 =====

// Popup → Background：请求获取文章列表（用于展示选择界面）
export interface FetchArticleListMessage {
  type: 'fetchArticleList'
}

// Popup → Background：开始检测，携带用户选中的文章
export interface StartDetectMessage {
  type: 'startDetect'
  articles: ArticleInfo[]
}

// Background → Content Script：获取文章列表
export interface GetArticleListMessage {
  type: 'getArticleList'
}

// Content Script → Background (sendResponse)：文章列表结果
export interface ArticleListMessage {
  type: 'articleList'
  articles: ArticleInfo[]
}

// Content Script → Background (sendMessage)：留言数据
export interface CommentsDataMessage {
  type: 'commentsData'
  articleId: string
  comments: Comment[]
}

// Background → Popup：检测进度
export interface ProgressMessage {
  type: 'progress'
  current: number
  total: number
  articleTitle: string
}

// Background → Popup：检测完成，返回结果
export interface ShowResultsMessage {
  type: 'showResults'
  articles: ArticleComments[]
  results: AnalysisResult[]
}

// Background → Popup：错误通知
export interface ErrorMessage {
  type: 'error'
  message: string
  fatal?: boolean  // true = 中止检测；false/undefined = 非致命，继续检测
}

export type ExtMessage =
  | FetchArticleListMessage
  | StartDetectMessage
  | GetArticleListMessage
  | ArticleListMessage
  | CommentsDataMessage
  | ProgressMessage
  | ShowResultsMessage
  | ErrorMessage
