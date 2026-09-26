import { Stores } from '@revenge-mod/discord/flux'
import { lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'

export const BOT_PREFIX = 'Bot '
export const stripBot = (t: string) => t.trim().replace(/^Bot\s+/i, '')

let tokenSource: { getToken(): string | null | undefined } | undefined

export function getCurrentToken(): string | undefined {
    if (!tokenSource) {
        try {
            const store = (Stores as any).AuthenticationStore
            if (typeof store?.getToken === 'function') tokenSource = store
        } catch {}
        if (!tokenSource) {
            const [mod, id] = lookupModule(withProps<any>('getToken', 'setToken'))
            if (id !== undefined) tokenSource = mod
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
 * switchAccountToken은 기존 유저 세션을 서버에서 무효화하지 않는다.
 */
export async function loginWithBotToken(raw: string) {
    const token = BOT_PREFIX + stripBot(raw)
    const [switcher, sid] = lookupModule(withProps<any>('switchAccountToken'))
    if (sid !== undefined) return switcher.switchAccountToken(token)
    const [login, lid] = lookupModule(withProps<any>('loginToken'))
    if (lid !== undefined) return login.loginToken(token)
    throw new Error('로그인 모듈(switchAccountToken / loginToken)을 찾지 못했습니다')
}

export function logout() {
    const [mod, id] = lookupModule(withProps<any>('logout', 'loginToken'))
    if (id === undefined) throw new Error('logout 모듈을 찾지 못했습니다')
    return mod.logout()
}
