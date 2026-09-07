'use strict'
// x-opencode-session 头值派生逻辑测试（不打印密钥、默认不发网络请求）
const mod = require('./lib/index.js')

;(async () => {
  // 1) DSH session-<uuid> 会话 id → 裸 UUID
  const a = mod.opencodeSessionId('session-05681fd4-1667-4f46-874f-11fd7f10abbe')
  console.log('1) session-<uuid> →', a, a === '05681fd4-1667-4f46-874f-11fd7f10abbe' ? '✅' : '❌')

  // 2) 裸 UUID → 原样
  const b = mod.opencodeSessionId('05681fd4-1667-4f46-874f-11fd7f10abbe')
  console.log('2) 裸 uuid →', b, b === '05681fd4-1667-4f46-874f-11fd7f10abbe' ? '✅' : '❌')

  // 3) 非 UUID 稳定 id → 清洗后原样（保持该会话内稳定即可）
  const c = mod.opencodeSessionId('probe-abc123')
  console.log('3) probe-abc123 →', c, c === 'probe-abc123' ? '✅' : '❌')

  // 4) 含换行等不可见字符 → 清洗（防头注入）
  const d = mod.opencodeSessionId('bad\nid')
  console.log('4) 含换行 →', JSON.stringify(d), d === 'badid' ? '✅' : '❌')

  // 5) 空/缺省 → undefined（不带头）
  const e = mod.opencodeSessionId(undefined)
  const f = mod.opencodeSessionId('')
  console.log('5) 缺省/空 →', JSON.stringify(e), JSON.stringify(f), e === undefined && f === undefined ? '✅' : '❌')

  // 6) 进程级回退：稳定且是 UUID，两次一致
  const g1 = mod.processSessionId()
  const g2 = mod.processSessionId()
  console.log('6) 进程回退稳定且 UUID:', g1 === g2 && /^[0-9a-f-]{36}$/.test(g1) ? '✅' : '❌', g1)

  // 7) UUID 从长 id 中部提取
  const h = mod.opencodeSessionId('user-ctx:05681fd4-1667-4f46-874f-11fd7f10abbe:suffix')
  console.log('7) 中段 uuid 提取 →', h, h === '05681fd4-1667-4f46-874f-11fd7f10abbe' ? '✅' : '❌')

  process.exit(0)
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1) })
