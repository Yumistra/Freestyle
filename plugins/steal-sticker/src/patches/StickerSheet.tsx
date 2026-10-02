import { React, ReactNative } from '@vendetta/metro/common'
import { before } from '@vendetta/patcher'
import { showToast } from '@vendetta/ui/toasts'
import { LazyActionSheet } from '../modules'
import { stickerFromProps, type StickerItem } from '../sticker'
import StealButtons from '../ui/StealButtons'

const SHEET_NAME = 'sticker_detail_action_sheet'
export const DEBUG = false
const dbg = (msg: string) => DEBUG && showToast(`[Steal Sticker] ${msg}`)
const STICKER_PROP = '__stealSticker'
const BUTTONS_KEY = 'steal-sticker-buttons'

/**
 * 스티커 상세 창(서버 스티커·공식 스티커 공통)에 버튼을 붙인다.
 *
 *  - 디스코드 모듈은 고치지 않고, openLazy에 넘어가는 Promise를 "감싼 모듈"로 바꿔치기한다 (default가 읽기 전용이라서).
 *  - 컴포넌트를 감쌀 때 원래 형태를 보존한다: 함수 / 클래스(상속) / forwardRef(ref 전달) / memo(비교 함수 유지).
 *    공식 스티커 창은 그냥 함수처럼 호출하면 튕기는 형태였다.
 *  - 버튼 자리는 고정 경로 대신 창 안을 따라 내려가며 찾는다 (서버·공식 스티커 창의 구조가 달라서).
 */

// ── 컴포넌트 래핑: 렌더 결과를 받아 inject하는 래퍼를 원래 형태 그대로 만든다 ──
const wrapCache = new WeakMap<object, any>()

function isWrappable(Type: any): boolean {
    if (Type?.__stealWrapped) return false // 이미 감싼 건 다시 감싸지 않는다
    if (typeof Type === 'function') return true
    if (Type && typeof Type === 'object') return isWrappable(Type.type) || typeof Type.render === 'function'
    return false
}

function wrapComponent(Type: any): any {
    const cached = wrapCache.get(Type)
    if (cached) return cached
    let Wrapped: any

    if (typeof Type === 'function' && Type.prototype?.isReactComponent) {
        // 클래스 컴포넌트: 상속해서 render 결과만 손댄다
        Wrapped = class extends Type {
            render() {
                const out = super.render()
                return post(out, (this as any).props?.[STICKER_PROP])
            }
        }
    } else if (typeof Type === 'function') {
        Wrapped = function StealStickerWrapped(props: any, second?: any) {
            const { [STICKER_PROP]: sticker, ...rest } = props ?? {}
            return post(Type(rest, second), sticker)
        }
    } else if (typeof Type?.render === 'function') {
        // forwardRef: ref를 그대로 넘긴다
        Wrapped = React.forwardRef((props: any, ref: any) => {
            const { [STICKER_PROP]: sticker, ...rest } = props ?? {}
            return post(Type.render(rest, ref), sticker)
        })
    } else if (Type?.type != null) {
        // memo: 안쪽을 감싸고 비교 함수는 유지
        Wrapped = React.memo(wrapComponent(Type.type), Type.compare)
    } else return Type

    for (const k of ['displayName', 'defaultProps']) if (Type[k] != null) (Wrapped as any)[k] = Type[k]
    ;(Wrapped as any).__stealWrapped = true
    wrapCache.set(Type, Wrapped)
    return Wrapped
}

function post(out: any, sticker: StickerItem | undefined) {
    if (!sticker) return out
    try {
        if (!inject(out, sticker, 0)) dbg('버튼 넣을 자리를 못 찾음')
    } catch (e) {
        dbg(`버튼 추가 실패: ${String(e)}`)
    }
    return out
}

// ── 버튼 자리 찾기 ──
const ours = (sticker: StickerItem) => <StealButtons key={BUTTONS_KEY} sticker={sticker} />
const hasOurs = (arr: any[]) => arr.some(c => c?.key === BUTTONS_KEY)
const isButton = (c: any) => c?.type?.name === 'Button'

/** 자식 배열에 넣기: 기존 버튼이 있으면 그 뒤에 (Stealmoji와 동일), 없으면 맨 끝 */
function pushInto(arr: any[], sticker: StickerItem) {
    if (hasOurs(arr)) return
    let i = -1
    for (let k = arr.length - 1; k >= 0; k--) if (isButton(arr[k])) {
        i = k
        break
    }
    if (i >= 0) arr.splice(i + 1, 0, ours(sticker))
    else arr.push(ours(sticker))
}

/**
 * 창 렌더 결과를 따라 내려가며 버튼 자리를 찾는다.
 *  - 자식이 배열이면 거기에 넣는다
 *  - 자식이 요소 하나면 그 안으로 내려간다
 *  - 자식이 함수(render prop)면 그 결과에 넣도록 감싼다
 *  - 자식이 없는 컴포넌트(실제 내용을 그리는 컴포넌트)면 그 컴포넌트를 감싸서 렌더 결과에 넣는다
 */
function inject(node: any, sticker: StickerItem, depth: number): boolean {
    if (!node || typeof node !== 'object' || depth > 8) return false
    if (Array.isArray(node)) {
        pushInto(node, sticker)
        return true
    }
    const props = node.props
    if (!props) return false
    const children = props.children

    if (Array.isArray(children)) {
        pushInto(children, sticker)
        return true
    }
    if (typeof children === 'function') {
        const render = children
        props.children = (...a: any[]) => {
            const r = render(...a)
            inject(r, sticker, depth + 1)
            return r
        }
        return true
    }
    if (children && typeof children === 'object') {
        if (inject(children, sticker, depth + 1)) return true
        // 안에 넣을 자리가 없으면, View일 때만 [기존 자식, 버튼]으로 바꾼다
        // (View는 자식이 여러 개여도 안전. 자식 하나만 받는 컴포넌트는 건드리지 않는다)
        if (node.type === ReactNative.View) {
            props.children = [children, ours(sticker)]
            return true
        }
        return false
    }

    // 자식 없는 컴포넌트 = 내용을 직접 그리는 컴포넌트 → 감싸서 그 결과에 넣는다
    if (typeof node.type !== 'string' && isWrappable(node.type)) {
        node.type = wrapComponent(node.type)
        node.props = { ...props, [STICKER_PROP]: sticker }
        return true
    }
    return false
}

export default () =>
    before('openLazy', LazyActionSheet, (args: any[]) => {
        const [lazySheet, name] = args
        if (name !== SHEET_NAME || typeof lazySheet?.then !== 'function') return

        args[0] = lazySheet.then((mod: any) => {
            const Orig = mod?.default
            if (!Orig) return mod
            const Default = function StealStickerDefault(props: any) {
                const res = typeof Orig === 'function' && !Orig.prototype?.isReactComponent ? Orig(props) : React.createElement(Orig, props)
                try {
                    const sticker = stickerFromProps(props)
                    // 모듈.default가 돌려준 요소의 type이 실제 창 컴포넌트 (Stealmoji와 동일) → 형태를 보존해 감싼다
                    if (sticker && res && typeof res.type !== 'string' && isWrappable(res.type)) {
                        return { ...res, type: wrapComponent(res.type), props: { ...res.props, [STICKER_PROP]: sticker } }
                    }
                } catch (e) {
                    dbg(`창 감싸기 실패: ${String(e)}`)
                }
                return res
            }
            return { ...mod, default: Default }
        })
        return args
    })
