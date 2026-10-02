import { React } from '@vendetta/metro/common'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { ErrorBoundary, Forms } from '@vendetta/ui/components'
import { showToast } from '@vendetta/ui/toasts'
import { getActionSheet, getCloseButton, getFlatList, getGuildIcon, getStickersStore, getTitleHeader, LazyActionSheet } from '../modules'
import { stickerUrl, uploadableGuilds, uploadSticker, type StickerItem } from '../sticker'

const { FormRow, FormIcon, FormDivider } = Forms as any

// 서버 부스트 단계별 스티커 슬롯 (0~3단계)
const SLOTS = [5, 15, 30, 60]

function hasSlot(guild: any): boolean | undefined {
    const used = getStickersStore()?.getStickersByGuildId?.(guild.id)?.length
    if (used == null) return undefined
    return used < (SLOTS[guild.premiumTier ?? 0] ?? 5)
}

function upload(s: StickerItem, guild: any) {
    LazyActionSheet.hideActionSheet()
    showToast(`Adding to ${guild.name}…`)
    uploadSticker(s, guild.id).then(err =>
        showToast(err ?? `Added ${s.name} to ${guild.name}`, getAssetIDByName(err ? 'Small' : 'Check')),
    )
}

function GuildRow({ guild, sticker }: { guild: any; sticker: StickerItem }) {
    const icon = getGuildIcon()
    const slot = React.useMemo(() => hasSlot(guild), [])
    return (
        <FormRow
            leading={icon?.default ? <icon.default guild={guild} size={icon.GuildIconSizes?.MEDIUM} animate={false} /> : undefined}
            disabled={slot === false}
            label={guild.name}
            subLabel={slot === false ? 'No slots available' : undefined}
            trailing={<FormIcon style={{ opacity: 1 }} source={getAssetIDByName('ic_add_24px')} />}
            onPress={() => upload(sticker, guild)}
        />
    )
}

function AddToServer({ sticker }: { sticker: StickerItem }) {
    const guilds = uploadableGuilds()
    const TitleHeader = getTitleHeader()
    const CloseButton = getCloseButton()
    const FlatList = getFlatList()
    return (
        <>
            {TitleHeader && (
                <TitleHeader
                    title={`Stealing ${sticker.name}`}
                    leading={<FormIcon style={{ marginRight: 12, opacity: 1 }} source={{ uri: stickerUrl(sticker) }} disableColor />}
                    trailing={CloseButton ? <CloseButton onPress={() => LazyActionSheet.hideActionSheet()} /> : undefined}
                />
            )}
            {guilds.length === 0 ? (
                <FormRow label='You have no servers where you can add stickers' />
            ) : FlatList ? (
                <FlatList
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    data={guilds}
                    renderItem={({ item }: any) => <GuildRow guild={item} sticker={sticker} />}
                    ItemSeparatorComponent={FormDivider}
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
    const element = (
        <ActionSheet scrollable>
            <ErrorBoundary>
                <AddToServer sticker={sticker} />
            </ErrorBoundary>
        </ActionSheet>
    )
    LazyActionSheet.openLazy(Promise.resolve({ default: () => element }), 'StealStickerAddToServer')
}
