import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { DEFAULT_PREVIEW, easingFrom, effectOf, normalize, springFor, type EasingKey, type Hidden, type ModuleKey } from '../effects'
import { makeCardInterpolator } from '../interpolate'
import type { ModuleSettings } from '../settings'
import { palette } from './colors'

/**
 * 설정 화면 미리보기. 실제 패치와 같은 효과 정의로 react-native Animated 를 돌린다.
 * 0 → 1 (나타남) → 잠깐 멈춤 → 0 (사라짐) 을 반복한다.
 */

const HEIGHT = 170

function useLoop(duration: number, easing: EasingKey, instant: boolean) {
    const p = useRef(new Animated.Value(0)).current
    useEffect(() => {
        const to = (v: number) =>
            instant
                ? Animated.timing(p, { toValue: v, duration: 0, useNativeDriver: true })
                : easing === 'spring'
                  ? Animated.spring(p, { toValue: v, ...springFor(duration, 0.55), useNativeDriver: true } as any)
                  : Animated.timing(p, { toValue: v, duration, easing: easingFrom(Easing, easing), useNativeDriver: true })
        p.setValue(0)
        const loop = Animated.loop(Animated.sequence([Animated.delay(450), to(1), Animated.delay(1200), to(0), Animated.delay(350)]))
        loop.start()
        return () => loop.stop()
    }, [duration, easing, instant])
    return p
}

const lerp = (p: any, from: any, to: any) => p.interpolate({ inputRange: [0, 1], outputRange: [from, to] })

/** hidden → 원래 모습 스타일 (확인창·토스트·메뉴·아래 창 미리보기) */
function styleFrom(p: any, hidden: Hidden | undefined, W: number, H: number, extra?: { anchorX?: number; anchorY?: number; halfW?: number; halfH?: number; edge?: number }) {
    const h = normalize(hidden)
    const ax = h.anchor ? (extra?.anchorX ?? 0) * (extra?.halfW ?? 0) * (1 - h.s) : 0
    const ay = h.anchor ? (extra?.anchorY ?? 0) * (extra?.halfH ?? 0) * (1 - h.s * h.sy) : 0
    const tx = ax + h.tx + h.txW * W
    const ty = ay + (h.edge ? (extra?.edge ?? 0) : 0) + h.ty + h.tyH * H
    const transform: any[] = [{ perspective: 800 }]
    if (tx) transform.push({ translateX: lerp(p, tx, 0) })
    if (ty) transform.push({ translateY: lerp(p, ty, 0) })
    if (h.s !== 1) transform.push({ scale: lerp(p, h.s, 1) })
    if (h.sy !== 1) transform.push({ scaleY: lerp(p, h.sy, 1) })
    if (h.r) transform.push({ rotate: lerp(p, `${h.r}deg`, '0deg') })
    if (h.rx) transform.push({ rotateX: lerp(p, `${h.rx}deg`, '0deg') })
    if (h.ry) transform.push({ rotateY: lerp(p, `${h.ry}deg`, '0deg') })
    const style: any = { transform }
    if (h.o !== 1) style.opacity = p.interpolate({ inputRange: [0, 0.6, 1], outputRange: [h.o, 1, 1] })
    return style
}

function Bars({ color, widths, gap = 7 }: { color: string; widths: string[]; gap?: number }) {
    return (
        <View style={{ gap }}>
            {widths.map((w, i) => (
                <View key={i} style={{ height: 7, width: w as any, borderRadius: 4, backgroundColor: color }} />
            ))}
        </View>
    )
}

function FakeScreen({ title, c, tone }: { title: string; c: ReturnType<typeof palette>; tone: string }) {
    return (
        <View style={{ flex: 1, backgroundColor: tone, padding: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.brand }} />
                <View style={{ height: 8, width: title as any, borderRadius: 4, backgroundColor: c.text }} />
            </View>
            <Bars color={c.muted} widths={['85%', '60%', '72%', '40%']} />
        </View>
    )
}

