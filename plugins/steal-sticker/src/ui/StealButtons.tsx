import { clipboard, React, ReactNative } from '@vendetta/metro/common'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'
import { getDesignButton, getDownloadMediaAsset, LazyActionSheet } from '../modules'
import { FORMAT, formatOf, stickerUrl, type StickerItem } from '../sticker'
import { showAddToServerSheet } from './AddToServerSheet'

/** 디자인 버튼이 없는 버전용 대체 버튼 */
function FallbackButton({ text, onPress }: { text: string; onPress: () => void }) {
    const { TouchableOpacity, Text } = ReactNative
    return (
        <TouchableOpacity onPress={onPress} style={{ marginTop: 12, backgroundColor: '#c9305d', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>{text}</Text>
        </TouchableOpacity>
    )
}

export default function StealButtons({ sticker }: { sticker: StickerItem }) {
    const Button: any = getDesignButton()
    const download = getDownloadMediaAsset()
    const lottie = formatOf(sticker) === FORMAT.LOTTIE
    const url = stickerUrl(sticker)

    const buttons = [
        !lottie && { text: 'Add to Server', callback: () => showAddToServerSheet(sticker) },
        {
            text: 'Copy URL to clipboard',
            callback: () => {
                clipboard.setString(url)
                LazyActionSheet.hideActionSheet()
                showToast(`Copied ${sticker.name}'s URL to clipboard`, getAssetIDByName('ic_copy_message_link'))
            },
        },
        !lottie &&
            download && {
                text: `Save image to ${ReactNative.Platform.select({ android: 'Downloads', default: 'Camera Roll' })}`,
                callback: () => {
                    download(url, formatOf(sticker) === FORMAT.GIF ? 1 : 0)
                    LazyActionSheet.hideActionSheet()
                    showToast(`Saved ${sticker.name}'s image to ${ReactNative.Platform.select({ android: 'Downloads', default: 'Camera Roll' })}`, getAssetIDByName('toast_image_saved'))
                },
            },
    ].filter(Boolean) as Array<{ text: string; callback: () => void }>

    return (
        <>
            {buttons.map(({ text, callback }) =>
                Button ? (
                    <Button
                        key={text}
                        color={Button.Colors?.BRAND}
                        text={text}
                        size={Button.Sizes?.SMALL}
                        onPress={callback}
                        style={{ marginTop: ReactNative.Platform.select({ android: 12, default: 16 }) }}
                    />
                ) : (
                    <FallbackButton key={text} text={text} onPress={callback} />
                ),
            )}
        </>
    )
}
