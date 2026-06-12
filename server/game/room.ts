// 燃团 · Room 状态机核心（纯逻辑，无 IO，便于测试）
// 对应 PRD §4 状态机 + §7 全部动作 reducer + getVisibleView

import { randomBytes } from 'node:crypto'
import type {
  RoomState, Player, Team, ClientEvent, PlayerView, AdminView, AdminInbox,
} from '../../shared/types'
import { AVATAR_POOL, TEAM_NAME_POOL } from '../../shared/types'
import { UNDERCOVER_PAIRS, CHARADES_WORDS, CHARADES_CATEGORIES } from '../../shared/words'
import { PUNISHMENTS } from '../../shared/games'
import {
  RICH_BOARD, RICH_CHANCES, RICH_TOKENS, RICH_START_CASH, RICH_PASS_BONUS,
  RICH_GIFT_BONUS, RICH_TAX, RICH_MAX_LEVEL, RICH_BAIL_COST, RICH_GUESS_BONUS,
  RICH_MAX_ITEMS, RICH_DOUBLE_JAIL, richRent, richGroupOf,
} from '../../shared/richman'

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
  adminPass: string | null // 主持口令：换设备凭「房间码+口令」登录后台（PRD §7.15）
  seenActions: Set<string> // 幂等
  lastMsgAt: Record<string, number> // 私信频率限制
}

export type Actor =
  | { role: 'admin' }
  | { role: 'player'; playerId?: string }

