package handler

import (
	"encoding/json"
	"net/http"
)

// 请求数据结构
type Comment struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
	IsBlocked bool   `json:"isBlocked"`
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
type AnalyzeResponse struct {
	Articles []ArticleRequest `json:"articles"`
}

func Analyze(w http.ResponseWriter, r *http.Request) {
	var req AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	articles := req.Articles
	if articles == nil {
		articles = []ArticleRequest{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AnalyzeResponse{Articles: articles})
}
