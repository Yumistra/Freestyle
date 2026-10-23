# Freestyle (Revenge Next 플러그인 저장소)

| 플러그인 | ID | 설명 |
| --- | --- | --- |
| Bot Client | `yumistra.bot-client` | 봇 토큰으로 Discord에 로그인하고, 내장 API 콘솔로 봇 API를 직접 호출 |
| Steal Sticker | `yumistra.steal-sticker` | 스티커 창에 Add to Server / Copy URL / Save image 버튼 추가 |
| Plugin Backup | `yumistra.plugin-backup` | 플러그인·저장소·켜짐 상태·설정·데이터 파일(폰트·배경 등)을 백업하고 다시 불러오기 |
| Overlay Background | `yumistra.overlay-background` | 포럼·스레드처럼 채팅 위에 덮이는 화면에도 테마 배경 이미지 표시 |
| Toast Fix | `yumistra.toast-fix` | 옛날(Vendetta) 방식 알림을 띄우는 플러그인 때문에 앱이 튕기는 문제(`position` of undefined) 방지 |

## 설치

Revenge 설정 → 플러그인 → 저장소에 아래 주소를 추가하세요.

```
https://yumistra.github.io/Freestyle
```

ZIP 파일을 직접 받았다면 같은 화면의 **Install from file**로 설치할 수 있습니다.

## 구조

- `plugins/<이름>/manifest.json`: Revenge Next 매니페스트 (format 1). 업데이트를 내보내려면 `version`을 올리세요.
- `plugins/<이름>/src/`: 소스. `@revenge-mod/*`, `react`, `react-native` import는 빌드할 때 `revenge.*` 전역 접근으로 바뀝니다.
- `scripts/build.mjs`: 플러그인 JS 빌드 → `plugins/<이름>/build/js/index.js`
- `scripts/package.mjs`: `dist/pool/<id>@<version>.zip` + `dist/index.json` 생성
- `legacy/`: 옛 Vendetta/Bunny 형식 플러그인 (Revenge Next에서는 동작하지 않음, 빌드하지 않음)

```sh
npm install
npm run build
npm run package -- --base-url https://yumistra.github.io/Freestyle
```

`main`에 푸시하면 GitHub Actions가 빌드해서 `dist/`를 GitHub Pages에 배포합니다.
