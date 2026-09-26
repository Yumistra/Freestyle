import type { JsonStorage } from '@revenge-mod/json-storage'
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
}

interface Logger {
    log(...a: unknown[]): void
    error(...a: unknown[]): void
}

export const ctx: { storage?: JsonStorage<Settings>; logger?: Logger } = {}

export function settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(ctx.storage?.cache as Partial<Settings> | undefined) }
}

/** 배열 필드가 index 단위로 병합되지 않도록 항상 전체 교체로 저장 */
export function saveSettings(patch: Partial<Settings>): Promise<void> {
    return ctx.storage?.set({ ...settings(), ...patch }, true) ?? Promise.resolve()
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
    if (kind === 'error') ctx.logger?.error(msg)
    else if (kind !== 'rest') ctx.logger?.log(`[${kind}] ${msg}`)
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
