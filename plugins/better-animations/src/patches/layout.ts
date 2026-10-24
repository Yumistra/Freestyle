import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { instead } from '@revenge-mod/patcher'
import { LayoutAnimation } from 'react-native'
import { decodeEasing, isCustomEasing, zetaOf } from '../effects'
import { active, report, status, type ModuleSettings } from '../settings'

/**
 * 채널 목록의 카테고리 접기·펼치기, 서버 바꾸기는 디스코드가 애니메이션 없이 목록을 다시 그린다.
 * 그 동작을 일으키는 Flux 액션이 지나갈 때 LayoutAnimation 을 걸어 두면,
 * 바로 다음 화면 갱신에서 줄이 생기고 사라지고 밀리는 것이 부드럽게 바뀐다.
 * (BetterDiscord 의 Channel List / Servers 모듈에 해당)
 */

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

export function layoutConfigFor(m: ModuleSettings) {
    const anim = animFor(m.easing)
    const property = m.effect === 'scale' ? 'scaleXY' : 'opacity'
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
        LayoutAnimation.configureNext(layoutConfigFor(m) as any)
        status.layouts++
    } else if (type === 'CHANNEL_SELECT') {
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

export function patchLayout() {
    const D: any = Dispatcher
    if (typeof D?.dispatch !== 'function') throw new Error('Dispatcher를 찾지 못함')
    status.found.layout = true
    return instead(D, 'dispatch', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
        try {
            onAction(args[0])
        } catch (e) {
            report('layout', e)
        }
        return orig.apply(this, args)
    })
}
