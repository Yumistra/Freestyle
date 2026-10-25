import { Dispatcher as FluxDispatcher } from '@revenge-mod/discord/common/flux'
import { BundleUpdaterManager } from '@revenge-mod/discord/native'
import { after } from '@revenge-mod/patcher'
import { AppRegistry, AppState, NativeModules, TurboModuleRegistry } from 'react-native'
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

// 부팅 중 디스코드가 찍는 로그는 매우 많다. 객체를 통째로 JSON.stringify하면 시작이 버벅이므로
// 문자열과 Error만 보고, 길이를 먼저 자른다
const INTERESTING = /error|exception|reject|undefined|null|cannot|failed/i
function describe(args: any[]): string {
    let out = ''
    for (const a of args) {
        let piece: string
        if (typeof a === 'string') piece = a
        else if (a instanceof Error) piece = `${a.message} @ ${String(a.stack ?? '').split('\n', 3).slice(1).join(' | ')}`
        else continue
        out += (out ? ' ' : '') + piece.slice(0, 300)
        if (out.length >= 400) break
    }
    return out.slice(0, 400)
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
        if (level === 'warn' && !INTERESTING.test(msg)) return
        lastCaught = `${level}: ${msg}`
        log('error', `Caught ${lastCaught}`)
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
    try {
        ;(globalThis as any).__botClientReady = false
    } catch {}
    stopCapture()
    if (lastCaught) reason = `${reason} — last error: ${lastCaught}`
    saveSettings({ enabled: false, bootArmed: false })
    recordError(reason)
    setTimeout(() => {
        try {
            if (isBotSession()) logout()
        } catch {}
    }, delayMs)
}

/** 디스코드 JS 번들을 다시 불러온다 (Revenge 오류 화면의 "Reload Discord"와 같은 기능) */
export function reloadApp(): boolean {
    const get = (f: () => any) => {
        try {
            return f()
        } catch {
            return undefined
        }
    }
    const candidates = [
        get(() => BundleUpdaterManager),
        get(() => (globalThis as any).nativeModuleProxy?.BundleUpdaterManager),
        get(() => (NativeModules as any)?.BundleUpdaterManager),
        get(() => (NativeModules as any)?.RTNBundleUpdaterManager),
        get(() => (TurboModuleRegistry as any)?.get?.('NativeBundleUpdaterManager')),
        get(() => (TurboModuleRegistry as any)?.get?.('BundleUpdaterManager')),
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
        log('error', 'Still stuck after reload, leaving it to the guard')
        return
    }
    // 의도한 새로고침이라 실패로 세지 않도록 armed를 풀고 기록해 둔다
    saveSettings({ lastAutoReloadAt: Date.now(), bootArmed: false })
    log('gateway', 'Loading stuck, reloading')
    setTimeout(() => {
        if (!reloadApp()) log('error', 'Reload not found, restart the app')
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
            bailOut(`Bot mode turned off after ${failCount} stuck launches`, 3000)
            return false
        }
        saveSettings({ failCount })
        recordError(`Last launch didn't finish (${failCount}/${MAX_FAILS})`)
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
    // 다른 플러그인(theme-fix)이 "봇 로그인이 끝나 새로고침해도 안전"을 알 수 있게 전역 플래그로 알린다
    try {
        ;(globalThis as any).__botClientReady = isBotSession()
    } catch {}
    log('gateway', 'Connected, guard cleared')
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
            log('error', `CONNECTION_OPEN subscribe failed: ${String(e)}`)
        }
    }

    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(checkStall, STALL_RELOAD_MS)

    if (watchdog) clearTimeout(watchdog)
    const ms = settings().readyTimeoutMs + WATCHDOG_EXTRA_MS
    watchdog = setTimeout(() => {
        if (done) return
        bailOut(`Not connected within ${Math.round(ms / 1000)}s, bot mode turned off`)
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

/**
 * 스와이프로 앱을 닫으면 안드로이드가 JS는 살려두고 화면만 없앤다. 다시 열면 화면만 새로 붙으면서
 * (AppRegistry.runApplication 재호출) 봇 세션이 로딩에서 멈춘다. 강제 종료 후 재실행이 되는 이유는 JS가
 * 처음부터 다시 시작되기 때문이므로, 백그라운드 이후 화면이 다시 만들어지면 JS를 새로 불러온다.
 *  - 콜드 스타트의 첫 runApplication은 백그라운드 전에 일어나므로 새로고침하지 않는다
 *  - 홈 버튼으로 나갔다 돌아오는 건 runApplication이 다시 불리지 않아 영향 없다
 */
let sawBackground = false

function onRunApplication() {
    if (!sawBackground) return
    sawBackground = false
    const s = settings()
    if (!s.autoReload || !s.enabled || !isBotSession()) return
    log('gateway', 'App reopened, reloading')
    setTimeout(() => {
        if (!reloadApp()) log('error', 'Reload not found, force stop and restart the app')
    }, 300)
}

export function installRelaunchReload(unpatches: Array<() => void>) {
    if (typeof AppRegistry?.runApplication !== 'function' || typeof AppState?.addEventListener !== 'function') {
        log('error', 'Cannot detect app restarts (no AppRegistry/AppState)')
        return
    }

    sawBackground = false
    const sub = AppState.addEventListener('change', (state: string) => {
        if (state === 'background') sawBackground = true
    })
    unpatches.push(() => sub?.remove?.())

    unpatches.push(
        // Revenge 패처의 after 훅은 결과값을 받아서 돌려줘야 한다
        after(AppRegistry as any, 'runApplication', (result: any) => {
            onRunApplication()
            return result
        }),
    )
}
