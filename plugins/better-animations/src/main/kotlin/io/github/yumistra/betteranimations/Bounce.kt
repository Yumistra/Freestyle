package io.github.yumistra.betteranimations

import android.animation.ValueAnimator
import android.graphics.Matrix
import android.os.Build
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.EdgeEffect
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sign

/**
 * 채팅 목록 끝에서 iOS 처럼 고무줄로 늘어났다가 튕겨 돌아오기.
 *
 *  - 끌기: 목록이 끝(맨 아래·맨 위)에서 더 끌리면 손가락을 따라가되 멀수록 덜 따라간다 (UIScrollView 의 rubber band:
 *    offset = (1 - 1 / (x * 0.55 / d + 1)) * d, d = 목록 높이). 되돌아 끌면 늘어난 만큼 먼저 줄어든 뒤 스크롤된다.
 *  - 놓기: 임계 감쇠 스프링으로 제자리로.
 *  - 빠르게 스크롤하다 끝에 부딪히면: 그 속도로 살짝 넘어갔다가 돌아온다 (RecyclerView 가 EdgeEffect.onAbsorb 로 알려 준다).
 * 안드로이드의 늘어나는 효과(EdgeEffect)는 채팅 목록에서만 끈다.
 *
 * 움직임은 목록의 animationMatrix(안드로이드 10+)로 그린다. 위치 값(translationY)을 건드리지 않아 디스코드·다른 효과와 겹치지 않는다.
 * 끄는 동안 쓴(늘어나는 데 들어간) 손가락 이동은 터치 좌표에서 빼서 목록이 그만큼 스크롤하지 않게 한다.
 */
internal class Bounce(private val recycler: Recycler, private val enabled: () -> Boolean) {
    val supported = Build.VERSION.SDK_INT >= 29

    private class State {
        /** 끝을 넘어 끈 손가락 거리 (부호: + 위쪽 끝에서 아래로, - 아래쪽 끝에서 위로) */
        var pull = 0f
        /** 지금 그려진 위치 (px) */
        var offset = 0f
        /** 이번 손가락에서 늘어나는 데 쓴 이동량 (터치 좌표에서 뺀다) */
        var shift = 0f
        var lastY = 0f
        var lastTime = -1L
        var lastAction = -1
        var anim: ValueAnimator? = null
    }

    private val states = WeakHashMap<View, State>()
    private val lists = WeakHashMap<View, Boolean>()
    private val owners = WeakHashMap<EdgeEffect, View>()
    private val matrix = Matrix()

    /** RecyclerView 의 EdgeEffect 필드들 (위·아래·왼쪽·오른쪽 빛) */
    private val edgeFields: List<Field> by lazy {
        val out = ArrayList<Field>()
        var c: Class<*>? = recycler.rv
        while (c != null && c != ViewGroup::class.java) {
            for (f in c.declaredFields) {
                if (!Modifier.isStatic(f.modifiers) && f.type == EdgeEffect::class.java) {
                    f.isAccessible = true
                    out.add(f)
                }
            }
            c = c.superclass
        }
        out
    }

    fun register(list: View) {
        if (!supported || lists.containsKey(list)) return
        lists[list] = true
        // 끝에 부딪힌 속도를 받으려면 넘침 효과가 켜져 있어야 한다 (그려지는 건 위에서 막는다)
        if (enabled() && list.overScrollMode == View.OVER_SCROLL_NEVER) list.overScrollMode = View.OVER_SCROLL_ALWAYS
    }

    private fun state(list: View) = states.getOrPut(list) { State() }

    // ── 고무줄 ──────────────────────────────────────────────────────

    private fun rubber(x: Float, d: Float): Float {
        if (d <= 0f) return 0f
        val a = abs(x)
        return sign(x) * (1f - 1f / (a * RUBBER / d + 1f)) * d
    }

    /** rubber 의 반대 (그려진 위치 → 끈 거리) */
    private fun unrubber(o: Float, d: Float): Float {
        if (d <= 0f) return 0f
        val a = min(abs(o), d * 0.98f)
        return sign(o) * (d / RUBBER) * (1f / (1f - a / d) - 1f)
    }

    private fun draw(list: View, s: State, offset: Float) {
        s.offset = offset
        if (abs(offset) < 0.5f) {
            s.offset = 0f
            list.animationMatrix = null
        } else {
            matrix.setTranslate(0f, offset)
            list.animationMatrix = matrix
        }
        list.invalidate()
    }

    private fun stop(s: State) {
        s.anim?.cancel()
        s.anim = null
    }

    /**
     * 임계 감쇠 스프링으로 0 까지 (x0: 시작 위치, v0: 시작 속도 px/s).
     * x(t) = (x0 + (v0 + ω·x0)·t)·e^(−ωt)
     */
    private fun spring(list: View, s: State, x0: Float, v0: Float, omega: Float) {
        stop(s)
        val durationMs = ((SETTLE / omega) * 1000f).toLong().coerceIn(250L, 1500L)
        val a = ValueAnimator.ofFloat(0f, 1f)
        a.duration = durationMs
        a.interpolator = LinearInterpolator()
        a.addUpdateListener {
            if (s.anim !== it) return@addUpdateListener
            val t = it.animatedFraction * durationMs / 1000f
            val x = if (it.animatedFraction >= 1f) 0f else (x0 + (v0 + omega * x0) * t) * exp(-omega * t)
            draw(list, s, x)
            if (it.animatedFraction >= 1f) s.anim = null
        }
        s.anim = a
        a.start()
    }

