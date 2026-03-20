import React, { useState, useEffect, useRef } from 'react'
import type {
  ArticleInfo,
  ExtMessage,
} from '../types'

type State =
  | { status: 'loading' }
  | { status: 'selecting'; articles: ArticleInfo[]; selected: Set<string> }
  | { status: 'detecting'; current: number; total: number; articleTitle: string; warnings: string[] }
  | { status: 'done' }
  | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const portRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'popup' })
    portRef.current = port

    port.onMessage.addListener((message: ExtMessage) => {
      if (message.type === 'articleList') {
        const selected = new Set(message.articles.map(a => a.articleId))
        setState({ status: 'selecting', articles: message.articles, selected })
      } else if (message.type === 'progress') {
        setState(prev => ({
          status: 'detecting',
          current: message.current,
          total: message.total,
          articleTitle: message.articleTitle,
          warnings: prev.status === 'detecting' ? prev.warnings : [],
        }))
      } else if (message.type === 'showResults') {
        setState({ status: 'done' })
      } else if (message.type === 'error') {
        if (message.fatal) {
          setState({ status: 'error', message: message.message })
        } else {
          setState(prev => {
            if (prev.status !== 'detecting') return prev
            return { ...prev, warnings: [...prev.warnings, message.message] }
          })
        }
      }
    })

    // 打开 popup 后立即拉取文章列表
    chrome.runtime.sendMessage({ type: 'fetchArticleList' })

    return () => port.disconnect()
  }, [])

  function toggleArticle(articleId: string) {
    setState(prev => {
      if (prev.status !== 'selecting') return prev
      const selected = new Set(prev.selected)
      if (selected.has(articleId)) selected.delete(articleId)
      else selected.add(articleId)
      return { ...prev, selected }
    })
  }

  function toggleAll() {
    setState(prev => {
      if (prev.status !== 'selecting') return prev
      const allSelected = prev.selected.size === prev.articles.length
      const selected = allSelected
        ? new Set<string>()
        : new Set(prev.articles.map(a => a.articleId))
      return { ...prev, selected }
    })
  }

  function startDetect() {
    if (state.status !== 'selecting') return
    const selectedArticles = state.articles.filter(a => state.selected.has(a.articleId))
    chrome.runtime.sendMessage({ type: 'startDetect', articles: selectedArticles })
  }

  function reset() {
    setState({ status: 'loading' })
    chrome.runtime.sendMessage({ type: 'fetchArticleList' })
  }

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif', width: 400 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>公众号留言抓取</h2>

      {/* 加载中 */}
      {state.status === 'loading' && (
        <div style={{ fontSize: 13, color: '#888' }}>正在读取文章列表...</div>
      )}

      {/* 文章选择 */}
      {state.status === 'selecting' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#555' }}>
              共 {state.articles.length} 篇，已选 {state.selected.size} 篇
            </span>
            <button
              onClick={toggleAll}
              style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}
            >
              {state.selected.size === state.articles.length ? '取消全选' : '全选'}
            </button>
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4, marginBottom: 12 }}>
            {state.articles.map((art, i) => (
              <label
                key={art.articleId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  cursor: 'pointer',
                  borderBottom: i < state.articles.length - 1 ? '1px solid #f0f0f0' : 'none',
                  background: state.selected.has(art.articleId) ? '#f0faf4' : '#fff',
                }}
              >
                <input
                  type="checkbox"
                  checked={state.selected.has(art.articleId)}
                  onChange={() => toggleArticle(art.articleId)}
                  style={{ flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: '#333', lineHeight: 1.4 }}>
                  {art.articleTitle}
                </span>
              </label>
            ))}
          </div>

          <button
            onClick={startDetect}
            disabled={state.selected.size === 0}
            style={{
              padding: '7px 20px',
              background: state.selected.size === 0 ? '#ccc' : '#07c160',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: state.selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              width: '100%',
            }}
          >
            开始抓取（{state.selected.size} 篇）
          </button>
        </>
      )}

      {/* 抓取进度 */}
      {state.status === 'detecting' && (
        <div>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>
            正在处理第 {state.current}/{state.total} 篇：{state.articleTitle}
          </div>
          <div style={{ background: '#eee', borderRadius: 4, height: 6, marginBottom: 8 }}>
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
        <div>
          <div style={{ color: 'red', fontSize: 13, marginBottom: 10 }}>⚠️ {state.message}</div>
          <button onClick={reset} style={{ fontSize: 13, padding: '4px 12px', cursor: 'pointer' }}>
            重试
          </button>
        </div>
      )}

      {/* 抓取完成 */}
      {state.status === 'done' && (
        <div>
          <div style={{ fontSize: 14, color: '#07c160', marginBottom: 8 }}>✅ 抓取完成</div>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>结果已在新标签页展示</div>
          <button
            onClick={reset}
            style={{ fontSize: 13, padding: '4px 12px', cursor: 'pointer' }}
          >
            重新选择
          </button>
        </div>
      )}
    </div>
  )
}
