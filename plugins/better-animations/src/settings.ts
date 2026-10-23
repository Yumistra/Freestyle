import { DEFAULT_ID, type EasingKey, type ModuleKey } from './effects'

export interface ModuleSettings {
    effect: string
    /** ms */
    duration: number
    easing: EasingKey
}

export interface Settings {
    enabled: boolean
    modules: Record<ModuleKey, ModuleSettings>
}

export const MODULE_KEYS: ModuleKey[] = ['stack', 'push', 'modal', 'sheet', 'menu', 'alert', 'toast']

export const DEFAULTS: Settings = {
    enabled: true,
    modules: {
        stack: { effect: 'slip', duration: 380, easing: 'expo' },
        push: { effect: 'default', duration: 300, easing: 'out' },
        modal: { effect: 'default', duration: 300, easing: 'out' },
        sheet: { effect: 'default', duration: 380, easing: 'spring' },
        menu: { effect: 'pop', duration: 300, easing: 'back' },
        alert: { effect: 'zoom', duration: 380, easing: 'spring' },
        toast: { effect: 'slide', duration: 380, easing: 'back' },
    },
}

let storage: any
/** 설정이 바뀔 때마다 올라간다. 애니메이션 설정 객체 캐시의 열쇠로 쓴다 */
export let version = 0

export const hasStorage = () => !!storage

export function bindStorage(s: any) {
    storage = s
    version++
}

export function settings(): Settings {
    const saved = storage?.cache ?? {}
    const modules = { ...DEFAULTS.modules }
    for (const key of MODULE_KEYS) modules[key] = { ...DEFAULTS.modules[key], ...(saved.modules?.[key] ?? {}) }
    return { enabled: saved.enabled ?? DEFAULTS.enabled, modules }
}

/** 이 부분을 바꿔야 하는지. 꺼져 있거나 "기본"이면 디스코드 그대로 둔다 */
export function active(key: ModuleKey): ModuleSettings | undefined {
    const s = settings()
    if (!s.enabled) return
    const m = s.modules[key]
    return m.effect === DEFAULT_ID ? undefined : m
}

export async function save(next: Settings) {
    version++
    await storage?.set(next, true)
}

/** 작동 확인용 숫자 */
export const status = {
    screens: 0,
    stack: 0,
    sheets: 0,
    menus: 0,
    alerts: 0,
    toasts: 0,
    found: {} as Record<string, boolean>,
    lastError: '',
}

export function report(where: string, e: unknown) {
    status.lastError = `${where}: ${String((e as any)?.message ?? e)}`
}
