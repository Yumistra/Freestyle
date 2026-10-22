import { ToastActionCreators } from '@revenge-mod/discord/actions'

let seq = 0

/** 디스코드 기본 토스트 */
export function showToast(text: string) {
    try {
        ToastActionCreators.open(`bot-client-${Date.now()}-${seq++}`, { text })
    } catch {}
}
