import { watchStores } from './folders'
import { patchColumn, patchFolderItems, patchMenus, patchToggle } from './patches'
import { bindStorage, DEFAULTS, report } from './store'
import SettingsPage from './ui/Settings'

/**
 * Server Folders (BetterDiscord ServerFolders 를 Revenge Next 모바일로)
 *  - 연 폴더의 서버를 서버 목록 옆 칸에 (extra column)
 *  - 폴더 아이콘·두 가지 색·닫혔을 때 아이콘·직접 넣은 이미지
 *  - 길게 누르기 메뉴: 폴더 만들기·넣기·빼기, 폴더 꾸미기·알림 끄기·자동 읽음·지우기
 *  - 폴더 열고 닫는 규칙 (다른 폴더 닫기, 서버 고르면 닫기 …)
 * 각 부분은 따로 실패해도 나머지는 동작하게 한다.
 */
export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },
    start({ cleanup, jsonStorage }: any) {
        bindStorage(jsonStorage)
        const tryPatch = (name: string, fn: () => any) => {
            try {
                const undo = fn()
                if (typeof undo === 'function') cleanup(undo)
            } catch (e) {
                report(name, e)
            }
        }
        tryPatch('folderItems', () => patchFolderItems(cleanup))
        tryPatch('toggle', () => patchToggle(cleanup))
        tryPatch('column', () => patchColumn(cleanup))
        tryPatch('menus', () => patchMenus(cleanup))
        tryPatch('watch', watchStores)
    },
    SettingsComponent: SettingsPage,
} as any)
