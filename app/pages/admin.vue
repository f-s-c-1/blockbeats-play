<script setup lang="ts">
import { useRoom } from '../composables/useRoom'
import type { AdminView } from '@shared/types'
import { UNDERCOVER_PAIRS, CHARADES_WORDS, SPY_TASKS, WORD_CATEGORIES, CHARADES_CATEGORIES } from '@shared/words'
import { EMOJI_QUIZ, EMOJI_QUIZ_CATEGORIES } from '@shared/words'
import { GAME_RULES, GAME_CATEGORIES, PUNISHMENTS } from '@shared/games'
import { RICH_BOARD, RICH_MAX_LEVEL, RICH_BAIL_COST, RICH_ITEMS, richRent, richGroupOf } from '@shared/richman'
import type { RichItemKind } from '@shared/richman'

const { connected, view, lastError, created, connect, send } = useRoom()
const phase = ref<'setup' | 'console'>('setup')
const codeInput = ref('')
const passcode = ref('')
const adminPass = ref('')
const recoverCode = ref('')
const recoverPass = ref('')
const origin = ref('')
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

const TOKEN_KEY = 'caoyuan:admin'

onMounted(() => {
  origin.value = location.origin
  danmakuOn.value = localStorage.getItem(DANMAKU_KEY) !== '0'
  clock = setInterval(() => { now.value = Date.now() }, 500)
  connect(() => {
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) {
      const { code, adminToken } = JSON.parse(saved)
      send({ t: 'admin:rejoin', code, adminToken })
    }
  })
})

onUnmounted(() => {
  if (clock) clearInterval(clock)
  if (copyTimer) clearTimeout(copyTimer)
})

watch(created, (c) => {
  if (c) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ code: c.code, adminToken: c.adminToken }))
    phase.value = 'console'
  }
})

watch(view, (v) => {
  if (v?.role === 'admin') phase.value = 'console'
})

function createRoom() {
  send({
    t: 'room:create',
    code: codeInput.value.trim().toUpperCase() || undefined,
    adminName: '主持人',
    passcode: passcode.value || undefined,
    adminPass: adminPass.value.trim() || undefined,
  })
}

// 换设备凭「房间码 + 主持口令」找回控制台
function recoverRoom() {
  if (!recoverCode.value.trim() || !recoverPass.value.trim()) return
  send({ t: 'admin:login', code: recoverCode.value.trim().toUpperCase(), adminPass: recoverPass.value.trim() })
}

const av = computed(() => (view.value?.role === 'admin' ? (view.value as AdminView) : null))
const room = computed(() => av.value?.room)
const members = computed(() => room.value?.members.filter(m => !m.kicked) || [])
const teams = computed(() => room.value?.teams || [])
const stage = computed(() => room.value?.currentStage)
const joinLink = computed(() => room.value && origin.value ? `${origin.value}/r/${room.value.code}` : '')
const onlineCount = computed(() => members.value.filter(m => m.online).length)
const inboxMessages = computed(() => [...(av.value?.inbox.messages || [])].reverse())
const sortedTeams = computed(() => [...teams.value].sort((a, b) => b.score - a.score))

const stageLabels: Record<string, string> = {
  lobby: '等待',
  draw: '抽签分组',
  undercover: '谁是卧底',
  charades: '你比我猜',
  vote: '投票',
  lastman: '吃鸡淘汰赛',
  storymix: '故事组合',
  wheel: '点名转盘',
  richman: '大富翁',
  task: '任务',
  reveal: '内鬼揭晓',
  rulecard: '规则卡',
  counter: '计数挑战',
  standstill: '定格挑战',
  buzzer: '抢答',
  whoami: '猜猜我是谁',
}

const visibilityLabels: Record<string, string> = {
  A: '个人词卡',
  B: '单人秘密',
  C: '全员同屏',
  D: '投票',
  E: '队伍身份',
  F: '淘汰状态',
}

const activeSection = computed(() => {
  switch (stage.value?.type) {
    case 'draw': return 'draw'
    case 'undercover': return 'undercover'
    case 'charades': return 'charades'
    case 'whoami': return 'whoami'
    case 'lastman': return 'lastman'
    case 'storymix': return 'storymix'
    case 'wheel': return 'wheel'
    case 'richman': return 'richman'
    case 'vote':
    case 'reveal': return 'vote'
    case 'rulecard':
    case 'counter':
    case 'standstill':
    case 'buzzer': return 'general'
    default: return ''
  }
})

// 标签页：一次只显示一个环节面板；推进环节时自动跳到对应标签
const activeTab = ref('members')
watch(activeSection, (s) => { if (s) activeTab.value = s })

// 收件箱未读：不在收件箱标签时来了新消息 → 标签上亮红色计数，切过去即清零
const inboxSeen = ref(0)
const inboxUnread = computed(() => Math.max(0, inboxMessages.value.length - inboxSeen.value))
watch(activeTab, (t) => { if (t === 'inbox') inboxSeen.value = inboxMessages.value.length })
watch(inboxMessages, (msgs) => { if (activeTab.value === 'inbox') inboxSeen.value = msgs.length })

// 玩家消息弹幕：新消息从屏幕飘过，主持人可一键关闭（状态记本机）
const DANMAKU_KEY = 'caoyuan:danmaku'
const danmakuOn = ref(true)
interface DanmakuItem { key: string; text: string; top: number; dur: number }
const danmaku = ref<DanmakuItem[]>([])
let danmakuSeq = 0

function flyDanmaku(text: string) {
  const item: DanmakuItem = {
    key: `dm_${danmakuSeq++}`,
    text,
    top: 8 + Math.random() * 52,
    dur: 16 + Math.random() * 6, // 慢速横穿，宽屏上也能看清
  }
  danmaku.value = [...danmaku.value, item]
  setTimeout(() => { danmaku.value = danmaku.value.filter(d => d.key !== item.key) }, item.dur * 1000 + 500)
}

function toggleDanmaku() {
  danmakuOn.value = !danmakuOn.value
  localStorage.setItem(DANMAKU_KEY, danmakuOn.value ? '1' : '0')
  if (danmakuOn.value) flyDanmaku('弹幕已开启，玩家消息会从这里飘过 🎉')
}

let danmakuInit = false
watch(inboxMessages, (msgs, prev) => {
  // 首次收到状态（含历史消息）不飘，只飘之后新来的
  if (!danmakuInit) { danmakuInit = true; return }
  if (!danmakuOn.value) return
  const prevIds = new Set((prev || []).map(m => m.id))
  msgs.filter(m => !prevIds.has(m.id)).slice(0, 5)
    .forEach(m => flyDanmaku(`${m.fromName}：${m.text}`))
})

const navItems = [
  { id: 'members', label: '成员' },
  { id: 'draw', label: '抽签' },
  { id: 'undercover', label: '卧底' },
  { id: 'charades', label: '你比我猜' },
  { id: 'whoami', label: '猜猜我是谁' },
  { id: 'storymix', label: '故事组合' },
  { id: 'wheel', label: '点名转盘' },
  { id: 'richman', label: '大富翁' },
  { id: 'lastman', label: '吃鸡淘汰' },
  { id: 'vote', label: '投票' },
  { id: 'score', label: '积分' },
  { id: 'general', label: '通用' },
  { id: 'manual', label: '游戏手册' },
  { id: 'punish', label: '惩罚' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'inbox', label: '收件箱' },
]

