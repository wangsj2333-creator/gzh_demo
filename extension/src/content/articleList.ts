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

  // 从当前页面 URL 提取 token
  const pageUrl = new URL(window.location.href)
  const token = pageUrl.searchParams.get('token') ?? ''

  const rows = document.querySelectorAll('.weui-desktop-mass-appmsg__bd')

  for (let i = 0; i < Math.min(n, rows.length); i++) {
    const row = rows[i]

    // 文章标题
    const titleEl = row.querySelector('.weui-desktop-mass-appmsg__title') as HTMLElement | null
    const articleTitle = titleEl?.textContent?.trim() ?? `文章${i + 1}`

    // 从 appmsgcopyright 链接提取文章 ID 和 idx
    const links = Array.from(row.querySelectorAll('a')) as HTMLAnchorElement[]
    const copyrightLink = links.find(a => a.href.includes('/cgi-bin/appmsgcopyright'))
    if (!copyrightLink) continue

    const linkUrl = new URL(copyrightLink.href)
    const articleId = linkUrl.searchParams.get('id')
    const idx = linkUrl.searchParams.get('idx') ?? '1'
    if (!articleId) continue

    // 拼出留言管理页 URL
    const commentPageUrl =
      `https://mp.weixin.qq.com/cgi-bin/appmsg_comment?action=browser` +
      `&appmsgid=${articleId}&idx=${idx}&token=${token}&lang=zh_CN`

    results.push({ articleId, articleTitle, commentPageUrl })
  }

  return results
}
