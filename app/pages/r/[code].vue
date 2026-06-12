<script setup lang="ts">
import { useRoom } from '../../composables/useRoom'
import { AVATAR_POOL } from '@shared/types'
import type { PlayerView } from '@shared/types'
import { RICH_BOARD, RICH_COLORS, RICH_MAX_LEVEL, RICH_ITEMS, RICH_BAIL_COST, richGroupOf, richRent } from '@shared/richman'
import type { RichItemKind } from '@shared/richman'

const route = useRoute()
const code = (route.params.code as string).toUpperCase()
const { connected, view, lastError, joined, kicked, connect, send } = useRoom()

const name = ref('')
const avatar = ref(AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)])
const passcode = ref('')
const phase = ref<'naming' | 'in'>('naming')

const STORE_KEY = `caoyuan:${code}`

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
let pulseTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const stagePulse = ref(false)
const notice = ref<{ text: string; tone: 'ok' | 'error' } | null>(null)

onMounted(() => {
  disguised.value = localStorage.getItem(DISGUISE_KEY) === '1'
  soundOn.value = localStorage.getItem(SOUND_KEY) !== '0'
  // iOS/Chrome 要求用户先交互才允许出声：首次触摸即解锁 AudioContext
  document.addEventListener('pointerdown', unlockAudio, { once: true })
  timer = setInterval(() => { now.value = Date.now() }, 250)
  connect(() => {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved) {
      send({ t: 'player:rejoin', code, clientId: saved })
    }
  })
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (pulseTimer) clearTimeout(pulseTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  if (tapTimer) clearTimeout(tapTimer)
  if (wheelTimer) clearTimeout(wheelTimer)
  if (confettiTimer) clearTimeout(confettiTimer)
  if (rmDiceTimer) clearInterval(rmDiceTimer)
  if (rmDiceStop) clearTimeout(rmDiceStop)
  if (rmStepTimer) clearInterval(rmStepTimer)
  if (rmStepDelay) clearTimeout(rmStepDelay)
  if (rmCardFallback) clearTimeout(rmCardFallback)
  if (rmCardHide) clearTimeout(rmCardHide)
  if (rmLandClear) clearTimeout(rmLandClear)
})

watch(joined, (j) => {
  if (j) {
    localStorage.setItem(STORE_KEY, j.clientId)
    phase.value = 'in'
  }
})

watch(kicked, (isKicked) => {
  if (isKicked) localStorage.removeItem(STORE_KEY)
})

watch(lastError, (e) => {
  if (!e) return
  showNotice(e.message, 'error')
  if (e.code === 'notfound' && localStorage.getItem(STORE_KEY)) {
    localStorage.removeItem(STORE_KEY)
    phase.value = 'naming'
  }
})

function doJoin() {
  const trimmedName = name.value.trim()
  if (!trimmedName) return
  name.value = trimmedName
  const clientId = localStorage.getItem(STORE_KEY) || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(STORE_KEY, clientId)
  send({ t: 'player:join', code, name: trimmedName, avatar: avatar.value, passcode: passcode.value || undefined, clientId })
}

const pv = computed(() => (view.value?.role === 'player' ? (view.value as PlayerView) : null))

const stageLabels: Record<string, string> = {
  draw: '抽签揭晓',
  undercover: '谁是卧底',
  charades: '你比我猜',
  vote: '投票',
  lastman: '吃鸡淘汰赛',
  richman: '大富翁',
  reveal: '揭晓',
  rulecard: '规则卡',
  counter: '计数挑战',
  standstill: '定格挑战',
}

const stageName = computed(() => {
  if (!pv.value) return '同步中'
  if (pv.value.waiting) return '等待主持人'
  return stageLabels[pv.value.stage?.type || ''] || '现场任务'
})

const stageSignature = computed(() => {
  if (!pv.value) return 'loading'
  if (pv.value.waiting) return 'waiting'
  return `${pv.value.stage?.type || 'none'}:${JSON.stringify(pv.value.stage?.content || {})}`
})

watch(stageSignature, (next, prev) => {
  if (!prev || next === prev || phase.value !== 'in') return
  triggerStageCue()
})

function triggerStageCue() {
  stagePulse.value = false
  if (pulseTimer) clearTimeout(pulseTimer)
  if (import.meta.client) {
    requestAnimationFrame(() => { stagePulse.value = true })
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    nav.vibrate?.([60, 40, 60])
    playCue()
  }
  pulseTimer = setTimeout(() => { stagePulse.value = false }, 760)
}

// 音效总开关（本机记忆，默认开）
const SOUND_KEY = `caoyuan:${code}:sound`
const soundOn = ref(true)
function toggleSound() {
  soundOn.value = !soundOn.value
  localStorage.setItem(SOUND_KEY, soundOn.value ? '1' : '0')
  if (soundOn.value) play('coinUp')
}

// 环节切换提示音（PRD §9.3：震动 + 提示音唤起注意）
let audioCtx: AudioContext | null = null
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ||= new Ctx()
    audioCtx.resume?.()
  } catch { /* 忽略 */ }
}
function playCue() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ||= new Ctx()
    if (audioCtx.state === 'suspended') return // 用户尚未交互，浏览器禁止出声
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, audioCtx.currentTime)
    osc.frequency.setValueAtTime(1175, audioCtx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.3)
  } catch { /* 不支持音频则静默 */ }
}

// —— 合成音效引擎：纯 WebAudio 振荡器，无音频文件 ——
function sfxTone(freq: number, durMs: number, delayMs = 0, type: OscillatorType = 'sine', vol = 0.09) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ||= new Ctx()
    if (audioCtx.state === 'suspended') return
    const t0 = audioCtx.currentTime + delayMs / 1000
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + durMs / 1000)
  } catch { /* 不支持音频则静默 */ }
}

const SFX = {
  dice() { for (let i = 0; i < 9; i++) sfxTone(160 + Math.random() * 260, 70, i * 125, 'square', 0.045) },
  step() { sfxTone(660 + Math.random() * 120, 55, 0, 'square', 0.05) },
  land() { sfxTone(180, 160, 0, 'sine', 0.14); sfxTone(120, 220, 30, 'sine', 0.12) },
  coinUp() { [523, 659, 784].forEach((f, i) => sfxTone(f, 130, i * 70, 'triangle', 0.09)) },
  coinDown() { [392, 311, 262].forEach((f, i) => sfxTone(f, 150, i * 85, 'sawtooth', 0.055)) },
  card() { sfxTone(740, 90, 0, 'sine', 0.08); sfxTone(1109, 110, 95, 'sine', 0.08); sfxTone(1480, 140, 190, 'sine', 0.07) },
  buy() { [523, 659, 784, 1047].forEach((f, i) => sfxTone(f, 160, i * 65, 'triangle', 0.085)) },
  jail() { [330, 262, 196].forEach((f, i) => sfxTone(f, 220, i * 160, 'sawtooth', 0.07)) },
  punish() { [220, 233, 220, 208].forEach((f, i) => sfxTone(f, 180, i * 120, 'sawtooth', 0.08)) },
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => sfxTone(f, 240, i * 110, 'triangle', 0.1)) },
}
function play(k: keyof typeof SFX) { if (soundOn.value) SFX[k]() }

function showNotice(text: string, tone: 'ok' | 'error' = 'ok') {
  notice.value = { text, tone }
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = null }, 1800)
}

const msgText = ref('')
function sendMsg() {
  const text = msgText.value.trim()
  if (!text || !pv.value) return
  send({ t: 'msg:send', text, stageContext: pv.value.stage?.type })
  msgText.value = ''
  showNotice('已发送给主持人')
}

