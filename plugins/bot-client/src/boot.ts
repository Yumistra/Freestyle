import { installUserFixes } from './fixes'
import { installGateway } from './gateway'
import { arm, disposeGuard, installRelaunchReload } from './guard'
import { installRest } from './rest'
import { log } from './state'

const unpatches: Array<() => void> = []
let active = false

/** 봇 패치를 걸고 안전장치를 켠다. 여러 번 불러도 패치는 한 번만 건다 */
export function activate() {
    if (!active) {
        installRest(unpatches)
        installGateway(unpatches)
        installUserFixes(unpatches)
        installRelaunchReload(unpatches)
        active = true
        log('info', '봇 패치 적용')
    }
    arm()
}

export function deactivate() {
    disposeGuard()
    for (const u of unpatches.splice(0)) {
        try {
            u()
        } catch {}
    }
    active = false
}
