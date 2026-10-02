import { React } from '@vendetta/metro/common'
import { before } from '@vendetta/patcher'
import { showToast } from '@vendetta/ui/toasts'
import { findInReactTree } from '@vendetta/utils'
import { LazyActionSheet } from '../modules'
import { stickerFromProps, type StickerItem } from '../sticker'
import StealButtons from '../ui/StealButtons'

const SHEET_NAME = 'sticker_detail_action_sheet'
export const DEBUG = true
const dbg = (msg: string) => DEBUG && showToast(`[Steal Sticker] ${msg}`)

/**
 * 구조는 Stealmoji와 같다: 모듈.default → 창 컴포넌트 → props.children.props.children(내용) → 내용에 버튼 추가.
 * 다른 점: 디스코드 모듈의 default를 덮어쓰지 않는다. 스티커 창 모듈은 default가 읽기 전용이라 덮어쓰기가
 * 조용히 실패했다. 대신 openLazy에 넘어가는 Promise를 "감싼 모듈"로 바꿔치기한다.
 * 감싼 컴포넌트는 원본별로 한 번만 만들어 캐시한다 (매 렌더마다 새 컴포넌트가 되면 창이 다시 마운트된다).
 */

// 함수·memo·forwardRef 어떤 컴포넌트든 "props → 렌더 결과" 함수로 꺼낸다
function renderFn(Type: any): ((props: any, ref?: any) => any) | undefined {
    if (typeof Type === 'function') return Type
    if (typeof Type?.type === 'function') return Type.type // React.memo
    if (typeof Type?.render === 'function') return Type.render // forwardRef
}

const sheetCache = new WeakMap<object, any>()
const contentCache = new WeakMap<object, any>()

/** 내용 컴포넌트: 원래 내용을 그리고 버튼을 붙인다 */
function wrapContent(Type: any) {
    const cached = contentCache.get(Type)
    if (cached) return cached
    const render = renderFn(Type)!
    const Wrapped = function StealStickerContent(props: any, ref?: any) {
        const { __stealSticker, ...rest } = props
        const out = render(rest, ref)
        if (__stealSticker) insertButtons(out, __stealSticker)
        return out
    }
    contentCache.set(Type, Wrapped)
    return Wrapped
}

/** 창 컴포넌트: 원래 창을 그린 뒤, 안쪽 내용 요소를 감싼 내용 컴포넌트로 바꾼다 */
function wrapSheet(Type: any) {
    const cached = sheetCache.get(Type)
    if (cached) return cached
    const render = renderFn(Type)!
    const Wrapped = function StealStickerSheet(props: any, ref?: any) {
        const out = render(props, ref)
        const sticker = stickerFromProps(props)
        if (!sticker) {
            dbg(`스티커 정보 없음: ${Object.keys(props ?? {}).join(', ')}`)
            return out
        }
        const holder = out?.props?.children
        const view = holder?.props?.children
        if (view && renderFn(view.type)) {
            holder.props.children = { ...view, type: wrapContent(view.type), props: { ...view.props, __stealSticker: sticker } }
            return out
        }
        // 구조가 다르면: 창 결과에 바로 붙여 본다
        dbg(`내용 요소 구조가 달라요 → 창 맨 아래에 붙임 (${Object.keys(out?.props ?? {}).join(', ')})`)
        insertButtons(out, sticker)
        return out
    }
    sheetCache.set(Type, Wrapped)
    return Wrapped
}

function insertButtons(component: any, sticker: StickerItem) {
    const ours = <StealButtons key='steal-sticker-buttons' sticker={sticker} />
    const isButton = (c: any) => c?.type?.name === 'Button'
    const container = findInReactTree(component, (c: any) => c?.find?.(isButton))
    const index = container?.findLastIndex?.(isButton) ?? -1
    if (index >= 0) {
        if (!container.some((c: any) => c?.key === 'steal-sticker-buttons')) container.splice(index + 1, 0, ours)
        return
    }
    const children = component?.props?.children
    if (Array.isArray(children)) {
        if (!children.some((c: any) => c?.key === 'steal-sticker-buttons')) children.push(ours)
    } else if (component?.props) {
        component.props.children = [children, ours]
    } else dbg('버튼 넣을 자리를 못 찾음')
}

export default () =>
    before('openLazy', LazyActionSheet, (args: any[]) => {
        const [lazySheet, name] = args
        if (name !== SHEET_NAME || typeof lazySheet?.then !== 'function') return
        dbg('스티커 창 감지')

        args[0] = lazySheet.then((mod: any) => {
            const Orig = mod?.default
            if (!Orig) {
                dbg('창 모듈에 default가 없음')
                return mod
            }
            // 모듈.default가 돌려주는 요소의 type이 실제 창 컴포넌트 (Stealmoji와 동일)
            const Default = function StealStickerDefault(props: any) {
                const res = typeof Orig === 'function' ? Orig(props) : React.createElement(Orig, props)
                if (res && renderFn(res.type)) return { ...res, type: wrapSheet(res.type) }
                dbg(`창 요소 형태가 달라요: ${typeof res?.type}`)
                return res
            }
            return { ...mod, default: Default }
        })
        return args
    })
