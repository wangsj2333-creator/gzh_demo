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
