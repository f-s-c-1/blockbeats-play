// Nitro 原生 WebSocket handler（PRD §7 连接层）
// 职责：连接 ↔ 身份映射；收 ClientEvent → reduce → 给全房广播「按连接裁剪的视图」

import { timingSafeEqual } from 'node:crypto'
import type { Peer } from 'crossws'
import type { ClientEvent, ServerEvent } from '../../shared/types'
import { reduce, buildPlayerView, buildAdminView } from '../game/room'
import { getRoom, newRoom, genCode, markDirty } from '../game/manager'
import { RICH_BOARD, richGroupOf } from '../../shared/richman'

// 连接绑定的会话信息
interface Session {
  code: string
  role: 'admin' | 'player'
  playerId?: string // 参与者
}

// peer.id -> Session
const sessions = new Map<string, Session>()

// 管理凭证/口令爆破防护：按房间码计失败次数（断线重连不会重置），
// 连错 LOCK_AFTER 次锁定 LOCK_MS，期间该房间一律拒绝管理登录
const loginFails = new Map<string, { count: number; lockedUntil: number }>()
const LOCK_AFTER = 5
const LOCK_MS = 15 * 60 * 1000

function isLocked(code: string): boolean {
  const f = loginFails.get(code)
  return !!f && f.lockedUntil > Date.now()
}
function recordLoginFail(code: string) {
  const f = loginFails.get(code) || { count: 0, lockedUntil: 0 }
  f.count++
  if (f.count >= LOCK_AFTER) { f.lockedUntil = Date.now() + LOCK_MS; f.count = 0 }
  loginFails.set(code, f)
}
function clearLoginFails(code: string) { loginFails.delete(code) }

// 常数时间比较，避免逐字符比较的时序侧信道
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
// code -> Set<peer>（用于广播）
const roomPeers = new Map<string, Set<Peer>>()

function normalizeCode(raw: string | undefined): string | null {
  const code = (raw || '').trim().toUpperCase()
  return /^[A-Z0-9]{3,8}$/.test(code) ? code : null
}

function send(peer: Peer, ev: ServerEvent) {
  try { peer.send(JSON.stringify(ev)) } catch { /* 连接已断 */ }
}

function attachPeer(code: string, peer: Peer) {
  if (!roomPeers.has(code)) roomPeers.set(code, new Set())
  roomPeers.get(code)!.add(peer)
}

function detachPeer(code: string, peer: Peer) {
  roomPeers.get(code)?.delete(peer)
}

// 给整个房间广播：每个连接各自计算视图（核心：裁剪在服务端，参与者拿不到别人内容）
function broadcast(code: string) {
  const rt = getRoom(code)
  const peers = roomPeers.get(code)
  if (!rt) return
  for (const peer of peers || []) {
    const sess = sessions.get(peer.id)
    if (!sess) continue
    if (sess.role === 'admin') {
      send(peer, { t: 'room:state', ...buildAdminView(rt) })
    } else if (sess.playerId) {
      send(peer, { t: 'room:state', ...buildPlayerView(rt, sess.playerId) })
    }
  }
  scheduleRichmanBot(code)
}

// ── 大富翁机器人自动驾驶 ──
// 轮到机器人队时延时行动：有待买决定就决定，被关有钱就保释，否则掷骰；
// 每次行动后 broadcast 会再次调用本函数，连续的机器人回合自动接力。
const botTimers = new Map<string, ReturnType<typeof setTimeout>>()
const BOT_ACT_MS = 3200 // 留足骰子+走格动画时间，全场看得清

function richmanBotTurn(rt: NonNullable<ReturnType<typeof getRoom>>): string | null {
  const st = rt.state.currentStage
  if (!st || st.type !== 'richman' || st.payload.finished) return null
  const pl = st.payload
  const cur = (pl.pending ? pl.pending.teamId : pl.order[pl.turnIdx]) as string
  const team = (pl.teams as { id: string; bot?: boolean }[]).find(t => t.id === cur)
  return team?.bot ? cur : null
}

