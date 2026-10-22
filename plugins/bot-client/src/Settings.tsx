import { Design } from '@revenge-mod/discord/design'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { botRequest, fillPlaceholders, validateBotToken } from './api'
import { isBotSession, loginWithBotToken, logout, stripBot } from './auth'
import { activate } from './boot'
import { sendPresence } from './gateway'
import { allowedPrivileged, INTENTS, PRIVILEGED_MASK } from './intents'
import { getInteractions, getLogs, MAX_FAILS, saveSettings, settings, subscribe, type Settings as S, type Status } from './state'
import { showToast } from './toast'
import type { ReactNode } from 'react'

interface Req {
    method: string
    path: string
    body: string
}

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

// 디스코드 디자인 컴포넌트 (Revenge Next가 찾아 둔 것). 렌더할 때 꺼내 써야 아직 로딩 전이어도 안전하다
const D = () => Design as any

function ActionButton({ text, onPress, color, disabled }: { text: string; onPress: () => void; color?: 'danger'; disabled?: boolean }) {
    const { Button } = D()
    return <Button text={text} onPress={onPress} disabled={disabled} size="md" variant={color === 'danger' ? 'destructive' : 'primary'} />
}

function Section({ title, description, rows, children }: { title: string; description?: string; rows?: ReactNode; children?: ReactNode }) {
    const { Stack, TableRowGroup } = D()
    return (
        <Stack spacing={8}>
            <TableRowGroup title={title} description={description}>
                {rows}
            </TableRowGroup>
            {children}
        </Stack>
    )
}

function AccountSection({ s }: { s: S }) {
    const { TableRow, TextInput } = D()
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const bot = isBotSession()

    const login = async () => {
        const token = stripBot(draft || s.token)
        if (!token) return showToast('봇 토큰을 입력하세요')
        setBusy(true)
        try {
            const { user, appId, flags } = await validateBotToken(token)
            let intents = s.intents
            if (flags !== undefined) {
                intents = (s.intents & ~PRIVILEGED_MASK) | (s.intents & allowedPrivileged(flags))
                if (intents !== s.intents) showToast('포털에서 꺼진 특권 인텐트를 뺐습니다')
            }
            // 봇 모드를 켜고, 계정을 바꾸기 전에 패치와 안전장치부터 건다
            saveSettings({ token, appId, intents, enabled: true, failCount: 0, bootArmed: false })
            activate()
            setDraft('')
            await loginWithBotToken(token)
            showToast(`${user.username}(으)로 로그인하는 중`)
        } catch (e) {
            showToast(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Section
            title="계정"
            rows={<TableRow label={bot ? '봇으로 로그인됨' : '일반 계정으로 로그인됨'} subLabel={s.token ? `저장된 토큰 …${s.token.slice(-6)}` : '저장된 봇 토큰 없음'} />}
        >
            <TextInput label="봇 토큰" placeholder="개발자 포털 → Bot → Reset Token" value={draft} onChange={setDraft} secureTextEntry size="md" />
            <ActionButton text={busy ? '처리 중…' : bot ? '토큰 다시 적용' : '봇으로 로그인'} onPress={busy ? () => {} : login} disabled={busy} />
            {bot && (
                <ActionButton
                    text="로그아웃"
                    color="danger"
                    onPress={() => {
                        try {
                            saveSettings({ enabled: false, bootArmed: false })
                            logout()
                        } catch (e) {
                            showToast(errMsg(e))
                        }
                    }}
                />
            )}
        </Section>
    )
}

function SafetySection({ s }: { s: S }) {
    const { TableRow } = D()
    const when = s.lastErrorAt ? new Date(s.lastErrorAt).toLocaleString() : ''
    return (
        <Section
            title="안전장치"
            rows={[
                    <TableRow
                        key="mode"
                        label={s.enabled ? '봇 모드 켜짐' : '봇 모드 꺼짐'}
                        subLabel={
                            s.enabled
                                ? `연결이 ${Math.round((s.readyTimeoutMs + 15000) / 1000)}초 안에 완료되지 않거나 ${MAX_FAILS}번 연속 멈추면 자동으로 꺼지고 로그아웃됩니다`
                                : '봇으로 로그인하면 켜집니다'
                        }
                    />,
                    !!s.lastError &&<TableRow key="error" label="마지막 실패 원인" subLabel={`${s.lastError}${when ? `\n${when}` : ''}`} />,
                ].filter(Boolean)}
        >
            {!!s.lastError && <ActionButton text="실패 기록 지우기" onPress={() => saveSettings({ lastError: '', lastErrorAt: 0, failCount: 0 })} />}
        </Section>
    )
}

function IntentSection({ s }: { s: S }) {
    const { TableSwitchRow } = D()
    return (
        <Section
            title="인텐트 (다음 연결부터 적용)"
            rows={INTENTS.map(i => (
                <TableSwitchRow
                    key={i.name}
                    label={i.label}
                    subLabel={i.privileged ? `${i.name} · 포털에서 켜야 함` : i.name}
                    value={(s.intents & i.bit) !== 0}
                    onValueChange={(v: boolean) => saveSettings({ intents: v ? s.intents | i.bit : s.intents & ~i.bit })}
                />
            ))}
        />
    )
}

function PresenceSection({ s }: { s: S }) {
    const { TableRow, TextInput } = D()
    const [custom, setCustom] = useState(s.customStatus)
    const apply = (patch: Partial<S>) => {
        saveSettings(patch)
        if (!sendPresence()) showToast('저장했습니다. 봇으로 로그인하면 적용됩니다')
    }
    return (
        <Section
            title="상태"
            rows={STATUSES.map(([key, label]) => (
                <TableRow key={key} label={label} subLabel={s.status === key ? '사용 중' : undefined} onPress={() => apply({ status: key })} />
            ))}
        >
            <TextInput label="상태 메시지" placeholder="비워두면 없음" value={custom} onChange={setCustom} size="md" />
            <ActionButton text="상태 메시지 적용" onPress={() => apply({ customStatus: custom })} />
        </Section>
    )
}

function ConsoleSection({ req, setReq }: { req: Req; setReq: (r: Req) => void }) {
    const { Button, Stack, TableRow, Text, TextArea, TextInput } = D()
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
        <Section
            title="API 콘솔 · {channel}=현재 채널, {app}=앱 ID"
            rows={PRESETS.map(p => (
                <TableRow
                    key={p.label}
                    label={p.label}
                    subLabel={`${p.method} ${p.path}`}
                    onPress={() => setReq({ method: p.method, path: p.path, body: p.body ? JSON.stringify(p.body, null, 2) : '' })}
                />
            ))}
        >
            <Stack direction="horizontal" spacing={6} style={{ flexWrap: 'wrap' }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <Button key={m} text={m} size="sm" variant={req.method === m ? 'primary' : 'secondary'} onPress={() => setReq({ ...req, method: m })} />
                ))}
            </Stack>
            <TextInput label="경로" placeholder="/channels/{channel}/messages" value={req.path} onChange={(path: string) => setReq({ ...req, path })} size="md" />
            {TextArea ? (
                <TextArea label="JSON 본문" placeholder='{"content": "안녕"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} size="md" />
            ) : (
                <TextInput label="JSON 본문" placeholder='{"content": "안녕"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} multiline size="md" />
            )}
            <ActionButton text={busy ? '보내는 중…' : '요청 보내기'} onPress={busy ? () => {} : run} disabled={busy} />
            {!!out && (
                <View style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
                    <Text variant="text-sm/normal" selectable>
                        {out}
                    </Text>
                </View>
            )}
        </Section>
    )
}

