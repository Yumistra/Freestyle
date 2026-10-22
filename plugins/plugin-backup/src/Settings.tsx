import { AlertActionCreators, ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { Clipboard } from '@revenge-mod/externals/react-native-clipboard'
import { reloadApp } from '@revenge-mod/modules/native/app'
import { useEffect, useState } from 'react'
import { ScrollView, Share, View } from 'react-native'
import {
    createBackup,
    dataCountOf,
    deleteBackupFiles,
    exportBackup,
    messageOf,
    parseBackup,
    restoreBackup,
    storeImportedFiles,
    summaryOf,
    type Backup,
    type RestoreOptions,
    type RestoreResult,
} from './backup'

const MAX_BACKUPS = 10
const D = () => Design as any

let seq = 0
function toast(text: string) {
    try {
        ToastActionCreators.open(`plugin-backup-${Date.now()}-${seq++}`, { text })
    } catch {}
}

const dateOf = (t: number) => new Date(t).toLocaleString()

interface Storage {
    backups: Backup[]
}

function useBackups(storage: any) {
    const [backups, setBackups] = useState<Backup[]>(() => (storage?.cache as Storage | undefined)?.backups ?? [])
    useEffect(() => {
        // 저장소가 아직 안 읽혔을 수도 있으니 한 번 읽어 온다
        storage
            ?.get?.()
            .then((c: Storage | undefined) => c?.backups && setBackups(c.backups))
            .catch(() => {})
    }, [])
    const save = async (next: Backup[]) => {
        setBackups(next)
        await storage.set({ backups: next }, true)
    }
    return [backups, save] as const
}

function confirm(title: string, body: string, actionText: string, action: () => void) {
    const { AlertModal, AlertActionButton, Text } = D()
    AlertActionCreators.openAlert(
        `plugin-backup-confirm-${seq++}`,
        <AlertModal
            title={title}
            content={<Text variant="text-md/normal">{body}</Text>}
            actions={
                <>
                    <AlertActionButton text={actionText} variant="primary" onPress={action} />
                    <AlertActionButton text="취소" variant="secondary" />
                </>
            }
        />,
    )
}

function describeResult(r: RestoreResult) {
    const lines = [
        `설치 ${r.installed.length}개 · 설정 복원 ${r.storage}개 · 파일 복원 ${r.files}개 · 켜짐 상태 변경 ${r.toggled}개`,
        ...r.failed.map(f => `실패: ${f.id} (${f.reason})`),
        ...r.skipped.map(s => `건너뜀: ${s.id} (${s.reason})`),
    ]
    return lines.join('\n')
}

function showRestoreDone(r: RestoreResult) {
    const note = r.files ? '\n폰트·아이콘·이모지처럼 앱 시작 때 읽는 테마 파일은 앱을 완전히 껐다 켜야 적용됩니다.' : ''
    confirm('복원 완료', `${describeResult(r)}\n\n앱을 다시 불러와야 모두 적용됩니다.${note}`, '다시 불러오기', () => reloadApp())
}

export default function SettingsPage({ api }: { api: any }) {
    const { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextArea, TextInput } = D()
    const [backups, saveBackups] = useBackups(api.jsonStorage)
    const [selected, setSelected] = useState<number | null>(null)
    const [busy, setBusy] = useState('')
    const [input, setInput] = useState('')
    const [opts, setOpts] = useState<RestoreOptions>({ repos: true, install: true, storage: true, files: true, enabled: true })

    const run = async (label: string, fn: () => Promise<void>) => {
        if (busy) return
        setBusy(label)
        try {
            await fn()
        } catch (e) {
            toast(messageOf(e))
        } finally {
            setBusy('')
        }
    }

    const addBackup = async (b: Backup) => {
        const all = [b, ...backups.filter(x => x.createdAt !== b.createdAt)]
        // 넘치는 오래된 백업은 복사해 둔 파일까지 지운다
        for (const old of all.slice(MAX_BACKUPS)) await deleteBackupFiles(old)
        await saveBackups(all.slice(0, MAX_BACKUPS))
    }

    const backupNow = () =>
        run('백업 만드는 중…', async () => {
            const b = await createBackup(text => text && setBusy(text))
            await addBackup(b)
            setSelected(0)
            toast(`백업했습니다: ${summaryOf(b)}`)
        })

    const importBackup = (text: string) =>
        run('가져오는 중…', async () => {
            let raw = text.trim()
            if (!raw) throw new Error('붙여넣은 내용이 없습니다')
            if (/^https?:\/\//i.test(raw)) {
                const res = await fetch(raw, { cache: 'no-store' } as any)
                if (!res.ok) throw new Error(`다운로드 실패 (HTTP ${res.status})`)
                raw = await res.text()
            }
            setBusy('파일 푸는 중…')
            const b = await storeImportedFiles(parseBackup(raw))
            await addBackup(b)
            setSelected(0)
            setInput('')
            toast(`가져왔습니다: ${summaryOf(b)}`)
        })

    const restore = (b: Backup) =>
        confirm(
            '이 백업으로 복원할까요?',
            `${dateOf(b.createdAt)}\n${summaryOf(b)}\n\n없는 플러그인은 저장소에서 설치하고, 고른 항목을 백업 상태로 되돌립니다.`,
            '복원',
            () =>
                run('복원 중…', async () => {
                    const r = await restoreBackup(b, opts, text => text && setBusy(text))
                    showRestoreDone(r)
                }),
        )

    const current = selected != null ? backups[selected] : undefined
    const exportThen = (b: Backup, label: string, fn: (json: string) => unknown) =>
        run(label, async () => {
            const { json, withFiles } = await exportBackup(b)
            await fn(json)
            if (!withFiles) toast('데이터 파일이 커서 복사본에는 설정만 들어갑니다. 파일은 이 기기에서 복원할 때만 쓰입니다.')
        })

    return (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Stack spacing={24} style={{ padding: 16, paddingBottom: 48 }}>
                <Stack spacing={8}>
                    <Button text={busy || '지금 백업하기'} variant="primary" size="md" disabled={!!busy} onPress={backupNow} />
                    <Text variant="text-sm/normal" color="text-muted">
                        설치한 플러그인과 저장소, 켜짐/꺼짐 상태, 플러그인 설정(storage.json·state.json 등), 설정이 가리키는 데이터 파일(폰트·배경 이미지·아이콘 등)까지 저장합니다. 최근 {MAX_BACKUPS}개까지 보관합니다.
                    </Text>
                </Stack>

                <TableRowGroup title="저장된 백업 · 눌러서 선택">
                    {backups.length ? (
                        backups.map((b, i) => (
                            <TableRow
                                key={`${b.createdAt}-${i}`}
                                label={`${selected === i ? '● ' : ''}${dateOf(b.createdAt)}`}
                                subLabel={summaryOf(b)}
                                onPress={() => setSelected(selected === i ? null : i)}
                            />
                        ))
                    ) : (
                        <TableRow label="아직 백업이 없습니다" />
                    )}
                </TableRowGroup>

                {current && (
                    <Stack spacing={8}>
                        <TableRowGroup title="복원할 항목">
                            {[
                                <TableSwitchRow key="repos" label="저장소" subLabel="백업에 있던 플러그인 저장소를 추가" value={opts.repos} onValueChange={(repos: boolean) => setOpts({ ...opts, repos })} />,
                                <TableSwitchRow key="install" label="없는 플러그인 설치" subLabel="저장소에서 다시 받음 (파일로 설치한 건 제외)" value={opts.install} onValueChange={(install: boolean) => setOpts({ ...opts, install })} />,
                                <TableSwitchRow key="storage" label="플러그인 설정" subLabel="storage.json·state.json 등을 백업 내용으로 덮어씀" value={opts.storage} onValueChange={(storage: boolean) => setOpts({ ...opts, storage })} />,
                                <TableSwitchRow key="files" label="플러그인 데이터 파일" subLabel="폰트·배경 이미지·아이콘 등 설정이 쓰는 파일을 되돌림" value={opts.files} onValueChange={(files: boolean) => setOpts({ ...opts, files })} />,
                                <TableSwitchRow key="enabled" label="켜짐/꺼짐 상태" value={opts.enabled} onValueChange={(enabled: boolean) => setOpts({ ...opts, enabled })} />,
                            ]}
                        </TableRowGroup>
                        <Button text={busy || '이 백업으로 복원'} variant="primary" size="md" disabled={!!busy} onPress={() => restore(current)} />
                        <Stack direction="horizontal" spacing={8}>
                            <View style={{ flex: 1 }}>
                                <Button
                                    text="복사"
                                    variant="secondary"
                                    size="md"
                                    disabled={!!busy}
                                    onPress={() =>
                                        exportThen(current, '복사하는 중…', json => {
                                            Clipboard.setString(json)
                                            toast('백업을 클립보드에 복사했습니다')
                                        })
                                    }
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Button
                                    text="공유"
                                    variant="secondary"
                                    size="md"
                                    disabled={!!busy}
                                    onPress={() => exportThen(current, '공유 준비 중…', json => Share.share({ title: 'Revenge 플러그인 백업', message: json }).catch(() => {}))}
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Button
                                    text="삭제"
                                    variant="destructive"
                                    size="md"
                                    onPress={() =>
                                        confirm('백업을 삭제할까요?', dateOf(current.createdAt), '삭제', () => {
                                            setSelected(null)
                                            saveBackups(backups.filter(b => b !== current))
                                            deleteBackupFiles(current)
                                        })
                                    }
                                />
                            </View>
                        </Stack>
                        <TableRowGroup title="백업 내용">
                            {current.plugins
                                .filter(p => {
                                    // 내장 플러그인은 데이터가 있을 때만 (예: 테마 API의 state.json)
                                    const d = dataCountOf(current, p.id)
                                    return !p.internal || d.settings + d.files > 0
                                })
                                .map(p => {
                                    const d = dataCountOf(current, p.id)
                                    const extra = [d.settings && `설정 ${d.settings}`, d.files && `파일 ${d.files}`].filter(Boolean).join(' · ')
                                    return (
                                        <TableRow
                                            key={p.id}
                                            label={`${p.enabled ? '' : '(꺼짐) '}${p.name} ${p.version}`}
                                            subLabel={`${extra ? `${extra} · ` : ''}${p.internal ? '내장' : p.source?.repo ?? '파일로 설치'}`}
                                            subLabelLineClamp={1}
                                        />
                                    )
                                })}
                        </TableRowGroup>
                    </Stack>
                )}

                <Stack spacing={8}>
                    {(TextArea ?? TextInput) && (
                        <>
                            {TextArea ? (
                                <TextArea label="백업 가져오기" placeholder="복사한 백업(JSON) 또는 백업 파일 URL" value={input} onChange={setInput} size="md" />
                            ) : (
                                <TextInput label="백업 가져오기" placeholder="복사한 백업(JSON) 또는 백업 파일 URL" value={input} onChange={setInput} multiline size="md" />
                            )}
                        </>
                    )}
                    <Stack direction="horizontal" spacing={8}>
                        <View style={{ flex: 1 }}>
                            <Button text="가져오기" variant="primary" size="md" disabled={!!busy || !input.trim()} onPress={() => importBackup(input)} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Button
                                text="클립보드에서"
                                variant="secondary"
                                size="md"
                                disabled={!!busy}
                                onPress={() => Clipboard.getString().then((t: string) => importBackup(t ?? ''))}
                            />
                        </View>
                    </Stack>
                </Stack>
            </Stack>
        </ScrollView>
    )
}
