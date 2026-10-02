import { showToast } from '@vendetta/ui/toasts'
import patchStickerSheet, { DEBUG } from './patches/StickerSheet'

let patches: Array<() => void> = []

export default {
    onLoad() {
        if (DEBUG) showToast('[Steal Sticker] v6 로드됨')
        patches.push(patchStickerSheet())
    },
    onUnload() {
        for (const unpatch of patches.splice(0)) unpatch()
    },
}