function castVote(targetId: string) {
  if (!pv.value) return
  send({ t: 'vote:cast', targetId })
  showNotice('已提交投票')
}

// 防偷看：敏感内容（词卡/秘密身份）按住才显示，松手即隐藏；
// 所有人的卡背完全一致，邻座无法通过界面差异认出卧底/白板/内鬼
const peekWord = ref(false)
const peekSecret = ref(false)

// 内鬼伪装模式：连点自己头像 3 次切换。开启后身份面板按住显示的内容
// 和吃瓜群众完全一致（应对"把屏幕给我看"的查岗）。
// 手势只写在内鬼的秘密面板里；普通人连点无任何反应和提示，不会暴露机制。
const DISGUISE_KEY = `caoyuan:${code}:disguise`
const disguised = ref(false)
let tapCount = 0
let tapTimer: ReturnType<typeof setTimeout> | undefined
function onIdentityTap() {
  tapCount++
  if (tapTimer) clearTimeout(tapTimer)
  tapTimer = setTimeout(() => { tapCount = 0 }, 1000)
  if (tapCount >= 3) {
    tapCount = 0
    if (pv.value?.secret?.isSpy) {
      disguised.value = !disguised.value
      localStorage.setItem(DISGUISE_KEY, disguised.value ? '1' : '0')
    }
  }
}
// 面板是否显示内鬼真实内容：是内鬼且未开伪装
const showSpyContent = computed(() => !!pv.value?.secret?.isSpy && !disguised.value)

// 主持人改派秘密任务时只震动提醒，不弹任何可见提示（防邻座察觉"他有秘密推送"）
watch(() => pv.value?.secret?.task, (task, old) => {
  if (task && old !== undefined && task !== old) {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    nav.vibrate?.([50, 40, 50, 40, 50])
  }
})

// —— 彩带礼花：高光时刻（揭晓/冠军/转盘定格/猜中）全屏喷彩 ——
interface ConfettiPiece { key: number; left: number; delay: number; dur: number; color: string; size: number; spin: number }
const confetti = ref<ConfettiPiece[]>([])
let confettiSeq = 0
let confettiTimer: ReturnType<typeof setTimeout> | undefined
function fireConfetti(count = 70) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#ff9d2e', '#ffd23f', '#a3e635', '#38bdf8', '#f472b6', '#ef4444', '#fdf6e7']
  confetti.value = Array.from({ length: count }, () => ({
    key: confettiSeq++,
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    dur: 2.4 + Math.random() * 1.6,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 7 + Math.random() * 7,
    spin: (Math.random() < 0.5 ? -1 : 1) * (480 + Math.random() * 480),
  }))
  if (confettiTimer) clearTimeout(confettiTimer)
  confettiTimer = setTimeout(() => { confetti.value = [] }, 4800)
}

// 内鬼揭晓 → 全场喷彩
watch(() => pv.value?.stage?.type, (t, old) => {
  if (t === 'reveal' && old !== 'reveal') fireConfetti(90)
})
// 吃鸡冠军诞生 → 全场喷彩（冠军本人加量）
watch(() => (pv.value?.stage?.type === 'lastman' ? pv.value.stage.content.champion?.id : null), (id, old) => {
  if (id && !old) fireConfetti(id === pv.value?.me.id ? 130 : 80)
})
// 猜猜我是谁猜中 → 本人手机喷彩
watch(() => (pv.value?.stage?.type === 'whoami' ? pv.value.stage.content.meGuessed : false), (g, old) => {
  if (g && !old) fireConfetti(90)
})

// —— 疯狂故事组合 ——
const smWho = ref('')
const smWhere = ref('')
const smWhat = ref('')
function submitStory() {
  if (!smWho.value.trim() || !smWhere.value.trim() || !smWhat.value.trim()) return
  send({ t: 'storymix:submit', who: smWho.value.trim(), where: smWhere.value.trim(), what: smWhat.value.trim() })
  showNotice('已投稿，等待开奖')
}

// —— 点名转盘：全场按服务端下发的同一序列滚动，定格同一个人 ——
const wheelDisplay = ref<{ id: string; name: string; avatar: string } | null>(null)
const wheelDone = ref(false)
let wheelTimer: ReturnType<typeof setTimeout> | undefined
watch(() => (pv.value?.stage?.type === 'wheel' ? pv.value.stage.content.spinId : null), (spinId) => {
  if (wheelTimer) clearTimeout(wheelTimer)
  if (!spinId) { wheelDisplay.value = null; wheelDone.value = false; return }
  const content = pv.value!.stage!.content
  const order = (content.order || []) as { id: string; name: string; avatar: string }[]
  const winner = content.winner as { id: string; name: string; avatar: string }
  if (!order.length || !winner) return
  wheelDone.value = false
  let i = 0
  let delay = 70
  const tick = () => {
    wheelDisplay.value = order[i % order.length]
    i++
    delay = Math.min(420, delay * 1.09) // 逐步减速 ~3.5s
    if (delay >= 400) {
      wheelDisplay.value = winner
      wheelDone.value = true
      const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
      nav.vibrate?.(winner.id === pv.value?.me.id ? [300, 100, 300] : 80)
      playCue()
      fireConfetti(winner.id === pv.value?.me.id ? 120 : 60)
      return
    }
    wheelTimer = setTimeout(tick, delay)
  }
  tick()
})

// —— 大富翁 ——
const rmc = computed(() => (pv.value?.stage?.type === 'richman' ? pv.value.stage.content : null))
const rmCurrentTeam = computed(() => (rmc.value && !rmc.value.finished ? rmc.value.order[rmc.value.turnIdx] : null))
const rmMyTurn = computed(() => !!rmCurrentTeam.value && rmCurrentTeam.value === pv.value?.me.teamId)
const rmIsCaptain = computed(() => !!pv.value?.team?.isCaptain)
const rmPendingMine = computed(() =>
  !!rmc.value?.pending && rmc.value.pending.teamId === pv.value?.me.teamId)
const rmMyFrozen = computed(() => !!(rmMyTurn.value && rmc.value?.frozen?.[pv.value!.me.teamId!]))
const rmMyItems = computed<RichItemKind[]>(() =>
  (rmc.value?.items?.[pv.value?.me.teamId || ''] || []) as RichItemKind[])

function rmTeam(teamId: string | null) {
  return (rmc.value?.teams || []).find((t: { id: string }) => t.id === teamId) || { name: '?', token: '' }
}
const rmMyCash = computed(() => rmc.value?.cash?.[pv.value?.me.teamId || ''] ?? 0)
function rmItemIcon(kind: string) { return RICH_ITEMS[kind as RichItemKind]?.icon || '' }
function rmItemName(kind: string) { return RICH_ITEMS[kind as RichItemKind]?.name || '' }
function rmTeamColor(teamId: string) {
  const i = (rmc.value?.teams || []).findIndex((t: { id: string }) => t.id === teamId)
  return RICH_COLORS[Math.max(0, i) % RICH_COLORS.length]
}
function rmOwner(idx: number): { teamId: string; level: number } | undefined {
  return rmc.value?.owners?.[idx]
}
// 16 格映射到 5×5 外圈：上 5 → 右 3 → 下 5（右往左）→ 左 3（下往上）
function rmCellStyle(i: number) {
  let row: number, col: number
  if (i <= 4) { row = 1; col = i + 1 }
  else if (i <= 7) { row = i - 3; col = 5 }
  else if (i <= 12) { row = 5; col = 13 - i }
  else { row = 17 - i; col = 1 }
  const owner = rmOwner(i)
  return {
    gridRow: String(row),
    gridColumn: String(col),
    ...(owner ? { borderColor: rmTeamColor(owner.teamId) } : {}),
  }
}