export default function Preview({ module, settings }: { module: ModuleKey; settings: ModuleSettings }) {
    const c = useMemo(palette, [])
    const [W, setW] = useState(320)
    const isDefault = settings.effect === 'default'
    const shown = isDefault ? DEFAULT_PREVIEW[module] : settings
    const instant = shown.effect === 'none'
    // 네이티브 화면은 속도를 못 바꾼다
    const duration = module === 'push' || module === 'modal' ? 320 : shown.duration
    const easing: EasingKey = module === 'push' || module === 'modal' ? 'out' : shown.easing
    const p = useLoop(duration, easing, instant)
    const one = useRef(new Animated.Value(1)).current
    const effect = effectOf(module, shown.effect)

    let body: any
    const isScreen = module === 'stack' || module === 'push' || module === 'modal' || module === 'panel'
    if (isScreen) {
        const layouts = { screen: { width: W, height: HEIGHT } }
        const interp = makeCardInterpolator(instant ? { id: 'none', label: '' } : effect)
        const top = interp({ current: { progress: p }, inverted: one, layouts })
        const under = interp({ current: { progress: one }, next: { progress: p }, inverted: one, layouts })
        const topStyle = instant ? { opacity: p.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] }) } : top.cardStyle
        body = (
            <>
                <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, under.cardStyle]}>
                    <FakeScreen title="40%" c={c} tone={c.surface} />
                </Animated.View>
                {top.overlayStyle && <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000' }, top.overlayStyle]} />}
                <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, topStyle]}>
                    <FakeScreen title="55%" c={c} tone={c.raised} />
                </Animated.View>
            </>
        )
    } else if (module === 'folder') {
        // 서버 목록: 폴더 아이콘 아래로 서버 아이콘 셋이 나타난다
        const size = 30
        body = (
            <View style={{ position: 'absolute', top: 10, bottom: 10, left: 14, width: 52, borderRadius: 26, backgroundColor: c.surface, alignItems: 'center', paddingTop: 10, gap: 8 }}>
                <View style={{ width: size + 6, height: size + 6, borderRadius: 12, backgroundColor: c.brandSoft }} />
                {[0, 1, 2].map(i => (
                    <Animated.View key={i} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: i === 1 ? c.brand : c.raised }, styleFrom(p, effect.hidden, W, HEIGHT, { edge: -(size + 8) })]} />
                ))}
            </View>
        )
    } else if (module === 'subtle') {
        // 체크박스·라디오·스위치
        body = (
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 28 }}>
                <View style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
                    <Animated.View style={[{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.brand }, styleFrom(p, effect.hidden, W, HEIGHT)]} />
                </View>
                <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
                    <Animated.View style={[{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.brand }, styleFrom(p, effect.hidden, W, HEIGHT)]} />
                </View>
                <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: c.raised, justifyContent: 'center', paddingHorizontal: 3 }}>
                    <Animated.View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.brand, transform: [{ translateX: lerp(p, 0, 22) }] }} />
                </View>
            </View>
        )
    } else if (module === 'sheet') {
        body = (
            <>
                <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', opacity: lerp(p, 0, 0.45) }} />
                <Animated.View
                    style={[
                        { position: 'absolute', left: 8, right: 8, bottom: 0, height: 104, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: c.raised, padding: 14, gap: 10 },
                        { transform: [{ translateY: lerp(p, 120, 0) }] },
                    ]}
                >
                    <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: c.muted }} />
                    <Bars color={c.muted} widths={['70%', '55%', '62%']} />
                </Animated.View>
            </>
        )
    } else if (module === 'menu') {
        const halfW = 60
        const halfH = 50
        body = (
            <>
                <View style={{ position: 'absolute', top: 12, right: 14, width: 26, height: 26, borderRadius: 13, backgroundColor: c.brandSoft }} />
                <Animated.View
                    style={[
                        { position: 'absolute', top: 44, right: 14, width: halfW * 2, height: halfH * 2, borderRadius: 12, backgroundColor: c.raised, padding: 12, gap: 12, borderWidth: 1, borderColor: c.border },
                        styleFrom(p, effect.hidden, W, HEIGHT, { anchorX: 1, anchorY: -1, halfW, halfH }),
                    ]}
                >
                    <Bars color={c.muted} widths={['80%', '60%', '70%']} gap={12} />
                </Animated.View>
            </>
        )
    } else if (module === 'alert') {
        body = (
            <>
                <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', opacity: lerp(p, 0, 0.5) }} />
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Animated.View style={[{ width: Math.min(220, W - 60), borderRadius: 16, backgroundColor: c.raised, padding: 14, gap: 12 }, styleFrom(p, effect.hidden, W, HEIGHT)]}>
                        <View style={{ height: 9, width: '50%', borderRadius: 4, backgroundColor: c.text }} />
                        <Bars color={c.muted} widths={['90%', '70%']} />
                        <View style={{ height: 22, borderRadius: 11, backgroundColor: c.brand }} />
                    </Animated.View>
                </View>
            </>
        )
    } else {
        body = (
            <View style={{ position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' }}>
                <Animated.View
                    style={[
                        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: c.raised, borderWidth: 1, borderColor: c.border },
                        styleFrom(p, effect.hidden, W, HEIGHT, { edge: -50 }),
                    ]}
                >
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.brand }} />
                    <View style={{ height: 7, width: 90, borderRadius: 4, backgroundColor: c.text }} />
                </Animated.View>
            </View>
        )
    }

    return (
        <View
            onLayout={e => setW(Math.round(e.nativeEvent.layout.width))}
            style={{ height: HEIGHT, borderRadius: 14, overflow: 'hidden', backgroundColor: isScreen ? c.surface : c.base }}
        >
            {(module === 'sheet' || module === 'alert' || module === 'toast' || module === 'menu') && (
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: 14 }}>
                    <Bars color={c.border} widths={['70%', '50%', '80%', '45%', '65%', '55%']} gap={12} />
                </View>
            )}
            {body}
        </View>
    )
}
