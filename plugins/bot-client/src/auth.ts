import { findByProps, findByStoreName, lazy } from './modules'

export const BOT_PREFIX = 'Bot '
export const stripBot = (t: string) => t.trim().replace(/^Bot\s+/i, '')

// 토큰 저장소는 한 번 찾으면 캐시. 못 찾으면 2초 간격으로만 다시 찾아 핫패스에서 모듈 전체 검색을 반복하지 않는다
const getTokenSource = lazy<{ getToken(): string | null | undefined }>(() => {
    const store = findByStoreName('AuthenticationStore')
    if (typeof store?.getToken === 'function') return store
    const mod = findByProps('getToken', 'setToken')
    return typeof mod?.getToken === 'function' ? mod : undefined
})

export function getCurrentToken(): string | undefined {
    try {
        return getTokenSource()?.getToken() ?? undefined
    } catch {
        return undefined
    }
}

/** 클라이언트에 저장된 토큰이 "Bot " 으로 시작하면 봇 세션으로 본다 */
export function isBotSession(): boolean {
    const t = getCurrentToken()
    return typeof t === 'string' && t.startsWith(BOT_PREFIX)
}

/**
 * 토큰을 "Bot xxx" 형태로 저장시키면 REST의 Authorization 헤더가 그대로 봇 형식이 된다.
 * 게이트웨이 IDENTIFY/RESUME에서는 gateway.ts가 접두사를 떼어낸다.
 */
export async function loginWithBotToken(raw: string) {
    const token = BOT_PREFIX + stripBot(raw)
    const switcher = findByProps('switchAccountToken')
    if (switcher) return switcher.switchAccountToken(token)
    const login = findByProps('loginToken')
    if (login) return login.loginToken(token)
    throw new Error('로그인 모듈(switchAccountToken / loginToken)을 찾지 못했습니다')
}

export function logout() {
    const mod = findByProps('logout', 'loginToken')
    if (!mod) throw new Error('logout 모듈을 찾지 못했습니다')
    return mod.logout()
}