function rmRoll() { send({ t: 'richman:roll' }) }
function rmDecide(accept: boolean) { send({ t: 'richman:decide', accept }) }
function rmBail() { send({ t: 'richman:bail' }) }

// —— 道具与格子点击 ——
// none = 点格子看详情；block = 放路障模式（点目标格）
const rmItemMode = ref<'none' | 'dice' | 'block'>('none')
const rmSelTile = ref<number | null>(null)
function rmUseDice(v: number) {
  send({ t: 'richman:item', kind: 'dice', value: v })
  rmItemMode.value = 'none'
}
function rmTileTap(i: number) {
  if (rmItemMode.value === 'block') {
    if (i === 0 || rmc.value?.blocks?.[i]) return
    send({ t: 'richman:item', kind: 'block', tileIdx: i })
    rmItemMode.value = 'none'
    return
  }
  rmSelTile.value = rmSelTile.value === i ? null : i
}
// 选中格子的详情（参考 itaylayzer/Monopoly 的地产卡：点格子看价格/租金/归属）
const rmTileInfo = computed(() => {
  const i = rmSelTile.value
  if (i == null || !rmc.value) return null
  const tile = RICH_BOARD[i]
  const own = rmOwner(i)
  const group = richGroupOf(i)
  const hasSet = !!own && !!group && group.tiles.every(ti => rmOwner(ti)?.teamId === own.teamId)
  return {
    tile, group, own, hasSet,
    rent: tile.price ? richRent(tile.price, own?.level || 1, hasSet) : 0,
    ownerName: own ? `${rmTeam(own.teamId).token}${rmTeam(own.teamId).name}` : '',
    blocked: !!rmc.value.blocks?.[i],
  }
})

// —— 全员竞猜点数 ——
const rmMyGuess = computed(() => rmc.value?.guesses?.[pv.value?.me.id || ''] ?? null)
function rmGuess(v: number) { send({ t: 'richman:guess', value: v }) }
// 开骰后：本人猜中 → 庆祝
watch(() => rmc.value?.lastGuess as { sum: number; correct: string[] } | null, (g: { sum: number; correct: string[] } | null) => {
  if (g?.correct?.includes(pv.value?.me.id || '')) {
    showNotice(`🔮 猜中 ${g.sum} 点！你的队 +1`)
    fireConfetti(45)
  }
})

// —— 骰子动画：rollId 变化时骰面快速翻滚 ~1.2s 再定格在服务端结果 ——
// 骰子渲染为带点数的立方体（借鉴 mine-monopoly 的实体骰子），不再是文字
const RM_DICE_MS = 1200 // 骰子滚动时长
const RM_STEP_MS = 320  // 棋子每格耗时（放慢，配走格音）
const rmDiceFaces = ref<number[]>([])
const rmRolling = ref(false)
let rmDiceTimer: ReturnType<typeof setInterval> | undefined
let rmDiceStop: ReturnType<typeof setTimeout> | undefined
// 骰面点位（3×3 宫格里哪些点亮）
const RM_PIPS: Record<number, number[]> = {
  1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
}
function rmPipOn(face: number, cell: number) { return RM_PIPS[face]?.includes(cell) || false }
// 重连/中途加入时棋盘上已有历史骰子/卡片：标记一下，避免当成新事件重播
let rmEnteredWithDice = false
let rmCardSeen = ''
watch(() => pv.value?.stage?.type === 'richman', (on: boolean, was: boolean) => {
  if (on && !was) {
    rmEnteredWithDice = !!rmc.value?.dice
    rmCardSeen = rmc.value?.card?.id || ''
    rmDiceFaces.value = (rmc.value?.dice?.values || []) as number[]
    rmItemMode.value = 'none'
    rmSelTile.value = null
    // 默认展开自己队的资产面板
    const myTeam = pv.value?.me.teamId
    rmSelTeam.value = myTeam && (rmc.value?.order || []).includes(myTeam) ? myTeam : null
  }
})
watch(() => rmc.value?.dice?.rollId as string | undefined, (rollId: string | undefined) => {
  if (rmDiceTimer) clearInterval(rmDiceTimer)
  if (rmDiceStop) clearTimeout(rmDiceStop)
  const dice = rmc.value?.dice
  if (!rollId || !dice) { rmRolling.value = false; rmDiceFaces.value = []; return }
  if (rmEnteredWithDice) { rmEnteredWithDice = false; return }
  rmRolling.value = true
  play('dice')
  const n = (dice.values as number[]).length
  rmDiceTimer = setInterval(() => {
    rmDiceFaces.value = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1)
  }, 90)
  rmDiceStop = setTimeout(() => {
    if (rmDiceTimer) clearInterval(rmDiceTimer)
    rmDiceFaces.value = [...(dice.values as number[])]
    rmRolling.value = false
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    nav.vibrate?.(60)
  }, RM_DICE_MS)
})
// 每队地产数（队伍条上显示 🏠n）
function rmPropCount(teamId: string) {
  return Object.values((rmc.value?.owners || {}) as Record<string, { teamId: string }>).filter(o => o.teamId === teamId).length
}

// —— 队伍资产面板：点队伍徽章查看（地产/租金/道具），默认看自己队 ——
const rmSelTeam = ref<string | null>(null)
const rmTeamInfo = computed(() => {
  const id = rmSelTeam.value
  if (!id || !rmc.value) return null
  const team = rmTeam(id)
  const owners = (rmc.value.owners || {}) as Record<string, { teamId: string; level: number }>
  const props = Object.entries(owners)
    .filter(([, o]) => o.teamId === id)
    .map(([idx, o]) => {
      const i = Number(idx)
      const tile = RICH_BOARD[i]
      const group = richGroupOf(i)
      const hasSet = !!group && group.tiles.every(ti => owners[ti]?.teamId === id)
      return {
        idx: i, icon: tile.icon, name: tile.name, level: o.level,
        groupColor: group?.color, hasSet,
        rent: richRent(tile.price || 0, o.level, hasSet),
        invested: (tile.price || 0) * o.level,
      }
    })
    .sort((a, b) => a.idx - b.idx)
  return {
    id, name: team.name, token: (team as { token?: string }).token || '',
    cash: rmc.value.cash?.[id] ?? 0,
    assets: props.reduce((s, p) => s + p.invested, 0),
    props,
    items: ((rmc.value.items?.[id] || []) as string[]),
    frozen: !!rmc.value.frozen?.[id],
    mine: id === pv.value?.me.teamId,
  }
})
function rmItemDesc(kind: string) { return RICH_ITEMS[kind as RichItemKind]?.desc || '' }

// —— 机会/惩罚卡：全屏翻卡展示（落格动画走完才亮出来）——
const rmCardShow = ref<null | { kind: string; title: string; text: string }>(null)
let rmPendingCard: { id: string; kind: string; title: string; text: string } | null = null
let rmCardFallback: ReturnType<typeof setTimeout> | undefined
let rmCardHide: ReturnType<typeof setTimeout> | undefined
function rmRevealCard() {
  if (!rmPendingCard) return
  if (rmCardFallback) clearTimeout(rmCardFallback)
  rmCardShow.value = rmPendingCard
  rmPendingCard = null
  play(rmCardShow.value.kind === 'punish' ? 'punish' : 'card')
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
  nav.vibrate?.([60, 50, 60])
  if (rmCardHide) clearTimeout(rmCardHide)
  rmCardHide = setTimeout(() => { rmCardShow.value = null }, 8000)
}
watch(() => rmc.value?.card?.id as string | undefined, (id: string | undefined) => {
  const card = rmc.value?.card
  if (!id || !card || id === rmCardSeen) return
  rmCardSeen = id
  rmPendingCard = card
  // 兜底：万一没有走格动画（重连错过），4 秒内也一定亮卡
  if (rmCardFallback) clearTimeout(rmCardFallback)
  rmCardFallback = setTimeout(rmRevealCard, 4000)
})