const stageSummary = computed(() => {
  const st = stage.value
  if (!st) {
    return {
      title: '等待主持人发起环节',
      detail: '参与者停留在等待页，可先完成入场、分组和规则准备。',
      tag: '待机',
    }
  }

  if (st.type === 'vote') {
    const ballots = Object.keys((st.payload.ballots || {}) as Record<string, string>).length
    const voters = ((st.payload.voterIds || []) as string[]).length
    return {
      title: stageLabels[st.type],
      detail: `已投 ${ballots}/${voters || members.value.length}，候选 ${((st.payload.candidates || []) as string[]).length} 人。`,
      tag: visibilityLabels[st.visibility] || st.visibility,
    }
  }

  if (st.type === 'lastman') {
    return {
      title: stageLabels[st.type],
      detail: st.payload.championId ? `冠军：${memberName(st.payload.championId)}` : `剩余 ${st.payload.aliveCount ?? 0} 人。`,
      tag: visibilityLabels[st.visibility] || st.visibility,
    }
  }

  if (st.type === 'richman') {
    const pl = st.payload
    const cur = pl.teams?.find((t: { id: string }) => t.id === pl.order?.[pl.turnIdx])
    return {
      title: stageLabels[st.type],
      detail: pl.finished ? `已结算，冠军：${pl.ranking?.[0]?.name}` : `第 ${pl.round} 圈 · 轮到 ${cur?.name || '?'}`,
      tag: visibilityLabels[st.visibility] || st.visibility,
    }
  }

  if (st.type === 'charades') {
    return {
      title: stageLabels[st.type],
      detail: `${memberName(st.payload.actorId)} 正在比划「${st.payload.word}」。`,
      tag: visibilityLabels[st.visibility] || st.visibility,
    }
  }

  return {
    title: stageLabels[st.type] || st.type,
    detail: visibilityLabels[st.visibility] || st.visibility,
    tag: visibilityLabels[st.visibility] || st.visibility,
  }
})

const timerLabel = computed(() => {
  const timer = room.value?.overlays.timer
  if (!timer) return '未开启'
  const seconds = Math.ceil((timer.paused ? timer.remaining : Math.max(0, timer.endsAt - now.value)) / 1000)
  return timer.paused ? `暂停 ${seconds}s` : `${seconds}s`
})

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | undefined

function setCopyState(state: typeof copyState.value) {
  copyState.value = state
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copyState.value = 'idle' }, 1800)
}

async function copyLink() {
  if (!joinLink.value) return
  try {
    // clipboard API 仅 HTTPS/localhost 可用；局域网 http 下退回 execCommand
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(joinLink.value)
    } else {
      const ta = document.createElement('textarea')
      ta.value = joinLink.value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (!ok) throw new Error('copy failed')
    }
    setCopyState('copied')
  } catch {
    setCopyState('failed')
  }
}

function openJoinPage() {
  if (joinLink.value) window.open(joinLink.value, '_blank', 'noopener,noreferrer')
}

// —— 主题输入弹层（替代原生 prompt，移动端体验差且容易被拦截）——
const dialog = ref<null | { title: string; value: string; placeholder?: string; maxlength?: number; onOk: (v: string) => void }>(null)
function openDialog(title: string, value: string, onOk: (v: string) => void, placeholder = '', maxlength = 32) {
  dialog.value = { title, value, onOk, placeholder, maxlength }
}
function dialogOk() {
  const d = dialog.value
  if (!d) return
  const v = d.value.trim()
  dialog.value = null
  if (v) d.onOk(v)
}

// —— 分组 ——
const teamCount = ref(4)
function generate() { send({ t: 'draw:generate', teamCount: teamCount.value, balance: false }) }
function revealDraw() { send({ t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} } }) }
function setTeamName(teamId: string) {
  const current = teams.value.find(t => t.id === teamId)?.name || ''
  openDialog('输入队名', current, name => send({ t: 'team:setName', teamId, name }), '队名（12 字内）', 12)
}
// 强制改任队长（队长手机没电/离场时的兜底；队长自己也能在手机上移交）
function setCaptain(teamId: string, playerId: string) { send({ t: 'team:setCaptain', teamId, playerId }) }

// —— 内鬼指定 ——
const spySel = ref<Set<string>>(new Set())
function toggleSpy(id: string) {
  spySel.value.has(id) ? spySel.value.delete(id) : spySel.value.add(id)
  spySel.value = new Set(spySel.value)
}
function assignSpies() {
  const ids = [...spySel.value]
  const tasks: Record<string, string> = {}
  ids.forEach((id, i) => { tasks[id] = SPY_TASKS[i % SPY_TASKS.length] })
  send({ t: 'spy:assign', playerIds: ids, tasks })
}

// 单独给某个内鬼改派秘密任务（只有他自己按住身份面板能看到）
function assignSpyTask(id: string, current?: string) {
  openDialog('给该内鬼的秘密任务（仅本人可见）', current || SPY_TASKS[0], task => send({ t: 'spy:task', playerId: id, task }), '任务内容（100 字内）', 100)
}

// —— 谁是卧底 ——
const ucCategory = ref<string>('全部')
const ucFilteredPairs = computed(() =>
  ucCategory.value === '全部' ? UNDERCOVER_PAIRS : UNDERCOVER_PAIRS.filter(p => p.category === ucCategory.value))
const ucPair = ref(UNDERCOVER_PAIRS[0].id)
// 切分类后若当前选中的词对不在筛选结果里，自动跳到该分类第一个
watch(ucFilteredPairs, (pairs) => {
  if (pairs.length && !pairs.some(p => p.id === ucPair.value)) ucPair.value = pairs[0].id
})
const ucCustomOn = ref(false)
const ucCustomCivilian = ref('')
const ucCustomSpy = ref('')
const ucSpyCount = ref(1)
const ucBlankCount = ref(0)
const ucParts = ref<Set<string>>(new Set())
function toggleUc(id: string) {
  ucParts.value.has(id) ? ucParts.value.delete(id) : ucParts.value.add(id)
  ucParts.value = new Set(ucParts.value)
}
function selectAllUc() { ucParts.value = new Set(members.value.map(m => m.id)) }
function clearUc() { ucParts.value = new Set() }
// 平民至少留 2 人，和服务端校验一致
const ucCountsBad = computed(() =>
  ucSpyCount.value + ucBlankCount.value < 1 || ucSpyCount.value + ucBlankCount.value > ucParts.value.size - 2)
function pushUndercover() {
  send({
    t: 'undercover:push',
    ...(ucCustomOn.value
      ? { custom: { civilian: ucCustomCivilian.value.trim(), spy: ucCustomSpy.value.trim() } }
      : { wordPairId: ucPair.value }),
    participantIds: [...ucParts.value],
    spyWordCount: ucSpyCount.value,
    blankCount: ucBlankCount.value,
  })
}
function openUndercoverVote() {
  const ids = stage.value?.type === 'undercover'
    ? ((stage.value.payload.participantIds || []) as string[])
    : [...ucParts.value]
  send({ t: 'vote:open', candidateIds: ids })
}

// —— 你比我猜 ——
const chCategory = ref<string>('全部')
const chFilteredWords = computed(() =>
  chCategory.value === '全部' ? CHARADES_WORDS : CHARADES_WORDS.filter(w => w.category === chCategory.value))
const chActor = ref('')
const chWord = ref(CHARADES_WORDS[0].text)
watch(chFilteredWords, (words) => {
  if (words.length && !words.some(w => w.text === chWord.value)) chWord.value = words[0].text
})
function pushCharades() {
  if (!chActor.value) return
  send({ t: 'charades:push', actorId: chActor.value, word: chWord.value, durationSec: 60 })
}

// —— 猜猜我是谁 ——
const wmCategory = ref<string>('全部')
const wmParts = ref<Set<string>>(new Set())
function toggleWm(id: string) {
  wmParts.value.has(id) ? wmParts.value.delete(id) : wmParts.value.add(id)
  wmParts.value = new Set(wmParts.value)
}
function clearWm() { wmParts.value = new Set() }
function pushWhoami() {
  send({
    t: 'whoami:push',
    participantIds: [...wmParts.value],
    category: wmCategory.value === '全部' ? undefined : wmCategory.value,
  })
}
const wmGuessed = computed<string[]>(() => stage.value?.type === 'whoami' ? (stage.value.payload.guessed || []) : [])
function toggleWmGuessed(id: string) {
  send({ t: 'stage:action', kind: wmGuessed.value.includes(id) ? 'whoami:unguess' : 'whoami:guessed', targetId: id })
}
const wmAssignment = computed(() => stage.value?.type === 'whoami' ? stage.value.payload.assignment as Record<string, string> : null)

