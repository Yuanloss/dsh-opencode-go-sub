'use strict'
/**
 * dsh-opencode-go-sub — OpenCode Go / Zen 模型接入插件（服务端）
 *
 * 通过 ctx.llm.registerAdapter(['opencode-go', 'opencode-zen'], adapter)
 * 注册两个 provider 路由，让模型选择器像 opencode 官方客户端一样：
 *   - 「OpenCode Go（订阅）」：订阅档 30 个模型，按厂商分组有序、友好命名；
 *   - 「OpenCode Zen（免费）」：免费档 5 个模型（key='public'，无需订阅），标注免费。
 *
 * - 模型列表：订阅档实时 GET https://opencode.ai/zen/go/v1/models（与官方
 *   客户端 /models 同源），但按内置的「有序 + 友好命名」目录渲染；端点不可达
 *   时回退内置快照，列表永不为空。新出现的模型会自动追加到组内末尾。
 * - stream() 按 provider 路由：订阅档走 /zen/go/v1，其中 gpt-5.6-luna /
 *   grok-4.5 走 OpenAI Responses API（/v1/responses，chat 路由对它们恒 500/
 *   不可用），其余走 /chat/completions；免费档走 /zen/v1（key='public'）。
 *   透传流式输出、推理内容、工具调用、token 用量；429/5xx 重试一次。
 * - 密钥解析链（订阅档，不依赖 cordis 注入，任何环境都不会抛 without inject）：
 *   ① 进程环境变量 OPENCODE_GO_API_KEY / OPENCODE_ZEN_API_KEY / OPENCODE_API_KEY；
 *   ② $DSH_HOME/.credentials.yaml —— 用户在 DSH 内填一次即可（无需 opencode 客户端）；
 *   ③ dsh-api-key-pool 的 pool-config.json（pools.opencode-go / pools.opencode）。
 *
 * 注入：llm（注册 adapter）
 */

const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const name = 'dsh-opencode-go-sub'
const inject = ['llm']

const SUB_PROVIDER = 'opencode-go' // 订阅组
const FREE_PROVIDER = 'opencode-zen' // 免费组
const SUB_BASE = 'https://opencode.ai/zen/go/v1'
const FREE_BASE = 'https://opencode.ai/zen/v1'
const SUB_MODELS_URL = `${SUB_BASE}/models`
const OPENCODE_UA = 'opencode/1.18.18 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14'
const POOL_FILE = join(homedir(), '.dsh', 'profiles', 'web', 'plugins', 'dsh-api-key-pool', 'pool-config.json')

const LIST_TTL_MS = 5 * 60 * 1000
const MODELS_FETCH_TIMEOUT_MS = 8000
const DEFAULT_MAX_TOKENS = 128000
const DEFAULT_CONTEXT_WINDOW = 1000000
const DEFAULT_STREAM_TIMEOUT_MS = 60000
const MAX_REQUEST_ATTEMPTS = 2

/**
 * 订阅档模型目录（有序：按厂商分组，DeepSeek 优先；新出现但未在此列的模型
 * 会自动追加到组内末尾）。name 用于选择器展示，description 为补充说明，
 * context 为近似上下文窗口。
 */
