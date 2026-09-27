import { SelectedChannelStore } from './modules'
import { log, settings } from './state'

export const API_BASE = 'https://discord.com/api/v10'

export interface ApiResult {
    ok: boolean
    status: number
    body: any
}

/** 클라이언트 로그인 상태와 무관하게, 저장된 봇 토큰으로 공식 API를 직접 호출 */
export async function botRequest(method: string, path: string, body?: unknown, token = settings().token): Promise<ApiResult> {
    const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`
    const headers: Record<string, string> = { Authorization: `Bot ${token}` }
    let payload: string | undefined
    if (body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
    }
    const res = await fetch(url, { method, headers, body: payload })
    const text = await res.text()
    let parsed: any = text
    try {
        parsed = text ? JSON.parse(text) : null
    } catch {}
    return { ok: res.ok, status: res.status, body: parsed }
}

/** 봇 토큰인지 확인하고, 포털 설정(특권 인텐트 허용 여부)을 가져온다. 유저 토큰은 거부. */
export async function validateBotToken(token: string) {
    const me = await botRequest('GET', '/users/@me', undefined, token)
    if (!me.ok) throw new Error(`토큰 확인 실패 (HTTP ${me.status}) — 토큰을 다시 확인하세요`)
    if (!me.body?.bot) throw new Error('봇 토큰만 지원합니다')
    const app = await botRequest('GET', '/applications/@me', undefined, token)
    return {
        user: me.body,
        appId: String(app.ok ? (app.body?.id ?? me.body.id) : me.body.id),
        flags: app.ok ? Number(app.body?.flags ?? 0) : undefined,
    }
}

/** {channel} = 지금 보고 있는 채널, {app} = 애플리케이션 ID */
export function fillPlaceholders(path: string) {
    let channel = ''
    try {
        channel = SelectedChannelStore?.getChannelId?.() ?? ''
    } catch {}
    return path.replace(/\{channel\}/g, channel).replace(/\{app\}/g, settings().appId)
}

/**
 * 인터랙션은 3초 안에 첫 응답을 해야 실패하지 않는다. 수동 응답은 그 안에 불가능하므로 자동으로 defer하고,
 * 이후 15분 동안 PATCH /webhooks/{app}/{token}/messages/@original 로 실제 응답을 채운다.
 */
export function deferInteraction(i: any) {
    const type = i?.type === 3 ? 6 : i?.type === 4 ? 8 : 5
    const body = type === 8 ? { type, data: { choices: [] } } : { type }
    botRequest('POST', `/interactions/${i.id}/${i.token}/callback`, body).then(
        r => log(r.ok ? 'info' : 'error', `인터랙션 defer → HTTP ${r.status}`),
        e => log('error', `인터랙션 defer 실패: ${String(e)}`),
    )
}
