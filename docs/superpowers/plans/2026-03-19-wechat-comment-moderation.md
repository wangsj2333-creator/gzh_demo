# 微信公众号违规留言检测插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Chrome 浏览器插件，在微信公众平台"发表记录"页面触发，自动抓取最新 N 篇文章的留言，通过本地 Go 后端调用通义千问 AI 判断违规内容，并在插件界面展示结果。

**Architecture:** 插件由三个脚本组成（article-list Content Script、comment Content Script、Background Service Worker）和一个 React Popup。Background 协调整个抓取流程，最终将留言数据 POST 到本地 Go 服务；Go 服务调用通义千问 API 后返回违规分析结果。

**Tech Stack:** Chrome Extension Manifest V3, React 18, TypeScript, Vite（多入口构建）, Go 1.21+, 通义千问 API（阿里云 DashScope）

---

## 文件清单

### 后端（backend/）
| 文件 | 职责 |
|------|------|
| `backend/go.mod` | Go 模块定义 |
| `backend/main.go` | HTTP 服务入口，CORS 中间件，路由注册 |
| `backend/handler/analyze.go` | POST /api/analyze 接口，参数解析，调用 service |
| `backend/service/tongyi.go` | 通义千问 API 调用，Prompt 构建，批次分割，JSON 解析 |
| `backend/handler/analyze_test.go` | analyze handler 单元测试 |
| `backend/service/tongyi_test.go` | tongyi service 单元测试 |

### 插件（extension/）
| 文件 | 职责 |
|------|------|
| `extension/public/manifest.json` | Chrome 插件配置（权限、入口、content scripts） |
| `extension/vite.config.ts` | Vite 多入口构建（popup、background、两个 content scripts） |
| `extension/package.json` | 依赖声明 |
| `extension/tsconfig.json` | TypeScript 配置 |
| `extension/src/types/index.ts` | 共享 TypeScript 类型定义 |
| `extension/src/content/articleList.ts` | 注入发表记录页，读取文章列表 DOM |
| `extension/src/content/comments.ts` | 注入留言管理页，抓取留言 DOM |
| `extension/src/background/index.ts` | Background Service Worker，协调全流程 |
| `extension/src/popup/main.tsx` | Popup 入口 |
| `extension/src/popup/App.tsx` | Popup 主界面（配置、进度、结果展示） |

---

## Task 1: Go 后端 — 初始化项目与 HTTP 服务框架

**Files:**
- Create: `backend/go.mod`
- Create: `backend/main.go`

- [ ] **Step 1: 初始化 Go 模块**

```bash
cd C:/Internship/gzh_demo
mkdir backend
cd backend
go mod init gzh_demo/backend
```

Expected: 生成 `backend/go.mod`，内容包含 `module gzh_demo/backend`

- [ ] **Step 2: 创建 main.go — HTTP 服务 + CORS**

创建 `backend/main.go`（路由注册暂时为空，handler 包在 Task 2 创建后再添加）：

```go
package main

import (
	"log"
	"net/http"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	// routes will be added in Task 2

	log.Println("Backend running on http://localhost:8080")
	if err := http.ListenAndServe(":8080", corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 3: 编译验证**

```bash
cd C:/Internship/gzh_demo/backend
go build ./...
```

Expected: 编译成功，无报错。

- [ ] **Step 4: 提交**

```bash
cd C:/Internship/gzh_demo
git add backend/
git commit -m "feat(backend): initialize Go module and HTTP server with CORS"
```

---

## Task 2: Go 后端 — tongyi service（含测试）

**Files:**
- Create: `backend/service/tongyi.go`
- Create: `backend/service/tongyi_test.go`

先实现 service 层，这样 handler 测试在 Task 3 中可以直接编译运行。

- [ ] **Step 1: 先写测试**

创建 `backend/service/tongyi_test.go`：

```go
package service

import (
	"strings"
	"testing"
)

func TestBuildPrompt(t *testing.T) {
	comments := []CommentInput{
		{ArticleID: "art1", ID: "c1", Content: "这是正常留言"},
		{ArticleID: "art1", ID: "c2", Content: "侮辱性内容"},
	}
	prompt := buildPrompt(comments)
	if prompt == "" {
		t.Fatal("prompt should not be empty")
	}
	if !strings.Contains(prompt, "c1") || !strings.Contains(prompt, "c2") {
		t.Error("prompt should contain comment IDs")
	}
}

