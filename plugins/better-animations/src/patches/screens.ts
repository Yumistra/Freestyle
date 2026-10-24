import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { createContext, createElement, isValidElement, useContext, useEffect, useState } from 'react'
import { Animated, Dimensions, Easing } from 'react-native'
import { easingFrom, effectOf, springFor } from '../effects'
import { makeCardInterpolator } from '../interpolate'
import { active, report, status } from '../settings'

/**
 * 디스코드 설정·프로필·검색 같은 화면은 안드로이드 네이티브 스택(react-native-screens)이다.
 *
 * 1. 네이티브 전환은 정해진 종류만 고를 수 있어서 화면 요소(RNSScreen)의 stackAnimation 을 바꾼다.
 * 2. "화면 전환"에서 직접 만든 효과를 고르면, 새로 쌓이는 화면의 내용을 Animated.View 로 감싸
 *    나타날 때 그 효과를 재생한다. (나갈 때는 네이티브 전환을 쓴다. 기본은 페이드)
 *    스택의 첫 화면(설정 첫 페이지 등)은 재생하지 않으려고, 스택 안 순서를 컨텍스트로 넘긴다.
 * 디스코드가 일부러 "none"으로 둔 화면은 건드리지 않는다.
 */

const IndexContext = createContext(-1)

const one = new Animated.Value(1)

/** 꽉 찬 모달 (설정 화면 등). 투명 모달·폼 시트는 창/시트라 빼 둔다 */
const FULL_MODALS = new Set(['modal', 'fullScreenModal', 'containedModal', 'pageSheet'])

/** "화면 전환" 효과를 이 화면에 쓸지 */
function stackFor(presentation: string | undefined) {
    const m = active('stack')
    if (!m) return
    const pres = presentation ?? 'push'
    if (pres === 'push') return m
    if (FULL_MODALS.has(pres) && m.modals !== false) return m
}

function Enter({ children, presentation }: { children?: any; presentation?: string }) {
    const index = useContext(IndexContext)
    const [anim] = useState(() => {
        const m = stackFor(presentation)
        const pres = presentation ?? 'push'
        // 스택의 첫 화면은 그대로. 순서를 모르면(-1) 모달만 (모달은 첫 화면일 수 없다)
        const first = index === 0 || (index < 0 && pres === 'push')
        if (!m || m.effect === 'none' || first) return undefined
        const { width, height } = Dimensions.get('window')
        const p = new Animated.Value(0)
        const style = makeCardInterpolator(effectOf('stack', m.effect), { move: { direction: m.direction, position: m.position } })({ current: { progress: p }, inverted: one, layouts: { screen: { width, height } } }).cardStyle
        return { m, p, style }
    })
    useEffect(() => {
        if (!anim) return
        status.screens++
        const { m, p } = anim
        const run =
            m.easing === 'spring'
                ? Animated.spring(p, { toValue: 1, ...springFor(m.duration, 0.7), useNativeDriver: true } as any)
                : Animated.timing(p, { toValue: 1, duration: m.duration, easing: easingFrom(Easing, m.easing), useNativeDriver: true })
        run.start()
        return () => run.stop()
    }, [])
    return createElement(Animated.View, { style: anim ? [{ flex: 1 }, anim.style] : { flex: 1 }, collapsable: false }, children)
}

/** 네이티브 전환 종류 */
function nativeAnimationFor(props: any) {
    const presentation = props.stackPresentation ?? 'push'
    if (presentation !== 'push') {
        const stack = stackFor(presentation)
        // 모달에 직접 만든 효과를 쓰면 네이티브는 페이드만 (효과는 Enter 가)
        if (stack) return stack.effect === 'none' ? 'none' : (active('modal')?.effect ?? 'fade')
        return active('modal')?.effect
    }
    const push = active('push')?.effect
    const stack = active('stack')
    // 직접 만든 효과가 들어올 때 함께 쓸 네이티브 전환. 따로 고르지 않았으면 페이드
    if (stack) return stack.effect === 'none' ? 'none' : (push ?? 'fade')
    return push
}

function wrapStackChildren(children: any) {
    const wrap = (child: any, i: number) => (isValidElement(child) ? createElement(IndexContext.Provider, { key: child.key ?? i, value: i }, child) : child)
    return Array.isArray(children) ? children.map(wrap) : wrap(children, 0)
}

export function patchNativeScreens(cleanup: (...fns: Array<() => unknown>) => void) {
    cleanup(
        beforeJSX('RNSScreen' as any, (args: any[]) => {
            try {
                const props = args[1]
                if (!props || props.stackAnimation === 'none') return args as any
                const next = nativeAnimationFor(props)
                if (!next || next === props.stackAnimation) return args as any
                status.nativeScreens++
                return [args[0], { ...props, stackAnimation: next }, ...args.slice(2)] as any
            } catch (e) {
                report('screens', e)
                return args as any
            }
        }),
        // 스택 안 화면 순서 (첫 화면은 효과 없이)
        beforeJSX('RNSScreenStack' as any, (args: any[]) => {
            try {
                const props = args[1]
                if (!props?.children) return args as any
                return [args[0], { ...props, children: wrapStackChildren(props.children) }, ...args.slice(2)] as any
            } catch (e) {
                report('screenStack', e)
                return args as any
            }
        }),
    )
    // 화면 내용 감싸기. 헤더 설정은 headerConfig 로 따로 오므로 children 만 감싸면 된다
    cleanup(
        getModules(withProps('ScreenStackItem', 'ScreenStack') as any, (mod: any) => {
            const Item = mod?.ScreenStackItem
            if (!Item) return
            status.found.screens = true
            cleanup(
                beforeJSX(Item, (args: any[]) => {
                    try {
                        const props = args[1]
                        if (!props || props.children === undefined) return args as any
                        return [args[0], { ...props, children: createElement(Enter, { presentation: props.stackPresentation }, props.children) }, ...args.slice(2)] as any
                    } catch (e) {
                        report('screenItem', e)
                        return args as any
                    }
                }),
            )
        }) as any,
    )
}
