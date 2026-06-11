// 燃团 · 前后端共享类型（对应 PRD §4 状态机 + §7.16 事件契约）

export type Visibility = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type SecretRole = 'normal' | 'spy'

export type StageType =
  | 'lobby'
  | 'draw'
  | 'undercover'
  | 'charades'
  | 'vote'
  | 'lastman'
  | 'task'
  | 'reveal'
  | 'rulecard'
  | 'counter'
  | 'standstill' // 定格/木头人
  | 'buzzer' // 抢答（听前奏抢唱/车窗观察赛）
  | 'whoami' // 猜猜我是谁（头带游戏：自己的词只有别人能看到）
  | 'storymix' // 疯狂故事组合（全员投稿 人名/地点/在做什么，随机拼句开奖）
  | 'wheel' // 随机点名转盘（全员同步动画定格天选之子）

export interface Player {
  id: string
  name: string
  avatar: string // emoji
  teamId: string | null
  secretRole: SecretRole
  spyTask?: string
  online: boolean
  kicked?: boolean
}

export interface Team {
  id: string
  name: string
  captainId: string | null
  score: number
}

// 主环节状态（互斥，全场同一刻只一个）
export interface StageState {
  type: StageType
  visibility: Visibility
  payload: Record<string, any>
  startedAt: number
}

// 常驻 overlay（可叠加，独立于主环节）—— PRD §9.3
export interface Overlays {
  timer?: { endsAt: number; paused: boolean; remaining: number } | null
  announce?: { text: string } | null
  scoreboard?: boolean // true = 积分榜常驻显示
}

export interface RoomState {
  code: string
  phase: 'lobby' | 'running' | 'ended'
  currentStage: StageState | null
  overlays: Overlays
  members: Player[]
  teams: Team[]
  teamsRevealed: boolean // 抽签是否已揭晓；揭晓后玩家在任意环节都能看到本队成员
  scoreLog?: { teamId: string; delta: number; ts: number }[] // 记分流水（delta 为实际生效值，含翻倍）
  passcode?: string | null
  maxPlayers: number
  uplinkOpen: boolean
  createdAt: number
  updatedAt: number
}