func TestParseAIResponse_Valid(t *testing.T) {
	raw := `[{"id":"c1","isViolation":false,"reason":""},{"id":"c2","isViolation":true,"reason":"含侮辱性言论"}]`
	results, err := parseAIResponse(raw, []CommentInput{
		{ArticleID: "art1", ID: "c1"},
		{ArticleID: "art1", ID: "c2"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[1].IsViolation != true || results[1].Reason != "含侮辱性言论" {
		t.Errorf("unexpected result: %+v", results[1])
	}
}

func TestParseAIResponse_InvalidJSON(t *testing.T) {
	_, err := parseAIResponse("not json", nil)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseAIResponse_WithPreamble(t *testing.T) {
	// 模型可能在 JSON 前后添加说明文字
	raw := `这是分析结果：[{"id":"c1","isViolation":false,"reason":""}] 以上。`
	results, err := parseAIResponse(raw, []CommentInput{{ArticleID: "art1", ID: "c1"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
}

func TestSplitBatches(t *testing.T) {
	comments := make([]CommentInput, 120)
	batches := splitBatches(comments, 50)
	if len(batches) != 3 {
		t.Errorf("expected 3 batches, got %d", len(batches))
	}
	if len(batches[0]) != 50 || len(batches[1]) != 50 || len(batches[2]) != 20 {
		t.Errorf("unexpected batch sizes: %d %d %d", len(batches[0]), len(batches[1]), len(batches[2]))
	}
}

func TestSplitBatches_SmallInput(t *testing.T) {
	comments := make([]CommentInput, 3)
	batches := splitBatches(comments, 50)
	if len(batches) != 1 || len(batches[0]) != 3 {
		t.Errorf("expected 1 batch of 3, got %d batches", len(batches))
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd C:/Internship/gzh_demo/backend
go test ./service/... -v
```

Expected: FAIL — `service` 包不存在

- [ ] **Step 3: 实现 tongyi.go**

创建 `backend/service/tongyi.go`：

```go
package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const (
	tongyiAPIURL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
	tongyiAPIKey = "" // TODO: 填入通义千问 API Key
	batchSize    = 50
)

// CommentInput 是 service 层接收的留言结构
type CommentInput struct {
	ArticleID string
	ID        string
	Content   string
}

// CommentResult 是 service 层返回的分析结果
type CommentResult struct {
	CommentID   string
	ArticleID   string
	IsViolation bool
	Reason      string
}

// AnalyzeComments 对所有留言进行违规分析，自动分批处理
func AnalyzeComments(comments []CommentInput) ([]CommentResult, error) {
	batches := splitBatches(comments, batchSize)
	var allResults []CommentResult
	for _, batch := range batches {
		results, err := analyzeBatch(batch)
		if err != nil {
			return nil, err
		}
		allResults = append(allResults, results...)
	}
	return allResults, nil
}

func analyzeBatch(comments []CommentInput) ([]CommentResult, error) {
	prompt := buildPrompt(comments)
	raw, err := callTongyi(prompt)
	if err != nil {
		return nil, err
	}
	return parseAIResponse(raw, comments)
}

func buildPrompt(comments []CommentInput) string {
	type item struct {
		ID      string `json:"id"`
		Content string `json:"content"`
	}
	items := make([]item, len(comments))
	for i, c := range comments {
		items[i] = item{ID: c.ID, Content: c.Content}
	}
	b, _ := json.Marshal(items)

	return fmt.Sprintf(`请逐条判断以下留言是否违规（违规类型包括：色情、暴力、政治敏感、侮辱谩骂、广告垃圾）。
以 JSON 数组格式返回，不要有其他文字，格式如下：
[{"id":"留言ID","isViolation":true,"reason":"违规原因"},{"id":"留言ID","isViolation":false,"reason":""}]

留言列表：
%s`, string(b))
}

func callTongyi(prompt string) (string, error) {
	if tongyiAPIKey == "" {
		// API Key 未配置时返回空数组（开发阶段 stub）
		return `[]`, nil
	}

	reqBody := map[string]interface{}{
		"model": "qwen-turbo",
		"input": map[string]interface{}{
			"messages": []map[string]string{
				{"role": "user", "content": prompt},
			},
		},
	}
	b, _ := json.Marshal(reqBody)

	req, err := http.NewRequest(http.MethodPost, tongyiAPIURL, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+tongyiAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tongyi API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if len(result.Output.Choices) == 0 {
		return "", errors.New("empty response from tongyi")
	}
	return result.Output.Choices[0].Message.Content, nil
}

type aiItem struct {
	ID          string `json:"id"`
	IsViolation bool   `json:"isViolation"`
	Reason      string `json:"reason"`
}

func parseAIResponse(raw string, comments []CommentInput) ([]CommentResult, error) {
	// 找到 JSON 数组部分（模型可能在前后添加文字）
	start := strings.Index(raw, "[")
	end := strings.LastIndex(raw, "]")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("no JSON array found in AI response: %s", raw)
	}
	raw = raw[start : end+1]

	var items []aiItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, fmt.Errorf("failed to parse AI response JSON: %w", err)
	}

	// 构建 id → articleId 映射
	idToArticle := make(map[string]string, len(comments))
	for _, c := range comments {
		idToArticle[c.ID] = c.ArticleID
	}

	results := make([]CommentResult, len(items))
	for i, item := range items {
		results[i] = CommentResult{
			CommentID:   item.ID,
			ArticleID:   idToArticle[item.ID],
			IsViolation: item.IsViolation,
			Reason:      item.Reason,
		}
	}
	return results, nil
}

func splitBatches(comments []CommentInput, size int) [][]CommentInput {
	var batches [][]CommentInput
	for size < len(comments) {
		comments, batches = comments[size:], append(batches, comments[:size])
	}
	return append(batches, comments)
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd C:/Internship/gzh_demo/backend
go test ./service/... -v
```

Expected: 所有 service 测试 PASS

- [ ] **Step 5: 提交**

```bash
cd C:/Internship/gzh_demo
git add backend/service/
git commit -m "feat(backend): add tongyi service with prompt building, batching, and JSON parsing"
```

---

## Task 3: Go 后端 — analyze handler（含测试）

**Files:**
- Create: `backend/handler/analyze.go`
- Create: `backend/handler/analyze_test.go`
- Modify: `backend/main.go`（添加路由注册）

- [ ] **Step 1: 先写测试**

创建 `backend/handler/analyze_test.go`：

```go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAnalyze_ValidRequest(t *testing.T) {
	body := map[string]interface{}{
		"articles": []map[string]interface{}{
			{
				"articleId":    "art_001",
				"articleTitle": "测试文章",
				"comments": []map[string]interface{}{
					{"id": "c1", "author": "张三", "content": "正常留言", "timestamp": "2026-03-19"},
				},
			},
		},
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	Analyze(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp AnalyzeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	// API Key 为空时 service 返回空数组，results 应为空 slice 而非 nil
	if resp.Results == nil {
		t.Fatal("results should be an empty slice, not nil")
	}
}

func TestAnalyze_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	Analyze(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestAnalyze_EmptyArticles(t *testing.T) {
	body := map[string]interface{}{"articles": []interface{}{}}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	Analyze(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd C:/Internship/gzh_demo/backend
go test ./handler/... -v
```

Expected: FAIL — `handler` 包不存在

- [ ] **Step 3: 实现 analyze handler**

创建 `backend/handler/analyze.go`：

```go
package handler

import (
	"encoding/json"
	"net/http"

	"gzh_demo/backend/service"
)

// 请求数据结构
type Comment struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
}

type ArticleRequest struct {
	ArticleID    string    `json:"articleId"`
	ArticleTitle string    `json:"articleTitle"`
	Comments     []Comment `json:"comments"`
}

type AnalyzeRequest struct {
	Articles []ArticleRequest `json:"articles"`
}

// 响应数据结构
type AnalysisResult struct {
	CommentID   string `json:"commentId"`
	ArticleID   string `json:"articleId"`
	IsViolation bool   `json:"isViolation"`
	Reason      string `json:"reason"`
}

type AnalyzeResponse struct {
	Results []AnalysisResult `json:"results"`
}

type flatComment struct {
	articleID string
	comment   Comment
}

func Analyze(w http.ResponseWriter, r *http.Request) {
	var req AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 收集所有留言，附带 articleId
	var flat []flatComment
	for _, art := range req.Articles {
		for _, c := range art.Comments {
			flat = append(flat, flatComment{articleID: art.ArticleID, comment: c})
		}
	}

	// 调用 AI 服务
	aiResults, err := service.AnalyzeComments(flatToService(flat))
	if err != nil {
		http.Error(w, "AI analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 组装响应（确保返回空数组而非 null）
	results := make([]AnalysisResult, 0, len(aiResults))
	for _, r := range aiResults {
		results = append(results, AnalysisResult{
			CommentID:   r.CommentID,
			ArticleID:   r.ArticleID,
			IsViolation: r.IsViolation,
			Reason:      r.Reason,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AnalyzeResponse{Results: results})
}

func flatToService(flat []flatComment) []service.CommentInput {
	out := make([]service.CommentInput, len(flat))
	for i, f := range flat {
		out[i] = service.CommentInput{
			ArticleID: f.articleID,
			ID:        f.comment.ID,
			Content:   f.comment.Content,
		}
	}
	return out
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd C:/Internship/gzh_demo/backend
go test ./handler/... -v
```

Expected: 所有 handler 测试 PASS

- [ ] **Step 5: 运行全部后端测试**

```bash
cd C:/Internship/gzh_demo/backend
go test ./... -v
```

Expected: 所有测试 PASS

- [ ] **Step 6: 将路由注册添加到 main.go**

编辑 `backend/main.go`，在 import 中添加 `"gzh_demo/backend/handler"`，并注册路由：

```go
package main

import (
	"log"
	"net/http"

	"gzh_demo/backend/handler"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/analyze", handler.Analyze)

	log.Println("Backend running on http://localhost:8080")
	if err := http.ListenAndServe(":8080", corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 7: 启动后端手动验证**

```bash
cd C:/Internship/gzh_demo/backend
go run main.go
```

另开终端（单行命令，避免 Windows bash 换行问题）：

```bash
curl -X POST http://localhost:8080/api/analyze -H "Content-Type: application/json" -d "{\"articles\":[{\"articleId\":\"a1\",\"articleTitle\":\"测试\",\"comments\":[{\"id\":\"c1\",\"author\":\"张三\",\"content\":\"hello\",\"timestamp\":\"2026-03-19\"}]}]}"
```

Expected: `{"results":[]}` — API Key 为空时返回空结果，这是预期行为。

- [ ] **Step 8: 提交**

```bash
cd C:/Internship/gzh_demo
git add backend/
git commit -m "feat(backend): add analyze handler and wire routes in main.go"
```

---

## Task 4: 插件 — 项目脚手架

**Files:**
- Create: `extension/package.json`
- Create: `extension/vite.config.ts`
- Create: `extension/tsconfig.json`
- Create: `extension/public/manifest.json`
- Create: `extension/popup.html`

- [ ] **Step 1: 初始化 extension 项目**

```bash
cd C:/Internship/gzh_demo
mkdir extension
cd extension
npx create-vite@latest . --template react-ts
```

如果提示 "Current directory is not empty"，选择 `Ignore files and continue`。

如果命令失败（Windows 环境），手动创建 `extension/package.json`：

```json
{
  "name": "gzh-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.300",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "~5.6.2",
    "vite": "^6.0.5"
  }
}
```

以及 `extension/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd C:/Internship/gzh_demo/extension
npm install
npm install -D @types/chrome
```

- [ ] **Step 3: 替换 vite.config.ts — 多入口构建**

将 `extension/vite.config.ts` 完全替换为：

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        articleList: resolve(__dirname, 'src/content/articleList.ts'),
        comments: resolve(__dirname, 'src/content/comments.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          // HTML 入口（popup）不走此规则，JS 入口按名称输出
          return '[name]/index.js'
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
```

> **输出路径说明：**
> - `popup.html` 是 HTML 入口，Vite 构建后输出为 `dist/popup.html`（根目录，不进子目录）
> - JS 入口输出为：`dist/background/index.js`、`dist/articleList/index.js`、`dist/comments/index.js`
> - manifest.json 中的路径需与此对应（见 Step 5）

- [ ] **Step 4: 创建 popup.html**

在 `extension/` 根目录创建 `popup.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>公众号违规留言检测</title>
  <style>body { width: 400px; min-height: 300px; margin: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/popup/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: 创建 manifest.json**

创建 `extension/public/manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "公众号违规留言检测",
  "version": "0.1.0",
  "description": "检测微信公众号文章留言中的违规内容",
  "permissions": ["tabs", "scripting"],
  "host_permissions": [
    "https://mp.weixin.qq.com/*",
    "http://localhost:8080/*"
  ],
  "background": {
    "service_worker": "background/index.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "违规留言检测"
  },
  "content_scripts": [
    {
      "matches": ["https://mp.weixin.qq.com/cgi-bin/appmsg*"],
      "js": ["articleList/index.js"]
    }
  ]
}
```

> **路径说明：** `popup.html` 在 `dist/` 根目录；`background/index.js` 和 `articleList/index.js` 在对应子目录。`comments/index.js` 通过 `executeScript` 动态注入，不在 manifest 中声明。

- [ ] **Step 6: 删除 Vite 默认生成的无用文件**

```bash
cd C:/Internship/gzh_demo/extension
rm -rf src/App.css src/App.tsx src/index.css src/assets src/main.tsx
```

- [ ] **Step 7: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/
git commit -m "feat(extension): scaffold Vite multi-entry Chrome extension project"
```

---

## Task 5: 插件 — 共享类型定义

**Files:**
- Create: `extension/src/types/index.ts`

- [ ] **Step 1: 创建类型文件**

创建 `extension/src/types/index.ts`：

```typescript
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
```

- [ ] **Step 2: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/src/types/
git commit -m "feat(extension): add shared TypeScript types and message protocol"
```

---

## Task 6: 插件 — article-list Content Script

**Files:**
- Create: `extension/src/content/articleList.ts`

此脚本注入"发表记录"页面（`mp.weixin.qq.com/cgi-bin/appmsg`），监听来自 Background 的 `getArticleList` 消息，读取 DOM 返回文章列表。

- [ ] **Step 1: 了解目标页面结构（必须手动操作）**

在浏览器中打开微信公众平台"发表记录"页面，打开 DevTools → Elements，找到：
- 文章列表的容器选择器（每行文章）
- 文章标题的选择器
- 留言管理链接的选择器（含 `/cgi-bin/comment` 的 `<a>` 标签）

记录下选择器，用于实现 `extractArticles` 函数。示例选择器（**需根据实际页面调整**）：
- 文章行：`.weui-desktop-mass-appmsg__bd` 或 `tr`
- 标题：`.weui-desktop-mass-appmsg__title a`
- 留言链接：`a[href*="/cgi-bin/comment"]`

- [ ] **Step 2: 实现 articleList.ts**

创建 `extension/src/content/articleList.ts`：

```typescript
import type { GetArticleListMessage, ArticleListMessage, ArticleInfo } from '../types'

chrome.runtime.onMessage.addListener(
  (message: GetArticleListMessage, _sender, sendResponse) => {
    if (message.type !== 'getArticleList') return false

    const articles = extractArticles(message.n)
    const response: ArticleListMessage = { type: 'articleList', articles }
    sendResponse(response)
    return true
  }
)

function extractArticles(n: number): ArticleInfo[] {
  const results: ArticleInfo[] = []

  // ⚠️ 以下选择器需根据实际页面 DOM 调整
  // 在 DevTools 中检查文章列表页面的真实元素结构
  const rows = document.querySelectorAll('.weui-desktop-mass-appmsg__bd')

  for (let i = 0; i < Math.min(n, rows.length); i++) {
    const row = rows[i]

    const titleEl = row.querySelector('.weui-desktop-mass-appmsg__title a') as HTMLAnchorElement | null
    const articleTitle = titleEl?.textContent?.trim() ?? `文章${i + 1}`

    const commentLinks = Array.from(row.querySelectorAll('a')) as HTMLAnchorElement[]
    const commentLink = commentLinks.find(a => a.href.includes('/cgi-bin/comment'))
    if (!commentLink) continue

    const url = new URL(commentLink.href)
    const articleId = url.searchParams.get('appmsgid') ?? `art_${i}`

    results.push({ articleId, articleTitle, commentPageUrl: commentLink.href })
  }

  return results
}
```

- [ ] **Step 3: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/src/content/articleList.ts
git commit -m "feat(extension): add article-list content script"
```

---

## Task 7: 插件 — comments Content Script

**Files:**
- Create: `extension/src/content/comments.ts`

此脚本通过 `chrome.scripting.executeScript` 动态注入留言管理页，抓取留言后通过 `chrome.runtime.sendMessage` 回传给 Background。

> **路径说明：** Background 中调用 `executeScript` 时传入 `files: ['comments/index.js']`。Chrome 将此路径相对于插件根目录（即 `dist/`）解析，因此实际加载的是 `dist/comments/index.js`。这与 Vite 构建输出路径一致。

- [ ] **Step 1: 了解留言页 DOM 结构（必须手动操作）**

在微信公众平台打开任意文章的留言管理页，打开 DevTools → Elements，找到：
- 每条留言的容器元素选择器
- 用户昵称的选择器
- 留言内容的选择器
- 发布时间的选择器
- 留言唯一 ID（data 属性名称）

- [ ] **Step 2: 实现 comments.ts**

创建 `extension/src/content/comments.ts`：

```typescript
import type { CommentsDataMessage, Comment } from '../types'

function getArticleIdFromUrl(): string {
  const url = new URL(window.location.href)
  return url.searchParams.get('appmsgid') ?? url.searchParams.get('id') ?? 'unknown'
}

function extractComments(articleId: string): Comment[] {
  const comments: Comment[] = []

  // ⚠️ 以下选择器需根据实际页面 DOM 调整
  const items = document.querySelectorAll('.weui-desktop-comment__item')

  items.forEach((item, index) => {
    const id = item.getAttribute('data-comment-id') ?? `${articleId}_${index}`
    const authorEl = item.querySelector('.weui-desktop-comment__nickname')
    const contentEl = item.querySelector('.weui-desktop-comment__content')
    const timeEl = item.querySelector('.weui-desktop-comment__time')

    comments.push({
      id,
      author: authorEl?.textContent?.trim() ?? '未知用户',
      content: contentEl?.textContent?.trim() ?? '',
      timestamp: timeEl?.textContent?.trim() ?? '',
    })
  })

  return comments
}

const articleId = getArticleIdFromUrl()
const comments = extractComments(articleId)

const message: CommentsDataMessage = { type: 'commentsData', articleId, comments }
chrome.runtime.sendMessage(message)
```

- [ ] **Step 3: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/src/content/comments.ts
git commit -m "feat(extension): add comments content script"
```

---

## Task 8: 插件 — Background Service Worker

**Files:**
- Create: `extension/src/background/index.ts`

- [ ] **Step 1: 实现 background/index.ts**

创建 `extension/src/background/index.ts`：

```typescript
import type {
  StartDetectMessage,
  ArticleListMessage,
  CommentsDataMessage,
  ArticleComments,
  AnalysisResult,
  ExtMessage,
} from '../types'

const BACKEND_URL = 'http://localhost:8080/api/analyze'

// 使用 Port 连接 Popup，支持流式推送进度和结果
let popupPort: chrome.runtime.Port | null = null

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port
    port.onDisconnect.addListener(() => { popupPort = null })
  }
})

chrome.runtime.onMessage.addListener((message: ExtMessage) => {
  if (message.type === 'startDetect') {
    handleStartDetect(message as StartDetectMessage).catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  }
  return false
})

async function handleStartDetect(message: StartDetectMessage): Promise<void> {
  const { n } = message

  // Step 1: 确认当前 Tab 是发表记录页
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id || !activeTab.url?.includes('mp.weixin.qq.com/cgi-bin/appmsg')) {
    sendToPopup({ type: 'error', message: '请先打开微信公众平台发表记录页面', fatal: true })
    return
  }

  // Step 2: 获取文章列表
  let articleListResponse: ArticleListMessage
  try {
    articleListResponse = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'getArticleList',
      n,
    }) as ArticleListMessage
  } catch {
    sendToPopup({ type: 'error', message: '无法读取文章列表，请刷新页面后重试', fatal: true })
    return
  }

  const articles = articleListResponse.articles
  if (articles.length === 0) {
    sendToPopup({ type: 'error', message: '未找到文章，请确认当前在发表记录页面', fatal: true })
    return
  }

  // Step 3: 依次抓取每篇文章的留言
  const collectedArticles: ArticleComments[] = []

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i]
    sendToPopup({
      type: 'progress',
      current: i + 1,
      total: articles.length,
      articleTitle: art.articleTitle,
    })

    let tab: chrome.tabs.Tab | null = null
    try {
      tab = await chrome.tabs.create({ url: art.commentPageUrl, active: false })
      const tabId = tab.id!

      await waitForTabLoad(tabId)

      // 注入 comment content script（路径相对于插件根目录 dist/）
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['comments/index.js'],
      })

      const commentsData = await waitForCommentsData(tabId, 10000)

      collectedArticles.push({
        articleId: art.articleId,
        articleTitle: art.articleTitle,
        commentPageUrl: art.commentPageUrl,
        comments: commentsData.comments,
      })
    } catch (err) {
      // 单篇失败不中止整体流程，记录空留言并通知用户
      collectedArticles.push({
        articleId: art.articleId,
        articleTitle: art.articleTitle,
        commentPageUrl: art.commentPageUrl,
        comments: [],
      })
      sendToPopup({
        type: 'error',
        message: `第 ${i + 1} 篇文章（${art.articleTitle}）加载失败，已跳过`,
        fatal: false,
      })
    } finally {
      if (tab?.id) {
        chrome.tabs.remove(tab.id).catch(() => {})
      }
    }
  }

  // Step 4: 发送到后端分析
  let results: AnalysisResult[] = []
  try {
    const resp = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: collectedArticles }),
    })
    if (!resp.ok) throw new Error(`后端返回错误 ${resp.status}`)
    const data = await resp.json()
    results = data.results ?? []
  } catch {
    sendToPopup({ type: 'error', message: '无法连接本地服务，请确认后端已启动（localhost:8080）', fatal: true })
    return
  }

  sendToPopup({ type: 'showResults', articles: collectedArticles, results })
}

function sendToPopup(message: ExtMessage): void {
  if (popupPort) {
    try {
      popupPort.postMessage(message)
    } catch {
      // Popup 已关闭，忽略
    }
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error('Tab 加载超时'))
    }, 15000)

    function onUpdated(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        clearTimeout(timeout)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

function waitForCommentsData(tabId: number, timeoutMs: number): Promise<CommentsDataMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener)
      reject(new Error('等待留言数据超时'))
    }, timeoutMs)

    function listener(message: ExtMessage, sender: chrome.runtime.MessageSender) {
      if (message.type === 'commentsData' && sender.tab?.id === tabId) {
        chrome.runtime.onMessage.removeListener(listener)
        clearTimeout(timeout)
        resolve(message as CommentsDataMessage)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
  })
}
```

- [ ] **Step 2: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/src/background/
git commit -m "feat(extension): add background service worker with full orchestration flow"
```

---

## Task 9: 插件 — Popup UI

**Files:**
- Create: `extension/src/popup/main.tsx`
- Create: `extension/src/popup/App.tsx`

- [ ] **Step 1: 创建 main.tsx**

创建 `extension/src/popup/main.tsx`：

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 2: 创建 App.tsx**

创建 `extension/src/popup/App.tsx`：

```tsx
import React, { useState, useEffect, useRef } from 'react'
import type {
  ArticleComments,
  AnalysisResult,
  ExtMessage,
} from '../types'

type State =
  | { status: 'idle' }
  | { status: 'detecting'; current: number; total: number; articleTitle: string; warnings: string[] }
  | { status: 'done'; articles: ArticleComments[]; results: AnalysisResult[] }
  | { status: 'error'; message: string }

export default function App() {
  const [n, setN] = useState(3)
  const [state, setState] = useState<State>({ status: 'idle' })
  const portRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'popup' })
    portRef.current = port

    port.onMessage.addListener((message: ExtMessage) => {
      if (message.type === 'progress') {
        setState(prev => ({
          status: 'detecting',
          current: message.current,
          total: message.total,
          articleTitle: message.articleTitle,
          warnings: prev.status === 'detecting' ? prev.warnings : [],
        }))
      } else if (message.type === 'showResults') {
        setState({ status: 'done', articles: message.articles, results: message.results })
      } else if (message.type === 'error') {
        if (message.fatal) {
          setState({ status: 'error', message: message.message })
        } else {
          // 非致命错误（如单篇跳过），追加到警告列表，不中断检测
          setState(prev => {
            if (prev.status !== 'detecting') return prev
            return { ...prev, warnings: [...prev.warnings, message.message] }
          })
        }
      }
    })

    return () => port.disconnect()
  }, [])

  function startDetect() {
    setState({ status: 'detecting', current: 0, total: n, articleTitle: '准备中...', warnings: [] })
    chrome.runtime.sendMessage({ type: 'startDetect', n })
  }

  const violations = state.status === 'done'
    ? state.results.filter(r => r.isViolation)
    : []

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', width: 400 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>公众号违规留言检测</h2>

      {/* 配置区 */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 14 }}>检测篇数：</label>
        <input
          type="number"
          min={1}
          max={10}
          value={n}
          onChange={e => setN(Math.min(10, Math.max(1, Number(e.target.value))))}
          style={{ width: 50, padding: '2px 4px' }}
          disabled={state.status === 'detecting'}
        />
        <span style={{ fontSize: 12, color: '#666' }}>篇（最新，1–10）</span>
      </div>

      {/* 触发按钮 */}
      <button
        onClick={startDetect}
        disabled={state.status === 'detecting'}
        style={{
          padding: '6px 16px',
          background: state.status === 'detecting' ? '#ccc' : '#07c160',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: state.status === 'detecting' ? 'not-allowed' : 'pointer',
          marginBottom: 12,
          fontSize: 14,
        }}
      >
        {state.status === 'detecting' ? '检测中...' : '开始检测'}
      </button>

      {/* 进度 */}
      {state.status === 'detecting' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
            正在处理第 {state.current}/{state.total} 篇：{state.articleTitle}
          </div>
          <div style={{ background: '#eee', borderRadius: 4, height: 6 }}>
            <div style={{
              width: `${state.total > 0 ? (state.current / state.total) * 100 : 0}%`,
              background: '#07c160', height: '100%', borderRadius: 4, transition: 'width 0.3s',
            }} />
          </div>
          {state.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#e67e22', marginTop: 4 }}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {/* 致命错误 */}
      {state.status === 'error' && (
        <div style={{ color: 'red', fontSize: 13, marginBottom: 12 }}>⚠️ {state.message}</div>
      )}

      {/* 结果区 */}
      {state.status === 'done' && (
        <>
          <hr style={{ margin: '12px 0', borderColor: '#eee' }} />

          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>📄 全部留言</h3>
            {state.articles.map(art => (
              <details key={art.articleId} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  《{art.articleTitle}》（{art.comments.length} 条）
                </summary>
                <div style={{ paddingLeft: 12, marginTop: 4 }}>
                  {art.comments.length === 0
                    ? <div style={{ fontSize: 12, color: '#999' }}>无留言</div>
                    : art.comments.map(c => (
                      <div key={c.id} style={{ fontSize: 12, marginBottom: 4, color: '#333' }}>
                        <strong>{c.author}：</strong>{c.content}
                      </div>
                    ))
                  }
                </div>
              </details>
            ))}
          </div>

          <div>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
              ⚠️ 违规留言（{violations.length} 条）
            </h3>
            {violations.length === 0
              ? <div style={{ fontSize: 13, color: '#07c160' }}>✅ 未发现违规留言</div>
              : violations.map(v => {
                const article = state.articles.find(a => a.articleId === v.articleId)
                const comment = article?.comments.find(c => c.id === v.commentId)
                return (
                  <div key={v.commentId} style={{
                    background: '#fff3f3', borderRadius: 4, padding: 8, marginBottom: 6, fontSize: 13,
                  }}>
                    <div>
                      <strong>{comment?.author ?? '未知'}</strong>
                      （《{article?.articleTitle ?? ''}》）
                    </div>
                    <div style={{ color: '#555', margin: '2px 0' }}>{comment?.content}</div>
                    <div style={{ color: '#e53935', fontSize: 12 }}>原因：{v.reason}</div>
                  </div>
                )
              })
            }
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 构建插件**

```bash
cd C:/Internship/gzh_demo/extension
npm run build
```

Expected: `dist/` 目录生成，包含：
- `dist/popup.html`
- `dist/background/index.js`
- `dist/articleList/index.js`
- `dist/comments/index.js`
- `dist/manifest.json`（从 public/ 复制过来）

如果 popup.html 的路径不对，检查 `dist/` 目录结构，相应更新 `manifest.json` 中 `default_popup` 的路径后重新构建。

- [ ] **Step 4: 提交**

```bash
cd C:/Internship/gzh_demo
git add extension/src/popup/
git commit -m "feat(extension): add popup UI with progress tracking and violation display"
```

---

## Task 10: 集成测试 — 在 Chrome 中加载并手动验证

- [ ] **Step 1: 启动 Go 后端**

```bash
cd C:/Internship/gzh_demo/backend
go run main.go
```

Expected: `Backend running on http://localhost:8080`

- [ ] **Step 2: 在 Chrome 中加载插件**

1. 打开 `chrome://extensions/`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `C:/Internship/gzh_demo/extension/dist/` 目录
5. 确认插件出现在列表中，无报错（红色错误图标）

- [ ] **Step 3: 验证 content script 注入**

1. 打开微信公众平台，登录后进入"发表记录"页面
2. 打开 DevTools → Console，确认无脚本报错
3. 点击插件图标，确认 Popup 正常显示

- [ ] **Step 4: 执行完整检测流程**

1. 在 Popup 中设置检测篇数（如 2）
2. 点击"开始检测"
3. 观察进度条更新、后台 Tab 自动开关
4. 确认结果展示在 Popup 中

- [ ] **Step 5: 调整 DOM 选择器（大概率需要此步骤）**

如果 content scripts 未能抓取到数据（留言数为 0）：
1. 打开对应页面的 DevTools → Elements，检查实际 DOM 结构
2. 更新 `extension/src/content/articleList.ts` 和 `comments.ts` 中的选择器
3. 重新构建：`npm run build`（在 `extension/` 目录）
4. 在 `chrome://extensions/` 中点击插件的"重新加载"图标（↺）
5. 重新测试

- [ ] **Step 6: 提交最终版本**

```bash
cd C:/Internship/gzh_demo
git add extension/
git commit -m "feat: MVP complete - WeChat comment moderation Chrome extension"
```

---

## 附录：快速命令参考

```bash
# 启动后端
cd C:/Internship/gzh_demo/backend && go run main.go

# 构建插件
cd C:/Internship/gzh_demo/extension && npm run build

# 运行后端测试
cd C:/Internship/gzh_demo/backend && go test ./... -v

# 插件加载路径（Chrome 开发者模式）
C:/Internship/gzh_demo/extension/dist/

# 后端手动测试（单行）
curl -X POST http://localhost:8080/api/analyze -H "Content-Type: application/json" -d "{\"articles\":[]}"
```
