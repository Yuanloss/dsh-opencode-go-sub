'use strict'
// 模态一致性测试：listModels 与 resolveModel 必须一致，否则 vision-toolkit 变体报错
const mod = require('D:/DeepSeekHarness/会话/dsh-opencode-go-sub/lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })
;(async () => {
  const sub = await adapter.listModels(mod.SUB_PROVIDER)
  let allConsistent = true
  for (const m of sub) {
    const r = await adapter.resolveModel(mod.SUB_PROVIDER, m.id)
    const lm = JSON.stringify(m.inputModalities)
    const rm = JSON.stringify(r.inputModalities)
    const consistent = lm === rm
    if (!consistent) allConsistent = false
    console.log((consistent ? '✓' : '✗ MISMATCH') + ' ' + m.id.padEnd(34) + ' list=' + lm + ' resolve=' + rm + '  name=' + r.name)
  }
  const free = await adapter.listModels(mod.FREE_PROVIDER)
  for (const m of free) {
    const r = await adapter.resolveModel(mod.FREE_PROVIDER, m.id)
    const consistent = JSON.stringify(m.inputModalities) === JSON.stringify(r.inputModalities)
    if (!consistent) allConsistent = false
    console.log((consistent ? '✓' : '✗ MISMATCH') + ' ' + m.id.padEnd(34) + ' list=' + JSON.stringify(m.inputModalities) + ' resolve=' + JSON.stringify(r.inputModalities))
  }
  console.log('\n结论:', allConsistent ? '全部一致 ✅' : '存在不一致 ❌')
  // 关键：deepseek-v4-flash 应为 text-only（vision-toolkit 变体才不报错）
  const f = await adapter.resolveModel(mod.SUB_PROVIDER, 'deepseek-v4-flash')
  console.log('deepseek-v4-flash 模态:', JSON.stringify(f.inputModalities), '(应为 ["text"])')
  const v = await adapter.resolveModel(mod.SUB_PROVIDER, 'deepseek-v4-flash-vision-exp')
  console.log('deepseek-v4-flash-vision-exp 模态:', JSON.stringify(v.inputModalities), '(应为 ["text","image"])')
  process.exit(0)
})().catch((e) => { console.error('FAILED', e); process.exit(1) })
