import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { Stores } from '@revenge-mod/discord/flux'
import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { instead } from '@revenge-mod/patcher'
import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { createElement, useEffect, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, LayoutAnimation } from 'react-native'
import { applyMove, decodeEasing, easingFrom, effectOf, exitPoseOf, isCustomEasing, springFor, zetaOf } from '../effects'
import { partsFor } from '../interpolate'
import { nativeGuildOut } from '../native'
import { hideCollapsing, markExpanded } from './channels'
import { active, report, status, type ModuleSettings } from '../settings'

/**
 * 채널 목록의 카테고리 접기·펼치기, 서버 바꾸기는 디스코드가 애니메이션 없이 목록을 다시 그린다.
 * 그 동작을 일으키는 Flux 액션이 지나갈 때 LayoutAnimation 을 걸어 두면,
 * 바로 다음 화면 갱신에서 줄이 생기고 사라지고 밀리는 것이 부드럽게 바뀐다.
 * (BetterDiscord 의 Channel List 모듈에 해당)
 *
 * 서버 바꾸기는 목록 칸이 재사용돼서 LayoutAnimation 이 먹지 않는다. 대신 채널 목록 화면
 * (RedesignChannelList) 전체를 Animated.View 로 감싸고, 고른 서버가 바뀌면 그 효과를 재생한다.
 * (BetterDiscord 의 Servers 모듈)
 *
 * 옛 목록이 나가는 효과: 서버를 바꾸는 액션(CHANNEL_SELECT)을 잠깐 붙잡고,
 * 네이티브가 지금 목록을 찍어 그 위에 덮은 뒤(나가는 효과로 치움) 액션을 보낸다 → 새 목록은 그 밑에서 나타난다.
 * 네이티브가 없으면 옛 목록을 먼저 내보내고 바꾼다. 붙잡는 동안 들어온 다른 액션은 순서대로 뒤에 보낸다.
 */

/** 서버의 채널 목록, DM 목록 */
const LIST_PATHS = ['modules/channel_list_v2/native/RedesignChannelList.tsx', 'modules/main_tabs_v2/native/tabs/messages/MessagesFastestList.tsx']
/** 감싸기를 못 하면 LayoutAnimation 으로라도 */
let wrapped = false
/** 마지막으로 본 서버 (채널 목록이 서버마다 새로 만들어져도 바뀐 걸 알 수 있게) */
let seenGuild: string | null | undefined

const guildStore = () => (Stores as any).SelectedGuildStore

function currentGuild(): string | null | undefined {
    try {
        return guildStore()?.getGuildId?.() ?? null
    } catch {
        return undefined
    }
}

function play(value: Animated.Value, m: ModuleSettings, done?: () => void) {
    value.setValue(0)
    const run =
        m.easing === 'spring'
            ? Animated.spring(value, { toValue: 1, ...springFor(m.duration, 0.7), useNativeDriver: true } as any)
            : Animated.timing(value, { toValue: 1, duration: m.duration, easing: easingFrom(Easing, m.easing), useNativeDriver: true })
    run.start(() => done?.())
    status.layouts++
}

interface Instance {
    nativeId: string
    kind: 'guild' | 'dm'
    /** 옛 목록을 JS 로 내보내기 (네이티브가 없을 때) */
    leave(m: ModuleSettings): Promise<void>
}
const instances = new Set<Instance>()
let instanceSeq = 0

function exitPose(m: ModuleSettings, W: number, H: number) {
    return exitPoseOf('servers', m.effect, m.exit, { direction: m.direction, position: m.position }, W, H)
}

