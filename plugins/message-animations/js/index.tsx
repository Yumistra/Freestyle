/**
 * Message Animations — JS 쪽 (설정 화면).
 * 실제 애니메이션은 네이티브(plugin.jar)가 채팅 목록에서 재생한다. 여기서는 설정을 저장하고 네이티브에 다시 읽으라고 알린다.
 */

import { Design } from '@revenge-mod/discord/design'
import { callNativeMethod } from '@revenge-mod/modules/native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native'

const ID = 'yumistra.message-animations'

type EasingKey = 'out' | 'expo' | 'smooth' | 'linear' | 'back' | 'spring' | 'bounce' | 'elastic'

interface Settings {
    enabled: boolean
    effect: string
    duration: number
    easing: EasingKey
    stagger: number
}

const DEFAULTS: Settings = { enabled: true, effect: 'rise', duration: 320, easing: 'out', stagger: 30 }

/** 네이티브 쪽 Hidden 과 같은 값 (미리보기용) */
const EFFECTS: Array<{ id: string; label: string; hidden?: { dy?: number; dx?: number; scale?: number; rx?: number } }> = [
    { id: 'rise', label: '떠오르기', hidden: { dy: 28 } },
    { id: 'fade', label: '페이드', hidden: {} },
    { id: 'slip', label: '오른쪽에서', hidden: { dx: 40 } },
    { id: 'side', label: '왼쪽에서', hidden: { dx: -48 } },
    { id: 'scale', label: '확대', hidden: { scale: 0.9 } },
    { id: 'pop', label: '톡', hidden: { scale: 0.6 } },
    { id: 'drop', label: '떨어지기', hidden: { dy: 40, scale: 0.92 } },
    { id: 'flip', label: '플립', hidden: { rx: 70 } },
    { id: 'none', label: '없음' },
]

const EASINGS: Array<{ id: EasingKey; label: string }> = [
    { id: 'out', label: '감속' },
    { id: 'expo', label: '빠르게' },
    { id: 'smooth', label: '부드럽게' },
    { id: 'linear', label: '일정하게' },
    { id: 'back', label: '살짝 튕김' },
    { id: 'spring', label: '스프링' },
    { id: 'bounce', label: '통통' },
    { id: 'elastic', label: '고무줄' },
]

function rnEasing(key: EasingKey) {
    switch (key) {
        case 'linear':
            return Easing.linear
        case 'smooth':
            return Easing.inOut(Easing.ease)
        case 'expo':
            return Easing.bezier(0.16, 1, 0.3, 1)
        case 'back':
            return Easing.out(Easing.back(1.6))
        case 'bounce':
            return Easing.bounce
        case 'spring':
            return (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(12 * t))
        case 'elastic':
            return (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-4 * t) * Math.cos(18 * t))
        default:
            return Easing.out(Easing.quad)
    }
}

let storage: any
const settings = (): Settings => ({ ...DEFAULTS, ...(storage?.cache ?? {}) })

const D = () => Design as any

function Chips<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange(v: T): void }) {
    const { Text } = D()
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {items.map(item => {
                const on = item.id === value
                return (
                    <Pressable
                        key={item.id}
                        onPress={() => onChange(item.id)}
                        style={{
                            paddingHorizontal: 14,
                            height: 34,
                            borderRadius: 17,
                            justifyContent: 'center',
                            backgroundColor: on ? '#5865f2' : 'rgba(127,127,127,0.15)',
                        }}
                    >
                        <Text variant="text-sm/semibold" style={on ? { color: '#ffffff' } : undefined}>
                            {item.label}
                        </Text>
                    </Pressable>
                )
            })}
        </ScrollView>
    )
}

/** 가짜 채팅 줄 네 개가 차례로 나타나는 미리보기 */
function Preview({ s }: { s: Settings }) {
    const values = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current
    const effect = EFFECTS.find(e => e.id === s.effect)
    useEffect(() => {
        const show = Animated.stagger(
            s.stagger,
            values.map(v => Animated.timing(v, { toValue: 1, duration: s.effect === 'none' ? 0 : s.duration, easing: rnEasing(s.easing), useNativeDriver: true })),
        )
        const loop = Animated.loop(
            Animated.sequence([
                Animated.parallel(values.map(v => Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }))),
                Animated.delay(400),
                show,
                Animated.delay(1400),
            ]),
        )
        loop.start()
        return () => loop.stop()
    }, [s.effect, s.duration, s.easing, s.stagger])

    const h = effect?.hidden
    return (
        <View style={{ height: 200, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.1)', padding: 12, justifyContent: 'flex-end', gap: 10 }}>
            {values.map((p, i) => {
                const style: any = {}
                if (h) {
                    style.opacity = p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' })
                    const t: any[] = [{ perspective: 600 }]
                    if (h.dy) t.push({ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [h.dy, 0] }) })
                    if (h.dx) t.push({ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [h.dx, 0] }) })
                    if (h.scale) t.push({ scale: p.interpolate({ inputRange: [0, 1], outputRange: [h.scale, 1] }) })
                    if (h.rx) t.push({ rotateX: p.interpolate({ inputRange: [0, 1], outputRange: [`${h.rx}deg`, '0deg'] }) })
                    style.transform = t
                }
                return (
                    <Animated.View key={i} style={[{ flexDirection: 'row', gap: 10, alignItems: 'center' }, style]}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i % 2 ? '#5865f2' : '#eb459e' }} />
                        <View style={{ gap: 5, flex: 1 }}>
                            <View style={{ width: 70, height: 7, borderRadius: 4, backgroundColor: 'rgba(127,127,127,0.6)' }} />
                            <View style={{ width: `${55 + ((i * 17) % 35)}%` as any, height: 7, borderRadius: 4, backgroundColor: 'rgba(127,127,127,0.35)' }} />
                        </View>
                    </Animated.View>
                )
            })}
        </View>
    )
}

