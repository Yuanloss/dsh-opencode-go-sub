'use strict'
// 适配器契约测试：对齐 dsh-llm（0.1.2-rc.1 与 0.1.5-rc.1 契约一致）的 LlmAdapter 抽象方法与注册表校验规则。
// 不打印任何密钥值；订阅档目录需联网（端点不可达时插件自身会回退内置快照）。
const mod = require('./lib/index.js')
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })

let failed = 0
const ok = (cond, label, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

// dsh-llm 抽象类 LlmAdapter 的全部方法（0.1.5 实测：providerInfo/providerRetryPolicy/
// imageRequestPricing/listModels/resolveModel/prepareCall）
const ABSTRACT_METHODS = ['providerInfo', 'providerRetryPolicy', 'imageRequestPricing', 'listModels', 'resolveModel', 'prepareCall']

// 复刻 dsh-llm 的 llm 服务实现：this.adapters.get(provider)?.adapter.imageRequestPricing(...)
function registryImageRequestPricing(provider, model) {
  const registry = { adapters: new Map([[provider, { adapter }]]) }
  return registry.adapters.get(provider)?.adapter.imageRequestPricing(provider, model)
}

// 复刻 dsh-llm prepareRoutes 对 providerInfo 的校验
function checkProviderInfo(provider) {
  const info = adapter.providerInfo(provider)
  return typeof info.id === 'string' && info.id === provider && typeof info.name === 'string' && info.name.length > 0
}

// 复刻 dsh-llm normalizeModelInfo 对 resolveModel 结果的校验
function checkResolved(info, provider, model) {
  const problems = []
  if (typeof info.provider !== 'string' || info.provider !== provider) problems.push('provider')
  if (typeof info.id !== 'string' || info.id !== model) problems.push('id')
  if (typeof info.name !== 'string' || info.name.length === 0) problems.push('name')
  if (info.description !== undefined && typeof info.description !== 'string') problems.push('description')
  const ctx = info.context
  if (ctx !== undefined && (!Number.isInteger(ctx.contextWindow) || ctx.contextWindow <= 0)) problems.push('context.contextWindow')
  if (info.systemPromptUpdate !== undefined && info.systemPromptUpdate !== 'in-history') problems.push('systemPromptUpdate')
  if (info.defaultMaxTokens !== undefined && (!Number.isSafeInteger(info.defaultMaxTokens) || info.defaultMaxTokens <= 0)) problems.push('defaultMaxTokens')
  if (info.inputModalities !== undefined && !Array.isArray(info.inputModalities)) problems.push('inputModalities')
  const reasoning = info.reasoning
  if (reasoning !== undefined) {
    if (!Array.isArray(reasoning.efforts) || reasoning.efforts.length === 0) problems.push('reasoning.efforts(empty)')
    const seen = new Set()
    for (const e of reasoning.efforts || []) {
      if (typeof e.id !== 'string' || e.id.length === 0 || typeof e.name !== 'string' || e.name.length === 0) problems.push('reasoning.effort(id/name)')
      if (e.description !== undefined && typeof e.description !== 'string') problems.push('reasoning.effort(description)')
      if (seen.has(e.id)) problems.push('reasoning.effort(duplicate)')
      seen.add(e.id)
    }
    if (reasoning.defaultEffort !== undefined && !seen.has(reasoning.defaultEffort)) problems.push('reasoning.defaultEffort(unknown)')
  }
  return problems
}

// 复刻 dsh-llm listModels 校验
function checkCatalog(list, provider) {
  const problems = []
  const seen = new Set()
  for (const m of list) {
    if (typeof m.provider !== 'string' || m.provider !== provider) problems.push('provider')
    if (typeof m.id !== 'string' || m.id.length === 0) problems.push('id')
    if (typeof m.name !== 'string' || m.name.length === 0) problems.push('name')
    if (m.description !== undefined && typeof m.description !== 'string') problems.push('description')
    if (seen.has(m.id)) problems.push('duplicate:' + m.id)
    seen.add(m.id)
  }
  return problems
}

;(async () => {
  console.log('=== 1. LlmAdapter 抽象契约（6 个方法）===')
  for (const m of ABSTRACT_METHODS) ok(typeof adapter[m] === 'function', `实现 ${m}()`, `typeof=${typeof adapter[m]}`)

  console.log('\n=== 2. token-meter 崩溃路径（dsh-compaction-basic → meter.measure → llm.imageRequestPricing）===')
  for (const p of [mod.SUB_PROVIDER, mod.FREE_PROVIDER]) {
    try {
      const r = registryImageRequestPricing(p, 'deepseek-v4-flash')
      ok(r === undefined, `${p}: 返回 undefined 且不抛错`, `got=${JSON.stringify(r)}`)
    } catch (e) {
      ok(false, `${p}: 抛错`, `${e.constructor.name}: ${e.message}`)
    }
  }

  console.log('\n=== 3. providerInfo 校验（prepareRoutes 规则）===')
  for (const p of [mod.SUB_PROVIDER, mod.FREE_PROVIDER]) ok(checkProviderInfo(p), `providerInfo("${p}") 合法`, JSON.stringify(adapter.providerInfo(p)))

  console.log('\n=== 4. listModels 校验（注册表规则 + 去重）===')
  const free = await adapter.listModels(mod.FREE_PROVIDER)
  const sub = await adapter.listModels(mod.SUB_PROVIDER)
  ok(checkCatalog(free, mod.FREE_PROVIDER).length === 0, `免费档目录合法 (${free.length} 项)`, checkCatalog(free, mod.FREE_PROVIDER).join(',') || 'no problems')
  ok(checkCatalog(sub, mod.SUB_PROVIDER).length === 0, `订阅档目录合法 (${sub.length} 项)`, checkCatalog(sub, mod.SUB_PROVIDER).join(',') || 'no problems')

  console.log('\n=== 5. resolveModel 校验（normalizeModelInfo 规则，含推理档位）===')
  const samples = [
    [mod.SUB_PROVIDER, 'deepseek-v4-flash'],
    [mod.SUB_PROVIDER, 'gpt-5.6-luna'],
    [mod.SUB_PROVIDER, 'deepseek-v4-flash-vision-exp'],
    [mod.FREE_PROVIDER, 'mimo-v2.5-free'],
  ]
  for (const [p, m] of samples) {
    const info = await adapter.resolveModel(p, m)
    const problems = checkResolved(info, p, m)
    ok(problems.length === 0, `resolveModel("${p}","${m}") 合法`, problems.length ? problems.join(',') : `ctx=${info.context.contextWindow} mod=${JSON.stringify(info.inputModalities)} efforts=${(info.reasoning?.efforts || []).map((e) => e.id).join('/')}`)
  }

  console.log('\n=== 6. prepareCall 形状（新版 DSH 要求 {model, stream}）===')
  const prepared = await adapter.prepareCall(mod.SUB_PROVIDER, 'deepseek-v4-flash')
  ok(prepared && typeof prepared === 'object', 'prepareCall 返回对象')
  ok(prepared.model && prepared.model.id === 'deepseek-v4-flash', 'prepared.model 元数据正确')
  ok(typeof prepared.stream === 'function', 'prepared.stream 为函数')

  console.log(`\n结论: ${failed === 0 ? '全部通过 ✅（与 0.1.2-rc.1 / 0.1.5-rc.1 契约一致）' : failed + ' 项失败 ❌'}`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1) })
