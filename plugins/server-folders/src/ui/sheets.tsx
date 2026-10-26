import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { folderById, getGuild, hexToInt, realFolders, sheets } from '../discord'
import { addGuildToFolder, createFolder, folderLabel, folderOfGuild, getFolders, removeGuildFromFolder, setFolderOpen, toast } from '../folders'
import { folderConfig, useStore } from '../store'
import { palette } from './colors'
import { FolderEditor } from './Editor'
import { D, Field, FolderGlyph, GuildAvatar, Input, Swatches, folderColors } from './parts'

let seq = 0

/** 디스코드 아래 창으로 띄운다 (없으면 가운데 창) */
export function openSheet(title: string, render: (close: () => void) => any) {
    const key = `server-folders-${seq++}`
    const api = sheets()
    const close = () => {
        try {
            api?.hideActionSheet?.(key)
        } catch {}
    }
    function Sheet() {
        const { ActionSheet, BottomSheetTitleHeader, Text } = D()
        const body = <View style={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}>{render(close)}</View>
        if (!ActionSheet) return body
        return (
            <ActionSheet scrollable startExpanded>
                {BottomSheetTitleHeader ? (
                    <BottomSheetTitleHeader title={title} />
                ) : (
                    <Text variant="heading-lg/bold" style={{ padding: 16 }}>
                        {title}
                    </Text>
                )}
                {body}
            </ActionSheet>
        )
    }
    try {
        if (typeof api?.openLazy !== 'function') throw new Error('no action sheets')
        api.openLazy(Promise.resolve({ default: Sheet }), key, {})
    } catch {
        const { AlertModal, AlertActionButton } = D()
        AlertActionCreators.openAlert(key, <AlertModal title={title} content={<ScrollView style={{ maxHeight: 480 }}>{render(() => AlertActionCreators.dismissAlert?.(key))}</ScrollView>} actions={<AlertActionButton text="Close" variant="secondary" />} />)
    }
}

/** 한 줄 (아이콘 + 글 + 오른쪽) */
function Row({ leading, label, sub, trailing, onPress, danger }: { leading?: any; label: string; sub?: string; trailing?: any; onPress?(): void; danger?: boolean }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <Pressable onPress={onPress} style={({ pressed }: any) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: pressed ? c.raised : c.surface })}>
            {leading}
            <View style={{ flex: 1, gap: 1 }}>
                <Text variant="text-md/semibold" numberOfLines={1} style={danger ? { color: '#f23f43' } : undefined}>
                    {label}
                </Text>
                {sub ? (
                    <Text variant="text-xs/medium" style={{ color: c.muted }} numberOfLines={1}>
                        {sub}
                    </Text>
                ) : null}
            </View>
            {trailing}
        </Pressable>
    )
}

/** 폴더 줄 앞 아이콘 */
export function FolderBadge({ folderId, size = 40 }: { folderId: number; size?: number }) {
    const { Text } = D()
    const f = folderById(folderId)
    const { a, b } = folderColors(f?.folderColor, folderId)
    const cfg = folderConfig(folderId)
    const glyph = <FolderGlyph iconId={cfg.iconId === 'default' ? 'classic' : cfg.iconId} open={false} size={size * 0.8} a={a} b={b} />
    return (
        <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: a + '33', alignItems: 'center', justifyContent: 'center' }}>
            {glyph ?? (
                <Text variant="text-md/bold" style={{ color: a }}>
                    ▣
                </Text>
            )}
        </View>
    )
}

function Check({ on }: { on: boolean }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {on ? (
                <Text variant="text-xs/bold" style={{ color: '#ffffff' }}>
                    ✓
                </Text>
            ) : null}
        </View>
    )
}

// ── 새 폴더 ───────────────────────────────────────────────────────

