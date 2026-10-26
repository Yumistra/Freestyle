import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Stores } from '@revenge-mod/discord/flux'
import {
    expandedFolders,
    folderById,
    folderUtils,
    folderOfGuild,
    getFolders,
    isGuildMuted,
    rawToggle,
    realFolders,
    saveFolders,
    selectedGuildId,
    setExpanded,
    setGuildMuted,
    guildUnread,
    type Folder,
} from './discord'
import { changed, folderConfig, general, openFolders, removeFolderConfig, report, setFolderConfig, setOpen } from './store'

let seq = 0
export function toast(text: string) {
    try {
        ToastActionCreators.open(`server-folders-${Date.now()}-${seq++}`, { text })
    } catch {}
}

function save(next: Folder[]) {
    try {
        saveFolders(next)
        return true
    } catch (e) {
        report('save', e)
        toast("Couldn't save folders")
        return false
    }
}

function newFolderId() {
    const used = new Set(getFolders().map(f => f.folderId))
    let id = 0
    do id = Math.floor(Math.random() * 4294967296)
    while (!id || used.has(id))
    return id
}

// ── 폴더 구성 바꾸기 (BetterDiscord ServerFolders 와 같은 방식: 전체 목록을 새로 만들어 저장) ──

export function createFolder(guildIds: string[], name?: string, color?: number) {
    const ids = [...new Set(guildIds)]
    if (!ids.length) return
    const folderId = newFolderId()
    const out: Folder[] = []
    let added = false
    for (const f of getFolders()) {
        if (f.folderId == null && ids.includes(f.guildIds[0])) {
            if (!added) {
                added = true
                out.push({ guildIds: ids, folderId, folderName: name || undefined, folderColor: color })
            }
        } else if (f.folderId != null) {
            // 다른 폴더에 있던 서버는 거기서 뺀다
            const rest = f.guildIds.filter(g => !ids.includes(g))
            if (rest.length) out.push({ ...f, guildIds: rest })
        } else out.push(f)
    }
    if (!added) out.unshift({ guildIds: ids, folderId, folderName: name || undefined, folderColor: color })
    if (save(out)) return folderId
}

export function addGuildToFolder(folderId: number, guildId: string) {
    const out: Folder[] = []
    for (const f of getFolders()) {
        if (f.folderId != null) {
            const ids = f.guildIds.filter(g => g !== guildId)
            if (f.folderId === folderId) ids.push(guildId)
            if (ids.length) out.push({ ...f, guildIds: ids })
        } else if (f.guildIds[0] !== guildId) out.push(f)
    }
    save(out)
    applyMute(folderId)
}

export function removeGuildFromFolder(guildId: string) {
    const out: Folder[] = []
    for (const f of getFolders()) {
        if (f.folderId != null && f.guildIds.includes(guildId)) {
            const ids = f.guildIds.filter(g => g !== guildId)
            if (ids.length) out.push({ ...f, guildIds: ids })
            out.push({ guildIds: [guildId] })
        } else out.push(f)
    }
    save(out)
}

export function deleteFolder(folderId: number) {
    const out: Folder[] = []
    for (const f of getFolders()) {
        if (f.folderId === folderId) for (const g of f.guildIds) out.push({ guildIds: [g] })
        else out.push(f)
    }
    if (save(out)) removeFolderConfig(folderId)
}

export function updateFolder(folderId: number, patch: { folderName?: string; folderColor?: number }) {
    save(getFolders().map(f => (f.folderId === folderId ? { ...f, ...patch } : f)))
}

// ── 알림 끄기·자동 읽음 ───────────────────────────────────────────

export const isFolderMuted = (folder: Folder | undefined) => !!folder?.guildIds.length && folder.guildIds.every(isGuildMuted)

export function setFolderMuted(folderId: number, muted: boolean) {
    const folder = folderById(folderId)
    if (!folder) return
    setFolderConfig(folderId, { muteFolder: muted })
    for (const g of folder.guildIds) {
        try {
            if (isGuildMuted(g) !== muted) setGuildMuted(g, muted)
        } catch (e) {
            report('mute', e)
            toast("Couldn't change notifications")
            return
        }
    }
}

/** 알림 끈 폴더에 새로 들어온 서버도 끈다 */
function applyMute(folderId?: number) {
    for (const f of realFolders()) {
        if (folderId != null && f.folderId !== folderId) continue
        if (!folderConfig(f.folderId).muteFolder) continue
        for (const g of f.guildIds) {
            try {
                if (!isGuildMuted(g)) setGuildMuted(g, true)
            } catch {}
        }
    }
}

/** 폴더를 읽음으로 (디스코드 폴더 메뉴의 "읽음으로 표시"를 그대로 부른다) */
export let markFolderRead: (folderId: number) => void = () => {}
export const setMarkFolderRead = (fn: typeof markFolderRead) => (markFolderRead = fn)

const readTimers = new Map<number, ReturnType<typeof setTimeout>>()
function checkAutoRead() {
    for (const f of realFolders()) {
        const id = f.folderId!
        if (!folderConfig(id).autoRead || !f.guildIds.some(guildUnread)) continue
        if (readTimers.has(id)) continue
        // BetterDiscord 처럼 잠깐 뒤에 (바로 지우면 무엇이 왔는지 볼 틈이 없다)
        readTimers.set(
            id,
            setTimeout(() => {
                readTimers.delete(id)
                if (folderConfig(id).autoRead) markFolderRead(id)
            }, 10_000),
        )
    }
}

