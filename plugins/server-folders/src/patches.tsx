import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { cloneElement, createContext, createElement, useContext, useMemo } from 'react'
import { View } from 'react-native'
import { folderById, folderOfGuild, folderUtils, icon, itemSize, realFolders, setRawToggle, svgXml } from './discord'
import { isFolderMuted, setFolderMuted, setMarkFolderRead, toggleFolder, removeGuildFromFolder, toast } from './folders'
import { iconById } from './icons'
import { customIcons, folderConfig, general, openFolders, report, setFolderConfig, status, useStore } from './store'
import { palette } from './ui/colors'
import { confirmDelete } from './ui/Editor'
import { D, FolderGlyph, folderColors } from './ui/parts'
import { openAddToFolder, openCreateFolder, openCustomize } from './ui/sheets'
import { ColumnHost } from './ui/Column'

type Cleanup = (...fns: Array<() => unknown>) => void

const FOLDER_PATH = 'modules/guilds_bar/native/GuildsBarGuildFolder.tsx'
const FOLDER_MENU_PATH = 'modules/guilds_bar/native/GuildsBarFolderMenuItems.tsx'
const GUILD_MENU_PATH = 'modules/guilds_bar/native/utils/getGuildsBarGuildMenuItems.tsx'
/** 서버의 채널 목록, DM 목록 (옆 칸을 붙일 곳) */
const LIST_PATHS = ['modules/channel_list_v2/native/RedesignChannelList.tsx', 'modules/main_tabs_v2/native/tabs/messages/MessagesFastestList.tsx']

/** 고른 아이콘을 실제로 그릴 수 있는지 */
function drawable(iconId: string) {
    if (!iconId || iconId === 'default') return false
    if (customIcons()[iconId]) return true
    return !!iconById(iconId) && !!svgXml()
}

// ── 서버 목록의 폴더 아이콘 ───────────────────────────────────────

/** GuildsBarGuildFolder 의 props (id, expanded, color, childNodes …) 를 안쪽 TransitionGroup 에 알려 준다 */
const FolderCtx = createContext<any>(null)

function FolderScope({ __type, __props }: { __type: any; __props: any }) {
    return <FolderCtx.Provider value={__props}>{createElement(__type, __props)}</FolderCtx.Provider>
}

function CountBadge({ count }: { count: number }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="text-xs/bold" style={{ color: '#ffffff', fontSize: 11, lineHeight: 14 }}>
                {String(count)}
            </Text>
        </View>
    )
}

/**
 * 폴더 안의 TransitionGroup (닫힘: 서버 미리보기 'preview', 열림: 폴더 아이콘 'icon').
 *  - 옆 칸에 열린 폴더는 열린 모양('icon')으로
 *  - 고른 아이콘이 있으면 그 칸의 내용만 우리 아이콘으로 (디스코드 전환 애니메이션은 그대로)
 */
function FolderTransitionGroup({ __type, __props }: { __type: any; __props: any }) {
    const folder = useContext(FolderCtx)
    useStore()
    const id = folder?.id != null ? Number(folder.id) : NaN
    if (Number.isNaN(id)) return createElement(__type, __props)
    const g = general()
    const cfg = folderConfig(id)
    const { a, b } = folderColors(folder.color ?? folderById(id)?.folderColor, id)
    const inColumn = g.extraColumn && openFolders().has(id)
    let items = __props.items
    if (inColumn && Array.isArray(items)) items = items.map((it: any) => (it?.type === 'preview' ? { type: 'icon', tintStyle: { tintColor: a } } : it))
    const custom = drawable(cfg.iconId)
    const size = itemSize()
    const renderItem = (...args: any[]) => {
        const el = __props.renderItem(...args)
        try {
            const item = args[1]
            if (!custom || !el || (item?.type !== 'icon' && !(item?.type === 'preview' && cfg.useClosedIcon))) return el
            status.icons++
            const glyph = <FolderGlyph iconId={cfg.iconId} open={item.type === 'icon'} size={Math.round(size * 0.74)} a={a} b={b} />
            return cloneElement(el, undefined, <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>{glyph}</View>)
        } catch (e) {
            report('icon', e)
            return el
        }
    }
    const count = folderById(id)?.guildIds.length ?? folder.childNodes?.length ?? 0
    return (
        <>
            {createElement(__type, { ...__props, items, renderItem })}
            {g.showCountBadge && count > 0 && !folder.isDragPreview ? <CountBadge count={count} /> : null}
        </>
    )
}

