import { Stores } from '@revenge-mod/discord/flux'
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native'
import { folderById, guildMentions, guildUnread, itemSize, openGuild, selectedGuildId } from '../discord'
import { setFolderOpen } from '../folders'
import { folderConfig, general, openFolders, status, useStore } from '../store'
import { palette } from './colors'
import { D, FolderGlyph, GuildAvatar, folderColors } from './parts'
import { openCustomize, openGuildOptions } from './sheets'

/** 디스코드 스토어가 바뀌면 다시 그린다 */
function useStores(names: string[]) {
    const [, set] = useState(0)
    useEffect(() => {
        const S = Stores as any
        const h = () => set(n => n + 1)
        const stores = names.map(n => S[n]).filter(s => typeof s?.addChangeListener === 'function')
        for (const s of stores) s.addChangeListener(h)
        return () => {
            for (const s of stores) s.removeChangeListener(h)
        }
    }, [])
}

function Pill({ selected, unread }: { selected: boolean; unread: boolean }) {
    const c = useMemo(palette, [])
    if (!selected && !unread) return null
    const h = selected ? 36 : 8
    return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: '50%', marginTop: -h / 2, width: 4, height: h, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: c.text }} />
}

function ColumnGuild({ id, size }: { id: string; size: number }) {
    const { Text } = D()
    const selected = selectedGuildId() === id
    const mentions = guildMentions(id)
    return (
        <View style={{ width: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Pill selected={selected} unread={guildUnread(id)} />
            <Pressable onPress={() => openGuild(id)} onLongPress={() => openGuildOptions(id)} delayLongPress={350} style={{ width: size, height: size }}>
                <GuildAvatar id={id} size={size} selected={selected} />
                {mentions > 0 ? (
                    <View pointerEvents="none" style={{ position: 'absolute', right: -4, bottom: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: '#f23f43', alignItems: 'center', justifyContent: 'center' }}>
                        <Text variant="text-xs/bold" style={{ color: '#ffffff' }}>
                            {mentions > 99 ? '99+' : String(mentions)}
                        </Text>
                    </View>
                ) : null}
            </Pressable>
        </View>
    )
}

function FolderHead({ id, size }: { id: number; size: number }) {
    const f = folderById(id)
    const { a, b } = folderColors(f?.folderColor, id)
    const cfg = folderConfig(id)
    return (
        <Pressable onPress={() => setFolderOpen(id, false)} onLongPress={() => openCustomize(id)} delayLongPress={350} style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: a + '33', alignItems: 'center', justifyContent: 'center' }}>
            <FolderGlyph iconId={cfg.iconId === 'default' ? 'classic' : cfg.iconId} open size={size * 0.72} a={a} b={b} />
        </Pressable>
    )
}

/**
 * 옆 칸: 연 폴더의 서버들을 서버 목록 바로 옆에 세로로 (BetterDiscord ServerFolders 의 extra column).
 * 채널 목록(또는 DM 목록) 왼쪽에 붙어서 그만큼 목록을 민다.
 */
export function Column() {
    useStore()
    useStores(['SelectedGuildStore', 'GuildReadStateStore', 'SortedGuildStore', 'GuildStore'])
    const c = useMemo(palette, [])
    const g = general()
    const size = itemSize()
    const width = size + 24
    const groups = g.extraColumn ? [...openFolders()].map(id => folderById(id)).filter(f => !!f && f.guildIds.length) : []
    const shown = groups.length > 0
    const anim = useRef(new Animated.Value(shown ? 1 : 0)).current
    // 닫히는 동안은 마지막 내용을 그대로 보여 준다
    const last = useRef(groups)
    if (shown) last.current = groups
    useEffect(() => {
        Animated.timing(anim, { toValue: shown ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
    }, [shown])
    if (shown) status.column++
    const list = shown ? groups : last.current
    return (
        <Animated.View style={{ width: anim.interpolate({ inputRange: [0, 1], outputRange: [0, width] }), overflow: 'hidden' }}>
            <View style={{ width, flex: 1, backgroundColor: c.base, borderRightWidth: 1, borderRightColor: c.border }}>
                <ScrollView contentContainerStyle={{ paddingVertical: 12, gap: 8 }} showsVerticalScrollIndicator={false}>
                    {list.map((f, i) => (
                        <View key={f!.folderId} style={{ gap: 8, alignItems: 'center' }}>
                            {i > 0 && g.addSeparators ? <View style={{ width: size * 0.66, height: 2, borderRadius: 1, backgroundColor: c.border, marginVertical: 2 }} /> : null}
                            {g.addFolderIcon ? <FolderHead id={f!.folderId!} size={size} /> : null}
                            {f!.guildIds.map(id => (
                                <ColumnGuild key={id} id={id} size={size} />
                            ))}
                        </View>
                    ))}
                </ScrollView>
            </View>
        </Animated.View>
    )
}

/** 채널 목록 감싸기: [옆 칸][원래 목록] */
export function ColumnHost({ __type, __props }: { __type: any; __props: any }) {
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <Column />
            <View style={{ flex: 1 }}>{createElement(__type, __props)}</View>
        </View>
    )
}