function InteractionSection({ setReq }: { setReq: (r: Req) => void }) {
    const { TableRow } = D()
    const list = getInteractions()
    if (!list.length) return null
    return (
        <Section
            title="받은 인터랙션 · 탭하면 응답 요청을 채움 (15분 이내)"
            rows={list.map(i => (
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
        />
    )
}

function AdvancedSection({ s }: { s: S }) {
    const { TableSwitchRow, TextArea, TextInput } = D()
    const [stubs, setStubs] = useState(s.extraStubs.join('\n'))
    const Area = TextArea ?? TextInput
    return (
        <Section
            title="고급"
            rows={[
                    <TableSwitchRow
                        key="reload"
                        label="멈추면 자동 새로고침"
                        subLabel="봇으로 켰는데 10초 안에 로딩이 끝나지 않거나, 앱을 닫았다 다시 열면 앱을 새로 불러옵니다"
                        value={s.autoReload}
                        onValueChange={(autoReload: boolean) => saveSettings({ autoReload })}
                    />,
                    <TableSwitchRow
                        key="defer"
                        label="인터랙션 자동 defer"
                        subLabel="3초 제한 때문에 끄면 명령이 '응답 없음'으로 실패합니다"
                        value={s.autoDefer}
                        onValueChange={(autoDefer: boolean) => saveSettings({ autoDefer })}
                    />,
                ]}
        >
            <Area label="추가로 막을 REST 경로 (정규식, 한 줄에 하나)" placeholder="^/users/@me/something" value={stubs} onChange={setStubs} multiline size="md" />
            <ActionButton
                text="경로 목록 저장"
                onPress={() => {
                    saveSettings({ extraStubs: stubs.split('\n').map(l => l.trim()).filter(Boolean) })
                    showToast('저장했습니다')
                }}
            />
        </Section>
    )
}

function LogSection() {
    const { TableRow } = D()
    const logs = getLogs().slice(0, 40)
    return (
        <Section
            title="로그 (401로 튕기면 여기서 경로 확인)"
            rows={
                logs.length ? (
                    logs.map((l, idx) => <TableRow key={`${l.t}-${idx}`} label={l.msg} subLabel={`${new Date(l.t).toLocaleTimeString()} · ${l.kind}`} labelLineClamp={6} />)
                ) : (
                    <TableRow label="아직 기록이 없습니다" />
                )
            }
        />
    )
}

export default function SettingsPage() {
    const { Stack } = D()
    useLive()
    const s = settings()
    const [req, setReq] = useState({ method: 'GET', path: '/users/@me', body: '' } as Req)
    return (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Stack spacing={24} style={{ padding: 16, paddingBottom: 48 }}>
                <AccountSection s={s} />
                <SafetySection s={s} />
                <IntentSection s={s} />
                <PresenceSection s={s} />
                <ConsoleSection req={req} setReq={setReq} />
                <InteractionSection setReq={setReq} />
                <AdvancedSection s={s} />
                <LogSection />
            </Stack>
        </ScrollView>
    )
}