// ── 열기·닫기 ─────────────────────────────────────────────────────

/** 지금 열려 있는지 (옆 칸 모드면 옆 칸 기준) */
export function isOpen(folderId: number) {
    return general().extraColumn ? openFolders().has(folderId) : expandedFolders().includes(folderId)
}

function openInList(id: number, open: boolean) {
    if (expandedFolders().includes(id) === open) return
    // 디스코드 펼침 액션 (없으면 원래 누르기 함수로)
    if (typeof folderUtils()?.setGuildFolderExpanded === 'function' || !rawToggle) setExpanded(id, open)
    else rawToggle(id)
}

export function setFolderOpen(folderId: number, open: boolean) {
    const g = general()
    if (g.extraColumn) {
        const next = new Set(open && g.closeOtherFolders ? [] : openFolders())
        if (open) next.add(folderId)
        else next.delete(folderId)
        setOpen([...next].filter(id => !!folderById(id)))
        // 디스코드 쪽에서 펼쳐져 있으면 접는다 (서버가 두 번 보이지 않게)
        if (expandedFolders().includes(folderId)) openInList(folderId, false)
    } else {
        if (open && g.closeOtherFolders) for (const id of expandedFolders()) if (id !== folderId) openInList(id, false)
        openInList(folderId, open)
    }
}

export const toggleFolder = (folderId: number) => setFolderOpen(folderId, !isOpen(folderId))

export function closeAll(except?: number) {
    if (general().extraColumn) setOpen([...openFolders()].filter(id => id === except))
    else for (const id of expandedFolders()) if (id !== except) openInList(id, false)
}

/** 옆 칸 모드를 켜고 끌 때: 펼친 폴더를 반대쪽으로 옮긴다 */
export function moveOpenState(toColumn: boolean) {
    if (toColumn) {
        const ids = expandedFolders()
        setOpen([...new Set([...openFolders(), ...ids])])
        for (const id of ids) openInList(id, false)
    } else {
        const ids = [...openFolders()]
        setOpen([])
        for (const id of ids) openInList(id, true)
    }
}

// ── 스토어 감시 ───────────────────────────────────────────────────

/**
 * - 옆 칸 모드에서 디스코드가 스스로 폴더를 펼치면 (드래그로 폴더 만들기 등) 옆 칸으로 옮긴다
 * - 서버를 고를 때: 폴더 닫기·모두 닫기·그 폴더 열기
 * - 자동 읽음, 알림 끈 폴더
 */
export function watchStores() {
    const S = Stores as any
    const offs: Array<() => void> = []
    const on = (store: any, fn: () => void) => {
        if (typeof store?.addChangeListener !== 'function') return
        // 스토어 알림은 디스코드가 액션을 처리하는 도중에 올 수 있다. 그 안에서 또 액션을 보내면 안 되므로 한 박자 뒤에
        const h = () =>
            setTimeout(() => {
                try {
                    fn()
                } catch (e) {
                    report('watch', e)
                }
            }, 0)
        store.addChangeListener(h)
        offs.push(() => store.removeChangeListener(h))
    }

    on(S.ExpandedGuildFolderStore, () => {
        if (!general().extraColumn) return
        const ids = expandedFolders()
        if (!ids.length) return
        const next = new Set(general().closeOtherFolders ? [] : openFolders())
        for (const id of ids) next.add(id)
        setOpen(next)
        for (const id of ids) openInList(id, false)
    })

    let lastGuild = selectedGuildId()
    let lastFolders = getFolders()
    on(S.SelectedGuildStore, () => {
        const now = selectedGuildId()
        if (now === lastGuild) return
        lastGuild = now
        if (!now) return
        const g = general()
        const folder = folderOfGuild(now)
        const keep = g.forceOpenFolder ? folder?.folderId : undefined
        if (g.closeAllFolders) closeAll(keep)
        else if (folder && g.closeTheFolder && !g.forceOpenFolder && isOpen(folder.folderId!)) setFolderOpen(folder.folderId!, false)
        if (folder && g.forceOpenFolder && !isOpen(folder.folderId!)) setFolderOpen(folder.folderId!, true)
    })

    on(S.SortedGuildStore, () => {
        const now = getFolders()
        if (now === lastFolders) return
        lastFolders = now
        applyMute()
        // 지워진 폴더는 옆 칸에서도 뺀다
        const alive = [...openFolders()].filter(id => !!folderById(id))
        if (alive.length !== openFolders().size) setOpen(alive)
        changed()
    })

    on(S.GuildReadStateStore, checkAutoRead)
    on(S.UserGuildSettingsStore, () => changed())

    // 시작할 때 한 번
    try {
        if (general().extraColumn && expandedFolders().length) moveOpenState(true)
        checkAutoRead()
    } catch (e) {
        report('watch', e)
    }
    return () => {
        for (const off of offs) off()
        for (const t of readTimers.values()) clearTimeout(t)
        readTimers.clear()
    }
}

export const folderLabel = (f: Folder | undefined, index?: number) =>
    f?.folderName || (index != null ? `Folder ${index + 1}` : 'Folder')

export { getFolders, realFolders, folderById, folderOfGuild }
