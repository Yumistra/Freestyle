/**
 * 애니메이션 종류 정의.
 *
 * 효과는 "숨은 상태"(hidden)만 적는다. 보이는 상태는 항상 원래 모습(투명도 1, 이동 0, 크기 1, 회전 0)이고,
 * 나타날 땐 hidden → 원래 모습, 사라질 땐 그 반대로 움직인다.
 * 화면 전환은 아래에 깔리는 화면이 어떻게 변하는지(under)와 어둡게 덮는 정도(dim)도 적을 수 있다.
 */

export type ModuleKey = 'stack' | 'push' | 'modal' | 'sheet' | 'menu' | 'alert' | 'toast'

export interface Hidden {
    /** 투명도 */
    o?: number
    /** 이동(px) */
    tx?: number
    ty?: number
    /** 이동(너비·높이 비율) */
    txW?: number
    tyH?: number
    /** 크기 / 세로 크기 */
    s?: number
    sy?: number
    /** 회전(도) / X축 뒤집기(도) / Y축 뒤집기(도) */
    r?: number
    rx?: number
    ry?: number
    /** 팝업 메뉴: 누른 위치 쪽 모서리를 기준으로 커지고 작아짐 */
    anchor?: boolean
    /** 토스트: 화면 가장자리 밖에서 들어옴 */
    edge?: boolean
}

export interface Effect {
    id: string
    label: string
    hidden?: Hidden
    under?: Hidden
    dim?: number
    /** 뒤로 가기 스와이프 방향 */
    gesture?: 'horizontal' | 'vertical'
}

export const DEFAULT_ID = 'default'

export const NORMAL: Required<Omit<Hidden, 'anchor' | 'edge'>> = { o: 1, tx: 0, ty: 0, txW: 0, tyH: 0, s: 1, sy: 1, r: 0, rx: 0, ry: 0 }

export function normalize(h: Hidden | undefined) {
    return { ...NORMAL, anchor: false, edge: false, ...(h ?? {}) }
}

// ── 설정·메뉴 화면 (디스코드 안쪽 화면 전환) ─────────────────────────────
export const STACK_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'slip', label: '슬립', hidden: { o: 0, txW: 0.25 }, under: { txW: -0.08 } },
    { id: 'slide', label: '슬라이드', hidden: { txW: 1 }, under: { txW: -0.3 }, dim: 0.25 },
    { id: 'drawer', label: '서랍', hidden: { txW: 1 }, under: { s: 0.9, o: 0.5 }, dim: 0.35 },
    { id: 'fade', label: '페이드', hidden: { o: 0 } },
    { id: 'scale', label: '확대', hidden: { o: 0, s: 0.86 }, under: { s: 1.06, o: 0 } },
    { id: 'zoom', label: '줌', hidden: { o: 0, s: 1.18 }, under: { s: 0.9, o: 0 } },
    { id: 'slideUp', label: '아래에서', hidden: { tyH: 1 }, under: { s: 0.94 }, dim: 0.3, gesture: 'vertical' },
    { id: 'rise', label: '떠오르기', hidden: { o: 0, tyH: 0.12 }, under: { o: 0.4 }, gesture: 'vertical' },
    { id: 'flip', label: '플립', hidden: { o: 0, ry: 75 }, under: { o: 0, ry: -75 } },
    { id: 'rotate', label: '회전', hidden: { o: 0, r: 10, tyH: 0.12, s: 0.92 }, under: { o: 0.3, s: 0.96 } },
    { id: 'none', label: '없음' },
]

// ── 큰 화면 (채널·프로필 등, 안드로이드 네이티브 전환) ──────────────────────
// id가 react-native-screens 의 stackAnimation 값 그대로다. hidden/under는 미리보기용 근사치
export const NATIVE_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'fade', label: '페이드', hidden: { o: 0 } },
    { id: 'fade_from_bottom', label: '페이드 위로', hidden: { o: 0, tyH: 0.08 } },
    { id: 'slide_from_right', label: '오른쪽에서', hidden: { txW: 1 }, under: { txW: -1 } },
    { id: 'slide_from_left', label: '왼쪽에서', hidden: { txW: -1 }, under: { txW: 1 } },
    { id: 'slide_from_bottom', label: '아래에서', hidden: { tyH: 1 } },
    { id: 'ios_from_right', label: 'iOS 오른쪽', hidden: { txW: 1 }, under: { txW: -0.3 }, dim: 0.2 },
    { id: 'ios_from_left', label: 'iOS 왼쪽', hidden: { txW: -1 }, under: { txW: 0.3 }, dim: 0.2 },
    { id: 'none', label: '없음' },
]

// ── 아래 창 (길게 눌러 뜨는 액션시트) ───────────────────────────────────
export const SHEET_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'custom', label: '직접 설정', hidden: { tyH: 1 } },
]

// ── 팝업 메뉴 (⋯ 메뉴) ────────────────────────────────────────────
export const MENU_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'pop', label: '톡', hidden: { o: 0, s: 0.05, anchor: true } },
    { id: 'corner', label: '모서리에서', hidden: { o: 0, s: 0.5, anchor: true } },
    { id: 'drop', label: '펼치기', hidden: { o: 0, sy: 0.2, anchor: true } },
    { id: 'slide', label: '미끄러짐', hidden: { o: 0, ty: -18 } },
    { id: 'fade', label: '페이드', hidden: { o: 0 } },
    { id: 'flip', label: '플립', hidden: { o: 0, rx: -80, anchor: true, s: 0.9 } },
]

