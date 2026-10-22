import { Component, useMemo } from 'react'
import { Image } from 'react-native'
import { getActionSheet, getCloseButton, getDesign, getFlatList, getGuildIcon, getStickersStore, getTitleHeader, hideSheet, sheets } from '../modules'
import { stickerUrl, uploadableGuilds, uploadSticker, type StickerItem } from '../sticker'
import { showToast } from '../toast'
import type { ReactNode } from 'react'

// 서버 부스트 단계별 스티커 슬롯 (0~3단계)
const SLOTS = [5, 15, 30, 60]

function hasSlot(guild: any): boolean | undefined {
    const used = getStickersStore()?.getStickersByGuildId?.(guild.id)?.length
    if (used == null) return undefined
    return used < (SLOTS[guild.premiumTier ?? 0] ?? 5)
}

function upload(s: StickerItem, guild: any) {
    hideSheet()
    showToast(`Adding to ${guild.name}…`)
    uploadSticker(s, guild.id).then(err => showToast(err ?? `Added ${s.name} to ${guild.name}`))
}

// 클래스는 React가 준비된 뒤에 만든다 (플러그인 스크립트가 처음 평가될 땐 React가 아직 없을 수 있음)
let ErrorBoundaryClass: any
function getErrorBoundary() {
    return (ErrorBoundaryClass ??= class ErrorBoundary extends Component<{ children: ReactNode }, { error?: unknown }> {
        state: { error?: unknown } = {}
        static getDerivedStateFromError(error: unknown) {
            return { error }
        }
        render() {
            if (this.state.error) {
                const { TableRow } = getDesign()
                return <TableRow label='Something went wrong' subLabel={String((this.state.error as Error)?.message ?? this.state.error)} />
            }
            return this.props.children
        }
    })
}

function GuildRow({ guild, sticker }: { guild: any; sticker: StickerItem }) {
    const { TableRow } = getDesign()
    const icon = getGuildIcon()
    const slot = useMemo(() => hasSlot(guild), [])
    return (
        <TableRow
            icon={icon?.default ? <icon.default guild={guild} size={icon.GuildIconSizes?.MEDIUM} animate={false} /> : undefined}
            disabled={slot === false}
            label={guild.name}
            subLabel={slot === false ? 'No slots available' : undefined}
            arrow
            onPress={() => upload(sticker, guild)}
        />
    )
}

function AddToServer({ sticker }: { sticker: StickerItem }) {
    const { TableRow } = getDesign()
    const guilds = uploadableGuilds()
    const TitleHeader = getTitleHeader()
    const CloseButton = getCloseButton()
    const FlatList = getFlatList()
    return (
        <>
            {TitleHeader && (
                <TitleHeader
                    title={`Stealing ${sticker.name}`}
                    leading={<Image source={{ uri: stickerUrl(sticker) }} style={{ width: 32, height: 32, marginRight: 12 }} />}
                    trailing={CloseButton ? <CloseButton onPress={() => hideSheet()} /> : undefined}
                />
            )}
            {guilds.length === 0 ? (
                <TableRow label='You have no servers where you can add stickers' />
            ) : FlatList ? (
                <FlatList
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    data={guilds}
                    renderItem={({ item }: any) => <GuildRow guild={item} sticker={sticker} />}
                    keyExtractor={(x: any) => x.id}
                />
            ) : (
                guilds.map(g => <GuildRow key={g.id} guild={g} sticker={sticker} />)
            )}
        </>
    )
}

/** Stealmoji의 AddToServerActionSheet와 같은 방식으로 서버 목록 창을 띄운다 */
export function showAddToServerSheet(sticker: StickerItem) {
    const ActionSheet = getActionSheet()
    if (!ActionSheet) return showToast('Could not open the server list')
    const ErrorBoundary = getErrorBoundary()
    const element = (
        <ActionSheet scrollable>
            <ErrorBoundary>
                <AddToServer sticker={sticker} />
            </ErrorBoundary>
        </ActionSheet>
    )
    sheets().openLazy(Promise.resolve({ default: () => element }), 'StealStickerAddToServer', {})
}