const SUB_CATALOG = {
  // DeepSeek
  'deepseek-v4-flash-vision-exp': { name: 'DeepSeek V4 Flash Vision', description: '深度思考 · 视觉 · 便宜', context: 1000000, vision: true },
  'deepseek-v4-flash': { name: 'DeepSeek V4 Flash', description: '深度思考 · 便宜高速', context: 1000000 },
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', description: 'DeepSeek 旗舰推理', context: 1000000 },
  // OpenAI
  'gpt-5.6-luna': { name: 'GPT 5.6 Luna', description: 'OpenAI 新款 · 视觉', context: 1050000, vision: true },
  // xAI
  'grok-4.5': { name: 'Grok 4.5', description: 'xAI 旗舰 · 视觉', context: 500000, vision: true },
  // 智谱 GLM
  'glm-5.3': { name: 'GLM 5.3', description: '智谱最新', context: 1000000 },
  'glm-5.2': { name: 'GLM 5.2', description: '智谱', context: 1000000 },
  'glm-5.1': { name: 'GLM 5.1', description: '智谱', context: 202752 },
  'glm-5': { name: 'GLM 5', description: '智谱', context: 1000000 },
  // 月之暗面 Kimi
  'kimi-k3': { name: 'Kimi K3', description: '月之暗面旗舰 · 视觉', context: 1048576, vision: true },
  'kimi-k2.7-code': { name: 'Kimi K2.7 Code', description: '代码强 · 视觉', context: 262144, vision: true },
  'kimi-k2.6': { name: 'Kimi K2.6', description: '通用 · 视觉', context: 262144, vision: true },
  'kimi-k2.5': { name: 'Kimi K2.5', description: '通用', context: 262144 },
  // MiniMax
  'minimax-m3': { name: 'MiniMax M3', description: 'MiniMax 旗舰', context: 1000000 },
  'minimax-m2.7': { name: 'MiniMax M2.7', description: 'MiniMax', context: 1000000 },
  'minimax-m2.5': { name: 'MiniMax M2.5', description: 'MiniMax', context: 1000000 },
  // 小米 MiMo
  'mimo-v2.5-pro': { name: 'MiMo V2.5 Pro', description: '小米旗舰', context: 1000000 },
  'mimo-v2.5': { name: 'MiMo V2.5', description: '小米 · 便宜', context: 1000000 },
  'mimo-v2-pro': { name: 'MiMo V2 Pro', description: '小米', context: 1000000 },
  'mimo-v2-omni': { name: 'MiMo V2 Omni', description: '多模态', context: 1000000, vision: true },
  // 阿里 Qwen
  'qwen3.8-max': { name: 'Qwen 3.8 Max', description: '阿里最新旗舰', context: 1000000, vision: true },
  'qwen3.7-max': { name: 'Qwen 3.7 Max', description: '阿里旗舰', context: 1000000, vision: true },
  'qwen3.7-plus': { name: 'Qwen 3.7 Plus', description: '阿里', context: 1000000 },
  'qwen3.6-plus': { name: 'Qwen 3.6 Plus', description: '阿里', context: 1000000 },
  'qwen3.5-plus': { name: 'Qwen 3.5 Plus', description: '阿里', context: 1000000 },
  // Meta
  'muse-spark-1.2-contributor': { name: 'Muse Spark 1.2', description: 'Meta · 部分区域', context: 1000000, vision: true },
  // 其他
  'longcat-2.0': { name: 'LongCat 2.0', description: '超长上下文', context: 1000000 },
  'hy3': { name: 'Hy3', description: '快手', context: 256000 },
  'hy3-preview': { name: 'Hy3 Preview', description: '快手预览', context: 256000 },
  'ox-alpha-free': { name: 'Ox Alpha Free', description: '限时免费', context: 128000 },
}
const SUB_ORDER = Object.keys(SUB_CATALOG)

/** 免费档模型目录（key='public'，无需订阅；2026-08 实测可用） */
const FREE_CATALOG = {
  'mimo-v2.5-free': { name: 'MiMo V2.5（免费）', description: '免费档 · 小米', context: 200000 },
  'hy3-free': { name: 'Hy3（免费）', description: '免费档 · 快手', context: 200000 },
  'nemotron-3-ultra-free': { name: 'Nemotron 3 Ultra（免费）', description: '免费档 · NVIDIA', context: 131072 },
  'nemotron-3.5-lightning-free': { name: 'Nemotron 3.5 Lightning（免费）', description: '免费档 · NVIDIA', context: 131072 },
  'laguna-s-2.1-free': { name: 'Laguna S 2.1（免费）', description: '免费档', context: 200000 },
}