// —— 棋子逐格移动动画（参考 javascript-monopoly 的 timed-interval 走格）——
// rmAnimPos 是棋子的"显示位置"，落后于服务端真实位置逐格追赶
const rmAnimPos = ref<Record<string, number>>({})
const rmLandedTile = ref<number | null>(null) // 刚落定的格子：爆闪一下
let rmStepTimer: ReturnType<typeof setInterval> | undefined
let rmStepDelay: ReturnType<typeof setTimeout> | undefined
let rmLandClear: ReturnType<typeof setTimeout> | undefined
function rmTokensAt(idx: number) {
  return ((rmc.value?.teams || []) as { id: string; token: string }[])
    .filter(t => (rmAnimPos.value[t.id] ?? rmc.value.pos[t.id]) === idx)
}
function rmLandEffects(tile: number) {
  rmLandedTile.value = tile
  play('land')
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
  nav.vibrate?.(90)
  if (rmLandClear) clearTimeout(rmLandClear)
  rmLandClear = setTimeout(() => { rmLandedTile.value = null }, 1400)
  // 落定后再亮机会/惩罚卡，节奏：走格 → 落地砰 → 翻卡
  setTimeout(rmRevealCard, 350)
}
watch(() => (rmc.value ? JSON.stringify(rmc.value.pos) : null), (s: string | null) => {
  if (rmStepTimer) clearInterval(rmStepTimer)
  if (rmStepDelay) clearTimeout(rmStepDelay)
  if (!s) { rmAnimPos.value = {}; return }
  const pos = JSON.parse(s) as Record<string, number>
  const known = Object.keys(rmAnimPos.value).length > 0
  const changed = Object.keys(pos).filter(id => rmAnimPos.value[id] !== pos[id])
  // 首屏/重连/多队同变（重新开局）→ 直接对齐，不播动画
  if (!known || changed.length !== 1) { rmAnimPos.value = { ...pos }; return }
  const id = changed[0]
  const target = pos[id]
  const start = () => {
    rmStepTimer = setInterval(() => {
      const cur = rmAnimPos.value[id]
      if (cur === target) {
        if (rmStepTimer) clearInterval(rmStepTimer)
        rmLandEffects(target)
        return
      }
      rmAnimPos.value = { ...rmAnimPos.value, [id]: ((cur ?? 0) + 1) % RICH_BOARD.length }
      play('step')
    }, RM_STEP_MS)
  }
  // 配合骰子动画：先滚骰再起步走格
  rmStepDelay = setTimeout(start, rmRolling.value ? RM_DICE_MS + 80 : 150)
})

// —— 事件音效：金币进出（本队）/ 有人买地 / 本队进局子 ——
watch(() => rmc.value?.cash?.[pv.value?.me.teamId || ''] as number | undefined, (now: number | undefined, old: number | undefined) => {
  if (typeof now !== 'number' || typeof old !== 'number' || now === old) return
  // 等走格动画放完再响钱声
  const wait = rmRolling.value ? RM_DICE_MS + 6 * RM_STEP_MS : 0
  const k = now > old ? 'coinUp' : 'coinDown'
  setTimeout(() => play(k), wait)
})
watch(() => (rmc.value ? JSON.stringify(rmc.value.owners) : null), (s: string | null, old: string | null) => {
  if (s && old && s !== old) play('buy')
})
watch(() => !!rmc.value?.frozen?.[pv.value?.me.teamId || ''], (f: boolean, old: boolean) => {
  if (f && !old) play('jail')
})

// 结算 → 全场喷彩，冠军队成员加量
watch(() => rmc.value?.finished as boolean | undefined, (f: boolean | undefined, old: boolean | undefined) => {
  if (f && !old) {
    const champId = rmc.value?.ranking?.[0]?.id
    play('win')
    fireConfetti(champId && champId === pv.value?.me.teamId ? 130 : 80)
  }
})

function doBuzz() {
  send({ t: 'buzz' })
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
  nav.vibrate?.(80)
}

// 抢答队列（类型化，供模板渲染）
const buzzList = computed<{ playerId: string; name: string; avatar: string }[]>(() =>
  pv.value?.stage?.type === 'buzzer' ? (pv.value.stage.content.buzzes || []) : [])

// 我在抢答队列里的名次（0 = 未抢）
const myBuzzRank = computed(() => buzzList.value.findIndex(b => b.playerId === pv.value?.me.id) + 1)

const timerUrgent = computed(() => {
  const t = pv.value?.overlays?.timer
  if (!t || t.paused) return false
  return t.endsAt - now.value <= 10_000
})

// 倒计时归零：震动 + 提示音 + banner 变「时间到」
const timerRemain = computed(() => {
  const t = pv.value?.overlays?.timer
  if (!t) return null
  return remainSec(t.endsAt, t.paused, t.remaining)
})
watch(timerRemain, (s, old) => {
  if (s === 0 && typeof old === 'number' && old > 0) {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    nav.vibrate?.([200, 80, 200])
    playCue()
  }
})

const teamNameDraft = ref('')
watch(() => pv.value?.team?.name, (teamName) => {
  teamNameDraft.value = teamName || ''
}, { immediate: true })

function submitTeamName() {
  if (!pv.value?.team?.isCaptain || !pv.value.me.teamId || !teamNameDraft.value.trim()) return
  send({ t: 'team:setName', teamId: pv.value.me.teamId, name: teamNameDraft.value.trim() })
  showNotice('队名已提交')
}

// 队长移交：把掷骰/买地/改队名的权力交给队友（交出去后对方也能再交回来）
function transferCaptain(playerId: string, name: string) {
  if (!pv.value?.team?.isCaptain || !pv.value.me.teamId) return
  send({ t: 'team:setCaptain', teamId: pv.value.me.teamId, playerId })
  showNotice(`👑 队长已移交给 ${name}`)
}

function remainSec(endsAt: number, paused: boolean, remaining: number) {
  const ms = paused ? remaining : Math.max(0, endsAt - now.value)
  return Math.ceil(ms / 1000)
}
</script>

