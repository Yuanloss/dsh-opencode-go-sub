// 真实注册表集成测试（DSH 升级回归工具）
//
// 用**真实 dsh-llm** 的 LlmRuntime 注册本插件的适配器，然后走真实调用路径校验契约：
//   registerAdapter → listProviders → imageRequestPricing → listModels → prepareCall
// 其中 imageRequestPricing 是 dsh-token-meter.measure() 无条件调用的方法
// （dsh-compaction-basic 的 prepareCompaction 会走到），适配器缺失该方法会抛
// TypeError 导致上下文压缩失败——本测试即为此回归而生。
//
// 用法（默认自动探测当前安装的 DSH；也可显式指定以验证升级目标版本）：
//   node test-integration.mjs
//   node test-integration.mjs "C:\path\to\node_modules\@deepseek-ai\dsh-llm"
//   node test-integration.mjs "C:\temp\int\node_modules\@deepseek-ai\dsh-llm" "D:\path\to\dsh-opencode-go-sub"
//
// 验证某个候选 DSH 版本时，可先临时安装其 dsh-llm：
//   npm i --prefix %TEMP%\dsh-int @deepseek-ai/dsh-llm@0.1.5-rc.1
//   node test-integration.mjs "%TEMP%\dsh-int\node_modules\@deepseek-ai\dsh-llm"
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

/** 依次尝试：命令行参数 → 本机 DSH 安装 → 全局 npm 安装。 */
function resolveDshLlmDir(arg) {
  const candidates = []
  if (arg) candidates.push(arg)
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : undefined
  if (npmRoot) candidates.push(join(npmRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm'))
  if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-llm'))
  for (const c of candidates) if (c && existsSync(join(c, 'lib', 'index.js'))) return c
  return undefined
}

const dshLlmDir = resolveDshLlmDir(process.argv[2])
if (dshLlmDir === undefined) {
  console.error('找不到 dsh-llm：请显式传入其包目录，例如')
  console.error('  node test-integration.mjs "C:\\path\\to\\node_modules\\@deepseek-ai\\dsh-llm"')
  process.exit(2)
}
const pluginDir = process.argv[3] || here

const dshLlm = await import(pathToFileURL(join(dshLlmDir, 'lib', 'index.js')).href)
const LlmRuntime = dshLlm.LlmRuntime ?? dshLlm.default
if (typeof LlmRuntime !== 'function') {
  console.error('无法取得 LlmRuntime，导出键:', Object.keys(dshLlm).slice(0, 20).join(', '))
  process.exit(2)
}
const dshLlmVersion = require(join(dshLlmDir, 'package.json')).version
const mod = require(join(pluginDir, 'lib', 'index.js'))

/** 最小 cordis 风格 ctx：只提供 LlmRuntime 构造与 registerAdapter 真正用到的能力。 */
function makeCtx() {
  return {
    events: { dispatch: () => [] },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(fn) {
      const it = fn()
      const r = it.next()
      return typeof r.value === 'function' ? r.value : () => {}
    },
    get: () => undefined,
    provide: () => {},
    reflect: { provide: () => {}, get: () => undefined, set: () => {} },
    waterfall: (...args) => args[args.length - 1](),
    inject: () => {},
  }
}

let failed = 0
const ok = (cond, label, extra = '') => { if (!cond) failed++; console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`) }

console.log(`dsh-llm ${dshLlmVersion}  ←  ${dshLlmDir}`)
console.log(`插件 ${require(join(pluginDir, 'package.json')).version}\n`)

const llm = new LlmRuntime(makeCtx())
const adapter = new mod.OpenCodeGoAdapter({ logger: { info() {}, warn() {}, error() {} } })

console.log('--- registerAdapter（真实 prepareRoutes 校验）---')
try {
  llm.registerAdapter([mod.SUB_PROVIDER, mod.FREE_PROVIDER], adapter)
  ok(true, '两条路由注册成功')
} catch (e) {
  ok(false, 'registerAdapter 失败', `${e.code || e.constructor.name}: ${e.message}`)
  process.exit(1)
}

console.log('\n--- listProviders ---')
const routes = llm.listProviders()
ok(routes.some((r) => r.id === mod.SUB_PROVIDER) && routes.some((r) => r.id === mod.FREE_PROVIDER), '两条路由出现在注册表', JSON.stringify(routes))

console.log('\n--- imageRequestPricing（token-meter/压缩路径；缺方法即 TypeError）---')
for (const p of [mod.SUB_PROVIDER, mod.FREE_PROVIDER]) {
  try {
    const r = llm.imageRequestPricing(p, 'deepseek-v4-flash')
    ok(r === undefined, `${p}: 返回 undefined 且不抛错`, `got=${JSON.stringify(r)}`)
  } catch (e) {
    ok(false, `${p}: 抛错（上下文压缩会失败）`, `${e.constructor.name}: ${e.message}`)
  }
}

console.log('\n--- listModels（真实目录校验）---')
for (const p of [mod.SUB_PROVIDER, mod.FREE_PROVIDER]) {
  try {
    const list = await llm.listModels(p)
    ok(Array.isArray(list) && list.length > 0, `${p}: 通过校验`, `${list.length} 项，示例=${list[0]?.id}`)
  } catch (e) {
    ok(false, `${p}: 失败`, `${e.code || e.constructor.name}: ${e.message}`)
  }
}

console.log('\n--- prepareCall（服务级 API，内部走 normalizeModelInfo 元数据校验）---')
for (const [p, m] of [[mod.SUB_PROVIDER, 'deepseek-v4-flash'], [mod.SUB_PROVIDER, 'gpt-5.6-luna'], [mod.FREE_PROVIDER, 'mimo-v2.5-free']]) {
  try {
    const prepared = await llm.prepareCall({ provider: p, model: m })
    const shape = prepared && typeof prepared.stream === 'function' && prepared.config?.model === m
    ok(shape, `${p}/${m}: 通过校验`, `ctx=${prepared?.context?.contextWindow} mod=${JSON.stringify(prepared?.inputModalities)} reasoning=${prepared?.config?.reasoningEffort}`)
  } catch (e) {
    ok(false, `${p}/${m}: 失败`, `${e.code || e.constructor.name}: ${e.message}`)
  }
}

console.log(`\n结论: ${failed === 0 ? `与 dsh-llm ${dshLlmVersion} 契约一致 ✅` : failed + ' 项失败 ❌'}`)
process.exit(failed === 0 ? 0 : 1)
