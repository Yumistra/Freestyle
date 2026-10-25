import { DEFAULT_INTENTS } from './intents'

export type Status = 'online' | 'idle' | 'dnd' | 'invisible'

export interface DmUser {
    id: string
    username?: string
    global_name?: string | null
    avatar?: string | null
    discriminator?: string
}

export interface DmEntry {
    id: string
    recipient: DmUser
    lastMessageId?: string
}

export interface Settings {
    token: string
    appId: string
    intents: number
    status: Status
    customStatus: string
    readyTimeoutMs: number
    autoDefer: boolean
    extraStubs: string[]
    dms: DmEntry[]
    // ── 안전장치 ──
    enabled: boolean // 봇 패치를 실제로 걸지 여부. 실패가 누적되면 자동으로 false
    failCount: number // 연속 실패 횟수 (READY까지 도달하면 0으로 초기화)
    bootArmed: boolean // 이번 부팅에서 패치를 걸었고 아직 READY 확인 전이면 true
    lastError: string // 마지막 실패 원인 (설정 화면 표시용)
    lastErrorAt: number
    autoReload: boolean // 봇 접속 후 로딩이 멈추면 앱을 자동으로 다시 불러올지
    lastAutoReloadAt: number // 새로고침 무한 반복 방지용
}

export const DEFAULT_SETTINGS: Settings = {
    token: '',
    appId: '',
    intents: DEFAULT_INTENTS,
    status: 'online',
    customStatus: '',
    readyTimeoutMs: 6000,
    autoDefer: true,
    extraStubs: [],
    dms: [],
    enabled: false,
    failCount: 0,
    bootArmed: false,
    lastError: '',
    lastErrorAt: 0,
    autoReload: true,
    lastAutoReloadAt: 0,
}

// 연속 이 횟수만큼 실패하면 자동으로 봇 패치를 끈다
export const MAX_FAILS = 2

/** Revenge Next 플러그인 JSON 저장소 (plugin.api.jsonStorage) */
interface Storage {
    cache?: any
    get(): Promise<any>
    set(value: any, replace?: boolean): Promise<void>
}

let store: Storage | undefined

// 설정 스냅샷: settings()가 REST 요청·게이트웨이 이벤트마다 불리므로 메모리에 들고 있고,
// 저장은 전부 saveSettings를 거치므로 그때만 스냅샷을 바꾸고 디스크에 쓴다.
let snapshot: Settings | undefined

/** 저장소를 디스크에서 읽어 스냅샷을 만든다 (start에서 한 번) */
export async function initStorage(storage: Storage) {
    store = storage
    let saved: any
    try {
        saved = await storage.get()
    } catch {}
    snapshot = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

export function settings(): Settings {
    return snapshot ?? (snapshot = { ...DEFAULT_SETTINGS })
}

// 디스크 쓰기는 순서대로 하나씩 (빠르게 연달아 저장해도 마지막 값이 남게)
let writing: Promise<unknown> = Promise.resolve()
function persist() {
    const s = store
    if (!s) return
    writing = writing.then(
        () => s.set({ ...settings() }, true),
        () => s.set({ ...settings() }, true),
    )
    writing.catch(e => console.error('[BotClient] save failed', e))
}

/** 바뀐 값만 반영한다. 같은 값 재저장은 건너뛴다 */
export function saveSettings(patch: Partial<Settings>) {
    const cur = settings()
    let changed = false
    for (const k in patch) {
        const v = (patch as any)[k]
        if (typeof v !== 'object' && Object.is((cur as any)[k], v)) continue
        changed = true
    }
    if (!changed) return
    snapshot = { ...cur, ...patch }
    persist()
    notifyNow()
}

// ── 로그 / 인터랙션 버퍼 (설정 화면에서 표시) ──────────────────────────

export type LogKind = 'info' | 'rest' | 'gateway' | 'error'
export interface LogEntry {
    t: number
    kind: LogKind
    msg: string
}

const logs: LogEntry[] = []
const interactions: any[] = []
const listeners = new Set<() => void>()

// 설정 화면 갱신은 모아서 한 번에: 로그가 연달아 찍혀도 화면을 매번 다시 그리지 않는다
let notifyTimer: ReturnType<typeof setTimeout> | undefined
function notify() {
    if (notifyTimer || !listeners.size) return
    notifyTimer = setTimeout(() => {
        notifyTimer = undefined
        for (const fn of listeners) fn()
    }, 150)
}

export function log(kind: LogKind, msg: string) {
    logs.unshift({ t: Date.now(), kind, msg })
    if (logs.length > 100) logs.length = 100
    if (kind === 'error') console.error('[BotClient]', msg)
    // 자동 동작 알림은 화면에 띄우지 않고 로그에만 남긴다 (설정 → 로그에서 확인)
    notify()
}

export function pushInteraction(i: any) {
    interactions.unshift(i)
    if (interactions.length > 20) interactions.length = 20
    notify()
}

export const getLogs = () => logs
export const getInteractions = () => interactions

/** 설정이 바뀌면 화면을 바로 다시 그린다 */
function notifyNow() {
    for (const fn of listeners) fn()
}

export function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
        listeners.delete(fn)
    }
}

/** 봇은 DM 목록 API가 없으므로, 받은 DM 채널을 직접 기억해 READY에 넣어준다 */
export function rememberDm(id: string, user: DmUser, lastMessageId?: string) {
    const { dms } = settings()
    if (dms[0]?.id === id) return
    const { id: uid, username, global_name, avatar, discriminator } = user
    const entry: DmEntry = { id, recipient: { id: uid, username, global_name, avatar, discriminator }, lastMessageId }
    saveSettings({ dms: [entry, ...dms.filter(d => d.id !== id)].slice(0, 100) })
}
