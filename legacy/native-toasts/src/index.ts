import { ReactNative, toasts } from '@vendetta/metro/common'
import { instead } from '@vendetta/patcher'

/**
 * 일부 플러그인은 디스코드 토스트 대신 안드로이드 시스템 토스트(ToastAndroid)를 쓴다.
 * 그건 회색 사각형으로 떠서 디스코드 UI와 어울리지 않으므로, 가로채서 디스코드 토스트로 띄운다.
 * (Revenge의 showToast도 같은 디스코드 ToastActionCreators를 쓰므로 모양이 같아진다)
 */

const METHODS = ['show', 'showWithGravity', 'showWithGravityAndOffset'] as const
const unpatches: Array<() => void> = []
let seq = 0

function openDiscordToast(text: unknown): boolean {
    const open = (toasts as any)?.open
    if (typeof open !== 'function') return false
    try {
        open.call(toasts, { key: `native-toast-${Date.now()}-${seq++}`, content: String(text ?? '') })
        return true
    } catch {
        return false
    }
}

export default {
    onLoad() {
        const ToastAndroid = (ReactNative as any)?.ToastAndroid
        if (!ToastAndroid) return
        for (const key of METHODS) {
            if (typeof ToastAndroid[key] !== 'function') continue
            unpatches.push(
                instead(key, ToastAndroid, function (this: any, args: any[], original: any) {
                    // 디스코드 토스트를 못 띄우면 원래 시스템 토스트로 (아무것도 안 뜨는 일은 없게)
                    if (!openDiscordToast(args[0])) return original.apply(this, args)
                }),
            )
        }
    },
    onUnload() {
        for (const u of unpatches.splice(0)) {
            try {
                u()
            } catch {}
        }
    },
}
