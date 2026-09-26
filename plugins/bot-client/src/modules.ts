import { findByProps, findByStoreName } from '@vendetta/metro'
import { ReactNative } from '@vendetta/metro/common'

export { findByProps, findByStoreName }

export const Flux = findByProps('Store', 'Dispatcher')
export const FluxDispatcher = findByProps('dispatch', 'subscribe', '_actionHandlers') ?? Flux?.Dispatcher

// 유저 클라이언트가 쓰는 스토어들
export const SelectedChannelStore = findByStoreName('SelectedChannelStore')
export const ChannelStore = findByStoreName('ChannelStore')

export const { View, ScrollView } = ReactNative
