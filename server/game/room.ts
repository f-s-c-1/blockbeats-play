// 草原杯 · Room 状态机核心（纯逻辑，无 IO，便于测试）
// 对应 PRD §4 状态机 + §7 全部动作 reducer + getVisibleView

import type {
  RoomState, Player, Team, ClientEvent, PlayerView, AdminView, AdminInbox,
} from '../../shared/types'
import { AVATAR_POOL, TEAM_NAME_POOL } from '../../shared/types'
import { UNDERCOVER_PAIRS } from '../../shared/words'

const MAX_INBOX_MESSAGES = 200
const MAX_SEEN_ACTIONS = 5000

// ───────── 工具 ─────────
let counter = 0
function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

function rememberAction(rt: RoomRuntime, actionId?: string) {
  if (!actionId) return
  rt.seenActions.add(actionId)
  while (rt.seenActions.size > MAX_SEEN_ACTIONS) {
    const oldest = rt.seenActions.values().next().value
    if (!oldest) break
    rt.seenActions.delete(oldest)
  }
}

// 收件箱与已处理 actionId 不进 RoomState（不需持久化全部），单独挂在运行时
export interface RoomRuntime {
  state: RoomState
  inbox: AdminInbox
  adminToken: string
  seenActions: Set<string> // 幂等
  lastMsgAt: Record<string, number> // 私信频率限制
}

export type Actor =
  | { role: 'admin' }
  | { role: 'player'; playerId?: string }

// ───────── 创建房间 ─────────
export function createRoom(code: string, passcode?: string | null): RoomRuntime {
  const now = Date.now()
  const state: RoomState = {
    code,
    phase: 'lobby',
    currentStage: null,
    overlays: {},
    members: [],
    teams: [],
    passcode: passcode ?? null,
    maxPlayers: 60,
    uplinkOpen: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    state,
    inbox: { messages: [] },
    adminToken: uid('admin'),
    seenActions: new Set(),
    lastMsgAt: {},
  }
}

function findPlayer(s: RoomState, id: string): Player | undefined {
  return s.members.find(p => p.id === id)
}
function findTeam(s: RoomState, id: string): Team | undefined {
  return s.teams.find(t => t.id === id)
}

// ───────── 主 reducer：处理客户端事件，返回 { ok, error? } ─────────
export interface ReduceResult {
  ok: boolean
  error?: { code: string; message: string }
  // 加入/重连成功时返回身份
  joined?: { clientId: string; playerId: string }
}

