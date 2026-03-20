// MAIN world interceptor — runs before page JS, patches window.fetch and XHR
// to capture list_comment API responses and forward them via CustomEvent.

function dispatch(data: unknown): void {
  window.dispatchEvent(new CustomEvent('__wx_comment_data__', { detail: data }))
}

interface RawCommentPage {
  comment?: unknown[]
  total_count?: number
}

interface RawApiResponse {
  comment_list?: string
}

async function fetchAllPages(firstData: RawApiResponse, url: string): Promise<void> {
  try {
    const parsedList: RawCommentPage = JSON.parse(firstData.comment_list ?? '{}')
    const allComments = [...(parsedList.comment ?? [])]
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

    dispatch({
      ...firstData,
      comment_list: JSON.stringify({ ...parsedList, comment: allComments }),
    })
  } catch {
    // Fallback: dispatch first page as-is
    dispatch(firstData)
  }
}

// --- Patch fetch ---
const _originalFetch = window.fetch.bind(window)

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.includes('action=list_comment')) {
    const response = await _originalFetch(input, init)
    const clone = response.clone()
    clone.json().then((data: RawApiResponse) => fetchAllPages(data, url)).catch(() => {})
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
        fetchAllPages(data, capturedUrl).catch(() => {})
      } catch {
        // ignore parse errors
      }
    })
  }
  return _originalSend.call(this, body)
}
