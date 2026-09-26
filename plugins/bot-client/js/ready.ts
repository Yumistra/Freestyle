import type { DmEntry, DmUser } from './state'

// GUILD_CREATE에서 properties로 옮기지 않을 배열 필드
const LIST_KEYS = new Set([
    'channels',
    'threads',
    'roles',
    'emojis',
    'stickers',
    'members',
    'presences',
    'voice_states',
    'stage_instances',
    'guild_scheduled_events',
    'soundboard_sounds',
])

export function patchSelfUser(u: any) {
    return {
        verified: true,
        mfa_enabled: false,
        nsfw_allowed: true,
        premium_type: 0,
        purchased_flags: 0,
        flags: 0,
        phone: null,
        mobile: true,
        desktop: false,
        ...u,
        // email이 null이면 "계정 인증 필요" 배너·전송 제한이 걸릴 수 있어 빈 문자열로 둔다
        email: u?.email ?? '',
        bot: true,
    }
}

const memberRef = (m: any) => ({ ...m, user_id: m?.user?.id })

/** 봇 GUILD_CREATE(평면 구조) → 유저 클라이언트가 기대하는 구조(properties 포함). 구버전 처리 경로도 쓸 수 있게 원본 필드는 유지 */
export function toUserGuild(g: any, selfId?: string) {
    if (!g || g.unavailable) return g
    const properties: Record<string, unknown> = {}
    for (const k in g) if (!LIST_KEYS.has(k)) properties[k] = g[k]
    const members: any[] = g.members ?? []
    const self = members.find(m => m?.user?.id === selfId)
    return {
        ...g,
        properties,
        data_mode: 'full',
        version: 0,
        lazy: true,
        channels: g.channels ?? [],
        threads: g.threads ?? [],
        roles: g.roles ?? [],
        emojis: g.emojis ?? [],
        stickers: g.stickers ?? [],
        members,
        presences: g.presences ?? [],
        voice_states: g.voice_states ?? [],
        stage_instances: g.stage_instances ?? [],
        guild_scheduled_events: g.guild_scheduled_events ?? [],
        activity_instances: [],
        embedded_activities: [],
        application_command_counts: {},
        member_count: g.member_count ?? members.length,
        joined_at: g.joined_at ?? self?.joined_at ?? null,
    }
}

export function dmChannel(id: string, recipient: DmUser, lastMessageId?: string | null) {
    return {
        id,
        type: 1,
        flags: 0,
        is_spam: false,
        last_message_id: lastMessageId ?? null,
        recipients: [recipient],
        recipient_ids: [recipient.id],
    }
}

export function buildReady(raw: any, loaded: Map<string, any>, dms: DmEntry[]) {
    const selfId: string | undefined = raw?.user?.id
    const guilds = (raw?.guilds ?? []).map((g: any) =>
        loaded.has(g.id) ? toUserGuild(loaded.get(g.id), selfId) : { id: g.id, unavailable: true },
    )

    const users = new Map<string, any>()
    const private_channels = dms.map(dm => {
        users.set(dm.recipient.id, dm.recipient)
        return dmChannel(dm.id, dm.recipient, dm.lastMessageId)
    })
    for (const g of guilds) for (const m of g.members ?? []) if (m?.user?.id && !users.has(m.user.id)) users.set(m.user.id, m.user)

    return {
        ...raw,
        user: patchSelfUser(raw?.user),
        guilds,
        merged_members: guilds.map((g: any) => (g.members ?? []).filter((m: any) => m?.user?.id === selfId).map(memberRef)),
        private_channels,
        users: [...users.values()],
        relationships: [],
        presences: [],
        sessions: [],
        connected_accounts: [],
        guild_experiments: [],
        experiments: [],
        guild_join_requests: [],
        read_state: { version: 0, partial: false, entries: [] },
        user_guild_settings: { version: 0, partial: false, entries: [] },
        user_settings: {},
        notification_settings: { flags: 0 },
        consents: { personalization: { consented: false } },
        tutorial: null,
        friend_suggestion_count: 0,
        country_code: 'US',
        analytics_token: '',
        auth_session_id_hash: '',
        api_code_version: 1,
        session_type: 'normal',
        static_client_session_id: raw?.session_id,
    }
}

/** 봇은 READY_SUPPLEMENTAL을 받지 않으므로 GUILD_CREATE의 음성 상태·접속 상태로 만들어준다 (배열 순서는 READY.guilds와 동일) */
export function buildSupplemental(ready: any) {
    const selfId = ready?.user?.id
    const guilds: any[] = ready?.guilds ?? []
    return {
        guilds: guilds.map(g => ({ id: g.id, voice_states: g.voice_states ?? [], embedded_activities: [], activity_instances: [] })),
        merged_members: guilds.map(g => (g.members ?? []).filter((m: any) => m?.user?.id !== selfId).map(memberRef)),
        merged_presences: {
            guilds: guilds.map(g =>
                (g.presences ?? []).map((p: any) => ({
                    user_id: p?.user?.id,
                    status: p?.status,
                    client_status: p?.client_status ?? {},
                    activities: p?.activities ?? [],
                })),
            ),
            friends: [],
        },
        lazy_private_channels: [],
        disclose: [],
        game_invites: [],
    }
}
