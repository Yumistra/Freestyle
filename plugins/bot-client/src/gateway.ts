import { before, instead } from '@vendetta/patcher'
import { showToast } from '@vendetta/ui/toasts'
import { deferInteraction } from './api'
import { isBotSession, stripBot } from './auth'
import { findByProps, findByStoreName } from './modules'
import { buildReady, buildSupplemental, dmChannel, patchSelfUser, toUserGuild } from './ready'
import { log, pushInteraction, rememberDm, saveSettings, settings, type Status } from './state'

type Forward = (type: string, data: any) => unknown

// 봇이 보낼 수 있는 opcode만 통과. 14·36·37 같은 유저 전용 opcode를 보내면 서버가 연결을 끊는다.
// 1 = Heartbeat, 40 = QoS Heartbeat (봇은 qos가 null일 때만 허용, 아니면 4002로 끊고 재접속 루프에 빠진다)
const HEARTBEAT = 1
const QOS_HEARTBEAT = 40
const BOT_OPS = new Set([HEARTBEAT, 2, 3, 4, 6, 8, 31, QOS_HEARTBEAT])

interface Pending {
    raw: any
    waiting: Set<string>
    loaded: Map<string, any>
    queue: Array<[string, any]>
    timer: ReturnType<typeof setTimeout>
    forward: Forward
}

let socket: any
let selfId: string | undefined
let pending: Pending | null = null

// ── 송신 ──────────────────────────────────────────────────────────────

export function buildPresence(src?: { status?: string; activities?: any[] }) {
    const s = settings()
    const activities: any[] = []
    const custom = s.customStatus.trim()
    if (custom) activities.push({ type: 4, name: 'Custom Status', state: custom })
    for (const a of src?.activities ?? []) {
        if (a && a.type !== 4 && typeof a.name === 'string') activities.push({ type: a.type ?? 0, name: a.name, state: a.state, url: a.url })
    }
    const status = src?.status && src.status !== 'unknown' ? src.status : s.status
    return { status, since: 0, activities, afk: false }
}

export function sendPresence() {
    if (!socket || !isBotSession()) return false
    socket.send(3, buildPresence())
    return true
}

function buildIdentify(d: any) {
    const s = settings()
    return {
        token: stripBot(String(d?.token ?? '')),
        intents: s.intents,
        properties: { os: 'Android', browser: 'Discord Android', device: 'Discord Android' },
        compress: d?.compress === true,
        large_threshold: 250,
        shard: [0, 1],
        presence: buildPresence({ status: s.status }),
    }
}

function patchSend(target: any): () => void {
    return instead('send', target, function (this: any, args: any[], original: any) {
        const self = this
        if (!isBotSession()) return original.apply(self, args)
        const [op, d] = args
        switch (op) {
            case 2:
                args[1] = buildIdentify(d)
                log('gateway', `IDENTIFY 변환 (intents=${args[1].intents})`)
                break
            case 6:
                args[1] = { ...d, token: stripBot(String(d?.token ?? '')) }
                break
            case 3: {
                args[1] = buildPresence(d)
                const status = args[1].status as Status
                if (status !== settings().status) saveSettings({ status })
                break
            }
            case 4:
                args[1] = { guild_id: d?.guild_id ?? null, channel_id: d?.channel_id ?? null, self_mute: !!d?.self_mute, self_deaf: !!d?.self_deaf }
                break
            case 8:
                // 유저 클라이언트는 guild_id를 배열로 보내지만 봇은 서버 하나씩 요청
                if (Array.isArray(d?.guild_id)) {
                    for (const guild_id of d.guild_id) original.apply(self, [op, { ...d, guild_id }, ...args.slice(2)])
                    return
                }
                break
            case QOS_HEARTBEAT:
                // 봇 게이트웨이는 qos가 객체면 4002로 끊는다. seq는 두고 qos만 null로.
                if (d && typeof d === 'object') args[1] = { ...d, qos: null }
                break
            default:
                if (!BOT_OPS.has(op)) return
        }
        return original.apply(self, args)
    })
}

