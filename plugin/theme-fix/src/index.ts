import { findByStoreName } from '@vendetta/metro'
import { FluxDispatcher, ReactNative } from '@vendetta/metro/common'
import { showToast } from '@vendetta/ui/toasts'

/**
 * Revenge는 커스텀 테마를 앱 시작 때만 적용한다. 계정을 바꾸면 디스코드가 새 계정의 외형 설정을
 * 다시 적용하면서 테마 색이 풀리므로, 실제로 계정이 바뀐 게 확인되면 앱을 한 번 다시 불러온다.
 */

let lastUserId: string | undefined
let unsubscribe: (() => void) | undefined
let pending: ReturnType<typeof setTimeout> | undefined

/** 디스코드 JS 번들을 다시 불러온다 (Revenge 오류 화면의 "Reload Discord"와 같은 기능) */
function reloadApp(): boolean {
    const RN = ReactNative as any
    const candidates = [
        (globalThis as any).nativeModuleProxy?.BundleUpdaterManager,
        RN?.NativeModules?.BundleUpdaterManager,
        RN?.NativeModules?.RTNBundleUpdaterManager,
        RN?.TurboModuleRegistry?.get?.('NativeBundleUpdaterManager'),
        RN?.TurboModuleRegistry?.get?.('BundleUpdaterManager'),
    ]
    for (const m of candidates) {
        if (typeof m?.reload === 'function') {
            m.reload()
            return true
        }
    }
    return false
}

export default {
    onLoad() {
        const UserStore = findByStoreName('UserStore')
        const currentUserId = (): string | undefined => {
            try {
                return UserStore?.getCurrentUser?.()?.id ?? undefined
            } catch {
                return undefined
            }
        }

        // 이미 로그인된 상태(캐시 포함)로 로드되면 그 계정을 기준으로 삼는다
        lastUserId = currentUserId()

        const onOpen = () => {
            const id = currentUserId()
            if (!id) return
            const prev = lastUserId
            lastUserId = id
            // 첫 연결이거나 같은 계정 재접속이면 아무것도 안 함
            if (!prev || prev === id) return
            try {
                showToast('계정이 바뀌어 테마를 다시 적용합니다')
            } catch {}
            // 다른 플러그인의 CONNECTION_OPEN 처리가 끝나도록 조금 기다린다
            if (pending) clearTimeout(pending)
            pending = setTimeout(() => {
                if (!reloadApp()) {
                    try {
                        showToast('새로고침 기능을 찾지 못했어요. 앱을 직접 다시 켜주세요')
                    } catch {}
                }
            }, 800)
        }

        FluxDispatcher.subscribe('CONNECTION_OPEN', onOpen)
        unsubscribe = () => FluxDispatcher.unsubscribe('CONNECTION_OPEN', onOpen)
    },
    onUnload() {
        if (pending) clearTimeout(pending)
        unsubscribe?.()
        unsubscribe = undefined
    },
}
