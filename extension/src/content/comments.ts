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
      // Set up both event listeners BEFORE clicking, so we don't miss the responses
      const normalPromise = waitForEvent('__wx_comment_data__')
      const blockedPromise = waitForEvent('__wx_blocked_comment_data__')

      const titleEls = document.querySelectorAll('.article-list__item-title')
      let clicked = false
      titleEls.forEach((el) => {
        if (el.textContent?.trim() === art.articleTitle) {
          (el as HTMLElement).click()
          clicked = true
        }
      })

      if (!clicked) {
        // Clean up the dangling listeners
        window.dispatchEvent(new CustomEvent('__wx_comment_data__', { detail: null }))
        window.dispatchEvent(new CustomEvent('__wx_blocked_comment_data__', { detail: null }))

        const errorMsg: ErrorMessage = {
          type: 'error',
          message: `《${art.articleTitle}》未在左侧列表中找到，已跳过`,
          fatal: false,
        }
        chrome.runtime.sendMessage(errorMsg)
        collected.push({ articleId: art.articleId, articleTitle: art.articleTitle, comments: [] })
        continue
      }

      const timeout = <T>(ms: number): Promise<T | null> =>
        new Promise<T | null>(resolve => setTimeout(() => resolve(null), ms))

      const [normalData, blockedData] = await Promise.all([
        Promise.race([normalPromise, timeout(8000)]),
        Promise.race([blockedPromise, timeout(8000)]),
      ])

      const comments = [
        ...parseComments(art.articleId, normalData, false),
        ...parseComments(art.articleId, blockedData, true),
      ]
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

function waitForEvent(eventName: string): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const handler = (e: Event) => {
      window.removeEventListener(eventName, handler)
      resolve((e as CustomEvent).detail)
    }
    window.addEventListener(eventName, handler)
  })
}

interface RawReply {
  nick_name?: string
  content?: string
  create_time?: number
}

interface RawComment {
  nick_name?: string
  content?: string
  post_time?: number
  comment_id?: string
  new_reply?: { reply_list: RawReply[]; reply_total_cnt?: number }
}

interface RawCommentList {
  comment?: RawComment[]
}

interface RawApiResponse {
  comment_list?: string
}

function parseComments(articleId: string, data: unknown, isBlocked: boolean): Comment[] {
  if (!data) return []

  try {
    const resp = data as RawApiResponse
    if (!resp.comment_list) return []

    const parsed: RawCommentList = JSON.parse(resp.comment_list)
    const rawComments = parsed.comment ?? []

    const results: Comment[] = []
    for (const [index, c] of rawComments.entries()) {
      results.push({
        id: `${articleId}_${isBlocked ? 'b' : 'n'}_${index}`,
        author: c.nick_name ?? '未知用户',
        content: c.content ?? '',
        timestamp: c.post_time ? new Date(c.post_time * 1000).toLocaleString('zh-CN') : '',
        isBlocked,
      })
      const replies: RawReply[] = c.new_reply?.reply_list ?? []
      replies.forEach((r, ri) => {
        results.push({
          id: `${articleId}_${isBlocked ? 'b' : 'n'}_${index}_reply_${ri}`,
          author: r.nick_name ?? '未知用户',
          content: `↳ ${r.content ?? ''}`,
          timestamp: r.create_time ? new Date(r.create_time * 1000).toLocaleString('zh-CN') : '',
          isBlocked,
        })
      })
    }
    return results
  } catch {
    return []
  }
}
