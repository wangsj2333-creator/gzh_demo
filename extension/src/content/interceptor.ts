// MAIN world interceptor — runs before page JS, patches window.fetch and XHR
// to capture list_comment API responses and forward them via CustomEvent.

function dispatch(data: unknown): void {
  window.dispatchEvent(new CustomEvent('__wx_comment_data__', { detail: data }))
}

function dispatchBlocked(data: unknown): void {
  window.dispatchEvent(new CustomEvent('__wx_blocked_comment_data__', { detail: data }))
}

function buildBlockedUrl(url: string): string {
  const qsStart = url.indexOf('?')
  const basePath = url.split('?')[0]
  const qs = qsStart >= 0 ? url.slice(qsStart + 1) : ''
  const params = new URLSearchParams(qs)
  params.set('type', '4')
  params.set('begin', '0')
  params.set('max_id', '0')
  return `${basePath}?${params.toString()}`
}

interface RawReplyItem {
  [key: string]: unknown
}

interface RawCommentEntry {
  content_id?: string
  new_reply?: {
    reply_list?: RawReplyItem[]
    reply_total_cnt?: number
    max_reply_id?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface RawCommentPage {
  comment?: RawCommentEntry[]
  total_count?: number
}

interface RawApiResponse {
  comment_list?: string
}

interface GetCommentReplyResponse {
  reply_list?: {
    max_reply_id?: number
    reply_list?: RawReplyItem[]
  }
}

function buildReplyUrl(listUrl: string, contentId: string, maxReplyId: number): string {
  const qsStart = listUrl.indexOf('?')
  const qs = qsStart >= 0 ? listUrl.slice(qsStart + 1) : ''
  const params = new URLSearchParams(qs)
  const basePath = listUrl.split('?')[0]
  const replyParams = new URLSearchParams({
    action: 'get_comment_reply',
    comment_id: params.get('comment_id') ?? '',
    content_id: contentId,
    limit: '20',
    max_reply_id: String(maxReplyId),
    clear_unread: '0',
    fingerprint: params.get('fingerprint') ?? '',
    token: params.get('token') ?? '',
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  })
  return `${basePath}?${replyParams.toString()}`
}

async function fetchAllReplies(
  listUrl: string,
  contentId: string,
  initialMaxReplyId: number,
): Promise<RawReplyItem[]> {
  const allReplies: RawReplyItem[] = []
  let maxReplyId = initialMaxReplyId

  for (;;) {
    try {
      const replyUrl = buildReplyUrl(listUrl, contentId, maxReplyId)
      const resp = await _originalFetch(replyUrl)
      if (!resp.ok) break
      const data = await resp.json() as GetCommentReplyResponse
      const batch = data.reply_list?.reply_list ?? []
      if (batch.length === 0) break
      allReplies.push(...batch)
      const minId = data.reply_list?.max_reply_id ?? 0
      if (minId <= 0) break
      maxReplyId = minId
    } catch {
      break
    }
  }

  // API returns newest-first; reverse to chronological order
  return allReplies.reverse()
}

async function fetchPagesForUrl(
  firstData: RawApiResponse,
  url: string,
  dispatchFn: (data: unknown) => void,
  fetchReplies: boolean = true,
): Promise<void> {
  try {
    const parsedList: RawCommentPage = JSON.parse(firstData.comment_list ?? '{}')
    const allComments: RawCommentEntry[] = [...(parsedList.comment ?? [])]
    const total: number = parsedList.total_count ?? 0

    for (let begin = 20; begin < total; begin += 20) {
      try {
        const nextUrl = url.replace(/begin=\d+/, `begin=${begin}`)
        const resp = await _originalFetch(nextUrl)
        const data = await resp.json() as RawApiResponse
        const page: RawCommentPage = JSON.parse(data.comment_list ?? '{}')
        allComments.push(...(page.comment ?? []))
      } catch {
        break
      }
    }

    let enrichedComments = allComments

    if (fetchReplies) {
      // Fetch complete reply lists for comments with truncated replies
      enrichedComments = await Promise.all(
        allComments.map(async (c) => {
          const totalReplies = c.new_reply?.reply_total_cnt ?? 0
          const shownReplies = c.new_reply?.reply_list?.length ?? 0
          const maxReplyId = c.new_reply?.max_reply_id ?? 0
          const contentId = c.content_id ?? ''

          if (totalReplies > shownReplies && maxReplyId > 0 && contentId) {
            const fullReplies = await fetchAllReplies(url, contentId, maxReplyId)
            return {
              ...c,
              new_reply: { ...(c.new_reply ?? {}), reply_list: fullReplies },
            }
          }
          return c
        })
      )
    }

    dispatchFn({
      ...firstData,
      comment_list: JSON.stringify({ ...parsedList, comment: enrichedComments }),
    })
  } catch {
    // Fallback: dispatch first page as-is
    dispatchFn(firstData)
  }
}

// --- Patch fetch ---
const _originalFetch = window.fetch.bind(window)

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.includes('action=list_comment')) {
    const response = await _originalFetch(input, init)
    const clone = response.clone()
    clone.json().then((data: RawApiResponse) => {
      fetchPagesForUrl(data, url, dispatch, true).catch(() => {})
      const blockedUrl = buildBlockedUrl(url)
      _originalFetch(blockedUrl)
        .then(r => r.json())
        .then((blockedData: RawApiResponse) =>
          fetchPagesForUrl(blockedData, blockedUrl, dispatchBlocked, false)
        )
        .catch(() => {})
    }).catch(() => {})
    return response
  }

  return _originalFetch(input, init)
}

// --- Patch XHR ---
const _originalOpen = XMLHttpRequest.prototype.open
const _originalSend = XMLHttpRequest.prototype.send

XMLHttpRequest.prototype.open = function (
  method: string,
  url: string | URL,
  ...rest: [boolean?, string?, string?]
) {
  const urlStr = typeof url === 'string' ? url : url.href
  if (urlStr.includes('action=list_comment')) {
    (this as XMLHttpRequest & { __intercept__: boolean; __url__: string }).__intercept__ = true;
    (this as XMLHttpRequest & { __intercept__: boolean; __url__: string }).__url__ = urlStr
  }
  return _originalOpen.call(this, method, url, ...(rest as [boolean, string?, string?]))
}

XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  if ((this as XMLHttpRequest & { __intercept__: boolean; __url__: string }).__intercept__) {
    const capturedUrl = (this as XMLHttpRequest & { __intercept__: boolean; __url__: string }).__url__
    this.addEventListener('load', function () {
      try {
        const data: RawApiResponse = JSON.parse(this.responseText)
        fetchPagesForUrl(data, capturedUrl, dispatch, true).catch(() => {})
        const blockedUrl = buildBlockedUrl(capturedUrl)
        _originalFetch(blockedUrl)
          .then(r => r.json())
          .then((blockedData: RawApiResponse) =>
            fetchPagesForUrl(blockedData, blockedUrl, dispatchBlocked, false)
          )
          .catch(() => {})
      } catch {
        // ignore parse errors
      }
    })
  }
  return _originalSend.call(this, body)
}
