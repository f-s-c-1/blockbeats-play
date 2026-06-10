// 内蒙主题词库（PRD 手册附录八）

export interface WordPair {
  id: string
  civilian: string // 平民词
  spy: string // 卧底词
}

export const UNDERCOVER_PAIRS: WordPair[] = [
  { id: 'wp1', civilian: '烤全羊', spy: '烤羊腿' },
  { id: 'wp2', civilian: '奶茶', spy: '奶酒' },
  { id: 'wp3', civilian: '蒙古包', spy: '帐篷' },
  { id: 'wp4', civilian: '骑马', spy: '骑驴' },
  { id: 'wp5', civilian: '草原', spy: '沙漠' },
  { id: 'wp6', civilian: '风力发电', spy: '水力发电' },
  { id: 'wp7', civilian: '哈达', spy: '围巾' },
  { id: 'wp8', civilian: '那达慕', spy: '运动会' },
  { id: 'wp9', civilian: '涮羊肉', spy: '火锅' },
  { id: 'wp10', civilian: '出差', spy: '团建' },
]

// 你比我猜 / 你画我猜 词库
export const CHARADES_WORDS: string[] = [
  '套马杆', '烤全羊', '骑马', '摔跤', '挤奶', '风车', '火山喷发', '举哈达', '敬酒', '蒙古舞', '射箭', '骆驼',
  '蒙古包', '马', '羊群', '风力发电机', '火山', '奶茶', '勒勒车', '敖包', '马头琴',
  '那达慕', '九十九泉', '敕勒川', '草原天路', '北京向西一步',
]

// 内鬼任务卡模板（PRD 第二节第 4 条）
export const SPY_TASKS: string[] = [
  '在每个队的合影里悄悄"乱入"成功 3 次不被发现',
  '神不知鬼不觉地让 3 个不同的人说出暗号词「套马杆」',
  '偷偷记下各队的队名由来 / 得分策略，上交主持人',
  '每次集合站最左，不被人识破',
  '悄悄模仿某人口头禅 5 次不被发现',
]
