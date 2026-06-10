<script setup lang="ts">
import { useRoom } from '../composables/useRoom'
import type { AdminView } from '@shared/types'
import { UNDERCOVER_PAIRS, CHARADES_WORDS, SPY_TASKS, WORD_CATEGORIES, CHARADES_CATEGORIES } from '@shared/words'

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
  lastman: '拽尾巴',
  task: '任务',
  reveal: '内鬼揭晓',
  rulecard: '规则卡',
  counter: '计数挑战',
  standstill: '定格挑战',
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
    case 'lastman': return 'lastman'
    case 'vote':
    case 'reveal': return 'vote'
    case 'rulecard':
    case 'counter':
    case 'standstill': return 'general'
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

const navItems = [
  { id: 'members', label: '成员' },
  { id: 'draw', label: '抽签' },
  { id: 'undercover', label: '卧底' },
  { id: 'charades', label: '你比我猜' },
  { id: 'lastman', label: '拽尾巴' },
  { id: 'vote', label: '投票' },
  { id: 'score', label: '积分' },
  { id: 'general', label: '通用' },
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
    await navigator.clipboard?.writeText(joinLink.value)
    setCopyState('copied')
  } catch {
    setCopyState('failed')
  }
}

function openJoinPage() {
  if (joinLink.value) window.open(joinLink.value, '_blank', 'noopener,noreferrer')
}

// —— 分组 ——
const teamCount = ref(4)
function generate() { send({ t: 'draw:generate', teamCount: teamCount.value, balance: false }) }
function revealDraw() { send({ t: 'stage:set', stage: { type: 'draw', visibility: 'E', payload: {} } }) }
function setTeamName(teamId: string) {
  const current = teams.value.find(t => t.id === teamId)?.name || ''
  const name = prompt('输入队名', current)
  if (name?.trim()) send({ t: 'team:setName', teamId, name: name.trim() })
}

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

// —— 拽尾巴 ——
function startLastman() { send({ t: 'lastman:start' }) }
function eliminate(id: string) { send({ t: 'lastman:eliminate', targetId: id }) }
function revive(id: string) { send({ t: 'lastman:revive', targetId: id }) }
function finishLastman() { send({ t: 'lastman:finish' }) }

// —— 投票 ——
function openVote() { send({ t: 'vote:open' }) }
function revealCount() { send({ t: 'vote:revealCount' }) }
function revealSpy() { send({ t: 'vote:revealSpy' }) }

// —— 积分 ——
function adjust(teamId: string, delta: number, mult: 1 | 2) { send({ t: 'score:adjust', teamId, delta, multiplier: mult }) }
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

// —— 上行通道 ——
function toggleUplink(open: boolean) { send({ t: 'admin:toggleUplink', open }) }

// —— 治理 ——
function kick(id: string) { if (confirm('踢出该成员？')) send({ t: 'admin:kick', playerId: id }) }
function renamePlayer(id: string, currentName: string) {
  const newName = prompt('输入新名字', currentName)
  if (newName?.trim()) send({ t: 'admin:rename', playerId: id, newName: newName.trim() })
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
            <option :value="4">4 队</option>
            <option :value="5">5 队</option>
            <option :value="6">6 队</option>
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
            <div v-for="(w, id) in ucAssignment" :key="id" class="score-row">
              <span>{{ memberName(id) }}</span>
              <span v-if="!w" class="tag info">⬜ 白板</span>
              <span v-else class="tag" :class="{ spy: w === stage?.payload.spy }">{{ w }}</span>
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
    </div>

    <div class="split-grid">
      <section v-show="activeTab === 'lastman'" id="lastman" class="card">
        <div class="section-head">
          <div>
            <h2>拽尾巴淘汰赛</h2>
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
        <div v-if="voteTally && Object.keys(voteTally).length" class="grid">
          <div v-for="(n, id) in voteTally" :key="id" class="score-row">
            <span>{{ memberName(id as string) }}</span>
            <strong>{{ n }}</strong>
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
          <div v-for="t in sortedTeams" :key="t.id" class="score-row">
            <span>{{ t.name }} <strong>{{ t.score }}</strong></span>
            <span class="score-actions">
              <button class="sm ghost" @click="adjust(t.id, 1, 1)">+1</button>
              <button class="sm ghost" @click="adjust(t.id, 2, 1)">+2</button>
              <button class="sm" @click="adjust(t.id, 1, 2)">+1×2</button>
              <button class="sm danger" @click="adjust(t.id, -1, 1)">-1</button>
            </span>
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
          <div v-if="stage?.type === 'buzzer'" class="grid">
            <p class="muted">抢答顺序（{{ buzzes.length }} 人）：</p>
            <div v-for="(b, i) in buzzes" :key="b.playerId" class="score-row">
              <span>{{ i + 1 }}. {{ b.avatar }} {{ b.name }}</span>
              <span v-if="i === 0" class="tag info">最快</span>
            </div>
            <p v-if="!buzzes.length" class="muted">等待玩家拍下抢答键…</p>
          </div>
        </div>
      </section>
    </div>

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
