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
- 从最新文章开始，依次抓取前 N 篇（默认 3 篇）的留言
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
        │
        ▼
Background Script 读取当前页面文章列表
（从上往下取前 N 篇，N 默认为 3，用户可在 Popup 调整）
        │
        ▼
依次在新 Tab 打开每篇文章的留言管理页
→ Content Script 注入，自动抓取该页全部留言
→ 抓取完毕，关闭 Tab，回传数据给 Background
→ 重复，直到所有文章处理完毕
        │
        ▼
Background 汇总所有留言 → HTTP POST → Go 后端（localhost:8080）
        │
        ▼
Go 后端调用通义千问分析，返回逐条判断结果
        │
        ▼
Background 接收结果 → 通知 Popup 更新 UI
```

### 3.2 插件内部通信

插件由三个脚本协同工作：

| 脚本 | 职责 |
|------|------|
| **Popup（React）** | 用户界面：配置检测篇数、触发检测、展示结果、显示进度 |
| **Background Script** | 流程协调：读取文章列表、管理 Tab 生命周期、汇总数据、调用后端 |
| **Content Script** | 注入留言页面，抓取留言 DOM 数据，回传给 Background |

**消息通信流：**
```
Popup      --[startDetect]--> Background
Background --[open tab]-->    Content Script（留言页）
Content    --[commentsData]--> Background
Background（全部完成）--[HTTP POST]--> Go 后端
Go 后端    --[results]-->      Background
Background --[showResults]--> Popup
```

---

## 4. 目录结构

```
gzh_demo/
├── extension/                  # 浏览器插件（React + TypeScript）
│   ├── public/
│   │   └── manifest.json       # Chrome 插件配置
│   ├── src/
│   │   ├── background/
│   │   │   └── index.ts        # Background Script：流程协调
│   │   ├── content/
│   │   │   └── index.ts        # Content Script：抓取留言
│   │   ├── popup/
│   │   │   ├── App.tsx         # Popup 主界面
│   │   │   └── main.tsx        # 入口
│   │   └── types/
│   │       └── index.ts        # 共享类型定义
│   ├── package.json
│   └── vite.config.ts
│
└── backend/                    # Go 后端服务
    ├── main.go                 # 服务入口，启动 HTTP 服务
    ├── handler/
    │   └── analyze.go          # POST /api/analyze 接口处理
    ├── service/
    │   └── tongyi.go           # 通义千问 API 封装（Key 暂时留空）
    └── go.mod
```

---

## 5. 数据结构

### 5.1 共享类型（TypeScript）

```typescript
// 单条留言
interface Comment {
  id: string        // 留言唯一 ID
  author: string    // 用户昵称
  content: string   // 留言内容
  timestamp: string // 发布时间
}

// 文章及其留言
interface ArticleComments {
  articleId: string    // 文章唯一标识
  articleTitle: string // 文章标题
  url: string          // 文章留言管理页 URL
  comments: Comment[]
}

// 单条违规结果
interface AnalysisResult {
  commentId: string    // 对应留言 ID
  articleId: string    // 所属文章 ID
  isViolation: boolean
  reason: string       // 违规原因（违规时填写，否则为空）
}
```

### 5.2 后端 API

**`POST /api/analyze`**

请求体：
```json
{
  "articles": [
    {
      "articleId": "art_001",
      "articleTitle": "文章标题一",
      "comments": [
        { "id": "c1", "author": "张三", "content": "留言内容", "timestamp": "2026-03-19" }
      ]
    }
  ]
}
```

响应体：
```json
{
  "results": [
    { "commentId": "c1", "articleId": "art_001", "isViolation": true, "reason": "含侮辱性言论" }
  ]
}
```

---

## 6. AI 分析策略

- **模型：** 通义千问（阿里云）— API Key 暂时留空占位
- **批量处理：** 将所有留言合并为一个 Prompt，批量请求，减少 API 调用次数
- **违规类型：** 色情、暴力、政治敏感、侮辱谩骂、广告垃圾等
- **Prompt 结构：** 以 JSON 格式逐条返回判断结果，便于后端解析

---

## 7. 插件 UI 设计

```
┌────────────────────────────────────┐
│  公众号违规留言检测                  │
│────────────────────────────────────│
│  检测篇数：[3] 篇（从最新开始）      │
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

---

## 8. 后期迭代方向

1. 按时间范围或关键词筛选要检测的文章
2. 支持多选文章
3. 一键删除违规留言（调用微信公众平台 API）
4. 检测历史记录（本地存储）
5. 违规类型自定义配置
