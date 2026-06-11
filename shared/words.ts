// 词库（PRD 手册附录八扩充版）：按分类组织，管理端可筛选

export const WORD_CATEGORIES = ['内蒙', '通用', '食物', '职场', '影视'] as const
export type WordCategory = (typeof WORD_CATEGORIES)[number]

export interface WordPair {
  id: string
  civilian: string // 平民词
  spy: string // 卧底词
  category: WordCategory
}

// 注意：wp1-wp10 的 id 被冒烟脚本引用，保持不变
export const UNDERCOVER_PAIRS: WordPair[] = [
  // —— 内蒙 ——
  { id: 'wp1', civilian: '烤全羊', spy: '烤羊腿', category: '内蒙' },
  { id: 'wp2', civilian: '奶茶', spy: '奶酒', category: '内蒙' },
  { id: 'wp3', civilian: '蒙古包', spy: '帐篷', category: '内蒙' },
  { id: 'wp4', civilian: '骑马', spy: '骑驴', category: '内蒙' },
  { id: 'wp5', civilian: '草原', spy: '沙漠', category: '内蒙' },
  { id: 'wp6', civilian: '风力发电', spy: '水力发电', category: '内蒙' },
  { id: 'wp7', civilian: '哈达', spy: '围巾', category: '内蒙' },
  { id: 'wp8', civilian: '那达慕', spy: '运动会', category: '内蒙' },
  { id: 'wp9', civilian: '涮羊肉', spy: '火锅', category: '内蒙' },
  { id: 'wp10', civilian: '出差', spy: '团建', category: '内蒙' },
  { id: 'nm11', civilian: '马头琴', spy: '二胡', category: '内蒙' },
  { id: 'nm12', civilian: '摔跤', spy: '柔道', category: '内蒙' },
  { id: 'nm13', civilian: '射箭', spy: '飞镖', category: '内蒙' },
  { id: 'nm14', civilian: '马奶酒', spy: '酸奶', category: '内蒙' },
  { id: 'nm15', civilian: '牧民', spy: '农民', category: '内蒙' },
  { id: 'nm16', civilian: '敖包', spy: '烽火台', category: '内蒙' },
  { id: 'nm17', civilian: '草原天路', spy: '盘山公路', category: '内蒙' },
  { id: 'nm18', civilian: '勒勒车', spy: '牛车', category: '内蒙' },

  // —— 通用 ——
  { id: 'gn1', civilian: '牙刷', spy: '牙膏', category: '通用' },
  { id: 'gn2', civilian: '眼镜', spy: '隐形眼镜', category: '通用' },
  { id: 'gn3', civilian: '雨伞', spy: '雨衣', category: '通用' },
  { id: 'gn4', civilian: '枕头', spy: '抱枕', category: '通用' },
  { id: 'gn5', civilian: '电梯', spy: '扶梯', category: '通用' },
  { id: 'gn6', civilian: '快递', spy: '外卖', category: '通用' },
  { id: 'gn7', civilian: '微信', spy: 'QQ', category: '通用' },
  { id: 'gn8', civilian: '高铁', spy: '动车', category: '通用' },
  { id: 'gn9', civilian: '飞机', spy: '直升机', category: '通用' },
  { id: 'gn10', civilian: '出租车', spy: '网约车', category: '通用' },
  { id: 'gn11', civilian: '共享单车', spy: '电动车', category: '通用' },
  { id: 'gn12', civilian: '酒店', spy: '民宿', category: '通用' },
  { id: 'gn13', civilian: '钢琴', spy: '电子琴', category: '通用' },
  { id: 'gn14', civilian: '吉他', spy: '尤克里里', category: '通用' },
  { id: 'gn15', civilian: '篮球', spy: '排球', category: '通用' },
  { id: 'gn16', civilian: '足球', spy: '橄榄球', category: '通用' },
  { id: 'gn17', civilian: '跑步', spy: '快走', category: '通用' },
  { id: 'gn18', civilian: '游泳', spy: '潜水', category: '通用' },
  { id: 'gn19', civilian: '理发店', spy: '美容院', category: '通用' },
  { id: 'gn20', civilian: '小学', spy: '幼儿园', category: '通用' },

  // —— 食物 ——
  { id: 'fd1', civilian: '包子', spy: '饺子', category: '食物' },
  { id: 'fd2', civilian: '馒头', spy: '花卷', category: '食物' },
  { id: 'fd3', civilian: '豆浆', spy: '豆腐脑', category: '食物' },
  { id: 'fd4', civilian: '油条', spy: '麻花', category: '食物' },
  { id: 'fd5', civilian: '米饭', spy: '炒饭', category: '食物' },
  { id: 'fd6', civilian: '面条', spy: '米线', category: '食物' },
  { id: 'fd7', civilian: '火锅', spy: '麻辣烫', category: '食物' },
  { id: 'fd8', civilian: '烧烤', spy: '铁板烧', category: '食物' },
  { id: 'fd9', civilian: '披萨', spy: '馅饼', category: '食物' },
  { id: 'fd10', civilian: '汉堡', spy: '肉夹馍', category: '食物' },
  { id: 'fd11', civilian: '寿司', spy: '饭团', category: '食物' },
  { id: 'fd12', civilian: '蛋糕', spy: '面包', category: '食物' },
  { id: 'fd13', civilian: '冰淇淋', spy: '雪糕', category: '食物' },
  { id: 'fd14', civilian: '可乐', spy: '雪碧', category: '食物' },
  { id: 'fd15', civilian: '咖啡', spy: '奶茶', category: '食物' },
  { id: 'fd16', civilian: '西瓜', spy: '哈密瓜', category: '食物' },
  { id: 'fd17', civilian: '葡萄', spy: '提子', category: '食物' },
  { id: 'fd18', civilian: '橘子', spy: '橙子', category: '食物' },
  { id: 'fd19', civilian: '草莓', spy: '樱桃', category: '食物' },
  { id: 'fd20', civilian: '巧克力', spy: '糖果', category: '食物' },

  // —— 职场 ——
  { id: 'wk1', civilian: '加班', spy: '值班', category: '职场' },
  { id: 'wk2', civilian: '年终奖', spy: '提成', category: '职场' },
  { id: 'wk3', civilian: '开会', spy: '培训', category: '职场' },
  { id: 'wk4', civilian: '周报', spy: '日报', category: '职场' },
  { id: 'wk5', civilian: '裁员', spy: '辞职', category: '职场' },
  { id: 'wk6', civilian: '涨工资', spy: '发奖金', category: '职场' },
  { id: 'wk7', civilian: '老板', spy: '领导', category: '职场' },
  { id: 'wk8', civilian: '同事', spy: '室友', category: '职场' },
  { id: 'wk9', civilian: '实习生', spy: '应届生', category: '职场' },
  { id: 'wk10', civilian: '钉钉', spy: '企业微信', category: '职场' },
  { id: 'wk11', civilian: 'PPT', spy: 'Word', category: '职场' },
  { id: 'wk12', civilian: '键盘', spy: '鼠标', category: '职场' },
  { id: 'wk13', civilian: '笔记本电脑', spy: '平板', category: '职场' },
  { id: 'wk14', civilian: '打卡', spy: '签到', category: '职场' },
  { id: 'wk15', civilian: '食堂', spy: '外卖', category: '职场' },
  { id: 'wk16', civilian: '工位', spy: '格子间', category: '职场' },
  { id: 'wk17', civilian: '团建', spy: '聚餐', category: '职场' },
  { id: 'wk18', civilian: '面试', spy: '面谈', category: '职场' },
  { id: 'wk19', civilian: 'KPI', spy: 'OKR', category: '职场' },
  { id: 'wk20', civilian: '请假', spy: '调休', category: '职场' },

  // —— 影视 ——
  { id: 'mv1', civilian: '西游记', spy: '封神榜', category: '影视' },
  { id: 'mv2', civilian: '孙悟空', spy: '二郎神', category: '影视' },
  { id: 'mv3', civilian: '哈利波特', spy: '魔戒', category: '影视' },
  { id: 'mv4', civilian: '蜘蛛侠', spy: '蝙蝠侠', category: '影视' },
  { id: 'mv5', civilian: '流浪地球', spy: '星际穿越', category: '影视' },
  { id: 'mv6', civilian: '甄嬛传', spy: '延禧攻略', category: '影视' },
  { id: 'mv7', civilian: '还珠格格', spy: '情深深雨蒙蒙', category: '影视' },
  { id: 'mv8', civilian: '周星驰', spy: '周润发', category: '影视' },
  { id: 'mv9', civilian: '成龙', spy: '李连杰', category: '影视' },
  { id: 'mv10', civilian: '泰坦尼克号', spy: '罗密欧与朱丽叶', category: '影视' },
  { id: 'mv11', civilian: '葫芦娃', spy: '黑猫警长', category: '影视' },
  { id: 'mv12', civilian: '喜羊羊', spy: '熊出没', category: '影视' },
  { id: 'mv13', civilian: '海绵宝宝', spy: '蜡笔小新', category: '影视' },
  { id: 'mv14', civilian: '柯南', spy: '福尔摩斯', category: '影视' },
  { id: 'mv15', civilian: '唐人街探案', spy: '误杀', category: '影视' },
  { id: 'mv16', civilian: '速度与激情', spy: '碟中谍', category: '影视' },
  { id: 'mv17', civilian: '狂飙', spy: '人民的名义', category: '影视' },
  { id: 'mv18', civilian: '武林外传', spy: '家有儿女', category: '影视' },
  { id: 'mv19', civilian: '让子弹飞', spy: '无间道', category: '影视' },
  { id: 'mv20', civilian: '盗梦空间', spy: '黑客帝国', category: '影视' },
]

