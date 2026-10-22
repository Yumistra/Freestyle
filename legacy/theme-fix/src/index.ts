import { findByProps, findByStoreName } from '@vendetta/metro'
import { FluxDispatcher } from '@vendetta/metro/common'

/**
 * Revenge는 커스텀 테마를 디스코드에 "bn-theme-N"이라는 테마로 등록한 뒤
 * AppearanceManager.updateTheme("bn-theme-N")으로 적용한다 (revenge-bundle themes/colors/updater.ts).
 * 계정을 바꾸면 디스코드가 새 계정의 외형 설정으로 "현재 테마 이름"만 덮어쓰고,
 * 등록된 bn-theme 색 정의는 메모리에 그대로 남는다. 그래서 새로고침 없이
 * updateTheme(마지막 bn-theme 키)만 다시 부르면 테마가 돌아온다.
 */

// 계정 전환 뒤 디스코드가 외형을 여러 번 덮어쓸 수 있어 이 시간 동안은 계속 되돌린다
const SWITCH_WINDOW_MS = 20000
const BN_PREFIX = 'bn-theme-'

let lastBnKey: string | undefined
let lastUserId: string | undefined
let switchUntil = 0
const disposers: Array<() => void> = []

/** Revenge에서 커스텀 테마가 선택돼 있는가 (사용자가 테마를 끈 경우엔 되돌리지 않기 위해) */
function themeSelected(): boolean {
    try {
        const themes = (globalThis as any).vendetta?.themes
        if (typeof themes?.getCurrentTheme === 'function') return !!themes.getCurrentTheme()
    } catch {}
    // API를 못 찾으면, 이번 세션에 커스텀 테마가 적용된 적이 있으면 선택된 것으로 본다
    return !!lastBnKey
}

export default {
    onLoad() {
        const ThemeStore = findByStoreName('ThemeStore')
        const AppearanceManager = findByProps('updateTheme', 'setShouldSyncAppearanceSettings') ?? findByProps('updateTheme')
        const UserStore = findByStoreName('UserStore')
        if (!ThemeStore || typeof AppearanceManager?.updateTheme !== 'function') return

        const current = () => String(ThemeStore.theme ?? '')

        const reapply = () => {
            if (!lastBnKey || !themeSelected() || current().startsWith(BN_PREFIX)) return
            try {
                // Revenge와 같은 순서: 서버 동기화를 끄고 커스텀 테마로 되돌린다
                AppearanceManager.setShouldSyncAppearanceSettings?.(false)
                AppearanceManager.updateTheme(lastBnKey)
            } catch {}
        }

        // 이미 커스텀 테마가 적용된 상태로 로드되면 그 키를 기억
        if (current().startsWith(BN_PREFIX)) lastBnKey = current()
        try {
            lastUserId = UserStore?.getCurrentUser?.()?.id ?? undefined
        } catch {}

        // 테마가 바뀔 때마다: 커스텀 테마면 키를 기억, 계정 전환 직후 덮어써졌으면 되돌림
        const onThemeChange = () => {
            const t = current()
            if (t.startsWith(BN_PREFIX)) {
                lastBnKey = t
                return
            }
            // 디스패치 도중에 테마를 바꾸지 않도록 한 박자 뒤에 실행
            if (Date.now() < switchUntil) setTimeout(reapply, 0)
        }
        ThemeStore.addChangeListener(onThemeChange)
        disposers.push(() => ThemeStore.removeChangeListener(onThemeChange))

        // 계정 전환 시작(로그아웃·로그인) 시점부터 되돌리기 창을 연다
        const openWindow = () => {
            switchUntil = Date.now() + SWITCH_WINDOW_MS
        }
        // 새 계정 연결이 끝나면 실제로 계정이 바뀌었는지 확인하고 한 번 더 되돌린다
        const onOpen = () => {
            let id: string | undefined
            try {
                id = UserStore?.getCurrentUser?.()?.id ?? undefined
            } catch {}
            if (!id) return
            const prev = lastUserId
            lastUserId = id
            if (!prev || prev === id) return
            openWindow()
            setTimeout(reapply, 0)
        }

        for (const [type, fn] of [
            ['LOGOUT', openWindow],
            ['LOGIN_SUCCESS', openWindow],
            ['CONNECTION_OPEN', onOpen],
        ] as const) {
            FluxDispatcher.subscribe(type, fn)
            disposers.push(() => FluxDispatcher.unsubscribe(type, fn))
        }
    },
    onUnload() {
        for (const d of disposers.splice(0)) {
            try {
                d()
            } catch {}
        }
    },
}
