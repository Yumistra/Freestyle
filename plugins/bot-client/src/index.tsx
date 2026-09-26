import SettingsPage from './Settings'
import { installGateway } from './gateway'
import { installRest } from './rest'
import { initStorage, log } from './state'

const unpatches: Array<() => void> = []

export default {
    onLoad() {
        initStorage()
        try {
            installRest(unpatches)
            installGateway(unpatches)
        } catch (e) {
            log('error', `로드 실패: ${(e as Error)?.stack ?? e}`)
        }
    },
    onUnload() {
        for (const u of unpatches.splice(0)) {
            try {
                u()
            } catch {}
        }
    },
    settings: SettingsPage,
}