// 你比我猜 / 你画我猜 词库（带分类）
export const CHARADES_CATEGORIES = ['搞笑', '内蒙', '动物', '动作', '物品', '成语'] as const
export type CharadesCategory = (typeof CHARADES_CATEGORIES)[number]

export interface CharadesWord {
  text: string
  category: CharadesCategory
}

const charades = (category: CharadesCategory, words: string[]): CharadesWord[] =>
  words.map(text => ({ text, category }))

export const CHARADES_WORDS: CharadesWord[] = [
  ...charades('搞笑', [
    '广场舞', '东北二人转', '科目三', '蹦迪', '社会摇', '老板画饼', '周一上班', '抢红包', '双十一剁手', '直播带货',
    '深夜泡面', '减肥第一天', '迟到打卡', '视频会议忘关麦', '落枕', '闪到腰', '被蚊子咬', '公鸡打鸣', '老母鸡下蛋', '落汤鸡',
    '大爷遛鸟', '大妈抢购', '自拍一百张', '抢演唱会门票', '醉拳',
  ]),
  ...charades('内蒙', [
    '套马杆', '烤全羊', '骑马', '摔跤', '挤奶', '风车', '火山喷发', '举哈达', '敬酒', '蒙古舞', '射箭', '骆驼',
    '蒙古包', '马', '羊群', '风力发电机', '火山', '奶茶', '勒勒车', '敖包', '马头琴',
    '那达慕', '九十九泉', '敕勒川', '草原天路', '北京向西一步',
  ]),
  ...charades('动物', [
    '大象', '长颈鹿', '企鹅', '袋鼠', '猴子', '螃蟹', '蛇', '青蛙', '公鸡', '鸭子',
    '猫头鹰', '蝴蝶', '孔雀', '乌龟', '兔子', '熊猫', '老虎', '大猩猩', '啄木鸟', '海豚',
  ]),
  ...charades('动作', [
    '打篮球', '游泳', '跳绳', '拔河', '俯卧撑', '瑜伽', '滑冰', '滑雪', '钓鱼', '打太极',
    '跳广场舞', '拍照', '自拍', '刷牙', '洗头', '炒菜', '包饺子', '吃面条', '打哈欠', '打喷嚏',
    '照镜子', '系鞋带', '开车', '倒车入库', '挤地铁',
  ]),
  ...charades('物品', [
    '电风扇', '吸尘器', '洗衣机', '微波炉', '雨伞', '眼镜', '口红', '香水', '手电筒', '充电宝',
    '自行车', '摩托车', '火车', '帆船', '秋千', '跷跷板', '不倒翁', '闹钟', '体重秤', '行李箱',
  ]),
  ...charades('成语', [
    '画蛇添足', '掩耳盗铃', '守株待兔', '亡羊补牢', '狐假虎威', '井底之蛙', '对牛弹琴', '鸡飞狗跳', '抓耳挠腮', '上蹿下跳',
    '手舞足蹈', '大摇大摆', '东张西望', '哭笑不得', '捧腹大笑', '垂头丧气', '抱头鼠窜', '金鸡独立', '虎头蛇尾', '龙飞凤舞',
  ]),
]

