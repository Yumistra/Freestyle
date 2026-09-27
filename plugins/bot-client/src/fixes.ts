import { after, instead } from '@vendetta/patcher'
import { isBotSession } from './auth'
import { findByProps, findByStoreName } from './modules'
import { log } from './state'

// 봇 계정엔 2단계 인증 정보가 없어서, 이 함수들이 내부에서 undefined.includes(...)로 터진다
const MFA_METHODS = ['hasTOTPEnabled', 'hasWebAuthnEnabled', 'hasSMSEnabled'] as const

/** 봇 세션에서만: 원래 함수를 부르고, 터지면 fallback을 돌려준다 */
function guard(obj: any, key: string, fallback: unknown, unpatches: Array<() => void>, where: string) {
    if (typeof obj?.[key] !== 'function') return false
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
    log('info', `${where}.${key} 보호`)
    return true
}

/**
 * 봇 계정에 없는 유저 전용 필드 때문에 화면이 크래시하는 곳을 막는다.
 * - 현재 사용자 레코드에 빈 목록을 채운다
 * - 필드 이름이 달라도 안전하도록 2FA 확인 함수 자체를 감싼다 (레코드 메서드든 유틸 함수든)
 */
export function installUserFixes(unpatches: Array<() => void>) {
    // 유틸 모듈로 export된 경우
    for (const key of MFA_METHODS) {
        const mod = findByProps(key)
        if (mod) guard(mod, key, false, unpatches, 'module')
    }

    const UserStore = findByStoreName('UserStore')
    if (typeof UserStore?.getCurrentUser !== 'function') {
        log('error', 'UserStore.getCurrentUser를 찾지 못함 — 사용자 필드 보정 생략')
        return
    }

    let protoDone = false
    unpatches.push(
        after('getCurrentUser', UserStore, (_args: any[], user: any) => {
            if (!user || !isBotSession()) return user
            if (user.authenticatorTypes == null) user.authenticatorTypes = []
            if (user.authenticator_types == null) user.authenticator_types = []
            // 사용자 레코드 클래스의 메서드인 경우: 처음 본 레코드의 프로토타입을 한 번만 감싼다
            if (!protoDone) {
                protoDone = true
                const proto = Object.getPrototypeOf(user)
                for (const key of MFA_METHODS) guard(proto, key, false, unpatches, 'UserRecord')
            }
            return user
        }),
    )
}
