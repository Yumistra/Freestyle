import { getModules, lookupModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { Dimensions } from 'react-native'
import { applyMove, easingFrom, effectOf, exitEffectOf, springFor, type Effect, type ModuleKey } from '../effects'
import { active, report, settings, status, version, type ModuleSettings } from '../settings'

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
    'var H0=BA.hidden,H1=BA.exit;'

const ALERT_CARD =
    'function BetterAnimationsAlertCard(){var c=this.__closure;' +
    HELPERS +
    'var sharedVisible=c.sharedVisible,sharedTransitionState=c.sharedTransitionState,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp,windowHeight=c.windowHeight,margin=c.ALERT_MODAL_MARGIN,sharedIndex=c.sharedIndex,sharedTopHeight=c.sharedTopHeight;' +
    'var visible=sharedVisible.get();var index=sharedIndex.get();var on=visible===1;var h=sharedTransitionState.get()===TransitionStates.YEETED?H1:H0;' +
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
    'return{opacity:T(sharedVisible.get()*BA.dim,BA.fade,function(finished){if(finished===true&&sharedVisible.get()===0&&sharedTransitionState.get()===TransitionStates.YEETED){runOnJS(cleanUp)();}})};}'

const TOAST =
    'function BetterAnimationsToast(){var c=this.__closure;' +
    HELPERS +
    'var toastHeight=c.toastHeight,animationState=c.animationState,AnimationState=c.AnimationState,withDelay=c.withDelay,state=c.state,TransitionStates=c.TransitionStates,runOnJS=c.runOnJS,cleanUp=c.cleanUp;' +
    "var dir=c.position==='top'?-1:1;var h=state===TransitionStates.YEETED?H1:H0;" +
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
    'var k=c.interpolate(c.visible.get(),[0,1],[0,1]);var h=transitionState===TransitionStates.YEETED?H1:H0;' +
    'function lerp(a,b){return a+(b-a)*k;}' +
    'var halfH=Math.min(c.maxHeight,c.height)/2;var halfW=c.CONTEXT_MENU_MIN_WIDTH/2;' +
    "var dirY=c.positionY==='below'?-1:1;var dirX=c.positionX==='left'?-1:1;" +
    'var ax=h.anchor?dirX*halfW*(1-h.s):0;var ay=h.anchor?dirY*halfH*(1-h.s*h.sy):0;' +
    'var tx=ax+h.tx+h.txW*BA.W;var ty=ay-dirY*h.ty;' +
    'var t=[{perspective:800},{translateX:go(lerp(tx,0))},{translateY:go(lerp(ty,0))},{scale:go(lerp(h.s,1))},{scaleY:go(lerp(h.sy,1))}];' +
    "if(h.r){t.push({rotate:go(lerp(h.r,0)+'deg')});}" +
    "if(h.rx){t.push({rotateX:go(lerp(h.rx,0)+'deg')});}" +
    'return{opacity:T(lerp(h.o,1),BA.fade,function(finished){if(finished&&transitionState===TransitionStates.YEETED){runOnJS(cleanUp)();runOnJS(onClose)();}}),transform:t};}'

const MENU_BACKDROP = 'function BetterAnimationsContextMenuBackdrop(){var c=this.__closure;' + HELPERS + 'return{opacity:T(c.visible.get()*BA.dim,BA.fade)};}'

const FOLDER =
    'function BetterAnimationsGuildFolderItem(){var c=this.__closure;' +
    HELPERS +
    'var on=c.visible.get()===1;var dir=c.fromTop?-1:1;var h=c.state===c.TransitionStates.YEETED?H1:H0;' +
    'var tx=h.tx+h.txW*BA.W;var ty=(h.edge?dir*c.guildItemSize:0)+dir*h.ty;' +
    'var t=[{perspective:600},{translateX:go(on?0:tx)},{translateY:go(on?0:ty)},{scale:go(on?1:h.s)}];' +
    "if(h.r){t.push({rotate:go(on?'0deg':h.r+'deg')});}" +
    "if(h.rx){t.push({rotateX:go(on?'0deg':h.rx+'deg')});}" +
    'return{opacity:T(on?1:h.o,BA.fade,function(finished){if(finished&&c.state===c.TransitionStates.YEETED){c.runOnJS(c.cleanUp)();}}),transform:t};}'

// 알림 배너: 처음 나타날 땐(initialized 전) scale 값이 0 → 1 로 움직이고, 그 뒤엔 손가락으로 끌어 닫는다.
// 나타나는 동안만 그 진행도로 우리 효과를 그리고, 끄는 동작은 디스코드 그대로 둔다
const NOTICE =
    'function BetterAnimationsInAppNotification(){var c=this.__closure;' +
    HELPERS +
    'var gy=c.notificationGestureY.get();' +
    'if(c.initialized){return{transform:[{translateY:gy},{scale:c.interpolate(gy,c.PAN_INPUT_RANGE,[0.3,1,0.3],c.extrapolateConfig)}],opacity:c.interpolate(gy,c.PAN_INPUT_RANGE,[0,1,0],c.extrapolateConfig)};}' +
    'var k=c.scale.get();var q=1-k;var h=H0;' +
    'var t=[{perspective:800},{translateX:(h.tx+h.txW*BA.W)*q},{translateY:gy+((h.edge?-140:0)-h.ty+h.tyH*BA.H)*q},{scale:h.s+(1-h.s)*k}];' +
    "if(h.r){t.push({rotate:h.r*q+'deg'});}" +
    "if(h.rx){t.push({rotateX:h.rx*q+'deg'});}" +
    'return{transform:t,opacity:Math.min(1,h.o+(1-h.o)*Math.min(1,k*1.4))};}'

// 사진·동영상 보기: 디스코드는 entranceAnimationDriver(0 → 1)로 누른 자리에서 커지게 그린다.
// Zoom 은 그 모습 그대로(속도·곡선은 patchMediaTiming 이 바꿈), 나머지는 제자리에서 우리 효과로
const MEDIA =
    'function BetterAnimationsMediaItem(){var c=this.__closure;var BA=c.BA;var k=c.entranceAnimationDriver.get();' +
    'var cl=c.BA_closing?c.BA_closing.get():0;' +
    'function ip(a,b){return c.interpolate(k,a,b,c.Extrapolation.CLAMP);}' +
    'if(cl?BA.zoomExit:BA.zoom){return{height:ip([0,1],[c.startHeight,c.sourceHeight]),width:ip([0,1],[c.startWidth,c.sourceWidth]),top:ip([0,1],[c.startTranslateY,0]),left:ip([0,1],[c.startTranslateX,0]),borderRadius:ip([0,0.25],[16,0]),transform:[{scale:ip([0,1],[c.startScale,1])}]};}' +
    'var q=1-k;var h=cl?BA.exit:BA.hidden;' +
    'var t=[{perspective:800},{translateX:(h.tx+h.txW*BA.W)*q},{translateY:(h.ty+h.tyH*BA.H)*q},{scale:h.s+(1-h.s)*k},{scaleY:h.sy+(1-h.sy)*k}];' +
    "if(h.r){t.push({rotate:h.r*q+'deg'});}" +
    "if(h.rx){t.push({rotateX:h.rx*q+'deg'});}" +
    "if(h.ry){t.push({rotateY:h.ry*q+'deg'});}" +
    'var o=h.o+(1-h.o)*k;' +
    'return{height:c.sourceHeight,width:c.sourceWidth,top:0,left:0,borderRadius:0,opacity:o<0?0:o>1?1:o,transform:t};}'

export const CODES = { ALERT_CARD, ALERT_BACKDROP, TOAST, MENU, MENU_BACKDROP, FOLDER, NOTICE, MEDIA }

// ── 디스코드 워클릿 알아보기 ─────────────────────────────────────

type Kind = 'alertCard' | 'alertBackdrop' | 'toast' | 'menu' | 'menuBackdrop' | 'folder' | 'notice' | 'media'

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
    if (has(closure, 'notificationGestureY', 'scale', 'initialized', 'PAN_INPUT_RANGE', 'extrapolateConfig', 'interpolate')) return 'notice'
    if (has(closure, 'entranceAnimationDriver', 'startScale', 'startTranslateX', 'startTranslateY', 'sourceWidth', 'sourceHeight', 'interpolate')) return 'media'
}