/** 接收图像输入的模型（advisory，用于声明 inputModalities）。
 *  注意：deepseek-v4-flash 是纯文本版（vision 版是 deepseek-v4-flash-vision-exp），
 *  不能列入——否则 vision-toolkit 的 "image-input variant" 会因模态不一致报错。 */
const VISION_MODELS = new Set([
  'gpt-5.6-luna', 'grok-4.5', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3',
  'deepseek-v4-flash-vision-exp', 'mimo-v2-omni',
  'muse-spark-1.2-contributor', 'qwen3.7-max', 'qwen3.8-max',
])

/**
 * 统一模态判断：listModels 与 resolveModel 共用，保证两者一致。
 * 目录内模型以 catalog 的 vision 标记为准；目录外（网关新出现）模型用 VISION_MODELS 兜底。
 */
function isVision(id, meta) {
  if (meta && typeof meta.vision === 'boolean') return meta.vision
  return VISION_MODELS.has(id)
}

/** 只能走 OpenAI Responses API（/v1/responses）的模型：网关 chat 路由恒 500/不可用。 */
const RESPONSES_MODELS = new Set(['gpt-5.6-luna', 'grok-4.5'])

const REASONING_LEVELS = [
  { id: 'off', name: 'Off', description: '不思考，最快' },
  { id: 'low', name: 'Low', description: '轻量思考' },
  { id: 'high', name: 'High', description: '深度思考（默认）' },
  { id: 'max', name: 'Max', description: '极限思考，最耗额度' },
]
const DEFAULT_REASONING = 'high'

/** 端点不可达时的订阅档兜底 id（与官方 /models 同源快照）。 */
const FALLBACK_MODELS = SUB_ORDER

function log(ctx, level, msg) {
  try { ctx.logger[level](`[dsh-opencode-go-sub] ${msg}`) } catch { /* noop */ }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function providerError(message, code, status) {
  const e = new Error(message)
  e.code = code
  if (status !== undefined) e.status = status
  return e
}

/** 未收录新模型的兜底展示名：把 id 里的 '-' 换空格并大写。 */
function displayName(id) {
  return id ? String(id).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') : id
}

const CREDENTIAL_REFS = ['OPENCODE_GO_API_KEY', 'OPENCODE_ZEN_API_KEY', 'OPENCODE_API_KEY']
const CREDENTIALS_FILE = join(homedir(), '.dsh', '.credentials.yaml')

/** 读取 $DSH_HOME/.credentials.yaml（极简解析，不依赖 yaml 库）。 */
function readCredentialsYaml() {
  const out = {}
  try {
    if (!existsSync(CREDENTIALS_FILE)) return out
    for (const line of readFileSync(CREDENTIALS_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/)
      if (!m || m[2] === '' || m[2].startsWith('#')) continue
      out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch { /* ignore */ }
  return out
}

/**
 * 订阅档密钥解析（按优先级，不依赖 cordis 注入，任何环境都不会抛 without inject）：
 * ① 进程环境变量；② $DSH_HOME/.credentials.yaml；③ dsh-api-key-pool。
 * @returns {Promise<{value: string, source: string} | undefined>}
 */
async function resolveApiKey(_ctx) {
  for (const ref of CREDENTIAL_REFS) {
    const v = process.env[ref]
    if (v && v !== 'public') return { value: v, source: `env:${ref}` }
  }
  const yamlCreds = readCredentialsYaml()
  for (const ref of CREDENTIAL_REFS) {
    const v = yamlCreds[ref]
    if (v && v !== 'public') return { value: v, source: `dsh-credentials:${ref}` }
  }
  try {
    if (existsSync(POOL_FILE)) {
      const raw = JSON.parse(readFileSync(POOL_FILE, 'utf8'))
      const oc = raw?.pools?.['opencode-go'] || raw?.pools?.opencode
      if (oc && Array.isArray(oc.keys)) {
        const key = oc.keys.find((k) => k && k !== 'public')
        if (key) return { value: key, source: 'pool-config.json' }
      }
    }
  } catch { /* ignore */ }
  return undefined
}

/** 实时拉取订阅档模型 id（带 TTL 缓存 + 内置快照兜底）。 */
let _listCache = null
let _listCachedAt = 0
async function fetchModelList() {
  const now = Date.now()
  if (_listCache && now - _listCachedAt < LIST_TTL_MS) return _listCache
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS)
    let json
    try {
      const resp = await fetch(SUB_MODELS_URL, {
        headers: { accept: 'application/json', 'user-agent': OPENCODE_UA },
        signal: controller.signal,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      json = await resp.json()
    } finally {
      clearTimeout(timer)
    }
    const ids = (json.data || []).map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) throw new Error('empty listing')
    _listCache = ids
    _listCachedAt = now
    return ids
  } catch (err) {
    if (_listCache) return _listCache
    return FALLBACK_MODELS
  }
}

/** 将 Harness 消息转成 OpenAI chat.completions 请求体 */
function serializeMessages(messages, systemPrompt) {
  const wire = []
  if (systemPrompt) wire.push({ role: 'system', content: systemPrompt })
  for (const m of messages || []) {
    const role = m.role
    if (role === 'system') {
      wire.push({ role: 'system', content: flattenText(m.content) })
      continue
    }
    if (role === 'assistant') {
      const text = flattenText(m.content)
      const reasoning = blocksOf(m.content, 'reasoning').map((b) => b.text).join('')
      const toolCalls = blocksOf(m.content, 'tool-call').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: b.arguments },
      }))
      const msg = { role: 'assistant', content: text }
      if (reasoning) msg.reasoning_content = reasoning
      if (toolCalls.length) msg.tool_calls = toolCalls
      wire.push(msg)
      continue
    }
    const text = flattenText(m.content)
    const toolResults = blocksOf(m.content, 'tool-result')
    if (text || toolResults.length === 0) wire.push({ role: 'user', content: text })
    for (const r of toolResults) {
      wire.push({ role: 'tool', tool_call_id: r.toolCallId, content: flattenText(r.content) || '(no output)' })
    }
  }
  return wire
}