function GuildSwitch({ __type, __props, __kind }: { __type: any; __props: any; __kind: 'guild' | 'dm' }) {
    const [value] = useState(() => new Animated.Value(1))
    const [closing] = useState(() => new Animated.Value(0))
    const [busy, setBusy] = useState(false)
    const [nativeId] = useState(() => `better-animations-guild-${instanceSeq++}`)
    const last = useRef<string | null | undefined>(undefined)
    useEffect(() => {
        const inst: Instance = {
            nativeId,
            kind: __kind,
            leave: m =>
                new Promise(resolve => {
                    closing.setValue(1)
                    setBusy(true)
                    const run =
                        m.easing === 'spring'
                            ? Animated.spring(value, { toValue: 0, ...springFor(m.duration * 0.6, 1), useNativeDriver: true } as any)
                            : Animated.timing(value, { toValue: 0, duration: Math.round(m.duration * 0.6), easing: easingFrom(Easing, m.easing), useNativeDriver: true })
                    run.start(() => resolve())
                }),
        }
        instances.add(inst)
        const check = () => {
            const g = currentGuild()
            if (g === undefined || g === last.current) return
            const changed = last.current !== undefined || (seenGuild !== undefined && seenGuild !== g)
            last.current = g
            seenGuild = g
            const m = active('servers')
            if (changed && m && m.effect !== 'none') {
                closing.setValue(0)
                setBusy(true)
                play(value, m, () => setBusy(false))
            }
        }
        check()
        const store = guildStore()
        store?.addChangeListener?.(check)
        return () => {
            instances.delete(inst)
            store?.removeChangeListener?.(check)
        }
    }, [])
    const m = active('servers')
    let style: any = { flex: 1 }
    if (m && m.effect !== 'none') {
        const { width, height } = Dimensions.get('window')
        const move = { direction: m.direction, position: m.position }
        const h = applyMove(effectOf('servers', m.effect).hidden, move, width, height)
        const parts = partsFor(value, h, width, height, undefined, exitPose(m, width, height), closing)
        style = [{ flex: 1 }, { transform: parts.transform, ...(parts.opacity ? { opacity: parts.opacity } : {}) }]
    }
    return createElement(Animated.View, { style, nativeID: nativeId, collapsable: false, renderToHardwareTextureAndroid: busy }, createElement(__type, __props))
}

// ── 액션 붙잡기 ──────────────────────────────────────────────────

/** 옛 목록을 찍어 덮을 때까지 기다리는 최대 시간 (ms) */
const HOLD_MAX = 180

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 서버가 바뀌는 액션이면, 옛 목록을 치우기 시작할 때까지 기다릴 약속 */
function guildHold(action: any): Promise<void> | undefined {
    const type = action?.type
    if ((type !== 'CHANNEL_SELECT' && type !== 'GUILD_SELECT') || !action || !('guildId' in action)) return
    const next = action.guildId ?? null
    const cur = currentGuild()
    if (cur === undefined || next === cur) return
    const m = active('servers')
    if (!m || m.effect === 'none' || !instances.size) return
    const { width, height } = Dimensions.get('window')
    const pose = exitPose(m, width, height)
    const visible = [...instances].filter(i => i.kind === (cur === null ? 'dm' : 'guild'))
    const ids = [...visible, ...[...instances].filter(i => !visible.includes(i))].map(i => i.nativeId)
    const fallback = visible[0]
    const deadline = Date.now() + HOLD_MAX
    return Promise.race([
        nativeGuildOut({ ids, pose, duration: m.duration, easing: m.easing, position: m.position ?? 'auto', deadline }).then(r => {
            if (r === 'ok') {
                status.layouts++
                return
            }
            // 네이티브가 없으면 옛 목록을 먼저 내보낸다 (보이는 목록이 없으면 그냥 바꿈)
            if ((r === 'nonative' || r === 'error' || r === 'old') && fallback && Date.now() < deadline) return Promise.race([fallback.leave(m), sleep(Math.round(m.duration * 0.6) + 40)])
        }),
        sleep(HOLD_MAX + (instances.size ? Math.round(m.duration * 0.6) : 0)),
    ]).catch(() => {})
}

export function patchServerSwitch(cleanup: (...fns: Array<() => unknown>) => void) {
    const done = new Set<any>()
    for (const path of LIST_PATHS) {
        cleanup(
            getModuleWithImportedPath(path, (exports: any) => {
                const List = exports?.default ?? exports
                if (!List || done.has(List)) return
                done.add(List)
                wrapped = true
                status.found.servers = true
                cleanup(
                    beforeJSX(List, (args: any[]) => {
                        try {
                            if (!active('servers')) return args as any
                            return [GuildSwitch, { __type: args[0], __props: args[1], __kind: path.includes('MessagesFastestList') ? 'dm' : 'guild' }, ...args.slice(2)] as any
                        } catch (e) {
                            report('servers', e)
                            return args as any
                        }
                    }),
                )
            }) as any,
        )
    }
}

const COLLAPSE = new Set(['CATEGORY_COLLAPSE', 'CATEGORY_EXPAND', 'CATEGORY_COLLAPSE_ALL', 'CATEGORY_EXPAND_ALL'])

function animFor(easing: string): any {
    if (easing === 'spring' || zetaOf(easing) < 1) return { type: 'spring', springDamping: Math.max(0.2, Math.min(1, easing === 'spring' ? 0.7 : zetaOf(easing) + 0.2)) }
    if (easing === 'linear') return { type: 'linear' }
    if (easing === 'smooth') return { type: 'easeInEaseOut' }
    if (isCustomEasing(easing)) {
        const c = decodeEasing(easing)
        if (c.type === 'linear' || c.type === 'steps') return { type: 'linear' }
        return { type: c.bezier === 'in' ? 'easeIn' : c.bezier === 'inOut' ? 'easeInEaseOut' : 'easeOut' }
    }
    return { type: 'easeOut' }
}

