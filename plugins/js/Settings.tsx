import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import type { PluginApi } from '@revenge-mod/plugins/types'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { botRequest, fillPlaceholders, validateBotToken } from './api'
import { isBotSession, loginWithBotToken, logout, stripBot } from './auth'
import { sendPresence } from './gateway'
import { allowedPrivileged, INTENTS, PRIVILEGED_MASK } from './intents'
import { getInteractions, getLogs, saveSettings, settings, subscribe, type Settings, type Status } from './state'

interface Req {
    method: string
    path: string
    body: string
}

const toast = (content: string) => ToastActionCreators.open({ key: 'bot-client', content })
const errMsg = (e: unknown) => String((e as Error)?.message ?? e)

function useLive() {
    const [, force] = useState(0)
    useEffect(() => subscribe(() => force(n => n + 1)), [])
}

const PRESETS: Array<{ label: string; method: string; path: string; body?: unknown }> = [
    { label: '내 봇 정보', method: 'GET', path: '/users/@me' },
    { label: '임베드 보내기', method: 'POST', path: '/channels/{channel}/messages', body: { embeds: [{ title: '제목', description: '내용', color: 0x5865f2 }] } },
    {
        label: 'Components V2 보내기',
        method: 'POST',
        path: '/channels/{channel}/messages',
        body: { flags: 1 << 15, components: [{ type: 17, components: [{ type: 10, content: '## Components V2\n본문' }] }] },
    },
    { label: '슬래시 명령 목록', method: 'GET', path: '/applications/{app}/commands' },
    { label: '슬래시 명령 등록', method: 'POST', path: '/applications/{app}/commands', body: { name: 'ping', description: '응답 확인', type: 1 } },
    { label: 'DM 채널 열기', method: 'POST', path: '/users/@me/channels', body: { recipient_id: '유저 ID' } },
    { label: '앱 소개 수정', method: 'PATCH', path: '/applications/@me', body: { description: '소개' } },
]

const STATUSES: Array<[Status, string]> = [
    ['online', '온라인'],
    ['idle', '자리 비움'],
    ['dnd', '방해 금지'],
    ['invisible', '오프라인으로 표시'],
]

function AccountSection({ s }: { s: Settings }) {
    const { TableRowGroup, TableRow, TextInput, Button } = Design
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const bot = isBotSession()

    const login = async () => {
        const token = stripBot(draft || s.token)
        if (!token) return toast('봇 토큰을 입력하세요')
        setBusy(true)
        try {
            const { user, appId, flags } = await validateBotToken(token)
            let intents = s.intents
            if (flags !== undefined) {
                intents = (s.intents & ~PRIVILEGED_MASK) | (s.intents & allowedPrivileged(flags))
                if (intents !== s.intents) toast('개발자 포털에서 꺼져 있는 특권 인텐트를 뺐습니다')
            }
            await saveSettings({ token, appId, intents })
            setDraft('')
            await loginWithBotToken(token)
            toast(`${user.username}(으)로 로그인하는 중`)
        } catch (e) {
            toast(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <View style={{ gap: 8 }}>
            <TableRowGroup title="계정">
                <TableRow
                    label={bot ? '봇으로 로그인됨' : '일반 계정으로 로그인됨'}
                    subLabel={s.token ? `저장된 토큰 …${s.token.slice(-6)}` : '저장된 봇 토큰 없음'}
                />
            </TableRowGroup>
            <TextInput label="봇 토큰" placeholder="개발자 포털 → Bot → Reset Token" value={draft} onChange={setDraft} secureTextEntry isClearable />
            <Button text={bot ? '토큰 다시 적용' : '봇으로 로그인'} onPress={login} loading={busy} disabled={busy} />
            {bot && (
                <Button
                    text="로그아웃"
                    variant="destructive"
                    onPress={() => {
                        try {
                            logout()
                        } catch (e) {
                            toast(errMsg(e))
                        }
                    }}
                />
            )}
        </View>
    )
}

function IntentSection({ s }: { s: Settings }) {
    const { TableRowGroup, TableSwitchRow } = Design
    return (
        <TableRowGroup title="인텐트 (다음 연결부터 적용)">
            {INTENTS.map(i => (
                <TableSwitchRow
                    key={i.name}
                    label={i.label}
                    subLabel={i.privileged ? `${i.name} · 포털에서 켜야 함` : i.name}
                    value={(s.intents & i.bit) !== 0}
                    onValueChange={(v: boolean) => saveSettings({ intents: v ? s.intents | i.bit : s.intents & ~i.bit })}
                />
            ))}
        </TableRowGroup>
    )
}

function PresenceSection({ s }: { s: Settings }) {
    const { TableRowGroup, TableRow, TextInput, Button } = Design
    const [custom, setCustom] = useState(s.customStatus)
    const apply = async (patch: Partial<Settings>) => {
        await saveSettings(patch)
        if (!sendPresence()) toast('저장했습니다. 봇으로 로그인하면 적용됩니다')
    }
    return (
        <View style={{ gap: 8 }}>
            <TableRowGroup title="상태">
                {STATUSES.map(([key, label]) => (
                    <TableRow key={key} label={label} subLabel={s.status === key ? '사용 중' : undefined} onPress={() => apply({ status: key })} />
                ))}
            </TableRowGroup>
            <TextInput label="상태 메시지" placeholder="비워두면 없음" value={custom} onChange={setCustom} isClearable />
            <Button text="상태 메시지 적용" variant="secondary" onPress={() => apply({ customStatus: custom })} />
        </View>
    )
}

function ConsoleSection({ req, setReq }: { req: Req; setReq: (r: Req) => void }) {
    const { TableRowGroup, TableRow, TextInput, TextArea, Button, Text } = Design
    const [out, setOut] = useState('')
    const [busy, setBusy] = useState(false)

    const run = async () => {
        let body: unknown
        if (req.method !== 'GET' && req.body.trim()) {
            try {
                body = JSON.parse(req.body)
            } catch (e) {
                return setOut(`JSON 형식 오류: ${errMsg(e)}`)
            }
        }
        setBusy(true)
        try {
            const res = await botRequest(req.method, fillPlaceholders(req.path), body)
            const pretty = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2)
            setOut(`HTTP ${res.status}\n${pretty ?? ''}`.slice(0, 8000))
        } catch (e) {
            setOut(`요청 실패: ${errMsg(e)}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <View style={{ gap: 8 }}>
            <TableRowGroup title="API 콘솔 · {channel}=현재 채널, {app}=앱 ID">
                {PRESETS.map(p => (
                    <TableRow
                        key={p.label}
                        label={p.label}
                        subLabel={`${p.method} ${p.path}`}
                        onPress={() => setReq({ method: p.method, path: p.path, body: p.body ? JSON.stringify(p.body, null, 2) : '' })}
                    />
                ))}
            </TableRowGroup>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <Button key={m} size="sm" text={m} variant={req.method === m ? 'primary' : 'secondary'} onPress={() => setReq({ ...req, method: m })} />
                ))}
            </View>
            <TextInput label="경로" placeholder="/channels/{channel}/messages" value={req.path} onChange={(path: string) => setReq({ ...req, path })} />
            <TextArea label="JSON 본문" placeholder='{"content": "안녕"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} />
            <Button text="요청 보내기" onPress={run} loading={busy} disabled={busy} />
            {!!out && (
                <Text variant="text-sm/normal" selectable>
                    {out}
                </Text>
            )}
        </View>
    )
}

function InteractionSection({ setReq }: { setReq: (r: Req) => void }) {
    const { TableRowGroup, TableRow } = Design
    const list = getInteractions()
    if (!list.length) return null
    return (
        <TableRowGroup title="받은 인터랙션 · 탭하면 응답 요청을 채움 (15분 이내)">
            {list.map(i => (
                <TableRow
                    key={i.id}
                    label={i.data?.name ? `/${i.data.name}` : (i.data?.custom_id ?? `type ${i.type}`)}
                    subLabel={`${i.member?.user?.username ?? i.user?.username ?? '?'} · #${i.channel_id ?? '?'}`}
                    onPress={() =>
                        setReq({
                            method: 'PATCH',
                            path: `/webhooks/${i.application_id}/${i.token}/messages/@original`,
                            body: JSON.stringify({ content: '' }, null, 2),
                        })
                    }
                />
            ))}
        </TableRowGroup>
    )
}

