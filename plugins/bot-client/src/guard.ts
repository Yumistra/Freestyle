import { FluxDispatcher } from '@vendetta/metro/common'
import { showToast } from '@vendetta/ui/toasts'
import { isBotSession, logout } from './auth'
import { log, MAX_FAILS, saveSettings, settings } from './state'

/**
 * 크래시 루프 방지 안전장치
 *
 *  - 봇 패치를 건 부팅은 bootArmed=true를 storage에 남긴다.
 *  - 디스코드가 READY를 끝까지 처리하면 CONNECTION_OPEN이 오고, 그때 disarm한다.
 *    (READY를 넘긴 직후가 아니라 CONNECTION_OPEN이어야 "디스코드가 받아들였다"가 확실하다)
 *  - 다음 부팅에서 bootArmed가 남아 있으면 지난 부팅이 멈춘 것 → 실패로 센다.
 *    MAX_FAILS 번 연속이면 봇 모드를 끄고, 봇 세션이면 로그아웃해 앱을 살린다.
 *  - 이번 부팅에서도 제한 시간 안에 CONNECTION_OPEN이 없으면 워치독이 봇 모드를 끄고 로그아웃한다.
 */

const WATCHDOG_EXTRA_MS = 15000
let watchdog: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let done = false

function recordError(msg: string) {
    saveSettings({ lastError: msg, lastErrorAt: Date.now() })
    log('error', msg)
}

/** 봇 모드를 끄고, 봇 세션이면 로그아웃한다 (앱을 로그인 화면으로 되돌리는 복구 동작) */
export function bailOut(reason: string, delayMs = 0) {
    saveSettings({ enabled: false, bootArmed: false })
    recordError(reason)
    try {
        showToast(`[BotClient] ${reason}`)
    } catch {}
    setTimeout(() => {
        try {
            if (isBotSession()) logout()
        } catch {}
    }, delayMs)
}

/** onLoad에서 호출. 이번 부팅에 봇 패치를 걸어도 되는지 판단 */
export function shouldPatch(): boolean {
    const s = settings()
    if (!s.enabled) {
        // 봇 모드가 꺼졌는데 봇 토큰으로 남아 있으면 그대로 두면 멈추므로 로그아웃
        setTimeout(() => {
            try {
                if (isBotSession()) logout()
            } catch {}
        }, 3000)
        return false
    }
    if (s.bootArmed) {
        const failCount = s.failCount + 1
        if (failCount >= MAX_FAILS) {
            saveSettings({ failCount })
            bailOut(`지난 ${failCount}번의 실행이 멈춰서 봇 모드를 껐습니다`, 3000)
            return false
        }
        saveSettings({ failCount })
        recordError(`지난 실행이 정상적으로 뜨지 않았습니다 (${failCount}/${MAX_FAILS})`)
    }
    return true
}

function onConnectionOpen() {
    if (done) return
    done = true
    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
    saveSettings({ bootArmed: false, failCount: 0 })
    log('gateway', '정상 연결 확인 — 안전장치 해제')
}

/** 패치를 건 직후 호출: 이번 부팅을 armed로 기록하고 워치독 시작 */
export function arm() {
    done = false
    saveSettings({ bootArmed: true })

    if (!unsubscribe) {
        try {
            const handler = () => onConnectionOpen()
            FluxDispatcher.subscribe('CONNECTION_OPEN', handler)
            unsubscribe = () => FluxDispatcher.unsubscribe('CONNECTION_OPEN', handler)
        } catch (e) {
            log('error', `CONNECTION_OPEN 구독 실패: ${String(e)}`)
        }
    }

    if (watchdog) clearTimeout(watchdog)
    const ms = settings().readyTimeoutMs + WATCHDOG_EXTRA_MS
    watchdog = setTimeout(() => {
        if (done) return
        bailOut(`${Math.round(ms / 1000)}초 안에 연결이 완료되지 않아 봇 모드를 끄고 로그아웃했습니다`)
    }, ms)
}

export function disposeGuard() {
    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
    unsubscribe?.()
    unsubscribe = undefined
}