function scheduleRichmanBot(code: string) {
  const rt = getRoom(code)
  const cur = rt ? richmanBotTurn(rt) : null
  if (!cur) {
    const t = botTimers.get(code)
    if (t) { clearTimeout(t); botTimers.delete(code) }
    return
  }
  if (botTimers.has(code)) return // 已排程
  botTimers.set(code, setTimeout(() => {
    botTimers.delete(code)
    const rt2 = getRoom(code)
    if (!rt2) return
    const bot = richmanBotTurn(rt2)
    if (!bot) return
    const pl = rt2.state.currentStage!.payload
    const actionId = `bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    let ev: ClientEvent | null = null
    if (pl.pending) {
      // 买地策略：买完还能剩 2 金币就买
      ev = { t: 'richman:decide', accept: pl.cash[bot] - pl.pending.cost >= 2, actionId }
    } else if (pl.frozen[bot]) {
      if (pl.cash[bot] >= 4) ev = { t: 'richman:bail', actionId }
    } else {
      const bag = (pl.items[bot] || []) as string[]
      // 遥控骰子：6 步内有买得起的无主地 → 精准开过去（优先能凑成套的，其次贵的）
      if (bag.includes('dice')) {
        let bestV = 0, bestScore = 0
        for (let v = 1; v <= 6; v++) {
          const to = (pl.pos[bot] + v) % RICH_BOARD.length
          const tile = RICH_BOARD[to]
          if (tile.type !== 'prop' || pl.owners[to] || pl.blocks[to]) continue
          if (pl.cash[bot] - tile.price! < 2) continue
          const group = richGroupOf(to)
          const completesSet = !!group && group.tiles.every(ti => ti === to || pl.owners[ti]?.teamId === bot)
          const score = (completesSet ? 100 : 0) + tile.price!
          if (score > bestScore) { bestScore = score; bestV = v }
        }
        if (bestV) ev = { t: 'richman:item', kind: 'dice', value: bestV, actionId }
      }
      // 路障：埋在下一队前方 5-9 步（最可能踩中的区间），放完本回合照常掷骰
      if (!ev && bag.includes('block')) {
        const nextTeam = pl.order[(pl.turnIdx + 1) % pl.order.length] as string
        const cands: number[] = []
        for (let d = 5; d <= 9; d++) {
          const ti = (pl.pos[nextTeam] + d) % RICH_BOARD.length
          if (ti !== 0 && !pl.blocks[ti]) cands.push(ti)
        }
        if (cands.length) ev = { t: 'richman:item', kind: 'block', tileIdx: cands[Math.floor(Math.random() * cands.length)], actionId }
      }
    }
    ev ||= { t: 'richman:roll', actionId }
    reduce(rt2, ev, { role: 'admin' })
    markDirty(code)
    broadcast(code)
  }, BOT_ACT_MS))
}

// 仅推送单个连接（加入确认时用）
function pushOne(peer: Peer) {
  const sess = sessions.get(peer.id)
  if (!sess) return
  const rt = getRoom(sess.code)
  if (!rt) return
  if (sess.role === 'admin') send(peer, { t: 'room:state', ...buildAdminView(rt) })
  else if (sess.playerId) send(peer, { t: 'room:state', ...buildPlayerView(rt, sess.playerId) })
}

export default defineWebSocketHandler({
  open() {
    // 连接建立，等待客户端发首个事件（create/join/rejoin）确立身份
  },

  message(peer, message) {
    let ev: ClientEvent
    try { ev = JSON.parse(message.text()) } catch { return send(peer, { t: 'error', code: 'bad_json', message: '消息格式错误' }) }

    // 心跳：保活 + 让客户端能检测假死连接
    if (ev.t === 'ping') return send(peer, { t: 'pong' })

    // —— 连接级动作：建立身份 ——
    if (ev.t === 'room:create') {
      const code = ev.code ? normalizeCode(ev.code) : genCode()
      if (!code) return send(peer, { t: 'error', code: 'bad_code', message: '房间码需为 3-8 位英文或数字' })
      if (ev.adminPass && ev.adminPass.trim().length < 6) {
        return send(peer, { t: 'error', code: 'weak_pass', message: '主持口令至少 6 位' })
      }
      // 已结束的房间允许同码重建（释放房间码）；进行中的房间拒绝
      const existing = getRoom(code)
      if (existing && existing.state.phase !== 'ended') {
        return send(peer, { t: 'error', code: 'code_taken', message: '房间码已被占用。若是你创建的，请用原浏览器打开 /admin 自动恢复；或在原控制台点「结束活动」后即可重建' })
      }
      const rt = newRoom(code, ev.passcode, ev.adminPass)
      sessions.set(peer.id, { code, role: 'admin' })
      attachPeer(code, peer)
      send(peer, { t: 'created', code, adminToken: rt.adminToken })
      send(peer, { t: 'room:state', ...buildAdminView(rt, true) })
      return
    }

    // 换设备找回控制台：房间码 + 主持口令（PRD §7.15）
    if (ev.t === 'admin:login') {
      const code = normalizeCode(ev.code)
      if (!code) return send(peer, { t: 'error', code: 'bad_code', message: '房间码格式错误' })
      const rt = getRoom(code)
      if (!rt) return send(peer, { t: 'error', code: 'notfound', message: '房间不存在' })
      if (isLocked(code)) return send(peer, { t: 'error', code: 'locked', message: '尝试次数过多，请 15 分钟后再试' })
      const pass = (ev.adminPass || '').trim()
      if (!rt.adminPass || !pass || !safeEqual(pass, rt.adminPass)) {
        recordLoginFail(code)
        // 统一措辞，不泄露该房间是否设置过口令
        return send(peer, { t: 'error', code: 'bad_pass', message: '恢复失败：口令错误或该房间未设置主持口令' })
      }
      clearLoginFails(code)
      sessions.set(peer.id, { code, role: 'admin' })
      attachPeer(code, peer)
      // 回发 created：客户端会把 adminToken 存入本地，之后该设备也能断线自动恢复
      send(peer, { t: 'created', code, adminToken: rt.adminToken })
      send(peer, { t: 'room:state', ...buildAdminView(rt, true) })
      return
    }

    if (ev.t === 'admin:rejoin') {
      const code = normalizeCode(ev.code)
      if (!code) return send(peer, { t: 'error', code: 'bad_code', message: '房间码格式错误' })
      const rt = getRoom(code)
      if (!rt) return send(peer, { t: 'error', code: 'notfound', message: '房间不存在' })
      if (isLocked(code)) return send(peer, { t: 'error', code: 'locked', message: '尝试次数过多，请 15 分钟后再试' })
      if (!safeEqual(rt.adminToken, ev.adminToken || '')) {
        recordLoginFail(code)
        return send(peer, { t: 'error', code: 'bad_token', message: '管理员凭证无效' })
      }
      clearLoginFails(code)
      sessions.set(peer.id, { code, role: 'admin' })
      attachPeer(code, peer)
      send(peer, { t: 'room:state', ...buildAdminView(rt, true) })
      return
    }

    if (ev.t === 'player:join' || ev.t === 'player:rejoin') {
      const code = normalizeCode(ev.code)
      if (!code) return send(peer, { t: 'error', code: 'bad_code', message: '房间码格式错误' })
      const rt = getRoom(code)
      if (!rt) return send(peer, { t: 'error', code: 'notfound', message: '房间不存在' })
      const r = reduce(rt, ev, { role: 'player', playerId: 'clientId' in ev ? ev.clientId : undefined })
      if (!r.ok) return send(peer, { t: 'error', code: r.error!.code, message: r.error!.message })
      if (r.joined) {
        sessions.set(peer.id, { code, role: 'player', playerId: r.joined.playerId })
        attachPeer(code, peer)
        send(peer, { t: 'joined', clientId: r.joined.clientId, playerId: r.joined.playerId })
      }
      markDirty(code)
      pushOne(peer)          // 先给自己当前视图
      broadcast(code)        // 再刷新管理员名单等
      return
    }

    // —— 业务动作：必须已建立身份 ——
    const sess = sessions.get(peer.id)
    if (!sess) return send(peer, { t: 'error', code: 'no_session', message: '请先加入房间' })
    const rt = getRoom(sess.code)
    if (!rt) return send(peer, { t: 'error', code: 'notfound', message: '房间不存在' })

    const r = reduce(rt, ev, sess.role === 'admin' ? { role: 'admin' } : { role: 'player', playerId: sess.playerId })
    if (!r.ok) {
      send(peer, { t: 'error', code: r.error!.code, message: r.error!.message })
      return
    }

    // 被踢者：通知、移出广播组并真正断开连接
    if (ev.t === 'admin:kick') {
      const targetPeers = [...(roomPeers.get(sess.code) || [])]
      for (const tp of targetPeers) {
        const ts = sessions.get(tp.id)
        if (ts?.role === 'player' && ts.playerId === ev.playerId) {
          send(tp, { t: 'kicked' })
          detachPeer(sess.code, tp)
          sessions.delete(tp.id)
          try { tp.close(4000, 'kicked') } catch { /* 已断开 */ }
        }
      }
    }

    markDirty(sess.code)
    broadcast(sess.code)
  },

  close(peer) {
    const sess = sessions.get(peer.id)
    if (sess) {
      detachPeer(sess.code, peer)
      // 标记参与者离线（身份保留，等重连）
      if (sess.role === 'player' && sess.playerId) {
        const rt = getRoom(sess.code)
        const p = rt?.state.members.find(m => m.id === sess.playerId)
        if (p) { p.online = false; markDirty(sess.code) }
        broadcast(sess.code)
      }
      sessions.delete(peer.id)
    }
  },
})
