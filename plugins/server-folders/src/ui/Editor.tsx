import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { folderById, hexToInt, intToHex } from '../discord'
import { deleteFolder, folderLabel, isFolderMuted, setFolderMuted, updateFolder } from '../folders'
import { ICONS } from '../icons'
import { customIcons, folderConfig, setFolderConfig, useStore } from '../store'
import { palette } from './colors'
import { D, Field, FolderGlyph, Input, Swatches, SwitchRow } from './parts'

let seq = 0

export function confirmDelete(folderId: number, onDone?: () => void) {
    const { AlertModal, AlertActionButton, Text } = D()
    const name = folderLabel(folderById(folderId))
    AlertActionCreators.openAlert(
        `server-folders-delete-${seq++}`,
        <AlertModal
            title="Delete folder?"
            content={<Text variant="text-md/normal">{`"${name}" is removed. Its servers stay in your server list.`}</Text>}
            actions={
                <>
                    <AlertActionButton
                        text="Delete"
                        variant="destructive"
                        onPress={() => {
                            deleteFolder(folderId)
                            onDone?.()
                        }}
                    />
                    <AlertActionButton text="Cancel" variant="secondary" />
                </>
            }
        />,
    )
}

/** 아이콘 고르기 칸 하나 */
function Tile({ on, onPress, children, label }: { on: boolean; onPress(): void; children: any; label?: string }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <Pressable
            onPress={onPress}
            style={{ width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.brandSoft : c.base, borderWidth: 2, borderColor: on ? c.brand : 'transparent' }}
        >
            {children ?? (
                <Text variant="text-xs/semibold" style={{ color: c.muted }}>
                    {label}
                </Text>
            )}
        </Pressable>
    )
}

export function IconPicker({ value, a, b, onChange }: { value: string; a: string; b: string; onChange(id: string): void }) {
    const custom = customIcons()
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Tile on={value === 'default'} onPress={() => onChange('default')} label="Discord">
                {null}
            </Tile>
            {ICONS.map(i => (
                <Tile key={i.id} on={value === i.id} onPress={() => onChange(i.id)}>
                    <FolderGlyph iconId={i.id} open={false} size={40} a={a} b={b} />
                </Tile>
            ))}
            {Object.keys(custom).map(id => (
                <Tile key={id} on={value === id} onPress={() => onChange(id)}>
                    <FolderGlyph iconId={id} open={false} size={40} a={a} b={b} />
                </Tile>
            ))}
        </View>
    )
}

/**
 * 폴더 꾸미기 (이름·색·아이콘·알림). 아래 창과 설정 화면에서 같이 쓴다.
 * 이름·색은 디스코드 폴더에 저장되고, 나머지는 플러그인에 저장된다.
 */
export function FolderEditor({ folderId, onSaved }: { folderId: number; onSaved?(): void }) {
    const { Text, Button } = D()
    const c = useMemo(palette, [])
    useStore()
    const folder = folderById(folderId)
    const cfg = folderConfig(folderId)
    const [name, setName] = useState(folder?.folderName ?? '')
    const [color, setColor] = useState<string | undefined>(intToHex(folder?.folderColor))
    const [color2, setColor2] = useState(cfg.color2)
    const [iconId, setIconId] = useState(cfg.iconId)
    const [closedIcon, setClosedIcon] = useState(cfg.useClosedIcon)
    if (!folder) {
        return (
            <Text variant="text-md/medium" color="text-muted">
                This folder no longer exists.
            </Text>
        )
    }
    const a = color ?? '#5865f2'
    const muted = isFolderMuted(folder)

    const save = () => {
        const nextName = name.trim()
        const nextColor = color ? hexToInt(color) : undefined
        if (nextName !== (folder.folderName ?? '') || nextColor !== folder.folderColor) updateFolder(folderId, { folderName: nextName || undefined, folderColor: nextColor })
        setFolderConfig(folderId, { iconId, color2, useClosedIcon: closedIcon })
        onSaved?.()
    }

    return (
        <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, backgroundColor: c.base }}>
                {[false, true].map(open => (
                    <View key={String(open)} style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }}>
                        {iconId === 'default' ? (
                            <Text variant="text-xs/semibold" style={{ color: a }}>
                                {open ? 'Open' : 'Closed'}
                            </Text>
                        ) : (
                            <FolderGlyph iconId={iconId} open={open} size={40} a={a} b={color2} />
                        )}
                    </View>
                ))}
                <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="text-md/semibold" numberOfLines={1}>
                        {name.trim() || folderLabel(folder)}
                    </Text>
                    <Text variant="text-xs/medium" style={{ color: c.muted }}>
                        {`${folder.guildIds.length} server${folder.guildIds.length === 1 ? '' : 's'}`}
                    </Text>
                </View>
            </View>

            <Field label="Name">
                <Input value={name} placeholder={folderLabel(folder)} maxLength={32} onChange={setName} />
            </Field>
            <Field label="Color">
                <Swatches value={color} onChange={setColor} allowNone />
            </Field>
            <Field label="Icon">
                <IconPicker value={iconId} a={a} b={color2} onChange={setIconId} />
            </Field>
            {iconId !== 'default' && (
                <Field label="Second color">
                    <Swatches value={color2} onChange={v => setColor2(v ?? '#ffffff')} />
                </Field>
            )}
            {iconId !== 'default' && <SwitchRow label="Icon when closed" subLabel="Instead of the server preview" value={closedIcon} onChange={setClosedIcon} />}

            <SwitchRow label="Mute folder" value={muted} onChange={v => setFolderMuted(folderId, v)} />
            <SwitchRow label="Auto read" subLabel="Marks the folder as read shortly after something new arrives" value={cfg.autoRead} onChange={autoRead => setFolderConfig(folderId, { autoRead })} />

            <Button text="Save" variant="primary" size="md" onPress={save} />
            <Button text="Delete folder" variant="destructive" size="md" onPress={() => confirmDelete(folderId, onSaved)} />
        </View>
    )
}
