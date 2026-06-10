// Room 状态机 reducer + 可见性裁剪单元测试
// 重点保障：参与者在网络层拿不到别人的词 / 票数分布 / 内鬼名单

import { describe, it, expect } from 'vitest'
import { createRoom, reduce, buildPlayerView, type RoomRuntime, type Actor } from '../server/game/room'
import { UNDERCOVER_PAIRS } from '../shared/words'

const ADMIN: Actor = { role: 'admin' }
let seq = 0
const aid = () => `t_${seq++}`

function joinPlayers(rt: RoomRuntime, n: number): string[] {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const clientId = `c${i}`
    const r = reduce(rt, { t: 'player:join', code: rt.state.code, name: `玩家${i}`, clientId, actionId: aid() }, { role: 'player' })
    expect(r.ok).toBe(true)
    ids.push(r.joined!.playerId)
  }
  return ids
}

describe('加入与治理', () => {
  it('正常加入、同名追加序号、满员拒绝', () => {
    const rt = createRoom('TEST')
    rt.state.maxPlayers = 2
    reduce(rt, { t: 'player:join', code: 'TEST', name: '张三', clientId: 'a', actionId: aid() }, { role: 'player' })
    reduce(rt, { t: 'player:join', code: 'TEST', name: '张三', clientId: 'b', actionId: aid() }, { role: 'player' })
    expect(rt.state.members.map(m => m.name)).toEqual(['张三', '张三#2'])
    const r = reduce(rt, { t: 'player:join', code: 'TEST', name: '李四', clientId: 'c', actionId: aid() }, { role: 'player' })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('full')
  })

  it('口令错误拒绝；被踢者重进被拒', () => {
    const rt = createRoom('TEST', 'mima')
    const bad = reduce(rt, { t: 'player:join', code: 'TEST', name: 'x', passcode: 'wrong', clientId: 'a', actionId: aid() }, { role: 'player' })
    expect(bad.error?.code).toBe('passcode')
    const ok = reduce(rt, { t: 'player:join', code: 'TEST', name: 'x', passcode: 'mima', clientId: 'a', actionId: aid() }, { role: 'player' })
    expect(ok.ok).toBe(true)
    reduce(rt, { t: 'admin:kick', playerId: 'a', actionId: aid() }, ADMIN)
    const again = reduce(rt, { t: 'player:join', code: 'TEST', name: 'x', passcode: 'mima', clientId: 'a', actionId: aid() }, { role: 'player' })
    expect(again.error?.code).toBe('kicked')
  })

  it('管理员凭证不可预测（CSPRNG，足够长且互不相同）', () => {
    const a = createRoom('A').adminToken
    const b = createRoom('B').adminToken
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })
})

describe('幂等', () => {
  it('同 actionId 的记分只生效一次', () => {
    const rt = createRoom('TEST')
    joinPlayers(rt, 4)
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    const teamId = rt.state.teams[0].id
    const sameId = aid()
    reduce(rt, { t: 'score:adjust', teamId, delta: 3, actionId: sameId }, ADMIN)
    reduce(rt, { t: 'score:adjust', teamId, delta: 3, actionId: sameId }, ADMIN)
    expect(rt.state.teams[0].score).toBe(3)
  })
})

