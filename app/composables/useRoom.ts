// WebSocket 客户端封装：连接、自动重连、发事件、收 room:state
import { ref, shallowRef, onScopeDispose } from 'vue'
import type { ClientEvent, ServerEvent, PlayerView, AdminView } from '@shared/types'

type ClientCommand = ClientEvent extends infer E ? E extends ClientEvent ? Omit<E, 'actionId'> : never : never

let aid = 0
function actionId() { return `a_${Date.now().toString(36)}_${aid++}` }

export function useRoom() {
  const connected = ref(false)
  const view = shallowRef<PlayerView | AdminView | null>(null)
  const lastError = ref<{ code: string; message: string } | null>(null)
  const created = shallowRef<{ code: string; adminToken: string } | null>(null)
  const joined = shallowRef<{ clientId: string; playerId: string } | null>(null)
  const kicked = ref(false)

  let ws: WebSocket | null = null
  let reconnectTimer: any = null
  let queue: ClientEvent[] = []
  let resendOnOpen: (() => void) | null = null
  let disposed = false

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws`
  }

  function connect(onOpen?: () => void) {
    disposed = false
    resendOnOpen = onOpen || resendOnOpen
    ws = new WebSocket(wsUrl())
    ws.onopen = () => {
      connected.value = true
      // 先恢复身份，再冲洗断线期间排队的业务事件。
      const q = queue; queue = []
      resendOnOpen?.()
      q.forEach(e => raw(e))
    }
    ws.onmessage = (e) => {
      let msg: ServerEvent
      try { msg = JSON.parse(e.data) } catch { return }
      handle(msg)
    }
    ws.onclose = () => {
      connected.value = false
      if (disposed) return
      // 自动重连
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 1500)
      }
    }
    ws.onerror = () => { try { ws?.close() } catch {} }
  }

  function handle(msg: ServerEvent) {
    switch (msg.t) {
      case 'room:state': view.value = msg as PlayerView | AdminView; break
      case 'created': created.value = { code: msg.code, adminToken: msg.adminToken }; break
      case 'joined': joined.value = { clientId: msg.clientId, playerId: msg.playerId }; break
      case 'kicked': kicked.value = true; break
      case 'error': lastError.value = { code: msg.code, message: msg.message }; break
    }
  }

  function raw(ev: ClientEvent) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev))
    else queue.push(ev)
  }

  // 发事件（自动补 actionId）
  function send(ev: ClientCommand) {
    lastError.value = null
    raw({ ...ev, actionId: actionId() } as ClientEvent)
  }

  onScopeDispose(() => {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    try { ws?.close() } catch {}
  })

  return { connected, view, lastError, created, joined, kicked, connect, send }
}