// ── 수신 ──────────────────────────────────────────────────────────────

/** true를 반환하면 원래 디스패치를 막은 것 (필요하면 forward로 대신 보냄) */
function handle(type: string, data: any, forward: Forward): boolean {
    if (type === 'READY') {
        begin(data, forward)
        return true
    }
    if (pending) {
        if (type === 'GUILD_CREATE' && pending.waiting.delete(data?.id)) {
            pending.loaded.set(data.id, data)
            if (!pending.waiting.size) flush()
        } else pending.queue.push([type, data])
        return true
    }
    switch (type) {
        case 'GUILD_CREATE':
            forward(type, toUserGuild(data, selfId))
            return true
        case 'USER_UPDATE':
            if (data?.id !== selfId) return false
            forward(type, patchSelfUser(data))
            return true
        case 'INTERACTION_CREATE':
            onInteraction(data)
            return true
        case 'MESSAGE_CREATE':
            if (!data?.guild_id) ensureDm(data, forward)
            return false
    }
    return false
}

/** 봇 READY의 서버는 전부 unavailable로 오므로, 뒤이어 오는 GUILD_CREATE를 모은 뒤 유저형 READY 하나로 합친다 */
function begin(raw: any, forward: Forward) {
    if (pending) clearTimeout(pending.timer)
    selfId = raw?.user?.id
    const waiting = new Set<string>((raw?.guilds ?? []).map((g: any) => g.id))
    pending = { raw, waiting, loaded: new Map(), queue: [], forward, timer: setTimeout(flush, settings().readyTimeoutMs) }
    log('gateway', `봇 READY 수신 — 서버 ${waiting.size}개 로딩 대기`)
    if (!waiting.size) flush()
}

function flush() {
    const p = pending
    if (!p) return
    pending = null
    clearTimeout(p.timer)
    try {
        const ready = buildReady(p.raw, p.loaded, settings().dms)
        p.forward('READY', ready)
        p.forward('READY_SUPPLEMENTAL', buildSupplemental(ready))
        log('gateway', `READY 합성 완료 — 서버 ${p.loaded.size}/${p.raw?.guilds?.length ?? 0}`)
    } catch (e) {
        log('error', `READY 합성 실패, 원본 전달: ${(e as Error)?.stack ?? e}`)
        p.forward('READY', { ...p.raw, user: patchSelfUser(p.raw?.user) })
    }
    for (const [t, d] of p.queue) if (!handle(t, d, p.forward)) p.forward(t, d)
}

function ensureDm(msg: any, forward: Forward) {
    const author = msg?.author
    if (!author?.id || author.id === selfId) return
    rememberDm(msg.channel_id, author, msg.id)
    let known = false
    try {
        const ChannelStore = findByProps('getChannel', 'getDMFromUserId')
        known = !!ChannelStore?.getChannel?.(msg.channel_id)
    } catch {}
    if (!known) forward('CHANNEL_CREATE', dmChannel(msg.channel_id, author, msg.id))
}

function onInteraction(i: any) {
    pushInteraction(i)
    if (settings().autoDefer) deferInteraction(i)
    const name = i?.data?.name ? `/${i.data.name}` : (i?.data?.custom_id ?? `type ${i?.type}`)
    const who = i?.member?.user?.username ?? i?.user?.username ?? '?'
    try {
        showToast(`${who}: ${name} — 설정에서 응답`)
    } catch {}
}

function patchHandleDispatch(target: any): () => void {
    return instead('_handleDispatch', target, function (this: any, args: any[], original: any) {
        const self = this
        if (!isBotSession()) return original.apply(self, args)
        // (data, type, …) / (type, data, …) 어느 순서든 대응
        const ti = typeof args[0] === 'string' ? 0 : 1
        const di = ti === 0 ? 1 : 0
        const forward: Forward = (t, d) => {
            const next = args.slice()
            next[ti] = t
            next[di] = d
            return original.apply(self, next)
        }
        if (!handle(args[ti], args[di], forward)) return original.apply(self, args)
    })
}