describe('可见性裁剪（系统灵魂）', () => {
  it('A 类谁是卧底：玩家只能看到自己的词，拿不到 assignment 全表', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 4)
    const r = reduce(rt, { t: 'undercover:push', wordPairId: UNDERCOVER_PAIRS[0].id, participantIds: ids.slice(0, 3), spyWordCount: 1, actionId: aid() }, ADMIN)
    expect(r.ok).toBe(true)
    const v = buildPlayerView(rt, ids[0])
    expect(v.stage?.content.myWord).toBeTruthy()
    expect(v.stage?.content.assignment).toBeUndefined()
    const outsider = buildPlayerView(rt, ids[3])
    expect(outsider.stage?.content.notInGame).toBe(true)
    expect(outsider.stage?.content.myWord).toBeUndefined()
  })

  it('A 类白板：白板玩家只收到 isBlank，拿不到任何词；发牌人数符合配置', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 6)
    const r = reduce(rt, { t: 'undercover:push', wordPairId: 'wp1', participantIds: ids, spyWordCount: 2, blankCount: 1, actionId: aid() }, ADMIN)
    expect(r.ok).toBe(true)
    const pl = rt.state.currentStage!.payload
    expect(pl.blankIds).toHaveLength(1)
    const words = Object.values(pl.assignment as Record<string, string>)
    expect(words.filter(w => w === pl.spy)).toHaveLength(2)
    expect(words.filter(w => w === pl.civilian)).toHaveLength(3)
    const blankView = buildPlayerView(rt, pl.blankIds[0])
    expect(blankView.stage?.content.isBlank).toBe(true)
    expect(blankView.stage?.content.myWord).toBeUndefined()
    expect(blankView.stage?.content.assignment).toBeUndefined()
  })

  it('卧底+白板人数校验：至少 1 人、至少留 2 名平民', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 4)
    const none = reduce(rt, { t: 'undercover:push', wordPairId: 'wp1', participantIds: ids, spyWordCount: 0, blankCount: 0, actionId: aid() }, ADMIN)
    expect(none.error?.code).toBe('bad_counts')
    const tooMany = reduce(rt, { t: 'undercover:push', wordPairId: 'wp1', participantIds: ids, spyWordCount: 2, blankCount: 1, actionId: aid() }, ADMIN)
    expect(tooMany.error?.code).toBe('bad_counts')
  })

  it('自定义词对：可用主持人手输的词；空词或两词相同被拒', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 3)
    const empty = reduce(rt, { t: 'undercover:push', custom: { civilian: ' ', spy: 'x' }, participantIds: ids, spyWordCount: 1, actionId: aid() }, ADMIN)
    expect(empty.error?.code).toBe('empty_pair')
    const same = reduce(rt, { t: 'undercover:push', custom: { civilian: '茶壶', spy: '茶壶' }, participantIds: ids, spyWordCount: 1, actionId: aid() }, ADMIN)
    expect(same.error?.code).toBe('same_pair')
    const ok = reduce(rt, { t: 'undercover:push', custom: { civilian: '张总的保温杯', spy: '李总的茶壶' }, participantIds: ids, spyWordCount: 1, actionId: aid() }, ADMIN)
    expect(ok.ok).toBe(true)
    expect(rt.state.currentStage!.payload.pairId).toBe('custom')
    const words = Object.values(rt.state.currentStage!.payload.assignment as Record<string, string>)
    expect(words.filter(w => w === '李总的茶壶')).toHaveLength(1)
    expect(words.filter(w => w === '张总的保温杯')).toHaveLength(2)
  })

  it('B 类你比我猜：词只给比划者，且自动起全场倒计时', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 2)
    reduce(rt, { t: 'charades:push', actorId: ids[0], word: '套马杆', durationSec: 90, actionId: aid() }, ADMIN)
    expect(buildPlayerView(rt, ids[0]).stage?.content.word).toBe('套马杆')
    expect(buildPlayerView(rt, ids[1]).stage?.content.word).toBeUndefined()
    expect(rt.state.overlays.timer).toBeTruthy()
    expect(rt.state.overlays.timer!.paused).toBe(false)
  })

  it('D 类投票：投票前后都看不到票数分布，只看到进度；揭晓后才有 tally', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 3)
    reduce(rt, { t: 'vote:open', actionId: aid() }, ADMIN)
    reduce(rt, { t: 'vote:cast', targetId: ids[1], actionId: aid() }, { role: 'player', playerId: ids[0] })
    const voted = buildPlayerView(rt, ids[0])
    expect(voted.stage?.content.voted).toBe(true)
    expect(voted.stage?.content.votedCount).toBe(1)
    expect(voted.stage?.content.totalVoters).toBe(3)
    expect(voted.stage?.content.ballots).toBeUndefined()
    expect(voted.stage?.content.tally).toBeUndefined()
    const notVoted = buildPlayerView(rt, ids[2])
    expect(notVoted.stage?.content.candidates).toHaveLength(3)
    reduce(rt, { t: 'vote:revealCount', actionId: aid() }, ADMIN)
    expect(buildPlayerView(rt, ids[2]).stage?.content.tally[ids[1]]).toBe(1)
  })

  it('E 类抽签揭晓：只看本队；内鬼额外拿到任务；普通人拿不到内鬼信息', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 6)
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'spy:assign', playerIds: [ids[0]], tasks: { [ids[0]]: '潜伏' }, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} }, actionId: aid() }, ADMIN)
    const spyView = buildPlayerView(rt, ids[0])
    expect(spyView.secret).toEqual({ isSpy: true, task: '潜伏' })
    expect(spyView.team!.members.length).toBeLessThan(6)
    const normal = buildPlayerView(rt, ids[1])
    expect(normal.secret).toBeUndefined()
  })

  it('身份常驻：揭晓前看不到队伍/内鬼；揭晓后任何环节（含等待页）都可见；重新分队后复位隐藏', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 6)
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'spy:assign', playerIds: [ids[0]], tasks: { [ids[0]]: '潜伏' }, actionId: aid() }, ADMIN)
    // 揭晓前：等待页不带队伍/身份（防泄露）
    let v = buildPlayerView(rt, ids[0])
    expect(v.team).toBeUndefined()
    expect(v.secret).toBeUndefined()
    // 揭晓
    reduce(rt, { t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} }, actionId: aid() }, ADMIN)
    // 切回等待页：队伍和内鬼身份仍常驻
    reduce(rt, { t: 'stage:clear', actionId: aid() }, ADMIN)
    v = buildPlayerView(rt, ids[0])
    expect(v.waiting).toBe(true)
    expect(v.team).toBeTruthy()
    expect(v.secret).toEqual({ isSpy: true, task: '潜伏' })
    // 普通玩家看不到任何内鬼信息
    expect(buildPlayerView(rt, ids[1]).secret).toBeUndefined()
    // 重新分队：未揭晓状态复位，再次隐藏
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    expect(buildPlayerView(rt, ids[0]).team).toBeUndefined()
  })

  it('C 类兜底：payload 里误带 assignment/ballots 也会被剔除', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 1)
    reduce(rt, {
      t: 'stage:set',
      stage: { type: 'rulecard', visibility: 'C', payload: { title: 'x', assignment: { a: '词' }, ballots: { a: 'b' } } },
      actionId: aid(),
    }, ADMIN)
    const v = buildPlayerView(rt, ids[0])
    expect(v.stage?.content.title).toBe('x')
    expect(v.stage?.content.assignment).toBeUndefined()
    expect(v.stage?.content.ballots).toBeUndefined()
  })

  it('通用 stage:set 拒绝 A/B/D/F 可见性（必须走专用入口）', () => {
    const rt = createRoom('TEST')
    joinPlayers(rt, 3)
    const r = reduce(rt, { t: 'stage:set', stage: { type: 'undercover', visibility: 'A', payload: {} }, actionId: aid() }, ADMIN)
    expect(r.error?.code).toBe('bad_stage')
  })
})