export function reduce(rt: RoomRuntime, ev: ClientEvent, actor: Actor): ReduceResult {
  const s = rt.state

  // 幂等：同 actionId 重复请求直接成功不副作用（join/rejoin 除外，需回传身份）
  if (ev.actionId && rt.seenActions.has(ev.actionId) && ev.t !== 'player:join' && ev.t !== 'player:rejoin') {
    return { ok: true }
  }

  const adminOnly = (): ReduceResult | null =>
    actor.role === 'admin' ? null : { ok: false, error: { code: 'forbidden', message: '仅管理员可操作' } }

  const playerOnly = (): string | ReduceResult =>
    actor.role === 'player' && actor.playerId
      ? actor.playerId
      : { ok: false, error: { code: 'forbidden', message: '仅参与者可操作' } }

  let res: ReduceResult = { ok: true }

  switch (ev.t) {
    // —— 加入（参与者，非管理员动作）——
    case 'player:join': {
      if (s.phase === 'ended') return { ok: false, error: { code: 'ended', message: '房间已结束' } }
      if (s.passcode && ev.passcode !== s.passcode) return { ok: false, error: { code: 'passcode', message: '入场口令错误' } }
      // clientId 已存在 → 当重连
      const exist = s.members.find(p => p.id === ev.clientId)
      if (exist) {
        if (exist.kicked) return { ok: false, error: { code: 'kicked', message: '你已被移出房间' } }
        exist.online = true
        res = { ok: true, joined: { clientId: ev.clientId, playerId: exist.id } }
        break
      }
      if (s.members.filter(p => !p.kicked).length >= s.maxPlayers)
        return { ok: false, error: { code: 'full', message: '房间已满' } }
      // 同名追加序号
      let name = (ev.name || '匿名').trim().slice(0, 12)
      const sameName = s.members.filter(p => p.name === name || p.name.startsWith(name + '#')).length
      if (sameName > 0) name = `${name}#${sameName + 1}`
      const avatar = ev.avatar || pick(AVATAR_POOL)
      const p: Player = { id: ev.clientId, name, avatar, teamId: null, secretRole: 'normal', online: true }
      s.members.push(p)
      res = { ok: true, joined: { clientId: ev.clientId, playerId: p.id } }
      break
    }

    case 'player:rejoin': {
      const p = s.members.find(pl => pl.id === ev.clientId)
      if (!p) return { ok: false, error: { code: 'notfound', message: '未找到身份，请重新加入' } }
      if (p.kicked) return { ok: false, error: { code: 'kicked', message: '你已被移出房间' } }
      p.online = true
      res = { ok: true, joined: { clientId: ev.clientId, playerId: p.id } }
      break
    }

    // —— 私信（参与者）——
    case 'msg:send': {
      const playerId = playerOnly()
      if (typeof playerId !== 'string') return playerId
      if (!s.uplinkOpen) return { ok: false, error: { code: 'uplink_closed', message: '上行通道未开放' } }
      const last = rt.lastMsgAt[playerId] || 0
      if (Date.now() - last < 5000) return { ok: false, error: { code: 'cooldown', message: '请稍候再发' } }
      const p = findPlayer(s, playerId)
      if (!p) return { ok: false, error: { code: 'notfound', message: '未加入' } }
      if (p.kicked) return { ok: false, error: { code: 'kicked', message: '你已被移出房间' } }
      const text = (ev.text || '').trim().slice(0, 200)
      if (!text) return { ok: false, error: { code: 'empty', message: '内容为空' } }
      rt.inbox.messages.push({
        id: uid('msg'), fromPlayerId: p.id, fromName: p.name, teamId: p.teamId,
        text, ts: Date.now(), stageContext: ev.stageContext,
      })
      if (rt.inbox.messages.length > MAX_INBOX_MESSAGES) {
        rt.inbox.messages.splice(0, rt.inbox.messages.length - MAX_INBOX_MESSAGES)
      }
      rt.lastMsgAt[playerId] = Date.now()
      break
    }

    // —— 以下均为管理员动作 ——
    case 'draw:generate': {
      const guard = adminOnly(); if (guard) return guard
      if (!Number.isInteger(ev.teamCount) || ev.teamCount < 2 || ev.teamCount > 8) {
        return { ok: false, error: { code: 'bad_team_count', message: '队伍数需在 2-8 之间' } }
      }
      const active = s.members.filter(p => !p.kicked)
      if (active.length < ev.teamCount) return { ok: false, error: { code: 'too_few', message: '人数不足以分队' } }
      // 蛇形分队（按 balance 简单交错，详细蛇形可后续加性别因子）
      const ordered = ev.balance ? active : shuffle(active)
      const pool = shuffle(ordered)
      const teams: Team[] = Array.from({ length: ev.teamCount }, (_, i) => ({
        id: uid('team'), name: TEAM_NAME_POOL[i] || `第${i + 1}队`, captainId: null, score: 0,
      }))
      // 蛇形分配
      let dir = 1, ti = 0
      for (const p of pool) {
        p.teamId = teams[ti].id
        if (ti + dir >= teams.length || ti + dir < 0) dir = -dir
        else ti += dir
      }
      // 每队首个成员设为队长
      for (const t of teams) {
        const first = pool.find(p => p.teamId === t.id)
        if (first) t.captainId = first.id
      }
      s.teams = teams
      break
    }

    case 'spy:assign': {
      const guard = adminOnly(); if (guard) return guard
      // 全量覆盖：先全部重置 normal
      for (const p of s.members) { p.secretRole = 'normal'; p.spyTask = undefined }
      for (const pid of ev.playerIds) {
        const p = findPlayer(s, pid)
        if (p) { p.secretRole = 'spy'; p.spyTask = ev.tasks?.[pid] }
      }
      break
    }

    case 'team:setName': {
      // 队长或管理员
      const t = findTeam(s, ev.teamId)
      if (!t) return { ok: false, error: { code: 'notfound', message: '队伍不存在' } }
      if (actor.role !== 'admin') {
        const p = actor.playerId ? findPlayer(s, actor.playerId) : undefined
        if (!p || p.kicked || p.id !== t.captainId || p.teamId !== t.id) {
          return { ok: false, error: { code: 'forbidden', message: '仅队长可修改本队队名' } }
        }
      }
      const name = (ev.name || t.name).trim().slice(0, 12)
      if (!name) return { ok: false, error: { code: 'empty', message: '队名不能为空' } }
      t.name = name
      break
    }

    case 'stage:set': {
      const guard = adminOnly(); if (guard) return guard
      if (ev.stage.type === 'draw' && ev.stage.visibility === 'E') {
        const active = s.members.filter(p => !p.kicked)
        const assigned = active.filter(p => p.teamId)
        if (!s.teams.length || assigned.length !== active.length) {
          return { ok: false, error: { code: 'no_draw', message: '请先完成随机分队，再揭晓分组' } }
        }
      }
      s.currentStage = { ...ev.stage, startedAt: Date.now() }
      s.phase = 'running'
      // 切环节：上行通道自动复位关（PRD §6）
      s.uplinkOpen = false
      break
    }

    case 'stage:clear': {
      const guard = adminOnly(); if (guard) return guard
      s.currentStage = null
      s.uplinkOpen = false
      break
    }

    case 'stage:action': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st) return { ok: false, error: { code: 'no_stage', message: '当前无环节' } }
      const pl = st.payload
      if (ev.kind === 'counter+1') pl.count = (pl.count || 0) + 1
      else if (ev.kind === 'eliminate' && ev.targetId) {
        pl.out = pl.out || []
        if (!pl.out.includes(ev.targetId)) pl.out.push(ev.targetId)
      }
      break
    }

    case 'undercover:push': {
      const guard = adminOnly(); if (guard) return guard
      const pair = UNDERCOVER_PAIRS.find(w => w.id === ev.wordPairId)
      if (!pair) return { ok: false, error: { code: 'notfound', message: '词对不存在' } }
      const participants = uniqueIds(ev.participantIds).filter(id => {
        const p = findPlayer(s, id)
        return p && !p.kicked
      })
      if (participants.length < 3) return { ok: false, error: { code: 'too_few', message: '谁是卧底至少 3 人' } }
      const ids = shuffle(participants)
      const spyCount = Math.max(1, Math.min(ev.spyWordCount, ids.length - 1))
      const assignment: Record<string, string> = {}
      ids.forEach((id, i) => { assignment[id] = i < spyCount ? pair.spy : pair.civilian })
      s.currentStage = {
        type: 'undercover', visibility: 'A',
        payload: { assignment, participantIds: participants, out: [], pairId: pair.id, civilian: pair.civilian, spy: pair.spy },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'charades:push': {
      const guard = adminOnly(); if (guard) return guard
      const actor = findPlayer(s, ev.actorId)
      if (!actor || actor.kicked) return { ok: false, error: { code: 'notfound', message: '比划者不存在' } }
      s.currentStage = {
        type: 'charades', visibility: 'B',
        payload: { actorId: ev.actorId, word: ev.word, durationSec: ev.durationSec || 60 },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'lastman:start': {
      const guard = adminOnly(); if (guard) return guard
      const ids = ev.participantIds && ev.participantIds.length
        ? uniqueIds(ev.participantIds).filter(id => {
            const p = findPlayer(s, id)
            return p && !p.kicked
          })
        : s.members.filter(p => !p.kicked).map(p => p.id)
      if (ids.length < 2) return { ok: false, error: { code: 'too_few', message: '至少 2 人' } }
      const alive: Record<string, boolean> = {}
      ids.forEach(id => { alive[id] = true })
      s.currentStage = {
        type: 'lastman', visibility: 'F',
        payload: { alive, aliveCount: ids.length, championId: null },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'lastman:eliminate': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'lastman') return { ok: false, error: { code: 'no_stage', message: '非淘汰赛环节' } }
      if (st.payload.alive[ev.targetId]) {
        st.payload.alive[ev.targetId] = false
        st.payload.aliveCount--
        if (st.payload.aliveCount === 1) {
          const champ = Object.keys(st.payload.alive).find(id => st.payload.alive[id])
          st.payload.championId = champ || null
        }
      }
      break
    }

    case 'lastman:revive': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'lastman') return { ok: false, error: { code: 'no_stage', message: '非淘汰赛环节' } }
      if (st.payload.alive[ev.targetId] === false) {
        st.payload.alive[ev.targetId] = true
        st.payload.aliveCount++
        st.payload.championId = null
      }
      break
    }

    case 'lastman:finish': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'lastman') return { ok: false, error: { code: 'no_stage', message: '非淘汰赛环节' } }
      if (!st.payload.championId) {
        const champ = Object.keys(st.payload.alive).find(id => st.payload.alive[id])
        st.payload.championId = champ || null
      }
      break
    }

    case 'vote:open': {
      const guard = adminOnly(); if (guard) return guard
      const candidates = ev.candidateIds && ev.candidateIds.length
        ? uniqueIds(ev.candidateIds).filter(id => {
            const p = findPlayer(s, id)
            return p && !p.kicked
          })
        : s.members.filter(p => !p.kicked).map(p => p.id)
      if (candidates.length < 2) return { ok: false, error: { code: 'too_few', message: '投票至少需要 2 名候选人' } }
      s.currentStage = {
        type: 'vote', visibility: 'D',
        payload: { candidates, voterIds: candidates, ballots: {} as Record<string, string> },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'vote:cast': {
      const playerId = playerOnly()
      if (typeof playerId !== 'string') return playerId
      const st = s.currentStage
      if (!st || st.type !== 'vote') return { ok: false, error: { code: 'no_vote', message: '当前无投票' } }
      const voter = findPlayer(s, playerId)
      if (!voter || voter.kicked) return { ok: false, error: { code: 'notfound', message: '未加入' } }
      if (st.payload.voterIds?.length && !st.payload.voterIds.includes(playerId)) {
        return { ok: false, error: { code: 'not_eligible', message: '你不在本轮投票范围内' } }
      }
      if (!st.payload.candidates?.includes(ev.targetId)) {
        return { ok: false, error: { code: 'bad_target', message: '候选人不存在' } }
      }
      st.payload.ballots[playerId] = ev.targetId
      break
    }

    case 'vote:revealCount': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'vote') return { ok: false, error: { code: 'no_vote', message: '当前无投票' } }
      const tally: Record<string, number> = {}
      for (const target of Object.values(st.payload.ballots as Record<string, string>)) {
        tally[target] = (tally[target] || 0) + 1
      }
      st.payload.revealed = 'count'
      st.payload.tally = tally
      break
    }

    case 'vote:revealSpy': {
      const guard = adminOnly(); if (guard) return guard
      const spies = s.members.filter(p => p.secretRole === 'spy').map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
      s.currentStage = {
        type: 'reveal', visibility: 'C',
        payload: { kind: 'spy', spies },
        startedAt: Date.now(),
      }
      break
    }

    case 'score:adjust': {
      const guard = adminOnly(); if (guard) return guard
      const t = findTeam(s, ev.teamId)
      if (!t) return { ok: false, error: { code: 'notfound', message: '队伍不存在' } }
      if (!Number.isFinite(ev.delta) || Math.abs(ev.delta) > 100) {
        return { ok: false, error: { code: 'bad_score', message: '分值不合法' } }
      }
      t.score += ev.delta * (ev.multiplier || 1)
      break
    }

    // —— Overlay ——
    case 'overlay:timer': {
      const guard = adminOnly(); if (guard) return guard
      if (ev.op === 'start') {
        const duration = Math.max(1, Math.min(ev.durationSec || 60, 3600))
        const dur = duration * 1000
        s.overlays.timer = { endsAt: Date.now() + dur, paused: false, remaining: dur }
      } else if (ev.op === 'pause') {
        const tm = s.overlays.timer
        if (tm && !tm.paused) { tm.remaining = Math.max(0, tm.endsAt - Date.now()); tm.paused = true }
      } else if (ev.op === 'reset') {
        s.overlays.timer = null
      }
      break
    }

    case 'overlay:announce': {
      const guard = adminOnly(); if (guard) return guard
      s.overlays.announce = ev.text ? { text: ev.text.slice(0, 100) } : null
      break
    }

    case 'overlay:scoreboard': {
      const guard = adminOnly(); if (guard) return guard
      s.overlays.scoreboard = ev.on
      break
    }

    case 'admin:toggleUplink': {
      const guard = adminOnly(); if (guard) return guard
      s.uplinkOpen = ev.open
      break
    }

    case 'admin:kick': {
      const guard = adminOnly(); if (guard) return guard
      const p = findPlayer(s, ev.playerId)
      if (p) { p.kicked = true; p.online = false }
      break
    }

    case 'admin:rename': {
      const guard = adminOnly(); if (guard) return guard
      const p = findPlayer(s, ev.playerId)
      if (p) p.name = (ev.newName || p.name).trim().slice(0, 12)
      break
    }

    case 'room:create':
    case 'admin:rejoin':
      // 在连接层处理，不在此 reducer
      break
  }

  rememberAction(rt, ev.actionId)
  s.updatedAt = Date.now()
  return res
}

