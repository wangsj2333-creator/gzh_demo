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

  const items = document.querySelectorAll('.article-list__item-title')

  items.forEach((item, i) => {
    const articleTitle = item.textContent?.trim() ?? `文章${i + 1}`
    const articleId = `art_${i}`

    results.push({ articleId, articleTitle })
  })

  return results
}
