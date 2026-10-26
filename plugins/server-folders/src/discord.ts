import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Stores } from '@revenge-mod/discord/flux'
import { lookupModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { report } from './store'

/**
 * 디스코드 352 안쪽에서 쓰는 것들. 이름이 남아 있는 것(스토어·모듈 경로·내보낸 이름)으로만 찾는다.
 * 못 찾으면 undefined 이고, 그 기능만 조용히 빠진다.
 */

export interface Folder {
    folderId?: number
    folderName?: string
    folderColor?: number
    guildIds: string[]
}

const S = () => Stores as any

export const find = (...props: string[]) => {
    try {
        return (lookupModule(withProps(...(props as [string])) as any) as any)?.[0]
    } catch {
        return undefined
    }
}

export function byPath(path: string): any {
    try {
        const r = lookupModuleWithImportedPath(path) as any
        return Array.isArray(r) ? r[0] : r
    } catch {
        return undefined
    }
}

// ── 폴더 목록 ─────────────────────────────────────────────────────

export function getFolders(): Folder[] {
    try {
        const list = S().SortedGuildStore?.getGuildFolders?.()
        return Array.isArray(list) ? list : []
    } catch (e) {
        report('folders', e)
        return []
    }
}

/** 서버만 있는 칸 말고 진짜 폴더만 */
export const realFolders = () => getFolders().filter(f => f.folderId != null)

export const folderById = (id: number) => getFolders().find(f => f.folderId === id)

export const folderOfGuild = (guildId: string) => realFolders().find(f => f.guildIds.includes(guildId))

export const getGuild = (id: string) => {
    try {
        return S().GuildStore?.getGuild?.(id)
    } catch {
        return undefined
    }
}

export const selectedGuildId = (): string | null => {
    try {
        return S().SelectedGuildStore?.getGuildId?.() ?? null
    } catch {
        return null
    }
}

// ── 펼침 상태 (디스코드가 목록 안에서 펼치는 것) ────────────────────

export function expandedFolders(): number[] {
    try {
        const v = S().ExpandedGuildFolderStore?.getExpandedFolders?.()
        if (!v) return []
        return [...v].map(Number)
    } catch {
        return []
    }
}

let guildUtils: any
export const folderUtils = () => (guildUtils ??= find('toggleGuildFolderExpand', 'setGuildFolderExpanded') ?? find('toggleGuildFolderExpand'))

/** 디스코드 펼침을 바꾼다 (우리 패치를 거치지 않게 원래 함수로) */
export let rawToggle: ((id: number) => void) | undefined
export const setRawToggle = (fn: typeof rawToggle) => (rawToggle = fn)

export function setExpanded(id: number, expanded: boolean) {
    const u = folderUtils()
    try {
        if (typeof u?.setGuildFolderExpanded === 'function') return u.setGuildFolderExpanded(id, expanded)
        ;(Dispatcher as any).dispatch({ type: 'SET_GUILD_FOLDER_EXPANDED', folderId: id, expanded })
    } catch (e) {
        report('expand', e)
    }
}

// ── 저장 (이름·색·서버 구성) ───────────────────────────────────────

let settingsActions: any
export function saveFolders(folders: Folder[]) {
    settingsActions ??= find('saveGuildFolders')
    if (typeof settingsActions?.saveGuildFolders !== 'function') throw new Error('saveGuildFolders not found')
    return settingsActions.saveGuildFolders(
        folders.map(f => ({ guildIds: [...f.guildIds], folderId: f.folderId, folderName: f.folderName, folderColor: f.folderColor })),
    )
}

// ── 알림·읽음 ─────────────────────────────────────────────────────

export const isGuildMuted = (id: string) => {
    try {
        return !!S().UserGuildSettingsStore?.isMuted?.(id)
    } catch {
        return false
    }
}

let notif: any
let labels: any
export function setGuildMuted(id: string, muted: boolean) {
    notif ??= find('updateGuildNotificationSettings')
    labels ??= find('NotificationLabels')?.NotificationLabels
    if (typeof notif?.updateGuildNotificationSettings !== 'function') throw new Error('notification settings not found')
    notif.updateGuildNotificationSettings(id, { muted }, muted ? labels?.Muted : labels?.Unmuted)
}

export const guildUnread = (id: string) => {
    try {
        return !!S().GuildReadStateStore?.hasUnread?.(id)
    } catch {
        return false
    }
}

export const guildMentions = (id: string): number => {
    try {
        return S().GuildReadStateStore?.getMentionCount?.(id) ?? 0
    } catch {
        return 0
    }
}

// ── 이동 ──────────────────────────────────────────────────────────

const TRANSITION = 'modules/guilds_bar/native/utils/transitionGuildsBarToGuildOrOpenSelectedChannel.tsx'
export function openGuild(id: string) {
    try {
        const m = byPath(TRANSITION)
        const fn = m?.default ?? m
        if (typeof fn === 'function') return fn(id)
    } catch (e) {
        report('open', e)
    }
    try {
        find('transitionToGuild')?.transitionToGuild?.(id)
    } catch (e) {
        report('open', e)
    }
}

// ── 그리기 부품 ───────────────────────────────────────────────────

const ICON_PATH = (name: string) => `design/components/Icon/native/redesign/generated/${name}.tsx`
const iconCache: Record<string, any> = {}
/** 디스코드 아이콘 컴포넌트 (메뉴에 넣을 것) */
export function icon(name: string) {
    if (name in iconCache) return iconCache[name]
    let c: any
    const m = byPath(ICON_PATH(name))
    c = m?.[name] ?? m?.default
    if (!c) c = find(name)?.[name]
    if (c) iconCache[name] = c
    return c
}

let guildIconMod: any
export function guildIconModule() {
    guildIconMod ??= byPath('modules/guild/native/GuildIcon.tsx') ?? find('GuildIconSizes')
    return guildIconMod
}

let svgMod: any
export function svgXml() {
    svgMod ??= find('SvgXml')
    return svgMod?.SvgXml
}

let actionSheets: any
export function sheets() {
    actionSheets ??= find('openLazy', 'hideActionSheet')
    return actionSheets
}

/** 서버 목록 한 칸 크기 (디스코드 토큰, 못 읽으면 48) */
export function itemSize(): number {
    try {
        const v = (Tokens as any)?.default?.modules?.mobile?.GUILD_BAR_ITEM_SIZE
        if (typeof v === 'number') return v
    } catch {}
    return 48
}

export const intToHex = (n: number | undefined | null) => (n == null ? undefined : `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`)
export const hexToInt = (hex: string) => {
    const m = /^#?([0-9a-f]{6})/i.exec(hex)
    return m ? parseInt(m[1], 16) : undefined
}
