import SettingsPage from './Settings'
import { installGateway } from './gateway'
import { installRest } from './rest'
import { ctx, DEFAULT_SETTINGS, type Settings } from './state'

export default plugin<{ jsonStorage: Settings }>({
    jsonStorage: {
        load: true,
        default: DEFAULT_SETTINGS,
    },
    // 앱 시작 시 게이트웨이가 IDENTIFY를 보내기 전에 걸어야 하므로 start가 아닌 init에서 패치
    init({ cleanup, jsonStorage, logger }) {
        ctx.storage = jsonStorage
        ctx.logger = logger
        installRest(cleanup)
        installGateway(cleanup)
    },
    SettingsComponent: SettingsPage,
})