function flattenText(content) {
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  return typeof content === 'string' ? content : ''
}

function blocksOf(content, type) {
  return Array.isArray(content) ? content.filter((b) => b.type === type) : []
}

function serializeTools(tools) {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

/** SSE 解析：逐行取 data，拼出 OpenAI 流式 chunks */
async function* parseSse(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return
        try { yield JSON.parse(data) } catch { /* 忽略坏行 */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 把 OpenAI 流式 chunk 翻译成 DSH 需要的块事件 */
async function* translateStream(rawChunks, estimateInput) {
  let nextIndex = 0
  let textBlock = null
  let reasoningBlock = null
  const toolBlocks = new Map()
  const order = []
  let finish = null
  let usage = null

  const open = (kind) => {
    const block = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const chunk of rawChunks) {
    const choices = chunk.choices || []
    for (const choice of choices) {
      const delta = choice.delta || {}
      const rc = delta.reasoning_content
      if (typeof rc === 'string' && rc.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += rc
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: rc }
      }
      const content = delta.content
      if (typeof content === 'string' && content.length > 0) {
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }
      for (const call of delta.tool_calls || []) {
        const idx = call.index || 0
        let block = toolBlocks.get(idx)
        if (!block) {
          block = open('tool-call')
          block.callId = ''
          toolBlocks.set(idx, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        const fn = call.function || {}
        if (call.id) block.callId = call.id
        if (fn.name) block.name = fn.name
        if (fn.arguments) {
          block.text += fn.arguments
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: block.callId,
            name: block.name || '',
            argumentsDelta: fn.arguments,
          }
        }
      }
      if (choice.finish_reason === 'length') finish = { kind: 'max-tokens' }
      else if (choice.finish_reason === 'tool_calls') finish = { kind: 'tool-calls' }
    }
    if (chunk.usage) usage = mapUsage(chunk.usage)
  }

  for (const block of order) {
    switch (block.kind) {
      case 'text': yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }; break
      case 'reasoning': yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }; break
      case 'tool-call':
        yield {
          type: 'block-end',
          index: block.index,
          block: { type: 'tool-call', id: block.callId || '', name: block.name || '', arguments: block.text },
        }
        break
    }
  }

  if (!usage && estimateInput) {
    const inputText = estimateInput()
    usage = {
      inputTokens: Math.ceil(inputText.length / 4),
      outputTokens: (textBlock?.text || '').length > 0 ? Math.ceil(textBlock.text.length / 4) : 0,
    }
  }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finish || { kind: 'stop' } }
}

