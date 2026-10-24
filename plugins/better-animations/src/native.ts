import { callNativeMethod } from '@revenge-mod/modules/native'
import { status } from './settings'

/**
 * 네이티브(plugin.jar) 부분: 채팅 메시지 애니메이션.
 * 설정은 같은 storage.json 을 읽으므로, 저장한 뒤 다시 읽으라고만 알린다.
 */

export const NATIVE_ID = 'yumistra.better-animations'

function call(name: string) {
    try {
        return Promise.resolve((callNativeMethod as any)(`${NATIVE_ID}.${name}`, []))
    } catch (e) {
        return Promise.reject(e)
    }
}

export function reloadNative() {
    call('reload').catch(() => {})
}

export function pingNative() {
    return call('ping').then(
        () => {
            status.native = true
        },
        () => {
            status.native = false
        },
    )
}
