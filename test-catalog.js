'use strict'
// dsh-opencode-go 目录/分组/路由测试：不打印任何密钥值
const mod = require('D:/DeepSeekHarness/会话/dsh-opencode-go-sub/lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })

;(async () => {
  console.log('=== providerInfo ===')
  console.log('go:', JSON.stringify(adapter.providerInfo(mod.SUB_PROVIDER)))
  console.log('zen:', JSON.stringify(adapter.providerInfo(mod.FREE_PROVIDER)))

  console.log('\n=== 免费档 listModels ===')
  const free = await adapter.listModels(mod.FREE_PROVIDER)
  console.log('数量:', free.length)
  free.forEach((m) => console.log('  ' + m.id.padEnd(30) + ' → ' + m.name + '  [' + (m.description || '') + ']'))

  console.log('\n=== 订阅档 listModels（有序 + 友好命名）===')
  const sub = await adapter.listModels(mod.SUB_PROVIDER)
  console.log('数量:', sub.length)
  sub.slice(0, 12).forEach((m) => console.log('  ' + m.id.padEnd(34) + ' → ' + m.name + '  [' + (m.description || '') + ']'))
  console.log('  ...（共 ' + sub.length + ' 项，前 12 项如上）')

  console.log('\n=== resolveModel ===')
  const d = await adapter.resolveModel(mod.SUB_PROVIDER, 'deepseek-v4-flash-vision-exp')
  console.log('deepseek-v4-flash-vision-exp → name=' + d.name + ' ctx=' + d.context.contextWindow + ' modality=' + JSON.stringify(d.inputModalities) + ' reasoning=' + d.reasoning.efforts.map(e => e.id).join('/'))
  const f = await adapter.resolveModel(mod.FREE_PROVIDER, 'mimo-v2.5-free')
  console.log('mimo-v2.5-free → name=' + f.name + ' ctx=' + f.context.contextWindow + ' reasoning=' + f.reasoning.efforts.map(e => e.id).join('/') + ' (默认off)')

  console.log('\n=== 免费档真实调用（public key）===')
  let freeOk = false
  try {
    let got = ''
    for await (const c of adapter.stream({ provider: mod.FREE_PROVIDER, model: 'mimo-v2.5-free', messages: [{ role: 'user', content: [{ type: 'text', text: '回复俩字：收到' }] }], maxTokens: 60 })) {
      if (c.type === 'text-delta') got += c.text
    }
    console.log('免费档成功，输出="' + got.slice(0, 20) + '"')
    freeOk = true
  } catch (e) {
    console.log('免费档失败:', e.code, e.status, String(e.message).slice(0, 110))
  }

  console.log('\n=== 订阅档（env 假 key 应优先，走到网关 401 而非 MISSING_CREDENTIAL）===')
  process.env.OPENCODE_GO_API_KEY = 'sk-test-dummy'
  try {
    for await (const _ of adapter.stream({ provider: mod.SUB_PROVIDER, model: 'deepseek-v4-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) {}
    console.log('未预期成功')
  } catch (e) {
    console.log('订阅档:', e.code, 'HTTP', e.status, '|', String(e.message).slice(0, 60))
  }
  delete process.env.OPENCODE_GO_API_KEY

  console.log('\n=== 未收录新模型的兜底名 ===')
  console.log(mod.displayName('mimo-v2-pro'))
  console.log(mod.displayName('qwen3.8-max'))

  process.exit(0)
})().catch((e) => { console.error('FAILED', e); process.exit(1) })
