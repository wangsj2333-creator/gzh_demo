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
