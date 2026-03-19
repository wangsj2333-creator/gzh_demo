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
