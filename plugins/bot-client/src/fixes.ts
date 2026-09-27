import { after } from '@vendetta/patcher'
import { isBotSession } from './auth'
import { findByStoreName } from './modules'
import { log } from './state'

/**
 * 봇 계정에 없는 유저 전용 필드 때문에 화면이 크래시하는 곳을 막는다.
 * READY에서 채워 넣어도, 이후 이벤트로 현재 사용자 레코드가 다시 만들어지면 빠질 수 있어 읽는 시점에 보정한다.
 */
export function installUserFixes(unpatches: Array<() => void>) {
    const UserStore = findByStoreName('UserStore')
    if (typeof UserStore?.getCurrentUser !== 'function') {
        log('error', 'UserStore.getCurrentUser를 찾지 못함 — 사용자 필드 보정 생략')
        return
    }
    unpatches.push(
        after('getCurrentUser', UserStore, (_args: any[], user: any) => {
            if (!user || !isBotSession()) return user
            // 설정 화면의 hasTOTPEnabled → authenticatorTypes.includes(...) 크래시 방지
            if (user.authenticatorTypes == null) user.authenticatorTypes = []
            if (user.authenticator_types == null) user.authenticator_types = []
            return user
        }),
    )
}
