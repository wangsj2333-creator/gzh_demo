import React, { useState, useEffect } from 'react'
import type { ArticleComments, Comment } from '../types'

export default function App() {
  const [articles, setArticles] = useState<ArticleComments[]>([])
  const [selectedArticleId, setSelectedArticleId] = useState<string>('all')
  const [filter, setFilter] = useState<'all' | 'normal' | 'blocked'>('all')

  useEffect(() => {
    chrome.storage.local.get('commentResults', result => {
      setArticles(result.commentResults ?? [])
    })
  }, [])

  const allComments: (Comment & { articleTitle: string })[] = articles.flatMap(art =>
    art.comments.map(c => ({ ...c, articleTitle: art.articleTitle }))
  )

  const filtered = allComments.filter(c => {
    if (selectedArticleId !== 'all') {
      const art = articles.find(a => a.articleId === selectedArticleId)
      if (!art?.comments.some(ac => ac.id === c.id)) return false
    }
    if (filter === 'normal') return !c.isBlocked
    if (filter === 'blocked') return c.isBlocked
    return true
  })

  const totalCount = allComments.length
  const normalCount = allComments.filter(c => !c.isBlocked).length
  const blockedCount = allComments.filter(c => c.isBlocked).length

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    cursor: 'pointer',
    border: '1px solid #ccc',
    borderRadius: 4,
    background: active ? '#07c160' : '#fff',
    color: active ? '#fff' : '#333',
    fontSize: 13,
  })

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>留言抓取结果</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select
          value={selectedArticleId}
          onChange={e => setSelectedArticleId(e.target.value)}
          style={{ padding: '4px 8px', fontSize: 13, borderRadius: 4, border: '1px solid #ccc' }}
        >
          <option value="all">全部文章</option>
          {articles.map(art => (
            <option key={art.articleId} value={art.articleId}>
              {art.articleTitle}（{art.comments.length} 条）
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={btnStyle(filter === 'all')} onClick={() => setFilter('all')}>全部</button>
          <button style={btnStyle(filter === 'normal')} onClick={() => setFilter('normal')}>仅正常</button>
          <button style={btnStyle(filter === 'blocked')} onClick={() => setFilter('blocked')}>仅屏蔽</button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
        共 {totalCount} 条，正常 {normalCount} 条，已屏蔽 {blockedCount} 条
        {filter !== 'all' || selectedArticleId !== 'all' ? `（当前显示 ${filtered.length} 条）` : ''}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={thStyle}>文章标题</th>
            <th style={thStyle}>作者</th>
            <th style={thStyle}>内容</th>
            <th style={thStyle}>时间</th>
            <th style={thStyle}>状态</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#999' }}>
                暂无数据
              </td>
            </tr>
          ) : (
            filtered.map(c => (
              <tr
                key={c.id}
                style={{ background: c.isBlocked ? '#fff5f5' : '#fff', borderBottom: '1px solid #eee' }}
              >
                <td style={tdStyle}>{c.articleTitle}</td>
                <td style={tdStyle}>{c.author}</td>
                <td style={{ ...tdStyle, maxWidth: 400, wordBreak: 'break-word' }}>{c.content}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{c.timestamp}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {c.isBlocked ? '🚫 已屏蔽' : '✅ 正常'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '7px 12px',
  border: '1px solid #eee',
  verticalAlign: 'top',
}
