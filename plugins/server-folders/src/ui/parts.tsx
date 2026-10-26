import { Design } from '@revenge-mod/discord/design'
import { createElement, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native'
import { getGuild, guildIconModule, intToHex, svgXml } from '../discord'
import { iconById } from '../icons'
import { customIcons, folderConfig } from '../store'
import { palette, withAlpha } from './colors'

export const D = () => Design as any

/** 폴더 색 고르기용 (디스코드 폴더 색 + 몇 개 더) */
export const SWATCHES = [
    '#5865f2',
    '#3ba55c',
    '#faa61a',
    '#ed4245',
    '#eb459e',
    '#c92e5c',
    '#9b59b6',
    '#1abc9c',
    '#3498db',
    '#e67e22',
    '#f1c40f',
    '#95a5a6',
    '#607d8b',
    '#ffffff',
    '#23272a',
]

// ── 작은 부품 (Better Animations 설정 화면과 같은 모양) ─────────────

export function Chips<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange(v: T): void }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {items.map(item => {
                const on = item.id === value
                return (
                    <Pressable
                        key={item.id}
                        onPress={() => onChange(item.id)}
                        style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? c.brand : c.surface, borderWidth: 1, borderColor: on ? c.brand : c.border }}
                    >
                        <Text variant="text-sm/semibold" style={{ color: on ? '#ffffff' : c.text }}>
                            {item.label}
                        </Text>
                    </Pressable>
                )
            })}
        </ScrollView>
    )
}

export function Field({ label, trailing, children }: { label: string; trailing?: string; children: any }) {
    const { Text } = D()
    return (
        <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="text-sm/semibold" color="text-muted">
                    {label}
                </Text>
                {trailing ? (
                    <Text variant="text-sm/semibold" color="text-muted">
                        {trailing}
                    </Text>
                ) : null}
            </View>
            {children}
        </View>
    )
}

export function SwitchRow({ label, subLabel, value, onChange }: { label: string; subLabel?: string; value: boolean; onChange(v: boolean): void }) {
    const { TableRowGroup, TableSwitchRow } = D()
    return (
        <TableRowGroup>
            <TableSwitchRow label={label} subLabel={subLabel} value={value} onValueChange={onChange} />
        </TableRowGroup>
    )
}

export function Chevron({ open }: { open: boolean }) {
    const { Text } = D()
    return (
        <Text variant="text-lg/bold" color="text-muted" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
            ›
        </Text>
    )
}

export function Section({ title, children }: { title: string; children: any }) {
    const { Text } = D()
    return (
        <View style={{ gap: 8 }}>
            <Text variant="text-xs/bold" color="text-muted" style={{ marginLeft: 4, letterSpacing: 0.6 }}>
                {title.toUpperCase()}
            </Text>
            <View style={{ gap: 8 }}>{children}</View>
        </View>
    )
}

/** 접었다 펴는 카드 */
export function Card({ title, subtitle, leading, open, onToggle, children, accent }: { title: string; subtitle?: string; leading?: any; open?: boolean; onToggle?(): void; children?: any; accent?: boolean }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <View style={{ borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: open ? c.brandSoft : c.border, overflow: 'hidden' }}>
            <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
                {leading}
                <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="text-md/semibold" numberOfLines={1}>
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text variant="text-xs/medium" style={{ color: accent ? c.brand : c.muted }} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    ) : null}
                </View>
                {onToggle ? <Chevron open={!!open} /> : null}
            </Pressable>
            {open && children ? <View style={{ paddingHorizontal: 14, paddingBottom: 16, gap: 14 }}>{children}</View> : null}
        </View>
    )
}

/** 글 입력 (디스코드 테마 색) */
export function Input({ value, placeholder, onChange, onSubmit, maxLength }: { value: string; placeholder?: string; onChange(v: string): void; onSubmit?(): void; maxLength?: number }) {
    const c = useMemo(palette, [])
    return (
        <TextInput
            value={value}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            maxLength={maxLength}
            autoCorrect={false}
            style={{ height: 44, borderRadius: 12, paddingHorizontal: 14, backgroundColor: c.base, borderWidth: 1, borderColor: c.border, color: c.text, fontSize: 15 }}
        />
    )
}

