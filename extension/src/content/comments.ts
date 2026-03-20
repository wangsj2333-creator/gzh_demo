import type { ExtractCommentsMessage, AllCommentsDataMessage, ProgressMessage, ErrorMessage, ArticleComments, Comment } from '../types'

chrome.runtime.onMessage.addListener(
  (message: ExtractCommentsMessage, _sender, sendResponse) => {
    if (message.type !== 'extractComments') return false

    processArticles(message.articles).then(() => sendResponse({}))
    return true
  }
)

async function processArticles(articles: ExtractCommentsMessage['articles']): Promise<void> {
  const collected: ArticleComments[] = []

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i]

    const progressMsg: ProgressMessage = {
      type: 'progress',
      current: i + 1,
      total: articles.length,
      articleTitle: art.articleTitle,
    }
    chrome.runtime.sendMessage(progressMsg)

    try {
      // Set up the event listener BEFORE clicking, so we don't miss the response
      const commentDataPromise = new Promise<unknown>((resolve) => {
        const handler = (e: Event) => {
          window.removeEventListener('__wx_comment_data__', handler)
          resolve((e as CustomEvent).detail)
        }
        window.addEventListener('__wx_comment_data__', handler)
      })

      const titleEls = document.querySelectorAll('.article-list__item-title')
      let clicked = false
      titleEls.forEach((el) => {
        if (el.textContent?.trim() === art.articleTitle) {
          (el as HTMLElement).click()
          clicked = true
        }
      })

      if (!clicked) {
        // Clean up the dangling listener
        window.dispatchEvent(new CustomEvent('__wx_comment_data__', { detail: null }))

        const errorMsg: ErrorMessage = {
          type: 'error',
          message: `《${art.articleTitle}》未在左侧列表中找到，已跳过`,
          fatal: false,
        }
        chrome.runtime.sendMessage(errorMsg)
        collected.push({ articleId: art.articleId, articleTitle: art.articleTitle, comments: [] })
        continue
      }

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      const data = await Promise.race([commentDataPromise, timeoutPromise])

      const comments = parseComments(art.articleId, data)
      collected.push({ articleId: art.articleId, articleTitle: art.articleTitle, comments })
    } catch {
      const errorMsg: ErrorMessage = {
        type: 'error',
        message: `《${art.articleTitle}》抓取失败，已跳过`,
        fatal: false,
      }
      chrome.runtime.sendMessage(errorMsg)
      collected.push({ articleId: art.articleId, articleTitle: art.articleTitle, comments: [] })
    }
  }

  const doneMsg: AllCommentsDataMessage = { type: 'allCommentsData', articles: collected }
  chrome.runtime.sendMessage(doneMsg)
}

interface RawComment {
  nick_name?: string
  content?: string
  post_time?: number
  comment_id?: string
}

interface RawCommentList {
  comment?: RawComment[]
}

interface RawApiResponse {
  comment_list?: string
}

function parseComments(articleId: string, data: unknown): Comment[] {
  if (!data) return []

  try {
    const resp = data as RawApiResponse
    if (!resp.comment_list) return []

    const parsed: RawCommentList = JSON.parse(resp.comment_list)
    const rawComments = parsed.comment ?? []

    return rawComments.map((c, index) => ({
      id: `${articleId}_${index}`,
      author: c.nick_name ?? '未知用户',
      content: c.content ?? '',
      timestamp: c.post_time
        ? new Date(c.post_time * 1000).toLocaleString('zh-CN')
        : '',
    }))
  } catch {
    return []
  }
}
