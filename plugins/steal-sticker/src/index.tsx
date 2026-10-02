import { findByProps, findByStoreName } from '@vendetta/metro'
import { clipboard, React, ReactNative } from '@vendetta/metro/common'
import { after, before } from '@vendetta/patcher'
import { Button } from '@vendetta/ui/components'
import { showToast } from '@vendetta/ui/toasts'
import { formatOf, FORMAT, stickerUrl, uploadableGuilds, uploadSticker, type StickerItem } from './sticker'

const unpatches: Array<() => void> = []
const LazyActionSheet = () => findByProps('openLazy', 'hideActionSheet')
const SimpleSheet = () => findByProps('showSimpleActionSheet')
const MediaDownloader = () => findByProps('downloadMediaAsset')

function hideSheets() {
    try {
        LazyActionSheet()?.hideActionSheet?.()
    } catch {}
}

// ── 스티커 정보 꺼내기: 스티커 창이 받는 값은 버전마다 이름이 달라서 여러 곳을 확인한다 ──
const looksLikeSticker = (o: any) => o && typeof o === 'object' && typeof o.id === 'string' && ('format_type' in o || 'formatType' in o)

function findSticker(ctx: any, depth = 0): StickerItem | undefined {
    if (!ctx || typeof ctx !== 'object' || depth > 3) return
    for (const k of ['sticker', 'renderableSticker', 'stickerItem']) if (looksLikeSticker(ctx[k])) return ctx[k]
    if (typeof ctx.stickerId === 'string') {
        const s = findByStoreName('StickersStore')?.getStickerById?.(ctx.stickerId)
        if (s) return s
    }
    if (looksLikeSticker(ctx)) return ctx
    for (const v of Object.values(ctx)) {
        const s = findSticker(v, depth + 1)
        if (s) return s
    }
}

// ── 동작 ──
function addToServer(s: StickerItem) {
    if (formatOf(s) === FORMAT.LOTTIE) return showToast('움직이는 Lottie 스티커는 디스코드 공식·파트너 서버만 업로드할 수 있어요')
    const guilds = uploadableGuilds()
    if (!guilds.length) return showToast('스티커를 추가할 권한이 있는 서버가 없어요')
    const sheet = SimpleSheet()
    if (typeof sheet?.showSimpleActionSheet !== 'function') return showToast('서버 목록을 띄우지 못했어요')
    hideSheets()
    setTimeout(
        () =>
            sheet.showSimpleActionSheet({
                key: 'StealStickerGuilds',
                header: { title: '어느 서버에 추가할까요?', onClose: hideSheets },
                options: guilds.map(g => ({
                    label: g.name,
                    onPress: async () => {
                        hideSheets()
                        showToast(`${g.name}에 추가하는 중…`)
                        const err = await uploadSticker(s, g.id)
                        showToast(err ?? `${g.name}에 "${s.name}" 스티커를 추가했어요`)
                    },
                })),
            }),
        250,
    )
}

function copyUrl(s: StickerItem) {
    clipboard.setString(stickerUrl(s))
    showToast('스티커 URL을 복사했어요')
}

function saveImage(s: StickerItem) {
    const dl = MediaDownloader()
    if (typeof dl?.downloadMediaAsset !== 'function') return showToast('저장 기능을 찾지 못했어요')
    try {
        dl.downloadMediaAsset(stickerUrl(s), 0)
        showToast('다운로드 폴더에 저장했어요')
    } catch (e) {
        showToast(`저장 실패: ${String((e as Error)?.message ?? e)}`)
    }
}

/** Stealmoji처럼 상세 창 아래에 붙는 큰 버튼 3개 */
function StealButtons({ sticker }: { sticker: StickerItem }) {
    const { View } = ReactNative
    const B: any = Button
    const lottie = formatOf(sticker) === FORMAT.LOTTIE
    const make = (text: string, onPress: () => void) =>
        B ? (
            <B key={text} text={text} color={B.Colors?.BRAND} size={B.Sizes?.MEDIUM} onPress={onPress} style={{ marginTop: 12 }} />
        ) : null
    return (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {!lottie && make('서버에 추가', () => addToServer(sticker))}
            {make('URL 복사', () => copyUrl(sticker))}
            {!lottie && MediaDownloader() && make('다운로드 폴더에 저장', () => saveImage(sticker))}
        </View>
    )
}

/** 창의 렌더 결과 맨 아래에 버튼을 붙인다 (자식이 배열이면 추가, 아니면 [기존, 버튼]으로 감싼다) */
function appendButtons(tree: any, sticker: StickerItem) {
    if (!tree?.props) return tree
    const ours = <StealButtons key='steal-sticker-buttons' sticker={sticker} />
    const children = tree.props.children
    if (Array.isArray(children)) {
        if (!children.some((c: any) => c?.key === 'steal-sticker-buttons')) children.push(ours)
        return tree
    }
    return React.cloneElement(tree, {}, children, ours)
}

const VERSION = 'v3'
// 진단용: 창이 열릴 때마다 어떤 함수·창 이름으로 열리는지 토스트로 보여준다 (원인 확인 후 끌 예정)
const DEBUG = true

/** 창 컴포넌트에 결과 후처리를 건다. 함수 컴포넌트·memo·forwardRef 어느 형태든 대응 */
function patchSheetComponent(instance: any, sticker: StickerItem) {
    let unpatch: (() => void) | undefined
    const hook = (_a: any[], tree: any) => {
        // 창이 닫히면(언마운트) 패치를 푼다. 다음에 창을 열면 openLazy에서 다시 건다
        React.useEffect(() => () => unpatch?.(), [])
        return appendButtons(tree, sticker)
    }
    const target = instance?.default
    if (typeof target === 'function') unpatch = after('default', instance, hook)
    else if (typeof target?.type === 'function') unpatch = after('type', target, hook) // React.memo
    else if (typeof target?.render === 'function') unpatch = after('render', target, hook) // forwardRef
    else {
        if (DEBUG) showToast(`[Steal Sticker] 창 컴포넌트 형태를 모름: ${typeof target} ${Object.keys(target ?? {}).join(',')}`)
        return
    }
}

export default {
    onLoad() {
        showToast(`[Steal Sticker] ${VERSION} 로드됨`)
        const sheet = LazyActionSheet()
        if (!sheet) return showToast('[Steal Sticker] 액션시트 모듈을 못 찾았어요')

        // 진단: 이 모듈에서 창을 여는 함수(open*/show*)를 전부 감시
        if (DEBUG) {
            for (const name of Object.keys(sheet)) {
                if (!/^(open|show)/i.test(name) || typeof sheet[name] !== 'function' || name === 'openLazy') continue
                unpatches.push(
                    before(name, sheet, (args: any[]) => {
                        showToast(`[Steal Sticker] ${name}: ${String(args?.[1] ?? args?.[0]?.key ?? '?')}`)
                    }),
                )
            }
        }

        unpatches.push(
            before('openLazy', sheet, (args: any[]) => {
                const [component, key, ctx] = args
                if (DEBUG) showToast(`[Steal Sticker] openLazy: ${key} / ${Object.keys(ctx ?? {}).join(', ')}`)
                if (typeof component?.then !== 'function' || key === 'MessageLongPressActionSheet') return
                const sticker = findSticker(ctx)
                if (!sticker) return
                component.then((instance: any) => patchSheetComponent(instance, sticker))
            }),
        )
    },
    onUnload() {
        for (const u of unpatches.splice(0)) {
            try {
                u()
            } catch {}
        }
    },
}
