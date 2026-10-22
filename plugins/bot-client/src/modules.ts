import { Stores } from '@revenge-mod/discord/flux'
import { lookupModule } from '@revenge-mod/modules/finders'
import { createFilterGenerator, withProps } from '@revenge-mod/modules/finders/filters'
import { isModuleExportBad } from '@revenge-mod/modules/metro'

/** 지정한 속성을 모두 가진 모듈 (default export도 확인) */
export function findByProps(...props: string[]): any {
    return lookupModule(withProps(...(props as [string, ...string[]])))[0]
}

/** 이름으로 Flux 스토어 찾기 */
export function findByStoreName(name: string): any {
    return Stores[name]
}

// 임의 조건으로 찾는 필터. 검색 결과는 key별로 캐시되므로 조건마다 key를 다르게 준다
let predicateFilter: any
/** 조건 함수로 모듈 찾기 */
export function find(key: string, fn: (m: any) => boolean): any {
    predicateFilter ??= createFilterGenerator<[key: string, fn: (m: any) => boolean]>(
        ([, test], _id, exports) => !isModuleExportBad(exports) && (typeof exports === 'object' || typeof exports === 'function') && !!test(exports),
        ([k]) => `yumistra.bot-client.${k}`,
    )
    return lookupModule(predicateFilter(key, fn))[0]
}

/**
 * 모듈 검색은 비싸다(모듈 수천 개를 훑음). 필요할 때 한 번만 찾고 결과를 캐시한다.
 * 못 찾았을 때도 캐시하되, 앱 로딩 중이라 아직 없을 수 있으니 일정 간격 후에만 다시 찾는다.
 */
const RETRY_MS = 2000
export function lazy<T = any>(f: () => T | undefined): () => T | undefined {
    let value: T | undefined
    let lastMissAt = -Infinity
    return () => {
        if (value !== undefined) return value
        const now = Date.now()
        if (now - lastMissAt < RETRY_MS) return undefined
        try {
            value = f() ?? undefined
        } catch {}
        if (value === undefined) lastMissAt = now
        return value
    }
}

// 유저 클라이언트가 쓰는 스토어들 (지연 로딩 + 캐시)
export const getSelectedChannelStore = lazy(() => findByStoreName('SelectedChannelStore'))
export const getChannelStore = lazy(() => findByStoreName('ChannelStore'))
export const getUserStore = lazy(() => findByStoreName('UserStore'))
