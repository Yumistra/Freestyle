import { find } from '@vendetta/metro'
import { FluxDispatcher } from '@vendetta/metro/common'
import { instead } from '@vendetta/patcher'
import { isBotSession } from './auth'
import { getUserStore } from './modules'
import { log } from './state'

// 봇 계정엔 2단계 인증 정보가 없어서, 이 함수들이 내부에서 undefined.includes(...)로 터진다
const MFA_METHODS = ['hasTOTPEnabled', 'hasWebAuthnEnabled', 'hasSMSEnabled'] as const

/** 봇 세션에서만: 원래 함수를 부르고, 터지면 fallback을 돌려준다 */
function guard(obj: any, key: string, fallback: unknown, unpatches: Array<() => void>) {
    if (typeof obj?.[key] !== 'function') return
    unpatches.push(
        instead(key, obj, function (this: any, args: any[], original: any) {
            if (!isBotSession()) return original.apply(this, args)
            try {
                return original.apply(this, args)
            } catch {
                return fallback
            }
        }),
    )
}

/**
 * 봇 계정에 없는 유저 전용 필드 때문에 화면이 크래시하는 곳을 막는다.
 *
 * 최적화: 예전엔 UserStore.getCurrentUser에 훅을 걸었는데, 이 함수는 메시지 하나 그릴 때마다 불릴 만큼 잦다.
 * 이제는 "현재 사용자가 바뀌는 이벤트"에서만 한 번 보정하고, 2FA 함수는 드물게 불리므로 그쪽만 감싼다.
 */
export function installUserFixes(unpatches: Array<() => void>) {
    // 유틸 모듈로 export된 2FA 함수: 모듈 검색을 세 번 하지 않고 한 번에 찾는다
    try {
        const mod = find((m: any) => m && MFA_METHODS.some(k => typeof m[k] === 'function') && !m.getCurrentUser)
        for (const key of MFA_METHODS) guard(mod, key, false, unpatches)
    } catch {}

    let protoDone = false
    const patchCurrentUser = () => {
        if (!isBotSession()) return
        let user: any
        try {
            user = getUserStore()?.getCurrentUser?.()
        } catch {}
        if (!user) return
        if (user.authenticatorTypes == null) user.authenticatorTypes = []
        if (user.authenticator_types == null) user.authenticator_types = []
        // 사용자 레코드 클래스의 메서드: 프로토타입을 한 번만 감싼다 (이후 새로 만들어지는 레코드에도 적용됨)
        if (!protoDone) {
            protoDone = true
            const proto = Object.getPrototypeOf(user)
            for (const key of MFA_METHODS) guard(proto, key, false, unpatches)
        }
    }

    // 현재 사용자 레코드가 새로 만들어지는 시점에만 보정 (연결 완료·내 정보 갱신)
    for (const type of ['CONNECTION_OPEN', 'CURRENT_USER_UPDATE', 'USER_UPDATE']) {
        FluxDispatcher.subscribe(type, patchCurrentUser)
        unpatches.push(() => FluxDispatcher.unsubscribe(type, patchCurrentUser))
    }
    patchCurrentUser()
    log('info', '사용자 필드 보정 설치 (이벤트 기반)')
}
