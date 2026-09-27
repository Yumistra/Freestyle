export interface IntentDef {
    bit: number
    name: string
    label: string
    privileged?: boolean
}

export const INTENTS: IntentDef[] = [
    { bit: 1 << 0, name: 'GUILDS', label: '서버·채널' },
    { bit: 1 << 1, name: 'GUILD_MEMBERS', label: '서버 멤버', privileged: true },
    { bit: 1 << 2, name: 'GUILD_MODERATION', label: '차단·감사 로그' },
    { bit: 1 << 3, name: 'GUILD_EXPRESSIONS', label: '이모지·스티커·사운드보드' },
    { bit: 1 << 4, name: 'GUILD_INTEGRATIONS', label: '연동' },
    { bit: 1 << 5, name: 'GUILD_WEBHOOKS', label: '웹훅' },
    { bit: 1 << 6, name: 'GUILD_INVITES', label: '초대' },
    { bit: 1 << 7, name: 'GUILD_VOICE_STATES', label: '음성 상태' },
    { bit: 1 << 8, name: 'GUILD_PRESENCES', label: '접속 상태', privileged: true },
    { bit: 1 << 9, name: 'GUILD_MESSAGES', label: '서버 메시지' },
    { bit: 1 << 10, name: 'GUILD_MESSAGE_REACTIONS', label: '서버 반응' },
    { bit: 1 << 11, name: 'GUILD_MESSAGE_TYPING', label: '서버 입력 중 표시' },
    { bit: 1 << 12, name: 'DIRECT_MESSAGES', label: 'DM' },
    { bit: 1 << 13, name: 'DIRECT_MESSAGE_REACTIONS', label: 'DM 반응' },
    { bit: 1 << 14, name: 'DIRECT_MESSAGE_TYPING', label: 'DM 입력 중 표시' },
    { bit: 1 << 15, name: 'MESSAGE_CONTENT', label: '메시지 내용', privileged: true },
    { bit: 1 << 16, name: 'GUILD_SCHEDULED_EVENTS', label: '서버 이벤트' },
    { bit: 1 << 20, name: 'AUTO_MODERATION_CONFIGURATION', label: '자동 관리 설정' },
    { bit: 1 << 21, name: 'AUTO_MODERATION_EXECUTION', label: '자동 관리 실행' },
    { bit: 1 << 24, name: 'GUILD_MESSAGE_POLLS', label: '서버 투표' },
    { bit: 1 << 25, name: 'DIRECT_MESSAGE_POLLS', label: 'DM 투표' },
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
