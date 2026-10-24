import { DEFAULT_ID, type Direction, type EasingKey, type ModuleKey, type Position } from './effects'

export interface ModuleSettings {
    effect: string
    /** ms */
    duration: number
    easing: EasingKey
    /** 나갈 때 효과 ('same' = 나타날 때와 같게) */
    exit?: string
    direction?: Direction
    position?: Position
    /** 메시지: 한꺼번에 나타날 때 차례로 보여 줄 간격 (ms) */
    stagger?: number
    /** 메시지: 채널을 열 때 보이는 메시지에도 */
    onOpen?: boolean
    /** 메시지: 메시지가 추가·삭제될 때 나머지가 부드럽게 밀리기 */
    shift?: boolean
    /** 메시지: 밀리는 시간 (ms) */
    shiftDuration?: number
    /** 화면 전환: 설정 같은 모달 화면에도 */
    modals?: boolean
    /** 배경: 진하기 (0~1, 디스코드 기본 대비) */
    amount?: number
}

export interface Settings {
    enabled: boolean
    modules: Record<ModuleKey, ModuleSettings>
}

export const MODULE_KEYS: ModuleKey[] = [
    'messages',
    'stack',
    'push',
    'modal',
    'panel',
    'channelList',
    'servers',
    'folder',
    'sheet',
    'menu',
    'alert',
    'backdrop',
    'toast',
    'notice',
    'subtle',
]

export const DEFAULTS: Settings = {
    enabled: true,
    modules: {
        messages: { effect: 'rise', duration: 320, easing: 'out', exit: 'same', direction: 'auto', position: 'auto', stagger: 30, onOpen: true, shift: true, shiftDuration: 200 },
        stack: { effect: 'slip', duration: 380, easing: 'expo', exit: 'same', direction: 'auto', position: 'auto', modals: true },
        push: { effect: 'default', duration: 300, easing: 'out' },
        modal: { effect: 'default', duration: 300, easing: 'out' },
        panel: { effect: 'default', duration: 260, easing: 'expo' },
        channelList: { effect: 'default', duration: 200, easing: 'smooth' },
        servers: { effect: 'default', duration: 220, easing: 'out' },
        folder: { effect: 'drop', duration: 380, easing: 'spring', exit: 'same', direction: 'auto', position: 'auto' },
        sheet: { effect: 'default', duration: 380, easing: 'spring' },
        menu: { effect: 'pop', duration: 300, easing: 'back', exit: 'same', direction: 'auto', position: 'auto' },
        alert: { effect: 'zoom', duration: 380, easing: 'spring', exit: 'same', direction: 'auto', position: 'auto' },
        backdrop: { effect: 'default', duration: 300, easing: 'out', amount: 0.6 },
        toast: { effect: 'slide', duration: 380, easing: 'back', exit: 'same', direction: 'auto', position: 'auto' },
        notice: { effect: 'default', duration: 300, easing: 'out', direction: 'auto', position: 'auto' },
        subtle: { effect: 'default', duration: 260, easing: 'spring' },
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

const listeners = new Set<() => void>()
/** 설정이 바뀌면 부를 함수 (상수 바꿔치기처럼 미리 적용해 둬야 하는 것들) */
export function onSettingsChange(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export async function save(next: Settings) {
    version++
    await storage?.set(next, true)
    for (const fn of listeners) {
        try {
            fn()
        } catch (e) {
            report('listener', e)
        }
    }
}

/** 작동 확인용 숫자 */
export const status = {
    screens: 0,
    nativeScreens: 0,
    screenExits: 0,
    stack: 0,
    sheets: 0,
    menus: 0,
    alerts: 0,
    backdrops: 0,
    toasts: 0,
    notices: 0,
    folders: 0,
    layouts: 0,
    /** 네이티브(메시지) 부분: null = 아직 확인 전 */
    native: null as null | boolean,
    constants: [] as string[],
    found: {} as Record<string, boolean>,
    lastError: '',
}

export function report(where: string, e: unknown) {
    status.lastError = `${where}: ${String((e as any)?.message ?? e)}`
}
