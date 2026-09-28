import { findByProps, findByStoreName } from '@vendetta/metro'

export { findByProps, findByStoreName }

/**
 * 모듈 검색은 비싸다(모듈 수천 개를 훑음). 필요할 때 한 번만 찾고 결과를 캐시한다.
 * 못 찾았을 때도 캐시하되, 앱 로딩 중이라 아직 없을 수 있으니 일정 간격 후에만 다시 찾는다.
 */
const RETRY_MS = 2000
export function lazy<T = any>(find: () => T | undefined): () => T | undefined {
    let value: T | undefined
    let lastMissAt = -Infinity
    return () => {
        if (value !== undefined) return value
        const now = Date.now()
        if (now - lastMissAt < RETRY_MS) return undefined
        try {
            value = find() ?? undefined
        } catch {}
        if (value === undefined) lastMissAt = now
        return value
    }
}

// 유저 클라이언트가 쓰는 스토어들 (지연 로딩 + 캐시)
export const getSelectedChannelStore = lazy(() => findByStoreName('SelectedChannelStore'))
export const getChannelStore = lazy(() => findByStoreName('ChannelStore'))
export const getUserStore = lazy(() => findByStoreName('UserStore'))