    // ── 끌기 ────────────────────────────────────────────────────────

    /**
     * 목록이 이 터치를 처리하기 전에 (onInterceptTouchEvent·onTouchEvent 둘 다).
     * 돌려준 만큼 터치 좌표를 옮겼다 (처리 뒤 restore 로 되돌린다)
     */
    fun before(list: ViewGroup, ev: MotionEvent): Float {
        if (!supported || !enabled()) return 0f
        val s = state(list)
        // 같은 터치가 onInterceptTouchEvent → onTouchEvent 로 두 번 올 수 있어서 한 번만 계산
        val action = ev.actionMasked
        val fresh = ev.eventTime != s.lastTime || action != s.lastAction || (action == MotionEvent.ACTION_MOVE && ev.y != s.lastY)
        if (fresh) {
            s.lastTime = ev.eventTime
            s.lastAction = action
            track(list, s, ev)
        }
        // UP 까지 같은 만큼 옮긴다 (속도 계산이 튀지 않게). 다음 DOWN 에서 0 으로
        val shift = s.shift
        if (shift != 0f) ev.offsetLocation(0f, -shift)
        return shift
    }

    fun restore(ev: MotionEvent, shift: Float) {
        if (shift != 0f) ev.offsetLocation(0f, shift)
    }

    private fun track(list: ViewGroup, s: State, ev: MotionEvent) {
        val h = list.height.toFloat()
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                s.shift = 0f
                s.lastY = ev.y
                // 튕기는 중에 잡으면 그 자리에서 이어서 끈다
                if (s.anim != null || s.offset != 0f) {
                    stop(s)
                    s.pull = unrubber(s.offset, h)
                } else {
                    s.pull = 0f
                }
            }
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> s.lastY = ev.y
            MotionEvent.ACTION_MOVE -> {
                val d = ev.y - s.lastY
                s.lastY = ev.y
                if (d == 0f) return
                // 목록이 실제로 끌기를 시작한 뒤에만 (그전엔 눌림·길게 누르기가 그대로 가게)
                if (s.pull == 0f && recycler.scrollState(list) != DRAGGING) return
                var used = 0f
                if (s.pull == 0f) {
                    // 손가락이 내려가면(+) 위쪽 끝, 올라가면(−) 아래쪽 끝
                    val atEdge = if (d > 0f) !list.canScrollVertically(-1) else !list.canScrollVertically(1)
                    if (!atEdge) return
                    s.pull = d
                    used = d
                } else {
                    val next = s.pull + d
                    if (next == 0f || sign(next) == sign(s.pull)) {
                        s.pull = next
                        used = d
                    } else {
                        // 제자리를 지나 반대로: 남는 만큼은 목록이 스크롤한다
                        used = -s.pull
                        s.pull = 0f
                    }
                }
                s.shift += used
                draw(list, s, rubber(s.pull, h))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (s.pull != 0f || s.offset != 0f) {
                    s.pull = 0f
                    spring(list, s, s.offset, 0f, OMEGA_RELEASE)
                }
            }
        }
    }

    // ── 끝에 부딪힘 (EdgeEffect) ───────────────────────────────────────

    /** 이 빛이 채팅 목록 것이면 그 목록 */
    fun ownerOf(e: EdgeEffect): View? {
        if (!supported || lists.isEmpty()) return null
        owners[e]?.let { return it }
        for (list in lists.keys.toList()) {
            for (f in edgeFields) {
                val v = try {
                    f.get(list)
                } catch (t: Throwable) {
                    null
                }
                if (v is EdgeEffect) owners[v] = list
            }
        }
        return owners[e]
    }

    /** 빠르게 스크롤하다 끝에 닿음 (velocity: px/s, 크기만) */
    fun absorb(list: View, velocity: Int) {
        if (!enabled()) return
        val s = state(list)
        if (s.pull != 0f) return
        // 아래쪽 끝이면 내용이 위로(−), 위쪽 끝이면 아래로(+)
        val dir = if (!list.canScrollVertically(1)) -1f else 1f
        val h = list.height.toFloat()
        // 최대로 넘어가는 거리: v / (ω·e). 너무 멀리 가지 않게 높이 비율로 묶는다
        val maxV = MAX_OVERSHOOT * h * OMEGA_ABSORB * E
        val v = min(abs(velocity).toFloat(), maxV)
        if (v < 50f) return
        spring(list, s, s.offset, dir * v, OMEGA_ABSORB)
    }

    /** 설정을 끄거나 플러그인을 멈출 때 */
    fun reset() {
        for ((list, s) in states) {
            stop(s)
            s.pull = 0f
            s.shift = 0f
            try {
                draw(list, s, 0f)
            } catch (t: Throwable) {
            }
        }
    }

    companion object {
        /** UIScrollView 의 고무줄 계수 */
        const val RUBBER = 0.55f
        /** 놓았을 때 돌아오는 스프링 (rad/s). 클수록 빨리 */
        const val OMEGA_RELEASE = 13f
        /** 끝에 부딪혀 튕길 때 */
        const val OMEGA_ABSORB = 10.5f
        /** 거의 멈출 때까지 (ω·t) */
        const val SETTLE = 7f
        /** 부딪혀 넘어가는 최대 거리 (목록 높이 비율) */
        const val MAX_OVERSHOOT = 0.14f
        const val E = 2.7182817f
        const val DRAGGING = 1
    }
}
