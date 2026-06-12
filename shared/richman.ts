// 大富翁 · 队伍制棋盘配置（前后端共享）
// 棋盘/卡池/道具是静态常量，两端各自 import；动态对局状态全部在 stage payload 里由服务端权威维护

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

// 同色成套：集齐一组两块地，组内过路费翻倍
export interface RichGroup { name: string; color: string; tiles: number[] }
export const RICH_GROUPS: RichGroup[] = [
  { name: '小吃街', color: '#f472b6', tiles: [1, 3] },
  { name: '不夜城', color: '#a3e635', tiles: [5, 7] },
  { name: '欢唱里', color: '#38bdf8', tiles: [9, 11] },
  { name: '游乐园', color: '#ffd23f', tiles: [13, 15] },
]
export function richGroupOf(tileIdx: number): RichGroup | undefined {
  return RICH_GROUPS.find(x => x.tiles.includes(tileIdx))
}

export const RICH_START_CASH = 20 // 开局每队金币
export const RICH_PASS_BONUS = 2  // 经过/落地起点奖励
export const RICH_GIFT_BONUS = 3  // 宝箱格
export const RICH_TAX = 3         // 缴税格
export const RICH_MAX_LEVEL = 2   // 地产最高 2 级（豪华店）
export const RICH_BAIL_COST = 2   // 拘留所保释费
export const RICH_GUESS_BONUS = 1 // 猜中骰子点数的队伍奖励（每队每回合最多一次）
export const RICH_MAX_ITEMS = 2   // 每队道具上限，超出折现
export const RICH_DOUBLE_JAIL = 3 // 连掷 N 次对子直接进拘留所

// 过路费：1 级半价取整、2 级全价；同组成套再翻倍
export function richRent(price: number, level: number, hasSet = false): number {
  const base = level >= RICH_MAX_LEVEL ? price : Math.ceil(price / 2)
  return hasSet ? base * 2 : base
}

// 道具（大宇式互坑三件套）
export type RichItemKind = 'dice' | 'block' | 'shield'
export const RICH_ITEMS: Record<RichItemKind, { name: string; icon: string; desc: string }> = {
  dice: { name: '遥控骰子', icon: '🎮', desc: '本回合不掷骰，直接选 1-6 点走' },
  block: { name: '路障', icon: '🚧', desc: '放在任意格（起点除外），撞上的队伍当场停下' },
  shield: { name: '免租卡', icon: '🛡️', desc: '下次要付过路费时自动免单' },
}

// 队伍棋子（按分队顺序分配，与队伍卡顶色条一一对应）
export const RICH_TOKENS = ['🐺', '🦅', '🐎', '🦌', '🐂', '🐫', '🦬', '🏹']
export const RICH_COLORS = ['#ff9d2e', '#a3e635', '#ffd23f', '#38bdf8', '#f472b6', '#ef4444', '#c084fc', '#34d399']

export interface RichChance {
  text: string
  cash?: number // 直接加减金币
  kind?: 'collect1' | 'pay1' | 'freeze' | 'perProp' | 'taxProp' | 'robRich' | 'almsPoor'
    | 'item_dice' | 'item_block' | 'item_shield'
}

// 机会卡池：服务端整副洗牌后依次抽（抽完重洗），同一轮内不会重复
export const RICH_CHANCES: RichChance[] = [
  { text: '团队气运爆棚，领 4 金币', cash: 4 },
  { text: '捡到锦鲤红包，领 3 金币', cash: 3 },
  { text: '中了大乐透！领 6 金币', cash: 6 },
  { text: '股票涨停！领 5 金币', cash: 5 },
  { text: '年终奖到账！领 5 金币', cash: 5 },
  { text: '团建报销批下来了，领 3 金币', cash: 3 },
  { text: '捡瓶子卖了 1 金币，运气一般般', cash: 1 },
  { text: '请全场喝奶茶，付 3 金币', cash: -3 },
  { text: '手机掉进火锅，捞出来修花 2 金币', cash: -2 },
  { text: '股票跌停！付 4 金币', cash: -4 },
  { text: '手机碎屏，换屏花 3 金币', cash: -3 },
  { text: '深夜路边摊撸串，花 1 金币', cash: -1 },
  { text: '收物业费：其他每队付给你 1 金币', kind: 'collect1' },
  { text: '大方发红包：付给其他每队 1 金币', kind: 'pay1' },
  { text: '打劫首富！从最有钱的队抢 2 金币', kind: 'robRich' },
  { text: '扶贫献爱心：给最穷的队 2 金币', kind: 'almsPoor' },
  { text: '被草原寒风冻住！下回合跳过', kind: 'freeze' },
  { text: '地产大丰收：每拥有 1 处地产领 2 金币', kind: 'perProp' },
  { text: '税务稽查：每拥有 1 处地产缴 1 金币', kind: 'taxProp' },
  { text: '路边捡到 🎮 遥控骰子！', kind: 'item_dice' },
  { text: '又摸到一个 🎮 遥控骰子！', kind: 'item_dice' },
  { text: '工地顺来一个 🚧 路障！', kind: 'item_block' },
  { text: '又顺来一个 🚧 路障！', kind: 'item_block' },
  { text: '物业送你 🛡️ 免租卡！', kind: 'item_shield' },
]