describe('内鬼任务通道', () => {
  it('管理员可单独给内鬼改派任务；非内鬼/非管理员被拒；任务只下发给本人', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 4)
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'spy:assign', playerIds: [ids[0]], actionId: aid() }, ADMIN)
    // 非内鬼目标被拒
    expect(reduce(rt, { t: 'spy:task', playerId: ids[1], task: 'x', actionId: aid() }, ADMIN).error?.code).toBe('not_spy')
    // 参与者无权派任务
    expect(reduce(rt, { t: 'spy:task', playerId: ids[0], task: 'x', actionId: aid() }, { role: 'player', playerId: ids[1] }).error?.code).toBe('forbidden')
    // 管理员改派成功
    expect(reduce(rt, { t: 'spy:task', playerId: ids[0], task: '偷拍队长三张', actionId: aid() }, ADMIN).ok).toBe(true)
    reduce(rt, { t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} }, actionId: aid() }, ADMIN)
    expect(buildPlayerView(rt, ids[0]).secret?.task).toBe('偷拍队长三张')
    // 其他人拿不到任何任务信息
    expect(buildPlayerView(rt, ids[1]).secret).toBeUndefined()
  })
})

describe('拽尾巴淘汰赛', () => {
  it('淘汰至 1 人自动产生冠军，复活则清空冠军', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 3)
    reduce(rt, { t: 'lastman:start', actionId: aid() }, ADMIN)
    reduce(rt, { t: 'lastman:eliminate', targetId: ids[0], actionId: aid() }, ADMIN)
    reduce(rt, { t: 'lastman:eliminate', targetId: ids[1], actionId: aid() }, ADMIN)
    expect(rt.state.currentStage!.payload.championId).toBe(ids[2])
    reduce(rt, { t: 'lastman:revive', targetId: ids[1], actionId: aid() }, ADMIN)
    expect(rt.state.currentStage!.payload.championId).toBeNull()
    expect(rt.state.currentStage!.payload.aliveCount).toBe(2)
  })
})

