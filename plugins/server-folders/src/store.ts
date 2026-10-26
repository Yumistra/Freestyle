import { useEffect, useState } from 'react'

/** 플러그인 전체 설정 (BetterDiscord ServerFolders 의 general 설정에 해당) */
export interface General {
    /** 폴더를 열면 다른 폴더는 닫기 */
    closeOtherFolders: boolean
    /** 폴더 안 서버를 고르면 그 폴더 닫기 */
    closeTheFolder: boolean
    /** 서버를 고르면 모든 폴더 닫기 */
    closeAllFolders: boolean
    /** 폴더 안 서버로 가면 그 폴더 열기 */
    forceOpenFolder: boolean
    /** 폴더에 서버 수 표시 */
    showCountBadge: boolean
    /** 연 폴더의 서버를 옆 칸에 */
    extraColumn: boolean
    /** 옆 칸에서 폴더 사이 구분선 */
    addSeparators: boolean
    /** 옆 칸 맨 위에 폴더 아이콘 */
    addFolderIcon: boolean
}

/** 폴더마다 (Discord 가 저장하지 않는 것만. 이름·색은 Discord 폴더에 그대로 저장) */
export interface FolderConfig {
    /** 'default' = 디스코드 아이콘, 그 외 = ICONS id 또는 custom_… */
    iconId: string
    /** 닫혔을 때도 서버 미리보기 대신 아이콘 */
    useClosedIcon: boolean
    /** 아이콘 두 번째 색 (안쪽·장식) */
    color2: string
    muteFolder: boolean
    autoRead: boolean
}

export interface CustomIcon {
    open: string
    closed: string
}

export interface Saved {
    general: General
    folders: Record<string, FolderConfig>
    customIcons: Record<string, CustomIcon>
    /** 옆 칸에 열려 있는 폴더 */
    open: number[]
}

export const GENERAL_DEFAULTS: General = {
    closeOtherFolders: false,
    closeTheFolder: false,
    closeAllFolders: false,
    forceOpenFolder: false,
    showCountBadge: true,
    extraColumn: true,
    addSeparators: true,
    addFolderIcon: false,
}

export const FOLDER_DEFAULTS: FolderConfig = {
    iconId: 'default',
    useClosedIcon: false,
    color2: '#ffffff',
    muteFolder: false,
    autoRead: false,
}

export const DEFAULTS: Saved = { general: GENERAL_DEFAULTS, folders: {}, customIcons: {}, open: [] }

let storage: any
let version = 0
const listeners = new Set<() => void>()

export function bindStorage(s: any) {
    storage = s
    version++
    if (!s?.cache && typeof s?.get === 'function') {
        Promise.resolve(s.get())
            .then(() => {
                if (storage !== s) return
                version++
                emit()
            })
            .catch((e: unknown) => report('storage', e))
    }
}

export const hasStorage = () => !!storage

function saved(): Partial<Saved> {
    return storage?.cache ?? {}
}

export function general(): General {
    return { ...GENERAL_DEFAULTS, ...(saved().general ?? {}) }
}

export function folderConfig(id: number | string | undefined | null): FolderConfig {
    if (id == null) return FOLDER_DEFAULTS
    return { ...FOLDER_DEFAULTS, ...(saved().folders?.[String(id)] ?? {}) }
}

export function customIcons(): Record<string, CustomIcon> {
    return saved().customIcons ?? {}
}

/** 옆 칸에 열린 폴더 (메모리에 들고 있다가 저장) */
let openSet: Set<number> | undefined
export function openFolders(): Set<number> {
    if (!openSet) openSet = new Set((saved().open ?? []).map(Number).filter(n => !Number.isNaN(n)))
    return openSet
}

async function write(patch: Partial<Saved>) {
    if (!storage) return
    let cur: any = storage.cache
    if (!cur) {
        try {
            cur = (await storage.get()) ?? {}
        } catch {
            cur = {}
        }
    }
    await storage.set({ ...cur, ...patch }, true)
}

export function setGeneral(patch: Partial<General>) {
    const next = { ...general(), ...patch }
    if (storage) storage.cache = { ...(storage.cache ?? {}), general: next }
    changed()
    return write({ general: next })
}

export function setFolderConfig(id: number | string, patch: Partial<FolderConfig>) {
    const folders = { ...(saved().folders ?? {}) }
    folders[String(id)] = { ...folderConfig(id), ...patch }
    if (storage) storage.cache = { ...(storage.cache ?? {}), folders }
    changed()
    return write({ folders })
}

export function removeFolderConfig(id: number | string) {
    const folders = { ...(saved().folders ?? {}) }
    delete folders[String(id)]
    if (storage) storage.cache = { ...(storage.cache ?? {}), folders }
    openFolders().delete(Number(id))
    changed()
    return write({ folders, open: [...openFolders()] })
}

export function setCustomIcons(next: Record<string, CustomIcon>) {
    if (storage) storage.cache = { ...(storage.cache ?? {}), customIcons: next }
    changed()
    return write({ customIcons: next })
}

export function setOpen(ids: Iterable<number>) {
    openSet = new Set(ids)
    changed()
    return write({ open: [...openSet] })
}

// ── 바뀜 알림 ─────────────────────────────────────────────────────

function emit() {
    for (const fn of [...listeners]) {
        try {
            fn()
        } catch (e) {
            report('listener', e)
        }
    }
}

export function changed() {
    version++
    emit()
}

export function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
        listeners.delete(fn)
    }
}

/** 설정·열린 폴더가 바뀌면 다시 그린다 */
export function useStore() {
    const [, set] = useState(0)
    useEffect(() => subscribe(() => set(n => n + 1)), [])
    return version
}

// ── 상태 (설정 화면의 Status) ─────────────────────────────────────

export const status = {
    found: {} as Record<string, boolean>,
    folderItems: 0,
    icons: 0,
    column: 0,
    menus: 0,
    lastError: '',
}

export function report(where: string, e: unknown) {
    status.lastError = `${where}: ${String((e as any)?.message ?? e)}`
}
