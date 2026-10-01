import { findByProps } from '@vendetta/metro'
import { clipboard, React } from '@vendetta/metro/common'
import { after, before } from '@vendetta/patcher'
import { showToast } from '@vendetta/ui/toasts'
import { findInReactTree } from '@vendetta/utils'
import { formatOf, FORMAT, stickersOf, stickerUrl, uploadableGuilds, uploadSticker, type StickerItem } from './sticker'

const ROW_LABEL = '스티커 훔치기'
const unpatches: Array<() => void> = []

const ActionSheet = () => findByProps('openLazy', 'hideActionSheet')
const SimpleSheet = () => findByProps('showSimpleActionSheet')

function hideSheets() {
    try {
        ActionSheet()?.hideActionSheet?.()
    } catch {}
}

/** 스티커 하나에 대한 메뉴: URL 복사 + 업로드 가능한 서버 목록 */
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
    if (typeof sheet?.showSimpleActionSheet !== 'function') {
        // 메뉴를 못 띄우면 최소한 URL이라도 복사
        copy()
        return
    }
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
    if (stickers.length === 1) return openStickerMenu(stickers[0])
    // 메시지에 스티커가 여러 개면(최대 3개) 먼저 고르기
    const sheet = SimpleSheet()
    if (typeof sheet?.showSimpleActionSheet !== 'function') return openStickerMenu(stickers[0])
    sheet.showSimpleActionSheet({
        key: 'StealStickerPick',
        header: { title: '어떤 스티커를 가져올까요?', onClose: hideSheets },
        options: stickers.map(s => ({ label: s.name, onPress: () => setTimeout(() => openStickerMenu(s), 300) })),
    })
}

/** 메뉴 트리에서 버튼 줄(label + onPress를 가진 요소들의 배열)을 찾는다 */
const isRowList = (n: any) => Array.isArray(n) && n.some(c => c?.props?.label != null && typeof c?.props?.onPress === 'function')

export default {
    onLoad() {
        const sheet = ActionSheet()
        if (!sheet) return
        unpatches.push(
            before('openLazy', sheet, (args: any[]) => {
                const [component, key, ctx] = args
                const stickers = stickersOf(ctx?.message)
                if (key !== 'MessageLongPressActionSheet' || !stickers.length || typeof component?.then !== 'function') return
                component.then((instance: any) => {
                    const unpatch = after('default', instance, (_a: any[], tree: any) => {
                        // 메뉴가 닫히면 패치도 같이 풀기
                        React.useEffect(() => () => unpatch(), [])
                        const rows = findInReactTree(tree, isRowList)
                        if (!rows || rows.some((c: any) => c?.props?.label === ROW_LABEL)) return
                        const template = rows.find((c: any) => c?.props?.label != null && typeof c?.props?.onPress === 'function')
                        rows.push(
                            React.cloneElement(template, {
                                key: 'steal-sticker',
                                label: ROW_LABEL,
                                subLabel: undefined,
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
