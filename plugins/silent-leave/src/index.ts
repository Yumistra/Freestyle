import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Stores } from '@revenge-mod/discord/flux'
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'

/**
 * Silent Leave (il1ll/RevengePlugins 의 SilentLeave 를 Revenge Next 로 옮김)
 *
 * Revenge Next 에는 명령어 API 가 없어서, 디스코드 기본 명령어(/shrug 등) 목록을
 * 돌려주는 getBuiltInCommands 결과에 우리 명령어를 덧붙인다.
 * 실행하면 DELETE /channels/:id?silent=true 로 그룹 DM 을 조용히 나간다.
 */

const GROUP_DM = 3
const CHAT = 1
const COMMAND_ID = '-73917'

let seq = 0
function toast(text: string) {
    try {
        ToastActionCreators.open(`silent-leave-${Date.now()}-${seq++}`, { text })
    } catch {}
}

function enumValue(name: string, key: string, fallback: any) {
    try {
        const [mod] = lookupModule(withProps(name) as any) as any
        return mod?.[name]?.[key] ?? fallback
    } catch {
        return fallback
    }
}

let http: any
function HTTP() {
    if (!http) [http] = lookupModule(withProps('getAPIBaseURL', 'del') as any) as any
    return http
}

let command: any
function silentLeaveCommand() {
    if (command) return command
    command = {
        id: COMMAND_ID,
        untranslatedName: 'leave-silent',
        displayName: 'leave-silent',
        type: CHAT,
        inputType: enumValue('ApplicationCommandInputType', 'BUILT_IN_TEXT', 1),
        applicationId: '-1',
        untranslatedDescription: '알림 없이 이 그룹 DM에서 조용히 나가요',
        displayDescription: '알림 없이 이 그룹 DM에서 조용히 나가요',
        options: [],
        predicate(ctx: any) {
            const id = ctx?.channel?.id
            const channel = id ? (Stores as any).ChannelStore?.getChannel(id) : undefined
            return channel?.type === GROUP_DM
        },
        async execute(_args: unknown, ctx: any) {
            const id = ctx?.channel?.id
            const channel = id ? (Stores as any).ChannelStore?.getChannel(id) : undefined
            if (channel?.type !== GROUP_DM) {
                toast('그룹 DM에서만 쓸 수 있어요')
                return
            }
            try {
                const api = HTTP()
                if (!api) throw new Error('HTTP 모듈을 찾지 못함')
                await api.del({ url: `/channels/${id}`, query: { silent: true } })
                toast('그룹 DM에서 조용히 나갔어요')
            } catch (e: any) {
                toast(`나가지 못했어요${e?.body?.message ? `: ${e.body.message}` : e?.message ? `: ${e.message}` : ''}`)
            }
        },
    }
    return command
}

export default plugin({
    start({ cleanup }: any) {
        cleanup(
            getModules(withProps('getBuiltInCommands') as any, (mod: any) => {
                cleanup(
                    instead(mod, 'getBuiltInCommands', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                        const result = orig.apply(this, args)
                        try {
                            const types = args?.[0]
                            const wantsChat = Array.isArray(types) ? types.includes(CHAT) : types == null || types === CHAT
                            if (!wantsChat || !Array.isArray(result) || result.some((c: any) => c?.id === COMMAND_ID)) return result
                            return [...result, silentLeaveCommand()]
                        } catch {
                            return result
                        }
                    }),
                )
            }) as any,
        )
    },
} as any)
