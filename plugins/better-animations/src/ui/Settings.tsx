import { AlertActionCreators, ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
    AMOUNT_RANGE,
    decodeEasing,
    DIRECTIONS,
    EASING_BEZIERS,
    EASING_STYLES,
    EASING_TYPES,
    EASINGS,
    EFFECTS,
    easingLabel,
    encodeEasing,
    exitChoices,
    isCustomEasing,
    POSITIONS,
    SAME_ID,
    type CustomEasing,
    type EasingKey,
    type ModuleKey,
} from '../effects'
import { pingNative } from '../native'
import { bindStorage, DEFAULTS, hasStorage, MODULE_KEYS, save, settings, status, type ModuleSettings, type Settings } from '../settings'
import { palette } from './colors'
import Preview from './Preview'

const D = () => Design as any

interface ModuleInfo {
    title: string
    description: string
    /** 네이티브 전환이라 속도·움직임을 못 바꿈 */
    native?: boolean
    /** 고를 수 있는 움직임 (없으면 전부 + 직접 만들기) */
    easings?: EasingKey[]
    /** 나갈 때 효과를 따로 고를 수 있음 */
    exit?: boolean
    /** 방향·위치를 고를 수 있음 */
    move?: boolean
    /** 움직임(곡선)을 고를 수 없음 (효과마다 정해져 있음) */
    noEasing?: boolean
    /** 바꾼 뒤 앱을 다시 시작해야 확실히 적용됨 */
    restart?: boolean
    test?: () => void
}

let seq = 0

const LAYOUT_EASINGS: EasingKey[] = ['out', 'smooth', 'linear', 'spring', 'back']

