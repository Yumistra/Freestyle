import { instead } from '@vendetta/patcher'
import { isBotSession } from './auth'
import { findByProps } from './modules'
import { log, settings } from './state'

interface RuleCtx {
    match: RegExpMatchArray
    opts: any
    call: (opts: any) => Promise<any>
}
type Handler = (c: RuleCtx) => Promise<any>

const respond = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, headers: {}, body, text: JSON.stringify(body ?? null), hasErr: false })

const obj = () => respond({})
const list = () => respond([])

const denied = () => {
    const body = { message: 'Bots cannot use this endpoint', code: 20001 }
    return Promise.reject({ ok: false, status: 403, headers: {}, body, text: JSON.stringify(body), hasErr: true })
}

/** 봇은 /users/:id/profile을 못 쓰므로 /users/:id (+ 서버 멤버)로 프로필 응답 모양을 만든다 */
async function fakeProfile({ match, opts, call }: RuleCtx) {
    const userId = match[1]
    const res = await call({ url: `/users/${userId}` })
    const user = res?.body ?? {}
    const guildId = opts?.query?.guild_id
    const guild_member = guildId
        ? await call({ url: `/guilds/${guildId}/members/${userId}` }).then(
              (r: any) => r?.body,
              () => undefined,
          )
        : undefined
    const body = {
        user,
        user_profile: { bio: '', pronouns: '', accent_color: user.accent_color ?? null, banner: user.banner ?? null, theme_colors: null, profile_effect: null },
        badges: [],
        guild_badges: [],
        connected_accounts: [],
        mutual_guilds: [],
        mutual_friends_count: 0,
        premium_type: null,
        premium_since: null,
        premium_guild_since: null,
        legacy_username: null,
        application: null,
        guild_member,
        guild_member_profile: guild_member ? { guild_id: guildId, bio: '', pronouns: '', banner: null, accent_color: null } : undefined,
    }
    return { ...res, body, text: JSON.stringify(body) }
}

// 봇 토큰으로 호출하면 401/403이 나는 유저 전용 엔드포인트. 401은 강제 로그아웃을 부를 수 있어 미리 가짜 응답으로 막는다.
const RULES: Array<[method: string, pattern: RegExp, handler: Handler]> = [
    ['*', /^\/(science|metrics|track)\b/, obj],
    ['*', /^\/experiments\b/, () => respond({ assignments: [], guild_experiments: [] })],
    ['*', /^\/users\/@me\/settings-proto\/\d+$/, () => respond({ settings: '' })],
    ['*', /^\/users\/@me\/settings$/, obj],
    ['*', /^\/users\/@me\/guilds\/(\d+\/)?settings$/, obj],
    ['GET', /^\/users\/@me\/channels$/, list],
    ['*', /^\/users\/@me\/(relationships|connections|mentions)\b/, list],
    ['*', /^\/users\/@me\/notes\//, () => respond({ note: '' })],
    [
        '*',
        /^\/users\/@me\/(affinities|billing|library|survey|harvest|collectibles|referrals|devices|consent|activities|entitlements|guilds\/premium|content-inventory|burst-credits|saved-messages|phone|quests|applications\/\d+\/entitlements)\b/,
        obj,
    ],
    ['*', /^\/(quests|promotions|outbound-promotions|premium|gift-codes|hypesquad|tutorial)\b/, obj],
    ['*', /^\/applications\/detectable$/, list],
    ['*', /^\/channels\/\d+\/messages\/\d+\/ack$/, () => respond({ token: null })],
    ['*', /^\/read-states\//, obj],
    ['*', /^\/auth\/(logout|sessions|location-metadata|fingerprint)\b/, obj],
    // 유저로서 다른 봇의 슬래시 명령·버튼 실행 — 봇은 불가
    ['POST', /^\/interactions$/, denied],
    ['GET', /^\/users\/(\d+)\/profile$/, fakeProfile],
]

let extraCache = { src: '', list: [] as RegExp[] }
function extraRules() {
    const src = settings().extraStubs.join('\n')
    if (src !== extraCache.src) {
        const list: RegExp[] = []
        for (const p of settings().extraStubs) {
            try {
                list.push(new RegExp(p))
            } catch {}
        }
        extraCache = { src, list }
    }
    return extraCache.list
}

const toPath = (url: unknown) =>
    String(url ?? '')
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(\/v\d+)?/, '')
        .split('?')[0]

const METHODS = [
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['del', 'DELETE'],
] as const

export function installRest(unpatches: Array<() => void>) {
    const http = findByProps('getAPIBaseURL', 'get')
    if (!http) {
        log('error', 'REST 모듈(HTTP)을 찾지 못함')
        return
    }
    for (const [key, method] of METHODS) {
        if (typeof http[key] !== 'function') continue
        unpatches.push(
            instead(key, http, (args: any[], original: any) => {
                if (!isBotSession()) return original.apply(http, args)
                const opts = typeof args[0] === 'string' ? { url: args[0] } : (args[0] ?? {})
                const path = toPath(opts.url)
                const call = (o: any) => original.apply(http, [o])

                for (const [m, re, handler] of RULES) {
                    if (m !== '*' && m !== method) continue
                    const match = path.match(re)
                    if (match) return handler({ match, opts, call })
                }
                if (extraRules().some(re => re.test(path))) return obj()

                const res = original.apply(http, args)
                res?.then?.(undefined, (e: any) => log('rest', `${method} ${path} → ${e?.status ?? '오류'} ${e?.body?.message ?? ''}`))
                return res
            }),
        )
    }
    log('info', 'REST 패치 적용됨')
}
