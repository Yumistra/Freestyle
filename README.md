# Bot Client (Vendetta/Bunny/Revenge plugin)

봇 토큰으로 Discord에 로그인하고, 내장 API 콘솔로 봇 API를 직접 호출하는 플러그인입니다.

## 설치

플러그인 URL을 Revenge/Bunny/Vendetta의 플러그인 페이지에 붙여넣으세요:

```
https://<GitHub 사용자명>.github.io/<저장소명>/bot-client
```

## 빌드 구조

- `plugins/bot-client/manifest.json` — 이름, 설명, 진입점(`main`)
- `plugins/bot-client/src/` — 소스
- `build.mjs` — rollup 번들러 (Vendetta IIFE 형식)
- `dist/` — 빌드 결과물, GitHub Pages로 배포됨 (커밋하지 않음)

`main`(main 브랜치)에 푸시하면 `.github/workflows/deploy.yml`이 `dist/`를 GitHub Pages에 배포합니다.
