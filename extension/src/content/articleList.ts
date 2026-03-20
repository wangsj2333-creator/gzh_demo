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