const MODULE_OF: Record<Kind, ModuleKey> = { alertCard: 'alert', alertBackdrop: 'alert', toast: 'toast', menu: 'menu', menuBackdrop: 'menu', folder: 'folder', notice: 'notice', media: 'media' }
const CODE_OF: Record<Kind, string> = { alertCard: ALERT_CARD, alertBackdrop: ALERT_BACKDROP, toast: TOAST, menu: MENU, menuBackdrop: MENU_BACKDROP, folder: FOLDER, notice: NOTICE, media: MEDIA }
const COUNTER: Record<Kind, keyof typeof status> = { alertCard: 'alerts', alertBackdrop: 'alerts', toast: 'toasts', menu: 'menus', menuBackdrop: 'menus', folder: 'folders', notice: 'notices', media: 'media' }

// ── 설정 → 워클릿에 넘길 값 ─────────────────────────────────────

const baCache = new Map<string, any>()

/** 움직이는 대상의 대략적인 크기 (위치 설정의 기준점 계산용) */
function sizeOf(module: ModuleKey, W: number, H: number): [number, number] {
    switch (module) {
        case 'alert':
            return [Math.min(W - 32, 400), Math.min(H * 0.4, 320)]
        case 'toast':
            return [Math.min(W - 32, 360), 48]
        case 'notice':
            return [W - 16, 80]
        case 'menu':
            return [220, 240]
        case 'folder':
            return [48, 48]
        default:
            return [W, H]
    }
}

