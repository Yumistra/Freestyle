import { findByProps, findByStoreName } from '@vendetta/metro'
import { constants } from '@vendetta/metro/common'

const API = 'https://discord.com/api/v9'

// 디스코드 스티커 형식
export const FORMAT = { PNG: 1, APNG: 2, LOTTIE: 3, GIF: 4 } as const

export interface StickerItem {
    id: string
    name: string
    format_type?: number
    formatType?: number
}

export const formatOf = (s: StickerItem) => Number(s.format_type ?? s.formatType ?? FORMAT.PNG)

/** 메시지 레코드에서 스티커 목록 꺼내기 (버전마다 필드 이름이 달라서 여러 개 확인) */
export function stickersOf(message: any): StickerItem[] {
    const list = message?.stickerItems ?? message?.sticker_items ?? message?.stickers ?? []
    return Array.isArray(list) ? list.filter((s: any) => s?.id) : []
}

export function stickerUrl(s: StickerItem) {
    const ext = formatOf(s) === FORMAT.GIF ? 'gif' : formatOf(s) === FORMAT.LOTTIE ? 'json' : 'png'
    return `https://media.discordapp.net/stickers/${s.id}.${ext}`
}

function token(): string | undefined {
    try {
        const store = findByStoreName('AuthenticationStore')
        const t = store?.getToken?.() ?? findByProps('getToken', 'setToken')?.getToken?.()
        return typeof t === 'string' && t ? t : undefined
    } catch {
        return undefined
    }
}

/** 스티커를 만들 권한이 있는 서버 목록 */
export function uploadableGuilds(): Array<{ id: string; name: string }> {
    const GuildStore = findByStoreName('GuildStore')
    const PermissionStore = findByStoreName('PermissionStore')
    const P = (constants as any)?.Permissions ?? {}
    const perms = [P.CREATE_GUILD_EXPRESSIONS, P.MANAGE_GUILD_EXPRESSIONS, P.MANAGE_EMOJIS_AND_STICKERS].filter(v => v != null)
    const guilds = Object.values(GuildStore?.getGuilds?.() ?? {}) as any[]
    return guilds
        .filter(g => perms.some(p => {
            try {
                return PermissionStore?.can?.(p, g)
            } catch {
                return false
            }
        }))
        .map(g => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

/** 원본 스티커의 태그·설명 (서버 스티커만 받아올 수 있고, 실패하면 기본값) */
async function details(s: StickerItem, auth: string) {
    try {
        const res = await fetch(`${API}/stickers/${s.id}`, { headers: { Authorization: auth } })
        if (res.ok) return await res.json()
    } catch {}
    return {}
}

const clamp = (v: string, min: number, max: number, pad: string) => {
    let out = v.trim().slice(0, max)
    while (out.length < min) out += pad
    return out
}

/** 스티커를 서버에 업로드. 성공하면 null, 실패하면 사용자에게 보여줄 메시지 */
export async function uploadSticker(s: StickerItem, guildId: string): Promise<string | null> {
    if (formatOf(s) === FORMAT.LOTTIE) return '움직이는 Lottie 스티커는 디스코드 공식·파트너 서버만 업로드할 수 있어요'
    const auth = token()
    if (!auth) return '로그인 정보를 찾지 못했어요'

    const info: any = await details(s, auth)
    const isGif = formatOf(s) === FORMAT.GIF
    const form = new FormData()
    form.append('name', clamp(info.name ?? s.name ?? 'sticker', 2, 30, '_'))
    // 태그는 필수(2~200자). 원본 태그가 없으면 기본 이모지
    form.append('tags', clamp(String(info.tags ?? '') || '⭐', 1, 200, ''))
    if (info.description && String(info.description).length >= 2) form.append('description', String(info.description).slice(0, 100))
    // 안드로이드 React Native는 http(s) 주소를 파일처럼 첨부하면 내려받아서 보낸다
    form.append('file', { uri: stickerUrl(s), name: `sticker.${isGif ? 'gif' : 'png'}`, type: isGif ? 'image/gif' : 'image/png' } as any)

    try {
        const res = await fetch(`${API}/guilds/${guildId}/stickers`, { method: 'POST', headers: { Authorization: auth }, body: form })
        if (res.ok) return null
        let body: any = {}
        try {
            body = await res.json()
        } catch {}
        if (body?.code === 30039) return '이 서버의 스티커 슬롯이 꽉 찼어요'
        if (body?.code === 50138 || res.status === 413) return '파일이 너무 커요 (최대 512KB)'
        return body?.message ? `업로드 실패: ${body.message}` : `업로드 실패 (HTTP ${res.status})`
    } catch (e) {
        return `업로드 실패: ${String((e as Error)?.message ?? e)}`
    }
}

/** 스티커 상세 창 props에서 스티커 꺼내기 (renderableSticker 등, 버전마다 필드 이름이 달라 여러 이름 확인) */
export function stickerFromProps(props: any): StickerItem | undefined {
    const o = props?.renderableSticker ?? props?.sticker ?? props?.stickerItem
    if (!o || typeof o !== 'object') return
    const id = o.id ?? o.sticker_id ?? o.stickerId ?? o.sticker?.id
    if (id == null) return
    const fmt = o.format_type ?? o.formatType ?? o.format ?? o.sticker?.format_type ?? o.sticker?.formatType
    return { id: String(id), name: String(o.name ?? o.sticker?.name ?? 'sticker'), format_type: Number(fmt ?? FORMAT.PNG) }
}
