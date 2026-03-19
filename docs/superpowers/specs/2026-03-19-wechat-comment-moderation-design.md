# 微信公众号违规留言检测插件 — 设计文档

**日期：** 2026-03-19
**状态：** 已确认
**技术栈：** React（浏览器插件）+ Go（后端服务）+ 通义千问（AI 分析）

---

## 1. 项目目标

构建一个 Chrome 浏览器插件，供内部管理员在微信公众平台（mp.weixin.qq.com）使用。用户在"发表记录"页面触发检测，插件自动抓取最新几篇文章的全部留言，发送至本地 Go 后端，通过通义千问大模型判断每条留言是否违规，最终在插件界面展示结果。

---

## 2. MVP 范围

**当前阶段包含：**
- 在"发表记录"页面一键触发检测
- 从最新文章开始，依次抓取前 N 篇（默认 3 篇，用户可调整）的留言
- 调用通义千问批量分析违规内容
- 插件展示：全部留言（按文章分组）+ 违规留言列表

**当前阶段不包含：**
- 按时间/标题筛选文章（后期迭代）
- 删除违规留言（后期迭代）
- 历史检测记录（后期迭代）
- 文章列表多选（后期迭代）

---

## 3. 系统架构

### 3.1 整体流程

```
用户在"发表记录"页面
        │
        ▼
点击插件「开始检测」按钮（Popup）
→ 发送 startDetect 消息给 Background（携带 n=检测篇数）
        │
        ▼
Background 向"发表记录"Tab 发送消息
→ article-list Content Script 读取页面文章列表 DOM
→ 返回前 N 篇文章的 { title, commentPageUrl } 列表
        │
        ▼
Background 依次处理每篇文章：
  1. 用 chrome.tabs.create 打开文章留言管理页（`{ active: false }` 后台 Tab，不抢占焦点）
  2. Tab 加载完成后，用 chrome.scripting.executeScript 注入 comment Content Script
  3. Content Script 抓取留言数据，通过 chrome.runtime.sendMessage 回传
  4. Background 收到数据后关闭该 Tab
  5. 向 Popup 发送 progress 进度消息（当前第几篇/共几篇）
  6. 重复，直到所有文章处理完毕
        │
        ▼
Background 汇总所有留言 → HTTP POST http://localhost:8080/api/analyze
        │
        ▼
Go 后端调用通义千问分析，返回逐条判断结果
        │
        ▼
Background 接收结果 → 发送 showResults 消息 → Popup 更新 UI
```

### 3.2 插件脚本职责

| 脚本 | 注入页面 | 职责 |
|------|---------|------|
| **Popup（React）** | 插件弹窗 | 配置检测篇数、触发检测、显示进度、展示结果 |
| **Background Script** | 无（Service Worker）| 流程协调、Tab 管理、HTTP 请求后端 |
| **article-list Content Script** | `mp.weixin.qq.com/cgi-bin/appmsg*`（发表记录页） | 读取文章列表 DOM，返回文章标题和留言页 URL |
| **comment Content Script** | `mp.weixin.qq.com/cgi-bin/comment*`（留言管理页） | 抓取留言列表 DOM，返回留言数组 |

### 3.3 消息协议

| 消息名 | 方向 | payload |
|--------|------|---------|
| `startDetect` | Popup → Background | `{ n: number }` |
| `getArticleList` | Background → article-list Content Script | `{ n: number }` |
| `articleList` | article-list Content Script → Background | `{ articles: ArticleInfo[] }` |
| `commentsData` | comment Content Script → Background | `{ articleId: string, comments: Comment[] }` |
| `progress` | Background → Popup | `{ current: number, total: number, articleTitle: string }` |
| `showResults` | Background → Popup | `{ articles: ArticleComments[], results: AnalysisResult[] }` |
| `error` | Background → Popup | `{ message: string }` |

---

## 4. 目录结构

```
gzh_demo/
├── extension/                    # 浏览器插件（React + TypeScript）
│   ├── public/
│   │   └── manifest.json         # Chrome 插件配置（Manifest V3）
│   ├── src/
│   │   ├── background/
│   │   │   └── index.ts          # Background Service Worker：流程协调
│   │   ├── content/
│   │   │   ├── articleList.ts    # 注入发表记录页，读取文章列表
│   │   │   └── comments.ts       # 注入留言管理页，抓取留言
│   │   ├── popup/
│   │   │   ├── App.tsx           # Popup 主界面
│   │   │   └── main.tsx          # 入口
│   │   └── types/
│   │       └── index.ts          # 共享类型定义
│   ├── package.json
│   └── vite.config.ts            # 多入口配置（popup、background、两个 content scripts）
│
└── backend/                      # Go 后端服务
    ├── main.go                   # 服务入口，启动 HTTP 服务（含 CORS 中间件）
    ├── handler/
    │   └── analyze.go            # POST /api/analyze 接口处理
    ├── service/
    │   └── tongyi.go             # 通义千问 API 封装（Key 暂时留空）
    └── go.mod
```

---

## 5. Manifest 配置

