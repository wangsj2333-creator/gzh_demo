import type { CommentsDataMessage, Comment } from '../types'

function getArticleIdFromUrl(): string {
  const url = new URL(window.location.href)
  return url.searchParams.get('appmsgid') ?? url.searchParams.get('id') ?? 'unknown'
}

function extractComments(articleId: string): Comment[] {
  const comments: Comment[] = []

  // ⚠️ 以下选择器需根据实际页面 DOM 调整
  const items = document.querySelectorAll('.weui-desktop-comment__item')

  items.forEach((item, index) => {
    const id = item.getAttribute('data-comment-id') ?? `${articleId}_${index}`
    const authorEl = item.querySelector('.weui-desktop-comment__nickname')
    const contentEl = item.querySelector('.weui-desktop-comment__content')
    const timeEl = item.querySelector('.weui-desktop-comment__time')

    comments.push({
      id,
      author: authorEl?.textContent?.trim() ?? '未知用户',
      content: contentEl?.textContent?.trim() ?? '',
      timestamp: timeEl?.textContent?.trim() ?? '',
    })
  })

  return comments
}

const articleId = getArticleIdFromUrl()
const comments = extractComments(articleId)

const message: CommentsDataMessage = { type: 'commentsData', articleId, comments }
chrome.runtime.sendMessage(message)