const MODULES: Record<ModuleKey, ModuleInfo> = {
    messages: {
        title: '메시지',
        description: '채팅에서 메시지가 나타나고 지워질 때, 그리고 다른 메시지가 밀릴 때 (안드로이드 네이티브 부분이 처리)',
        exit: true,
        move: true,
    },
    lists: {
        title: '목록 스크롤 (Cask)',
        description: '채널·멤버·DM·설정·이모지 목록을 스크롤할 때 새로 보이는 줄에 Cask 3 효과 (메시지는 위 "메시지"에서 Cask 효과를 고를 수 있어요)',
        noEasing: true,
    },
    stack: { title: '화면 전환', description: '설정, 설정 항목, 프로필, 검색처럼 새로 열리는 화면이 나타나고 닫히는 효과', exit: true, move: true },
    push: {
        title: '화면 전환 · 안드로이드 효과',
        description: '위 "화면 전환"을 "기본"으로 둘 때 쓰는 안드로이드 기본 전환. "화면 전환" 효과를 고르면 그쪽이 우선이에요 (슬라이드·서랍·아래에서는 안드로이드 전환으로, 나머지는 페이드 + 움직임)',
        native: true,
    },
    modal: { title: '모달 화면 · 안드로이드 효과', description: '아래에서 올라오는 전체 화면(설정 등)의 안드로이드 기본 전환. 위 "화면 전환"의 "모달 화면에도"가 켜져 있으면 그쪽이 우선이에요', native: true },
    panel: {
        title: '채널 화면 밀기',
        description: '채널 목록 ↔ 채팅 화면, 멤버 목록이 옆으로 밀려 나오고 들어가는 움직임',
        restart: true,
    },
    channelList: {
        title: '채널 목록',
        description: '카테고리를 접고 펼칠 때 채널들이 차례로 나타나고 사라지게',
    },
    servers: {
        title: '서버 바꾸기',
        description: '다른 서버나 DM을 눌러 채널 목록·DM 목록이 바뀔 때 나타나는 효과',
        move: true,
    },
    folder: { title: '서버 폴더', description: '서버 목록에서 폴더를 열고 닫을 때 서버 아이콘이 나타나는 모습과 펼쳐지는 속도', exit: true, move: true },
    subtle: {
        title: '작은 움직임',
        description: '체크박스, 라디오 버튼, 버튼처럼 디스코드 곳곳의 작은 움직임 (같은 스프링을 함께 씀)',
        easings: ['smooth', 'spring', 'back', 'bounce', 'elastic'],
    },
    sheet: { title: '아래 창', description: '메시지나 사용자를 길게 눌렀을 때, 프로필을 눌렀을 때 뜨는 창' },
    menu: { title: '팝업 메뉴', description: '⋯ 버튼을 눌렀을 때 뜨는 작은 메뉴', exit: true, move: true },
    alert: {
        title: '확인창',
        description: '가운데 뜨는 알림·확인 창',
        exit: true,
        move: true,
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
    backdrop: {
        title: '배경',
        description: '확인창·팝업 메뉴 뒤를 어둡게 덮는 막. 진하기를 바꾸거나 없앨 수 있어요',
        easings: ['out', 'smooth', 'linear', 'expo'],
    },
    notice: {
        title: '알림 배너',
        description: '다른 채널에 메시지가 오면 화면 위에 뜨는 알림이 나타나는 모습 (속도는 디스코드 것을 따라요)',
        move: true,
    },
    toast: {
        title: '토스트',
        description: '화면 위에 잠깐 뜨는 작은 알림',
        exit: true,
        move: true,
        test: () => {
            try {
                ToastActionCreators.open(`better-animations-${Date.now()}-${seq++}`, { text: '토스트 애니메이션 미리보기' })
            } catch {}
        },
    },
}

// ── 작은 부품 ────────────────────────────────────────────────────

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

function Field({ label, trailing, children }: { label: string; trailing?: string; children: any }) {
    return (
        <View style={{ gap: 8 }}>
            <Label trailing={trailing}>{label}</Label>
            {children}
        </View>
    )
}

/** 슬라이더 (움직이는 동안은 숫자만, 손을 떼면 저장) */
function SliderField({
    label,
    value,
    min,
    max,
    step,
    format,
    presets,
    onCommit,
}: {
    label: string
    value: number
    min: number
    max: number
    step: number
    format(v: number): string
    presets: number[]
    onCommit(v: number): void
}) {
    const { Slider } = D()
    const [v, setV] = useState(value)
    useEffect(() => setV(value), [value])
    const round = (x: number) => Math.round(x / step) * step
    return (
        <Field label={label} trailing={format(v)}>
            {Slider ? (
                <Slider value={v} minimumValue={min} maximumValue={max} step={step} onValueChange={(x: number) => setV(round(x))} onSlidingComplete={(x: number) => onCommit(round(x))} />
            ) : (
                <Chips
                    items={presets.map(n => ({ id: String(n), label: format(n) }))}
                    value={String(value)}
                    onChange={x => {
                        setV(Number(x))
                        onCommit(Number(x))
                    }}
                />
            )}
        </Field>
    )
}

function SwitchRow({ label, subLabel, value, onChange }: { label: string; subLabel?: string; value: boolean; onChange(v: boolean): void }) {
    const { TableRowGroup, TableSwitchRow } = D()
    return (
        <TableRowGroup>
            <TableSwitchRow label={label} subLabel={subLabel} value={value} onValueChange={onChange} />
        </TableRowGroup>
    )
}

/** BetterDiscord Easing 처럼: 종류 → 방향 → 모양 → 세기 */
function EasingEditor({ value, onChange }: { value: EasingKey; onChange(v: EasingKey): void }) {
    const c = useMemo(palette, [])
    const e = decodeEasing(value)
    const set = (patch: Partial<CustomEasing>) => {
        const next = { ...e, ...patch }
        if (patch.type && patch.type !== e.type && patch.type !== 'linear' && patch.type !== 'ease') next.amount = AMOUNT_RANGE[patch.type].def
        onChange(encodeEasing(next))
    }
    const range = e.type === 'back' || e.type === 'elastic' || e.type === 'steps' ? AMOUNT_RANGE[e.type] : undefined
    return (
        <View style={{ gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border }}>
            <Field label="종류">
                <Chips items={EASING_TYPES} value={e.type} onChange={type => set({ type })} />
            </Field>
            {e.type !== 'linear' && e.type !== 'steps' && (
                <Field label="방향">
                    <Chips items={EASING_BEZIERS} value={e.bezier} onChange={bezier => set({ bezier })} />
                </Field>
            )}
            {e.type === 'ease' && (
                <Field label="모양">
                    <Chips items={EASING_STYLES} value={e.style} onChange={style => set({ style })} />
                </Field>
            )}
            {range && (
                <SliderField
                    label={e.type === 'steps' ? '단계' : e.type === 'back' ? '튕기는 정도' : '출렁임'}
                    value={e.amount}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    format={v => (e.type === 'steps' ? `${Math.round(v)}` : v.toFixed(1))}
                    presets={e.type === 'steps' ? [3, 5, 8, 12] : [range.min, range.def, range.max]}
                    onCommit={amount => set({ amount })}
                />
            )}
        </View>
    )
}

// ── 모듈 카드 ────────────────────────────────────────────────────

function summaryOf(key: ModuleKey, m: ModuleSettings) {
    const effect = EFFECTS[key].find(e => e.id === m.effect)?.label ?? m.effect
    if (m.effect === 'default') return '디스코드 기본'
    if (key === 'lists' && m.effect !== 'default') return `${effect} · ${m.duration}ms`
    if (key === 'backdrop') return m.effect === 'solid' ? `단색 · ${Math.round((m.amount ?? 0.6) * 100)}%` : effect
    if (MODULES[key].native || m.effect === 'none') return effect
    return `${effect} · ${m.duration}ms · ${easingLabel(m.easing)}`
}

function ModuleCard({ id, value, open, onToggle, onChange, enabled }: { id: ModuleKey; value: ModuleSettings; open: boolean; onToggle(): void; onChange(next: ModuleSettings): void; enabled: boolean }) {
    const { Text, Button } = D()
    const c = useMemo(palette, [])
    const info = MODULES[id]
    const set = (patch: Partial<ModuleSettings>) => onChange({ ...value, ...patch })
    const custom = value.effect !== 'default' && value.effect !== 'none' && !info.native
    const showSpeed = custom && !(id === 'backdrop' && value.effect !== 'solid')
    const easingItems = info.easings ? EASINGS.filter(e => info.easings!.includes(e.id)) : [...EASINGS, { id: 'custom', label: '직접 만들기' }]
    const easingValue = isCustomEasing(value.easing) && !info.easings ? 'custom' : value.easing

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
                    {id === 'messages' && status.native === false && (
                        <Text variant="text-xs/semibold" style={{ color: '#f23f43' }}>
                            네이티브 부분(plugin.jar)이 실리지 않았어요. 플러그인을 다시 설치하고 디스코드를 완전히 껐다 켜 주세요.
                        </Text>
                    )}
                    <Preview module={id} settings={value} />
                    <Field label="효과">
                        <Chips items={EFFECTS[id]} value={value.effect} onChange={effect => set({ effect })} />
                    </Field>
                    {info.exit && custom && (
                        <Field label="나갈 때">
                            <Chips items={exitChoices(id)} value={value.exit ?? SAME_ID} onChange={exit => set({ exit })} />
                        </Field>
                    )}
                    {id === 'backdrop' && value.effect === 'solid' && (
                        <SliderField
                            label="진하기"
                            value={Math.round((value.amount ?? 0.6) * 100)}
                            min={0}
                            max={100}
                            step={5}
                            format={v => `${v}%`}
                            presets={[20, 40, 60, 80, 100]}
                            onCommit={v => set({ amount: v / 100 })}
                        />
                    )}
                    {showSpeed && (
                        <SliderField label="속도" value={value.duration} min={100} max={1500} step={20} format={v => `${v}ms`} presets={[200, 300, 400, 600, 900]} onCommit={duration => set({ duration })} />
                    )}
                    {showSpeed && !info.noEasing && (
                        <Field label="움직임">
                            <Chips
                                items={easingItems}
                                value={easingValue}
                                onChange={(easing: string) => set({ easing: easing === 'custom' ? encodeEasing(decodeEasing(value.easing)) : easing })}
                            />
                        </Field>
                    )}
                    {showSpeed && !info.noEasing && easingValue === 'custom' && <EasingEditor value={value.easing} onChange={easing => set({ easing })} />}
                    {info.move && custom && (
                        <Field label="방향">
                            <Chips items={DIRECTIONS} value={value.direction ?? 'auto'} onChange={direction => set({ direction })} />
                        </Field>
                    )}
                    {info.move && custom && (
                        <Field label="기준 위치 (커지고 작아지는 점)">
                            <Chips items={POSITIONS} value={value.position ?? 'auto'} onChange={position => set({ position })} />
                        </Field>
                    )}
                    {id === 'lists' && custom && (
                        <SwitchRow label="처음 나타날 때도" subLabel="스크롤할 때뿐 아니라 목록이 처음 열릴 때도 (Cask 의 Fresh View)" value={!!value.always} onChange={always => set({ always })} />
                    )}
                    {id === 'stack' && custom && (
                        <SwitchRow label="모달 화면에도" subLabel="설정처럼 아래에서 올라오는 화면에도 이 효과를 써요" value={value.modals !== false} onChange={modals => set({ modals })} />
                    )}
                    {id === 'messages' && custom && (
                        <SliderField
                            label="차례로 나타나는 간격"
                            value={value.stagger ?? 30}
                            min={0}
                            max={150}
                            step={5}
                            format={v => `${v}ms`}
                            presets={[0, 20, 40, 80]}
                            onCommit={stagger => set({ stagger })}
                        />
                    )}
                    {id === 'messages' && custom && (
                        <SwitchRow label="채널을 열 때도" subLabel="채널을 열 때 보이는 메시지들도 차례로 나타나게" value={value.onOpen !== false} onChange={onOpen => set({ onOpen })} />
                    )}
                    {id === 'messages' && (
                        <SwitchRow
                            label="부드럽게 밀기"
                            subLabel="메시지가 추가·삭제될 때 다른 메시지들이 한 번에 튀지 않고 밀리게"
                            value={value.shift !== false}
                            onChange={shift => set({ shift })}
                        />
                    )}
                    {id === 'messages' && value.shift !== false && (
                        <SliderField
                            label="밀리는 속도"
                            value={value.shiftDuration ?? 200}
                            min={80}
                            max={800}
                            step={20}
                            format={v => `${v}ms`}
                            presets={[120, 200, 320, 500]}
                            onCommit={shiftDuration => set({ shiftDuration })}
                        />
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
    const [, rerender] = useState(0)
    useEffect(() => {
        if (open) pingNative().then(() => rerender(n => n + 1))
    }, [open])
    const f = status.found
    const rows: Array<[string, string]> = [
        ['메시지 (네이티브)', status.native === null ? '확인 중' : status.native ? '실림' : '안 실림'],
        ['화면 전환 (네이티브)', status.nativeScreenHook ? `맡음 · ${status.nativePlayed}회` : 'JS로 대신'],
        ['큰 화면·모달 (네이티브)', `효과 ${status.screens}회 · 뒤로 ${status.screenExits}회 · 전환 바꿈 ${status.nativeScreens}회`],
        ['설정·메뉴 화면', `${f.stack ? '연결됨' : '못 찾음'} · ${status.stack}회`],
        ['아래 창', `${f.sheets ? '연결됨' : '못 찾음'} · ${status.sheets}회`],
        ['Reanimated', `${f.worklets ? '연결됨' : '못 찾음'} · ${f.reanimated ? '준비됨' : '대기 중'}`],
        ['팝업 메뉴', `${status.menus}회`],
        ['확인창', `${status.alerts}회`],
        ['배경', `${status.backdrops}회`],
        ['토스트', `${status.toasts}회`],
        ['알림 배너', `${status.notices}회`],
        ['서버 폴더', `${status.folders}회`],
        ['목록 스크롤 (JS)', `${Object.keys(f).filter(k => k.startsWith('list:')).map(k => k.slice(5)).join(', ') || '못 찾음'} · ${status.listCells}회`],
        ['채널 목록·서버 바꾸기', `액션 ${f.layout ? '연결됨' : '못 찾음'} · 채널 줄 ${f.channelRows ? '연결됨' : '못 찾음'} · 서버 목록 ${f.servers ? '연결됨' : '못 찾음'} · ${status.layouts}회`],
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
    const [open, setOpen] = useState<ModuleKey | null>('messages')

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
                    바꾼 설정은 다음에 그 화면이나 창을 열 때부터 적용돼요. 이미 열려 있는 메뉴·알림은 다시 열어 주세요. 메시지 효과는 바로 적용돼요.
                </Text>

                <StatusRows />

                <Button text="모두 기본값으로" variant="secondary" size="md" onPress={() => commit({ ...DEFAULTS, modules: { ...DEFAULTS.modules } })} />
            </Stack>
        </ScrollView>
    )
}
