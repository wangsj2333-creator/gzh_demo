import type {
  StartDetectMessage,
  ArticleListMessage,
  CommentsDataMessage,
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

chrome.runtime.onMessage.addListener((message: ExtMessage) => {
  if (message.type === 'fetchArticleList') {
    handleFetchArticleList().catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  } else if (message.type === 'startDetect') {
    handleStartDetect(message as StartDetectMessage).catch(err => {
      sendToPopup({ type: 'error', message: err.message, fatal: true })
    })
  }
  return false
})

async function handleFetchArticleList(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id || !activeTab.url?.includes('mp.weixin.qq.com/cgi-bin/appmsg')) {
    sendToPopup({ type: 'error', message: '请先打开微信公众平台发表记录页面', fatal: true })
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

  const collectedArticles: ArticleComments[] = []

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i]
    sendToPopup({
      type: 'progress',
      current: i + 1,
      total: articles.length,
      articleTitle: art.articleTitle,
    })

    let tab: chrome.tabs.Tab | null = null
    try {
      tab = await chrome.tabs.create({ url: art.commentPageUrl, active: false })
      const tabId = tab.id!

      await waitForTabLoad(tabId)

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['comments/index.js'],
      })

      const commentsData = await waitForCommentsData(tabId, 10000)

      collectedArticles.push({
        articleId: art.articleId,
        articleTitle: art.articleTitle,
        commentPageUrl: art.commentPageUrl,
        comments: commentsData.comments,
      })
    } catch (err) {
      collectedArticles.push({
        articleId: art.articleId,
        articleTitle: art.articleTitle,
        commentPageUrl: art.commentPageUrl,
        comments: [],
      })
      sendToPopup({
        type: 'error',
        message: `《${art.articleTitle}》加载失败，已跳过`,
        fatal: false,
      })
    } finally {
      if (tab?.id) {
        chrome.tabs.remove(tab.id).catch(() => {})
      }
    }
  }

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

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error('Tab 加载超时'))
    }, 15000)

    function onUpdated(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        clearTimeout(timeout)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

function waitForCommentsData(tabId: number, timeoutMs: number): Promise<CommentsDataMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener)
      reject(new Error('等待留言数据超时'))
    }, timeoutMs)

    function listener(message: ExtMessage, sender: chrome.runtime.MessageSender) {
      if (message.type === 'commentsData' && sender.tab?.id === tabId) {
        chrome.runtime.onMessage.removeListener(listener)
        clearTimeout(timeout)
        resolve(message as CommentsDataMessage)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
  })
}