function patchEmit(target: any): () => void {
    return instead('emit', target, function (this: any, args: any[], original: any) {
        const self = this
        if (args[0] !== 'dispatch' || !isBotSession()) return original.apply(self, args)
        const ti = typeof args[1] === 'string' ? 1 : 2
        const di = ti === 1 ? 2 : 1
        const forward: Forward = (t, d) => {
            const next = args.slice()
            next[ti] = t
            next[di] = d
            return original.apply(self, next)
        }
        if (!handle(args[ti], args[di], forward)) return original.apply(self, args)
        return true
    })
}

export function installGateway(unpatches: Array<() => void>) {
    let stopped = false
    let tries = 0

    const attach = (s: any) => {
        socket = s
        const proto = Object.getPrototypeOf(s)
        // 인스턴스에 직접 붙은 메서드면 인스턴스를, 아니면 프로토타입을 패치 (재연결 후에도 유지)
        const owner = (key: string) => (Object.prototype.hasOwnProperty.call(s, key) ? s : proto)

        if (typeof s.send === 'function') unpatches.push(patchSend(owner('send')))
        else log('error', '소켓 send()를 찾지 못함')

        if (typeof s._handleDispatch === 'function') unpatches.push(patchHandleDispatch(owner('_handleDispatch')))
        else if (typeof s.emit === 'function') {
            unpatches.push(patchEmit(s))
            log('gateway', '_handleDispatch 없음 → emit("dispatch") 훅으로 대체')
        } else log('error', '디스패치 진입점을 찾지 못함')

        // 디스코드가 디스패치 처리 중 예외가 나면 소켓을 리셋하고 재접속한다. 그 예외와 종료 코드를 보이게 한다
        if (typeof s.resetSocketOnError === 'function') {
            unpatches.push(
                before('resetSocketOnError', owner('resetSocketOnError'), (args: any[]) => {
                    if (!isBotSession()) return
                    const info = args[0] ?? {}
                    const err = info.error ?? info
                    const where = String(err?.stack ?? '').split('\n').slice(1, 3).join(' | ').trim()
                    const msg = `소켓 리셋 (${info.action ?? '?'}): ${err?.message ?? String(err)}${where ? ` @ ${where}` : ''}`
                    saveSettings({ lastError: msg, lastErrorAt: Date.now() })
                    log('error', msg)
                }),
            )
        }
        if (typeof s._handleClose === 'function') {
            unpatches.push(
                before('_handleClose', owner('_handleClose'), (args: any[]) => {
                    if (!isBotSession()) return
                    const [, code, reason] = args
                    const msg = `게이트웨이 종료 code=${code ?? '?'} ${reason ?? ''}`
                    if (code && code !== 1000) saveSettings({ lastError: msg, lastErrorAt: Date.now() })
                    log('error', msg)
                }),
            )
        }

        log('gateway', `게이트웨이 소켓 연결됨 (봇 세션: ${isBotSession() ? '예' : '아니오'})`)
    }

    // 소켓이 늦게 생길 수 있으니 0.5초 간격으로 최대 30초 재시도
    const tryGrab = () => {
        if (stopped || socket) return
        let s: any
        try {
            s = findByStoreName('GatewayConnectionStore')?.getSocket?.()
        } catch {}
        if (s) return attach(s)
        if (++tries > 60) return log('error', 'GatewayConnectionStore 소켓을 30초 동안 찾지 못함')
        setTimeout(tryGrab, 500)
    }
    tryGrab()

    unpatches.push(() => {
        stopped = true
        socket = undefined
        if (pending) clearTimeout(pending.timer)
        pending = null
    })
}
