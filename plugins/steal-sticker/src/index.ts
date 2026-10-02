import patchStickerSheet from './patches/StickerSheet'

let patches: Array<() => void> = []

export default {
    onLoad() {
        patches.push(patchStickerSheet())
    },
    onUnload() {
        for (const unpatch of patches.splice(0)) unpatch()
    },
}