const isFolderGroup = (props: any) =>
    typeof props?.renderItem === 'function' && Array.isArray(props?.items) && props.items.some((i: any) => i?.type === 'preview' || i?.type === 'icon') && 'wrapChildren' in props

export function patchFolderItems(cleanup: Cleanup) {
    cleanup(
        getModuleWithImportedPath(FOLDER_PATH, (exports: any) => {
            const Folder = exports?.default
            if (!Folder) return
            status.found.folderItem = true
            cleanup(beforeJSX(Folder, (args: any[]) => [FolderScope, { __type: args[0], __props: args[1] }, ...args.slice(2)] as any))
        }) as any,
    )
    const done = new Set<any>()
    cleanup(
        getModules(
            withProps('TransitionGroup') as any,
            (mod: any) => {
                const TG = mod?.TransitionGroup
                if (!TG || done.has(TG)) return
                done.add(TG)
                status.found.transitionGroup = true
                cleanup(
                    beforeJSX(TG, (args: any[]) => {
                        try {
                            if (!isFolderGroup(args[1])) return args as any
                            status.folderItems++
                            return [FolderTransitionGroup, { __type: args[0], __props: args[1] }, ...args.slice(2)] as any
                        } catch (e) {
                            report('transition', e)
                            return args as any
                        }
                    }),
                )
            },
            { max: 5 } as any,
        ) as any,
    )
}

// ── 폴더 열기 (옆 칸) ─────────────────────────────────────────────

function patchToggleIn(u: any) {
    const original = u.toggleGuildFolderExpand
    setRawToggle((id: number) => original.call(u, id))
    status.found.toggle = true
    const undo = instead(u, 'toggleGuildFolderExpand', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
        const g = general()
        if (!g.extraColumn && !g.closeOtherFolders) return orig.apply(this, args)
        try {
            toggleFolder(Number(args[0]))
        } catch (e) {
            report('toggle', e)
            return orig.apply(this, args)
        }
    })
    return () => {
        undo()
        setRawToggle(undefined)
    }
}

/** 폴더 누르기: 옆 칸 모드면 디스코드처럼 펼치지 않고 옆 칸에서 연다 */
export function patchToggle(cleanup: Cleanup) {
    const now = folderUtils()
    if (typeof now?.toggleGuildFolderExpand === 'function') return cleanup(patchToggleIn(now))
    let done = false
    cleanup(
        getModules(
            withProps('toggleGuildFolderExpand') as any,
            (mod: any) => {
                if (done || typeof mod?.toggleGuildFolderExpand !== 'function') return
                done = true
                cleanup(patchToggleIn(mod))
            },
            { max: 1 } as any,
        ) as any,
    )
}

export function patchColumn(cleanup: Cleanup) {
    const done = new Set<any>()
    for (const path of LIST_PATHS) {
        cleanup(
            getModuleWithImportedPath(path, (exports: any) => {
                const List = exports?.default ?? exports
                if (!List || done.has(List)) return
                done.add(List)
                status.found.column = true
                cleanup(beforeJSX(List, (args: any[]) => [ColumnHost, { __type: args[0], __props: args[1] }, ...args.slice(2)] as any))
            }) as any,
        )
    }
}

// ── 길게 누르기 메뉴 ──────────────────────────────────────────────

const ic = (...names: string[]) => {
    for (const n of names) {
        const c = icon(n)
        if (c) return c
    }
}

