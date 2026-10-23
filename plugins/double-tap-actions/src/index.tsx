import { AlertActionCreators, ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import { getModuleWithImportedPath, lookupModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import { withDependencies, withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { Image, View } from 'react-native'

/**
 * 내 메시지를 두 번 누르면 (기본: 반응 달기) 대신 가운데 작은 창으로 수정·삭제를 고르게 한다.
 *
 * 안드로이드 채팅 목록은 네이티브라 JS 에는 "어느 메시지를 두 번 눌렀는지"만 온다.
 * 채팅 화면마다 만들어지는 MessagesHandlers 인스턴스의 handleDoubleTapMessage 를 감싼다.
 * 창은 디스코드 AlertModal 이라 테마 색을 그대로 따라간다.
 */

const D = () => Design as any
const PREVIEW_PATH = 'modules/messages/native/long_press/LongPressMessageChatItemPreview.tsx'
/** 디스코드가 길게 누를 때·삭제 확인창에서 쓰는 메시지 미리보기 (아바타·이름·시간·내용, 테마 색) */
let ChatItemPreview: any

const PREVIEW_NAME = 'LongPressMessageChatItemPreview'
// Discord 350.8 에서 이 모듈이 가져오는 모듈 번호들. 아직 안 불러왔으면 이걸로 찾아서 직접 불러온다
const PREVIEW_DEPS_350 = [21, 5092, 587, 7742, 558, 576, 9369, 2]

function usePreviewExports(exports: any) {
    const C = exports?.default ?? exports
    if (C && (typeof C === 'function' || typeof C === 'object')) ChatItemPreview = C
}

/** 미리보기 컴포넌트를 확실히 준비한다 (디스코드가 아직 안 불러왔으면 직접 불러옴) */
function loadPreview() {
    if (ChatItemPreview) return
    try {
        const [exports] = lookupModuleWithImportedPath(PREVIEW_PATH) as any
        if (exports) return usePreviewExports(exports)
    } catch {}
    try {
        const [exports] = lookupModule(withDependencies(PREVIEW_DEPS_350) as any) as any
        const C = exports?.default
        if (typeof C === 'function' && C.name === PREVIEW_NAME) ChatItemPreview = C
    } catch {}
}
let seq = 0
const toast = (text: string) => {
    try {
        ToastActionCreators.open(`double-tap-actions-${Date.now()}-${seq++}`, { text })
    } catch {}
}

const find = (...props: string[]) => {
    try {
        return (lookupModule(withProps(...(props as [string])) as any) as any)[0]
    } catch {}
}

let snowflakeUtils: any
let editUtils: any
let messageActions: any
const mods = () => {
    snowflakeUtils ??= find('getNativeSyntheticEventData')
    editUtils ??= find('handleEdit', 'longPressMessageOptionHandler')
    messageActions ??= find('deleteMessage', 'startEditMessageRecord') ?? find('deleteMessage', 'sendMessage')
}

const MESSAGE_TYPES_EDITABLE = new Set([0, 19])

function isMine(message: any) {
    const me = (Stores as any).UserStore?.getCurrentUser?.()
    return !!me && message?.author?.id === me.id
}

function previewOf(message: any) {
    const text = String(message?.content ?? '').trim()
    if (text) return text.length > 300 ? `${text.slice(0, 300)}…` : text
    const files = message?.attachments?.length ?? 0
    if (files) return `(첨부 파일 ${files}개)`
    if (message?.stickerItems?.length || message?.sticker_items?.length) return '(스티커)'
    return '(내용 없음)'
}

function edit(handlers: any, message: any, channel: any) {
    mods()
    const chatInputRef = handlers?.params?.chatInputRef
    try {
        if (editUtils?.handleEdit && chatInputRef) {
            editUtils.handleEdit(message, channel, chatInputRef, 'double_tap')
            return
        }
    } catch {}
    try {
        messageActions.startEditMessageRecord(channel.id, message)
        chatInputRef?.current?.openSystemKeyboard?.()
    } catch (e: any) {
        toast(`수정을 시작하지 못했어요: ${e?.message ?? e}`)
    }
}

async function remove(message: any, channel: any) {
    mods()
    try {
        await messageActions.deleteMessage(channel.id, message.id, false)
    } catch (e: any) {
        toast(`삭제하지 못했어요${e?.body?.message ? `: ${e.body.message}` : ''}`)
    }
}

/** 디스코드 미리보기를 아직 못 불러왔을 때: 아바타 · 이름 · 내용 */
function FallbackPreview({ message, channel }: { message: any; channel: any }) {
    const { Text } = D()
    const author = message?.author
    let avatar: string | undefined
    try {
        avatar = author?.getAvatarURL?.(channel?.guild_id, 64)
    } catch {}
    const name = author?.globalName ?? author?.global_name ?? author?.username ?? ''
    return (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            {avatar ? <Image source={{ uri: avatar }} style={{ width: 36, height: 36, borderRadius: 18 }} /> : null}
            <View style={{ flex: 1, gap: 2 }}>
                <Text variant="text-md/semibold" color="text-strong" numberOfLines={1}>
                    {name}
                </Text>
                <Text variant="text-md/normal" color="text-default" numberOfLines={6}>
                    {previewOf(message)}
                </Text>
            </View>
        </View>
    )
}

function openActions(handlers: any, message: any, channel: any) {
    loadPreview()
    const { AlertModal, AlertActionButton, Text } = D()
    const editable = MESSAGE_TYPES_EDITABLE.has(message.type ?? 0) && message.state !== 'SEND_FAILED' && message.state !== 'SENDING'
    AlertActionCreators.openAlert(
        `double-tap-actions-${seq++}`,
        <AlertModal
            title="메시지"
            content={
                ChatItemPreview ? (
                    <View style={{ marginTop: 4 }}>
                        <ChatItemPreview message={message} />
                    </View>
                ) : (
                    <FallbackPreview message={message} channel={channel} />
                )
            }
            actions={
                <>
                    {editable && <AlertActionButton text="수정" variant="primary" onPress={() => edit(handlers, message, channel)} />}
                    <AlertActionButton text="삭제" variant="destructive" onPress={() => remove(message, channel)} />
                    <AlertActionButton text="취소" variant="secondary" />
                </>
            }
        />,
    )
}

/** MessagesHandlers 인스턴스의 두 번 누르기 처리를 감싼다 */
function wrapInstance(inst: any) {
    const orig = inst?.handleDoubleTapMessage
    if (typeof orig !== 'function' || orig.__doubleTapActions) return
    const wrapped = function (this: unknown, event: any) {
        try {
            mods()
            const data = snowflakeUtils?.getNativeSyntheticEventData?.(event) ?? event?.nativeEvent ?? event
            const result = data?.messageId ? inst.getMessageData?.(data.messageId) : undefined
            if (result?.message && result.messageChannel && isMine(result.message)) {
                openActions(inst, result.message, result.messageChannel)
                return
            }
        } catch {}
        return orig.apply(this, arguments as any)
    }
    ;(wrapped as any).__doubleTapActions = true
    inst.handleDoubleTapMessage = wrapped
}

export default plugin({
    start({ cleanup }: any) {
        cleanup(
            getModuleWithImportedPath(PREVIEW_PATH, (exports: any) => usePreviewExports(exports)) as any,
        )
        // 플러그인을 켜기 전에 열려 있던 채팅 화면은 이미 만들어진 MessagesHandlers 를 쓰므로,
        // 그 안에서 부르는 "기본 반응 달기" 함수도 가로챈다 (입력창 참조가 없어 키보드는 직접 열어야 함)
        cleanup(
            getModules(withProps('handleAddDefaultDoubleTapReaction') as any, (mod: any) => {
                cleanup(
                    instead(mod, 'handleAddDefaultDoubleTapReaction', function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                        try {
                            const [message, channel] = args
                            if (message && channel && isMine(message)) {
                                openActions(undefined, message, channel)
                                return
                            }
                        } catch {}
                        return orig.apply(this, args)
                    }),
                )
            }) as any,
        )
        cleanup(
            getModules(withProps('MessagesHandlers') as any, (mod: any) => {
                const Orig = mod?.MessagesHandlers
                if (typeof Orig !== 'function' || Orig.__doubleTapActions) return
                // 채팅 화면이 new MessagesHandlers(...) 할 때 만들어진 인스턴스를 바로 감싼다
                const Patched: any = function (this: unknown, ...args: any[]) {
                    const inst = Reflect.construct(Orig, args, Patched)
                    wrapInstance(inst)
                    return inst
                }
                Patched.prototype = Orig.prototype
                Patched.__doubleTapActions = true
                Object.setPrototypeOf(Patched, Orig)
                try {
                    mod.MessagesHandlers = Patched
                } catch {
                    return
                }
                cleanup(() => {
                    if (mod.MessagesHandlers === Patched) mod.MessagesHandlers = Orig
                })
            }) as any,
        )
    },
} as any)