export function layoutConfigFor(m: ModuleSettings, rowsHandled = false) {
    const anim = animFor(m.easing)
    const property = m.effect === 'scale' ? 'scaleXY' : 'opacity'
    // 줄이 나타나고 사라지는 건 ChannelRow 가 하므로, 여기선 남은 줄이 밀리는 것만
    if (rowsHandled) return { duration: m.duration, update: anim }
    return {
        duration: m.duration,
        create: { ...anim, property },
        update: anim,
        delete: { ...anim, property },
    }
}

let lastGuild: string | null | undefined

function onAction(action: any) {
    const type = action?.type
    if (!type) return
    if (COLLAPSE.has(type)) {
        const m = active('channelList')
        if (!m) return
        if (type === 'CATEGORY_EXPAND' || type === 'CATEGORY_EXPAND_ALL') markExpanded(type === 'CATEGORY_EXPAND' ? categoryIdOf(action) : undefined)
        LayoutAnimation.configureNext(layoutConfigFor(m, true) as any)
        status.layouts++
    } else if (!wrapped && (type === 'CHANNEL_SELECT' || type === 'GUILD_SELECT')) {
        const guild = action.guildId ?? null
        const first = lastGuild === undefined
        if (guild === lastGuild) return
        lastGuild = guild
        const m = active('servers')
        if (!m || first) return
        LayoutAnimation.configureNext(layoutConfigFor(m) as any)
        status.layouts++
    }
}

function categoryIdOf(action: any): string | undefined {
    const id = action?.id ?? action?.categoryId ?? action?.channelId
    return id == null ? undefined : String(id)
}

/** 접기: 줄들이 먼저 사라지게 하고 그동안 실제 액션을 미룬다. 미룰 시간(ms) */
function collapseDelay(action: any) {
    const type = action?.type
    if (action?.__betterAnimations || (type !== 'CATEGORY_COLLAPSE' && type !== 'CATEGORY_COLLAPSE_ALL')) return 0
    const m = active('channelList')
    if (!m) return 0
    return hideCollapsing(type === 'CATEGORY_COLLAPSE' ? categoryIdOf(action) : undefined, m)
}

interface Queued {
    self: unknown
    args: any[]
    orig: (...a: any[]) => any
    resolve(v: unknown): void
}
/** 서버 바꾸기 액션을 붙잡고 있는 동안 */
let blocked = false
const queue: Queued[] = []

function runNow(self: unknown, args: any[], orig: (...a: any[]) => any) {
    let wait = 0
    try {
        wait = collapseDelay(args[0])
    } catch (e) {
        report('layout', e)
    }
    if (wait > 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                try {
                    onAction(args[0])
                } catch (e) {
                    report('layout', e)
                }
                resolve(orig.apply(self, args))
            }, wait)
        })
    }
    try {
        onAction(args[0])
    } catch (e) {
        report('layout', e)
    }
    return orig.apply(self, args)
}

function handle(self: unknown, args: any[], orig: (...a: any[]) => any, queued = false): unknown {
    if (!queued && (blocked || queue.length)) return new Promise(resolve => queue.push({ self, args, orig, resolve }))
    let hold: Promise<void> | undefined
    try {
        if (!args[0]?.__betterAnimations) hold = guildHold(args[0])
    } catch (e) {
        report('servers', e)
    }
    if (!hold) return runNow(self, args, orig)
    blocked = true
    return new Promise(resolve => {
        hold!.then(() => {
            blocked = false
            try {
                resolve(runNow(self, args, orig))
            } catch (e) {
                report('servers', e)
                resolve(undefined)
            }
            pump()
        })
    })
}

/** 붙잡는 동안 쌓인 액션을 순서대로 */
function pump() {
    while (!blocked && queue.length) {
        const q = queue.shift()!
        try {
            q.resolve(handle(q.self, q.args, q.orig, true))
        } catch (e) {
            report('layout', e)
            q.resolve(undefined)
        }
    }
}

export function patchLayout() {
    const D: any = Dispatcher
    if (typeof D?.dispatch !== 'function') throw new Error('Dispatcher를 찾지 못함')
    status.found.layout = true
    return instead(D, 'dispatch', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
        return handle(this, args, orig)
    })
}
