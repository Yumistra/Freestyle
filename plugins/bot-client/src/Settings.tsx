import { React, ReactNative } from '@vendetta/metro/common'
import { useProxy } from '@vendetta/storage'
import { storage } from '@vendetta/plugin'
import { Button, Forms, General } from '@vendetta/ui/components'
import { showToast } from '@vendetta/ui/toasts'
import { botRequest, fillPlaceholders, validateBotToken } from './api'
import { isBotSession, loginWithBotToken, logout, stripBot } from './auth'
import { activate } from './boot'
import { sendPresence } from './gateway'
import { allowedPrivileged, INTENTS, PRIVILEGED_MASK } from './intents'
import { getInteractions, getLogs, MAX_FAILS, saveSettings, settings, subscribe, type Settings as S, type Status } from './state'

const { useState, useEffect } = React
const { ScrollView, View } = ReactNative
const { Text } = General
const { FormRow, FormSwitchRow, FormInput, FormDivider, FormSection } = Forms as any

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

function ActionButton({ text, onPress, color }: { text: string; onPress: () => void; color?: string }) {
    if (Button) {
        const Colors = (Button as any).Colors ?? {}
        return <Button text={text} onPress={onPress} color={color === 'danger' ? Colors.RED : Colors.BRAND} size={(Button as any).Sizes?.SMALL} />
    }
    return <FormRow label={text} onPress={onPress} />
}

function AccountSection({ s }: { s: S }) {
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
        <FormSection title="계정">
            <FormRow label={bot ? '봇으로 로그인됨' : '일반 계정으로 로그인됨'} subLabel={s.token ? `저장된 토큰 …${s.token.slice(-6)}` : '저장된 봇 토큰 없음'} />
            <FormDivider />
            <FormInput title="봇 토큰" placeholder="개발자 포털 → Bot → Reset Token" value={draft} onChange={setDraft} secureTextEntry />
            <ActionButton text={busy ? '처리 중…' : bot ? '토큰 다시 적용' : '봇으로 로그인'} onPress={busy ? () => {} : login} />
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
        </FormSection>
    )
}

function SafetySection({ s }: { s: S }) {
    const when = s.lastErrorAt ? new Date(s.lastErrorAt).toLocaleString() : ''
    return (
        <FormSection title="안전장치">
            <FormRow
                label={s.enabled ? '봇 모드 켜짐' : '봇 모드 꺼짐'}
                subLabel={s.enabled ? `연결이 ${Math.round((s.readyTimeoutMs + 15000) / 1000)}초 안에 완료되지 않거나 ${MAX_FAILS}번 연속 멈추면 자동으로 꺼지고 로그아웃됩니다` : '봇으로 로그인하면 켜집니다'}
            />
            {!!s.lastError && (
                <>
                    <FormDivider />
                    <FormRow label="마지막 실패 원인" subLabel={`${s.lastError}${when ? `\n${when}` : ''}`} />
                    <ActionButton text="실패 기록 지우기" onPress={() => saveSettings({ lastError: '', lastErrorAt: 0, failCount: 0 })} />
                </>
            )}
        </FormSection>
    )
}

function IntentSection({ s }: { s: S }) {
    return (
        <FormSection title="인텐트 (다음 연결부터 적용)">
            {INTENTS.map(i => (
                <FormSwitchRow
                    key={i.name}
                    label={i.label}
                    subLabel={i.privileged ? `${i.name} · 포털에서 켜야 함` : i.name}
                    value={(s.intents & i.bit) !== 0}
                    onValueChange={(v: boolean) => saveSettings({ intents: v ? s.intents | i.bit : s.intents & ~i.bit })}
                />
            ))}
        </FormSection>
    )
}

