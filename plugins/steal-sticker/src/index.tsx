import { findByName, findByProps } from '@vendetta/metro'
import { clipboard, React } from '@vendetta/metro/common'
import { after, before } from '@vendetta/patcher'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'
import { findInReactTree } from '@vendetta/utils'
import { formatOf, FORMAT, stickersOf, stickerUrl, uploadableGuilds, uploadSticker, type StickerItem } from './sticker'

const ROW_LABEL = '스티커 훔치기'
const unpatches: Array<() => void> = []

const LazyActionSheet = () => findByProps('openLazy', 'hideActionSheet')
const SimpleSheet = () => findByProps('showSimpleActionSheet')
// 메뉴 한 줄을 그리는 컴포넌트 (버튼을 복제할 때 쓴다)
const ActionSheetRow = () =>
    findByProps('ActionSheetRow')?.ActionSheetRow ?? findByName('ActionSheetRow', false)

function hideSheets() {
    try {
        LazyActionSheet()?.hideActionSheet?.()
    } catch {}
}

function openStickerMenu(s: StickerItem) {
    const guilds = uploadableGuilds()
    const copy = () => {
        clipboard.setString(stickerUrl(s))
        showToast('스티커 URL을 복사했어요')
    }
    const upload = async (g: { id: string; name: string }) => {
        hideSheets()
        showToast(`${g.name}에 추가하는 중…`)
        const err = await uploadSticker(s, g.id)
        showToast(err ?? `${g.name}에 "${s.name}" 스티커를 추가했어요`)
    }
    const sheet = SimpleSheet()
    if (typeof sheet?.showSimpleActionSheet !== 'function') return copy()
    const lottie = formatOf(s) === FORMAT.LOTTIE
    sheet.showSimpleActionSheet({
        key: 'StealStickerSheet',
        header: { title: s.name, onClose: hideSheets },
        options: [
            { label: 'URL 복사', onPress: copy },
            ...(lottie
                ? [{ label: 'Lottie 스티커는 공식·파트너 서버만 업로드 가능', onPress: hideSheets }]
                : guilds.length
                  ? guilds.map(g => ({ label: `${g.name}에 추가`, onPress: () => upload(g) }))
                  : [{ label: '스티커를 추가할 권한이 있는 서버가 없어요', onPress: hideSheets }]),
        ],
    })
}

function onSteal(stickers: StickerItem[]) {
    hideSheets()
    if (stickers.length === 1) return setTimeout(() => openStickerMenu(stickers[0]), 200)
    const sheet = SimpleSheet()
    if (typeof sheet?.showSimpleActionSheet !== 'function') return setTimeout(() => openStickerMenu(stickers[0]), 200)
    sheet.showSimpleActionSheet({
        key: 'StealStickerPick',
        header: { title: '어떤 스티커를 가져올까요?', onClose: hideSheets },
        options: stickers.map(s => ({ label: s.name, onPress: () => setTimeout(() => openStickerMenu(s), 300) })),
    })
}

export default {
    onLoad() {
        const sheet = LazyActionSheet()
        if (!sheet) return showToast('[Steal Sticker] 액션시트 모듈을 못 찾았어요')

        unpatches.push(
            before('openLazy', sheet, (args: any[]) => {
                const [component, key, ctx] = args
                const stickers = stickersOf(ctx?.message)
                if (key !== 'MessageLongPressActionSheet' || !stickers.length || typeof component?.then !== 'function') return

                component.then((instance: any) => {
                    const Row = ActionSheetRow()
                    const unpatch = after('default', instance, (_a: any[], tree: any) => {
                        React.useEffect(() => () => unpatch(), [])

                        // Stealmoji 방식: 기존 ActionSheetRow 컴포넌트를 트리에서 찾아, 그게 담긴 배열에 한 줄 추가한다
                        const row = findInReactTree(
                            tree,
                            (n: any) => n?.props?.label != null && (Row ? n.type === Row : typeof n?.props?.onPress === 'function'),
                        )
                        const siblings = findInReactTree(tree, (n: any) => Array.isArray(n) && n.includes(row))
                        if (!row || !siblings || siblings.some((c: any) => c?.props?.label === ROW_LABEL)) return

                        siblings.push(
                            React.createElement(row.type, {
                                key: 'steal-sticker',
                                label: ROW_LABEL,
                                icon: row.props.icon
                                    ? React.cloneElement(row.props.icon, { source: getAssetIDByName?.('ic_sticker') ?? row.props.icon.props?.source })
                                    : undefined,
                                onPress: () => onSteal(stickers),
                            }),
                        )
                    })
                })
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
