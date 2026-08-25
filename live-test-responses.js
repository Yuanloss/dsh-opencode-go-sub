'use strict'
// 端到端验证：luna / grok-4.5（Responses 路由）+ deepseek-v4-flash（chat 路由回退检查）
const mod = require('./lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })

async function tryModel(model, text) {
  const chunks = []
  const t0 = Date.now()
  try {
    for await (const c of adapter.stream({
      provider: 'opencode-go',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      maxTokens: 120,
    })) {
      chunks.push(c)
    }
    const ms = Date.now() - t0
    const out = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
    const reason = chunks.filter((c) => c.type === 'reasoning-delta').map((c) => c.text).join('')
    const usage = chunks.find((c) => c.type === 'usage')?.usage
    const finish = chunks.find((c) => c.type === 'finish')?.reason
    console.log(`✅ ${model}: ${ms}ms 输出="${out.slice(0, 40)}" 推理=${reason.length}字 usage=${JSON.stringify(usage)} finish=${JSON.stringify(finish)}`)
    return true
  } catch (e) {
    console.log(`❌ ${model}: ${e.code} HTTP ${e.status || ''} | ${String(e.message || e).slice(0, 170)}`)
    return false
  }
}

;(async () => {
  const a = await tryModel('gpt-5.6-luna', '请只回复两个字：收到')
  const b = await tryModel('grok-4.5', '请只回复两个字：收到')
  const c = await tryModel('deepseek-v4-flash', '请只回复两个字：收到')
  console.log('汇总:', a && b && c ? '全部成功' : '有失败项')
  process.exit(0)
})()