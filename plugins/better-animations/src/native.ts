import { callNativeMethod } from '@revenge-mod/modules/native'
import { applyMove, effectOf, exitEffectOf, normalize } from './effects'
import { active, ready, report, setExtra, status, storedExtra } from './settings'

/**
 * 네이티브(plugin.jar) 부분: 채팅 메시지 애니메이션, 큰 화면 전환.
 * 설정은 같은 storage.json 을 읽는다. 화면 전환은 효과 정의까지 풀어서 native.stack 에 넣어 둔다.
 */

export const NATIVE_ID = 'yumistra.better-animations'

function call(name: string, args: unknown[] = []) {
    try {
        return Promise.resolve((callNativeMethod as any)(`${NATIVE_ID}.${name}`, args))
    } catch (e) {
        return Promise.reject(e)
    }
}

/** 네이티브가 화면 전환을 맡을 값. 방향은 여기서 풀고, 기준 위치는 네이티브가 기준점으로 쓴다 */
export function nativeStackConfig() {
    const m = active('stack')
    if (!m || m.effect === 'none') return { enabled: false }
    const effect = effectOf('stack', m.effect)
    const exit = exitEffectOf('stack', m.effect, m.exit)
    const move = { direction: m.direction }
    return {
        enabled: true,
        hidden: applyMove(effect.hidden, move, 1, 1),
        exit: applyMove(exit.hidden, move, 1, 1),
        under: effect.under ? normalize(effect.under) : null,
        duration: m.duration,
        easing: m.easing,
        position: m.position ?? 'auto',
    }
}

/** 풀어 둔 값을 저장하고 네이티브에 다시 읽으라고 알린다 */
export async function syncNative() {
    try {
        // 저장된 설정을 다 불러온 다음에 풀어야 기본값으로 덮어쓰지 않는다
        await ready()
        const stack = nativeStackConfig()
        if (JSON.stringify(storedExtra('native')?.stack) !== JSON.stringify(stack)) await setExtra('native', { stack })
    } catch (e) {
        report('native', e)
    }
    call('reload').catch(() => {})
}

/** 네이티브 화면 전환을 쓸 수 있는지 (실렸고, 화면 후킹에 성공했는지) */
export const nativeScreens = () => status.native === true && status.nativeScreenHook

export function pingNative() {
    return call('ping').then(
        (r: any) => {
            status.native = true
            status.nativeScreenHook = !!r?.screens
            if (typeof r?.played === 'number') status.nativePlayed = r.played
        },
        () => {
            status.native = false
            status.nativeScreenHook = false
        },
    )
}

/**
 * 서버 바꾸기: 지금 보이는 목록을 찍어 그 위에 덮고, 나가는 효과로 치운다.
 * 덮은 뒤에 'ok' 가 온다 (그다음에 새 목록으로 바꿔야 옛 목록이 찍힘)
 */
export function nativeGuildOut(opts: unknown): Promise<string> {
    if (status.native !== true) return Promise.resolve('nonative')
    return call('guildOut', [JSON.stringify(opts)]).then(
        (r: any) => String(r),
        () => 'error',
    )
}
