/**
 * 폴더 아이콘 모음 (직접 그림). 100×100 안에 그리고, 두 가지 색을 쓴다:
 *  - A: 폴더 몸통 (기본: 폴더 색)
 *  - B: 안쪽·장식 (기본: 흰색)
 * 열린 모양(open)은 폴더를 펼쳤을 때, 닫힌 모양(closed)은 "닫혔을 때도 아이콘" 을 켰을 때 쓴다.
 */

export interface IconSet {
    id: string
    name: string
    open(a: string, b: string): string
    closed(a: string, b: string): string
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`
/** 뒤에 있는 판은 조금 흐리게 (앞판과 구분) */
const BACK = ' opacity=".62"'
const p = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`

// ── 공통 모양 ──────────────────────────────────────────────────────

/** 닫힌 폴더: 탭 + 몸통 */
const CLOSED_BODY = 'M12 26a7 7 0 0 1 7-7h19.5a6 6 0 0 1 4.2 1.8L48 26h33a7 7 0 0 1 7 7v42a7 7 0 0 1-7 7H19a7 7 0 0 1-7-7Z'
/** 닫힌 폴더 앞판 경계 */
const CLOSED_LINE = 'M12 37h76v4.5H12Z'
/** 열린 폴더: 뒤판 */
const OPEN_BACK = 'M12 26a7 7 0 0 1 7-7h19.5a6 6 0 0 1 4.2 1.8L48 26h33a7 7 0 0 1 7 7v9H27.5a9 9 0 0 0-8.6 6.3L12 70Z'
/** 열린 폴더: 꽂힌 종이 */
const OPEN_PAPER = 'M24 31h52a3 3 0 0 1 3 3v8H21v-8a3 3 0 0 1 3-3Z'
/** 열린 폴더: 앞으로 기운 앞판 */
const OPEN_FRONT = 'M27.5 46H91a4.5 4.5 0 0 1 4.3 5.9l-8.6 26.2A8 8 0 0 1 79 84H14.5a4.5 4.5 0 0 1-4.3-5.9l8.7-26.4A8 8 0 0 1 27.5 46Z'

// 앞판 위 장식 (닫힘: 가운데 58, 열림: 가운데 65 쯤)
const star = (cx: number, cy: number, r: number) => {
    let d = ''
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 ? r * 0.45 : r
        d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`
    }
    return d + 'Z'
}
const heart = (cx: number, cy: number, s: number) =>
    `M${cx} ${cy + s * 0.9}C${cx - s * 1.3} ${cy + s * 0.05} ${cx - s * 1.05} ${cy - s * 1.0} ${cx - s * 0.5} ${cy - s * 1.0}C${cx - s * 0.2} ${cy - s * 1.0} ${cx} ${cy - s * 0.75} ${cx} ${cy - s * 0.5}C${cx} ${cy - s * 0.75} ${cx + s * 0.2} ${cy - s * 1.0} ${cx + s * 0.5} ${cy - s * 1.0}C${cx + s * 1.05} ${cy - s * 1.0} ${cx + s * 1.3} ${cy + s * 0.05} ${cx} ${cy + s * 0.9}Z`
const bolt = (cx: number, cy: number, s: number) =>
    `M${cx + s * 0.15} ${cy - s}L${cx - s * 0.6} ${cy + s * 0.15}H${cx - s * 0.05}L${cx - s * 0.2} ${cy + s}L${cx + s * 0.6} ${cy - s * 0.2}H${cx + s * 0.05}Z`
const dot = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`

function withMark(mark: (cx: number, cy: number) => string): Pick<IconSet, 'open' | 'closed'> {
    return {
        closed: (a, b) => svg(p(CLOSED_BODY, a) + p(mark(50, 61), b)),
        open: (a, b) => svg(p(OPEN_BACK, a, BACK) + p(OPEN_PAPER, b) + p(OPEN_FRONT, a) + p(mark(53, 65), b)),
    }
}

export const ICONS: IconSet[] = [
    {
        id: 'classic',
        name: 'Classic',
        closed: (a, b) => svg(p(CLOSED_BODY, a) + p(CLOSED_LINE, b, ' opacity=".9"')),
        open: (a, b) => svg(p(OPEN_BACK, a, BACK) + p(OPEN_PAPER, b) + p(OPEN_FRONT, a)),
    },
    {
        id: 'soft',
        name: 'Soft',
        closed: (a, b) =>
            svg(p('M10 30a12 12 0 0 1 12-12h14c3.6 0 6.2 1.5 8.4 4.2L48 27h30a12 12 0 0 1 12 12v31a12 12 0 0 1-12 12H22a12 12 0 0 1-12-12Z', a) + p('M30 60h40a5 5 0 0 1 0 10H30a5 5 0 0 1 0-10Z', b)),
        open: (a, b) =>
            svg(
                p('M10 30a12 12 0 0 1 12-12h14c3.6 0 6.2 1.5 8.4 4.2L48 27h30a12 12 0 0 1 12 12v5H30a12 12 0 0 0-11.3 8L10 74Z', a, BACK) +
                    p('M24 33h52a4 4 0 0 1 4 4v8H20v-8a4 4 0 0 1 4-4Z', b) +
                    p('M30 47h59a6 6 0 0 1 5.7 7.9l-6.5 19.8A12 12 0 0 1 76.8 83H17a6 6 0 0 1-5.7-7.9l7.3-20A12 12 0 0 1 30 47Z', a),
            ),
    },
    {
        id: 'box',
        name: 'Box',
        closed: (a, b) =>
            svg(p('M14 24a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v10a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3Z', a) + p('M18 41h64v35a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6Z', a) + p('M40 50h20a4 4 0 0 1 0 8H40a4 4 0 0 1 0-8Z', b)),
        open: (a, b) =>
            svg(
                p('M14 13.5a6 6 0 0 1 7.2-5.9l59 11.4a6 6 0 0 1 4.8 6.7l-1.2 7.6a3 3 0 0 1-3.5 2.5L17.2 24.4a3 3 0 0 1-2.4-3.5Z', a, BACK) +
                    p('M26 38h48v7H26Z', b) +
                    p('M18 45h64v31a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6Z', a) +
                    p('M40 54h20a4 4 0 0 1 0 8H40a4 4 0 0 1 0-8Z', b),
            ),
    },
    {
        id: 'stack',
        name: 'Stack',
        closed: (a, b) =>
            svg(
                p('M22 18a6 6 0 0 1 6-6h14l5 5h29a6 6 0 0 1 6 6v3H22Z', a, ' opacity=".55"') +
                    p('M12 33a7 7 0 0 1 7-7h18l5.5 5.5H81a7 7 0 0 1 7 7V77a7 7 0 0 1-7 7H19a7 7 0 0 1-7-7Z', a) +
                    p('M12 43h76v4H12Z', b, ' opacity=".9"'),
            ),
        open: (a, b) =>
            svg(
                p('M22 18a6 6 0 0 1 6-6h14l5 5h29a6 6 0 0 1 6 6v3H22Z', a, ' opacity=".55"') +
                    p('M12 33a7 7 0 0 1 7-7h18l5.5 5.5H81a7 7 0 0 1 7 7v8H27a8 8 0 0 0-7.6 5.5L12 73Z', a, BACK) +
                    p('M24 37h52a3 3 0 0 1 3 3v7H21v-7a3 3 0 0 1 3-3Z', b) +
                    p('M27 50h64a4.5 4.5 0 0 1 4.3 5.9l-7.4 22.4A8 8 0 0 1 80.3 84H14.5a4.5 4.5 0 0 1-4.3-5.9l7.5-22.6A8 8 0 0 1 27 50Z', a),
            ),
    },
    { id: 'star', name: 'Star', ...withMark((x, y) => star(x, y, 13)) },
    { id: 'heart', name: 'Heart', ...withMark((x, y) => heart(x, y - 1, 12)) },
    { id: 'bolt', name: 'Bolt', ...withMark((x, y) => bolt(x, y, 13)) },
    { id: 'dot', name: 'Dot', ...withMark((x, y) => dot(x, y, 8)) },
    {
        id: 'line',
        name: 'Line',
        closed: (a, b) => svg(p(CLOSED_BODY, b, ` fill-opacity=".14" stroke="${a}" stroke-width="7" stroke-linejoin="round"`) + p('M12 38h76', 'none', ` stroke="${a}" stroke-width="6"`)),
        open: (a, b) =>
            svg(
                p(OPEN_BACK, 'none', ` stroke="${a}" stroke-width="7" stroke-linejoin="round"`) +
                    p(OPEN_FRONT, b, ` fill-opacity=".14" stroke="${a}" stroke-width="7" stroke-linejoin="round"`),
            ),
    },
]

export const iconById = (id: string | undefined) => ICONS.find(i => i.id === id)
