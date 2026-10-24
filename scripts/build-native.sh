#!/usr/bin/env bash
# 네이티브(Kotlin) 부분이 있는 플러그인(plugins/<이름>/src/main)을 plugin.jar 로 빌드한다.
# GitHub Actions 에서 돌린다. 토큰 없이 빌드하려고 Revenge API 를 직접 받아 로컬 Maven 에 올린다.
#   결과: plugins/<이름>/build/plugin.jar
set -euo pipefail

XPOSED_REF=24fdc39d57f9b0954375b2efe28ff72ea14bf212   # revenge-mod/revenge-xposed (api 1.1.0)
TEMPLATE_REF=463fdee38bd22eec06bc02d2539e22168d5796fe # revenge-mod/revenge-plugin-template

ROOT=$(pwd)
NATIVES=()
for d in plugins/*/; do
    [ -d "$d/src/main" ] && NATIVES+=("$(basename "$d")")
done
if [ ${#NATIVES[@]} -eq 0 ]; then
    echo "네이티브 플러그인 없음"
    exit 0
fi
echo "네이티브 플러그인: ${NATIVES[*]}"

WORK=${RUNNER_TEMP:-/tmp}/freestyle-native
rm -rf "$WORK" && mkdir -p "$WORK"

fetch() { # <repo> <ref> <dir>
    git init -q "$3"
    git -C "$3" fetch -q --depth 1 "https://github.com/$1" "$2"
    git -C "$3" checkout -q FETCH_HEAD
}

# 1. Revenge API → ~/.m2
fetch revenge-mod/revenge-xposed "$XPOSED_REF" "$WORK/xposed"
(cd "$WORK/xposed" && ./gradlew --no-daemon -q :api:publishToMavenLocal)

# 2. 템플릿에 플러그인 넣기 (예제는 빼고, GitHub Packages 대신 로컬 Maven 사용)
fetch revenge-mod/revenge-plugin-template "$TEMPLATE_REF" "$WORK/tpl"
rm -rf "$WORK/tpl/plugins"/*
python3 - "$WORK/tpl/settings.gradle.kts" <<'EOF'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = re.sub(r'\n\s*// The Revenge plugin API is published to GitHub Packages\.\n\s*maven \{\n.*?\n        \}\n', '\n', s, flags=re.S)
s = s.replace('dependencyResolutionManagement {\n    repositories {\n', 'dependencyResolutionManagement {\n    repositories {\n        mavenLocal()\n', 1)
assert 'mavenLocal()' in s and 'maven.pkg.github.com' not in s, s
open(p, 'w').write(s)
EOF
for n in "${NATIVES[@]}"; do
    mkdir -p "$WORK/tpl/plugins/$n"
    cp "plugins/$n/manifest.json" "$WORK/tpl/plugins/$n/"
    cp -r "plugins/$n/src" "$WORK/tpl/plugins/$n/"
done

# 3. DEX 로 컴파일
FAILED=0
cd "$WORK/tpl"
for n in "${NATIVES[@]}"; do
    LOG="$WORK/$n.log"
    if ./gradlew --no-daemon ":plugins:$n:dexJar" >"$LOG" 2>&1; then
        mkdir -p "$ROOT/plugins/$n/build"
        cp "plugins/$n/build/outputs/plugin/plugin.jar" "$ROOT/plugins/$n/build/plugin.jar"
        echo "✓ $n: plugin.jar"
    else
        FAILED=1
        echo "✗ $n: 빌드 실패"
        # 컴파일 오류를 Actions 주석으로 (실행 요약에서 보인다)
        grep -E '^e: ' "$LOG" | head -20 | while IFS= read -r line; do
            echo "::error title=$n::${line#e: }"
        done
        tail -60 "$LOG"
    fi
done
exit $FAILED