function mapUsage(usage) {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens || 0
  return {
    inputTokens: (usage.prompt_tokens || 0) - (cacheRead || 0),
    outputTokens: usage.completion_tokens || 0,
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
  }
}

/**
 * 把 chat 消息转成 Responses API 的 input 条目：
 *   assistant 消息带 tool_calls → 拆成 message + function_call 条目；
 *   tool 结果 → function_call_output 条目（Responses 不认 chat 的
 *   tool_calls / role:"tool" 字段）。
 */
function buildResponsesInput(wireMessages) {
  const items = []
  for (const m of wireMessages || []) {
    const role = m.role
    const content = typeof m.content === 'string' ? m.content : ''
    if (role === 'system') {
      items.push({ type: 'message', role: 'system', content: [{ type: 'input_text', text: content }] })
    } else if (role === 'user') {
      items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] })
    } else if (role === 'assistant') {
      // 有文本才发 message 条目（xAI 上游拒绝空 content 数组）；
      // 工具调用单独发 function_call 条目
      if (content) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: content }],
        })
      }
      for (const tc of m.tool_calls || []) {
        items.push({
          type: 'function_call',
          call_id: tc.id || '',
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
        })
      }
    } else if (role === 'tool') {
      items.push({ type: 'function_call_output', call_id: m.tool_call_id || '', output: content || '(no output)' })
    }
  }
  return items
}

/** chat 格式工具 → Responses API 扁平格式 {type,name,description,parameters}。 */
function buildResponsesTools(wireTools) {
  if (!wireTools || wireTools.length === 0) return undefined
  return wireTools.map((t) => ({
    type: 'function',
    name: t.function?.name,
    description: t.function?.description,
    parameters: t.function?.parameters,
  }))
}

/** Responses API 请求体（gpt-5.6-luna / grok-4.5 专用）。 */
function buildResponsesBody(model, wireMessages, wireTools, maxTokens, temperature, effort) {
  const EFFORT_MAP = { low: 'low', high: 'high', max: 'high' }
  return {
    model,
    input: buildResponsesInput(wireMessages),
    stream: true,
    max_output_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort && EFFORT_MAP[effort] ? { reasoning: { effort: EFFORT_MAP[effort] } } : {}),
    ...(buildResponsesTools(wireTools) ? { tools: buildResponsesTools(wireTools) } : {}),
  }
}