function CreateFolder({ initial, close }: { initial?: string; close(): void }) {
    const { Button, Text } = D()
    const loose = getFolders()
        .filter(f => f.folderId == null)
        .map(f => f.guildIds[0])
        .filter(id => !!getGuild(id))
    const [picked, setPicked] = useState<string[]>(initial ? [initial] : [])
    const [name, setName] = useState('')
    const [color, setColor] = useState<string | undefined>('#5865f2')
    const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
    return (
        <>
            <Field label="Name">
                <Input value={name} placeholder="New Folder" maxLength={32} onChange={setName} />
            </Field>
            <Field label="Color">
                <Swatches value={color} onChange={setColor} allowNone />
            </Field>
            <Field label="Servers" trailing={`${picked.length} selected`}>
                {loose.length ? (
                    <View style={{ gap: 6 }}>
                        {loose.map(id => (
                            <Row key={id} leading={<GuildAvatar id={id} size={36} />} label={getGuild(id)?.name ?? id} trailing={<Check on={picked.includes(id)} />} onPress={() => toggle(id)} />
                        ))}
                    </View>
                ) : (
                    <Text variant="text-sm/medium" color="text-muted">
                        Every server is already in a folder.
                    </Text>
                )}
            </Field>
            <Button
                text="Create"
                variant="primary"
                size="md"
                disabled={!picked.length}
                onPress={() => {
                    if (!picked.length) return
                    const id = createFolder(picked, name.trim(), color ? hexToInt(color) : undefined)
                    if (id) toast('Folder created')
                    close()
                }}
            />
        </>
    )
}

export const openCreateFolder = (guildId?: string) => openSheet('New Folder', close => <CreateFolder initial={guildId} close={close} />)

// ── 폴더에 넣기 ───────────────────────────────────────────────────

function PickFolder({ guildId, close }: { guildId: string; close(): void }) {
    const { Text } = D()
    useStore()
    const current = folderOfGuild(guildId)?.folderId
    const list = realFolders().filter(f => f.folderId !== current)
    if (!list.length)
        return (
            <Text variant="text-sm/medium" color="text-muted">
                No other folders yet.
            </Text>
        )
    return (
        <View style={{ gap: 6 }}>
            {list.map((f, i) => (
                <Row
                    key={f.folderId}
                    leading={<FolderBadge folderId={f.folderId!} />}
                    label={folderLabel(f, i)}
                    sub={`${f.guildIds.length} server${f.guildIds.length === 1 ? '' : 's'}`}
                    onPress={() => {
                        addGuildToFolder(f.folderId!, guildId)
                        toast(`Added to ${folderLabel(f, i)}`)
                        close()
                    }}
                />
            ))}
        </View>
    )
}

export const openAddToFolder = (guildId: string) => openSheet('Add to Folder', close => <PickFolder guildId={guildId} close={close} />)

// ── 폴더 꾸미기 ───────────────────────────────────────────────────

export const openCustomize = (folderId: number) => openSheet(folderLabel(folderById(folderId)), close => <FolderEditor folderId={folderId} onSaved={close} />)

// ── 옆 칸 서버 길게 누르기 ─────────────────────────────────────────

export function openGuildOptions(guildId: string) {
    const g = getGuild(guildId)
    openSheet(g?.name ?? 'Server', close => {
        const folder = folderOfGuild(guildId)
        return (
            <View style={{ gap: 6 }}>
                <Row
                    leading={<GuildAvatar id={guildId} size={36} />}
                    label="Move to another folder"
                    onPress={() => {
                        close()
                        setTimeout(() => openAddToFolder(guildId), 350)
                    }}
                />
                {folder ? (
                    <Row
                        leading={<FolderBadge folderId={folder.folderId!} size={36} />}
                        label="Close folder"
                        onPress={() => {
                            setFolderOpen(folder.folderId!, false)
                            close()
                        }}
                    />
                ) : null}
                <Row
                    label="Remove from folder"
                    danger
                    onPress={() => {
                        removeGuildFromFolder(guildId)
                        close()
                    }}
                />
            </View>
        )
    })
}