// ───────── 可见性计算（PRD §2 + §4 + overlay 两层）─────────
export function buildPlayerView(rt: RoomRuntime, playerId: string): PlayerView {
  const s = rt.state
  const me = findPlayer(s, playerId)
  const overlays = buildOverlayView(s)

  const base: PlayerView = {
    role: 'player',
    me: me ? { id: me.id, name: me.name, avatar: me.avatar, teamId: me.teamId } : { id: playerId, name: '?', avatar: '❓', teamId: null },
    waiting: true,
    stage: null,
    overlays,
    uplinkOpen: s.uplinkOpen,
  }
  if (!me) return base

  const st = s.currentStage
  if (!st) return base // 等待页（overlay 仍显示）

  base.waiting = false
  const content = visibleStageContent(s, st, me)
  base.stage = { type: st.type, visibility: st.visibility, content }

  // E 类身份分发：附带本队 + 内鬼身份
  if (st.visibility === 'E' && st.type === 'draw') {
    if (me.teamId) {
      const team = findTeam(s, me.teamId)
      const members = s.members.filter(p => p.teamId === me.teamId).map(p => ({ name: p.name, avatar: p.avatar }))
      base.team = { id: team?.id || me.teamId, name: team?.name || '我的队', isCaptain: team?.captainId === me.id, members }
    }
    if (me.secretRole === 'spy') base.secret = { isSpy: true, task: me.spyTask }
  }

  return base
}

