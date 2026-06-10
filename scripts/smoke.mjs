import WebSocket from 'ws'
import assert from 'node:assert/strict'

const url = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:53917/ws'
let actionSeq = 0

class Client {
  constructor(label) {
    this.label = label
    this.events = []
    this.waiters = []
    this.ws = new WebSocket(url)
  }

  ready() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  listen() {
    this.ws.on('message', (data) => {
      const event = JSON.parse(data.toString())
      this.events.push(event)
      const pending = [...this.waiters]
      this.waiters = []
      for (const waiter of pending) {
        if (waiter.predicate(event)) waiter.resolve(event)
        else this.waiters.push(waiter)
      }
    })
  }

  send(event) {
    this.ws.send(JSON.stringify({ ...event, actionId: `smoke_${Date.now()}_${actionSeq++}` }))
  }

  waitFor(predicate, timeoutMs = 5000) {
    const existing = this.events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w.resolve !== resolve)
        reject(new Error(`${this.label} timed out waiting for event`))
      }, timeoutMs)
      this.waiters.push({
        predicate,
        resolve: (event) => {
          clearTimeout(timer)
          resolve(event)
        },
      })
    })
  }

  waitState(predicate = () => true) {
    return this.waitFor(event => event.t === 'room:state' && predicate(event))
  }

  waitError(code) {
    return this.waitFor(event => event.t === 'error' && (!code || event.code === code))
  }

  close() {
    this.ws.close()
  }
}

async function makeClient(label) {
  const client = new Client(label)
  client.listen()
  await client.ready()
  return client
}

async function main() {
  const code = `T${Math.random().toString(36).slice(2, 5)}`.toUpperCase()
  const admin = await makeClient('admin')
  admin.send({ t: 'room:create', code: '坏房间码', adminName: '主持人' })
  await admin.waitError('bad_code')
  admin.send({ t: 'room:create', code, adminName: '主持人' })
  const created = await admin.waitFor(event => event.t === 'created')
  assert.equal(created.code, code, 'created room code')
  console.log('✓ 房间码格式校验')

  const players = await Promise.all(['阿云', '巴特', '琪琪'].map(async (name, index) => {
    const client = await makeClient(name)
    const clientId = `smoke_player_${Date.now()}_${index}`
    client.clientId = clientId
    client.send({ t: 'player:join', code, name, avatar: ['🐺', '🦌', '🐎'][index], clientId })
    const joined = await client.waitFor(event => event.t === 'joined')
    assert.equal(joined.playerId, clientId, `${name} joined`)
    return client
  }))

  await admin.waitState(state => state.room.members.filter(m => !m.kicked).length === 3)
  console.log('✓ 创建房间并加入 3 人')

  admin.send({ t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} } })
  await admin.waitError('no_draw')
  console.log('✓ 未分队不能揭晓分组')

  admin.send({ t: 'draw:generate', teamCount: 2, balance: false })
  const drawPreview = await admin.waitState(state => state.room.teams.length === 2)
  const room = drawPreview.room
  const firstTeam = room.teams[0]
  const captainId = firstTeam.captainId
  const captain = players.find(player => player.clientId === captainId)
  const nonCaptain = players.find(player => player.clientId !== captainId)
  assert.ok(captain, 'captain client found')
  assert.ok(nonCaptain, 'non-captain client found')

  nonCaptain.send({ t: 'team:setName', teamId: firstTeam.id, name: '越权队名' })
  await nonCaptain.waitError('forbidden')
  captain.send({ t: 'team:setName', teamId: firstTeam.id, name: '烟火队' })
  await admin.waitState(state => state.room.teams.some(team => team.id === firstTeam.id && team.name === '烟火队'))
  console.log('✓ 队名只能队长或管理员修改')

  admin.send({ t: 'spy:assign', playerIds: [players[0].clientId], tasks: { [players[0].clientId]: '悄悄观察队伍策略' } })
  await admin.waitState(state => state.room.members.some(member => member.id === players[0].clientId && member.secretRole === 'spy'))
  admin.send({ t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} } })
  await players[0].waitState(state => state.team?.name)
  console.log('✓ 分队揭晓和内鬼身份下发')

  admin.send({ t: 'undercover:push', wordPairId: 'wp1', participantIds: players.map(player => player.clientId), spyWordCount: 1 })
  const playerState = await players[0].waitState(state => state.stage?.type === 'undercover')
  const adminUndercover = await admin.waitState(state => state.room.currentStage?.type === 'undercover')
  assert.equal(playerState.stage.content.assignment, undefined, 'player cannot see full assignment')
  assert.equal(typeof playerState.stage.content.myWord, 'string', 'player sees own word')
  assert.ok(adminUndercover.room.currentStage.payload.assignment, 'admin sees assignment')
  console.log('✓ 谁是卧底只给参与者自己的词')

  admin.send({ t: 'admin:toggleUplink', open: true })
  await players[0].waitState(state => state.uplinkOpen === true)
  players[0].send({ t: 'msg:send', fromPlayerId: players[1].clientId, text: '我在冒充别人' })
  const inboxState = await admin.waitState(state => state.inbox.messages.some(msg => msg.text === '我在冒充别人'))
  const inboxMessage = inboxState.inbox.messages.find(msg => msg.text === '我在冒充别人')
  assert.equal(inboxMessage.fromPlayerId, players[0].clientId, 'server uses session identity for message sender')
  console.log('✓ 私信身份不可伪造')

  admin.send({ t: 'vote:open', candidateIds: players.slice(0, 2).map(player => player.clientId) })
  await players[2].waitState(state => state.stage?.content?.notInVote === true)
  players[2].send({ t: 'vote:cast', targetId: players[0].clientId })
  await players[2].waitError('not_eligible')
  console.log('✓ 非本轮投票成员不能投票')

  admin.send({ t: 'vote:open', candidateIds: players.map(player => player.clientId) })
  await players[0].waitState(state => state.stage?.type === 'vote' && state.stage.content.candidates?.length === 3)
  players[0].send({ t: 'vote:cast', voterId: players[1].clientId, targetId: players[2].clientId })
  const voteState = await admin.waitState(state => state.room.currentStage?.payload.ballots?.[players[0].clientId] === players[2].clientId)
  assert.equal(voteState.room.currentStage.payload.ballots[players[1].clientId], undefined, 'server ignores forged voterId')
  console.log('✓ 投票身份不可伪造')

  const reconnecting = players[2]
  reconnecting.close()
  await new Promise(resolve => setTimeout(resolve, 200))
  const rejoined = await makeClient('琪琪-rejoin')
  rejoined.send({ t: 'player:rejoin', code, clientId: reconnecting.clientId })
  await rejoined.waitFor(event => event.t === 'joined' && event.playerId === reconnecting.clientId)
  await rejoined.waitState(state => state.me.id === reconnecting.clientId)
  console.log('✓ 参与者可重连恢复身份')

  for (const client of [admin, ...players, rejoined]) client.close()
  console.log('\n=== smoke 通过 ===')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
