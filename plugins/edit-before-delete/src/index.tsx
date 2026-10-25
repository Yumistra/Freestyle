import { Design } from '@revenge-mod/discord/design'
import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { useState } from 'react'
import { ScrollView } from 'react-native'

/**
 * 내 메시지를 지울 때, 먼저 내용을 "** **"(굵게 공백 = 화면에 아무것도 안 보임)로 수정한 뒤 삭제한다.
 * 디스코드 MessageActionCreators.deleteMessage 를 감싸므로 길게 눌러 삭제, 다른 플러그인의 삭제 모두 적용된다.
 */

interface Settings {
    text: string
    /** 수정과 삭제 사이 기다리는 시간 (ms) */
    delay: number
}
const DEFAULTS: Settings = { text: '** **', delay: 300 }

let storage: any
const settings = (): Settings => ({ ...DEFAULTS, ...(storage?.cache ?? {}) })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function shouldEditFirst(channelId: string, messageId: string, local: unknown) {
    if (local === true) return // 보내기 실패·전송 중인 메시지 (서버에 없음)
    const message = (Stores as any).MessageStore?.getMessage?.(channelId, messageId)
    const me = (Stores as any).UserStore?.getCurrentUser?.()
    if (!message || !me || message.author?.id !== me.id) return
    if (message.state && message.state !== 'SENT') return
    if (message.poll) return // 투표는 수정할 수 없음
    return message
}

function SettingsPage({ api }: { api: any }) {
    const { Stack, TableRowGroup, TextInput, Text } = Design as any
    storage ??= api?.jsonStorage
    const [s, setS] = useState<Settings>(settings)
    const save = (patch: Partial<Settings>) => {
        const next = { ...s, ...patch }
        setS(next)
        storage?.set(next, true)
    }
    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack spacing={16} style={{ padding: 16 }}>
                <TableRowGroup title="Replace with">
                    <TextInput value={s.text} onChange={(text: string) => save({ text })} placeholder="** **" size="md" />
                </TableRowGroup>
                <TableRowGroup title="Delay (ms)">
                    <TextInput
                        value={String(s.delay)}
                        onChange={(v: string) => save({ delay: Math.max(0, Math.min(5000, Number(v.replace(/\D/g, '')) || 0)) })}
                        placeholder="300"
                        keyboardType="number-pad"
                        size="md"
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    )
}

export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },
    start({ cleanup, jsonStorage }: any) {
        storage = jsonStorage
        cleanup(
            getModules(withProps('editMessage', 'deleteMessage') as any, (mod: any) => {
                if (typeof mod?.deleteMessage !== 'function' || typeof mod?.editMessage !== 'function') return
                cleanup(
                    instead(mod, 'deleteMessage', async function (this: unknown, args: any[], orig: (...a: any[]) => any) {
                        const [channelId, messageId, local] = args
                        try {
                            const message = shouldEditFirst(channelId, messageId, local)
                            const { text, delay } = settings()
                            if (message && text && message.content !== text) {
                                await mod.editMessage(channelId, messageId, { content: text })
                                if (delay > 0) await sleep(delay)
                            }
                        } catch {
                            // 수정에 실패해도 삭제는 한다
                        }
                        return orig.apply(this, args)
                    }),
                )
            }) as any,
        )
    },
    SettingsComponent: SettingsPage,
} as any)