// 主环节内容裁剪（不含 E 的 team/secret，那在 buildPlayerView 拼）
function visibleStageContent(s: RoomState, st: RoomState['currentStage'], me: Player): Record<string, any> {
  if (!st) return {}
  switch (st.visibility) {
    case 'C':
      return st.payload // 全员同屏
    case 'B':
      return me.id === st.payload.actorId
        ? { role: 'actor', word: st.payload.word, durationSec: st.payload.durationSec }
        : { role: 'guesser', hint: '👀 猜！' }
    case 'A': {
      const inGame = (st.payload.participantIds || []).includes(me.id)
      return inGame ? { myWord: st.payload.assignment[me.id] } : { notInGame: true }
    }
    case 'D': {
      if (st.payload.voterIds?.length && !st.payload.voterIds.includes(me.id)) {
        return { notInVote: true, candidates: candidateInfo(s, st.payload.candidates) }
      }
      const voted = st.payload.ballots && st.payload.ballots[me.id]
      if (st.payload.revealed === 'count') {
        return { revealed: 'count', tally: st.payload.tally, candidates: candidateInfo(s, st.payload.candidates) }
      }
      return voted ? { voted: true } : { candidates: candidateInfo(s, st.payload.candidates) }
    }
    case 'F': {
      return {
        alive: st.payload.alive[me.id] ?? null,
        aliveCount: st.payload.aliveCount,
        championId: st.payload.championId,
        champion: st.payload.championId ? playerBrief(s, st.payload.championId) : null,
      }
    }
    case 'E':
      return {} // 由 buildPlayerView 拼 team/secret
    default:
      return {}
  }
}

function candidateInfo(s: RoomState, ids: string[]) {
  return ids.map(id => playerBrief(s, id)).filter(Boolean)
}
function playerBrief(s: RoomState, id: string) {
  const p = findPlayer(s, id)
  return p ? { id: p.id, name: p.name, avatar: p.avatar } : null
}

function buildOverlayView(s: RoomState): PlayerView['overlays'] {
  const o: PlayerView['overlays'] = {}
  if (s.overlays.timer) o.timer = s.overlays.timer
  if (s.overlays.announce) o.announce = s.overlays.announce
  if (s.overlays.scoreboard) {
    o.scoreboard = { teams: [...s.teams].sort((a, b) => b.score - a.score).map(t => ({ name: t.name, score: t.score })) }
  }
  return o
}

// ───────── 管理员视图（完整）─────────
export function buildAdminView(rt: RoomRuntime, withToken = false): AdminView {
  return {
    role: 'admin',
    room: rt.state,
    inbox: rt.inbox,
    ...(withToken ? { adminToken: rt.adminToken } : {}),
  }
}