function AdvancedSection({ s }: { s: Settings }) {
    const { TableRowGroup, TableSwitchRow, TextArea, Button } = Design
    const [stubs, setStubs] = useState(s.extraStubs.join('\n'))
    return (
        <View style={{ gap: 8 }}>
            <TableRowGroup title="고급">
                <TableSwitchRow
                    label="인터랙션 자동 defer"
                    subLabel="3초 제한 때문에 끄면 명령이 '응답 없음'으로 실패합니다"
                    value={s.autoDefer}
                    onValueChange={(autoDefer: boolean) => saveSettings({ autoDefer })}
                />
            </TableRowGroup>
            <TextArea
                label="추가로 막을 REST 경로 (정규식, 한 줄에 하나)"
                placeholder={'^/users/@me/something'}
                value={stubs}
                onChange={setStubs}
            />
            <Button
                text="경로 목록 저장"
                variant="secondary"
                onPress={() => saveSettings({ extraStubs: stubs.split('\n').map(l => l.trim()).filter(Boolean) }).then(() => toast('저장했습니다'))}
            />
        </View>
    )
}

function LogSection() {
    const { TableRowGroup, TableRow } = Design
    const logs = getLogs().slice(0, 40)
    return (
        <TableRowGroup title="로그 (401로 튕기면 여기서 경로 확인)">
            {logs.length ? (
                logs.map((l, idx) => <TableRow key={`${l.t}-${idx}`} label={l.msg} subLabel={`${new Date(l.t).toLocaleTimeString()} · ${l.kind}`} />)
            ) : (
                <TableRow label="아직 기록이 없습니다" />
            )}
        </TableRowGroup>
    )
}

export default function SettingsPage({ api }: { api: PluginApi<{ jsonStorage: Settings }> }) {
    api.jsonStorage.use()
    useLive()
    const s = settings()
    const [req, setReq] = useState<Req>({ method: 'GET', path: '/users/@me', body: '' })
    return (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
            <AccountSection s={s} />
            <IntentSection s={s} />
            <PresenceSection s={s} />
            <ConsoleSection req={req} setReq={setReq} />
            <InteractionSection setReq={setReq} />
            <AdvancedSection s={s} />
            <LogSection />
        </ScrollView>
    )
}
