'use strict'
// 冲突回归测试：llm-pi-ai.providers 残留同名 provider（opencode-go）时，
// 插件必须（a）检测并给出指引日志、（b）不再整批崩溃 / 不再静默让其它 pi-ai provider 消失。
const mod = require('./lib/index.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const SAMPLE = `
agent-default-model:
  model: deepseek-v4-flash
  provider: deepseek-official
llm-pi-ai:
  providers:
    arkcli-agent-plan:
      api: openai-completions
      apiKeyEnv: ARKCLI_AGENT_PLAN_API_KEY
      baseURL: https://ark.cn-beijing.volces.com/api/plan/v3
      displayName: Volcano Engine (Agent Plan)
      models:
        - id: ark-code-latest
          name: auto
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
    siliconflow:
      displayName: 硅基流动
      apiKeyEnv: SILICONFLOW_API_KEY
      api: openai-completions
      baseURL: https://api.siliconflow.cn/v1
      models:
        - id: zai-org/GLM-5.3
`

const CLEAN = `
agent-default-model:
  model: deepseek-v4-flash
  provider: deepseek-official
llm-pi-ai:
  providers:
    arkcli-agent-plan:
      apiKeyEnv: ARKCLI_AGENT_PLAN_API_KEY
    siliconflow:
      apiKeyEnv: SILICONFLOW_API_KEY
`

function tmpYaml(content) {
  const f = path.join(os.tmpdir(), `dsh-ocg-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`)
  fs.writeFileSync(f, content)
  return f
}

;(async () => {
  // 场景1：含同名 opencode-go 的 settings → 应识别出冲突
  const f1 = tmpYaml(SAMPLE)
  const ids1 = mod.readLlmpiAiProviderIds(f1)
  const c1 = mod.llmpiAiRouteConflicts(f1)
  console.log('1) llm-pi-ai provider ids:', JSON.stringify(ids1))
  console.log('1) 与本插件冲突的 id:', JSON.stringify(c1), c1.length === 1 && c1[0] === 'opencode-go' ? '✅' : '❌')
  fs.unlinkSync(f1)

  // 场景2：用户已删除 opencode-go 块（与你的实际修复一致）→ 不应再有冲突
  const f2 = tmpYaml(CLEAN)
  const c2 = mod.llmpiAiRouteConflicts(f2)
  console.log('2) 删除后冲突:', JSON.stringify(c2), c2.length === 0 ? '✅（预期：pi-ai 恢复整批注册 arkcli-agent-plan + siliconflow）' : '❌')
  fs.unlinkSync(f2)

  // 场景3：apply() 正常无冲突 → 一次注册两条路由（与原先一致）
  const logs3 = []
  let calls3 = []
  const app3 = {
    llm: { registerAdapter: (p) => { calls3.push([...p]) } },
    logger: { info: (...a) => logs3.push(a.join(' ')), warn: (...a) => logs3.push('WARN ' + a.join(' ')), error: () => {} },
  }
  mod.apply(app3)
  await sleep(120)
  console.log('3) 无冲突注册调用:', JSON.stringify(calls3), calls3.length === 1 && calls3[0].length === 2 ? '✅' : '❌')
  console.log('3) 日志:', logs3.find((l) => l.includes('registered')) || '(none)')

  // 场景4：apply() 遇到 DUPLICATE_ADAPTER（另一适配器已占 opencode-go）→ 不再整批崩溃，
  // 逐路由降级：opencode-go 被跳过、opencode-zen 仍注册成功
  const logs4 = []
  const calls4 = []
  const taken = new Set()
  const app4 = {
    llm: {
      registerAdapter: (providers) => {
        for (const p of providers) {
          if (taken.has(p)) {
            const e = new Error(`an adapter for provider "${p}" is already registered`)
            e.code = 'DUPLICATE_ADAPTER'
            throw e
          }
        }
        for (const p of providers) { taken.add(p); calls4.push([...providers]) }
      },
    },
    logger: { info: (...a) => logs4.push(a.join(' ')), warn: (...a) => logs4.push('WARN ' + a.join(' ')), error: () => {} },
  }
  // 先模拟 llm-pi-ai 已占用 opencode-go
  taken.add('opencode-go')
  mod.apply(app4)
  await sleep(120)
  const freeRegistered = calls4.some((c) => c.length === 1 && c[0] === 'opencode-zen')
  console.log('4) DUPLICATE 降级注册调用:', JSON.stringify(calls4), '→ opencode-zen 已注册:', freeRegistered ? '✅' : '❌')
  console.log('4) 警告日志:', logs4.find((l) => l.includes('DUPLICATE_ADAPTER')) || '(none)')

  // 场景5：两条都被占 → 不抛异常，日志说明 NO provider registered
  const logs5 = []
  const app5 = {
    llm: {
      registerAdapter: (providers) => {
        const e = new Error('already registered')
        e.code = 'DUPLICATE_ADAPTER'
        throw e
      },
    },
    logger: { info: (...a) => logs5.push(a.join(' ')), warn: (...a) => logs5.push('WARN ' + a.join(' ')), error: () => {} },
  }
  let threw5 = false
  try { mod.apply(app5); await sleep(120) } catch (e) { threw5 = true }
  console.log('5) 双路由被占不抛异常:', threw5 ? '❌ 抛了' : '✅', '| 日志含 NO provider:', logs5.some((l) => l.includes('NO provider')) ? '✅' : '❌')

  // 场景6：非 DUPLICATE 错误应继续抛出（不吞其它错误）
  let threw6 = false
  const app6 = {
    llm: { registerAdapter: () => { const e = new Error('boom'); e.code = 'OTHER'; throw e } },
    logger: { info() {}, warn() {}, error() {} },
  }
  try { mod.apply(app6) } catch (e) { threw6 = true }
  console.log('6) 非 DUPLICATE 错误透传:', threw6 ? '✅' : '❌')

  process.exit(0)
})().catch((e) => {
  console.error('TEST FAILED', e)
  process.exit(1)
})