function SettingsPage({ api }: { api?: any }) {
    const { Stack, Text, TableRowGroup, TableSwitchRow, Slider } = D()
    storage ??= api?.jsonStorage
    const [s, setS] = useState<Settings>(settings)
    const [native, setNative] = useState<boolean | null>(null)
    const [duration, setDuration] = useState(s.duration)
    const [stagger, setStagger] = useState(s.stagger)

    useEffect(() => {
        callNativeMethod(`${ID}.ping` as any, [] as any)
            .then(() => setNative(true))
            .catch(() => setNative(false))
    }, [])

    const save = async (patch: Partial<Settings>) => {
        const next = { ...s, ...patch }
        setS(next)
        try {
            await storage?.set(next, true)
            await callNativeMethod(`${ID}.reload` as any, [] as any)
        } catch {}
    }

    const c = useMemo(() => ({ muted: 'text-muted' }), [])

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack spacing={16} style={{ padding: 16, paddingBottom: 48 }}>
                {native === false && (
                    <Text variant="text-sm/semibold" style={{ color: '#f23f43' }}>
                        네이티브 부분(plugin.jar)이 실리지 않았어요. 플러그인 ZIP 에 plugin.jar 가 들어 있는지, 앱을 다시 시작했는지 확인해 주세요.
                    </Text>
                )}
                <TableRowGroup>
                    <TableSwitchRow label="메시지 애니메이션" subLabel="채팅에서 메시지가 나타날 때 효과" value={s.enabled} onValueChange={(enabled: boolean) => save({ enabled })} />
                </TableRowGroup>

                <Preview s={{ ...s, duration, stagger }} />

                <Stack spacing={8}>
                    <Text variant="text-sm/semibold" color={c.muted}>
                        효과
                    </Text>
                    <Chips items={EFFECTS} value={s.effect} onChange={effect => save({ effect })} />
                </Stack>

                {s.effect !== 'none' && (
                    <>
                        <Stack spacing={6}>
                            <Text variant="text-sm/semibold" color={c.muted}>
                                {`속도 · ${duration}ms`}
                            </Text>
                            {Slider && (
                                <Slider
                                    value={duration}
                                    minimumValue={100}
                                    maximumValue={1000}
                                    step={20}
                                    onValueChange={(v: number) => setDuration(Math.round(v))}
                                    onSlidingComplete={(v: number) => save({ duration: Math.round(v) })}
                                />
                            )}
                        </Stack>
                        <Stack spacing={8}>
                            <Text variant="text-sm/semibold" color={c.muted}>
                                움직임
                            </Text>
                            <Chips items={EASINGS} value={s.easing} onChange={(easing: EasingKey) => save({ easing })} />
                        </Stack>
                        <Stack spacing={6}>
                            <Text variant="text-sm/semibold" color={c.muted}>
                                {`차례로 나타나는 간격 · ${stagger}ms`}
                            </Text>
                            {Slider && (
                                <Slider
                                    value={stagger}
                                    minimumValue={0}
                                    maximumValue={120}
                                    step={5}
                                    onValueChange={(v: number) => setStagger(Math.round(v))}
                                    onSlidingComplete={(v: number) => save({ stagger: Math.round(v) })}
                                />
                            )}
                        </Stack>
                    </>
                )}

                <Text variant="text-xs/normal" color={c.muted}>
                    채널을 열 때 보이는 메시지, 스크롤해서 새로 보이는 메시지, 새로 온 메시지에 적용돼요. 바꾼 설정은 바로 적용돼요.
                </Text>
            </Stack>
        </ScrollView>
    )
}

export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },
    start({ jsonStorage }: any) {
        storage = jsonStorage
    },
    SettingsComponent: SettingsPage,
} as any)