// emoji 题库（出题进抢答环节，答案只显示给主持人）
export const EMOJI_QUIZ_CATEGORIES = ['成语', '电影'] as const
export type EmojiQuizCategory = (typeof EMOJI_QUIZ_CATEGORIES)[number]

export interface EmojiQuiz {
  clue: string // emoji 组合
  answer: string
  category: EmojiQuizCategory
}

const quiz = (category: EmojiQuizCategory, items: [string, string][]): EmojiQuiz[] =>
  items.map(([clue, answer]) => ({ clue, answer, category }))

export const EMOJI_QUIZ: EmojiQuiz[] = [
  ...quiz('成语', [
    ['🐍➕🦵', '画蛇添足'],
    ['🙈🔔', '掩耳盗铃'],
    ['🌳🐇⏳', '守株待兔'],
    ['🐑💨🔧🏠', '亡羊补牢'],
    ['🦊🐯', '狐假虎威'],
    ['🐸🕳️👀☁️', '井底之蛙'],
    ['🐮🎹', '对牛弹琴'],
    ['🐔🛫🐶🦘', '鸡飞狗跳'],
    ['🌬️🌧️', '狂风暴雨'],
    ['🚶🐎👀🌸', '走马看花'],
    ['🐉🐍🖌️', '龙飞凤舞'],
    ['1️⃣🐔🦵🪨', '金鸡独立'],
    ['🐯👤🐍🔚', '虎头蛇尾'],
    ['💧⬇️🪨穿', '水滴石穿'],
    ['🔥➕🛢️', '火上浇油'],
    ['👄蜜🗡️肚', '口蜜腹剑'],
    ['🐺🐺🤝', '狼狈为奸'],
    ['👆🌳🐟', '缘木求鱼'],
    ['🌙下👴🧵', '月下老人'],
    ['🦻东🌬️', '耳边风'],
    ['🐦🌲先飞', '笨鸟先飞'],
    ['☝️🪨2️⃣🐦', '一石二鸟'],
    ['🐎🐎🐯🐯', '马马虎虎'],
    ['7️⃣⬆️8️⃣⬇️', '七上八下'],
    ['👉🦌🗣️🐎', '指鹿为马'],
    ['🛏️⬆️👂📯', '如雷贯耳'],
    ['🌊涨🚢⬆️', '水涨船高'],
    ['🪞🌸💧🌙', '镜花水月'],
    ['🥚🔍🦴', '鸡蛋里挑骨头'],
    ['🤚🌧️☂️翻☁️', '翻云覆雨'],
  ]),
  ...quiz('电影', [
    ['🚢💔🧊', '泰坦尼克号'],
    ['🌍🧊🚀', '流浪地球'],
    ['🐼🥋', '功夫熊猫'],
    ['🦁👑', '狮子王'],
    ['🕷️🧑', '蜘蛛侠'],
    ['🦇🧑🌃', '蝙蝠侠'],
    ['👽📞🏠', 'E.T. 外星人'],
    ['🧊❄️👸', '冰雪奇缘'],
    ['🐟🔍', '海底总动员'],
    ['🤖❤️🌱', '机器人总动员'],
    ['🚗⚡', '赛车总动员'],
    ['🧸🤠🚀', '玩具总动员'],
    ['😡🐦💥🐷', '愤怒的小鸟'],
    ['🌌⚔️🤖', '星球大战'],
    ['💍🌋🧙', '指环王'],
    ['⚡👦🪄', '哈利·波特'],
    ['🦖🏝️', '侏罗纪公园'],
    ['👨‍🚀🌽🕳️⏰', '星际穿越'],
    ['🧠💤💤💤', '盗梦空间'],
    ['🥊🐯🛶', '少年派的奇幻漂流'],
    ['🏃🍫🪶', '阿甘正传'],
    ['🟩🧌🐴', '怪物史莱克'],
    ['🐭👨‍🍳🇫🇷', '美食总动员'],
    ['🎈🏠👴', '飞屋环游记'],
    ['💀🎸🌼', '寻梦环游记'],
    ['👧🐉🛁🏮', '千与千寻'],
    ['🐷🐷🐺', '三只小猪'],
    ['🌪️👧👠🦁', '绿野仙踪'],
    ['🦍🗽🏙️', '金刚'],
    ['🤵🔫007', '007 系列'],
  ]),
]

// 内鬼任务卡模板（PRD 第二节第 4 条）
export const SPY_TASKS: string[] = [
  '在每个队的合影里悄悄"乱入"成功 3 次不被发现',
  '神不知鬼不觉地让 3 个不同的人说出暗号词「燃起来」',
  '偷偷记下各队的队名由来 / 得分策略，上交主持人',
  '每次集合站最左，不被人识破',
  '悄悄模仿某人口头禅 5 次不被发现',
]
