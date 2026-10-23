import { beforeJSX } from '@revenge-mod/react/jsx-runtime'
import { active, report, status } from '../settings'

/**
 * 채널·프로필·설정처럼 안드로이드 네이티브 스택(react-native-screens)으로 여는 화면.
 * 네이티브 쪽 전환은 정해진 종류만 고를 수 있어서, 화면 요소(RNSScreen)의 stackAnimation 값을 바꾼다.
 * 디스코드가 일부러 "none"으로 둔 화면은 건드리지 않는다.
 */
export function patchNativeScreens() {
    return beforeJSX('RNSScreen' as any, (args: any[]) => {
        try {
            const props = args[1]
            if (!props || props.stackAnimation === 'none') return args as any
            const presentation = props.stackPresentation ?? 'push'
            const m = active(presentation === 'push' ? 'push' : 'modal')
            if (!m || m.effect === props.stackAnimation) return args as any
            status.screens++
            return [args[0], { ...props, stackAnimation: m.effect }, ...args.slice(2)] as any
        } catch (e) {
            report('screens', e)
            return args as any
        }
    })
}
