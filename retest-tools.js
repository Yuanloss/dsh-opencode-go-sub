'use strict'
// 复测：luna / grok 在多轮工具调用会话下的 Responses 翻译（真实 DSH 消息形状）
const mod = require('D:/DeepSeekHarness/会话/dsh-opencode-go-sub/lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })

const tools = [
  { name: 'get_weather', description: '查询指定城市的天气', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
  { name: 'fetch_web_page', description: '抓取网页内容', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
]

// 模拟 DSH 多轮工具调用会话的消息（content 是块数组）
const toolConversation = [
  { role: 'user', content: [{ type: 'text', text: '北京天气怎么样？帮我查一下，然后告诉我' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '' },
      { type: 'tool-call', id: 'call_1', name: 'get_weather', arguments: '{"city":"beijing"}' },
    ],
  },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: '晴，25°C' }] }] },
  { role: 'user', content: [{ type: 'text', text: '好，谢谢。顺便用搜索工具查一下明天的天气' }] },
]

async function run(model, opts) {
  const t0 = Date.now()
  const chunks = []
  try {
    for await (const c of adapter.stream({ provider: 'opencode-go', model, ...opts })) chunks.push(c)
    const out = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
    const tcs = chunks.filter((c) => c.type === 'block-end' && c.block.type === 'tool-call')
    const usage = chunks.find((c) => c.type === 'usage')?.usage
    console.log(`✅ ${model}: ${Date.now() - t0}ms 输出="${out.slice(0, 40)}" 工具调用=${tcs.length} usage=${JSON.stringify(usage)}`)
    return true
  } catch (e) {
    console.log(`❌ ${model}: ${e.code} HTTP ${e.status || ''} | ${String(e.message || e).slice(0, 200)}`)
    return false
  }
}

;(async () => {
  // 1) luna 多轮工具会话（之前 400 的场景）
  await run('gpt-5.6-luna', { messages: toolConversation, tools, maxTokens: 128000, reasoningEffort: 'high' })
  // 2) grok 带工具（之前 tools 格式 400 的场景）
  await run('grok-4.5', { messages: toolConversation, tools, maxTokens: 128000, reasoningEffort: 'high' })
  // 3) luna 纯文本多轮（无工具，回归）
  await run('gpt-5.6-luna', {
    messages: [
      { role: 'user', content: [{ type: 'text', text: '第一轮：你好' }] },
      { role: 'assistant', content: [{ type: 'text', text: '你好！' }] },
      { role: 'user', content: [{ type: 'text', text: '第二轮：请只回复两个字：收到' }] },
    ],
    maxTokens: 128000,
  })
  process.exit(0)
})()