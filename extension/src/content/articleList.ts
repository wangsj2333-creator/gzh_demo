import type { GetArticleListMessage, ArticleListMessage, ArticleInfo } from '../types'

chrome.runtime.onMessage.addListener(
  (message: GetArticleListMessage, _sender, sendResponse) => {
    if (message.type !== 'getArticleList') return false

    const articles = extractArticles()
    const response: ArticleListMessage = { type: 'articleList', articles }
    sendResponse(response)
    return true
  }
)

function extractArticles(): ArticleInfo[] {
  const results: ArticleInfo[] = []

  const pageUrl = new URL(window.location.href)
  const token = pageUrl.searchParams.get('token') ?? ''

  const rows = document.querySelectorAll('.weui-desktop-mass-appmsg__bd')

  rows.forEach((row, i) => {
    const titleEl = row.querySelector('.weui-desktop-mass-appmsg__title') as HTMLElement | null
    const articleTitle = titleEl?.textContent?.trim() ?? `文章${i + 1}`

    const links = Array.from(row.querySelectorAll('a')) as HTMLAnchorElement[]
    const copyrightLink = links.find(a => a.href.includes('/cgi-bin/appmsgcopyright'))
    if (!copyrightLink) return

    const linkUrl = new URL(copyrightLink.href)
    const articleId = linkUrl.searchParams.get('id')
    const idx = linkUrl.searchParams.get('idx') ?? '1'
    if (!articleId) return

    const commentPageUrl =
      `https://mp.weixin.qq.com/cgi-bin/appmsg_comment?action=browser` +
      `&appmsgid=${articleId}&idx=${idx}&token=${token}&lang=zh_CN`

    results.push({ articleId, articleTitle, commentPageUrl })
  })

  return results
}
