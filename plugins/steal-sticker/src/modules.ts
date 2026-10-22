import { ActionSheetActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import { BottomSheet } from '@revenge-mod/externals/gorhom'
import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { unproxify } from '@revenge-mod/utils/proxy'

// 모듈 검색은 비싸서 한 번 찾으면 기억한다. 못 찾은 건 다음에 다시 찾는다
const lazy = <T,>(f: () => T | undefined) => {
    let v: T | undefined
    return () => {
        if (v === undefined) {
            try {
                v = f() ?? undefined
            } catch {}
        }
        return v
    }
}

export const byProps = (...props: string[]): any => lookupModule(withProps(...(props as [string, ...string[]])))[0]

export const sheets = (): any => unproxify(ActionSheetActionCreators as any)
export const hideSheet = () => {
    try {
        ActionSheetActionCreators.hideActionSheet()
    } catch {}
}

export const getActionSheet = lazy<any>(() => Design.ActionSheet)
export const getTitleHeader = lazy<any>(() => Design.BottomSheetTitleHeader)
export const getCloseButton = lazy<any>(() => byProps('ActionSheetCloseButton')?.ActionSheetCloseButton)
export const getFlatList = lazy<any>(() => BottomSheet.BottomSheetFlatList)
export const getGuildIcon = lazy<any>(() => byProps('GuildIconSizes'))
export const getDesign = () => Design
export const getDownloadMediaAsset = lazy<any>(() => byProps('downloadMediaAsset')?.downloadMediaAsset)
export const getStickersStore = (): any => Stores.StickersStore
export const getStore = (name: string): any => Stores[name]
