import type {
  StartDetectMessage,
  ArticleListMessage,
  AllCommentsDataMessage,
  ArticleComments,
  AnalysisResult,
  ExtMessage,
} from '../types'

const BACKEND_URL = 'http://localhost:8080/api/analyze'

let popupPort: chrome.runtime.Port | null = null

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port
    port.onDisconnect.addListener(() => { popupPort = null })
  }
})

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender) => {
  if (message.type === 'fetchArticleList') {
    handleFetchArticleList().catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  } else if (message.type === 'startDetect') {
    handleStartDetect(message as StartDetectMessage).catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  } else if (message.type === 'progress') {
    sendToPopup(message)
  } else if (message.type === 'error') {
    sendToPopup(message)
  } else if (message.type === 'allCommentsData') {
    handleAllCommentsData(message as AllCommentsDataMessage).catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  }
  return false
})

async function handleFetchArticleList(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id || !activeTab.url?.includes('mp.weixin.qq.com/misc/appmsgcomment')) {
    sendToPopup({ type: 'error', message: '请先打开互动管理-留言页面', fatal: true })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(
      activeTab.id,
      { type: 'getArticleList' }
    ) as ArticleListMessage
    sendToPopup(response)
  } catch {
    sendToPopup({ type: 'error', message: '无法读取文章列表，请刷新页面后重试', fatal: true })
  }
}

async function handleStartDetect(message: StartDetectMessage): Promise<void> {
  const articles = message.articles
  if (articles.length === 0) {
    sendToPopup({ type: 'error', message: '请先选择要检测的文章', fatal: true })
    return
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) {
    sendToPopup({ type: 'error', message: '无法获取当前标签页', fatal: true })
    return
  }

  try {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'extractComments', articles })
  } catch {
    sendToPopup({ type: 'error', message: '无法向留言页发送指令，请刷新页面后重试', fatal: true })
  }
}

async function handleAllCommentsData(message: AllCommentsDataMessage): Promise<void> {
  const collectedArticles: ArticleComments[] = message.articles

  let results: AnalysisResult[] = []
  try {
    const resp = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: collectedArticles }),
    })
    if (!resp.ok) throw new Error(`后端返回错误 ${resp.status}`)
    const data = await resp.json()
    results = data.results ?? []
  } catch {
    sendToPopup({ type: 'error', message: '无法连接本地服务，请确认后端已启动（localhost:8080）', fatal: true })
    return
  }

  sendToPopup({ type: 'showResults', articles: collectedArticles, results })
}

function sendToPopup(message: ExtMessage): void {
  if (popupPort) {
    try {
      popupPort.postMessage(message)
    } catch {
      // Popup 已关闭，忽略
    }
  }
}
