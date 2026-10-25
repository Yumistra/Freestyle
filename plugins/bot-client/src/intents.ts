export interface IntentDef {
    bit: number
    name: string
    label: string
    privileged?: boolean
}

export const INTENTS: IntentDef[] = [
    { bit: 1 << 0, name: 'GUILDS', label: 'Servers & channels' },
    { bit: 1 << 1, name: 'GUILD_MEMBERS', label: 'Server members', privileged: true },
    { bit: 1 << 2, name: 'GUILD_MODERATION', label: 'Bans & audit log' },
    { bit: 1 << 3, name: 'GUILD_EXPRESSIONS', label: 'Emojis, stickers & soundboard' },
    { bit: 1 << 4, name: 'GUILD_INTEGRATIONS', label: 'Integrations' },
    { bit: 1 << 5, name: 'GUILD_WEBHOOKS', label: 'Webhooks' },
    { bit: 1 << 6, name: 'GUILD_INVITES', label: 'Invites' },
    { bit: 1 << 7, name: 'GUILD_VOICE_STATES', label: 'Voice states' },
    { bit: 1 << 8, name: 'GUILD_PRESENCES', label: 'Presences', privileged: true },
    { bit: 1 << 9, name: 'GUILD_MESSAGES', label: 'Server messages' },
    { bit: 1 << 10, name: 'GUILD_MESSAGE_REACTIONS', label: 'Server reactions' },
    { bit: 1 << 11, name: 'GUILD_MESSAGE_TYPING', label: 'Server typing' },
    { bit: 1 << 12, name: 'DIRECT_MESSAGES', label: 'DM' },
    { bit: 1 << 13, name: 'DIRECT_MESSAGE_REACTIONS', label: 'DM reactions' },
    { bit: 1 << 14, name: 'DIRECT_MESSAGE_TYPING', label: 'DM typing' },
    { bit: 1 << 15, name: 'MESSAGE_CONTENT', label: 'Message content', privileged: true },
    { bit: 1 << 16, name: 'GUILD_SCHEDULED_EVENTS', label: 'Scheduled events' },
    { bit: 1 << 20, name: 'AUTO_MODERATION_CONFIGURATION', label: 'AutoMod configuration' },
    { bit: 1 << 21, name: 'AUTO_MODERATION_EXECUTION', label: 'AutoMod execution' },
    { bit: 1 << 24, name: 'GUILD_MESSAGE_POLLS', label: 'Server polls' },
    { bit: 1 << 25, name: 'DIRECT_MESSAGE_POLLS', label: 'DM polls' },
]

const GUILD_MEMBERS = 1 << 1
const GUILD_PRESENCES = 1 << 8
const MESSAGE_CONTENT = 1 << 15

export const PRIVILEGED_MASK = GUILD_MEMBERS | GUILD_PRESENCES | MESSAGE_CONTENT
const ALL_INTENTS = INTENTS.reduce((acc, i) => acc | i.bit, 0)

// 특권 인텐트 중 메시지 내용만 기본 포함 (없으면 채팅 내용이 빈칸으로 보임)
export const DEFAULT_INTENTS = (ALL_INTENTS & ~PRIVILEGED_MASK) | MESSAGE_CONTENT

/** GET /applications/@me 의 flags로 포털에서 켜진 특권 인텐트 계산 */
export function allowedPrivileged(appFlags: number): number {
    let mask = 0
    if (appFlags & ((1 << 12) | (1 << 13))) mask |= GUILD_PRESENCES
    if (appFlags & ((1 << 14) | (1 << 15))) mask |= GUILD_MEMBERS
    if (appFlags & ((1 << 18) | (1 << 19))) mask |= MESSAGE_CONTENT
    return mask
}
