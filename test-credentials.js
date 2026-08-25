'use strict'
// dsh-opencode-go 凭证层测试：不打印任何密钥值
const mod = require('D:/DeepSeekHarness/会话/dsh-opencode-go-sub/lib/index.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  // 场景1：清掉 env，只靠 ~/.dsh/.credentials.yaml → 应通过 yaml 找到 key（零配置证明）
  delete process.env.OPENCODE_GO_API_KEY
  delete process.env.OPENCODE_ZEN_API_KEY
  delete process.env.OPENCODE_API_KEY
  const r1 = await mod.resolveApiKey({})
  console.log(
    '1) 仅 .credentials.yaml:',
    r1 ? 'FOUND via ' + r1.source + ' (len=' + r1.value.length + ', value hidden)' : 'NOT FOUND',
  )

  // 场景2：设置 env 假 key → env 应优先于 yaml（DSH 凭证层同款优先级）
  process.env.OPENCODE_GO_API_KEY = 'sk-test-dummy'
  const r2 = await mod.resolveApiKey({})
  console.log('2) env 优先:', r2 ? r2.source + ' (len=' + r2.value.length + ')' : 'NOT FOUND')

  // 场景3：stream 带 env 假 key → 应发起 HTTP 并得到网关 401（证明 key 已接进请求头）
  const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })
  try {
    for await (const _ of adapter.stream({
      provider: 'opencode-go',
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      // 只验证请求是否发出
    }
    console.log('3) UNEXPECTED: stream succeeded with dummy key')
  } catch (e) {
    console.log('3) stream 带假 key:', e.code, 'HTTP', e.status, '|', (e.message || '').slice(0, 60))
  }

  // 场景4：cordis 风格 ctx（直接访问 ctx.credentials 会抛 without inject）→ resolveApiKey 不应崩溃
  const cordisCtx = new Proxy(
    { logger: { info() {}, warn() {}, error() {} } },
    {
      get(target, prop) {
        if (prop === 'credentials') throw new Error('cannot get property "credentials" without inject')
        if (prop === 'then') return undefined
        return target[prop]
      },
    },
  )
  let threw = false
  try { cordisCtx.credentials } catch { threw = true }
  const r4 = await mod.resolveApiKey(cordisCtx)
  console.log('4) cordis ctx 直访抛错:', threw ? 'yes' : 'no', '| resolveApiKey 结果:', r4 ? 'FOUND via ' + r4.source : 'NOT FOUND')

  // 场景5：apply() 在 cordis 风格 ctx 下注册 + 日志（不崩溃）
  const logs5 = []
  let registered5 = null
  const appCtx5 = new Proxy(
    {
      llm: { registerAdapter: (p, a) => { registered5 = [p, a] } },
      logger: { info: (...a) => logs5.push(a.join(' ')) },
    },
    {
      get(target, prop) {
        if (prop === 'credentials') throw new Error('cannot get property "credentials" without inject')
        if (prop === 'then') return undefined
        return target[prop]
      },
    },
  )
  mod.apply(appCtx5)
  await sleep(150)
  console.log('5) apply(cordis ctx) 注册:', JSON.stringify(registered5[0]))
  console.log('5) 启动日志:', logs5[0] ? logs5[0].slice(0, 140) : '(none)')

  delete process.env.OPENCODE_GO_API_KEY
})().catch((e) => {
  console.error('TEST FAILED', e)
  process.exit(1)
})