/** 把 Responses API 流式事件翻译成 DSH 块事件 */
async function* translateResponses(events) {
  let nextIndex = 0
  let textBlock = null
  let reasoningBlock = null
  const toolBlocks = new Map()
  const order = []
  let finish = null
  let usage = null
  let failed = null

  const open = (kind) => {
    const block = { index: nextIndex++, kind, text: '', callId: '', name: '' }
    order.push(block)
    return block
  }

  for await (const ev of events) {
    switch (ev.type) {
      case 'response.output_text.delta': {
        const delta = ev.delta || ''
        if (!delta) break
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += delta
        yield { type: 'text-delta', index: textBlock.index, text: delta }
        break
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const delta = ev.summary ?? ev.delta ?? ''
        if (!delta) break
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += delta
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: delta }
        break
      }
      case 'response.function_call_arguments.delta': {
        const id = ev.item_id ?? ev.output_index ?? 0
        let b = toolBlocks.get(id)
        if (!b) {
          b = open('tool-call')
          b.itemId = id
          toolBlocks.set(id, b)
          yield { type: 'block-start', index: b.index, blockType: 'tool-call' }
        }
        const delta = ev.delta || ''
        if (delta) {
          b.text += delta
          yield { type: 'tool-call-delta', index: b.index, id: b.callId || '', argumentsDelta: delta }
        }
        break
      }
      case 'response.output_item.added': {
        const item = ev.item || {}
        if (item.type === 'function_call') {
          const id = item.id ?? ev.output_index ?? 0
          let b = toolBlocks.get(id)
          if (!b) {
            b = open('tool-call')
            b.itemId = id
            toolBlocks.set(id, b)
            yield { type: 'block-start', index: b.index, blockType: 'tool-call' }
          }
          if (item.name) b.name = item.name
          if (item.call_id) b.callId = item.call_id
        }
        break
      }
      case 'response.output_item.done': {
        const item = ev.item || {}
        if (item.type === 'function_call') {
          const id = item.id ?? ev.output_index ?? 0
          const b = toolBlocks.get(id)
          if (b) {
            if (item.name) b.name = item.name
            if (item.call_id) b.callId = item.call_id
            if (typeof item.arguments === 'string' && item.arguments) b.text = item.arguments
          }
        }
        break
      }
      case 'response.completed': {
        const resp = ev.response || {}
        usage = mapResponsesUsage(resp.usage)
        if (resp.status === 'failed' || resp.error) {
          failed = providerError(`OpenCode Go Responses API failed: ${JSON.stringify(resp.error || resp.incomplete_details || {}).slice(0, 300)}`, 'PROVIDER_ERROR')
        } else if (resp.status === 'incomplete' || resp.incomplete_details?.reason === 'max_output_tokens') {
          finish = { kind: 'max-tokens' }
        }
        break
      }
      case 'response.failed': {
        const resp = ev.response || {}
        failed = providerError(`OpenCode Go Responses API failed: ${JSON.stringify(resp.error || {}).slice(0, 300)}`, 'PROVIDER_ERROR')
        break
      }
      case 'error': {
        failed = providerError(`OpenCode Go Responses API error: ${JSON.stringify(ev.error || {}).slice(0, 300)}`, 'PROVIDER_ERROR')
        break
      }
    }
  }

  if (failed) throw failed

  for (const block of order) {
    switch (block.kind) {
      case 'text': yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }; break
      case 'reasoning': yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }; break
      case 'tool-call':
        yield {
          type: 'block-end',
          index: block.index,
          block: { type: 'tool-call', id: block.callId || '', name: block.name || '', arguments: block.text },
        }
        break
    }
  }

  if (usage) yield { type: 'usage', usage }
  if (!finish && toolBlocks.size > 0) finish = { kind: 'tool-calls' }
  yield { type: 'finish', reason: finish || { kind: 'stop' } }
}

function mapResponsesUsage(usage) {
  if (!usage) return undefined
  const cacheRead = usage.input_tokens_details?.cached_tokens || 0
  return {
    inputTokens: (usage.input_tokens || 0) - (cacheRead || 0),
    outputTokens: usage.output_tokens || 0,
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
  }
}

/** LlmAdapter 核心实现 */
class OpenCodeGoAdapter {
  constructor(ctx) { this.ctx = ctx }

  providerInfo(provider) {
    if (provider === FREE_PROVIDER) return { id: FREE_PROVIDER, name: 'OpenCode Zen（免费）' }
    if (provider === SUB_PROVIDER) return { id: SUB_PROVIDER, name: 'OpenCode Go（订阅）' }
    return { id: provider, name: provider }
  }

  providerRetryPolicy() {
    return {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['RATE_LIMITED', 'TIMEOUT', 'TRANSPORT'],
      backoff: { initialDelayMs: 800, maxDelayMs: 5000, jitterRatio: 0.1 },
    }
  }

