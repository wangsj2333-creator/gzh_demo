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
	// handler 直接透传 articles，应为非 nil slice
	if resp.Articles == nil {
		t.Fatal("articles should be a non-nil slice")
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