function PresenceSection({ s }: { s: S }) {
    const [custom, setCustom] = useState(s.customStatus)
    const apply = (patch: Partial<S>) => {
        saveSettings(patch)
        if (!sendPresence()) showToast('저장했습니다. 봇으로 로그인하면 적용됩니다')
    }
    return (
        <FormSection title="상태">
            {STATUSES.map(([key, label]) => (
                <FormRow key={key} label={label} subLabel={s.status === key ? '사용 중' : undefined} onPress={() => apply({ status: key })} />
            ))}
            <FormDivider />
            <FormInput title="상태 메시지" placeholder="비워두면 없음" value={custom} onChange={setCustom} />
            <ActionButton text="상태 메시지 적용" onPress={() => apply({ customStatus: custom })} />
        </FormSection>
    )
}

function ConsoleSection({ req, setReq }: { req: Req; setReq: (r: Req) => void }) {
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
        <FormSection title="API 콘솔 · {channel}=현재 채널, {app}=앱 ID">
            {PRESETS.map(p => (
                <FormRow
                    key={p.label}
                    label={p.label}
                    subLabel={`${p.method} ${p.path}`}
                    onPress={() => setReq({ method: p.method, path: p.path, body: p.body ? JSON.stringify(p.body, null, 2) : '' })}
                />
            ))}
            <FormDivider />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <View key={m} style={{ opacity: req.method === m ? 1 : 0.5 }}>
                        <ActionButton text={m} onPress={() => setReq({ ...req, method: m })} />
                    </View>
                ))}
            </View>
            <FormInput title="경로" placeholder="/channels/{channel}/messages" value={req.path} onChange={(path: string) => setReq({ ...req, path })} />
            <FormInput title="JSON 본문" placeholder='{"content": "안녕"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} multiline />
            <ActionButton text={busy ? '보내는 중…' : '요청 보내기'} onPress={busy ? () => {} : run} />
            {!!out && (
                <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 12 }} selectable>
                        {out}
                    </Text>
                </View>
            )}
        </FormSection>
    )
}

function InteractionSection({ setReq }: { setReq: (r: Req) => void }) {
    const list = getInteractions()
    if (!list.length) return null
    return (
        <FormSection title="받은 인터랙션 · 탭하면 응답 요청을 채움 (15분 이내)">
            {list.map(i => (
                <FormRow
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
        </FormSection>
    )
}

function AdvancedSection({ s }: { s: S }) {
    const [stubs, setStubs] = useState(s.extraStubs.join('\n'))
    return (
        <FormSection title="고급">
            <FormSwitchRow
                label="인터랙션 자동 defer"
                subLabel="3초 제한 때문에 끄면 명령이 '응답 없음'으로 실패합니다"
                value={s.autoDefer}
                onValueChange={(autoDefer: boolean) => saveSettings({ autoDefer })}
            />
            <FormDivider />
            <FormInput title="추가로 막을 REST 경로 (정규식, 한 줄에 하나)" placeholder="^/users/@me/something" value={stubs} onChange={setStubs} multiline />
            <ActionButton
                text="경로 목록 저장"
                onPress={() => {
                    saveSettings({ extraStubs: stubs.split('\n').map(l => l.trim()).filter(Boolean) })
                    showToast('저장했습니다')
                }}
            />
        </FormSection>
    )
}

function LogSection() {
    const logs = getLogs().slice(0, 40)
    return (
        <FormSection title="로그 (401로 튕기면 여기서 경로 확인)">
            {logs.length ? (
                logs.map((l, idx) => <FormRow key={`${l.t}-${idx}`} label={l.msg} subLabel={`${new Date(l.t).toLocaleTimeString()} · ${l.kind}`} />)
            ) : (
                <FormRow label="아직 기록이 없습니다" />
            )}
        </FormSection>
    )
}

export default function SettingsPage() {
    useProxy(storage)
    useLive()
    const s = settings()
    const [req, setReq] = useState({ method: 'GET', path: '/users/@me', body: '' } as Req)
    return (
        <ScrollView style={{ flex: 1 }}>
            <AccountSection s={s} />
            <SafetySection s={s} />
            <IntentSection s={s} />
            <PresenceSection s={s} />
            <ConsoleSection req={req} setReq={setReq} />
            <InteractionSection setReq={setReq} />
            <AdvancedSection s={s} />
            <LogSection />
        </ScrollView>
    )
}
