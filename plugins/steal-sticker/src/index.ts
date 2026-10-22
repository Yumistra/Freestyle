import patchStickerSheet from './patches/StickerSheet'

export default plugin({
    start({ cleanup }) {
        cleanup(patchStickerSheet())
    },
})
