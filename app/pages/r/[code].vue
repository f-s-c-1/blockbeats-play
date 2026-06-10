<script setup lang="ts">
import { useRoom } from '../../composables/useRoom'
import { AVATAR_POOL } from '@shared/types'
import type { PlayerView } from '@shared/types'

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
  lastman: '拽尾巴',
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

// 环节切换提示音（PRD §9.3：震动 + 提示音唤起注意）
let audioCtx: AudioContext | null = null
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
// 和普通牧民完全一致（应对"把屏幕给我看"的查岗）。
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

const teamNameDraft = ref('')
watch(() => pv.value?.team?.name, (teamName) => {
  teamNameDraft.value = teamName || ''
}, { immediate: true })

function submitTeamName() {
  if (!pv.value?.team?.isCaptain || !pv.value.me.teamId || !teamNameDraft.value.trim()) return
  send({ t: 'team:setName', teamId: pv.value.me.teamId, name: teamNameDraft.value.trim() })
  showNotice('队名已提交')
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
      <h1>加入草原杯</h1>
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
    <div v-if="pv?.overlays" class="overlay-bar">
      <div v-if="pv.overlays.announce" class="banner">📢 {{ pv.overlays.announce.text }}</div>
      <div v-if="pv.overlays.timer" class="banner timer-banner" :class="{ urgent: timerUrgent }">
        ⏳ {{ remainSec(pv.overlays.timer.endsAt, pv.overlays.timer.paused, pv.overlays.timer.remaining) }}s
        <span v-if="pv.overlays.timer.paused" class="muted">（已暂停）</span>
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
      <span class="pill" :class="connected ? 'live' : 'warn'">
        <span class="dot" :class="connected ? 'on' : 'off'" />{{ connected ? '在线' : '重连中' }}
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
        <p class="muted">感谢参与草原杯，路上注意安全！</p>
      </div>
    </div>

    <div v-else-if="pv.waiting" class="stage-panel waiting-panel" :class="{ pulse: stagePulse }">
      <div style="width:100%">
        <div class="stage-kicker"><span class="dot" :class="connected ? 'on' : 'off'" />待命中</div>
        <div class="huge">⏳</div>
        <h1 style="text-align:center">等待主持人</h1>
        <p class="muted" style="text-align:center">游戏开始时，这里会自动切换到你的任务。</p>
        <div v-if="pv.team" class="panel">
          <h2>🎴 {{ pv.team.name }}<span v-if="pv.team.isCaptain" class="tag info" style="margin-left:8px">队长</span></h2>
          <div class="list">
            <span v-for="(m, i) in pv.team.members" :key="i" class="member">
              <span class="em">{{ m.avatar }}</span>{{ m.name }}
            </span>
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
              <h2>🤫 你是草原内鬼</h2>
              <p>{{ pv.secret?.task || '潜伏到最后别被认出来' }}</p>
              <p class="muted">查岗反制：悄悄连点左上角你的头像 3 次，这块会伪装成“普通牧民”；再连点 3 次还原。</p>
            </template>
            <template v-else>
              <h2>🐑 你是普通牧民</h2>
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
          <span v-for="(m, i) in pv.team?.members" :key="i" class="member">
            <span class="em">{{ m.avatar }}</span>{{ m.name }}
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
              <h2>🤫 你是草原内鬼</h2>
              <p>{{ pv.secret?.task || '潜伏到最后别被认出来' }}</p>
              <p class="muted">查岗反制：悄悄连点左上角你的头像 3 次，这块会伪装成“普通牧民”；再连点 3 次还原。</p>
            </template>
            <template v-else>
              <h2>🐑 你是普通牧民</h2>
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
            <div class="stage-kicker">拽尾巴 · 全场剩 {{ pv.stage.content.aliveCount }} 人</div>
            <div class="huge">{{ pv.stage.content.alive ? '🟢' : '💀' }}</div>
            <h1>{{ pv.stage.content.alive ? '你仍在场上' : '你已淘汰' }}</h1>
            <p class="muted">{{ pv.stage.content.alive ? '继续保护你的尾巴。' : '等待复活或下一轮。' }}</p>
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
            已投 {{ pv.stage.content.votedCount }}/{{ pv.stage.content.totalVoters }} 人，等待主持人公布结果。
          </p>
        </template>
        <template v-else>
          <div class="stage-kicker">匿名投票 · 已投 {{ pv.stage.content.votedCount }}/{{ pv.stage.content.totalVoters }}</div>
          <h2>你觉得谁是内鬼？</h2>
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
          <h1>草原内鬼是</h1>
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
