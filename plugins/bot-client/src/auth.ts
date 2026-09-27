import { findByProps, findByStoreName } from './modules'

export const BOT_PREFIX = 'Bot '
export const stripBot = (t: string) => t.trim().replace(/^Bot\s+/i, '')

let tokenSource: { getToken(): string | null | undefined } | undefined

export function getCurrentToken(): string | undefined {
    if (!tokenSource) {
        const store = findByStoreName('AuthenticationStore')
        if (typeof store?.getToken === 'function') tokenSource = store
        else {
            const mod = findByProps('getToken', 'setToken')
            if (mod) tokenSource = mod
        }
    }
    try {
        return tokenSource?.getToken() ?? undefined
    } catch {
        return undefined
    }
}

/** 클라이언트에 저장된 토큰이 "Bot " 으로 시작하면 봇 세션으로 본다 */
export const isBotSession = () => getCurrentToken()?.startsWith(BOT_PREFIX) === true

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
