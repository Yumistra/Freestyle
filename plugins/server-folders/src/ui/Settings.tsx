import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { realFolders, svgXml } from '../discord'
import { folderLabel, moveOpenState } from '../folders'
import { ICONS, iconById } from '../icons'
import { bindStorage, customIcons, folderConfig, general, hasStorage, setCustomIcons, setGeneral, status, useStore, type General } from '../store'
import { palette } from './colors'
import { FolderEditor } from './Editor'
import { Card, D, Field, FolderGlyph, Input, Section, SwitchRow } from './parts'
import { FolderBadge, openCreateFolder } from './sheets'

const BEHAVIOR: Array<[keyof General, string, string?]> = [
    ['closeOtherFolders', 'Close other folders', 'Only one folder open at a time'],
    ['closeTheFolder', 'Close folder on select', 'Closes a folder when you pick one of its servers'],
    ['closeAllFolders', 'Close all on select', 'Closes every folder when you pick a server'],
    ['forceOpenFolder', 'Open folder on switch', "Opens a server's folder when you switch to it"],
]

function FolderCards() {
    const { Text, Button } = D()
    const [open, setOpen] = useState<number | null>(null)
    const folders = realFolders()
    return (
        <Section title="Folders">
            {folders.length ? (
                folders.map((f, i) => {
                    const id = f.folderId!
                    const cfg = folderConfig(id)
                    const icon = cfg.iconId === 'default' ? 'Discord icon' : (iconById(cfg.iconId)?.name ?? 'Custom icon')
                    return (
                        <Card
                            key={id}
                            leading={<FolderBadge folderId={id} size={36} />}
                            title={folderLabel(f, i)}
                            subtitle={`${f.guildIds.length} server${f.guildIds.length === 1 ? '' : 's'} · ${icon}${cfg.muteFolder ? ' · Muted' : ''}${cfg.autoRead ? ' · Auto read' : ''}`}
                            accent={cfg.iconId !== 'default'}
                            open={open === id}
                            onToggle={() => setOpen(open === id ? null : id)}
                        >
                            <FolderEditor folderId={id} onSaved={() => setOpen(null)} />
                        </Card>
                    )
                })
            ) : (
                <Text variant="text-sm/medium" color="text-muted" style={{ marginLeft: 4 }}>
                    No folders yet.
                </Text>
            )}
            <Button text="New folder" variant="secondary" size="md" onPress={() => openCreateFolder()} />
        </Section>
    )
}

function CustomIcons() {
    const { Text, Button } = D()
    const c = useMemo(palette, [])
    const [openUrl, setOpenUrl] = useState('')
    const [closedUrl, setClosedUrl] = useState('')
    const [show, setShow] = useState(false)
    const icons = customIcons()
    const ids = Object.keys(icons)
    const valid = (u: string) => /^https?:\/\/\S+$/i.test(u.trim())
    return (
        <Card title="Custom icons" subtitle={ids.length ? `${ids.length} added` : 'Use your own images'} open={show} onToggle={() => setShow(!show)}>
            {ids.map(id => (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: c.base }}>
                    <FolderGlyph iconId={id} open={false} size={40} a="#000" b="#fff" />
                    <FolderGlyph iconId={id} open size={40} a="#000" b="#fff" />
                    <View style={{ flex: 1 }} />
                    <Pressable
                        onPress={() => {
                            const next = { ...icons }
                            delete next[id]
                            setCustomIcons(next)
                        }}
                        style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}
                    >
                        <Text variant="text-sm/semibold" style={{ color: '#f23f43' }}>
                            Remove
                        </Text>
                    </Pressable>
                </View>
            ))}
            <Field label="Open icon (image URL)">
                <Input value={openUrl} placeholder="https://…" onChange={setOpenUrl} />
            </Field>
            <Field label="Closed icon (image URL)">
                <Input value={closedUrl} placeholder="https://… (optional)" onChange={setClosedUrl} />
            </Field>
            <Button
                text="Add icon"
                variant="secondary"
                size="md"
                disabled={!valid(openUrl)}
                onPress={() => {
                    if (!valid(openUrl)) return
                    const id = `custom_${Date.now().toString(36)}`
                    setCustomIcons({ ...icons, [id]: { open: openUrl.trim(), closed: valid(closedUrl) ? closedUrl.trim() : openUrl.trim() } })
                    setOpenUrl('')
                    setClosedUrl('')
                }}
            />
        </Card>
    )
}

function StatusCard() {
    const { Text } = D()
    const c = useMemo(palette, [])
    const [open, setOpen] = useState(false)
    const f = status.found
    const ok = (b: unknown) => (b ? 'ok' : 'missing')
    const rows: Array<[string, string]> = [
        ['Folder items', `${ok(f.folderItem)} · ${ok(f.transitionGroup)} · ${status.folderItems}`],
        ['Icons', `${svgXml() ? 'svg' : 'no svg'} · ${status.icons}`],
        ['Folder press', ok(f.toggle)],
        ['Column', `${ok(f.column)} · ${status.column}`],
        ['Menus', `${ok(f.folderMenu)} · ${ok(f.guildMenu)} · ${status.menus}`],
        ['Built-in icons', `${ICONS.length}`],
    ]
    if (status.lastError) rows.push(['Last error', status.lastError])
    return (
        <View style={{ borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 }}>
            <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="text-sm/semibold">Status</Text>
                <Text variant="text-lg/bold" color="text-muted" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
                    ›
                </Text>
            </Pressable>
            {open &&
                rows.map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                        <Text variant="text-xs/medium" color="text-muted">
                            {k}
                        </Text>
                        <Text variant="text-xs/medium" style={{ flexShrink: 1, textAlign: 'right', color: c.text }}>
                            {v}
                        </Text>
                    </View>
                ))}
        </View>
    )
}

export default function SettingsPage({ api }: { api?: any }) {
    const { Stack } = D()
    if (!hasStorage() && api?.jsonStorage) bindStorage(api.jsonStorage)
    useStore()
    const g = general()
    const set = (key: keyof General) => (v: boolean) => {
        if (key === 'extraColumn' && v !== g.extraColumn) {
            setGeneral({ extraColumn: v })
            moveOpenState(v)
            return
        }
        setGeneral({ [key]: v } as Partial<General>)
    }
    return (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Stack spacing={16} style={{ padding: 16, paddingBottom: 48 }}>
                <FolderCards />

                <Section title="Extra column">
                    <SwitchRow label="Extra column" subLabel="Open folders show their servers in a column next to the server list" value={g.extraColumn} onChange={set('extraColumn')} />
                    {g.extraColumn && <SwitchRow label="Separators" subLabel="Between folders in the column" value={g.addSeparators} onChange={set('addSeparators')} />}
                    {g.extraColumn && <SwitchRow label="Folder icon on top" subLabel="Tap it to close the folder" value={g.addFolderIcon} onChange={set('addFolderIcon')} />}
                </Section>

                <Section title="Behavior">
                    {BEHAVIOR.map(([key, label, sub]) => (
                        <SwitchRow key={key} label={label} subLabel={sub} value={g[key]} onChange={set(key)} />
                    ))}
                </Section>

                <Section title="Look">
                    <SwitchRow label="Server count" subLabel="Badge with the number of servers on each folder" value={g.showCountBadge} onChange={set('showCountBadge')} />
                    <CustomIcons />
                </Section>

                <StatusCard />
            </Stack>
        </ScrollView>
    )
}
