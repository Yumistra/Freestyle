import SettingsPage from './Settings'
import { activate, deactivate } from './boot'
import { shouldPatch } from './guard'
import { initStorage, log } from './state'

export default {
    onLoad() {
        initStorage()
        // 지난 부팅이 멈췄거나 봇 모드가 꺼져 있으면 아무 패치도 걸지 않는다
        if (!shouldPatch()) return
        try {
            activate()
        } catch (e) {
            log('error', `로드 실패: ${(e as Error)?.stack ?? e}`)
        }
    },
    onUnload() {
        deactivate()
    },
    settings: SettingsPage,
}
