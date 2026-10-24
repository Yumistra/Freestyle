import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { createElement, useEffect, useState } from 'react'
import { Animated, Dimensions, Easing } from 'react-native'
import * as RN from 'react-native'
import { caskStyleOf } from '../effects'
import { active, report, status } from '../settings'

/**
 * Cask 3 (iOS 목록 스크롤 애니메이션)를 JS 목록(VirtualizedList/FlatList, FlashList, LegendList)에.
 * 목록의 renderItem 결과를 CaskCell 로 감싸서, 스크롤하는 동안 새로 그려지는 줄에 효과를 재생한다.
 * (네이티브 목록은 Cask.kt 가 맡는다)
 */

// ── 스크롤 중인지 ───────────────────────────────────────────────

let dragging = false
let until = 0
const scrolling = () => dragging || Date.now() < until

// ── 효과 ────────────────────────────────────────────────────────

const decel = Easing.out(Easing.quad)
const spring = (decay: number, freq: number) => (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-decay * t) * Math.cos(freq * t))

/** p: 0 → 1 로 움직이는 애니메이션 */
export function caskRun(style: string, p: Animated.Value, duration: number) {
    const timing = (easing: (t: number) => number, to = 1) => Animated.timing(p, { toValue: to, duration, easing, useNativeDriver: true })
    switch (style) {
        case 'bounce':
            return timing(spring(5, 14))
        case 'glitch':
            return timing(spring(2, 30))
        case 'zoom':
        case 'shake':
        case 'swing':
            return timing(Easing.linear)
        case 'jiggle':
            return timing(Easing.inOut(Easing.ease))
        case 'permanentColor':
            return Animated.loop(Animated.sequence([timing(Easing.linear, 1), timing(Easing.linear, 0)]))
        default:
            return timing(decel)
    }
}

const lerp = (p: any, from: any, to: any) => p.interpolate({ inputRange: [0, 1], outputRange: [from, to] })
const frames = (p: any, times: number[], values: any[]) => p.interpolate({ inputRange: times, outputRange: values, extrapolate: 'clamp' })

/** 줄의 스타일과 (컬러 효과면) 덮개 투명도 */
export function caskVisual(style: string, p: any, width: number): { style?: any; overlay?: any } {
    switch (style) {
        case 'fade':
            return { style: { opacity: p } }
        case 'flip':
            return { style: { transform: [{ perspective: 800 }, { rotateX: lerp(p, '180deg', '0deg') }] } }
        case 'bounce':
        case 'stretch':
            return { style: { transform: [{ scaleX: lerp(p, 0.01, 1) }] } }
        case 'glitch':
            return { style: { transform: [{ scaleX: lerp(p, 0.3, 1) }, { scaleY: lerp(p, 0.5, 1) }] } }
        case 'helix':
            return { style: { transform: [{ perspective: 800 }, { rotateY: lerp(p, '180deg', '0deg') }] } }
        case 'rotate':
            // 원본은 360 라디안(= 약 106°)에서 돌아온다
            return { style: { transform: [{ rotate: lerp(p, '106deg', '0deg') }] } }
        case 'zoom':
            return { style: { transform: [{ scale: lerp(p, 5, 1) }] } }
        case 'drop':
            return { style: { transform: [{ translateY: lerp(p, -150, 0) }] } }
        case 'slide':
            return { style: { transform: [{ translateX: lerp(p, width, 0) }] } }
        case 'shake':
            return { style: { transform: [{ translateX: frames(p, [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], [0, 10, -10, 10, -5, 5, -5, 0, 0]) }] } }
        case 'swing':
            return { style: { transform: [{ translateX: frames(p, [0, 0.16, 0.5, 0.83, 1], [0, 40, -50, 30, 0]) }] } }
        case 'jiggle': {
            const d = 0.075 * 57.29578
            return { style: { transform: [{ rotate: frames(p, [0, 0.2, 0.4, 0.6, 0.8, 1], ['0deg', `${-d}deg`, `${d}deg`, `${-d}deg`, `${d}deg`, '0deg']) }] } }
        }
        case 'color':
            return { overlay: lerp(p, 1, 0) }
        case 'permanentColor':
            return { overlay: lerp(p, 0.6, 0) }
        default:
            return {}
    }
}

