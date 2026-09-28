import { instead } from '@vendetta/patcher'
import { isBotSession } from './auth'
import { findByProps, getChannelStore } from './modules'
import { log, settings } from './state'

interface RuleCtx {
    match: RegExpMatchArray
    opts: any
    call: (opts: any) => Promise<any> // 지금 가로챈 것과 같은 메서드의 원본
    get: (opts: any) => Promise<any> // 패치되지 않은 원본 GET (POST 규칙에서 조회할 때)
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

// ── 포럼: 게시글 목록은 유저 전용 검색 API(threads/search)로 불러온다. 봇 API로 같은 모양을 만든다 ──

// 스노우플레이크(숫자 문자열) 내림차순 비교
const snowDesc = (a?: string, b?: string) => {
    const x = String(a ?? '0'), y = String(b ?? '0')
    return x.length !== y.length ? y.length - x.length : y < x ? -1 : y > x ? 1 : 0
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)])

async function starterMessages(ids: string[], get: RuleCtx['get']) {
    // 포럼 게시글의 첫 메시지 ID는 스레드 ID와 같다
    const got = await Promise.all(ids.map(id => get({ url: `/channels/${id}/messages/${id}` }).then((r: any) => r?.body, () => null)))
    return got.filter(Boolean)
}

async function forumSearch({ match, opts, get }: RuleCtx) {
    const call = get
    const channelId = match[1]
    const q = opts?.query ?? {}
    let guildId: string | undefined
    try {
        const ch = getChannelStore()?.getChannel?.(channelId)
        guildId = ch?.guild_id ?? ch?.getGuildId?.()
    } catch {}

    const [active, archived] = await Promise.all([
        guildId ? call({ url: `/guilds/${guildId}/threads/active` }).then((r: any) => r?.body, () => null) : Promise.resolve(null),
        call({ url: `/channels/${channelId}/threads/archived/public`, query: { limit: 100 } }).then((r: any) => r?.body, () => null),
    ])

    const byId = new Map<string, any>()
    for (const t of active?.threads ?? []) if (t?.parent_id === channelId) byId.set(t.id, t)
    for (const t of archived?.threads ?? []) if (t && !byId.has(t.id)) byId.set(t.id, t)
    let threads = [...byId.values()]

    const tags = asList(q.tag)
    if (tags.length) threads = threads.filter(t => (t.applied_tags ?? []).some((id: string) => tags.includes(id)))

    const byCreation = String(q.sort_by ?? '') === 'creation_time'
    threads.sort((a, b) => (byCreation ? snowDesc(a.id, b.id) : snowDesc(a.last_message_id ?? a.id, b.last_message_id ?? b.id)))
    if (String(q.sort_order ?? 'desc') === 'asc') threads.reverse()

    const offset = Number(q.offset ?? 0) || 0
    const limit = Math.min(Number(q.limit ?? 25) || 25, 25)
    const page = threads.slice(offset, offset + limit)
    const pageIds = new Set(page.map(t => t.id))
    const members = [...(active?.members ?? []), ...(archived?.members ?? [])].filter((m: any) => pageIds.has(m?.id))

    const body = {
        threads: page,
        members,
        total_results: threads.length,
        has_more: offset + limit < threads.length,
        first_messages: await starterMessages([...pageIds], get),
        most_recent_messages: [],
    }
    log('info', `포럼 목록 대체: ${page.length}/${threads.length}개`)
    return respond(body)
}

/** 포럼 게시글 미리보기 데이터(유저 전용)도 첫 메시지로 채운다 */
async function forumPostData({ opts, get }: RuleCtx) {
    const ids = asList(opts?.body?.thread_ids).slice(0, 25)
    const msgs = await starterMessages(ids, get)
    const threads: Record<string, unknown> = {}
    for (const m of msgs) threads[m.channel_id ?? m.id] = { first_message: m }
    return respond({ threads })
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
    ['GET', /^\/channels\/(\d+)\/threads\/search$/, forumSearch],
    ['POST', /^\/channels\/(\d+)\/post-data$/, forumPostData],
]

// 추가 차단 경로: 설정이 바뀔 때만(배열이 새로 저장될 때만) 정규식을 다시 만든다.
// 예전엔 요청마다 settings()를 두 번 복사하고 배열을 문자열로 합쳐 비교했다
let extraSrc: string[] | undefined
let extraList: RegExp[] = []
function extraRules() {
    const src = settings().extraStubs
    if (src !== extraSrc) {
        extraSrc = src
        extraList = []
        for (const p of src) {
            try {
                extraList.push(new RegExp(p))
            } catch {}
        }
    }
    return extraList
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
    const rawGet = http.get.bind(http) // 패치 전 원본 GET
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
                    if (match) return handler({ match, opts, call, get: rawGet })
                }
                const extra = extraRules()
                if (extra.length && extra.some(re => re.test(path))) return obj()

                const res = original.apply(http, args)
                res?.then?.(undefined, (e: any) => log('rest', `${method} ${path} → ${e?.status ?? '오류'} ${e?.body?.message ?? ''}`))
                return res
            }),
        )
    }
    log('info', 'REST 패치 적용됨')
}
