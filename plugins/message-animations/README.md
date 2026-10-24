# Message Animations (네이티브 플러그인)

채팅에서 메시지가 나타날 때 애니메이션을 넣는 플러그인입니다. 채널을 열 때 보이는 메시지, 스크롤해서 새로 보이는 메시지, 새로 온 메시지에 적용됩니다.

안드로이드 디스코드의 채팅 목록은 JS 가 아니라 네이티브 `RecyclerView`(`ChatListView`)라서, 이 플러그인에는 Kotlin 부분(`plugin.jar`)이 있습니다. Freestyle 의 GitHub Actions 가 `scripts/build-native.sh` 로 함께 빌드해서 저장소에 올리므로, 보통은 **저장소에서 바로 설치**하면 됩니다. 설치하거나 업데이트한 뒤에는 디스코드를 완전히 껐다 켜세요.

- `src/main/kotlin/…/MessageAnimationsPlugin.kt`: 네이티브 부분. `RecyclerView.dispatchChildAttached` 를 후킹해 채팅 줄이 붙을 때 애니메이션을 재생합니다.
- `js/index.tsx`: 설정 화면(효과·속도·움직임·간격 + 미리보기). 저장하면 네이티브에 바로 다시 읽으라고 알립니다.
- 효과: 떠오르기, 페이드, 오른쪽에서, 왼쪽에서, 확대, 톡, 떨어지기, 플립, 없음
- 움직임: 감속, 빠르게, 부드럽게, 일정하게, 살짝 튕김, 스프링, 통통, 고무줄

## 직접 빌드 (PC, 선택)

### 1. 준비물

- **JDK 25 이상**
- **Android SDK**: `build-tools` 와 `platform 36`. Android Studio 를 깔았다면 SDK Manager 에서 설치하면 됩니다.
- **Bun** 또는 **Node.js**
- **Git**

### 2. 템플릿 받기

```sh
git clone https://github.com/revenge-mod/revenge-plugin-template
cd revenge-plugin-template
```

예제 플러그인은 지워도 됩니다 (`plugins/example-*`, `plugins/always-errors`). 남겨 두면 같이 빌드될 뿐입니다.

### 3. 이 폴더 넣기

이 `message-animations` 폴더를 통째로 `plugins/message-animations` 로 복사합니다.

```
revenge-plugin-template/
└── plugins/
    └── message-animations/
        ├── manifest.json
        ├── tsconfig.json
        ├── js/index.tsx
        └── src/main/
            ├── AndroidManifest.xml
            └── kotlin/io/github/yumistra/messageanimations/MessageAnimationsPlugin.kt
```

### 4. SDK 위치 알려 주기

템플릿 폴더에 `local.properties` 를 만들고 SDK 경로를 적습니다. (또는 `ANDROID_HOME` 환경 변수)

```properties
# Windows 예시 (역슬래시는 두 번)
sdk.dir=C\:\\Users\\내이름\\AppData\\Local\\Android\\Sdk
# macOS 예시
# sdk.dir=/Users/내이름/Library/Android/sdk
```

### 5. Revenge API 받을 수 있게 하기 (둘 중 하나)

**A. GitHub 토큰 (쉬움)**
GitHub → Settings → Developer settings → Personal access tokens (classic) 에서 `read:packages` 권한만 있는 토큰을 만들고, `~/.gradle/gradle.properties` (Windows 는 `C:\Users\내이름\.gradle\gradle.properties`) 에 넣습니다.

```properties
GitHubPackagesUsername=Yumistra
GitHubPackagesPassword=ghp_여기에토큰
```

**B. 직접 받아서 로컬에 올리기**

```sh
git clone https://github.com/revenge-mod/revenge-xposed
cd revenge-xposed
./gradlew :api:publishToMavenLocal
```

B 를 쓸 때는 템플릿의 `settings.gradle.kts` 에서 `dependencyResolutionManagement { repositories { … } }` 안 맨 위에 `mavenLocal()` 한 줄을 추가해야 합니다. (템플릿 기본 설정에는 빠져 있습니다)

### 6. 빌드

템플릿 폴더에서:

```sh
./gradlew packageMessageAnimations      # Windows: gradlew.bat packageMessageAnimations
```

결과물: `build/dist/yumistra.message-animations@1.0.0.zip`
ZIP 안에 `manifest.json`, `plugin.jar`, `index.js` 세 개가 있어야 합니다.

### 7. 설치

ZIP 을 폰으로 옮겨서 Revenge 의 플러그인 화면에서 파일로 설치한 뒤, **디스코드를 완전히 껐다 켭니다.** 네이티브 부분은 앱이 시작될 때만 실립니다.

설정 화면 맨 위에 빨간 글씨("네이티브 부분이 실리지 않았어요")가 보이면 `plugin.jar` 가 안 실린 것입니다.

## 빌드 오류가 나면

Kotlin 쪽은 이 환경에서 컴파일해 보지 못했습니다. 오류가 나면 Gradle 출력의 `e: …` 줄을 그대로 보내 주세요. 바로 고치겠습니다.

## 문제가 생기면

- 로그: `adb logcat | grep -i message-animations`
- 끄기: 설정에서 "메시지 애니메이션" 스위치를 끄면 바로 멈춥니다. 플러그인을 비활성화하면 후킹도 풀립니다.