// ── 확인창 (가운데 뜨는 알림창) ─────────────────────────────────────
export const ALERT_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'zoom', label: '확대', hidden: { o: 0, s: 0.7, ty: 50 } },
    { id: 'pop', label: '톡', hidden: { o: 0, s: 0.05 } },
    { id: 'shrink', label: '축소', hidden: { o: 0, s: 1.3 } },
    { id: 'fade', label: '페이드', hidden: { o: 0 } },
    { id: 'slideUp', label: '아래에서', hidden: { o: 0, tyH: 0.55 } },
    { id: 'slideDown', label: '위에서', hidden: { o: 0, tyH: -0.55 } },
    { id: 'side', label: '옆에서', hidden: { o: 0, txW: 1 } },
    { id: 'flip', label: '플립', hidden: { o: 0, rx: 80, s: 0.9 } },
    { id: 'rotate', label: '회전', hidden: { o: 0, r: -14, s: 0.6 } },
]

// ── 토스트 (화면 위아래 작은 알림) ─────────────────────────────────────
export const TOAST_EFFECTS: Effect[] = [
    { id: 'default', label: '기본' },
    { id: 'slide', label: '밀려오기', hidden: { o: 0, edge: true } },
    { id: 'drop', label: '떨어지기', hidden: { o: 0, edge: true, ty: 36, s: 0.9 } },
    { id: 'pop', label: '톡', hidden: { o: 0, s: 0.05 } },
    { id: 'zoom', label: '확대', hidden: { o: 0, s: 0.6 } },
    { id: 'fade', label: '페이드', hidden: { o: 0 } },
    { id: 'side', label: '옆에서', hidden: { o: 0, txW: -1 } },
    { id: 'flip', label: '플립', hidden: { o: 0, rx: 90 } },
]

export const EFFECTS: Record<ModuleKey, Effect[]> = {
    stack: STACK_EFFECTS,
    push: NATIVE_EFFECTS,
    modal: NATIVE_EFFECTS,
    sheet: SHEET_EFFECTS,
    menu: MENU_EFFECTS,
    alert: ALERT_EFFECTS,
    toast: TOAST_EFFECTS,
}

export const effectOf = (module: ModuleKey, id: string): Effect => EFFECTS[module].find(e => e.id === id) ?? EFFECTS[module][0]

/** 미리보기에서 "기본"을 보여 줄 때 쓰는 디스코드 기본 동작의 근사치 */
export const DEFAULT_PREVIEW: Record<ModuleKey, { effect: string; duration: number; easing: EasingKey }> = {
    stack: { effect: 'slide', duration: 350, easing: 'out' },
    push: { effect: 'fade_from_bottom', duration: 300, easing: 'out' },
    modal: { effect: 'slide_from_bottom', duration: 350, easing: 'out' },
    sheet: { effect: 'custom', duration: 400, easing: 'out' },
    menu: { effect: 'corner', duration: 250, easing: 'out' },
    alert: { effect: 'zoom', duration: 400, easing: 'spring' },
    toast: { effect: 'slide', duration: 250, easing: 'linear' },
}

// ── 움직임(가속 곡선) ────────────────────────────────────────────
export type EasingKey = 'out' | 'expo' | 'smooth' | 'linear' | 'back' | 'bounce' | 'elastic' | 'spring'

export const EASINGS: Array<{ id: EasingKey; label: string }> = [
    { id: 'out', label: '감속' },
    { id: 'expo', label: '빠르게' },
    { id: 'smooth', label: '부드럽게' },
    { id: 'linear', label: '일정하게' },
    { id: 'back', label: '살짝 튕김' },
    { id: 'spring', label: '스프링' },
    { id: 'bounce', label: '통통' },
    { id: 'elastic', label: '고무줄' },
]

/** Easing 모듈(react-native 또는 reanimated)로 곡선 함수를 만든다. 두 라이브러리 API가 같다 */
export function easingFrom(E: any, key: EasingKey) {
    switch (key) {
        case 'linear':
            return E.linear
        case 'smooth':
            return E.inOut(E.cubic)
        case 'expo':
            return E.out(E.exp)
        case 'back':
            return E.out(E.back(1.7))
        case 'bounce':
            return E.out(E.bounce)
        case 'elastic':
            return E.out(E.elastic(1.1))
        default:
            return E.out(E.cubic)
    }
}

/**
 * 시간(ms)에 맞춰 멈추는 물리 스프링 값. 감쇠비 zeta가 작을수록 더 출렁인다.
 * 스프링은 대략 4 / (zeta * omega) 초 뒤에 멈춘다.
 */
export function springFor(duration: number, zeta = 0.55) {
    const t = Math.max(0.08, duration / 1000)
    const omega = 4 / (zeta * t)
    return {
        mass: 1,
        stiffness: Math.round(omega * omega),
        damping: Math.round(2 * zeta * omega * 100) / 100,
        overshootClamping: false,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
    }
}