```json
{
  "manifest_version": 3,
  "name": "公众号违规留言检测",
  "version": "0.1.0",
  "permissions": ["tabs", "scripting"],
  "host_permissions": [
    "https://mp.weixin.qq.com/*",
    "http://localhost:8080/*"
  ],
  "background": {
    "service_worker": "background/index.js"
  },
  "action": {
    "default_popup": "popup/index.html"
  },
  "content_scripts": [
    {
      "matches": ["https://mp.weixin.qq.com/cgi-bin/appmsg*"],
      "js": ["content/articleList.js"]
    }
  ]
}
```

> comment Content Script 通过 `chrome.scripting.executeScript` 动态注入，无需在 `content_scripts` 中声明。

---

## 6. 数据结构

### 6.1 共享类型（TypeScript）

```typescript
// 文章基础信息（article-list Content Script 返回）
interface ArticleInfo {
  articleId: string        // 从留言页 URL 中提取的 query param（如 ?appmsgid=xxx）
  articleTitle: string     // 文章标题（DOM 中读取）
  commentPageUrl: string   // 留言管理页完整 URL
}

// 单条留言
interface Comment {
  id: string        // 留言唯一 ID（从 DOM data 属性读取；若不存在则用 articleId_index 合成）
  author: string    // 用户昵称
  content: string   // 留言内容
  timestamp: string // 发布时间
}

// 文章及其留言（汇总结构）
interface ArticleComments {
  articleId: string
  articleTitle: string
  commentPageUrl: string
  comments: Comment[]
}

// 检测配置（Popup → Background）
interface DetectionConfig {
  n: number  // 检测篇数，默认 3
}

// 单条违规结果
interface AnalysisResult {
  commentId: string    // 对应留言 ID
  articleId: string    // 所属文章 ID
  isViolation: boolean
  reason: string       // 违规原因（违规时填写，否则为空字符串）
}
```

### 6.2 后端 API

**`POST /api/analyze`**

请求体：
```json
{
  "articles": [
    {
      "articleId": "art_001",
      "articleTitle": "文章标题一",
      "comments": [
        {
          "id": "c1",
          "author": "张三",
          "content": "留言内容",
          "timestamp": "2026-03-19"
        }
      ]
    }
  ]
}
```

响应体：
```json
{
  "results": [
    {
      "commentId": "c1",
      "articleId": "art_001",
      "isViolation": true,
      "reason": "含侮辱性言论"
    }
  ]
}
```

**CORS：** Go 后端必须在所有响应中设置 `Access-Control-Allow-Origin: *` 以允许插件 Service Worker 的跨域请求。

---

## 7. AI 分析策略

- **模型：** 通义千问（阿里云）— API Key 暂时留空占位
- **批量处理：** 将所有留言合并为一个 Prompt，批量请求，减少 API 调用次数
- **分批策略：** 单次请求最多 50 条留言；超出时自动分批，Go 后端合并结果后统一返回
- **留言分页：** MVP 阶段仅抓取每篇文章留言管理页的第一页，翻页抓取为后期迭代
- **违规类型：** 色情、暴力、政治敏感、侮辱谩骂、广告垃圾等

**Prompt 模板（Go 生成）：**
```
请逐条判断以下留言是否违规（违规类型包括：色情、暴力、政治敏感、侮辱谩骂、广告垃圾）。
以 JSON 数组格式返回，不要有其他文字，格式如下：
[{"id":"留言ID","isViolation":true/false,"reason":"违规原因或空字符串"}]

留言列表：
[{"id":"c1","content":"内容1"},{"id":"c2","content":"内容2"}]
```

**错误处理：** 若模型返回非法 JSON，Go 后端返回 500 并附带错误信息；插件展示 "AI 分析失败，请重试"。

---

## 8. 插件 UI 设计

```
┌────────────────────────────────────┐
│  公众号违规留言检测                  │
│────────────────────────────────────│
│  检测篇数：[3] 篇（从最新开始，范围 1–10）│
│                                    │
│  [ 开始检测 ]                       │
│  ████████░░ 正在处理第 2/3 篇...    │
│────────────────────────────────────│
│  📄 全部留言                        │
│  ▼ 文章一：《xxx》（5条）            │
│    · 张三：内容...                  │
│    · 李四：内容...                  │
│  ▼ 文章二：《yyy》（3条）            │
│    · 王五：内容...                  │
│────────────────────────────────────│
│  ⚠️ 违规留言（2条）                  │
│  · 张三（《xxx》）：内容...           │
│    原因：含侮辱性言论                │
│  · 王五（《yyy》）：内容...           │
│    原因：含政治敏感内容              │
└────────────────────────────────────┘
```

**错误状态展示：**
- 未在"发表记录"页面：显示 "请先打开微信公众平台发表记录页面"
- Tab 加载失败：显示 "第 X 篇文章加载失败，已跳过"
- 后端不可达：显示 "无法连接本地服务，请确认后端已启动"
- AI 分析失败：显示 "AI 分析失败，请重试"

---

## 9. 后期迭代方向

1. 按时间范围或关键词筛选要检测的文章
2. 支持多选文章
3. 一键删除违规留言（通过模拟已登录的 HTTP 请求，微信公众平台无公开删除 API）
4. 检测历史记录（本地存储）
5. 违规类型自定义配置
