import { storage } from '@vendetta/plugin'
import { showToast } from '@vendetta/ui/toasts'
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
}

// 연속 이 횟수만큼 실패하면 자동으로 봇 패치를 끈다
export const MAX_FAILS = 2

const store = storage as Partial<Settings>

/** storage에 기본값을 한 번 채워 넣는다 (Vendetta storage는 프록시라 직접 대입 가능) */
export function initStorage() {
    for (const k in DEFAULT_SETTINGS) {
        if (store[k as keyof Settings] === undefined) {
            ;(store as any)[k] = (DEFAULT_SETTINGS as any)[k]
        }
    }
}

export function settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...store }
}

export function saveSettings(patch: Partial<Settings>) {
    Object.assign(store, patch)
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

function notify() {
    for (const fn of listeners) fn()
}

export function log(kind: LogKind, msg: string) {
    logs.unshift({ t: Date.now(), kind, msg })
    if (logs.length > 100) logs.length = 100
    if (kind === 'error') console.error('[BotClient]', msg)
    // 화면이 로딩에서 멈춰도 어디까지 진행됐는지 보이도록 게이트웨이 단계·오류는 토스트로 표시
    if (kind === 'gateway' || kind === 'error') {
        try {
            showToast(`[BotClient] ${msg}`)
        } catch {}
    }
    notify()
}

export function pushInteraction(i: any) {
    interactions.unshift(i)
    if (interactions.length > 20) interactions.length = 20
    notify()
}

export const getLogs = () => logs
export const getInteractions = () => interactions

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