<template>
  <div v-if="kicked" class="center">
    <div class="stage-panel waiting-panel">
      <div>
        <div class="huge">🚪</div>
        <h1>你已被移出房间</h1>
        <p class="muted">如需重新加入，请联系主持人。</p>
      </div>
    </div>
  </div>

  <div v-else-if="phase === 'naming'" class="center">
    <div class="home-logo">
      <div class="huge">{{ avatar }}</div>
      <h1>加入燃团</h1>
      <p class="muted">房间 <span class="room-code">{{ code }}</span> · {{ connected ? '已连接' : '连接中…' }}</p>
    </div>
    <div class="card home-shell">
      <input v-model="name" placeholder="给自己起个名字" maxlength="12" @keyup.enter="doJoin" />
      <div>
        <h2>选个头像</h2>
        <div class="emoji-pick">
          <button v-for="e in AVATAR_POOL" :key="e" :class="{ on: avatar === e }" @click="avatar = e">{{ e }}</button>
        </div>
      </div>
      <input v-model="passcode" placeholder="入场口令（如无可留空）" @keyup.enter="doJoin" />
      <button class="full-width" :disabled="!name.trim()" @click="doJoin">进入</button>
      <p v-if="lastError" class="toast error">{{ lastError.message }}</p>
    </div>
  </div>

  <div v-else class="wrap">
    <div v-if="confetti.length" class="confetti-layer" aria-hidden="true">
      <span
        v-for="c in confetti"
        :key="c.key"
        class="confetti-piece"
        :style="{
          left: c.left + '%',
          width: c.size + 'px',
          height: c.size * 0.45 + 'px',
          background: c.color,
          animationDelay: c.delay + 's',
          animationDuration: c.dur + 's',
          '--spin': c.spin + 'deg',
        }"
      />
    </div>
    <div v-if="rmCardShow" class="rm-card-mask" @click="rmCardShow = null">
      <div class="rm-card-pop" :class="rmCardShow.kind">
        <div class="rm-card-title">{{ rmCardShow.title }}</div>
        <div class="rm-card-text">{{ rmCardShow.text }}</div>
        <p class="muted" style="margin:14px 0 0;font-size:12px">点任意处关闭</p>
      </div>
    </div>

    <div v-if="pv?.overlays" class="overlay-bar">
      <div v-if="pv.overlays.announce" class="banner">📢 {{ pv.overlays.announce.text }}</div>
      <div v-if="pv.overlays.timer" class="banner timer-banner" :class="{ urgent: timerUrgent || timerRemain === 0 }">
        <template v-if="timerRemain === 0">⏰ 时间到！</template>
        <template v-else>⏳ {{ timerRemain }}s<span v-if="pv.overlays.timer.paused" class="muted">（已暂停）</span></template>
      </div>
    </div>

    <div class="player-top">
      <div class="identity-card" @click="onIdentityTap">
        <span class="em">{{ pv?.me.avatar || avatar }}</span>
        <div>
          <div class="identity-name">{{ pv?.me.name || name || '同步身份中' }}</div>
          <div class="muted">{{ pv?.team?.name || stageName }}</div>
        </div>
      </div>
      <span style="display:inline-flex;gap:6px;align-items:center">
        <button class="sm ghost icon" :title="soundOn ? '关闭音效' : '开启音效'" @click="toggleSound">{{ soundOn ? '🔊' : '🔇' }}</button>
        <span class="pill" :class="connected ? 'live' : 'warn'">
          <span class="dot" :class="connected ? 'on' : 'off'" />{{ connected ? '在线' : '重连中' }}
        </span>
      </span>
    </div>

    <p v-if="notice" class="toast" :class="{ error: notice.tone === 'error' }">{{ notice.text }}</p>

    <div v-if="pv?.overlays?.scoreboard" class="card">
      <div class="section-head">
        <div>
          <h2>积分榜</h2>
          <p class="muted">当前队伍排名</p>
        </div>
      </div>
      <div v-for="(t, i) in pv.overlays.scoreboard.teams" :key="i" class="score-row">
        <span>{{ i + 1 }}. {{ t.name }}</span>
        <strong>{{ t.score }}</strong>
      </div>
    </div>

    <div v-if="!pv" class="stage-panel waiting-panel" :class="{ pulse: stagePulse }">
      <div>
        <div class="huge">🔄</div>
        <h1>正在同步身份</h1>
        <p class="muted">如果长时间没有变化，请刷新后重新加入。</p>
      </div>
    </div>

    <div v-else-if="pv.ended" class="stage-panel waiting-panel">
      <div>
        <div class="huge">🌅</div>
        <h1>本场活动已结束</h1>
        <p class="muted">感谢参与本场团建，回程注意安全！</p>
      </div>
    </div>

    <div v-else-if="pv.waiting" class="stage-panel waiting-panel" :class="{ pulse: stagePulse }">
      <div style="width:100%">
        <div class="stage-kicker"><span class="dot" :class="connected ? 'on' : 'off'" />待命中</div>
        <div class="huge">⏳</div>
        <h1 style="text-align:center">等待主持人</h1>
        <p class="muted" style="text-align:center">游戏开始时，这里会自动切换到你的任务。</p>
        <div v-if="pv.team" class="panel">
          <h2>🎴 {{ pv.team.name }}<span v-if="pv.team.isCaptain" class="tag info" style="margin-left:8px">👑 你是队长</span></h2>
          <div class="list">
            <span v-for="m in pv.team.members" :key="m.id" class="member">
              <span class="em">{{ m.avatar }}</span>{{ m.name }}
              <span v-if="m.isCaptain" class="tag info">👑</span>
              <button
                v-else-if="pv.team.isCaptain"
                class="sm ghost"
                title="把队长移交给TA"
                @click="transferCaptain(m.id, m.name)"
              >移交</button>
            </span>
          </div>
          <div v-if="pv.team.isCaptain" class="composer-form" style="margin-top:10px">
            <input v-model="teamNameDraft" maxlength="12" placeholder="队长可随时改队名" @keyup.enter="submitTeamName" />
            <button class="sm" :disabled="!teamNameDraft.trim()" @click="submitTeamName">保存</button>
          </div>
        </div>
        <div
          v-if="pv.team"
          class="panel secret-card"
          style="margin-top:12px"
          @pointerdown="peekSecret = true"
          @pointerup="peekSecret = false"
          @pointerleave="peekSecret = false"
          @pointercancel="peekSecret = false"
          @contextmenu.prevent
        >
          <template v-if="peekSecret">
            <template v-if="showSpyContent">
              <h2>🤫 你是内鬼</h2>
              <p>{{ pv.secret?.task || '潜伏到最后别被认出来' }}</p>
              <p class="muted">查岗反制：悄悄连点左上角你的头像 3 次，这块会伪装成“吃瓜群众”；再连点 3 次还原。</p>
            </template>
            <template v-else>
              <h2>🍉 你是吃瓜群众</h2>
              <p>没有特殊任务，留意身边谁是内鬼。</p>
            </template>
          </template>
          <template v-else>
            <h2>🔒 我的秘密身份</h2>
            <p class="muted">按住查看，松手隐藏 —— 每个人都有这块，看不出差别。</p>
          </template>
        </div>
      </div>
    </div>

    <template v-else-if="pv.stage">
      <div v-if="pv.stage.type === 'draw'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <div class="stage-kicker">抽签结果</div>
        <h1>你属于</h1>
        <div class="word-card">
          <div class="big word">{{ pv.team?.name }}</div>
        </div>
        <h2>队友</h2>
        <div class="list">
          <span v-for="m in pv.team?.members" :key="m.id" class="member">
            <span class="em">{{ m.avatar }}</span>{{ m.name }}
            <span v-if="m.isCaptain" class="tag info">👑</span>
            <button
              v-else-if="pv.team?.isCaptain"
              class="sm ghost"
              title="把队长移交给TA"
              @click="transferCaptain(m.id, m.name)"
            >移交</button>
          </span>
        </div>
        <div v-if="pv.team?.isCaptain" class="panel">
          <h2>队长任务：确认队名</h2>
          <div class="composer-form">
            <input v-model="teamNameDraft" maxlength="12" placeholder="输入本队队名" @keyup.enter="submitTeamName" />
            <button class="sm" @click="submitTeamName">保存</button>
          </div>
        </div>
        <div
          class="panel secret-card"
          @pointerdown="peekSecret = true"
          @pointerup="peekSecret = false"
          @pointerleave="peekSecret = false"
          @pointercancel="peekSecret = false"
          @contextmenu.prevent
        >
          <template v-if="peekSecret">
            <template v-if="showSpyContent">
              <h2>🤫 你是内鬼</h2>
              <p>{{ pv.secret?.task || '潜伏到最后别被认出来' }}</p>
              <p class="muted">查岗反制：悄悄连点左上角你的头像 3 次，这块会伪装成“吃瓜群众”；再连点 3 次还原。</p>
            </template>
            <template v-else>
              <h2>🍉 你是吃瓜群众</h2>
              <p>没有特殊任务，留意身边谁是内鬼。</p>
            </template>
          </template>
          <template v-else>
            <h2>🔒 我的秘密身份</h2>
            <p class="muted">按住查看，松手隐藏 —— 每个人都有这块，看不出差别。</p>
          </template>
        </div>
      </div>

      <div v-else-if="pv.stage.type === 'undercover'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <template v-if="pv.stage.content.notInGame">
          <div class="stage-kicker">旁观本轮</div>
          <div class="huge">👀</div>
          <h1>本轮你不参与</h1>
          <p class="muted">观察大家描述，等待下一轮任务。</p>
        </template>
        <template v-else>
          <div class="stage-kicker">谁是卧底 · 防偷看模式</div>
          <p v-if="pv.stage.content.out" class="toast error" style="text-align:center">💀 你已出局，本轮旁观</p>
          <h2>你的词</h2>
          <div
            class="word-card secret-card"
            @pointerdown="peekWord = true"
            @pointerup="peekWord = false"
            @pointerleave="peekWord = false"
            @pointercancel="peekWord = false"
            @contextmenu.prevent
          >
            <template v-if="peekWord">
              <div v-if="pv.stage.content.isBlank" class="big word">⬜ 白板</div>
              <div v-else class="big word">{{ pv.stage.content.myWord }}</div>
            </template>
            <div v-else class="card-back">
              <div class="huge">🎴</div>
              <p class="muted">按住偷看你的词 · 松手隐藏</p>
            </div>
          </div>
          <p class="muted">所有人的卡背一模一样，放心按。描述时别念出词本身；白板要装作自己有词。</p>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'charades'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <template v-if="pv.stage.content.role === 'actor'">
          <div class="stage-kicker">你比我猜 · 只有你能看到</div>
          <h2>比划这个词</h2>
          <div class="word-card">
            <div class="big" style="color:var(--amber)">{{ pv.stage.content.word }}</div>
          </div>
          <p class="muted">不能说出词语本身。</p>
        </template>
        <template v-else>
          <div class="stage-kicker">你比我猜</div>
          <div class="huge">👀</div>
          <h1 style="text-align:center">猜！</h1>
          <p class="muted" style="text-align:center">盯住比划者，抢答关键词。</p>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'lastman'" class="stage-panel stage-enter waiting-panel" :class="{ pulse: stagePulse }">
        <template v-if="pv.stage.content.champion">
          <div>
            <div class="stage-kicker">冠军揭晓</div>
            <div class="huge">🏆</div>
            <h1>冠军 {{ pv.stage.content.champion.avatar }} {{ pv.stage.content.champion.name }}</h1>
          </div>
        </template>
        <template v-else>
          <div>
            <div class="stage-kicker">吃鸡淘汰赛 · 全场剩 {{ pv.stage.content.aliveCount }} 人</div>
            <div class="huge">{{ pv.stage.content.alive ? '🟢' : '💀' }}</div>
            <h1>{{ pv.stage.content.alive ? '你仍在场上' : '你已淘汰' }}</h1>
            <p class="muted">{{ pv.stage.content.alive ? '苟住！活到最后就是吃鸡。' : '等待复活或下一轮。' }}</p>
          </div>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'storymix'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <div class="stage-kicker">疯狂故事组合 · 已收 {{ pv.stage.content.submittedCount }} 份</div>
        <div v-if="pv.stage.content.story" class="word-card" style="margin-bottom:14px">
          <div class="big word">{{ pv.stage.content.story.who }}<br />在{{ pv.stage.content.story.where }}<br />{{ pv.stage.content.story.what }}</div>
        </div>
        <template v-if="pv.stage.content.story">
          <p class="muted" style="text-align:center">主持人可能继续抽，你也可以修改投稿。</p>
        </template>
        <template v-else-if="pv.stage.content.submitted">
          <div class="huge">✅</div>
          <h1 style="text-align:center">已投稿</h1>
          <p class="muted" style="text-align:center">等主持人开奖；想改可以重新提交覆盖。</p>
        </template>
        <template v-else>
          <h2>写一组素材，系统会随机跨人拼成爆笑句子</h2>
        </template>
        <div class="grid">
          <input v-model="smWho" placeholder="人名（写个同事，如：王哥）" maxlength="20" />
          <input v-model="smWhere" placeholder="地点（如：火山口）" maxlength="20" />
          <input v-model="smWhat" placeholder="在做什么（如：跳广场舞）" maxlength="20" />
          <button :disabled="!smWho.trim() || !smWhere.trim() || !smWhat.trim()" @click="submitStory">
            {{ pv.stage.content.submitted ? '修改投稿' : '提交投稿' }}
          </button>
        </div>
      </div>

      <div v-else-if="pv.stage.type === 'wheel'" class="stage-panel stage-enter waiting-panel" :class="{ pulse: stagePulse }">
        <div>
          <div class="stage-kicker">{{ wheelDone ? '天选之子诞生！' : '命运转盘转动中…' }}</div>
          <template v-if="wheelDisplay">
            <div class="huge" :class="{ 'wheel-final': wheelDone }">{{ wheelDisplay.avatar }}</div>
            <h1 style="text-align:center">{{ wheelDisplay.name }}</h1>
            <p v-if="wheelDone && wheelDisplay.id === pv.me.id" class="big word" style="margin-top:6px">🎉 就是你！</p>
            <p v-else-if="wheelDone" class="muted" style="text-align:center">恭喜（还是默哀？）这位天选之子</p>
          </template>
        </div>
      </div>

      <div v-else-if="pv.stage.type === 'richman' && rmc" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <template v-if="rmc.finished">
          <div class="stage-kicker">大富翁 · 终局结算</div>
          <div class="huge">🏆</div>
          <h1 style="text-align:center">{{ rmc.ranking[0].token }} {{ rmc.ranking[0].name }} 夺冠</h1>
          <div class="panel">
            <div v-for="(r, i) in rmc.ranking" :key="r.id" class="score-row">
              <span>{{ i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.` }} {{ r.token }}{{ r.name }}</span>
              <span class="muted">💰{{ r.cash }} + 🏠{{ r.assets }} = <strong style="color:var(--gold)">{{ r.total }}</strong></span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="stage-kicker">大富翁 · 第 {{ rmc.round }} 圈</div>
          <div class="rm-turnbar" :style="{ borderColor: rmTeamColor(rmCurrentTeam || '') }">
            <template v-if="rmRolling">🎲 掷骰中…</template>
            <template v-else-if="rmMyTurn">{{ rmTeam(rmCurrentTeam).token }} 轮到你们队！{{ rmIsCaptain ? '队长就是你' : '盯紧队长' }}</template>
            <template v-else>等 {{ rmTeam(rmCurrentTeam).token }}{{ rmTeam(rmCurrentTeam).name }} 行动</template>
          </div>
          <p v-if="!rmRolling && rmc.lastEvent" class="rm-event" :class="rmc.lastEvent.tone">{{ rmc.lastEvent.text }}</p>
          <p v-if="rmItemMode === 'block'" class="toast">🚧 点棋盘上的格子放路障（起点不行）<button class="sm ghost" style="margin-left:8px" @click="rmItemMode = 'none'">取消</button></p>
          <div class="rm-stage">
          <div class="rm-board">
            <div
              v-for="(tile, i) in RICH_BOARD"
              :key="i"
              class="rm-tile"
              :class="['rm-t-' + tile.type, {
                owned: rmOwner(i),
                selected: rmSelTile === i,
                targetable: rmItemMode === 'block' && i !== 0 && !rmc.blocks?.[i],
                landed: rmLandedTile === i,
                here: rmTokensAt(i).some(tt => tt.id === rmCurrentTeam),
              }]"
              :style="rmCellStyle(i)"
              @click="rmTileTap(i)"
            >
              <span v-if="richGroupOf(i)" class="rm-stripe" :style="{ background: richGroupOf(i)?.color }" />
              <span class="rm-icon">{{ tile.icon }}</span>
              <span class="rm-name">{{ tile.name }}<template v-if="tile.price"> · {{ tile.price }}</template></span>
              <span v-if="rmOwner(i) && (rmOwner(i)?.level || 0) >= RICH_MAX_LEVEL" class="rm-lv">🏨</span>
              <span v-if="rmc.blocks?.[i]" class="rm-blockmark">🚧</span>
              <span v-if="rmTokensAt(i).length" class="rm-tokens">
                <span v-for="t in rmTokensAt(i)" :key="t.id + '@' + i" class="rm-token-hop">{{ t.token }}</span>
              </span>
            </div>
            <div class="rm-center">
              <div class="rm-center-title">🎲 燃团大富翁</div>
              <div class="rm-dice-row" :class="{ rolling: rmRolling }">
                <template v-if="rmDiceFaces.length">
                  <span v-for="(f, di) in rmDiceFaces" :key="di" class="dice-cube">
                    <span v-for="c in 9" :key="c" class="pip" :class="{ on: rmPipOn(f, c) }" />
                  </span>
                  <span v-if="rmDiceFaces.length === 2 && !rmRolling" class="rm-dice-sum">={{ rmDiceFaces[0] + rmDiceFaces[1] }}</span>
                </template>
                <span v-else class="rm-dice">🎲</span>
              </div>
              <p class="muted rm-turn">{{ rmMyTurn ? '轮到你们队！' : '点格子看行情' }}</p>
            </div>
          </div>
          </div>
          <div v-if="rmTileInfo" class="panel rm-tileinfo">
            <strong>{{ rmTileInfo.tile.icon }}{{ rmTileInfo.tile.name }}</strong>
            <span v-if="rmTileInfo.group" class="tag" :style="{ borderColor: rmTileInfo.group.color, color: rmTileInfo.group.color }">{{ rmTileInfo.group.name }}</span>
            <span v-if="rmTileInfo.tile.price" class="muted">
              价 {{ rmTileInfo.tile.price }} · 现租 {{ rmTileInfo.rent }}{{ rmTileInfo.hasSet ? '（成套×2）' : '' }}
              · {{ rmTileInfo.own ? `归 ${rmTileInfo.ownerName}${(rmTileInfo.own.level || 0) >= RICH_MAX_LEVEL ? '（豪华店）' : ''}` : '无主' }}
            </span>
            <span v-else class="muted">{{ rmTileInfo.tile.type === 'jail' ? `停一回合，保释 ${RICH_BAIL_COST} 金币` : '踩到见分晓' }}</span>
            <span v-if="rmTileInfo.blocked" class="tag warn">🚧 有路障</span>
          </div>
          <div class="list rm-cash">
            <span
              v-for="t in rmc.teams"
              :key="t.id"
              class="member clickable"
              :class="{ alive: rmSelTeam === t.id }"
              :style="{ borderColor: rmTeamColor(t.id) }"
              @click="rmSelTeam = rmSelTeam === t.id ? null : t.id"
            >
              {{ t.token }}{{ t.name }}
              <strong :style="{ color: rmc.cash[t.id] < 0 ? 'var(--red)' : 'var(--gold)' }">💰{{ rmc.cash[t.id] }}</strong>
              <span v-if="rmPropCount(t.id)" class="muted">🏠{{ rmPropCount(t.id) }}</span>
              <span v-for="(it, k) in rmc.items?.[t.id] || []" :key="k" :title="rmItemName(it)">{{ rmItemIcon(it) }}</span>
              <span v-if="rmc.frozen[t.id]" class="tag warn">🚔</span>
            </span>
          </div>

          <!-- 队伍资产面板：点队伍徽章切换 -->
          <div v-if="rmTeamInfo" class="panel rm-teaminfo">
            <div class="rm-teaminfo-head">
              <strong>{{ rmTeamInfo.token }}{{ rmTeamInfo.name }}{{ rmTeamInfo.mine ? '（我们队）' : '' }} 的资产</strong>
              <span>💰<strong style="color:var(--gold)">{{ rmTeamInfo.cash }}</strong> + 🏠<strong style="color:var(--gold)">{{ rmTeamInfo.assets }}</strong> = 总 {{ rmTeamInfo.cash + rmTeamInfo.assets }}</span>
            </div>
            <template v-if="rmTeamInfo.props.length">
              <div v-for="p in rmTeamInfo.props" :key="p.idx" class="score-row">
                <span>
                  <span v-if="p.groupColor" class="rm-groupdot" :style="{ background: p.groupColor }" />
                  {{ p.icon }}{{ p.name }}{{ p.level >= RICH_MAX_LEVEL ? ' 🏨豪华店' : '' }}
                  <span v-if="p.hasSet" class="tag info">🔗成套</span>
                </span>
                <span class="muted">过路费 {{ p.rent }}</span>
              </div>
            </template>
            <p v-else class="muted" style="margin:4px 0">还没有地产——踩到无主格，队长买它！</p>
            <div v-if="rmTeamInfo.items.length" class="grid" style="gap:4px;margin-top:6px">
              <p v-for="(it, k) in rmTeamInfo.items" :key="k" class="muted" style="margin:0">
                {{ rmItemIcon(it) }} <strong>{{ rmItemName(it) }}</strong>：{{ rmItemDesc(it) }}
              </p>
            </div>
            <p v-else class="muted" style="margin:6px 0 0">没有道具（踩 ❓机会格有机会捡到）</p>
            <p v-if="rmTeamInfo.frozen" class="muted" style="margin:6px 0 0">🚔 关押中：轮到时可花 {{ RICH_BAIL_COST }} 金币保释</p>
          </div>

          <!-- 队长操作区 -->
          <template v-if="rmIsCaptain && rmMyTurn && !rmc.pending">
            <template v-if="rmMyFrozen">
              <div class="grid" style="margin-top:10px">
                <button class="full-width" :disabled="rmMyCash < RICH_BAIL_COST" @click="rmBail">💰 保释出狱（{{ RICH_BAIL_COST }} 金币，立刻能掷）</button>
                <button class="ghost full-width" @click="rmRoll">😮‍💨 认栽，跳过这回合</button>
              </div>
            </template>
            <template v-else-if="rmItemMode === 'dice'">
              <p class="muted" style="text-align:center;margin-top:10px">🎮 遥控骰子：想走几步？</p>
              <div class="rm-dicepick">
                <button v-for="n in 6" :key="n" class="ghost" @click="rmUseDice(n)">{{ n }}</button>
              </div>
              <button class="ghost full-width" @click="rmItemMode = 'none'">取消</button>
            </template>
            <template v-else>
              <button class="full-width" @click="rmRoll">🎲 掷骰子</button>
              <div v-if="rmMyItems.length && rmItemMode === 'none'" class="section-actions" style="margin-top:8px;justify-content:center">
                <button v-if="rmMyItems.includes('dice')" class="sm ghost" @click="rmItemMode = 'dice'">🎮 遥控骰子</button>
                <button v-if="rmMyItems.includes('block')" class="sm ghost" @click="rmItemMode = 'block'">🚧 放路障</button>
                <span v-if="rmMyItems.includes('shield')" class="tag info">🛡️ 免租卡（被收租时自动生效）</span>
              </div>
            </template>
          </template>
          <div v-else-if="rmIsCaptain && rmPendingMine" class="grid" style="margin-top:10px">
            <button class="full-width" @click="rmDecide(true)">
              {{ rmc.pending.kind === 'buy' ? '买下' : '升级' }} {{ RICH_BOARD[rmc.pending.tileIdx].icon }}{{ RICH_BOARD[rmc.pending.tileIdx].name }}（{{ rmc.pending.cost }} 金币）
            </button>
            <button class="ghost full-width" @click="rmDecide(false)">不{{ rmc.pending.kind === 'buy' ? '买' : '升级' }}</button>
          </div>
          <p v-else-if="rmMyTurn" class="muted" style="text-align:center;margin-top:10px">
            {{ rmc.pending ? '队长正在纠结买不买…' : (rmc.frozen?.[pv.me.teamId || ''] ? '队长在决定保不保释…' : '等你们队的队长掷骰子') }}
          </p>

          <!-- 全员竞猜 -->
          <div class="panel rm-guess-panel">
            <h2>🔮 押点数</h2>
            <p class="muted">开骰前押两颗骰子的和，猜中你队 +1（每队每回合最多一次）</p>
            <div class="rm-guess">
              <button
                v-for="n in 11"
                :key="n"
                class="ghost"
                :class="{ on: rmMyGuess === n + 1 }"
                @click="rmGuess(n + 1)"
              >{{ n + 1 }}</button>
            </div>
            <p v-if="rmMyGuess" class="muted" style="margin:6px 0 0">你押了 <strong style="color:var(--gold)">{{ rmMyGuess }}</strong>，开骰前可以改</p>
          </div>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'whoami'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <template v-if="pv.stage.content.spectator">
          <div class="stage-kicker">猜猜我是谁 · 旁观全知</div>
          <p class="muted" style="text-align:center">你能看到所有人的牌——憋住别说出来，看他们猜！</p>
        </template>
        <template v-else-if="pv.stage.content.meGuessed">
          <div class="stage-kicker">猜猜我是谁 · 猜中啦</div>
          <div class="word-card">
            <div class="big word">🎉 {{ pv.stage.content.myWord }}</div>
          </div>
          <p class="muted" style="text-align:center">恭喜！你猜中了自己头上的词。</p>
        </template>
        <template v-else>
          <div class="stage-kicker">猜猜我是谁 · 你的词只有别人能看到</div>
          <div class="word-card">
            <div class="big">❓</div>
          </div>
          <p class="muted" style="text-align:center">
            轮到你时向大家提问，问题只能用「是 / 不是」回答（如"我是动物吗？""我能吃吗？"），猜中自己头上的词即获胜。
          </p>
        </template>
        <template v-if="!pv.stage.content.meGuessed">
          <h2>大家头上的词（憋住，别念出来！）</h2>
          <div class="list">
            <span v-for="o in pv.stage.content.others" :key="o.id" class="member" :class="{ out: o.guessed }">
              <span class="em">{{ o.avatar }}</span>{{ o.name }}
              <span class="tag info">{{ o.word }}</span>
              <span v-if="o.guessed" class="tag live">已猜中</span>
            </span>
          </div>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'buzzer'" class="stage-panel stage-enter waiting-panel" :class="{ pulse: stagePulse }">
        <div style="width:100%">
          <div class="stage-kicker">{{ pv.stage.content.title || '抢答' }}</div>
          <template v-if="myBuzzRank">
            <div class="huge">{{ myBuzzRank === 1 ? '🥇' : myBuzzRank === 2 ? '🥈' : myBuzzRank === 3 ? '🥉' : '✋' }}</div>
            <h1 style="text-align:center">你是第 {{ myBuzzRank }} 个</h1>
            <p class="muted" style="text-align:center">等主持人判定。</p>
          </template>
          <template v-else>
            <button class="buzz-btn" @click="doBuzz">🔔 抢答</button>
            <p class="muted" style="text-align:center">想到答案就拍下去！</p>
          </template>
          <div v-if="buzzList.length" class="panel">
            <h2>抢答顺序</h2>
            <div v-for="(b, i) in buzzList" :key="b.playerId" class="score-row">
              <span>{{ i + 1 }}. {{ b.avatar }} {{ b.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="pv.stage.type === 'vote'" class="stage-panel stage-enter" :class="{ pulse: stagePulse }">
        <template v-if="pv.stage.content.notInVote">
          <div class="stage-kicker">投票旁观</div>
          <div class="huge">👀</div>
          <h1 style="text-align:center">本轮你不投票</h1>
          <p class="muted" style="text-align:center">等待主持人公布结果。</p>
        </template>
        <template v-else-if="pv.stage.content.revealed === 'count'">
          <div class="stage-kicker">投票结果</div>
          <h2>得票</h2>
          <div v-for="c in pv.stage.content.candidates" :key="c.id" class="score-row">
            <span>{{ c.avatar }} {{ c.name }}</span>
            <strong>{{ pv.stage.content.tally[c.id] || 0 }}</strong>
          </div>
        </template>
        <template v-else-if="pv.stage.content.voted">
          <div class="stage-kicker">投票已提交</div>
          <div class="huge">✅</div>
          <h1 style="text-align:center">已投票</h1>
          <p class="muted" style="text-align:center">
            已投 {{ pv.stage.content.votedCount }}/{{ pv.stage.content.totalVoters }} 人，等待主持人公布结果（投票不可更改）。
          </p>
        </template>
        <template v-else>
          <div class="stage-kicker">匿名投票 · 已投 {{ pv.stage.content.votedCount }}/{{ pv.stage.content.totalVoters }}</div>
          <h2>{{ pv.stage.content.question || (pv.stage.content.isOptions ? '请投出你的一票' : '你觉得谁是内鬼？') }}</h2>
          <div class="vote-grid">
            <button v-for="c in pv.stage.content.candidates" :key="c.id" class="ghost vote-option" @click="castVote(c.id)">
              <span>{{ c.avatar }} {{ c.name }}</span>
              <span class="tag">投他</span>
            </button>
          </div>
        </template>
      </div>

      <div v-else-if="pv.stage.type === 'reveal'" class="stage-panel stage-enter waiting-panel" :class="{ pulse: stagePulse }">
        <div>
          <div class="stage-kicker">身份揭晓</div>
          <div class="huge">🕵️</div>
          <h1>内鬼是</h1>
          <div class="list" style="justify-content:center">
            <span v-for="s in pv.stage.content.spies" :key="s.id" class="member">
              <span class="em">{{ s.avatar }}</span>{{ s.name }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="stage-panel stage-enter waiting-panel" :class="{ pulse: stagePulse }">
        <div>
          <div class="stage-kicker">{{ stageName }}</div>
          <h1 v-if="pv.stage.content.title">{{ pv.stage.content.title }}</h1>
          <p v-if="pv.stage.content.text">{{ pv.stage.content.text }}</p>
          <div v-if="pv.stage.content.count != null" class="big word">{{ pv.stage.content.count }}</div>
        </div>
      </div>
    </template>

    <div v-if="pv?.uplinkOpen" class="composer">
      <h2>找主持人</h2>
      <div class="composer-form">
        <input v-model="msgText" placeholder="说点什么 / 举报内鬼…" maxlength="200" @keyup.enter="sendMsg" />
        <button class="sm" :disabled="!msgText.trim()" @click="sendMsg">发送</button>
      </div>
    </div>
  </div>
</template>
