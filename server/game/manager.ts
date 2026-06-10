// 房间管理器：内存 Map（运行时） + SQLite 持久化（PRD §9.1）
// 启动时从 SQLite 恢复所有房间；变更后防抖落盘；重启不丢身份/积分/内鬼。

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RoomRuntime } from './room'
import { createRoom } from './room'

const DB_PATH = process.env.CAOYUAN_DB || resolve(process.cwd(), '.data/caoyuan.db')

let db: Database.Database | null = null
function getDb(): Database.Database {
  if (db) return db
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  return db
}

// 序列化：Set 不能 JSON，单独转数组
function serialize(rt: RoomRuntime): string {
  return JSON.stringify({
    state: rt.state,
    inbox: rt.inbox,
    adminToken: rt.adminToken,
    adminPass: rt.adminPass,
    seenActions: [...rt.seenActions],
    lastMsgAt: rt.lastMsgAt,
  })
}
function deserialize(json: string): RoomRuntime {
  const o = JSON.parse(json)
  // 旧版本数据没有 teamsRevealed 字段：默认未揭晓（宁可让主持人重点一次揭晓，也不冒险泄露）
  if (o.state && o.state.teamsRevealed === undefined) o.state.teamsRevealed = false
  return {
    state: o.state,
    inbox: o.inbox || { messages: [] },
    adminToken: o.adminToken,
    adminPass: o.adminPass || null,
    seenActions: new Set(o.seenActions || []),
    lastMsgAt: o.lastMsgAt || {},
  }
}

// 内存运行时
const rooms = new Map<string, RoomRuntime>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
let loaded = false

function loadAll() {
  if (loaded) return
  loaded = true
  try {
    const rows = getDb().prepare('SELECT code, data FROM rooms').all() as { code: string; data: string }[]
    for (const r of rows) {
      try { rooms.set(r.code, deserialize(r.data)) } catch { /* 跳过坏行 */ }
    }
  } catch (e) {
    console.error('[manager] loadAll 失败', e)
  }
}

function persist(code: string) {
  const rt = rooms.get(code)
  if (!rt) return
  try {
    getDb().prepare(
      'INSERT INTO rooms (code, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at'
    ).run(code, serialize(rt), Date.now())
  } catch (e) {
    console.error('[manager] persist 失败', e)
  }
}

// 防抖落盘：300ms 内多次变更只写一次
export function markDirty(code: string) {
  if (saveTimers.has(code)) clearTimeout(saveTimers.get(code)!)
  saveTimers.set(code, setTimeout(() => { persist(code); saveTimers.delete(code) }, 300))
}

export function getRoom(code: string): RoomRuntime | undefined {
  loadAll()
  return rooms.get(code)
}

export function roomExists(code: string): boolean {
  loadAll()
  return rooms.has(code)
}

export function newRoom(code: string, passcode?: string | null, adminPass?: string | null): RoomRuntime {
  loadAll()
  const rt = createRoom(code, passcode, adminPass)
  rooms.set(code, rt)
  persist(code) // 立即落盘
  return rt
}

// 生成不冲突的房间码（4 位易读）
export function genCode(): string {
  loadAll()
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = ''
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)]
    if (!rooms.has(c)) return c
  }
  return 'R' + Date.now().toString(36).slice(-4).toUpperCase()
}
