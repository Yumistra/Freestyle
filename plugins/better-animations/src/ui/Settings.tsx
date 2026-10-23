import { AlertActionCreators, ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { EASINGS, EFFECTS, type EasingKey, type ModuleKey } from '../effects'
import { bindStorage, DEFAULTS, hasStorage, MODULE_KEYS, save, settings, status, type ModuleSettings, type Settings } from '../settings'
import { palette } from './colors'
import Preview from './Preview'

const D = () => Design as any

interface ModuleInfo {
    title: string
    description: string
    /** 네이티브 전환이라 속도·움직임을 못 바꿈 */
    native?: boolean
    /** 고를 수 있는 움직임 (없으면 전부) */
    easings?: EasingKey[]
    /** 바꾼 뒤 앱을 다시 시작해야 확실히 적용됨 */
    restart?: boolean
    test?: () => void
}

let seq = 0

const MODULES: Record<ModuleKey, ModuleInfo> = {
    stack: { title: '화면 전환', description: '설정 항목, 프로필, 검색처럼 안쪽으로 들어가는 화면이 나타나는 효과' },
    push: {
        title: '화면 전환 · 안드로이드 효과',
        description: '화면을 나갈 때와 위 효과 아래에 같이 깔리는 안드로이드 기본 전환. 위 "화면 전환"을 고르면 여기 기본은 페이드가 돼요',
        native: true,
    },
    modal: { title: '모달 화면', description: '아래에서 올라오는 전체 화면 (사용자 설정 등) · 안드로이드 기본 전환 중에서만 고를 수 있어요', native: true },
    panel: {
        title: '채널 화면 밀기',
        description: '채널 목록 ↔ 채팅 화면이 옆으로 밀려 나오고 들어가는 움직임',
        restart: true,
    },
    folder: { title: '서버 폴더', description: '서버 목록에서 폴더를 열고 닫을 때 서버 아이콘이 나타나는 모습과 펼쳐지는 속도' },
    subtle: {
        title: '작은 움직임',
        description: '체크박스, 라디오 버튼, 버튼처럼 디스코드 곳곳의 작은 움직임 (같은 스프링을 함께 씀)',
        easings: ['smooth', 'spring', 'back', 'bounce', 'elastic'],
    },
    sheet: { title: '아래 창', description: '메시지나 사용자를 길게 눌렀을 때 뜨는 창' },
    menu: { title: '팝업 메뉴', description: '⋯ 버튼을 눌렀을 때 뜨는 작은 메뉴' },
    alert: {
        title: '확인창',
        description: '가운데 뜨는 알림·확인 창',
        test: () => {
            const { AlertModal, AlertActionButton, Text } = D()
            AlertActionCreators.openAlert(
                `better-animations-test-${seq++}`,
                <AlertModal
                    title="Better Animations"
                    content={<Text variant="text-md/normal">확인창 애니메이션 미리보기예요.</Text>}
                    actions={<AlertActionButton text="닫기" variant="primary" />}
                />,
            )
        },
    },
    toast: {
        title: '토스트',
        description: '화면 위에 잠깐 뜨는 작은 알림',
        test: () => {
            try {
                ToastActionCreators.open(`better-animations-${Date.now()}-${seq++}`, { text: '토스트 애니메이션 미리보기' })
            } catch {}
        },
    },
}

function Chips<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange(v: T): void }) {
    const { Text } = D()
    const c = useMemo(palette, [])
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {items.map(item => {
                const on = item.id === value
                return (
                    <Pressable
                        key={item.id}
                        onPress={() => onChange(item.id)}
                        style={{
                            paddingHorizontal: 14,
                            height: 34,
                            borderRadius: 17,
                            justifyContent: 'center',
                            backgroundColor: on ? c.brand : c.surface,
                            borderWidth: 1,
                            borderColor: on ? c.brand : c.border,
                        }}
                    >
                        <Text variant="text-sm/semibold" style={{ color: on ? '#ffffff' : c.text }}>
                            {item.label}
                        </Text>
                    </Pressable>
                )
            })}
        </ScrollView>
    )
}

function Label({ children, trailing }: { children: string; trailing?: string }) {
    const { Text } = D()
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="text-sm/semibold" color="text-muted">
                {children}
            </Text>
            {trailing ? (
                <Text variant="text-sm/semibold" color="text-muted">
                    {trailing}
                </Text>
            ) : null}
        </View>
    )
}

function summaryOf(key: ModuleKey, m: ModuleSettings) {
    const effect = EFFECTS[key].find(e => e.id === m.effect)?.label ?? m.effect
    if (m.effect === 'default') return '디스코드 기본'
    if (MODULES[key].native || m.effect === 'none') return effect
    const easing = EASINGS.find(e => e.id === m.easing)?.label ?? m.easing
    return `${effect} · ${m.duration}ms · ${easing}`
}

