import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { Stores } from '@revenge-mod/discord/flux'
import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { instead } from '@revenge-mod/patcher'
import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { createElement, useEffect, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, LayoutAnimation } from 'react-native'
import { applyMove, decodeEasing, easingFrom, effectOf, isCustomEasing, springFor, zetaOf } from '../effects'
import { partsFor } from '../interpolate'
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

function GuildSwitch({ __type, __props }: { __type: any; __props: any }) {
    const [value] = useState(() => new Animated.Value(1))
    const [busy, setBusy] = useState(false)
    const last = useRef<string | null | undefined>(undefined)
    useEffect(() => {
        const check = () => {
            const g = currentGuild()
            if (g === undefined || g === last.current) return
            const changed = last.current !== undefined || (seenGuild !== undefined && seenGuild !== g)
            last.current = g
            seenGuild = g
            const m = active('servers')
            if (changed && m && m.effect !== 'none') {
                setBusy(true)
                play(value, m, () => setBusy(false))
            }
        }
        check()
        const store = guildStore()
        store?.addChangeListener?.(check)
        return () => store?.removeChangeListener?.(check)
    }, [])
    const m = active('servers')
    let style: any = { flex: 1 }
    if (m && m.effect !== 'none') {
        const { width, height } = Dimensions.get('window')
        const h = applyMove(effectOf('servers', m.effect).hidden, { direction: m.direction, position: m.position }, width, height)
        const parts = partsFor(value, h, width, height, undefined)
        style = [{ flex: 1 }, { transform: parts.transform, ...(parts.opacity ? { opacity: parts.opacity } : {}) }]
    }
    return createElement(Animated.View, { style, collapsable: false, renderToHardwareTextureAndroid: busy }, createElement(__type, __props))
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
                            return [GuildSwitch, { __type: args[0], __props: args[1] }, ...args.slice(2)] as any
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

export function patchLayout() {
    const D: any = Dispatcher
    if (typeof D?.dispatch !== 'function') throw new Error('Dispatcher를 찾지 못함')
    status.found.layout = true
    return instead(D, 'dispatch', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
        let wait = 0
        try {
            wait = collapseDelay(args[0])
        } catch (e) {
            report('layout', e)
        }
        if (wait > 0) {
            const self = this
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
        return orig.apply(this, args)
    })
}