function folderMenuItems(folderId: number) {
    const folder = folderById(folderId)
    if (!folder) return []
    const cfg = folderConfig(folderId)
    const muted = isFolderMuted(folder)
    return [
        { IconComponent: ic('PaintPaletteIcon', 'PencilIcon', 'SettingsIcon'), label: 'Customize Folder', action: () => openCustomize(folderId) },
        { IconComponent: ic(muted ? 'BellIcon' : 'BellSlashIcon', 'BellIcon', 'SettingsIcon'), label: muted ? 'Unmute Folder' : 'Mute Folder', action: () => setFolderMuted(folderId, !muted) },
        {
            IconComponent: ic(cfg.autoRead ? 'EyeSlashIcon' : 'EyeIcon', 'EnvelopeIcon', 'SettingsIcon'),
            label: cfg.autoRead ? 'Turn Off Auto Read' : 'Auto Read',
            action: () => {
                setFolderConfig(folderId, { autoRead: !cfg.autoRead })
                toast(cfg.autoRead ? 'Auto read off' : 'Auto read on')
            },
        },
        { IconComponent: ic('TrashIcon', 'XSmallIcon', 'SettingsIcon'), label: 'Delete Folder', action: () => confirmDelete(folderId) },
    ].filter(i => !!i.IconComponent)
}

function guildMenuItems(guildId: string) {
    const folder = folderOfGuild(guildId)
    if (folder)
        return [
            { IconComponent: ic('FolderIcon', 'SettingsIcon'), label: 'Move to Folder', action: () => openAddToFolder(guildId) },
            { IconComponent: ic('CircleMinusIcon', 'XSmallIcon', 'SettingsIcon'), label: 'Remove from Folder', action: () => removeGuildFromFolder(guildId) },
        ].filter(i => !!i.IconComponent)
    const items = [{ IconComponent: ic('FolderPlusIcon', 'PlusSmallIcon', 'SettingsIcon'), label: 'Create Folder', action: () => openCreateFolder(guildId) }]
    if (realFolders().length) items.push({ IconComponent: ic('FolderIcon', 'SettingsIcon'), label: 'Add to Folder', action: () => openAddToFolder(guildId) })
    return items.filter(i => !!i.IconComponent)
}

export function patchMenus(cleanup: Cleanup) {
    cleanup(
        getModuleWithImportedPath(FOLDER_MENU_PATH, (exports: any) => {
            if (typeof exports?.getGuildFolderMenuItems !== 'function') return
            status.found.folderMenu = true
            const original = exports.getGuildFolderMenuItems
            // 자동 읽음은 디스코드 메뉴의 "읽음으로 표시"를 그대로 쓴다
            setMarkFolderRead(id => {
                try {
                    const items = original(id)
                    const envelope = icon('EnvelopeIcon')
                    const read = (Array.isArray(items) && (items.find((i: any) => envelope && i?.IconComponent === envelope) ?? items[0])) || undefined
                    read?.action?.()
                } catch (e) {
                    report('autoRead', e)
                }
            })
            cleanup(
                instead(exports, 'getGuildFolderMenuItems', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                    const items = orig.apply(this, args)
                    try {
                        if (!Array.isArray(items)) return items
                        status.menus++
                        return [...items, ...folderMenuItems(Number(args[0]))]
                    } catch (e) {
                        report('folderMenu', e)
                        return items
                    }
                }),
            )
        }) as any,
    )
    cleanup(
        getModuleWithImportedPath(GUILD_MENU_PATH, (exports: any) => {
            if (typeof exports?.default !== 'function') return
            status.found.guildMenu = true
            cleanup(
                instead(exports, 'default', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                    const items = orig.apply(this, args)
                    try {
                        if (!Array.isArray(items) || typeof args[0] !== 'string') return items
                        status.menus++
                        return [...items, ...guildMenuItems(args[0])]
                    } catch (e) {
                        report('guildMenu', e)
                        return items
                    }
                }),
            )
        }) as any,
    )
}