  /** 免费档：固定有序目录。 */
  listFreeModels() {
    return Object.keys(FREE_CATALOG).map((id) => {
      const m = FREE_CATALOG[id]
      return { provider: FREE_PROVIDER, id, name: m.name, description: m.description, inputModalities: isVision(id, m) ? ['text', 'image'] : ['text'] }
    })
  }

  /** 订阅档：实时同步网关目录，但按内置「有序 + 友好命名」渲染。 */
  async listSubModels() {
    const ids = await fetchModelList()
    const inCatalog = SUB_ORDER.filter((id) => ids.includes(id))
    const extras = ids.filter((id) => !SUB_ORDER.includes(id))
    const known = inCatalog.map((id) => {
      const m = SUB_CATALOG[id]
      return { provider: SUB_PROVIDER, id, name: m.name, description: m.description, inputModalities: isVision(id, m) ? ['text', 'image'] : ['text'] }
    })
    const added = extras.map((id) => {
      const m = SUB_CATALOG[id]
      return {
        provider: SUB_PROVIDER,
        id,
        name: m?.name || displayName(id),
        description: m?.description,
        inputModalities: isVision(id, undefined) ? ['text', 'image'] : ['text'],
      }
    })
    return known.concat(added)
  }

  async listModels(provider) {
    if (provider === FREE_PROVIDER) return this.listFreeModels()
    return this.listSubModels()
  }

  resolveModel(provider, model) {
    const isFree = provider === FREE_PROVIDER
    const meta = (isFree ? FREE_CATALOG : SUB_CATALOG)[model]
    const context = meta?.context || DEFAULT_CONTEXT_WINDOW
    const name = meta?.name || model
    const modality = isVision(model, meta) ? ['text', 'image'] : ['text']
    return Promise.resolve({
      provider,
      id: model,
      name,
      inputModalities: modality,
      context: { contextWindow: context },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      // 免费档不确认支持推理级别，默认 off（不发送 reasoning_effort）；订阅档保留多档。
      reasoning: isFree ? { efforts: [{ id: 'off', name: 'Off', description: '默认' }], defaultEffort: 'off' } : { efforts: REASONING_LEVELS, defaultEffort: DEFAULT_REASONING },
    })
  }

