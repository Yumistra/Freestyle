import { React } from '@vendetta/metro/common'
import { after, before } from '@vendetta/patcher'
import { showToast } from '@vendetta/ui/toasts'
import { findInReactTree } from '@vendetta/utils'
import { LazyActionSheet } from '../modules'
import { stickerFromProps, type StickerItem } from '../sticker'
import StealButtons from '../ui/StealButtons'

const SHEET_NAME = 'sticker_detail_action_sheet'
const DEBUG = true
let warned = false
const warnOnce = (msg: string) => {
    if (DEBUG && !warned) {
        warned = true
        showToast(`[Steal Sticker] ${msg}`)
    }
}

/**
 * Stealmoji의 MessageEmojiActionSheet 패치와 같은 구조:
 *  openLazy → 모듈.default가 돌려준 요소(res)의 type = 실제 창 컴포넌트
 *  → 창이 그린 결과의 props.children.props.children = 내용 요소(view)
 *  → view.type이 그린 결과에 버튼을 넣는다 (기존 버튼 옆, 없으면 맨 아래)
 */
export default () => {
    const patches: Array<() => void> = []
    const unpatchLazy = before('openLazy', LazyActionSheet, ([lazySheet, name]: any[]) => {
        if (name !== SHEET_NAME) return
        unpatchLazy() // 모듈.default 패치는 계속 남으므로 이 훅은 한 번이면 된다

        lazySheet.then((module: any) => {
            patches.push(
                after('default', module, (_: any, res: any) => {
                    if (typeof res?.type !== 'function') return warnOnce(`창 요소 형태가 달라요: ${typeof res?.type}`)
                    patches.push(patchSheet(res))
                }),
            )
        })
    })
    return () => {
        unpatchLazy()
        patches.forEach(p => p?.())
    }
}

function patchSheet(res: any) {
    const unpatch = after('type', res, ([props]: any[], out: any) => {
        React.useEffect(() => () => void unpatch(), [])

        const sticker = stickerFromProps(props)
        if (!sticker) return warnOnce(`스티커 정보 없음: ${Object.keys(props ?? {}).join(', ')}`)

        const view = out?.props?.children?.props?.children
        if (typeof view?.type !== 'function') return warnOnce(`내용 요소를 못 찾음: ${Object.keys(out?.props ?? {}).join(', ')}`)

        const unpatchView = after('type', view, (_: any, component: any) => {
            React.useEffect(() => unpatchView, [])
            insertButtons(component, sticker)
        })
    })
    return unpatch
}

function insertButtons(component: any, sticker: StickerItem) {
    const ours = <StealButtons key='steal-sticker-buttons' sticker={sticker} />
    // 기존 버튼이 있으면 그 뒤에, 없으면 맨 아래에 (Stealmoji와 동일)
    const isButton = (c: any) => c?.type?.name === 'Button'
    const container = findInReactTree(component, (c: any) => c?.find?.(isButton))
    const index = container?.findLastIndex?.(isButton) ?? -1
    if (index >= 0) return container.splice(index + 1, 0, ours)

    const children = component?.props?.children
    if (Array.isArray(children)) children.push(ours)
    else warnOnce(`버튼 넣을 자리를 못 찾음 (children: ${typeof children})`)
}
