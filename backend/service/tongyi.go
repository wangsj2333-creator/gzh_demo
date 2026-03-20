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
	tongyiAPIKey = "sk-8be540f8808e4c66a8e58d9befd2edde"
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
			Text string `json:"text"`
		} `json:"output"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if result.Output.Text == "" {
		return "", errors.New("empty response from tongyi")
	}
	return result.Output.Text, nil
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