function ModuleCard({ id, value, open, onToggle, onChange, enabled }: { id: ModuleKey; value: ModuleSettings; open: boolean; onToggle(): void; onChange(next: ModuleSettings): void; enabled: boolean }) {
    const { Text, Slider, Button } = D()
    const c = useMemo(palette, [])
    const info = MODULES[id]
    const [duration, setDuration] = useState(value.duration)
    useEffect(() => setDuration(value.duration), [value.duration])
    const custom = value.effect !== 'default' && value.effect !== 'none' && !info.native
    const showSpeed = custom

    return (
        <View style={{ borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: open ? c.brandSoft : c.border, overflow: 'hidden', opacity: enabled ? 1 : 0.55 }}>
            <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: value.effect === 'default' ? c.muted : c.brand }} />
                <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="text-md/semibold">{info.title}</Text>
                    <Text variant="text-xs/medium" color="text-muted">
                        {summaryOf(id, value)}
                    </Text>
                </View>
                <Text variant="text-lg/bold" color="text-muted">
                    {open ? '−' : '+'}
                </Text>
            </Pressable>
            {open && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 16, gap: 14 }}>
                    <Text variant="text-xs/normal" color="text-muted">
                        {info.description}
                    </Text>
                    <Preview module={id} settings={{ ...value, duration }} />
                    <View style={{ gap: 8 }}>
                        <Label>효과</Label>
                        <Chips items={EFFECTS[id]} value={value.effect} onChange={effect => onChange({ ...value, effect })} />
                    </View>
                    {showSpeed && (
                        <View style={{ gap: 6 }}>
                            <Label trailing={`${duration}ms`}>속도</Label>
                            {Slider ? (
                                <Slider
                                    value={duration}
                                    minimumValue={100}
                                    maximumValue={1200}
                                    step={20}
                                    onValueChange={(v: number) => setDuration(Math.round(v))}
                                    onSlidingComplete={(v: number) => onChange({ ...value, duration: Math.round(v) })}
                                />
                            ) : (
                                <Chips
                                    items={[200, 300, 400, 600, 900].map(n => ({ id: String(n), label: `${n}ms` }))}
                                    value={String(value.duration)}
                                    onChange={v => {
                                        setDuration(Number(v))
                                        onChange({ ...value, duration: Number(v) })
                                    }}
                                />
                            )}
                        </View>
                    )}
                    {showSpeed && (
                        <View style={{ gap: 8 }}>
                            <Label>움직임</Label>
                            <Chips items={info.easings ? EASINGS.filter(e => info.easings!.includes(e.id)) : EASINGS} value={value.easing} onChange={(easing: EasingKey) => onChange({ ...value, easing })} />
                        </View>
                    )}
                    {info.restart && value.effect !== 'default' && (
                        <Text variant="text-xs/normal" color="text-muted">
                            이 항목은 바꾼 뒤 앱을 완전히 껐다 켜야 확실히 적용돼요.
                        </Text>
                    )}
                    {info.test && enabled && <Button text="실제로 띄워 보기" variant="secondary" size="sm" onPress={info.test} />}
                </View>
            )}
        </View>
    )
}

function StatusRows() {
    const { Text } = D()
    const c = useMemo(palette, [])
    const [open, setOpen] = useState(false)
    const f = status.found
    const rows: Array<[string, string]> = [
        ['큰 화면·모달 (네이티브)', `${status.screens}회 적용`],
        ['설정·메뉴 화면', `${f.stack ? '연결됨' : '못 찾음'} · ${status.stack}회`],
        ['아래 창', `${f.sheets ? '연결됨' : '못 찾음'} · ${status.sheets}회`],
        ['Reanimated', `${f.worklets ? '연결됨' : '못 찾음'} · ${f.reanimated ? '준비됨' : '대기 중'}`],
        ['팝업 메뉴', `${status.menus}회`],
        ['확인창', `${status.alerts}회`],
        ['토스트', `${status.toasts}회`],
        ['서버 폴더', `${status.folders}회`],
        ['디스코드 상수', status.constants.length ? status.constants.join(', ') : '아직 못 찾음'],
    ]
    if (status.lastError) rows.push(['마지막 오류', status.lastError])
    return (
        <View style={{ borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 }}>
            <Pressable onPress={() => setOpen(!open)}>
                <Text variant="text-sm/semibold">작동 확인 {open ? '−' : '+'}</Text>
            </Pressable>
            {open &&
                rows.map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                        <Text variant="text-xs/medium" color="text-muted">
                            {k}
                        </Text>
                        <Text variant="text-xs/medium" style={{ flexShrink: 1, textAlign: 'right', color: c.text }}>
                            {v}
                        </Text>
                    </View>
                ))}
        </View>
    )
}

export default function SettingsPage({ api }: { api?: any }) {
    const { Stack, Text, TableRowGroup, TableSwitchRow, Button } = D()
    if (!hasStorage() && api?.jsonStorage) bindStorage(api.jsonStorage)
    const [s, setS] = useState<Settings>(settings)
    const [open, setOpen] = useState<ModuleKey | null>('stack')

    const commit = (next: Settings) => {
        setS(next)
        save(next)
    }

    return (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Stack spacing={16} style={{ padding: 16, paddingBottom: 48 }}>
                <TableRowGroup>
                    <TableSwitchRow
                        label="애니메이션 바꾸기"
                        subLabel="끄면 모든 화면이 디스코드 기본 애니메이션으로 돌아가요"
                        value={s.enabled}
                        onValueChange={(enabled: boolean) => commit({ ...s, enabled })}
                    />
                </TableRowGroup>

                {MODULE_KEYS.map(key => (
                    <ModuleCard
                        key={key}
                        id={key}
                        value={s.modules[key]}
                        enabled={s.enabled}
                        open={open === key}
                        onToggle={() => setOpen(open === key ? null : key)}
                        onChange={m => commit({ ...s, modules: { ...s.modules, [key]: m } })}
                    />
                ))}

                <Text variant="text-xs/normal" color="text-muted">
                    바꾼 설정은 다음에 그 화면이나 창을 열 때부터 적용돼요. 이미 열려 있는 메뉴·알림은 다시 열어 주세요.
                </Text>

                <StatusRows />

                <Button text="모두 기본값으로" variant="secondary" size="md" onPress={() => commit({ ...DEFAULTS, modules: { ...DEFAULTS.modules } })} />
            </Stack>
        </ScrollView>
    )
}