// —— 卧底出局管理 ——
const ucOut = computed<string[]>(() => stage.value?.type === 'undercover' ? (stage.value.payload.out || []) : [])
function toggleUcOut(id: string) {
  send({ t: 'stage:action', kind: ucOut.value.includes(id) ? 'uneliminate' : 'eliminate', targetId: id })
}

// —— 吃鸡淘汰赛 ——
function startLastman() { send({ t: 'lastman:start' }) }
function eliminate(id: string) { send({ t: 'lastman:eliminate', targetId: id }) }
function revive(id: string) { send({ t: 'lastman:revive', targetId: id }) }
function finishLastman() { send({ t: 'lastman:finish' }) }

// —— 疯狂故事组合 ——
function startStorymix() { send({ t: 'storymix:start' }) }
function drawStory() { send({ t: 'storymix:draw' }) }
const smSubmissions = computed(() =>
  stage.value?.type === 'storymix' ? (stage.value.payload.submissions || {}) as Record<string, { who: string; where: string; what: string }> : null)
const smStory = computed(() => stage.value?.type === 'storymix' ? stage.value.payload.story : null)
const smHistory = computed<{ who: string; where: string; what: string }[]>(() =>
  stage.value?.type === 'storymix' ? [...(stage.value.payload.history || [])].reverse() : [])

// —— 随机点名转盘 ——
const wheelScope = ref('all')
function spinWheel() { send({ t: 'wheel:spin', scope: wheelScope.value }) }
const wheelWinner = computed(() => stage.value?.type === 'wheel' ? stage.value.payload.winner : null)

// —— 大富翁 ——
const rmBots = ref(0) // 机器人队数：单人也能开局测试
function startRichman() { send({ t: 'richman:start', botCount: rmBots.value }) }
function rollRichman() { send({ t: 'richman:roll' }) }
function decideRichman(accept: boolean) { send({ t: 'richman:decide', accept }) }
function nextRichman() { send({ t: 'richman:next' }) }
function endRichman() {
  if (confirm('结算本局大富翁？金币+地产折算总资产排名，不可继续掷骰。')) send({ t: 'richman:end' })
}
function bailRichman() { send({ t: 'richman:bail' }) }
const rm = computed(() => stage.value?.type === 'richman' ? stage.value.payload : null)
const rmTeamName = (id: string) => rm.value?.teams.find((t: { id: string }) => t.id === id)?.name || '?'
const rmToken = (id: string) => rm.value?.teams.find((t: { id: string }) => t.id === id)?.token || ''
const rmCurrent = computed(() => rm.value && !rm.value.finished ? rm.value.order[rm.value.turnIdx] : null)
const rmItemIcon = (kind: string) => RICH_ITEMS[kind as RichItemKind]?.icon || ''
const rmItemName = (kind: string) => RICH_ITEMS[kind as RichItemKind]?.name || ''
const rmDiceText = computed(() => {
  const vs = (rm.value?.dice?.values || []) as number[]
  if (!vs.length) return ''
  return vs.length === 2 ? `${vs[0]}+${vs[1]}=${vs[0] + vs[1]}` : `${vs[0]}`
})
const rmLog = computed<string[]>(() => [...(rm.value?.log || [])].reverse())
const rmBlockNames = computed(() =>
  Object.keys(rm.value?.blocks || {}).map(i => `${RICH_BOARD[Number(i)]?.icon}${RICH_BOARD[Number(i)]?.name}`).join('、'))
// 地产格清单（带所有权 + 成套标记），管理端棋盘总览用
const rmProps = computed(() => {
  if (!rm.value) return []
  return RICH_BOARD
    .map((tile, idx) => {
      const owner = rm.value.owners[idx] as { teamId: string; level: number } | undefined
      const group = richGroupOf(idx)
      const hasSet = !!owner && !!group
        && group.tiles.every(ti => (rm.value.owners[ti] as { teamId: string } | undefined)?.teamId === owner.teamId)
      return { tile, idx, owner, group, hasSet }
    })
    .filter(x => x.tile.type === 'prop')
})
// 结算后给冠军队加活动积分（走现有记分流水，可撤销）
function awardRichmanWinner(points = 3) {
  const top = rm.value?.ranking?.[0]
  if (top && teams.value.some(t => t.id === top.id)) adjust(top.id, points, 1)
}

// —— 惩罚库：随机抽一条，可推上全场大屏 ——
const punishment = ref('')
const punishUsed = new Set<string>()
function drawPunishment() {
  let pool = PUNISHMENTS.filter(x => !punishUsed.has(x))
  if (!pool.length) { punishUsed.clear(); pool = PUNISHMENTS }
  punishment.value = pool[Math.floor(Math.random() * pool.length)]
  punishUsed.add(punishment.value)
}
function pushPunishment(forName?: string) {
  if (!punishment.value) drawPunishment()
  send({
    t: 'stage:set',
    stage: { type: 'rulecard', visibility: 'C', payload: { title: forName ? `😈 ${forName} 的惩罚` : '😈 惩罚时间', text: punishment.value } },
  })
}

// —— emoji 出题（出进抢答环节，答案只主持人可见）——
const eqCategory = ref<string>(EMOJI_QUIZ_CATEGORIES[0])
const eqAnswer = ref('') // 当前题答案，仅留在管理端本地，不进 payload
const eqUsed = new Set<string>()
function pushEmojiQuiz() {
  let pool = EMOJI_QUIZ.filter(q => q.category === eqCategory.value && !eqUsed.has(q.clue))
  if (!pool.length) { eqUsed.clear(); pool = EMOJI_QUIZ.filter(q => q.category === eqCategory.value) }
  const q = pool[Math.floor(Math.random() * pool.length)]
  eqUsed.add(q.clue)
  eqAnswer.value = q.answer
  send({ t: 'stage:set', stage: { type: 'buzzer', visibility: 'C', payload: { title: q.clue } } })
}

// —— 投票 ——
function openVote() { send({ t: 'vote:open' }) }

// 选项投票：输入框用 / 分隔选项
const voteOptionsText = ref('')
const voteQuestion = ref('')
function fillTeamsAsOptions() { voteOptionsText.value = teams.value.map(t => t.name).join('/') }
function openOptionVote() {
  const options = voteOptionsText.value.split('/').map(x => x.trim()).filter(Boolean)
  if (options.length < 2) return
  send({ t: 'vote:open', options, question: voteQuestion.value.trim() || undefined })
}
const voteOptions = computed<string[] | null>(() =>
  stage.value?.type === 'vote' ? (stage.value.payload.options || null) : null)
// 计票行的显示名：选项模式显示选项文本，否则显示成员名
const voteLabel = (id: string) => voteOptions.value ? (voteOptions.value[Number(id)] || id) : memberName(id)
function revealCount() { send({ t: 'vote:revealCount' }) }
function revealSpy() {
  // 不可撤销的高危操作：全场立即翻牌
  if (confirm('确认揭晓内鬼？全场立即翻牌看到内鬼名单，此操作不可撤销！')) send({ t: 'vote:revealSpy' })
}

// 成员所属队伍（快捷记分用）
const memberTeamId = (id: string) => members.value.find(m => m.id === id)?.teamId || null
function awardMemberTeam(playerId: string, points = 1) {
  const teamId = memberTeamId(playerId)
  if (teamId) adjust(teamId, points, 1)
}