// ───────── 客户端 → 服务端事件 ─────────
export type ClientEvent =
  | { t: 'room:create'; code?: string; adminName: string; passcode?: string; adminPass?: string; actionId: string }
  | { t: 'admin:rejoin'; code: string; adminToken: string; actionId: string }
  | { t: 'admin:login'; code: string; adminPass: string; actionId: string } // 换设备凭主持口令找回控制台
  | { t: 'player:join'; code: string; name: string; avatar?: string; passcode?: string; clientId: string; actionId: string }
  | { t: 'player:rejoin'; code: string; clientId: string; actionId: string }
  | { t: 'draw:generate'; teamCount: number; balance: boolean; actionId: string }
  | { t: 'spy:assign'; playerIds: string[]; tasks?: Record<string, string>; actionId: string }
  | { t: 'spy:task'; playerId: string; task: string; actionId: string } // 管理员单独给某内鬼改派秘密任务
  | { t: 'team:setName'; teamId: string; name: string; actionId: string }
  | { t: 'stage:set'; stage: { type: StageType; visibility: Visibility; payload: Record<string, any> }; actionId: string }
  | { t: 'stage:clear'; actionId: string }
  | { t: 'stage:action'; kind: string; targetId?: string; actionId: string }
  // 词对二选一：wordPairId（词库）或 custom（主持人手输）；blankCount = 白板（没有词的人）数
  | { t: 'undercover:push'; wordPairId?: string; custom?: { civilian: string; spy: string }; participantIds: string[]; spyWordCount: number; blankCount?: number; actionId: string }
  | { t: 'charades:push'; actorId: string; word: string; durationSec?: number; actionId: string }
  | { t: 'whoami:push'; participantIds: string[]; category?: string; actionId: string }
  | { t: 'storymix:start'; actionId: string }
  | { t: 'storymix:submit'; who: string; where: string; what: string; actionId: string }
  | { t: 'storymix:draw'; actionId: string }
  | { t: 'wheel:spin'; scope?: string; actionId: string } // scope: 'all' 或 teamId
  | { t: 'lastman:start'; participantIds?: string[]; actionId: string }
  | { t: 'lastman:eliminate'; targetId: string; actionId: string }
  | { t: 'lastman:revive'; targetId: string; actionId: string }
  | { t: 'lastman:finish'; actionId: string }
  | { t: 'buzz'; actionId: string }
  // 二选一：candidateIds 投人（默认全员）；options 投自定义选项（真真假假/最佳广告等）
  | { t: 'vote:open'; candidateIds?: string[]; options?: string[]; question?: string; actionId: string }
  | { t: 'vote:cast'; targetId: string; actionId: string }
  | { t: 'vote:revealCount'; actionId: string }
  | { t: 'vote:revealSpy'; actionId: string }
  | { t: 'score:adjust'; teamId: string; delta: number; multiplier?: 1 | 2; actionId: string }
  | { t: 'score:undo'; actionId: string } // 撤销最近一笔记分
  | { t: 'overlay:timer'; op: 'start' | 'pause' | 'resume' | 'reset'; durationSec?: number; actionId: string }
  | { t: 'room:end'; actionId: string }
  | { t: 'overlay:announce'; text: string | null; actionId: string }
  | { t: 'overlay:scoreboard'; on: boolean; actionId: string }
  | { t: 'admin:toggleUplink'; open: boolean; actionId: string }
  | { t: 'admin:kick'; playerId: string; actionId: string }
  | { t: 'admin:rename'; playerId: string; newName: string; actionId: string }
  | { t: 'msg:send'; text: string; stageContext?: string; actionId: string }
  | { t: 'ping'; actionId?: string } // 心跳保活，连接层处理

// ───────── 服务端 → 客户端事件 ─────────
export interface AdminInbox {
  messages: { id: string; fromPlayerId: string; fromName: string; teamId: string | null; text: string; ts: number; stageContext?: string }[]
}

// 参与者视图（按连接裁剪后的可见内容）
export interface PlayerView {
  role: 'player'
  me: { id: string; name: string; avatar: string; teamId: string | null }
  waiting: boolean // true = 等待页
  ended?: boolean // 房间已结束
  stage: null | {
    type: StageType
    visibility: Visibility
    content: Record<string, any> // 已裁剪：只含该 player 该看的
  }
  overlays: {
    timer?: { endsAt: number; paused: boolean; remaining: number } | null
    announce?: { text: string } | null
    scoreboard?: { teams: { name: string; score: number }[] } | null
  }
  uplinkOpen: boolean
  team?: { id: string; name: string; isCaptain: boolean; members: { name: string; avatar: string }[] }
  secret?: { isSpy: boolean; task?: string }
}

// 管理员视图（完整上帝视角 = RoomState + 派生信息 + 收件箱）
export interface AdminView {
  role: 'admin'
  room: RoomState
  inbox: AdminInbox
  adminToken?: string
}

export type ServerEvent =
  | ({ t: 'room:state' } & (PlayerView | AdminView))
  | { t: 'joined'; clientId: string; playerId: string }
  | { t: 'created'; code: string; adminToken: string }
  | { t: 'kicked' }
  | { t: 'pong' }
  | { t: 'error'; code: string; message: string }

// 草原主题 emoji 池（PRD §7.2）
export const AVATAR_POOL = ['🐺', '🦌', '🐎', '🐑', '🦅', '🐫', '🌟', '🔥', '⛺', '🏹', '🍶', '🎪', '🌾', '🐂', '🦬', '🪕']

// 队名备选
export const TEAM_NAME_POOL = ['王炸队', '卷王突击队', '气氛组', '夺冠预定队', '嘎嘎乱杀队', '躺赢小分队', '苍狼队', '奶茶突击队']
