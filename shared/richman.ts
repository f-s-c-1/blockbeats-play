// 大富翁 · 队伍制棋盘配置（前后端共享）
// 棋盘/卡池是静态常量，两端各自 import；动态对局状态全部在 stage payload 里由服务端权威维护

export type RichTileType = 'start' | 'prop' | 'chance' | 'gift' | 'tax' | 'punish' | 'jail'

export interface RichTile {
  type: RichTileType
  name: string
  icon: string
  price?: number // 仅 prop：买价 = 升级价
}

// 16 格环形棋盘，手机端渲染为 5×5 外圈（上 5 + 右 3 + 下 5 + 左 3）
export const RICH_BOARD: RichTile[] = [
  { type: 'start', name: '起点', icon: '🚩' },
  { type: 'prop', name: '奶茶店', icon: '🧋', price: 4 },
  { type: 'chance', name: '机会', icon: '❓' },
  { type: 'prop', name: '小卖部', icon: '🏪', price: 5 },
  { type: 'gift', name: '篝火宝箱', icon: '🎁' },
  { type: 'prop', name: '网吧', icon: '🖥️', price: 6 },
  { type: 'punish', name: '惩罚格', icon: '😈' },
  { type: 'prop', name: '火锅店', icon: '🍲', price: 7 },
  { type: 'tax', name: '缴税', icon: '💸' },
  { type: 'prop', name: 'KTV', icon: '🎤', price: 8 },
  { type: 'chance', name: '机会', icon: '❓' },
  { type: 'prop', name: '健身房', icon: '🏋️', price: 9 },
  { type: 'jail', name: '拘留所', icon: '🚔' },
  { type: 'prop', name: '电影院', icon: '🎬', price: 10 },
  { type: 'punish', name: '惩罚格', icon: '😈' },
  { type: 'prop', name: '游乐场', icon: '🎡', price: 12 },
]

export const RICH_START_CASH = 20 // 开局每队金币
export const RICH_PASS_BONUS = 2  // 经过/落地起点奖励
export const RICH_GIFT_BONUS = 3  // 宝箱格
export const RICH_TAX = 3         // 缴税格
export const RICH_MAX_LEVEL = 2   // 地产最高 2 级（豪华店）

// 过路费：1 级半价取整，2 级全价
export function richRent(price: number, level: number): number {
  return level >= RICH_MAX_LEVEL ? price : Math.ceil(price / 2)
}

// 队伍棋子（按分队顺序分配，与队伍卡顶色条一一对应）
export const RICH_TOKENS = ['🐺', '🦅', '🐎', '🦌', '🐂', '🐫', '🦬', '🏹']
export const RICH_COLORS = ['#ff9d2e', '#a3e635', '#ffd23f', '#38bdf8', '#f472b6', '#ef4444', '#c084fc', '#34d399']

export interface RichChance {
  text: string
  cash?: number // 直接加减金币
  kind?: 'collect1' | 'pay1' | 'freeze' | 'perProp' | 'taxProp'
}

export const RICH_CHANCES: RichChance[] = [
  { text: '团队气运爆棚，领 4 金币', cash: 4 },
  { text: '捡到锦鲤红包，领 3 金币', cash: 3 },
  { text: '中了大乐透！领 6 金币', cash: 6 },
  { text: '请全场喝奶茶，付 3 金币', cash: -3 },
  { text: '手机掉进火锅，捞出来修花 2 金币', cash: -2 },
  { text: '收物业费：其他每队付给你 1 金币', kind: 'collect1' },
  { text: '大方发红包：付给其他每队 1 金币', kind: 'pay1' },
  { text: '被草原寒风冻住！下回合跳过', kind: 'freeze' },
  { text: '地产大丰收：每拥有 1 处地产领 2 金币', kind: 'perProp' },
  { text: '税务稽查：每拥有 1 处地产缴 1 金币', kind: 'taxProp' },
]
