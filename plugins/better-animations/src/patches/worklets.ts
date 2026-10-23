import { getModules, lookupModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { Dimensions } from 'react-native'
import { easingFrom, effectOf, normalize, springFor, type ModuleKey } from '../effects'
import { active, report, status, version } from '../settings'

/**
 * 확인창·토스트·팝업 메뉴는 Reanimated 워클릿(UI 스레드에서 도는 함수)으로 움직인다.
 * 워클릿은 소스 코드 문자열(__initData.code)과 클로저(__closure)를 UI 스레드로 보내서 실행된다.
 *
 * useAnimatedStyle 에 들어오는 워클릿을 클로저 모양으로 알아보고, 같은 클로저를 쓰는
 * 우리 워클릿(직접 쓴 코드 문자열)으로 바꿔 넣는다. 디스코드의 정리 콜백(cleanUp)은 그대로 부른다.
 *
 * 주의: 빌드 검사 때문에 워클릿 코드 문자열 안에서도 화살표 함수와 let/const 를 쓰지 않는다.
 */

let Rea: any
let reaTiming: any
let reaSpring: any
/** 디스코드 래퍼(값, 설정, 'animate-always', 콜백)를 쓸 수밖에 없을 때 true */
let timing4 = false
let spring4 = false

export const reanimated = () => Rea

// ── 워클릿 만들기 ────────────────────────────────────────────────

function hashOf(code: string) {
    let a = 0x811c9dc5
    let b = 0x1505
    for (let i = 0; i < code.length; i++) {
        const ch = code.charCodeAt(i)
        a = Math.imul(a ^ ch, 0x01000193) >>> 0
        b = ((b << 5) + b + ch) >>> 0
    }
    // 디스코드 워클릿 해시(대략 1e12~1e13)와 겹치지 않게 큰 수로
    return 9e14 + (a % 1e7) * 1e4 + (b % 1e4)
}

const compiled = new Map<string, { impl: (...args: any[]) => any; initData: { code: string }; hash: number }>()

export function makeWorklet(code: string, closure: Record<string, unknown>) {
    let c = compiled.get(code)
    if (!c) {
        // eslint-disable-next-line no-new-func
        const impl = new Function(`return (${code})`)()
        c = { impl, initData: { code }, hash: hashOf(code) }
        compiled.set(code, c)
    }
    const entry = c
    // JS 스레드에서 처음 한 번 그대로 불리기도 해서, 같은 코드를 this.__closure 와 함께 실행한다
    const fn: any = function (this: unknown) {
        return entry.impl.apply({ __closure: closure }, arguments as any)
    }
    fn.__closure = closure
    fn.__initData = entry.initData
    fn.__workletHash = entry.hash
    return fn
}

// ── 워클릿 코드 ─────────────────────────────────────────────────
// 공통 도우미: T(값, 설정, 콜백) = withTiming, S(값, 설정, 콜백) = withSpring, go(값) = 고른 움직임

const HELPERS =
    "var BA=c.BA,wt=c.BA_withTiming,ws=c.BA_withSpring;" +
    "function T(v,cfg,cb){return BA.t4?wt(v,cfg,'animate-always',cb):wt(v,cfg,cb);}" +
    "function S(v,cfg,cb){return BA.s4?ws(v,cfg,'animate-always',cb):ws(v,cfg,cb);}" +
    'function go(v){return BA.spring?S(v,BA.springCfg):T(v,BA.timing);}' +
    'var h=BA.hidden;'

const ALERT_CARD =
    'function BetterAnimationsAlertCard(){var c=this.__closure;' +
    HELPERS +
    'var sharedVisible=c.sharedVisible,sharedTransitionState=c.sharedTransitionState,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp,windowHeight=c.windowHeight,margin=c.ALERT_MODAL_MARGIN,sharedIndex=c.sharedIndex,sharedTopHeight=c.sharedTopHeight;' +
    'var visible=sharedVisible.get();var index=sharedIndex.get();var on=visible===1;' +
    'function onComplete(finished){if(finished===true&&sharedVisible.get()===0&&sharedTransitionState.get()===TransitionStates.YEETED){runOnJS(cleanUp)();}}' +
    'var OFFSETS=[0,-20,-34];var offset=OFFSETS[index]!==undefined?OFFSETS[index]:-12;' +
    'var maxHeight=windowHeight-margin*2-Math.max(c.safeAreaTop,c.safeAreaBottom)*2;' +
    'var t=[];' +
    'if(!c.useReducedMotion){t.push({perspective:800});' +
    't.push({translateX:go(on?0:h.tx+h.txW*BA.W)});' +
    't.push({translateY:go(on?offset:h.ty+h.tyH*windowHeight)});' +
    't.push({scale:go(on?1-index*0.1:h.s)});' +
    "if(h.r){t.push({rotate:go(on?'0deg':h.r+'deg')});}" +
    "if(h.rx){t.push({rotateX:go(on?'0deg':h.rx+'deg')});}}" +
    "return{position:'absolute',opacity:T(on?1:h.o,BA.fade,onComplete),zIndex:10-index,height:index>0?sharedTopHeight.get():'auto',maxHeight:maxHeight,transform:t};}"

const ALERT_BACKDROP =
    'function BetterAnimationsAlertBackdrop(){var c=this.__closure;' +
    HELPERS +
    'var sharedVisible=c.sharedVisible,sharedTransitionState=c.sharedTransitionState,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp;' +
    'return{opacity:T(sharedVisible.get(),BA.fade,function(finished){if(finished===true&&sharedVisible.get()===0&&sharedTransitionState.get()===TransitionStates.YEETED){runOnJS(cleanUp)();}})};}'

const TOAST =
    'function BetterAnimationsToast(){var c=this.__closure;' +
    HELPERS +
    'var toastHeight=c.toastHeight,animationState=c.animationState,AnimationState=c.AnimationState,withDelay=c.withDelay,state=c.state,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp;' +
    "var dir=c.position==='top'?-1:1;" +
    'var tx=h.tx+h.txW*BA.W;var ty=(h.edge?toastHeight.get()*dir:0)+h.ty*dir+h.tyH*dir*BA.H;' +
    "if(!c.hasEntered.get()){var t0=[{perspective:800},{translateX:tx},{translateY:ty},{scale:h.s}];if(h.r){t0.push({rotate:h.r+'deg'});}if(h.rx){t0.push({rotateX:h.rx+'deg'});}return{opacity:0,transform:t0};}" +
    'var k=c.interpolate(animationState.get(),c.ANIMATION_STATE_INPUT,[0,1]);' +
    'var delayMs=animationState.get()===AnimationState.VISIBLE?c.enterDelayMs:0;' +
    'function lerp(a,b){return a+(b-a)*k;}' +
    'function d(anim){return withDelay(delayMs,anim);}' +
    'function done(finished){if(finished===true&&state===TransitionStates.YEETED){runOnJS(cleanUp)();}}' +
    'var t=[{perspective:800},{translateX:d(go(lerp(tx,0)))},{translateY:d(go(lerp(ty,0)))},{scale:d(go(lerp(h.s,1)))}];' +
    "if(h.r){t.push({rotate:d(go(lerp(h.r,0)+'deg'))});}" +
    "if(h.rx){t.push({rotateX:d(go(lerp(h.rx,0)+'deg'))});}" +
    'return{opacity:d(T(lerp(h.o,1),BA.fade,done)),transform:t};}'

const MENU =
    'function BetterAnimationsContextMenu(){var c=this.__closure;' +
    HELPERS +
    'var transitionState=c.transitionState,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp,onClose=c.onClose;' +
    'var k=c.interpolate(c.visible.get(),[0,1],[0,1]);' +
    'function lerp(a,b){return a+(b-a)*k;}' +
    'var halfH=Math.min(c.maxHeight,c.height)/2;var halfW=c.CONTEXT_MENU_MIN_WIDTH/2;' +
    "var dirY=c.positionY==='below'?-1:1;var dirX=c.positionX==='left'?-1:1;" +
    'var ax=h.anchor?dirX*halfW*(1-h.s):0;var ay=h.anchor?dirY*halfH*(1-h.s*h.sy):0;' +
    'var tx=ax+h.tx+h.txW*BA.W;var ty=ay-dirY*h.ty;' +
    'var t=[{perspective:800},{translateX:go(lerp(tx,0))},{translateY:go(lerp(ty,0))},{scale:go(lerp(h.s,1))},{scaleY:go(lerp(h.sy,1))}];' +
    "if(h.r){t.push({rotate:go(lerp(h.r,0)+'deg')});}" +
    "if(h.rx){t.push({rotateX:go(lerp(h.rx,0)+'deg')});}" +
    'return{opacity:T(lerp(h.o,1),BA.fade,function(finished){if(finished&&transitionState===TransitionStates.YEETED){runOnJS(cleanUp)();runOnJS(onClose)();}}),transform:t};}'

const MENU_BACKDROP = 'function BetterAnimationsContextMenuBackdrop(){var c=this.__closure;' + HELPERS + 'return{opacity:T(c.visible.get(),BA.fade)};}'

const FOLDER =
    'function BetterAnimationsGuildFolderItem(){var c=this.__closure;' +
    HELPERS +
    'var on=c.visible.get()===1;var dir=c.fromTop?-1:1;' +
    'var tx=h.tx+h.txW*BA.W;var ty=(h.edge?dir*c.guildItemSize:0)+dir*h.ty;' +
    'var t=[{perspective:600},{translateX:go(on?0:tx)},{translateY:go(on?0:ty)},{scale:go(on?1:h.s)}];' +
    "if(h.r){t.push({rotate:go(on?'0deg':h.r+'deg')});}" +
    "if(h.rx){t.push({rotateX:go(on?'0deg':h.rx+'deg')});}" +
    'return{opacity:T(on?1:h.o,BA.fade,function(finished){if(finished&&c.state===c.TransitionStates.YEETED){c.runOnJS(c.cleanUp)();}}),transform:t};}'

export const CODES = { ALERT_CARD, ALERT_BACKDROP, TOAST, MENU, MENU_BACKDROP, FOLDER }

// ── 디스코드 워클릿 알아보기 ─────────────────────────────────────

type Kind = 'alertCard' | 'alertBackdrop' | 'toast' | 'menu' | 'menuBackdrop' | 'folder'

const has = (c: object, ...keys: string[]) => keys.every(k => k in c)

export function kindOf(closure: any): Kind | undefined {
    if (!closure || typeof closure !== 'object') return
    if ('withAlertModalSpring' in closure) {
        if (has(closure, 'sharedIndex', 'sharedTopHeight', 'windowHeight', 'sharedVisible')) return 'alertCard'
        if (has(closure, 'sharedVisible', 'sharedTransitionState', 'cleanUp')) return 'alertBackdrop'
        return
    }
    if (has(closure, 'toastHeight', 'enterDelayMs', 'ANIMATION_STATE_INPUT', 'animationState', 'withDelay')) return 'toast'
    if (has(closure, 'CONTEXT_MENU_MIN_SCALE', 'positionX', 'positionY', 'visible', 'cleanUp')) return 'menu'
    if (has(closure, 'CONTEXT_MENU_SPRING', 'visible') && Object.keys(closure).length <= 4) return 'menuBackdrop'
    if (has(closure, 'FOLDER_SPRING_PHYSICS', 'fromTop', 'guildItemSize', 'visible', 'cleanUp')) return 'folder'
}

const MODULE_OF: Record<Kind, ModuleKey> = { alertCard: 'alert', alertBackdrop: 'alert', toast: 'toast', menu: 'menu', menuBackdrop: 'menu', folder: 'folder' }
const CODE_OF: Record<Kind, string> = { alertCard: ALERT_CARD, alertBackdrop: ALERT_BACKDROP, toast: TOAST, menu: MENU, menuBackdrop: MENU_BACKDROP, folder: FOLDER }
const COUNTER: Record<Kind, keyof typeof status> = { alertCard: 'alerts', alertBackdrop: 'alerts', toast: 'toasts', menu: 'menus', menuBackdrop: 'menus', folder: 'folders' }

// ── 설정 → 워클릿에 넘길 값 ─────────────────────────────────────

const baCache = new Map<string, any>()

export function animationConfigFor(module: ModuleKey) {
    const m = active(module)
    if (!m || !Rea?.Easing || !reaTiming || !reaSpring) return
    const W = Dimensions.get('window')
    const key = `${version}:${module}:${m.effect}:${m.duration}:${m.easing}:${W.width}x${W.height}`
    let ba = baCache.get(key)
    if (ba) return ba
    const E = Rea.Easing
    const spring = m.easing === 'spring'
    ba = {
        hidden: normalize(effectOf(module, m.effect).hidden),
        spring,
        springCfg: springFor(m.duration, 0.55),
        timing: { duration: m.duration, easing: spring ? E.linear : easingFrom(E, m.easing) },
        fade: { duration: Math.max(80, Math.round(m.duration * 0.75)), easing: E.out(E.quad) },
        W: W.width,
        H: W.height,
        t4: timing4,
        s4: spring4,
    }
    baCache.clear()
    baCache.set(key, ba)
    return ba
}

/** 디스코드 워클릿이면 우리 것으로 바꾼 워클릿을, 아니면 원래 것을 돌려준다 */
export function swapWorklet(updater: any) {
    const closure = updater?.__closure
    if (!closure || closure.BA) return updater
    const kind = kindOf(closure)
    if (!kind) return updater
    if (!active(MODULE_OF[kind]) || !ensureReanimated()) return updater
    const ba = animationConfigFor(MODULE_OF[kind])
    if (!ba) return updater
    ;(status as any)[COUNTER[kind]]++
    return makeWorklet(CODE_OF[kind], { ...closure, BA_withTiming: reaTiming, BA_withSpring: reaSpring, BA: ba })
}

// ── 모듈 찾기 / 패치 ───────────────────────────────────────────

const REA_SIGNATURE = /^function [\w$]*\(toValue,userConfig,callback\)/

/** reanimated 원본 withTiming / withSpring 을 고른다. 없으면 디스코드 래퍼(인자 4개)를 쓴다 */
function pickAnimationFn(name: 'withTiming' | 'withSpring'): [any, boolean] | undefined {
    let fallback: any
    for (const [mod] of lookupModules(withProps(name) as any) as any) {
        const fn = mod?.[name]
        const code = fn?.__initData?.code
        if (typeof fn !== 'function' || typeof code !== 'string') continue
        if (REA_SIGNATURE.test(code)) return [fn, false]
        if (/shouldAnimate/.test(code)) fallback ??= fn
    }
    if (fallback) return [fallback, true]
}

function findReanimated() {
    for (const [mod] of lookupModules(withProps('useAnimatedStyle', 'Easing') as any) as any) {
        if (mod?.Easing?.linear?.__workletHash !== undefined) return mod
    }
}

let lastTry = 0
/** reanimated 쪽 함수들을 처음 필요할 때 찾는다 (플러그인이 일찍 켜져도 되게) */
export function ensureReanimated() {
    if (status.found.reanimated) return true
    const now = Date.now()
    if (now - lastTry < 2000) return false
    lastTry = now
    try {
        Rea ??= findReanimated()
        const t = reaTiming ? undefined : pickAnimationFn('withTiming')
        const s = reaSpring ? undefined : pickAnimationFn('withSpring')
        if (t) [reaTiming, timing4] = t
        if (s) [reaSpring, spring4] = s
    } catch (e) {
        report('reanimated', e)
    }
    status.found.reanimated = !!(Rea && reaTiming && reaSpring)
    return status.found.reanimated
}

export function patchWorklets(cleanup: (...fns: Array<() => unknown>) => void) {
    const done = new Set<any>()
    const patch = (mod: any) => {
        if (!mod || done.has(mod)) return
        const desc = Object.getOwnPropertyDescriptor(mod, 'useAnimatedStyle')
        // 다른 모듈을 가리키는 getter(재수출)는 원본 쪽을 고치면 같이 바뀐다
        if (!desc || !('value' in desc) || !desc.writable || typeof desc.value !== 'function') return
        done.add(mod)
        status.found.worklets = true
        cleanup(
            instead(mod, 'useAnimatedStyle', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                try {
                    const next = swapWorklet(args[0])
                    if (next !== args[0]) args = [next, ...args.slice(1)]
                } catch (e) {
                    report('worklets', e)
                }
                return orig.apply(this, args)
            }),
        )
    }
    cleanup(getModules(withProps('useAnimatedStyle') as any, (mod: any) => patch(mod), { max: 20 } as any) as any)
}