/** Reanimated 용 계단 곡선 (워클릿이어야 한다) */
function reaSteps(E: any) {
    return (n: number) =>
        typeof E.steps === 'function' ? E.steps(n, false) : makeWorklet('function BetterAnimationsSteps(t){var c=this.__closure;return t>=1?1:Math.floor(t*c.n)/c.n;}', { n })
}

/** Reanimated 곡선 (UI 스레드에서 도는 곳에 넘길 것) */
export function reaEasing(key: string) {
    const E = Rea?.Easing
    return E ? easingFrom(E, key, reaSteps(E)) : undefined
}

export function animationConfigFor(module: ModuleKey) {
    const m = active(module)
    if (!m || !Rea?.Easing || !reaTiming || !reaSpring) return
    const W = Dimensions.get('window')
    const key = `${version}:${module}:${m.effect}:${m.duration}:${m.easing}:${m.exit}:${m.direction}:${m.position}:${W.width}x${W.height}`
    let ba = baCache.get(key)
    if (ba) return ba
    const E = Rea.Easing
    const spring = m.easing === 'spring'
    const [w, hgt] = sizeOf(module, W.width, W.height)
    const move = { direction: m.direction, position: m.position }
    ba = {
        hidden: applyMove(effectOf(module, m.effect).hidden, move, w, hgt),
        exit: applyMove(exitEffectOf(module, m.effect, m.exit).hidden, move, w, hgt),
        spring,
        springCfg: springFor(m.duration, 0.55),
        timing: { duration: m.duration, easing: spring ? E.linear : easingFrom(E, m.easing, reaSteps(E)) },
        fade: { duration: Math.max(80, Math.round(m.duration * 0.75)), easing: E.out(E.quad) },
        W: W.width,
        H: W.height,
        t4: timing4,
        s4: spring4,
        dim: 1,
    }
    baCache.set(key, ba)
    if (baCache.size > 24) baCache.delete(baCache.keys().next().value as string)
    return ba
}

