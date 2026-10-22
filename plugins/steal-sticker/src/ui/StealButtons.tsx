import { Clipboard } from '@revenge-mod/externals/react-native-clipboard'
import { Platform, Text, TouchableOpacity } from 'react-native'
import { getDesign, getDownloadMediaAsset, hideSheet } from '../modules'
import { FORMAT, formatOf, stickerUrl, type StickerItem } from '../sticker'
import { showToast } from '../toast'
import { showAddToServerSheet } from './AddToServerSheet'

/** 디자인 버튼이 없는 버전용 대체 버튼 */
function FallbackButton({ text, onPress }: { text: string; onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={{ marginTop: 12, backgroundColor: '#c9305d', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>{text}</Text>
        </TouchableOpacity>
    )
}

const saveTarget = () => Platform.select({ android: 'Downloads', default: 'Camera Roll' })

export default function StealButtons({ sticker }: { sticker: StickerItem }) {
    let Button: any
    try {
        Button = getDesign().Button
    } catch {}
    const download = getDownloadMediaAsset()
    const lottie = formatOf(sticker) === FORMAT.LOTTIE
    const url = stickerUrl(sticker)

    const buttons = [
        {
            text: 'Add to Server',
            callback: () =>
                lottie ? showToast('Discord only lets official and partnered servers upload animated Lottie stickers') : showAddToServerSheet(sticker),
        },
        {
            text: 'Copy URL to clipboard',
            callback: () => {
                Clipboard.setString(url)
                hideSheet()
                showToast(`Copied ${sticker.name}'s URL to clipboard`)
            },
        },
        !lottie &&
            download && {
                text: `Save image to ${saveTarget()}`,
                callback: () => {
                    download(url, formatOf(sticker) === FORMAT.GIF ? 1 : 0)
                    hideSheet()
                    showToast(`Saved ${sticker.name}'s image to ${saveTarget()}`)
                },
            },
    ].filter(Boolean) as Array<{ text: string; callback: () => void }>

    return (
        <>
            {buttons.map(({ text, callback }) =>
                Button ? (
                    <Button
                        key={text}
                        variant='primary'
                        size='md'
                        text={text}
                        onPress={callback}
                        style={{ marginTop: Platform.select({ android: 12, default: 16 }) }}
                    />
                ) : (
                    <FallbackButton key={text} text={text} onPress={callback} />
                ),
            )}
        </>
    )
}
