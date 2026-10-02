import { find, findByProps, findByStoreName } from '@vendetta/metro'

// Stealmoji와 같은 방식으로 모듈을 찾는다. 없을 수도 있는 건 지연 조회
export const LazyActionSheet = findByProps('hideActionSheet')

const lazy = <T,>(f: () => T) => {
    let v: T | undefined
    return () => (v ??= f())
}

export const getActionSheet = lazy(() => findByProps('ActionSheet')?.ActionSheet ?? find((m: any) => m?.render?.name === 'ActionSheet'))
export const getTitleHeader = lazy(
    () => findByProps('ActionSheetTitleHeader')?.ActionSheetTitleHeader ?? findByProps('BottomSheetTitleHeader')?.BottomSheetTitleHeader,
)
export const getCloseButton = lazy(() => findByProps('ActionSheetCloseButton')?.ActionSheetCloseButton)
export const getFlatList = lazy(() => findByProps('BottomSheetScrollView')?.BottomSheetFlatList)
export const getGuildIcon = lazy(() => findByProps('GuildIconSizes'))
export const getDesignButton = lazy(() => findByProps('TableRow', 'Button')?.Button)
export const getDownloadMediaAsset = lazy(() => findByProps('downloadMediaAsset')?.downloadMediaAsset)
export const getStickersStore = lazy(() => findByStoreName('StickersStore'))
