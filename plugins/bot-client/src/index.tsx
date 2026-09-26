import SettingsPage from './Settings'
import { isBotSession, logout } from './auth'
import { initStorage } from './state'

// 안전 모드: 게이트웨이·REST 패치를 전혀 걸지 않는다.
// 봇 세션이 남아 있으면 3초 뒤 로그아웃시켜 로그인 화면으로 돌려보낸다.
let timer: ReturnType<typeof setTimeout> | undefined

export default {
    onLoad() {
        initStorage()
        timer = setTimeout(() => {
            try {
                if (isBotSession()) logout()
            } catch {}
        }, 3000)
    },
    onUnload() {
        if (timer) clearTimeout(timer)
    },
    settings: SettingsPage,
}
