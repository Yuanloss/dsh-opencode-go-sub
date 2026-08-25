'use strict'
const mod = require('./lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })
;(async () => {
  for (const model of ['mimo-v2.5-free', 'hy3-free']) {
    const summary = { text: '', reasoning: 0, usage: null, finish: null, chunks: [] }
    try {
      for await (const c of adapter.stream({ provider: mod.FREE_PROVIDER, model, messages: [{ role: 'user', content: [{ type: 'text', text: '请用一句话介绍你自己' }] }], maxTokens: 400 })) {
        if (c.type === 'text-delta') summary.text += c.text
        if (c.type === 'reasoning-delta') summary.reasoning += c.text.length
        if (c.type === 'usage') summary.usage = c.usage
        if (c.type === 'finish') summary.finish = c.reason
        if (c.type.startsWith('block-')) summary.chunks.push(c.type)
      }
      console.log(model, '→ 文本="' + summary.text.slice(0, 30) + '" 推理字数=' + summary.reasoning + ' finish=' + JSON.stringify(summary.finish))
    } catch (e) {
      console.log(model, '→ 失败:', e.code, e.status, String(e.message).slice(0, 100))
    }
  }
  process.exit(0)
})()