// ───────── 创建房间 ─────────
export function createRoom(code: string, passcode?: string | null, adminPass?: string | null): RoomRuntime {
  const now = Date.now()
  const state: RoomState = {
    code,
    phase: 'lobby',
    currentStage: null,
    overlays: {},
    members: [],
    teams: [],
    teamsRevealed: false,
    passcode: passcode ?? null,
    maxPlayers: 60,
    uplinkOpen: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    state,
    inbox: { messages: [] },
    // 管理员凭证必须不可预测（uid 是时间戳+计数器，可被猜测）
    adminToken: 'admin_' + randomBytes(32).toString('base64url'),
    adminPass: (adminPass || '').trim().slice(0, 32) || null,
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

// ───────── 大富翁辅助 ─────────
// 事件统一出口：更新横幅 + 追加到事件日志（管理端可回看）
function richEvent(pl: Record<string, any>, text: string, tone: 'good' | 'bad' | 'punish' = 'good') {
  pl.lastEvent = { text, tone }
  pl.log = [...(pl.log || []), text].slice(-8)
}

// 回合推进：清掉待决定；掷出对子的队再行动一次（bonus），否则轮到下一队
function richAdvance(pl: Record<string, any>) {
  pl.pending = null
  if (pl.bonus) { pl.bonus = false; return }
  pl.streak = 0
  pl.turnIdx = (pl.turnIdx + 1) % pl.order.length
  if (pl.turnIdx === 0) pl.round++
}

// 全员竞猜结算：猜中点数和的玩家所在队 +1（每队每回合最多一次）；猜中名单回传给本人庆祝
function richScoreGuesses(s: RoomState, pl: Record<string, any>, sum: number, notes: string[]) {
  const guesses = (pl.guesses || {}) as Record<string, number>
  const correct: string[] = []
  const winners = new Set<string>()
  for (const [pid, g] of Object.entries(guesses)) {
    if (g !== sum) continue
    const p = findPlayer(s, pid)
    if (!p || p.kicked || !p.teamId || !(pl.order as string[]).includes(p.teamId)) continue
    correct.push(pid)
    winners.add(p.teamId)
  }
  for (const tid of winners) pl.cash[tid] += RICH_GUESS_BONUS
  pl.lastGuess = { sum, correct }
  pl.guesses = {}
  if (winners.size) {
    notes.push(`🔮 ${[...winners].map(id => richTeam(pl, id).name).join('、')} 猜中点数 +${RICH_GUESS_BONUS}`)
  }
}

// 走格子（途中撞路障急停）并结算落点效果；advance=false 表示停下等队长买地决定
function richResolveMove(s: RoomState, pl: Record<string, any>, cur: string, steps: number, notes: string[]): { advance: boolean; tone: 'good' | 'bad' | 'punish' } {
  const from = pl.pos[cur] as number
  let walked = steps
  for (let i = 1; i <= steps; i++) {
    const t = (from + i) % RICH_BOARD.length
    if (pl.blocks[t]) { walked = i; delete pl.blocks[t]; notes.push('🚧 撞上路障，当场急刹'); break }
  }
  const to = (from + walked) % RICH_BOARD.length
  pl.pos[cur] = to
  if (from + walked >= RICH_BOARD.length && to !== 0) {
    pl.cash[cur] += RICH_PASS_BONUS
    notes.push(`经过起点 +${RICH_PASS_BONUS}`)
  }
  const tile = RICH_BOARD[to]
  let tone: 'good' | 'bad' | 'punish' = 'good'
  let advance = true
  switch (tile.type) {
    case 'start':
      pl.cash[cur] += RICH_PASS_BONUS * 2
      notes.push(`🚩 稳稳踩中起点，领双倍 +${RICH_PASS_BONUS * 2}`)
      break
    case 'gift':
      pl.cash[cur] += RICH_GIFT_BONUS
      notes.push(`🎁 打开篝火宝箱 +${RICH_GIFT_BONUS}`)
      break
    case 'tax':
      pl.cash[cur] -= RICH_TAX
      tone = 'bad'
      notes.push(`💸 缴税 -${RICH_TAX}`)
      break
    case 'jail':
      pl.frozen[cur] = true
      pl.bonus = false // 对子奖励也救不了进局子
      tone = 'bad'
      notes.push(`🚔 进拘留所！下次轮到时可花 ${RICH_BAIL_COST} 金币保释，或认栽跳过一回合`)
      break
    case 'punish':
      tone = 'punish'
      notes.push(`😈 踩中惩罚格：${pick(PUNISHMENTS)}`)
      break
    case 'chance': {
      const card = pick(RICH_CHANCES)
      const others = (pl.order as string[]).filter(id => id !== cur)
      const myProps = Object.values(pl.owners as Record<string, { teamId: string }>).filter(o => o.teamId === cur).length
      notes.push(`❓ 机会卡：${card.text}`)
      if (card.cash) pl.cash[cur] += card.cash
      else if (card.kind === 'collect1') { for (const o of others) pl.cash[o] -= 1; pl.cash[cur] += others.length }
      else if (card.kind === 'pay1') { for (const o of others) pl.cash[o] += 1; pl.cash[cur] -= others.length }
      else if (card.kind === 'freeze') { pl.frozen[cur] = true; pl.bonus = false }
      else if (card.kind === 'perProp') pl.cash[cur] += myProps * 2
      else if (card.kind === 'taxProp') pl.cash[cur] -= myProps
      else if (card.kind?.startsWith('item_')) {
        const kind = card.kind.slice(5)
        const bag = (pl.items[cur] ||= []) as string[]
        if (bag.length >= RICH_MAX_ITEMS) { pl.cash[cur] += 2; notes.push('道具袋满了，折现 +2') }
        else bag.push(kind)
      }
      if ((card.cash ?? 0) < 0 || card.kind === 'pay1' || card.kind === 'freeze' || card.kind === 'taxProp') tone = 'bad'
      break
    }
    case 'prop': {
      const own = pl.owners[to] as { teamId: string; level: number } | undefined
      const price = tile.price!
      if (!own) {
        if (pl.cash[cur] >= price) {
          pl.pending = { tileIdx: to, teamId: cur, kind: 'buy', cost: price }
          advance = false
          notes.push(`${tile.icon}${tile.name} 无主，${price} 金币可买，队长决定`)
        } else {
          notes.push(`${tile.icon}${tile.name} 无主，可惜金币不够（需 ${price}）`)
        }
      } else if (own.teamId === cur) {
        if (own.level < RICH_MAX_LEVEL && pl.cash[cur] >= price) {
          pl.pending = { tileIdx: to, teamId: cur, kind: 'upgrade', cost: price }
          advance = false
          notes.push(`回到自家${tile.name}，花 ${price} 可升级豪华店（过路费翻倍），队长决定`)
        } else {
          notes.push(`回到自家${tile.name}，歇脚`)
        }
      } else {
        const owner = richTeam(pl, own.teamId)
        const group = richGroupOf(to)
        const hasSet = !!group && group.tiles.every(ti => (pl.owners[ti] as { teamId: string } | undefined)?.teamId === own.teamId)
        const rent = richRent(price, own.level, hasSet)
        const where = `${tile.icon}${tile.name} 是 ${owner.token}${owner.name} 的${hasSet ? '🔗成套' : ''}${own.level >= RICH_MAX_LEVEL ? '豪华店' : '地盘'}`
        const bag = (pl.items[cur] || []) as string[]
        const sIdx = bag.indexOf('shield')
        if (sIdx >= 0) {
          bag.splice(sIdx, 1)
          notes.push(`${where}，🛡️ 免租卡生效，免单！`)
        } else {
          pl.cash[cur] -= rent
          pl.cash[own.teamId] += rent
          tone = 'bad'
          notes.push(`${where}，付过路费 ${rent}`)
        }
      }
      break
    }
  }
  return { advance, tone }
}

// 棋盘内队伍快照（开局定格，不随改名变化）
function richTeam(pl: Record<string, any>, teamId: string): { id: string; name: string; token: string } {
  return (pl.teams as { id: string; name: string; token: string }[]).find(t => t.id === teamId)
    || { id: teamId, name: '?', token: '❓' }
}

// 掷骰/买地权限：管理员随时可代操作；玩家必须是该队现任队长
function richGuardActor(s: RoomState, actor: Actor, teamId: string): ReduceResult | null {
  if (actor.role === 'admin') return null
  const p = actor.playerId ? findPlayer(s, actor.playerId) : undefined
  const team = findTeam(s, teamId)
  if (!p || p.kicked || p.teamId !== teamId || team?.captainId !== p.id) {
    return { ok: false, error: { code: 'forbidden', message: '只有当前回合队伍的队长可以操作' } }
  }
  return null
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
      // 重新分队 = 新一轮未揭晓，玩家端先不可见（防泄露）
      s.teamsRevealed = false
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

    case 'spy:task': {
      const guard = adminOnly(); if (guard) return guard
      const p = findPlayer(s, ev.playerId)
      if (!p || p.kicked) return { ok: false, error: { code: 'notfound', message: '成员不存在' } }
      if (p.secretRole !== 'spy') return { ok: false, error: { code: 'not_spy', message: '该成员不是内鬼，请先指定' } }
      const task = (ev.task || '').trim().slice(0, 100)
      if (!task) return { ok: false, error: { code: 'empty', message: '任务内容为空' } }
      p.spyTask = task
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

    case 'team:setCaptain': {
      // 现任队长移交，或管理员强制改任（队长手机没电/离场的兜底）
      const t = findTeam(s, ev.teamId)
      if (!t) return { ok: false, error: { code: 'notfound', message: '队伍不存在' } }
      if (actor.role !== 'admin') {
        const p = actor.playerId ? findPlayer(s, actor.playerId) : undefined
        if (!p || p.kicked || p.id !== t.captainId || p.teamId !== t.id) {
          return { ok: false, error: { code: 'forbidden', message: '仅现任队长可移交' } }
        }
      }
      const target = findPlayer(s, ev.playerId)
      if (!target || target.kicked || target.teamId !== t.id) {
        return { ok: false, error: { code: 'bad_target', message: '新队长必须是本队成员' } }
      }
      t.captainId = target.id
      break
    }

    case 'stage:set': {
      const guard = adminOnly(); if (guard) return guard
      // 通用入口只允许 C 类同屏环节和 draw 的 E 类揭晓；
      // A/B/D/F 类必须走各自专用事件（undercover:push / charades:push / vote:open / lastman:start），
      // 防止误把含敏感字段的 payload 以 C 类全员透传。
      const isDrawReveal = ev.stage.type === 'draw' && ev.stage.visibility === 'E'
      if (!isDrawReveal && ev.stage.visibility !== 'C') {
        return { ok: false, error: { code: 'bad_stage', message: '该可见性类型需走专用环节入口' } }
      }
      if (isDrawReveal) {
        const active = s.members.filter(p => !p.kicked)
        const assigned = active.filter(p => p.teamId)
        if (!s.teams.length || assigned.length !== active.length) {
          return { ok: false, error: { code: 'no_draw', message: '请先完成随机分队，再揭晓分组' } }
        }
      }
      if (ev.stage.type === 'buzzer') ev.stage.payload.buzzes = []
      if (isDrawReveal) s.teamsRevealed = true
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
      else if (ev.kind === 'uneliminate' && ev.targetId) {
        pl.out = (pl.out || []).filter((x: string) => x !== ev.targetId)
      }
      else if (ev.kind === 'whoami:guessed' && ev.targetId) {
        pl.guessed = pl.guessed || []
        if (!pl.guessed.includes(ev.targetId)) pl.guessed.push(ev.targetId)
      }
      else if (ev.kind === 'whoami:unguess' && ev.targetId) {
        pl.guessed = (pl.guessed || []).filter((x: string) => x !== ev.targetId)
      }
      break
    }

    case 'undercover:push': {
      const guard = adminOnly(); if (guard) return guard
      // 词对来源：主持人手输的自定义词对优先，否则查词库
      let civilian: string, spy: string, pairId: string
      if (ev.custom) {
        civilian = (ev.custom.civilian || '').trim().slice(0, 20)
        spy = (ev.custom.spy || '').trim().slice(0, 20)
        if (!civilian || !spy) return { ok: false, error: { code: 'empty_pair', message: '自定义词对不能为空' } }
        if (civilian === spy) return { ok: false, error: { code: 'same_pair', message: '平民词和卧底词不能相同' } }
        pairId = 'custom'
      } else {
        const pair = UNDERCOVER_PAIRS.find(w => w.id === ev.wordPairId)
        if (!pair) return { ok: false, error: { code: 'notfound', message: '词对不存在' } }
        civilian = pair.civilian; spy = pair.spy; pairId = pair.id
      }
      const participants = uniqueIds(ev.participantIds).filter(id => {
        const p = findPlayer(s, id)
        return p && !p.kicked
      })
      if (participants.length < 3) return { ok: false, error: { code: 'too_few', message: '谁是卧底至少 3 人' } }
      const spyCount = Number.isInteger(ev.spyWordCount) ? Math.max(0, ev.spyWordCount) : 1
      const blankCount = Number.isInteger(ev.blankCount) ? Math.max(0, ev.blankCount!) : 0
      if (spyCount + blankCount < 1) {
        return { ok: false, error: { code: 'bad_counts', message: '卧底和白板至少共 1 人' } }
      }
      // 平民必须占多数局面才成立，底线是至少留 2 个平民
      if (spyCount + blankCount > participants.length - 2) {
        return { ok: false, error: { code: 'bad_counts', message: '卧底+白板太多，至少留 2 名平民' } }
      }
      const ids = shuffle(participants)
      const assignment: Record<string, string> = {}
      const blankIds: string[] = []
      ids.forEach((id, i) => {
        if (i < spyCount) assignment[id] = spy
        else if (i < spyCount + blankCount) { assignment[id] = ''; blankIds.push(id) }
        else assignment[id] = civilian
      })
      s.currentStage = {
        type: 'undercover', visibility: 'A',
        payload: { assignment, blankIds, participantIds: participants, out: [], pairId, civilian, spy, spyCount, blankCount },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'charades:push': {
      const guard = adminOnly(); if (guard) return guard
      const performer = findPlayer(s, ev.actorId)
      if (!performer || performer.kicked) return { ok: false, error: { code: 'notfound', message: '比划者不存在' } }
      const durationSec = ev.durationSec || 60
      s.currentStage = {
        type: 'charades', visibility: 'B',
        payload: { actorId: ev.actorId, word: ev.word, durationSec },
        startedAt: Date.now(),
      }
      // 发词即起表，全场倒计时同步跑，主持人不用再手动开计时器
      const dur = durationSec * 1000
      s.overlays.timer = { endsAt: Date.now() + dur, paused: false, remaining: dur }
      s.phase = 'running'
      break
    }

    case 'buzz': {
      const playerId = playerOnly()
      if (typeof playerId !== 'string') return playerId
      const st = s.currentStage
      if (!st || st.type !== 'buzzer') return { ok: false, error: { code: 'no_buzzer', message: '当前无抢答' } }
      const p = findPlayer(s, playerId)
      if (!p || p.kicked) return { ok: false, error: { code: 'notfound', message: '未加入' } }
      const buzzes = (st.payload.buzzes ||= []) as { playerId: string; name: string; avatar: string; ts: number }[]
      if (!buzzes.some(b => b.playerId === playerId)) {
        buzzes.push({ playerId, name: p.name, avatar: p.avatar, ts: Date.now() })
      }
      break
    }

    case 'whoami:push': {
      const guard = adminOnly(); if (guard) return guard
      const participants = uniqueIds(ev.participantIds).filter(id => {
        const p = findPlayer(s, id)
        return p && !p.kicked
      })
      if (participants.length < 2) return { ok: false, error: { code: 'too_few', message: '猜猜我是谁至少 2 人' } }
      let pool = CHARADES_WORDS
      if (ev.category && (CHARADES_CATEGORIES as readonly string[]).includes(ev.category)) {
        pool = pool.filter(w => w.category === ev.category)
      }
      if (pool.length < participants.length) return { ok: false, error: { code: 'too_few_words', message: '该分类词不够分，请换分类' } }
      const words = shuffle(pool.map(w => w.text)).slice(0, participants.length)
      const assignment: Record<string, string> = {}
      participants.forEach((id, i) => { assignment[id] = words[i] })
      s.currentStage = {
        type: 'whoami', visibility: 'A',
        payload: { assignment, participantIds: participants, guessed: [] },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'storymix:start': {
      const guard = adminOnly(); if (guard) return guard
      s.currentStage = {
        type: 'storymix', visibility: 'C',
        payload: { submissions: {}, story: null, history: [] },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    case 'storymix:submit': {
      const playerId = playerOnly()
      if (typeof playerId !== 'string') return playerId
      const st = s.currentStage
      if (!st || st.type !== 'storymix') return { ok: false, error: { code: 'no_storymix', message: '当前没有故事收集' } }
      const p = findPlayer(s, playerId)
      if (!p || p.kicked) return { ok: false, error: { code: 'notfound', message: '未加入' } }
      const who = (ev.who || '').trim().slice(0, 20)
      const where = (ev.where || '').trim().slice(0, 20)
      const what = (ev.what || '').trim().slice(0, 20)
      if (!who || !where || !what) return { ok: false, error: { code: 'empty', message: '三项都要填' } }
      // 可覆盖重交，开奖前内容只有管理员可见
      st.payload.submissions[playerId] = { who, where, what }
      break
    }

    case 'storymix:draw': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'storymix') return { ok: false, error: { code: 'no_storymix', message: '当前没有故事收集' } }
      const subs = st.payload.submissions as Record<string, { who: string; where: string; what: string }>
      const ids = Object.keys(subs)
      if (ids.length < 2) return { ok: false, error: { code: 'too_few', message: '至少 2 份投稿才能开奖' } }
      // 三段尽量来自不同人，避免抽回某人的原句
      const order = shuffle(ids)
      const story = {
        who: subs[order[0]].who,
        where: subs[order[1 % order.length]].where,
        what: subs[order[2 % order.length]].what,
        ts: Date.now(),
      }
      st.payload.story = story
      st.payload.history = [...(st.payload.history || []), story].slice(-20)
      break
    }

    case 'wheel:spin': {
      const guard = adminOnly(); if (guard) return guard
      let pool = s.members.filter(p => !p.kicked)
      if (ev.scope && ev.scope !== 'all') pool = pool.filter(p => p.teamId === ev.scope)
      if (pool.length < 2) return { ok: false, error: { code: 'too_few', message: '抽取范围至少 2 人' } }
      // CSPRNG 选人，全场手机按同一序列播放动画，定格在同一个人
      const winner = pool[randomBytes(4).readUInt32BE(0) % pool.length]
      const order = shuffle(pool).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
      s.currentStage = {
        type: 'wheel', visibility: 'C',
        payload: {
          order,
          winnerId: winner.id,
          winner: { id: winner.id, name: winner.name, avatar: winner.avatar },
          spinId: uid('spin'), // 每次抽取都不同，驱动前端重播动画
        },
        startedAt: Date.now(),
      }
      s.phase = 'running'
      break
    }

    // —— 大富翁（队伍制：队伍当棋子，队长掷骰，金币独立于队伍积分）——
    case 'richman:start': {
      const guard = adminOnly(); if (guard) return guard
      if (s.teams.length < 2) return { ok: false, error: { code: 'too_few', message: '大富翁至少需要 2 支队伍，请先分队' } }
      const order = s.teams.map(t => t.id)
      s.currentStage = {
        type: 'richman', visibility: 'C',
        payload: {
          // 队名快照：中途改队名不回写棋盘，避免视图依赖玩家拿不到的 teams 全量
          teams: s.teams.map((t, i) => ({ id: t.id, name: t.name, token: RICH_TOKENS[i % RICH_TOKENS.length] })),
          order, turnIdx: 0, round: 1,
          cash: Object.fromEntries(order.map(id => [id, RICH_START_CASH])),
          pos: Object.fromEntries(order.map(id => [id, 0])),
          owners: {} as Record<string, { teamId: string; level: number }>,
          frozen: {} as Record<string, boolean>,
          items: {} as Record<string, string[]>, // 每队道具袋
          blocks: {} as Record<string, boolean>, // 棋盘上的路障
          guesses: {} as Record<string, number>, // 本回合全员竞猜（playerId → 点数和）
          lastGuess: null, // 上次开骰的竞猜结果 { sum, correct: playerId[] }
          streak: 0, // 当前队连续对子次数
          bonus: false, // 对子奖励：本队再行动一次
          dice: null,
          pending: null,
          lastEvent: null,
          log: [],
          finished: false,
          ranking: null,
        },
        startedAt: Date.now(),
      }
      richEvent(s.currentStage.payload, `🎲 大富翁开局！每队 ${RICH_START_CASH} 金币，从起点出发。掷骰前全员可猜点数，猜中给本队 +${RICH_GUESS_BONUS}`)
      s.phase = 'running'
      break
    }

    case 'richman:roll': {
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      if (pl.finished) return { ok: false, error: { code: 'finished', message: '本局已结算' } }
      if (pl.pending) return { ok: false, error: { code: 'pending', message: '先决定买不买，再掷骰' } }
      const cur = pl.order[pl.turnIdx] as string
      const err = richGuardActor(s, actor, cur)
      if (err) return err
      const team = richTeam(pl, cur)
      const label = `${team.token}${team.name}`
      if (pl.frozen[cur]) {
        delete pl.frozen[cur]
        pl.dice = null
        pl.bonus = false
        richEvent(pl, `❄️ ${label} 蹲完拘留所，本回合跳过`, 'bad')
        richAdvance(pl)
        break
      }
      const v1 = randomBytes(4).readUInt32BE(0) % 6 + 1
      const v2 = randomBytes(4).readUInt32BE(0) % 6 + 1
      const sum = v1 + v2
      const doubles = v1 === v2
      pl.dice = { values: [v1, v2], rollId: uid('roll') }
      const notes = [`${label} 掷出 ${v1}+${v2}=${sum}${doubles ? '，对子！' : ''}`]
      richScoreGuesses(s, pl, sum, notes)
      if (doubles) {
        pl.streak = (pl.streak || 0) + 1
        if (pl.streak >= RICH_DOUBLE_JAIL) {
          pl.frozen[cur] = true
          pl.bonus = false
          pl.streak = 0
          notes.push('🚔 连掷三对开太快，被抓进拘留所！')
          richEvent(pl, notes.join('，'), 'bad')
          richAdvance(pl)
          break
        }
        pl.bonus = true
        notes.push('行动完再掷一次')
      }
      const r = richResolveMove(s, pl, cur, sum, notes)
      richEvent(pl, notes.join('，'), r.tone)
      if (r.advance) richAdvance(pl)
      break
    }

    case 'richman:bail': {
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      if (pl.finished) return { ok: false, error: { code: 'finished', message: '本局已结算' } }
      const cur = pl.order[pl.turnIdx] as string
      const err = richGuardActor(s, actor, cur)
      if (err) return err
      if (!pl.frozen[cur]) return { ok: false, error: { code: 'not_frozen', message: '你们队没被关着' } }
      if (pl.cash[cur] < RICH_BAIL_COST) return { ok: false, error: { code: 'poor', message: '金币不够保释' } }
      const team = richTeam(pl, cur)
      pl.cash[cur] -= RICH_BAIL_COST
      delete pl.frozen[cur]
      richEvent(pl, `💰 ${team.token}${team.name} 花 ${RICH_BAIL_COST} 金币保释出狱，可以掷骰了`)
      break
    }

    case 'richman:item': {
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      if (pl.finished) return { ok: false, error: { code: 'finished', message: '本局已结算' } }
      if (pl.pending) return { ok: false, error: { code: 'pending', message: '先决定买不买' } }
      const cur = pl.order[pl.turnIdx] as string
      const err = richGuardActor(s, actor, cur)
      if (err) return err
      const team = richTeam(pl, cur)
      const bag = (pl.items[cur] ||= []) as string[]
      if (!bag.includes(ev.kind)) return { ok: false, error: { code: 'no_item', message: '没有这个道具' } }
      if (ev.kind === 'dice') {
        if (pl.frozen[cur]) return { ok: false, error: { code: 'frozen', message: '先保释或跳过，再用道具' } }
        const v = ev.value
        if (!Number.isInteger(v) || v! < 1 || v! > 6) return { ok: false, error: { code: 'bad_value', message: '遥控骰子只能选 1-6' } }
        bag.splice(bag.indexOf('dice'), 1)
        pl.dice = { values: [v], rollId: uid('roll') }
        pl.bonus = false
        const notes = [`🎮 ${team.token}${team.name} 用遥控骰子精准开出 ${v} 点`]
        richScoreGuesses(s, pl, v!, notes)
        const r = richResolveMove(s, pl, cur, v!, notes)
        richEvent(pl, notes.join('，'), r.tone)
        if (r.advance) richAdvance(pl)
      } else {
        const ti = ev.tileIdx
        if (!Number.isInteger(ti) || ti! < 1 || ti! >= RICH_BOARD.length) {
          return { ok: false, error: { code: 'bad_tile', message: '路障不能放在起点或棋盘外' } }
        }
        if (pl.blocks[ti!]) return { ok: false, error: { code: 'occupied', message: '这格已经有路障了' } }
        bag.splice(bag.indexOf('block'), 1)
        pl.blocks[ti!] = true
        // 放路障不消耗回合，放完照常掷骰
        richEvent(pl, `🚧 ${team.token}${team.name} 在${RICH_BOARD[ti!].icon}${RICH_BOARD[ti!].name} 埋了路障，等人撞`, 'bad')
      }
      break
    }

    case 'richman:guess': {
      const playerId = playerOnly()
      if (typeof playerId !== 'string') return playerId
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      if (pl.finished) return { ok: false, error: { code: 'finished', message: '本局已结算' } }
      const p = findPlayer(s, playerId)
      if (!p || p.kicked) return { ok: false, error: { code: 'notfound', message: '未加入' } }
      if (!Number.isInteger(ev.value) || ev.value < 2 || ev.value > 12) {
        return { ok: false, error: { code: 'bad_value', message: '两颗骰子的和在 2-12 之间' } }
      }
      pl.guesses[playerId] = ev.value // 开骰前可反复改
      break
    }

    case 'richman:decide': {
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      const pending = pl.pending as { tileIdx: number; teamId: string; kind: 'buy' | 'upgrade'; cost: number } | null
      if (!pending) return { ok: false, error: { code: 'no_pending', message: '当前没有待决定的购买' } }
      const err = richGuardActor(s, actor, pending.teamId)
      if (err) return err
      const team = richTeam(pl, pending.teamId)
      const tile = RICH_BOARD[pending.tileIdx]
      if (ev.accept && pl.cash[pending.teamId] >= pending.cost) {
        pl.cash[pending.teamId] -= pending.cost
        if (pending.kind === 'buy') pl.owners[pending.tileIdx] = { teamId: pending.teamId, level: 1 }
        else pl.owners[pending.tileIdx].level = RICH_MAX_LEVEL
        // 集齐同组两块地 → 成套，组内过路费翻倍
        const group = richGroupOf(pending.tileIdx)
        const gotSet = pending.kind === 'buy' && !!group
          && group.tiles.every(ti => (pl.owners[ti] as { teamId: string } | undefined)?.teamId === pending.teamId)
        richEvent(pl, pending.kind === 'buy'
          ? `🏠 ${team.token}${team.name} 买下了${tile.icon}${tile.name}！${gotSet ? `🔗 集齐「${group!.name}」成套，过路费翻倍！` : '路过要交过路费'}`
          : `🏨 ${team.token}${team.name} 把${tile.name}升级成豪华店！过路费翻倍`)
      } else {
        richEvent(pl, `${team.token}${team.name} 放弃了${tile.icon}${tile.name}`, 'bad')
      }
      richAdvance(pl)
      break
    }

    case 'richman:next': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      st.payload.bonus = false // 强制推进连对子奖励一起清掉
      richEvent(st.payload, '⏭️ 主持人推进了回合', 'bad')
      richAdvance(st.payload)
      break
    }

    case 'richman:end': {
      const guard = adminOnly(); if (guard) return guard
      const st = s.currentStage
      if (!st || st.type !== 'richman') return { ok: false, error: { code: 'no_stage', message: '当前不在大富翁环节' } }
      const pl = st.payload
      const assets: Record<string, number> = {}
      for (const [idx, own] of Object.entries(pl.owners as Record<string, { teamId: string; level: number }>)) {
        const price = RICH_BOARD[Number(idx)]?.price || 0
        assets[own.teamId] = (assets[own.teamId] || 0) + price * own.level
      }
      const ranking = (pl.teams as { id: string; name: string; token: string }[])
        .map(t => ({
          id: t.id, name: t.name, token: t.token,
          cash: pl.cash[t.id] ?? 0,
          assets: assets[t.id] || 0,
          total: (pl.cash[t.id] ?? 0) + (assets[t.id] || 0),
        }))
        .sort((a, b) => b.total - a.total)
      pl.pending = null
      pl.finished = true
      pl.ranking = ranking
      richEvent(pl, `🏆 大富翁结束！${ranking[0].token}${ranking[0].name} 以总资产 ${ranking[0].total} 夺冠`)
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
      // 选项模式：投"事/队/作品"而不是人（真真假假、最佳广告、最佳造型……）
      if (ev.options) {
        const options = ev.options.map(o => (o || '').trim().slice(0, 30)).filter(Boolean)
        if (options.length < 2 || options.length > 6) {
          return { ok: false, error: { code: 'bad_options', message: '选项需 2-6 个' } }
        }
        const voterIds = s.members.filter(p => !p.kicked).map(p => p.id)
        s.currentStage = {
          type: 'vote', visibility: 'D',
          payload: {
            // 候选用选项下标字符串，票箱/进度/公布票数逻辑全部复用
            candidates: options.map((_, i) => String(i)),
            options,
            question: (ev.question || '').trim().slice(0, 60),
            voterIds,
            ballots: {} as Record<string, string>,
          },
          startedAt: Date.now(),
        }
        s.phase = 'running'
        break
      }
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
      const applied = ev.delta * (ev.multiplier || 1)
      t.score += applied
      // 记分流水：可对账、可撤销（误记纠纷的"账本"）
      s.scoreLog = [...(s.scoreLog || []), { teamId: t.id, delta: applied, ts: Date.now() }].slice(-50)
      break
    }

    case 'score:undo': {
      const guard = adminOnly(); if (guard) return guard
      const log = s.scoreLog || []
      const last = log[log.length - 1]
      if (!last) return { ok: false, error: { code: 'empty', message: '没有可撤销的记分' } }
      const t = findTeam(s, last.teamId)
      if (t) t.score -= last.delta
      s.scoreLog = log.slice(0, -1)
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
      } else if (ev.op === 'resume') {
        const tm = s.overlays.timer
        if (tm && tm.paused) { tm.endsAt = Date.now() + tm.remaining; tm.paused = false }
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

    case 'room:end': {
      const guard = adminOnly(); if (guard) return guard
      s.phase = 'ended'
      s.currentStage = null
      s.overlays = {}
      s.uplinkOpen = false
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
    case 'admin:login':
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
  if (s.phase === 'ended') { base.ended = true; return base }

  // 身份常驻（PRD §1：玩家可见 = 自己 + 同队）：
  // 揭晓分组后，本队信息和自己的内鬼身份在任意环节（含等待页）都附带下发；
  // 揭晓前一律不可见，防止分队/内鬼指定先泄露。
  if (s.teamsRevealed) {
    if (me.teamId) {
      const team = findTeam(s, me.teamId)
      const members = s.members.filter(p => p.teamId === me.teamId && !p.kicked)
        .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isCaptain: team?.captainId === p.id }))
      base.team = { id: team?.id || me.teamId, name: team?.name || '我的队', isCaptain: team?.captainId === me.id, members }
    }
    if (me.secretRole === 'spy') base.secret = { isSpy: true, task: me.spyTask }
  }

  const st = s.currentStage
  if (!st) return base // 等待页（overlay 仍显示）

  base.waiting = false
  const content = visibleStageContent(s, st, me)
  base.stage = { type: st.type, visibility: st.visibility, content }

  return base
}

// 主环节内容裁剪（不含 E 的 team/secret，那在 buildPlayerView 拼）
function visibleStageContent(s: RoomState, st: RoomState['currentStage'], me: Player): Record<string, any> {
  if (!st) return {}

  // 猜猜我是谁（A 类反转）：参赛者能看到所有别人的牌，唯独看不到自己的；
  // 旁观者（未参赛）全知视角，看所有人的牌跟着起哄；猜中后自己的牌才翻给本人。
  if (st.type === 'whoami') {
    const parts: string[] = st.payload.participantIds || []
    const guessed: string[] = st.payload.guessed || []
    const cards = (excludeId?: string) => parts
      .filter(id => id !== excludeId)
      .map(id => {
        const p = findPlayer(s, id)
        return { id, name: p?.name || '?', avatar: p?.avatar || '❓', word: st.payload.assignment[id], guessed: guessed.includes(id) }
      })
    if (!parts.includes(me.id)) return { spectator: true, others: cards() }
    return {
      meGuessed: guessed.includes(me.id),
      myWord: guessed.includes(me.id) ? st.payload.assignment[me.id] : undefined,
      others: cards(me.id),
    }
  }

  // 疯狂故事组合：投稿明细只有管理员可见，玩家只拿到自己的提交状态、总份数和当前开奖结果
  if (st.type === 'storymix') {
    const subs = (st.payload.submissions || {}) as Record<string, unknown>
    return {
      submitted: !!subs[me.id],
      submittedCount: Object.keys(subs).length,
      story: st.payload.story || null,
    }
  }

  switch (st.visibility) {
    case 'C': {
      // 全员同屏，但兜底剔除敏感字段——防止未来某个环节把私密数据误塞进 C 类 payload
      const { assignment, ballots, voterIds, submissions, history, ...safe } = st.payload
      return safe
    }
    case 'B':
      return me.id === st.payload.actorId
        ? { role: 'actor', word: st.payload.word, durationSec: st.payload.durationSec }
        : { role: 'guesser', hint: '👀 猜！' }
    case 'A': {
      const inGame = (st.payload.participantIds || []).includes(me.id)
      if (!inGame) return { notInGame: true }
      const out = (st.payload.out || []).includes(me.id)
      if ((st.payload.blankIds || []).includes(me.id)) return { isBlank: true, out }
      return { myWord: st.payload.assignment[me.id], out }
    }
    case 'D': {
      // 投票进度只透出"已投几人"，不透出票数分布
      const votedCount = Object.keys((st.payload.ballots || {}) as Record<string, string>).length
      const totalVoters = ((st.payload.voterIds || []) as string[]).length
      // 选项模式下"候选"渲染为选项文本（id 即下标），其余逻辑同投人
      const renderCandidates = () => st.payload.options
        ? (st.payload.options as string[]).map((label, i) => ({ id: String(i), name: label, avatar: '🔘' }))
        : candidateInfo(s, st.payload.candidates)
      const extra = { question: st.payload.question || undefined, isOptions: !!st.payload.options }
      if (st.payload.voterIds?.length && !st.payload.voterIds.includes(me.id)) {
        return { ...extra, notInVote: true, votedCount, totalVoters, candidates: renderCandidates() }
      }
      const voted = st.payload.ballots && st.payload.ballots[me.id]
      if (st.payload.revealed === 'count') {
        return { ...extra, revealed: 'count', tally: st.payload.tally, candidates: renderCandidates() }
      }
      return voted
        ? { ...extra, voted: true, votedCount, totalVoters }
        : { ...extra, votedCount, totalVoters, candidates: renderCandidates() }
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