  /**
   * 新版 DSH（dsh-llm >= 0.1.0-rc.7 / 0.1.1-rc.x）的适配器接口要求：
   * 把「解析模型元数据 + 分发请求」绑定到同一代适配器，返回
   * { model, stream }。旧版 DSH 从不调用此方法，加上它对新旧版本都无害。
   * @param {string} provider - 注册的 provider 路由
   * @param {string} model - 精确模型 id
   * @param {AbortSignal} [signal] - 模型解析的取消信号
   * @returns {Promise<{model: object, stream: (options: object) => AsyncIterable}>}
   */
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options) {
    try {
      yield* this._streamImpl(options)
    } catch (err) {
      try { console.error('[dsh-opencode-go-sub] stream error:', err && err.stack || err) } catch { /* noop */ }
      try { if (this.ctx?.logger?.error) this.ctx.logger.error(`[dsh-opencode-go-sub] stream error: ${err && err.stack || err}`) } catch { /* noop */ }
      throw err
    }
  }

  async *_streamImpl(options) {
    const { model, messages, system, tools, maxTokens, reasoningEffort, temperature, signal } = options
    const isFree = options.provider === FREE_PROVIDER

    // 密钥：免费档恒用 'public'；订阅档走解析链
    let key
    if (isFree) key = { value: 'public', source: 'zen-free' }
    else {
      key = await resolveApiKey(this.ctx)
      if (!key) {
        throw providerError(
          'OpenCode Go API key not found — 在 DSH 内配置凭证即可：编辑 ~/.dsh/.credentials.yaml 添加 OPENCODE_GO_API_KEY: sk-...（或通过 DSH 凭证设置界面添加），无需安装 opencode 客户端；也可设置环境变量 OPENCODE_GO_API_KEY，或在 dsh-api-key-pool 的 pool-config.json 的 pools.opencode-go 下配置 key',
          'MISSING_CREDENTIAL',
          401,
        )
      }
    }
    const apiKey = key.value

    const effort = reasoningEffort && reasoningEffort !== 'off' ? reasoningEffort : undefined
    const wireMessages = serializeMessages(messages, system)
    const wireTools = serializeTools(tools)

    // 端点路由：免费档走 /zen/v1；订阅档中 luna/grok 走 Responses，其余走 chat
    let endpoint
    let body
    if (isFree) {
      endpoint = `${FREE_BASE}/chat/completions`
      body = {
        model,
        messages: wireMessages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(wireTools ? { tools: wireTools, tool_choice: 'auto' } : {}),
      }
    } else {
      const useResponses = RESPONSES_MODELS.has(model)
      endpoint = `${SUB_BASE}${useResponses ? '/responses' : '/chat/completions'}`
      body = useResponses
        ? buildResponsesBody(model, wireMessages, wireTools, maxTokens, temperature, effort)
        : {
            model,
            messages: wireMessages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
            top_p: 0.95,
            ...(temperature !== undefined ? { temperature } : {}),
            ...(wireTools ? { tools: wireTools, tool_choice: 'auto' } : {}),
            ...(effort ? { reasoning_effort: effort } : {}),
          }
    }

    let lastError = null
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw providerError('OpenCode Go request aborted by caller', 'ABORTED')
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_STREAM_TIMEOUT_MS)
        const onAbort = () => controller.abort()
        if (signal) signal.addEventListener('abort', onAbort)

        let response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'User-Agent': OPENCODE_UA,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)
        }

        if (!response.ok) {
          const raw = await response.text().catch(() => '')
          const code = response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'TRANSPORT' : 'PROVIDER_ERROR'
          lastError = providerError(`OpenCode Go HTTP ${response.status}: ${raw.slice(0, 400) || '(no body)'}`, code, response.status)
          if (code !== 'RATE_LIMITED' && code !== 'TRANSPORT') throw lastError
          await sleep(400 * (attempt + 1))
          continue
        }

        if (isFree) yield* translateStream(parseSse(response), () => JSON.stringify(wireMessages))
        else if (RESPONSES_MODELS.has(model)) yield* translateResponses(parseSse(response))
        else yield* translateStream(parseSse(response), () => JSON.stringify(wireMessages))
        return
      } catch (err) {
        if (signal?.aborted) throw providerError('OpenCode Go request aborted by caller', 'ABORTED')
        if (err.name === 'AbortError' && !options.timeoutMs) throw err
        lastError = err
        if (attempt < MAX_REQUEST_ATTEMPTS - 1) await sleep(400 * (attempt + 1))
      }
    }
    throw lastError || providerError('OpenCode Go request failed', 'PROVIDER_ERROR')
  }
}

function apply(ctx) {
  ctx.llm.registerAdapter([SUB_PROVIDER, FREE_PROVIDER], new OpenCodeGoAdapter(ctx))
  resolveApiKey(ctx)
    .then((key) => {
      const src = key ? `订阅 key resolved from ${key.source}` : '订阅 key NOT configured（免费档仍可用；订阅档需在 DSH 凭证里配 OPENCODE_GO_API_KEY）'
      log(ctx, 'info', `providers "${SUB_PROVIDER}"(订阅) / "${FREE_PROVIDER}"(免费) registered; ${src}`)
    })
    .catch(() => {})
}

module.exports = {
  apply, inject, name, OpenCodeGoAdapter,
  SUB_PROVIDER, FREE_PROVIDER, SUB_BASE, FREE_BASE, SUB_MODELS_URL,
  SUB_CATALOG, SUB_ORDER, FREE_CATALOG, FALLBACK_MODELS,
  resolveApiKey, fetchModelList, displayName,
}