describe('抢答', () => {
  it('记录先后顺序、去重；无抢答环节时拒绝', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 3)
    const early = reduce(rt, { t: 'buzz', actionId: aid() }, { role: 'player', playerId: ids[0] })
    expect(early.error?.code).toBe('no_buzzer')
    reduce(rt, { t: 'stage:set', stage: { type: 'buzzer', visibility: 'C', payload: { title: '抢唱' } }, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'buzz', actionId: aid() }, { role: 'player', playerId: ids[1] })
    reduce(rt, { t: 'buzz', actionId: aid() }, { role: 'player', playerId: ids[0] })
    reduce(rt, { t: 'buzz', actionId: aid() }, { role: 'player', playerId: ids[1] }) // 重复拍
    const buzzes = rt.state.currentStage!.payload.buzzes
    expect(buzzes.map((b: any) => b.playerId)).toEqual([ids[1], ids[0]])
    // 全员可见抢答顺序
    expect(buildPlayerView(rt, ids[2]).stage?.content.buzzes).toHaveLength(2)
  })
})

describe('倒计时', () => {
  it('暂停后可恢复，剩余时间保持', () => {
    const rt = createRoom('TEST')
    reduce(rt, { t: 'overlay:timer', op: 'start', durationSec: 60, actionId: aid() }, ADMIN)
    reduce(rt, { t: 'overlay:timer', op: 'pause', actionId: aid() }, ADMIN)
    const remaining = rt.state.overlays.timer!.remaining
    expect(rt.state.overlays.timer!.paused).toBe(true)
    expect(remaining).toBeGreaterThan(55_000)
    reduce(rt, { t: 'overlay:timer', op: 'resume', actionId: aid() }, ADMIN)
    expect(rt.state.overlays.timer!.paused).toBe(false)
    expect(rt.state.overlays.timer!.endsAt).toBeGreaterThan(Date.now() + 55_000)
  })
})

describe('上行私信', () => {
  it('通道关闭拒绝；开启后受冷却限制；切环节自动复位关', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 1)
    const me: Actor = { role: 'player', playerId: ids[0] }
    expect(reduce(rt, { t: 'msg:send', text: 'hi', actionId: aid() }, me).error?.code).toBe('uplink_closed')
    reduce(rt, { t: 'admin:toggleUplink', open: true, actionId: aid() }, ADMIN)
    expect(reduce(rt, { t: 'msg:send', text: 'hi', actionId: aid() }, me).ok).toBe(true)
    expect(reduce(rt, { t: 'msg:send', text: 'again', actionId: aid() }, me).error?.code).toBe('cooldown')
    reduce(rt, { t: 'stage:set', stage: { type: 'rulecard', visibility: 'C', payload: { title: 'x' } }, actionId: aid() }, ADMIN)
    expect(rt.state.uplinkOpen).toBe(false)
  })
})

describe('权限', () => {
  it('参与者无法执行管理员动作', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 4)
    const me: Actor = { role: 'player', playerId: ids[0] }
    expect(reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, me).error?.code).toBe('forbidden')
    expect(reduce(rt, { t: 'stage:clear', actionId: aid() }, me).error?.code).toBe('forbidden')
    expect(reduce(rt, { t: 'room:end', actionId: aid() }, me).error?.code).toBe('forbidden')
  })

  it('队名仅队长或管理员可改', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 4)
    reduce(rt, { t: 'draw:generate', teamCount: 2, balance: false, actionId: aid() }, ADMIN)
    const team = rt.state.teams[0]
    const nonCaptain = rt.state.members.find(m => m.teamId === team.id && m.id !== team.captainId)!
    const r = reduce(rt, { t: 'team:setName', teamId: team.id, name: '黑队', actionId: aid() }, { role: 'player', playerId: nonCaptain.id })
    expect(r.error?.code).toBe('forbidden')
    const r2 = reduce(rt, { t: 'team:setName', teamId: team.id, name: '苍狼', actionId: aid() }, { role: 'player', playerId: team.captainId! })
    expect(r2.ok).toBe(true)
    expect(team.name).toBe('苍狼')
  })
})

describe('房间结束', () => {
  it('room:end 清空环节与 overlay，玩家看到结束页，新人无法加入', () => {
    const rt = createRoom('TEST')
    const ids = joinPlayers(rt, 2)
    reduce(rt, { t: 'overlay:announce', text: '公告', actionId: aid() }, ADMIN)
    reduce(rt, { t: 'room:end', actionId: aid() }, ADMIN)
    expect(rt.state.phase).toBe('ended')
    expect(rt.state.currentStage).toBeNull()
    expect(rt.state.overlays).toEqual({})
    expect(buildPlayerView(rt, ids[0]).ended).toBe(true)
    const r = reduce(rt, { t: 'player:join', code: 'TEST', name: '新人', clientId: 'z', actionId: aid() }, { role: 'player' })
    expect(r.error?.code).toBe('ended')
  })
})
