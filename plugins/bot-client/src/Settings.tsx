import { Design } from '@revenge-mod/discord/design'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { botRequest, fillPlaceholders, validateBotToken } from './api'
import { isBotSession, loginWithBotToken, logout, stripBot } from './auth'
import { activate } from './boot'
import { sendPresence } from './gateway'
import { allowedPrivileged, INTENTS, PRIVILEGED_MASK } from './intents'
import { getInteractions, getLogs, saveSettings, settings, subscribe, type Settings as S, type Status } from './state'
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
    { label: 'Get bot user', method: 'GET', path: '/users/@me' },
    { label: 'Send embed', method: 'POST', path: '/channels/{channel}/messages', body: { embeds: [{ title: 'Title', description: 'Description', color: 0x5865f2 }] } },
    {
        label: 'Send Components V2',
        method: 'POST',
        path: '/channels/{channel}/messages',
        body: { flags: 1 << 15, components: [{ type: 17, components: [{ type: 10, content: '## Components V2\nBody' }] }] },
    },
    { label: 'List commands', method: 'GET', path: '/applications/{app}/commands' },
    { label: 'Register command', method: 'POST', path: '/applications/{app}/commands', body: { name: 'ping', description: 'Pong', type: 1 } },
    { label: 'Open DM', method: 'POST', path: '/users/@me/channels', body: { recipient_id: 'USER_ID' } },
    { label: 'Edit app description', method: 'PATCH', path: '/applications/@me', body: { description: 'About' } },
]

const STATUSES: Array<[Status, string]> = [
    ['online', 'Online'],
    ['idle', 'Idle'],
    ['dnd', 'Do Not Disturb'],
    ['invisible', 'Invisible'],
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
        if (!token) return showToast('Enter a bot token')
        setBusy(true)
        try {
            const { user, appId, flags } = await validateBotToken(token)
            let intents = s.intents
            if (flags !== undefined) {
                intents = (s.intents & ~PRIVILEGED_MASK) | (s.intents & allowedPrivileged(flags))
                if (intents !== s.intents) showToast('Removed privileged intents disabled in the portal')
            }
            // 봇 모드를 켜고, 계정을 바꾸기 전에 패치와 안전장치부터 건다
            saveSettings({ token, appId, intents, enabled: true, failCount: 0, bootArmed: false })
            activate()
            setDraft('')
            await loginWithBotToken(token)
            showToast(`Logging in as ${user.username}`)
        } catch (e) {
            showToast(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Section
            title="Account"
            rows={<TableRow label={bot ? 'Bot' : 'User'} subLabel={s.token ? `…${s.token.slice(-6)}` : undefined} />}
        >
            <TextInput label="Bot token" placeholder="Token" value={draft} onChange={setDraft} secureTextEntry size="md" />
            <ActionButton text={busy ? 'Working…' : bot ? 'Apply token' : 'Log in'} onPress={busy ? () => {} : login} disabled={busy} />
            {bot && (
                <ActionButton
                    text="Log out"
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
            title="Guard"
            rows={[
                    <TableRow
                        key="mode"
                        label={s.enabled ? 'Bot mode on' : 'Bot mode off'}
                    />,
                    !!s.lastError &&<TableRow key="error" label="Last failure" subLabel={`${s.lastError}${when ? `\n${when}` : ''}`} />,
                ].filter(Boolean)}
        >
            {!!s.lastError && <ActionButton text="Clear" onPress={() => saveSettings({ lastError: '', lastErrorAt: 0, failCount: 0 })} />}
        </Section>
    )
}

function IntentSection({ s }: { s: S }) {
    const { TableSwitchRow } = D()
    return (
        <Section
            title="Intents"
            rows={INTENTS.map(i => (
                <TableSwitchRow
                    key={i.name}
                    label={i.label}
                    subLabel={i.privileged ? `${i.name} · privileged` : i.name}
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
        if (!sendPresence()) showToast('Saved')
    }
    return (
        <Section
            title="Status"
            rows={STATUSES.map(([key, label]) => (
                <TableRow key={key} label={label} subLabel={s.status === key ? 'Current' : undefined} onPress={() => apply({ status: key })} />
            ))}
        >
            <TextInput label="Custom status" placeholder="None" value={custom} onChange={setCustom} size="md" />
            <ActionButton text="Apply" onPress={() => apply({ customStatus: custom })} />
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
                return setOut(`Invalid JSON: ${errMsg(e)}`)
            }
        }
        setBusy(true)
        try {
            const res = await botRequest(req.method, fillPlaceholders(req.path), body)
            const pretty = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2)
            setOut(`HTTP ${res.status}\n${pretty ?? ''}`.slice(0, 8000))
        } catch (e) {
            setOut(`Request failed: ${errMsg(e)}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Section
            title="API console"
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
            <TextInput label="Path" placeholder="/channels/{channel}/messages" value={req.path} onChange={(path: string) => setReq({ ...req, path })} size="md" />
            {TextArea ? (
                <TextArea label="JSON body" placeholder='{"content": "hi"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} size="md" />
            ) : (
                <TextInput label="JSON body" placeholder='{"content": "hi"}' value={req.body} onChange={(body: string) => setReq({ ...req, body })} multiline size="md" />
            )}
            <ActionButton text={busy ? 'Sending…' : 'Send'} onPress={busy ? () => {} : run} disabled={busy} />
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
            title="Interactions"
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
            title="Advanced"
            rows={[
                    <TableSwitchRow
                        key="reload"
                        label="Auto reload when stuck"
                        value={s.autoReload}
                        onValueChange={(autoReload: boolean) => saveSettings({ autoReload })}
                    />,
                    <TableSwitchRow
                        key="defer"
                        label="Auto defer interactions"
                        value={s.autoDefer}
                        onValueChange={(autoDefer: boolean) => saveSettings({ autoDefer })}
                    />,
                ]}
        >
            <Area label="Blocked REST paths (regex)" placeholder="^/users/@me/something" value={stubs} onChange={setStubs} multiline size="md" />
            <ActionButton
                text="Save"
                onPress={() => {
                    saveSettings({ extraStubs: stubs.split('\n').map(l => l.trim()).filter(Boolean) })
                    showToast('Saved')
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
            title="Log"
            rows={
                logs.length ? (
                    logs.map((l, idx) => <TableRow key={`${l.t}-${idx}`} label={l.msg} subLabel={`${new Date(l.t).toLocaleTimeString()} · ${l.kind}`} labelLineClamp={6} />)
                ) : (
                    <TableRow label="Empty" />
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