/** 색 고르기: 동그라미 + 직접 입력 */
export function Swatches({ value, onChange, allowNone }: { value?: string; onChange(v: string | undefined): void; allowNone?: boolean }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    const [hex, setHex] = useState(value ?? '')
    const pick = (v: string | undefined) => {
        setHex(v ?? '')
        onChange(v)
    }
    const norm = (v?: string) => (v ?? '').toLowerCase()
    return (
        <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {allowNone && (
                    <Pressable
                        onPress={() => pick(undefined)}
                        style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: value ? c.border : c.brand, alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Text variant="text-xs/bold" style={{ color: c.muted }}>
                            ∅
                        </Text>
                    </Pressable>
                )}
                {SWATCHES.map(s => {
                    const on = norm(s) === norm(value)
                    return (
                        <Pressable key={s} onPress={() => pick(s)} style={{ width: 34, height: 34, borderRadius: 17, padding: 3, borderWidth: 2, borderColor: on ? c.brand : 'transparent' }}>
                            <View style={{ flex: 1, borderRadius: 14, backgroundColor: s, borderWidth: 1, borderColor: c.border }} />
                        </Pressable>
                    )
                })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: /^#[0-9a-f]{6}$/i.test(hex) ? hex : 'transparent', borderWidth: 1, borderColor: c.border }} />
                <View style={{ flex: 1 }}>
                    <Input
                        value={hex}
                        placeholder="#rrggbb"
                        maxLength={7}
                        onChange={v => {
                            const t = v.startsWith('#') ? v : `#${v}`
                            setHex(t)
                            if (/^#[0-9a-f]{6}$/i.test(t)) onChange(t.toLowerCase())
                        }}
                    />
                </View>
            </View>
        </View>
    )
}

// ── 폴더 아이콘 ───────────────────────────────────────────────────

/** 이 폴더의 아이콘 색 (A: 폴더 색, B: 두 번째 색) */
export function folderColors(folderColor: number | undefined, folderId?: number | null) {
    const a = intToHex(folderColor) ?? '#5865f2'
    const b = folderConfig(folderId).color2 || '#ffffff'
    return { a, b }
}

/**
 * 고른 아이콘을 그린다. 'default' 거나 그릴 수 없으면 null (그 자리는 디스코드 것)
 */
export function FolderGlyph({ iconId, open, size, a, b }: { iconId: string; open: boolean; size: number; a: string; b: string }) {
    if (!iconId || iconId === 'default') return null
    const custom = customIcons()[iconId]
    if (custom) {
        const uri = (open ? custom.open : custom.closed) || custom.open || custom.closed
        if (!uri) return null
        return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.22 }} resizeMode="cover" />
    }
    const set = iconById(iconId)
    const SvgXml = svgXml()
    if (!set || !SvgXml) return null
    return createElement(SvgXml, { xml: open ? set.open(a, b) : set.closed(a, b), width: size, height: size })
}

/** 디스코드 서버 아이콘 (못 쓰면 이미지·글자로) */
export function GuildAvatar({ id, size, selected }: { id: string; size: number; selected?: boolean }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    const guild = getGuild(id)
    const mod = guildIconModule()
    const GuildIcon = mod?.default
    if (guild && GuildIcon) {
        const sizes = mod.GuildIconSizes ?? {}
        const key = size >= 64 ? 'XLARGE' : size >= 48 ? 'LARGE' : size >= 40 ? 'NORMAL' : size >= 32 ? 'SMALL_32' : 'SMALL'
        return createElement(GuildIcon, { guild, size: sizes[key] ?? key, selected: !!selected, animate: false })
    }
    let uri: string | undefined
    try {
        uri = guild?.getIconURL?.(size * 2, false) ?? undefined
    } catch {}
    if (!uri && guild?.icon) uri = `https://cdn.discordapp.com/icons/${id}/${guild.icon}.png?size=${size * 2}`
    const radius = selected ? size * 0.32 : size / 2
    if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
    const acronym = String(guild?.acronym ?? guild?.name ?? '?')
        .split(/\s+/)
        .map((w: string) => w[0])
        .join('')
        .slice(0, 3)
    return (
        <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="text-sm/semibold">{acronym}</Text>
        </View>
    )
}

export const soft = (hex: string, a: number) => withAlpha(hex, a)
