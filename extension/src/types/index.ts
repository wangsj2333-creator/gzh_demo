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

// 检测配置
export interface DetectionConfig {
  n: number  // 检测篇数，范围 1–10，默认 3
}

// 单条违规结果
export interface AnalysisResult {
  commentId: string
  articleId: string
  isViolation: boolean
  reason: string
}

// ===== 消息协议类型 =====

export interface StartDetectMessage {
  type: 'startDetect'
  n: number
}

export interface GetArticleListMessage {
  type: 'getArticleList'
  n: number
}

export interface ArticleListMessage {
  type: 'articleList'
  articles: ArticleInfo[]
}

export interface CommentsDataMessage {
  type: 'commentsData'
  articleId: string
  comments: Comment[]
}

export interface ProgressMessage {
  type: 'progress'
  current: number
  total: number
  articleTitle: string
}

export interface ShowResultsMessage {
  type: 'showResults'
  articles: ArticleComments[]
  results: AnalysisResult[]
}

export interface ErrorMessage {
  type: 'error'
  message: string
  fatal?: boolean  // true = 中止检测；false/undefined = 非致命，继续检测
}

export type ExtMessage =
  | StartDetectMessage
  | GetArticleListMessage
  | ArticleListMessage
  | CommentsDataMessage
  | ProgressMessage
  | ShowResultsMessage
  | ErrorMessage