/** 배경 막 진하기: 기본 1, 단색이면 고른 값, 없음이면 0 */
function backdropDim() {
    const b = active('backdrop')
    if (!b) return 1
    if (b.effect === 'none') return 0
    return Math.max(0, Math.min(1, b.amount ?? 0.6))
}

const BACKDROP_KINDS = new Set<Kind>(['alertBackdrop', 'menuBackdrop'])

// ── 사진·동영상 보기 ─────────────────────────────────────────────

/** 닫을 때 우리 효과를 쓰는지 (Default = 디스코드처럼 아래·위로 밀어 닫기) */
function mediaExitEffect(m: ModuleSettings): Effect | undefined {
    if (!m.exit || m.exit === 'default') return
    const e = exitEffectOf('media', m.effect, m.exit)
    if (e.id === 'default' || e.id === 'none' || !e.hidden) return
    return e
}

const mediaCache = new Map<string, any>()
function mediaConfig(m: ModuleSettings) {
    const W = Dimensions.get('window')
    const key = `${version}:${m.effect}:${m.exit}:${m.direction}:${m.position}:${W.width}x${W.height}`
    let ba = mediaCache.get(key)
    if (ba) return ba
    const move = { direction: m.direction, position: m.position }
    const enterCustom = m.effect !== 'default' && m.effect !== 'none'
    const e = mediaExitEffect(m)
    const hidden = applyMove(effectOf('media', m.effect).hidden, move, W.width, W.height)
    ba = {
        hidden,
        exit: e ? applyMove(e.hidden, move, W.width, W.height) : hidden,
        zoom: !enterCustom || m.effect === 'zoom',
        zoomExit: e?.id === 'zoom',
        W: W.width,
        H: W.height,
    }
    mediaCache.set(key, ba)
    if (mediaCache.size > 8) mediaCache.delete(mediaCache.keys().next().value as string)
    return ba
}

const mediaSettings = () => {
    const s = settings()
    return s.enabled ? s.modules.media : undefined
}

/** 열린 보기의 진행도(공유 값) → 닫는 중 표시(우리 공유 값) */
const closingOf = new WeakMap<object, any>()
let lastDriver: any
let discordTiming: ((...a: any[]) => any) | undefined

function makeMutable(v: number) {
    const mk = Rea?.makeMutable
    return typeof mk === 'function' ? mk(v) : undefined
}

function setShared(sv: any, v: unknown) {
    if (typeof sv?.set === 'function') sv.set(v)
    else sv.value = v
}

function swapMedia(updater: any, closure: any) {
    const m = mediaSettings()
    if (!m) return updater
    const enterCustom = m.effect !== 'default' && m.effect !== 'none'
    if (!enterCustom && !mediaExitEffect(m)) return updater
    if (!ensureReanimated()) return updater
    const driver = closure.entranceAnimationDriver
    let closing = closingOf.get(driver)
    if (!closing) {
        closing = makeMutable(0)
        if (closing) closingOf.set(driver, closing)
    }
    lastDriver = driver
    status.media++
    return makeWorklet(MEDIA, { ...closure, BA: mediaConfig(m), BA_closing: closing ?? null })
}

