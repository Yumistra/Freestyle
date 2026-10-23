import { Animated, Easing } from 'react-native'
import { easingFrom, normalize, springFor, type Effect, type EasingKey } from './effects'

/**
 * @react-navigation/stack 의 cardStyleInterpolator 를 효과 정의(hidden/under/dim)로 만든다.
 * 설정 화면 미리보기도 같은 함수를 쓴다.
 */

const clamp = 'clamp' as const
const lerp = (node: any, from: any, to: any) => node.interpolate({ inputRange: [0, 1], outputRange: [from, to], extrapolate: clamp })

function isIdentity(h: ReturnType<typeof normalize>) {
    return h.o === 1 && !h.tx && !h.ty && !h.txW && !h.tyH && h.s === 1 && h.sy === 1 && !h.r && !h.rx && !h.ry
}

/** progress 0 → hidden, 1 → 원래 모습 */
function partsFor(progress: any, h: ReturnType<typeof normalize>, W: number, H: number, inverted: any) {
    const transform: any[] = []
    const tx = h.tx + h.txW * W
    const ty = h.ty + h.tyH * H
    if (tx) transform.push({ translateX: inverted ? Animated.multiply(lerp(progress, tx, 0), inverted) : lerp(progress, tx, 0) })
    if (ty) transform.push({ translateY: lerp(progress, ty, 0) })
    if (h.s !== 1) transform.push({ scale: lerp(progress, h.s, 1) })
    if (h.sy !== 1) transform.push({ scaleY: lerp(progress, h.sy, 1) })
    if (h.r) transform.push({ rotate: lerp(progress, `${h.r}deg`, '0deg') })
    if (h.rx) transform.push({ rotateX: lerp(progress, `${h.rx}deg`, '0deg') })
    if (h.ry) transform.push({ rotateY: lerp(progress, `${h.ry}deg`, '0deg') })
    const opacity = h.o !== 1 ? lerp(progress, h.o, 1) : undefined
    return { transform, opacity }
}

export function makeCardInterpolator(effect: Effect) {
    const hidden = normalize(effect.hidden)
    const under = effect.under ? normalize(effect.under) : undefined
    const dim = effect.dim ?? 0
    return ({ current, next, inverted, layouts }: any) => {
        const W = layouts?.screen?.width ?? 400
        const H = layouts?.screen?.height ?? 800
        const enter = partsFor(current.progress, hidden, W, H, inverted)
        // 위에 새 화면이 덮일 때(next) 이 화면이 어떻게 변하는지: next 0 → 원래, 1 → under
        const cover = under && next ? partsFor(Animated.subtract(1, next.progress), under, W, H, inverted) : undefined
        const transform = [{ perspective: 1000 }, ...enter.transform, ...(cover?.transform ?? [])]
        const opacity =
            enter.opacity && cover?.opacity ? Animated.multiply(enter.opacity, cover.opacity) : (enter.opacity ?? cover?.opacity ?? undefined)
        const cardStyle: any = { transform }
        if (opacity !== undefined) cardStyle.opacity = opacity
        const out: any = { cardStyle }
        if (dim) out.overlayStyle = { opacity: lerp(current.progress, 0, dim) }
        return out
    }
}

export const noAnimation = () => ({})

export function transitionSpecFor(duration: number, easing: EasingKey) {
    if (easing === 'spring') return { animation: 'spring', config: springFor(duration, 0.7) }
    return { animation: 'timing', config: { duration, easing: easingFrom(Easing, easing) } }
}

export const isStatic = (effect: Effect) => isIdentity(normalize(effect.hidden)) && !effect.under