// —— 积分 ——
function adjust(teamId: string, delta: number, mult: 1 | 2) { send({ t: 'score:adjust', teamId, delta, multiplier: mult }) }
function undoScore() { send({ t: 'score:undo' }) }
// 自定义分值（大项目一次 +5 不用连点）
const customDelta = ref(3)
const scoreLog = computed(() => [...(room.value?.scoreLog || [])].reverse().slice(0, 10))
const teamName = (id: string) => teams.value.find(t => t.id === id)?.name || '?'
function awardChampion(points = 3) {
  const championId = stage.value?.payload.championId as string | undefined
  const champion = members.value.find(m => m.id === championId)
  if (champion?.teamId) adjust(champion.teamId, points, 1)
}

// —— overlay ——
const announceText = ref('')
const timerSec = ref(60)
function pushAnnounce() { send({ t: 'overlay:announce', text: announceText.value || null }) }
function startTimer() { send({ t: 'overlay:timer', op: 'start', durationSec: timerSec.value }) }
function pauseTimer() { send({ t: 'overlay:timer', op: 'pause' }) }
function resumeTimer() { send({ t: 'overlay:timer', op: 'resume' }) }
function resetTimer() { send({ t: 'overlay:timer', op: 'reset' }) }
function toggleScoreboard(on: boolean) { send({ t: 'overlay:scoreboard', on }) }

// —— C 类通用环节 ——
const ruleTitle = ref('本轮规则')
const ruleText = ref('听主持人口令，完成后等待记分。')
function pushRuleCard() {
  send({ t: 'stage:set', stage: { type: 'rulecard', visibility: 'C', payload: { title: ruleTitle.value, text: ruleText.value } } })
}
function pushStandstill() {
  send({ t: 'stage:set', stage: { type: 'standstill', visibility: 'C', payload: { title: '定住！', text: '听到口令前保持不动' } } })
}
function startCounter() {
  send({ t: 'stage:set', stage: { type: 'counter', visibility: 'C', payload: { title: '计数挑战', count: 0 } } })
}
function incCounter() { send({ t: 'stage:action', kind: 'counter+1' }) }

// —— 抢答 ——
const buzzerTitle = ref('听前奏抢唱')
function startBuzzer() {
  send({ t: 'stage:set', stage: { type: 'buzzer', visibility: 'C', payload: { title: buzzerTitle.value || '抢答' } } })
}
const buzzes = computed(() =>
  stage.value?.type === 'buzzer' ? ((stage.value.payload.buzzes || []) as { playerId: string; name: string; avatar: string }[]) : [])

// —— 投票进度 ——
const votePending = computed(() => {
  if (stage.value?.type !== 'vote') return []
  const ballots = (stage.value.payload.ballots || {}) as Record<string, string>
  const voterIds = (stage.value.payload.voterIds || []) as string[]
  return voterIds.filter(id => !ballots[id]).map(id => memberName(id))
})

// —— 结束房间 ——
function endRoom() {
  if (confirm('结束本场活动？所有玩家将看到结束页，且无法再加入。')) send({ t: 'room:end' })
}

// —— 游戏手册（线下游戏规则库）——
const mbCategory = ref<string>('全部')
const mbGames = computed(() =>
  mbCategory.value === '全部' ? GAME_RULES : GAME_RULES.filter(x => x.category === mbCategory.value))
const mbSelectedId = ref('')
const mbSelected = computed(() => GAME_RULES.find(x => x.id === mbSelectedId.value) || null)
// 切分类后选中项不在列表里则清空
watch(mbGames, (list) => {
  if (mbSelectedId.value && !list.some(x => x.id === mbSelectedId.value)) mbSelectedId.value = ''
})
function pushManualCard(withTimer = false) {
  const game = mbSelected.value
  if (!game) return
  send({ t: 'stage:set', stage: { type: 'rulecard', visibility: 'C', payload: { title: game.name, text: game.playerText } } })
  if (withTimer) send({ t: 'overlay:timer', op: 'start', durationSec: timerSec.value || 60 })
}

// —— 上行通道 ——
function toggleUplink(open: boolean) { send({ t: 'admin:toggleUplink', open }) }

// —— 治理 ——
function kick(id: string) { if (confirm('踢出该成员？')) send({ t: 'admin:kick', playerId: id }) }
function renamePlayer(id: string, currentName: string) {
  openDialog('输入新名字', currentName, newName => send({ t: 'admin:rename', playerId: id, newName }), '名字（12 字内）', 12)
}

function clearStage() { send({ t: 'stage:clear' }) }

const memberName = (id: string) => members.value.find(m => m.id === id)?.name || id
const memberAvatar = (id: string) => members.value.find(m => m.id === id)?.avatar || ''
const isSpy = (id: string) => members.value.find(m => m.id === id)?.secretRole === 'spy'
const teamMembers = (teamId: string) => members.value.filter(m => m.teamId === teamId)