/** 디스코드 워클릿이면 우리 것으로 바꾼 워클릿을, 아니면 원래 것을 돌려준다 */
export function swapWorklet(updater: any) {
    const closure = updater?.__closure
    if (!closure || closure.BA) return updater
    const kind = kindOf(closure)
    if (!kind) return updater
    if (kind === 'media') return swapMedia(updater, closure)
    const parent = MODULE_OF[kind]
    const backdrop = BACKDROP_KINDS.has(kind)
    // 배경 막은 그 창 효과를 바꿨거나, 배경 설정을 바꿨을 때
    const module: ModuleKey | undefined = active(parent) ? parent : backdrop && active('backdrop') ? 'backdrop' : undefined
    if (!module || !ensureReanimated()) return updater
    let ba = animationConfigFor(module)
    if (!ba) return updater
    if (backdrop) {
        ba = { ...ba, dim: backdropDim() }
        status.backdrops++
    }
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

/**
 * 사진·동영상 보기가 열릴 때 진행도(entranceAnimationDriver)를 움직이는 withTiming 의 속도·곡선을 바꾼다.
 * 디스코드 래퍼 withTiming(값, 설정, 'respect-motion-settings', 끝 콜백) 의 끝 콜백 클로저로 알아본다
 */
export function patchMediaTiming(cleanup: (...fns: Array<() => unknown>) => void) {
    const done = new Set<any>()
    cleanup(
        getModules(
            withProps('withTiming') as any,
            (mod: any) => {
                if (!mod || done.has(mod)) return
                const desc = Object.getOwnPropertyDescriptor(mod, 'withTiming')
                if (!desc || !('value' in desc) || !desc.writable || typeof desc.value !== 'function') return
                if (!/shouldAnimate/.test(desc.value.__initData?.code ?? '')) return
                done.add(mod)
                status.found.media = true
                discordTiming = desc.value
                cleanup(
                    instead(mod, 'withTiming', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                        try {
                            const cb = args[3]
                            if (cb?.__closure && 'setUseEntranceAnimationState' in cb.__closure) {
                                const m = active('media')
                                if (m && ensureReanimated()) {
                                    const duration = m.effect === 'none' ? 1 : m.duration
                                    const easing = reaEasing(m.easing === 'spring' ? 'back' : m.easing)
                                    args = [args[0], { ...(args[1] ?? {}), duration, ...(easing ? { easing } : {}) }, ...args.slice(2)]
                                    status.media++
                                }
                            }
                        } catch (e) {
                            report('media', e)
                        }
                        return orig.apply(this, args)
                    }),
                )
            },
            { max: 10 } as any,
        ) as any,
    )
    // 닫기: 디스코드는 withSpring 으로 아래·위로 밀어낸 뒤 handleClose 를 부른다.
    // 우리 효과면 그 대신 진행도를 1 → 0 으로 되돌려(우리 워클릿이 나가는 모습을 그림) 끝나면 같은 콜백으로 닫는다
    const doneSpring = new Set<any>()
    cleanup(
        getModules(
            withProps('withSpring') as any,
            (mod: any) => {
                if (!mod || doneSpring.has(mod)) return
                const desc = Object.getOwnPropertyDescriptor(mod, 'withSpring')
                if (!desc || !('value' in desc) || !desc.writable || typeof desc.value !== 'function') return
                if (!/shouldAnimate|respect-motion/.test(desc.value.__initData?.code ?? '')) return
                doneSpring.add(mod)
                cleanup(
                    instead(mod, 'withSpring', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                        try {
                            const cb = args[3]
                            if (cb?.__closure && 'handleClose' in cb.__closure && lastDriver && discordTiming) {
                                const m = mediaSettings()
                                const closing = closingOf.get(lastDriver)
                                if (m && closing && mediaExitEffect(m) && ensureReanimated()) {
                                    const easing = reaEasing(m.easing === 'spring' ? 'back' : m.easing)
                                    setShared(closing, 1)
                                    setShared(lastDriver, discordTiming(0, { duration: m.duration, ...(easing ? { easing } : {}) }, args[2] ?? 'respect-motion-settings', cb))
                                    status.media++
                                    // 끌어 놓은 자리는 가운데로 돌아오게 (닫기 콜백은 위에서)
                                    return orig.apply(this, [0, args[1], args[2]])
                                }
                            }
                        } catch (e) {
                            report('media', e)
                        }
                        return orig.apply(this, args)
                    }),
                )
            },
            { max: 10 } as any,
        ) as any,
    )
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