export const randomColor = () => `rgb(${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)})`

const fill = { position: 'absolute' as const, top: 0, bottom: 0, left: 0, right: 0 }

function CaskCell({ children }: { children: any }) {
    const [st] = useState(() => {
        const m = active('lists')
        const style = caskStyleOf(m?.effect)
        const play = !!m && !!style && (m.always || scrolling())
        return { play, style: style ?? '', duration: m?.duration ?? 500, p: new Animated.Value(play ? 0 : 1), color: randomColor() }
    })
    useEffect(() => {
        if (!st.play) return
        status.listCells++
        const run = caskRun(st.style, st.p, st.duration)
        run.start()
        return () => run.stop()
    }, [])
    if (!st.play) return children
    const v = caskVisual(st.style, st.p, Dimensions.get('window').width)
    return createElement(
        Animated.View,
        { style: v.style },
        children,
        v.overlay ? createElement(Animated.View, { pointerEvents: 'none', style: [fill, { backgroundColor: st.color, opacity: v.overlay }] }) : null,
    )
}

// ── 목록 감싸기 ──────────────────────────────────────────────────

const renderCache = new WeakMap<Function, Function>()
const handlerCache = new WeakMap<Function, Function>()
const noop = () => {}

function keyOf(info: any) {
    const item = info?.item
    const k = item?.id ?? item?.key ?? item?.channel?.id ?? info?.index
    return k == null ? undefined : String(k)
}

function wrapRenderItem(orig: any) {
    if (typeof orig !== 'function') return orig
    let w = renderCache.get(orig)
    if (!w) {
        w = function (this: unknown, info: any) {
            const el = orig.apply(this, arguments as any)
            try {
                if (!el || !active('lists')) return el
                // FlashList 는 크기 재기·고정 머리줄에도 renderItem 을 부른다
                if (info?.target && info.target !== 'Cell') return el
                return createElement(CaskCell, { key: keyOf(info) }, el)
            } catch (e) {
                report('lists', e)
                return el
            }
        }
        renderCache.set(orig, w)
    }
    return w
}

function wrapHandler(orig: any, before: () => void) {
    if (orig !== undefined && typeof orig !== 'function') return orig
    const base = orig ?? noop
    let w = handlerCache.get(base)
    if (!w || orig === undefined) {
        w = function (this: unknown) {
            before()
            return base.apply(this, arguments as any)
        }
        if (orig !== undefined) handlerCache.set(base, w)
    }
    return w
}

const begin = () => {
    dragging = true
}
const endDrag = () => {
    dragging = false
    until = Date.now() + 800
}
const settle = () => {
    until = 0
}

function patchListType(type: any, name: string) {
    if (!type) return
    status.found[`list:${name}`] = true
    return beforeJSX(type, (args: any[]) => {
        try {
            const props = args[1]
            if (!props?.renderItem || !active('lists')) return args as any
            return [
                args[0],
                {
                    ...props,
                    renderItem: wrapRenderItem(props.renderItem),
                    onScrollBeginDrag: wrapHandler(props.onScrollBeginDrag, begin),
                    onScrollEndDrag: wrapHandler(props.onScrollEndDrag, endDrag),
                    onMomentumScrollEnd: wrapHandler(props.onMomentumScrollEnd, settle),
                },
                ...args.slice(2),
            ] as any
        } catch (e) {
            report('lists', e)
            return args as any
        }
    })
}

export function patchLists(cleanup: (...fns: Array<() => unknown>) => void) {
    const un = patchListType((RN as any).VirtualizedList, 'VirtualizedList')
    if (un) cleanup(un)
    const done = new Set<any>()
    for (const name of ['FlashList', 'LegendList']) {
        cleanup(
            getModules(
                withProps(name) as any,
                (mod: any) => {
                    const type = mod?.[name]
                    if (!type || done.has(type)) return
                    done.add(type)
                    const u = patchListType(type, name)
                    if (u) cleanup(u)
                },
                { max: 3 } as any,
            ) as any,
        )
    }
}