const ucAssignment = computed(() => stage.value?.type === 'undercover' ? stage.value.payload.assignment as Record<string, string> : null)
const lmAlive = computed(() => stage.value?.type === 'lastman' ? stage.value.payload.alive as Record<string, boolean> : null)
const voteTally = computed(() => {
  if (stage.value?.type !== 'vote') return null
  const t: Record<string, number> = {}
  for (const target of Object.values((stage.value.payload.ballots || {}) as Record<string, string>)) t[target] = (t[target] || 0) + 1
  return t
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div v-if="phase === 'setup'" class="center">
    <div class="home-logo">
      <div class="huge">🎬</div>
      <h1>主持人控制台</h1>
      <p class="muted">{{ connected ? '已连接' : '连接中…' }}</p>
    </div>
    <div class="card home-shell">
      <h2>创建房间</h2>
      <input v-model="codeInput" class="code-input" placeholder="房间码（留空自动生成）" maxlength="8" />
      <input v-model="passcode" placeholder="玩家入场口令（可选）" />
      <input v-model="adminPass" type="password" placeholder="主持口令（至少 6 位，换设备可找回后台）" maxlength="32" />
      <button class="full-width" @click="createRoom">创建房间</button>
      <p v-if="lastError" class="toast error">{{ lastError.message }}</p>
    </div>
    <div class="card home-shell">
      <h2>找回已有房间</h2>
      <p class="muted">换了设备/浏览器？输入房间码和创建时设置的主持口令。</p>
      <input v-model="recoverCode" class="code-input" placeholder="房间码" maxlength="8" />
      <input v-model="recoverPass" type="password" placeholder="主持口令" maxlength="32" @keyup.enter="recoverRoom" />
      <button class="ghost full-width" :disabled="!recoverCode.trim() || !recoverPass.trim()" @click="recoverRoom">恢复控制台</button>
    </div>
  </div>

  <div v-else-if="room" class="wrap admin-wrap">
    <div v-if="dialog" class="modal-mask" @click.self="dialog = null">
      <div class="card modal-card">
        <h2>{{ dialog.title }}</h2>
        <input v-model="dialog.value" :placeholder="dialog.placeholder" :maxlength="dialog.maxlength" @keyup.enter="dialogOk" />
        <div class="section-actions">
          <button class="sm ghost" @click="dialog = null">取消</button>
          <button class="sm" :disabled="!dialog.value.trim()" @click="dialogOk">确定</button>
        </div>
      </div>
    </div>

    <div v-if="danmakuOn && danmaku.length" class="danmaku-layer" aria-hidden="true">
      <div
        v-for="d in danmaku"
        :key="d.key"
        class="danmaku-item"
        :style="{ top: d.top + '%', animationDuration: d.dur + 's' }"
      >💬 {{ d.text }}</div>
    </div>
    <header class="admin-top">
      <div class="admin-top-main">
        <div>
          <div class="room-title">
            <strong>主持人控制台</strong>
            <span class="room-code">{{ room.code }}</span>
            <span class="pill" :class="connected ? 'live' : 'warn'">
              <span class="dot" :class="connected ? 'on' : 'off'" />{{ connected ? '在线' : '重连中' }}
            </span>
          </div>
          <p class="muted">当前：{{ stageSummary.title }} · {{ stageSummary.detail }}</p>
        </div>
        <div class="top-actions">
          <button class="ghost sm" @click="clearStage">全体等待</button>
          <button class="ghost sm" :class="{ live: room.uplinkOpen }" @click="toggleUplink(!room.uplinkOpen)">
            {{ room.uplinkOpen ? '关闭上行' : '开放上行' }}
          </button>
          <button class="sm" @click="copyLink">{{ copyState === 'copied' ? '已复制' : '复制链接' }}</button>
          <button class="ghost sm" @click="openJoinPage">打开玩家页</button>
          <button class="ghost sm" :class="{ live: danmakuOn }" @click="toggleDanmaku">弹幕：{{ danmakuOn ? '开' : '关' }}</button>
          <button v-if="room.phase !== 'ended'" class="sm danger" @click="endRoom">结束活动</button>
          <span v-else class="tag spy">已结束</span>
        </div>
      </div>

      <div class="status-strip">
        <div class="stat">
          <div class="stat-label">在线人数</div>
          <div class="stat-value">{{ onlineCount }}/{{ members.length }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">当前环节</div>
          <div class="stat-value">{{ stageSummary.title }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">计时器</div>
          <div class="stat-value">{{ timerLabel }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">收件箱</div>
          <div class="stat-value">{{ inboxMessages.length }}</div>
        </div>
      </div>

      <nav class="nav-strip" aria-label="控制台导航">
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="nav-pill"
          :class="{ active: activeTab === item.id, live: activeSection === item.id && activeTab !== item.id }"
          @click="activeTab = item.id"
        >{{ item.label }}<span v-if="item.id === 'inbox' && inboxUnread" class="badge">{{ inboxUnread > 99 ? '99+' : inboxUnread }}</span></button>
      </nav>
    </header>

    <div class="copy-row card">
      <input :value="joinLink" readonly />
      <button class="sm" @click="copyLink">{{ copyState === 'copied' ? '已复制' : '复制' }}</button>
      <button class="ghost sm" @click="openJoinPage">预览</button>
      <p v-if="copyState === 'failed'" class="toast error">复制失败，请手动复制链接。</p>
      <p v-if="lastError" class="toast error">{{ lastError.message }}</p>
    </div>

    <div class="section-grid">
      <section v-show="activeTab === 'members'" id="members" class="card">
        <div class="section-head">
          <div>
            <h2>成员与内鬼</h2>
            <p class="muted">点选成员进入内鬼候选，再统一下发身份任务。</p>
          </div>
          <button class="sm" :disabled="!spySel.size" @click="assignSpies">指定 {{ spySel.size }} 个内鬼</button>
        </div>

        <div v-if="members.length" class="list">
          <span
            v-for="m in members"
            :key="m.id"
            class="member clickable"
            :class="{ spy: spySel.has(m.id) || m.secretRole === 'spy' }"
            @click="toggleSpy(m.id)"
          >
            <span class="dot" :class="m.online ? 'on' : 'off'" />
            <span class="em">{{ m.avatar }}</span>
            <span class="member-name">{{ m.name }}</span>
            <span v-if="m.secretRole === 'spy'" class="tag spy">鬼</span>
            <span class="member-actions">
              <button v-if="m.secretRole === 'spy'" class="sm warning" title="给该内鬼改派秘密任务" @click.stop="assignSpyTask(m.id, m.spyTask)">派任务</button>
              <button class="sm ghost" @click.stop="renamePlayer(m.id, m.name)">改</button>
              <button class="sm danger" @click.stop="kick(m.id)">×</button>
            </span>
          </span>
        </div>
        <div v-else class="empty-state">等待参与者扫码加入。</div>
      </section>

      <section v-show="activeTab === 'draw'" id="draw" class="card">
        <div class="section-head">
          <div>
            <h2>抽签分组</h2>
            <p class="muted">先随机分队，确认后再揭晓到所有手机。</p>
          </div>
          <span class="tag info">{{ teams.length ? `${teams.length} 队` : '未分队' }}</span>
        </div>
        <div class="section-actions">
          <select v-model.number="teamCount">
            <option v-for="n in 7" :key="n" :value="n + 1">{{ n + 1 }} 队</option>
          </select>
          <button class="sm" :disabled="members.length < teamCount" @click="generate">随机分队</button>
          <button class="sm warning" :disabled="!teams.length" @click="revealDraw">揭晓分组</button>
        </div>

        <div v-if="teams.length" class="team-grid">
          <div v-for="t in teams" :key="t.id" class="team-card" :class="{ leader: t.captainId }">
            <div class="team-head">
              <strong>{{ t.name }}</strong>
              <button class="sm ghost" @click="setTeamName(t.id)">改名</button>
            </div>
            <div class="team-members">
              <span v-for="m in teamMembers(t.id)" :key="m.id">
                {{ m.avatar }}{{ m.name }}<span v-if="isSpy(m.id)" class="tag spy">鬼</span>
                <span v-if="t.captainId === m.id" class="tag info">👑</span>
                <button v-else class="sm ghost" title="改任为队长" @click="setCaptain(t.id, m.id)">设队长</button>
              </span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">当前还没有队伍。至少 {{ teamCount }} 人后可以分队。</div>
      </section>
    </div>

    <div class="split-grid">
      <section v-show="activeTab === 'undercover'" id="undercover" class="card">
        <div class="section-head">
          <div>
            <h2>谁是卧底</h2>
            <p class="muted">选择词对和参与者，只给玩家本人显示自己的词。</p>
          </div>
          <span class="tag">{{ ucParts.size }} 人</span>
        </div>
        <div class="grid">
          <div class="section-actions">
            <select v-model="ucCategory" :disabled="ucCustomOn">
              <option value="全部">全部分类（{{ UNDERCOVER_PAIRS.length }} 对）</option>
              <option v-for="c in WORD_CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <label class="check-label">
              <input v-model="ucCustomOn" type="checkbox" /> 自定义词对
            </label>
          </div>
          <select v-if="!ucCustomOn" v-model="ucPair">
            <option v-for="p in ucFilteredPairs" :key="p.id" :value="p.id">{{ p.civilian }} / {{ p.spy }}</option>
          </select>
          <div v-else class="section-actions">
            <input v-model="ucCustomCivilian" placeholder="平民词（如：张总的保温杯）" maxlength="20" />
            <input v-model="ucCustomSpy" placeholder="卧底词（如：李总的茶壶）" maxlength="20" />
          </div>
          <div class="section-actions">
            <label class="num-label">卧底 <input v-model.number="ucSpyCount" type="number" min="0" max="10" /></label>
            <label class="num-label">白板 <input v-model.number="ucBlankCount" type="number" min="0" max="10" /></label>
            <span v-if="ucParts.size >= 3 && ucCountsBad" class="tag spy">至少留 2 名平民</span>
          </div>
          <div class="section-actions">
            <button class="sm ghost" @click="selectAllUc">全选</button>
            <button class="sm ghost" @click="clearUc">清空</button>
            <button
              class="sm"
              :disabled="ucParts.size < 3 || ucCountsBad || (ucCustomOn && (!ucCustomCivilian.trim() || !ucCustomSpy.trim()))"
              @click="pushUndercover"
            >发词</button>
            <button class="sm ghost" :disabled="!(stage?.type === 'undercover') && ucParts.size < 2" @click="openUndercoverVote">本局投票</button>
          </div>
          <div class="list">
            <span
              v-for="m in members"
              :key="m.id"
              class="member clickable"
              :class="{ alive: ucParts.has(m.id) }"
              @click="toggleUc(m.id)"
            >{{ m.avatar }}{{ m.name }}</span>
          </div>
          <div v-if="ucAssignment" class="grid">
            <p class="muted">被票出/猜出的人点「出局」，他的手机会显示已出局：</p>
            <div v-for="(w, id) in ucAssignment" :key="id" class="score-row">
              <span :class="{ 'is-out': ucOut.includes(id) }">
                {{ memberName(id) }}
                <span v-if="!w" class="tag info">⬜ 白板</span>
                <span v-else class="tag" :class="{ spy: w === stage?.payload.spy }">{{ w }}</span>
                <span v-if="ucOut.includes(id)" class="tag warn">出局</span>
              </span>
              <button class="sm" :class="{ ghost: !ucOut.includes(id) }" @click="toggleUcOut(id)">
                {{ ucOut.includes(id) ? '复活' : '出局' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'charades'" id="charades" class="card">
        <div class="section-head">
          <div>
            <h2>你比我猜</h2>
            <p class="muted">词只给比划者看到，其余人手机显示“猜”。</p>
          </div>
        </div>
        <div class="grid">
          <select v-model="chActor">
            <option value="">选比划者</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.avatar }}{{ m.name }}</option>
          </select>
          <div class="section-actions">
            <select v-model="chCategory">
              <option value="全部">全部分类（{{ CHARADES_WORDS.length }} 词）</option>
              <option v-for="c in CHARADES_CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <select v-model="chWord">
              <option v-for="w in chFilteredWords" :key="w.text" :value="w.text">{{ w.text }}</option>
            </select>
          </div>
          <button class="sm" :disabled="!chActor" @click="pushCharades">发词给比划者</button>
          <p v-if="stage?.type === 'charades'" class="toast">当前词：{{ stage.payload.word }} · {{ memberName(stage.payload.actorId) }} 比划</p>
        </div>
      </section>

      <section v-show="activeTab === 'whoami'" id="whoami" class="card">
        <div class="section-head">
          <div>
            <h2>猜猜我是谁</h2>
            <p class="muted">每人头上一个词：自己看不到，别人全能看到。轮流提"是/不是"问题猜自己；没被选中的人是旁观全知视角。</p>
          </div>
          <span class="tag">{{ wmParts.size }} 人参赛</span>
        </div>
        <div class="grid">
          <div class="section-actions">
            <select v-model="wmCategory">
              <option value="全部">全部分类</option>
              <option v-for="c in CHARADES_CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <button class="sm ghost" @click="clearWm">清空</button>
            <button class="sm" :disabled="wmParts.size < 2" @click="pushWhoami">发牌开始</button>
          </div>
          <div class="list">
            <span
              v-for="m in members"
              :key="m.id"
              class="member clickable"
              :class="{ alive: wmParts.has(m.id) }"
              @click="toggleWm(m.id)"
            >{{ m.avatar }}{{ m.name }}</span>
          </div>
          <div v-if="wmAssignment" class="grid">
            <p class="muted">点「猜中」该玩家手机立刻翻牌庆祝：</p>
            <div v-for="(w, id) in wmAssignment" :key="id" class="score-row">
              <span>{{ memberAvatar(id) }}{{ memberName(id) }} <span class="tag info">{{ w }}</span></span>
              <button class="sm" :class="{ ghost: !wmGuessed.includes(id) }" @click="toggleWmGuessed(id)">
                {{ wmGuessed.includes(id) ? '✅ 已猜中（撤销）' : '猜中' }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="split-grid">
      <section v-show="activeTab === 'storymix'" id="storymix" class="card">
        <div class="section-head">
          <div>
            <h2>疯狂故事组合</h2>
            <p class="muted">全员各投一组「人名/地点/在做什么」，随机跨人拼句开奖："小王 在火山口 跳广场舞"。</p>
          </div>
          <div class="section-actions">
            <button class="sm" @click="startStorymix">开始收集</button>
            <button class="sm warning" :disabled="!smSubmissions || Object.keys(smSubmissions).length < 2" @click="drawStory">🎲 抽一条</button>
          </div>
        </div>
        <div v-if="smSubmissions" class="grid">
          <p class="muted">已收 {{ Object.keys(smSubmissions).length }}/{{ members.length }} 份（明细仅你可见）：</p>
          <div v-for="(sub, id) in smSubmissions" :key="id" class="score-row">
            <span>{{ memberName(id) }}</span>
            <span class="muted">{{ sub.who }} · {{ sub.where }} · {{ sub.what }}</span>
          </div>
          <div v-if="smStory" class="banner">🎉 {{ smStory.who }} 在{{ smStory.where }} {{ smStory.what }}</div>
          <div v-if="smHistory.length > 1" class="panel">
            <h3>开奖历史</h3>
            <p v-for="(h, i) in smHistory" :key="i" class="muted">{{ h.who }} 在{{ h.where }} {{ h.what }}</p>
          </div>
        </div>
        <div v-else class="empty-state">点「开始收集」，玩家手机会出现投稿表单。</div>
      </section>

      <section v-show="activeTab === 'wheel'" id="wheel" class="card">
        <div class="section-head">
          <div>
            <h2>随机点名转盘</h2>
            <p class="muted">锦鲤抽奖、点名表演、大冒险点人——全场手机同步滚动，定格在同一个天选之子。</p>
          </div>
        </div>
        <div class="grid">
          <div class="section-actions">
            <select v-model="wheelScope">
              <option value="all">全员</option>
              <option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
            <button class="sm" :disabled="members.length < 2" @click="spinWheel">🎡 开始抽取</button>
          </div>
          <div v-if="wheelWinner" class="banner">
            🎉 天选之子：{{ wheelWinner.avatar }} {{ wheelWinner.name }}
            <button v-if="memberTeamId(wheelWinner.id)" class="sm" @click="awardMemberTeam(wheelWinner.id, 1)">TA队 +1</button>
            <button class="sm danger" @click="drawPunishment(); pushPunishment(wheelWinner.name)">😈 抽惩罚给TA</button>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'richman'" id="richman" class="card">
        <div class="section-head">
          <div>
            <h2>大富翁</h2>
            <p class="muted">队伍当棋子，轮流掷骰买地收租；队长在手机上掷骰/决定买地，你也可随时代操作。金币独立于活动积分。</p>
          </div>
          <div class="section-actions">
            <select v-model.number="rmBots" title="机器人队由系统自动掷骰买地，方便单人排练">
              <option :value="0">不加机器人</option>
              <option v-for="n in 4" :key="n" :value="n">{{ n }} 个机器人队</option>
            </select>
            <button class="sm" :disabled="teams.length + rmBots < 2" @click="startRichman">{{ rm ? '重新开局' : '开局' }}</button>
            <button class="sm danger" :disabled="!rm || rm.finished" @click="endRichman">结算</button>
          </div>
        </div>
        <div v-if="rm" class="grid">
          <div v-if="rm.finished" class="banner">
            🏆 {{ rm.ranking[0].token }}{{ rm.ranking[0].name }} 夺冠（总资产 {{ rm.ranking[0].total }}）
            <button class="sm" @click="awardRichmanWinner(3)">冠军队 +3</button>
          </div>
          <template v-else>
            <p class="toast">{{ rm.lastEvent?.text }}</p>
            <div v-if="rm.card" class="banner" :style="rm.card.kind === 'punish' ? 'background:var(--red);color:#fff;box-shadow:0 3px 0 var(--red-edge)' : ''">
              {{ rm.card.title }}：{{ rm.card.text }}
            </div>
            <div class="section-actions">
              <span class="tag info">第 {{ rm.round }} 圈 · 轮到 {{ rmToken(rmCurrent) }}{{ rmTeamName(rmCurrent) }}<template v-if="rmDiceText"> · 🎲 {{ rmDiceText }}</template></span>
              <button class="sm" :disabled="!!rm.pending" @click="rollRichman">🎲 代掷骰子</button>
              <button v-if="rm.frozen[rmCurrent]" class="sm warning" :disabled="rm.cash[rmCurrent] < RICH_BAIL_COST" @click="bailRichman">💰 代保释（{{ RICH_BAIL_COST }} 金币）</button>
              <template v-if="rm.pending">
                <button class="sm warning" @click="decideRichman(true)">
                  代买 {{ RICH_BOARD[rm.pending.tileIdx].name }}（{{ rm.pending.cost }} 金币）
                </button>
                <button class="sm ghost" @click="decideRichman(false)">不买</button>
              </template>
              <button class="sm ghost" @click="nextRichman">⏭️ 跳过回合</button>
            </div>
          </template>
          <div v-for="t in rm.teams" :key="t.id" class="score-row">
            <span>
              {{ t.token }}{{ t.name }}
              <span v-if="rmCurrent === t.id" class="tag live">行动中</span>
              <span v-if="rm.bankrupt?.[t.id]" class="tag spy">🏚️ 破产</span>
              <span v-else-if="rm.frozen[t.id]" class="tag warn">🚔 关押中</span>
              <span v-for="(it, k) in rm.items?.[t.id] || []" :key="k" :title="rmItemName(it)">{{ rmItemIcon(it) }}</span>
            </span>
            <span>
              <strong :style="{ color: rm.cash[t.id] < 0 ? 'var(--red)' : 'var(--gold)' }">💰 {{ rm.cash[t.id] }}</strong>
              <span class="muted"> · 在 {{ RICH_BOARD[rm.pos[t.id]].icon }}{{ RICH_BOARD[rm.pos[t.id]].name }}</span>
            </span>
          </div>
          <p v-if="rmBlockNames" class="muted">🚧 路障埋在：{{ rmBlockNames }}</p>
          <div class="panel">
            <h3>地产总览（1 级半价租 / 2 级全价 / 同色成套再翻倍）</h3>
            <div v-for="x in rmProps" :key="x.idx" class="score-row">
              <span>
                <span v-if="x.group" class="rm-groupdot" :style="{ background: x.group.color }" />
                {{ x.tile.icon }}{{ x.tile.name }}
                <span class="muted">价 {{ x.tile.price }} · 租 {{ richRent(x.tile.price || 0, x.owner?.level || 1, x.hasSet) }}</span>
              </span>
              <span v-if="x.owner" class="tag info">
                {{ rmToken(x.owner.teamId) }}{{ rmTeamName(x.owner.teamId) }}{{ x.owner.level >= RICH_MAX_LEVEL ? ' · 豪华店' : '' }}{{ x.hasSet ? ' · 🔗成套' : '' }}
              </span>
              <span v-else class="muted">无主</span>
            </div>
          </div>
          <div v-if="rmLog.length" class="panel">
            <h3>事件回放（最近 {{ rmLog.length }} 条）</h3>
            <p v-for="(l, i) in rmLog" :key="i" class="muted" style="margin-bottom:6px">{{ l }}</p>
          </div>
        </div>
        <div v-else class="empty-state">真实队伍+机器人合计至少 2 队即可「开局」。一个人测试：选 2 个机器人队直接开；正式玩建议先分队并揭晓分组，队长才能在手机上掷骰。</div>
      </section>

      <section v-show="activeTab === 'lastman'" id="lastman" class="card">
        <div class="section-head">
          <div>
            <h2>吃鸡淘汰赛</h2>
            <p class="muted">点成员切换淘汰/复活，剩 1 人自动成为冠军。</p>
          </div>
          <div class="section-actions">
            <button class="sm" @click="startLastman">开始</button>
            <button class="sm ghost" :disabled="stage?.type !== 'lastman'" @click="finishLastman">结算</button>
          </div>
        </div>
        <div v-if="lmAlive" class="grid">
          <p class="muted">剩 {{ stage?.payload.aliveCount }} 人</p>
          <div class="list">
            <span
              v-for="(alive, id) in lmAlive"
              :key="id"
              class="member clickable"
              :class="{ alive, out: !alive }"
              @click="alive ? eliminate(id as string) : revive(id as string)"
            >
              {{ memberAvatar(id as string) }}{{ memberName(id as string) }}
            </span>
          </div>
          <div v-if="stage?.payload.championId" class="banner">
            🏆 冠军：{{ memberName(stage.payload.championId) }}
            <button class="sm" @click="awardChampion(3)">冠军队 +3</button>
          </div>
        </div>
        <div v-else class="empty-state">尚未开始淘汰赛。</div>
      </section>

      <section v-show="activeTab === 'vote'" id="vote" class="card">
        <div class="section-head">
          <div>
            <h2>投票与揭晓</h2>
            <p class="muted">可全员投票，也可由卧底局自动带入本局候选人。</p>
          </div>
          <div class="section-actions">
            <button class="sm" @click="openVote">开投票</button>
            <button class="sm ghost" @click="revealCount">公布票数</button>
            <button class="sm danger" @click="revealSpy">揭晓内鬼</button>
          </div>
        </div>
        <div class="grid" style="margin-bottom:10px">
          <input v-model="voteQuestion" placeholder="选项投票题目（如：哪件事是假的？）" maxlength="60" />
          <div class="section-actions">
            <input v-model="voteOptionsText" placeholder="选项用 / 分隔（如：第一件/第二件/第三件）" style="flex:1 1 200px" />
            <button class="sm ghost" :disabled="!teams.length" @click="fillTeamsAsOptions">按队填入</button>
            <button class="sm" :disabled="voteOptionsText.split('/').filter(x => x.trim()).length < 2" @click="openOptionVote">开选项投票</button>
          </div>
        </div>
        <div v-if="voteTally && Object.keys(voteTally).length" class="grid">
          <div v-for="(n, id) in voteTally" :key="id" class="score-row">
            <span>{{ voteLabel(id as string) }} <strong>{{ n }} 票</strong></span>
            <button v-if="memberTeamId(id as string)" class="sm ghost" @click="awardMemberTeam(id as string, 1)">TA队 +1</button>
          </div>
        </div>
        <div v-else class="empty-state">暂无投票数据。</div>
        <p v-if="stage?.type === 'vote' && votePending.length" class="muted">
          未投票（{{ votePending.length }}）：{{ votePending.join('、') }}
        </p>
      </section>
    </div>

    <div class="split-grid">
      <section v-show="activeTab === 'score'" id="score" class="card">
        <div class="section-head">
          <div>
            <h2>积分</h2>
            <p class="muted">按队加减分，可常驻显示到玩家端。</p>
          </div>
          <button class="sm ghost" @click="toggleScoreboard(!room.overlays.scoreboard)">
            {{ room.overlays.scoreboard ? '隐藏积分榜' : '显示积分榜' }}
          </button>
        </div>
        <div v-if="teams.length" class="grid">
          <div class="section-actions">
            <label class="num-label">自定义分值 <input v-model.number="customDelta" type="number" min="1" max="100" /></label>
            <button class="sm ghost" :disabled="!scoreLog.length" @click="undoScore">↩ 撤销上一笔</button>
          </div>
          <div v-for="t in sortedTeams" :key="t.id" class="score-row">
            <span>{{ t.name }} <strong>{{ t.score }}</strong></span>
            <span class="score-actions">
              <button class="sm ghost" @click="adjust(t.id, 1, 1)">+1</button>
              <button class="sm ghost" @click="adjust(t.id, 2, 1)">+2</button>
              <button class="sm" @click="adjust(t.id, 1, 2)">+1×2</button>
              <button class="sm warning" @click="adjust(t.id, customDelta || 1, 1)">+{{ customDelta || 1 }}</button>
              <button class="sm danger" @click="adjust(t.id, -1, 1)">-1</button>
            </span>
          </div>
          <div v-if="scoreLog.length" class="panel">
            <h3>记分流水（最近 {{ scoreLog.length }} 笔）</h3>
            <div v-for="(l, i) in scoreLog" :key="i" class="score-row">
              <span>{{ teamName(l.teamId) }} <strong :style="{ color: l.delta >= 0 ? 'var(--grass)' : 'var(--red)' }">{{ l.delta >= 0 ? '+' : '' }}{{ l.delta }}</strong></span>
              <span class="muted">{{ formatTime(l.ts) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">分队后可以开始记分。</div>
      </section>

      <section v-show="activeTab === 'general'" id="general" class="card">
        <div class="section-head">
          <div>
            <h2>通用环节</h2>
            <p class="muted">规则卡、定格挑战和计数会全员同屏显示。</p>
          </div>
        </div>
        <div class="grid">
          <input v-model="ruleTitle" placeholder="标题" />
          <input v-model="ruleText" placeholder="规则或提示文案" />
          <div class="section-actions">
            <button class="sm" @click="pushRuleCard">推规则卡</button>
            <button class="sm ghost" @click="pushStandstill">定格挑战</button>
            <button class="sm ghost" @click="startCounter">开始计数</button>
            <button class="sm" :disabled="stage?.type !== 'counter'" @click="incCounter">计数 +1</button>
          </div>
          <div class="section-actions">
            <input v-model="buzzerTitle" placeholder="抢答标题（如：听前奏抢唱）" />
            <button class="sm" @click="startBuzzer">{{ stage?.type === 'buzzer' ? '重新抢答' : '开始抢答' }}</button>
          </div>
          <div class="section-actions">
            <select v-model="eqCategory">
              <option v-for="c in EMOJI_QUIZ_CATEGORIES" :key="c" :value="c">emoji 猜{{ c }}</option>
            </select>
            <button class="sm warning" @click="pushEmojiQuiz">{{ eqAnswer ? '下一题' : '出题并开抢答' }}</button>
            <span v-if="eqAnswer" class="tag info">答案：{{ eqAnswer }}（仅你可见）</span>
          </div>
          <div v-if="stage?.type === 'buzzer'" class="grid">
            <p class="muted">抢答顺序（{{ buzzes.length }} 人）：</p>
            <div v-for="(b, i) in buzzes" :key="b.playerId" class="score-row">
              <span>{{ i + 1 }}. {{ b.avatar }} {{ b.name }}<span v-if="i === 0" class="tag info">最快</span></span>
              <button v-if="memberTeamId(b.playerId)" class="sm ghost" @click="awardMemberTeam(b.playerId, 1)">TA队 +1</button>
            </div>
            <p v-if="!buzzes.length" class="muted">等待玩家拍下抢答键…</p>
          </div>
        </div>
      </section>
    </div>

    <section v-show="activeTab === 'manual'" id="manual" class="card">
      <div class="section-head">
        <div>
          <h2>线下游戏手册</h2>
          <p class="muted">{{ GAME_RULES.length }} 个不用写代码的游戏：选一个看带法，一键把玩家版规则推到全场手机。</p>
        </div>
        <span v-if="mbSelected" class="tag info">{{ mbSelected.category }}</span>
      </div>
      <div class="grid">
        <div class="section-actions">
          <button
            v-for="c in ['全部', ...GAME_CATEGORIES]"
            :key="c"
            class="sm"
            :class="{ ghost: mbCategory !== c }"
            @click="mbCategory = c"
          >{{ c }}</button>
        </div>
        <div class="list">
          <span
            v-for="x in mbGames"
            :key="x.id"
            class="member clickable"
            :class="{ alive: mbSelectedId === x.id }"
            @click="mbSelectedId = x.id"
          >{{ x.name }}</span>
        </div>
        <div v-if="mbSelected" class="panel">
          <div class="section-head">
            <h2 style="margin:0">{{ mbSelected.name }}</h2>
            <div class="section-actions">
              <button class="sm" @click="pushManualCard(false)">推规则卡给玩家</button>
              <button class="sm ghost" @click="pushManualCard(true)">推卡并开 {{ timerSec || 60 }}s 倒计时</button>
            </div>
          </div>
          <p class="muted">👥 {{ mbSelected.players }} · 🧰 道具：{{ mbSelected.props }}</p>
          <h3>主持人怎么带</h3>
          <p>{{ mbSelected.how }}</p>
          <h3>系统配套</h3>
          <p>{{ mbSelected.combo }}</p>
          <h3>玩家屏将显示</h3>
          <p class="muted">「{{ mbSelected.name }}：{{ mbSelected.playerText }}」</p>
        </div>
        <div v-else class="empty-state">点上面的游戏名查看玩法。</div>
      </div>
    </section>

    <section v-show="activeTab === 'punish'" id="punish" class="card">
      <div class="section-head">
        <div>
          <h2>😈 惩罚库</h2>
          <p class="muted">{{ PUNISHMENTS.length }} 条职场安全惩罚：输了的、被点名的，抽一个当场执行；也可以从清单里手选一条推送。</p>
        </div>
        <div class="section-actions">
          <button class="sm warning" @click="drawPunishment">🎲 随机抽一个</button>
          <button class="sm" :disabled="!punishment" @click="pushPunishment()">推上全场大屏</button>
        </div>
      </div>
      <div v-if="punishment" class="banner" style="margin-bottom:12px">😈 {{ punishment }}</div>
      <div class="grid">
        <div v-for="(x, i) in PUNISHMENTS" :key="i" class="score-row">
          <span :style="punishment === x ? 'color:var(--gold);font-weight:800' : ''">{{ i + 1 }}. {{ x }}</span>
          <button class="sm ghost" @click="punishment = x; pushPunishment()">推送</button>
        </div>
      </div>
    </section>

    <section v-show="activeTab === 'overlay'" id="overlay" class="card">
      <div class="section-head">
        <div>
          <h2>常驻 Overlay</h2>
          <p class="muted">公告和倒计时独立于主环节，适合现场提醒。</p>
        </div>
        <span class="tag">{{ room.overlays.announce ? '有公告' : '无公告' }} · {{ timerLabel }}</span>
      </div>
      <div class="split-grid">
        <div class="grid">
          <input v-model="announceText" placeholder="公告内容" maxlength="100" />
          <button class="sm" @click="pushAnnounce">{{ announceText ? '推送公告' : '清除公告' }}</button>
        </div>
        <div class="grid">
          <input v-model.number="timerSec" type="number" min="1" max="3600" />
          <div class="section-actions">
            <button class="sm" @click="startTimer">开始倒计时</button>
            <button v-if="room.overlays.timer?.paused" class="sm" @click="resumeTimer">继续</button>
            <button v-else class="sm ghost" @click="pauseTimer">暂停</button>
            <button class="sm ghost" @click="resetTimer">清除</button>
          </div>
        </div>
      </div>
    </section>

    <section v-show="activeTab === 'inbox'" id="inbox" class="card">
      <div class="section-head">
        <div>
          <h2>收件箱</h2>
          <p class="muted">开放上行通道后，玩家可以给主持人发消息。</p>
        </div>
        <span class="tag">{{ inboxMessages.length }} 条</span>
      </div>
      <div v-if="inboxMessages.length" class="grid">
        <div v-for="m in inboxMessages" :key="m.id" class="score-row inbox-message">
          <span><strong>{{ m.fromName }}</strong>：{{ m.text }}</span>
          <span class="muted">{{ m.stageContext || '现场' }} · {{ formatTime(m.ts) }}</span>
        </div>
      </div>
      <div v-else class="empty-state">暂无消息。</div>
    </section>
  </div>
</template>
