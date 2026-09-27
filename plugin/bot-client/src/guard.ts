import { FluxDispatcher, ReactNative } from '@vendetta/metro/common'
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
// 봇으로 켰는데 이 시간 안에 연결이 끝나지 않으면 앱을 한 번 다시 불러온다 (강제 중지 후 재실행과 같은 효과)
const STALL_RELOAD_MS = 10000
// 새로고침 뒤에도 또 멈추면 이 시간 안에는 다시 새로고침하지 않고 워치독에 맡긴다 (무한 새로고침 방지)
const RELOAD_COOLDOWN_MS = 120000
let watchdog: ReturnType<typeof setTimeout> | undefined
let stallTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let done = false

// ── 조용한 실패 진단: 연결 완료 전까지 콘솔 오류·전역 오류를 잡아 둔다 ──
// React Native는 async 안에서 난 오류를 "Possible Unhandled Promise Rejection" 경고로만 남기므로 warn도 본다
let lastCaught = ''
let restoreCapture: (() => void) | undefined

function describe(args: any[]) {
    return args
        .map(a => (a instanceof Error ? `${a.message} @ ${String(a.stack ?? '').split('\n').slice(1, 3).join(' | ')}` : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()))
        .join(' ')
        .slice(0, 400)
}

function startCapture() {
    if (restoreCapture) return
    const c = console as any
    const origError = c.error
    const origWarn = c.warn
    const record = (level: string, args: any[]) => {
        if (done) return
        const msg = describe(args)
        if (!msg || msg.includes('[BotClient]')) return
        if (level === 'warn' && !/error|exception|reject|undefined|null|cannot|failed/i.test(msg)) return
        lastCaught = `${level}: ${msg}`
        log('error', `잡힌 ${lastCaught}`)
    }
    c.error = function (...args: any[]) {
        record('error', args)
        return origError.apply(this, args)
    }
    c.warn = function (...args: any[]) {
        record('warn', args)
        return origWarn.apply(this, args)
    }
    const EU = (globalThis as any).ErrorUtils
    const origHandler = EU?.getGlobalHandler?.()
    if (EU?.setGlobalHandler && origHandler) {
        EU.setGlobalHandler((err: any, fatal: boolean) => {
            record('error', [err])
            return origHandler(err, fatal)
        })
    }
    restoreCapture = () => {
        c.error = origError
        c.warn = origWarn
        if (EU?.setGlobalHandler && origHandler) EU.setGlobalHandler(origHandler)
        restoreCapture = undefined
    }
}

function stopCapture() {
    restoreCapture?.()
}

function recordError(msg: string) {
    saveSettings({ lastError: msg, lastErrorAt: Date.now() })
    log('error', msg)
}

/** 봇 모드를 끄고, 봇 세션이면 로그아웃한다 (앱을 로그인 화면으로 되돌리는 복구 동작) */
export function bailOut(reason: string, delayMs = 0) {
    stopCapture()
    if (lastCaught) reason = `${reason} — 직전 오류: ${lastCaught}`
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

/** 디스코드 JS 번들을 다시 불러온다 (Revenge 오류 화면의 "Reload Discord"와 같은 기능) */
export function reloadApp(): boolean {
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

function checkStall() {
    stallTimer = undefined
    const s = settings()
    if (done || !s.autoReload || !isBotSession()) return
    if (Date.now() - s.lastAutoReloadAt < RELOAD_COOLDOWN_MS) {
        log('error', '방금 새로고침했는데도 로딩이 멈춤 — 안전장치에 맡깁니다')
        return
    }
    // 의도한 새로고침이라 실패로 세지 않도록 armed를 풀고 기록해 둔다
    saveSettings({ lastAutoReloadAt: Date.now(), bootArmed: false })
    log('gateway', '로딩이 멈춰서 앱을 자동으로 다시 불러옵니다')
    setTimeout(() => {
        if (!reloadApp()) log('error', '새로고침 기능을 찾지 못함 — 앱을 직접 다시 켜주세요')
    }, 500)
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
    stopCapture()
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = undefined
    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
    saveSettings({ bootArmed: false, failCount: 0 })
    log('gateway', '정상 연결 확인 — 안전장치 해제')
}

/** 패치를 건 직후 호출: 이번 부팅을 armed로 기록하고 워치독 시작 */
export function arm() {
    done = false
    lastCaught = ''
    startCapture()
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

    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(checkStall, STALL_RELOAD_MS)

    if (watchdog) clearTimeout(watchdog)
    const ms = settings().readyTimeoutMs + WATCHDOG_EXTRA_MS
    watchdog = setTimeout(() => {
        if (done) return
        bailOut(`${Math.round(ms / 1000)}초 안에 연결이 완료되지 않아 봇 모드를 끄고 로그아웃했습니다`)
    }, ms)
}

export function disposeGuard() {
    stopCapture()
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = undefined
    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
    unsubscribe?.()
    unsubscribe = undefined
}
