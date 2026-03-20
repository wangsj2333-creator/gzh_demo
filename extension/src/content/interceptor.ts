// MAIN world interceptor — runs before page JS, patches window.fetch and XHR
// to capture list_comment API responses and forward them via CustomEvent.

function dispatch(data: unknown): void {
  window.dispatchEvent(new CustomEvent('__wx_comment_data__', { detail: data }))
}

// --- Patch fetch ---
const _originalFetch = window.fetch.bind(window)

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.includes('action=list_comment')) {
    const response = await _originalFetch(input, init)
    response.clone().json().then(dispatch).catch(() => {})
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
    (this as XMLHttpRequest & { __intercept__: boolean }).__intercept__ = true
  }
  return _originalOpen.call(this, method, url, ...(rest as [boolean, string?, string?]))
}

XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  if ((this as XMLHttpRequest & { __intercept__: boolean }).__intercept__) {
    this.addEventListener('load', function () {
      try {
        const data: unknown = JSON.parse(this.responseText)
        dispatch(data)
      } catch {
        // ignore parse errors
      }
    })
  }
  return _originalSend.call(this, body)
}
