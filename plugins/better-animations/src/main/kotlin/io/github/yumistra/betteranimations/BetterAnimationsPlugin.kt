@file:JvmName("BetterAnimationsPlugin")

package io.github.yumistra.betteranimations

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.PixelFormat
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewAnimationUtils
import android.view.ViewGroup
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedHelpers
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.lang.reflect.Method
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Better Animations 의 네이티브 부분: 채팅 메시지 애니메이션.
 *
 * 안드로이드 디스코드의 채팅 목록(ChatListView)은 RecyclerView 라 JS 로는 손댈 수 없다.
 *  - 나타날 때: RecyclerView 가 줄을 붙일 때 부르는 dispatchChildAttached 를 후킹해서 그 줄을 움직인다.
 *  - 지워질 때: 레이아웃 중에 "삭제됨" 표시가 붙은 줄이 떨어지면, 떨어지기 전 모습을 RenderNode 로 떠서
 *    목록 위(overlay)에 띄운 채 사라지는 애니메이션을 재생한다.
 *  - 밀리기: 줄이 추가·삭제된 레이아웃 전후의 위치 차이만큼 남은 줄들을 부드럽게 옮긴다.
 *
 * 설정은 JS 쪽이 jsonStorage 로 저장하는 storage.json 의 modules.messages 를 읽는다.
 * 설정을 바꾸면 JS 가 `<id>.reload` 를 부른다.
 */

private const val RECYCLER_VIEW = "androidx.recyclerview.widget.RecyclerView"
private const val VIEW_HOLDER = "androidx.recyclerview.widget.RecyclerView\$ViewHolder"
private const val CHAT_LIST_VIEW = "com.discord.chat.presentation.list.ChatListView"

/** 한 번에 이보다 많이 붙으면 채널을 연(또는 크게 새로 그린) 것으로 본다 */
private const val OPEN_BATCH = 6

// ── 설정 ────────────────────────────────────────────────────────

private data class Config(
    val enabled: Boolean = true,
    val effect: String = "rise",
    val exit: String = "same",
    val direction: String = "auto",
    val position: String = "auto",
    val duration: Long = 320L,
    val easing: String = "out",
    val stagger: Long = 30L,
    val onOpen: Boolean = true,
    val shift: Boolean = true,
    val shiftDuration: Long = 200L,
) {
    val enterOn get() = enabled && hiddenFor(effect) != null
    val exitEffect get() = if (exit.isEmpty() || exit == "same") effect else exit
    val exitOn get() = enabled && hiddenFor(exitEffect) != null
    val shiftOn get() = enabled && shift
}

private fun loadConfig(dir: File): Config {
    val d = Config()
    try {
        val file = File(dir, "storage.json")
        if (!file.isFile) return d
        val root = JSONObject(file.readText())
        val m = root.optJSONObject("modules")?.optJSONObject("messages") ?: JSONObject()
        return Config(
            enabled = root.optBoolean("enabled", d.enabled),
            effect = m.optString("effect", d.effect),
            exit = m.optString("exit", d.exit),
            direction = m.optString("direction", d.direction),
            position = m.optString("position", d.position),
            duration = m.optLong("duration", d.duration).coerceIn(50L, 3000L),
            easing = m.optString("easing", d.easing),
            stagger = m.optLong("stagger", d.stagger).coerceIn(0L, 300L),
            onOpen = m.optBoolean("onOpen", d.onOpen),
            shift = m.optBoolean("shift", d.shift),
            shiftDuration = m.optLong("shiftDuration", d.shiftDuration).coerceIn(50L, 2000L),
        )
    } catch (e: Throwable) {
        return d
    }
}

// ── 효과 ────────────────────────────────────────────────────────

/** 숨은 상태. 보이는 상태는 항상 원래 모습. JS 쪽 MESSAGE_EFFECTS 와 같은 값 */
private class Hidden(
    val alpha: Float = 0f,
    /** dp. 자동 방향이면 화면 아래쪽 줄은 아래에서, 위쪽 줄은 위에서 */
    val dy: Float = 0f,
    /** dp. 양수면 오른쪽에서 */
    val dx: Float = 0f,
    /** 줄 너비 비율 */
    val dxW: Float = 0f,
    val scale: Float = 1f,
    /** 도 */
    val rotation: Float = 0f,
    val rotationX: Float = 0f,
    val rotationY: Float = 0f,
    /** dp, 안드로이드 12 이상 */
    val blur: Float = 0f,
    /** 원형으로 드러나기 */
    val reveal: Boolean = false,
    /** 차례로 나타나는 간격의 최소값 */
    val minStagger: Long = 0L,
)

private fun hiddenFor(effect: String): Hidden? = when (effect) {
    "rise" -> Hidden(dy = 28f)
    "fade" -> Hidden()
    "slip" -> Hidden(dx = 40f)
    "slide" -> Hidden(alpha = 1f, dxW = 1f)
    "side" -> Hidden(dx = -48f)
    "scale" -> Hidden(scale = 0.9f)
    "pop" -> Hidden(scale = 0.6f)
    "point" -> Hidden(scale = 0.2f)
    "drop" -> Hidden(dy = 40f, scale = 0.92f)
    "flip" -> Hidden(rotationX = 70f)
    "blur" -> Hidden(scale = 1.04f, blur = 24f)
    "circle" -> Hidden(reveal = true)
    "outOfBounds" -> Hidden(alpha = 1f, dxW = 0.9f, scale = 1.25f, rotation = 4f)
    "wave" -> Hidden(dy = 22f, rotation = -5f, minStagger = 45L)
    else -> null // default, none
}

/** 방향까지 풀어서 px 로 바꾼 값 */
private class Moves(
    val alpha: Float,
    val dx: Float,
    val dy: Float,
    val scale: Float,
    val rotation: Float,
    val rotationX: Float,
    val rotationY: Float,
    val blur: Float,
    val reveal: Boolean,
)

private fun resolve(h: Hidden, direction: String, fromBelow: Boolean, density: Float, rowWidth: Int): Moves {
    var dx = h.dx * density + h.dxW * rowWidth
    var dy = h.dy * density
    var s = h.scale
    var rx = h.rotationX
    var ry = h.rotationY
    val autoSign = if (fromBelow) 1f else -1f
    when (direction) {
        "up", "down", "left", "right" -> {
            val flip = (rx != 0f || ry != 0f) && dx == 0f && dy == 0f
            if (flip) {
                val m = max(abs(rx), abs(ry))
                rx = when (direction) { "up" -> m; "down" -> -m; else -> 0f }
                ry = when (direction) { "left" -> -m; "right" -> m; else -> 0f }
            } else {
                val m = max(abs(dx), abs(dy)).takeIf { it > 0f } ?: (30f * density)
                // "위로" 나타나려면 아래(+)에서 출발
                val sign = if (direction == "up" || direction == "left") 1f else -1f
                if (direction == "up" || direction == "down") {
                    dy = sign * m
                    dx = 0f
                } else {
                    dx = sign * m
                    dy = 0f
                }
            }
        }
        else -> {
            if (direction == "toward" || direction == "away") {
                val d = abs(1f - s).takeIf { it > 0f } ?: 0.15f
                s = if (direction == "toward") max(0.01f, 1f - d) else 1f + d
            }
            dy *= autoSign
            rx *= autoSign
        }
    }
    return Moves(h.alpha, dx, dy, s, h.rotation, rx, ry, h.blur * density, h.reveal)
}

/** 위치 설정 → 기준점 (줄 크기 비율). null 이면 가운데 그대로 */
internal fun pivotOf(position: String): Pair<Float, Float>? = when (position) {
    "tl" -> 0f to 0f
    "t" -> 0.5f to 0f
    "tr" -> 1f to 0f
    "l" -> 0f to 0.5f
    "c" -> 0.5f to 0.5f
    "r" -> 1f to 0.5f
    "bl" -> 0f to 1f
    "b" -> 0.5f to 1f
    "br" -> 1f to 1f
    else -> null
}

// ── 움직임(가속 곡선). JS 의 easingFrom 과 같은 모양 ──────────────────────

private fun bounceOut(t: Float): Float {
    val n = 7.5625f
    return when {
        t < 1f / 2.75f -> n * t * t
        t < 2f / 2.75f -> { val u = t - 1.5f / 2.75f; n * u * u + 0.75f }
        t < 2.5f / 2.75f -> { val u = t - 2.25f / 2.75f; n * u * u + 0.9375f }
        else -> { val u = t - 2.625f / 2.75f; n * u * u + 0.984375f }
    }
}

/** react-native Easing.elastic (끝에서 출렁이는 모양) */
private fun elasticOut(b: Float) = { t: Float -> (1.0 - cos(t * PI / 2).pow(3) * cos(t * b * PI)).toFloat() }

private fun styleIn(style: String): (Float) -> Float = when (style) {
    "sine" -> { t -> (1.0 - cos(t * PI / 2)).toFloat() }
    "quad" -> { t -> t * t }
    "quart" -> { t -> t * t * t * t }
    "quint" -> { t -> t * t * t * t * t }
    "circ" -> { t -> (1.0 - sqrt(max(0.0, 1.0 - t * t))).toFloat() }
    "expo" -> { t -> if (t <= 0f) 0f else 2.0.pow(10.0 * (t - 1)).toFloat() }
    "bounce" -> { t -> 1f - bounceOut(1f - t) }
    else -> { t -> t * t * t }
}

private fun wrap(bezier: String, f: (Float) -> Float): (Float) -> Float = when (bezier) {
    "in" -> f
    "inOut" -> { t -> if (t < 0.5f) f(t * 2f) / 2f else 1f - f((1f - t) * 2f) / 2f }
    else -> { t -> 1f - f(1f - t) }
}

private fun back(s: Float): (Float) -> Float = { t -> t * t * ((s + 1f) * t - s) }

private fun damped(decay: Double, freq: Double): (Float) -> Float = { t -> (1.0 - exp(-decay * t) * cos(freq * t)).toFloat() }

private fun curveFor(easing: String): (Float) -> Float {
    if (easing.startsWith("c:")) {
        val p = easing.split(':')
        val type = p.getOrNull(1) ?: "ease"
        val bezier = p.getOrNull(2) ?: "out"
        val style = p.getOrNull(3) ?: "cubic"
        val amount = p.getOrNull(4)?.toFloatOrNull() ?: 1f
        return when (type) {
            "linear" -> { t -> t }
            "steps" -> {
                val n = max(1, Math.round(amount))
                return { t -> floor(t * n) / n }
            }
            "back" -> wrap(bezier, back(amount))
            "elastic" -> {
                val out = elasticOut(amount)
                wrap(bezier) { t -> 1f - out(1f - t) }
            }
            else -> wrap(bezier, styleIn(style))
        }
    }
    return when (easing) {
        "linear" -> { t -> t }
        "smooth" -> wrap("inOut", styleIn("cubic"))
        "expo" -> wrap("out", styleIn("expo"))
        "back" -> wrap("out", back(1.7f))
        "bounce" -> ::bounceOut
        "elastic" -> elasticOut(1.1f)
        "spring" -> damped(6.0, 12.0)
        else -> wrap("out", styleIn("cubic"))
    }
}

internal fun interpolatorFor(easing: String): TimeInterpolator {
    val f = curveFor(easing)
    return TimeInterpolator { t -> if (t >= 1f) 1f else f(t) }
}

private val SMOOTH = interpolatorFor("c:ease:inOut:quad:1")

// ── 안드로이드 버전별 도우미 ─────────────────────────────────────────

/** 블러 (안드로이드 12 이상) */
private object Blur {
    val supported = Build.VERSION.SDK_INT >= 31
    private val applied = WeakHashMap<View, Boolean>()

    fun set(view: View, radius: Float) {
        if (!supported) return
        if (radius < 0.5f) {
            clear(view)
            return
        }
        view.setRenderEffect(RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
        applied[view] = true
    }

    fun clear(view: View) {
        if (!supported) return
        if (applied.remove(view) != null) view.setRenderEffect(null)
    }

    fun node(node: RenderNode, radius: Float) {
        if (!supported) return
        node.setRenderEffect(if (radius < 0.5f) null else RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP))
    }
}

/** 지워진 줄의 떨어지기 전 모습 (안드로이드 10 이상) */
private class Snapshot(
    val node: RenderNode,
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
    val alpha: Float,
    val translationX: Float,
    val translationY: Float,
    val scale: Float,
) {
    fun discard() = node.discardDisplayList()

    companion object {
        val supported = Build.VERSION.SDK_INT >= 29

        fun of(view: View): Snapshot? {
            if (!supported || view.width <= 0 || view.height <= 0) return null
            val node = RenderNode("BetterAnimationsGhost")
            node.setPosition(view.left, view.top, view.right, view.bottom)
            val canvas = node.beginRecording(view.width, view.height)
            try {
                view.draw(canvas)
            } finally {
                node.endRecording()
            }
            node.setAlpha(view.alpha)
            node.setTranslationX(view.translationX)
            node.setTranslationY(view.translationY)
            node.setScaleX(view.scaleX)
            node.setScaleY(view.scaleY)
            return Snapshot(node, view.left, view.top, view.width, view.height, view.alpha, view.translationX, view.translationY, view.scaleX)
        }
    }
}

private class GhostDrawable(private val node: RenderNode) : Drawable() {
    override fun draw(canvas: Canvas) {
        if (canvas.isHardwareAccelerated) canvas.drawRenderNode(node)
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
}

// ── 줄 애니메이션 ─────────────────────────────────────────────────

private class Rows(private val config: () -> Config, private val holderOf: (ViewGroup, View) -> Boolean) {
    private val running = WeakHashMap<View, Animator>()
    private val reveals = WeakHashMap<View, Animator>()
    private val pending = WeakHashMap<View, Runnable>()
    private val shifting = WeakHashMap<View, ValueAnimator>()

    // 같은 순간에 붙은 줄 묶음
    private var batchStart = 0L
    private val batch = ArrayList<WeakReference<View>>()
    private var batchSkipped = false

    // 레이아웃 한 번 동안의 기록
    private var layingOut: ViewGroup? = null
    private val tops = HashMap<View, Int>()
    private var attachedInPass = 0
    private var removedInPass = 0
    private val snapshots = ArrayList<Snapshot>()

    fun onAttached(parent: ViewGroup, child: View) {
        if (layingOut === parent) attachedInPass++
        reset(child)
        val c = config()
        if (!c.enterOn) return
        val hidden = hiddenFor(c.effect) ?: return

        val now = SystemClock.uptimeMillis()
        if (now - batchStart > 48L) {
            batchStart = now
            batch.clear()
            batchSkipped = false
        }
        if (batchSkipped) return
        batch.add(WeakReference(child))
        if (!c.onOpen && batch.size > OPEN_BATCH) {
            // 채널을 연 것: 아직 그려지기 전이니 숨긴 줄들을 바로 되돌린다
            batchSkipped = true
            for (ref in batch) ref.get()?.let(::reset)
            batch.clear()
            return
        }
        val stagger = max(c.stagger, hidden.minStagger)
        val delay = ((batch.size - 1) * stagger).coerceAtMost(stagger * 12L)

        // 레이아웃 전이라 위치를 모른다. 먼저 숨겨 두고, 다음 프레임에 방향을 정해 시작한다
        child.alpha = hidden.alpha
        child.scaleX = hidden.scale
        child.scaleY = hidden.scale
        if (hidden.blur > 0f) Blur.set(child, hidden.blur * child.resources.displayMetrics.density)

        val start = Runnable {
            pending.remove(child)
            try {
                startEnter(parent, child, c, hidden, delay)
            } catch (e: Throwable) {
                reset(child)
            }
        }
        pending[child] = start
        child.post(start)
    }

    private fun startEnter(parent: ViewGroup, child: View, c: Config, hidden: Hidden, delay: Long) {
        val fromBelow = child.top + child.height / 2 >= parent.height / 2
        val density = child.resources.displayMetrics.density
        val m = resolve(hidden, c.direction, fromBelow, density, child.width)
        pivotOf(c.position)?.let { (px, py) ->
            child.pivotX = child.width * px
            child.pivotY = child.height * py
        }
        val interpolator = interpolatorFor(c.easing)

        val animator = ValueAnimator.ofFloat(0f, 1f)
        animator.duration = c.duration
        animator.startDelay = delay
        animator.interpolator = interpolator
        animator.addUpdateListener { a -> frame(child, m, a.animatedValue as Float, a.animatedFraction, true) }
        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                if (running[child] === animation) {
                    running.remove(child)
                    clear(child)
                }
            }
        })
        frame(child, m, 0f, 0f, false)
        running[child] = animator
        animator.start()

        if (m.reveal && child.isAttachedToWindow && child.width > 0 && child.height > 0) {
            val (px, py) = pivotOf(c.position) ?: (0.5f to 0.5f)
            val cx = (child.width * px).toInt()
            val cy = (child.height * py).toInt()
            val radius = hypot(max(cx, child.width - cx).toFloat(), max(cy, child.height - cy).toFloat())
            val reveal = ViewAnimationUtils.createCircularReveal(child, cx, cy, 0f, radius)
            reveal.duration = c.duration
            reveal.startDelay = delay
            reveal.interpolator = interpolator
            reveals[child] = reveal
            reveal.start()
        }
    }

    /** p: 곡선을 거친 진행도(튕길 수 있음), f: 시간 비율 */
    private fun frame(child: View, m: Moves, p: Float, f: Float, started: Boolean) {
        val q = 1f - p
        child.alpha = when {
            m.reveal -> if (started) 1f else 0f
            // 투명도는 튕기지 않게 시간 비율로 0~1 사이에서
            else -> (m.alpha + (1f - m.alpha) * min(1f, f * 1.4f)).coerceIn(0f, 1f)
        }
        child.translationX = m.dx * q
        child.translationY = m.dy * q
        val s = m.scale + (1f - m.scale) * p
        child.scaleX = s
        child.scaleY = s
        child.rotation = m.rotation * q
        child.rotationX = m.rotationX * q
        child.rotationY = m.rotationY * q
        if (m.blur > 0f) Blur.set(child, m.blur * (1f - f))
    }

    // ── 레이아웃 전후 (삭제된 줄, 밀리는 줄) ─────────────────────────────

    fun beforeLayout(parent: ViewGroup) {
        layingOut = parent
        attachedInPass = 0
        removedInPass = 0
        tops.clear()
        if (!config().shiftOn) return
        for (i in 0 until parent.childCount) {
            val child = parent.getChildAt(i)
            if (child.isLaidOut) tops[child] = child.top
        }
    }

    fun afterLayout(parent: ViewGroup) {
        if (layingOut !== parent) return
        layingOut = null
        val c = config()
        val changes = attachedInPass + removedInPass
        // 메시지 몇 개가 추가·삭제됐을 때만 (채널을 열거나 크게 새로 그릴 땐 그대로)
        val small = changes in 1..4
        if (c.shiftOn && small && tops.isNotEmpty()) {
            for (i in 0 until parent.childCount) {
                val child = parent.getChildAt(i)
                val old = tops[child] ?: continue
                val delta = old - child.top
                if (delta == 0 || abs(delta) > parent.height) continue
                if (running.containsKey(child) || pending.containsKey(child)) continue
                startShift(child, delta.toFloat(), c)
            }
        }
        tops.clear()
        if (snapshots.isNotEmpty()) {
            val show = c.exitOn && small && removedInPass in 1..3
            for (snap in snapshots) {
                if (show) {
                    try {
                        startExit(parent, snap, c)
                    } catch (e: Throwable) {
                        snap.discard()
                    }
                } else snap.discard()
            }
            snapshots.clear()
        }
    }

    private fun startShift(child: View, delta: Float, c: Config) {
        val from = child.translationY + delta
        shifting.remove(child)?.cancel()
        child.translationY = from
        val animator = ValueAnimator.ofFloat(0f, 1f)
        animator.duration = c.shiftDuration
        animator.interpolator = SMOOTH
        animator.addUpdateListener { a -> child.translationY = from * (1f - (a.animatedValue as Float)) }
        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                if (shifting[child] === animation) {
                    shifting.remove(child)
                    if (!running.containsKey(child)) child.translationY = 0f
                }
            }
        })
        shifting[child] = animator
        animator.start()
    }

    private fun startExit(parent: ViewGroup, snap: Snapshot, c: Config) {
        val hidden = hiddenFor(c.exitEffect)
        if (hidden == null) {
            snap.discard()
            return
        }
        val density = parent.resources.displayMetrics.density
        val fromBelow = snap.top + snap.height / 2 >= parent.height / 2
        val m = resolve(hidden, c.direction, fromBelow, density, snap.width)
        val node = snap.node
        val (px, py) = pivotOf(c.position) ?: (0.5f to 0.5f)
        node.setPivotX(snap.width * px)
        node.setPivotY(snap.height * py)
        // 원형은 사라질 때 작아지며 흐려지는 것으로
        val endScale = if (m.reveal) 0.6f else m.scale
        val endAlpha = if (m.reveal) 0f else m.alpha

        val ghost = GhostDrawable(node)
        ghost.setBounds(0, 0, max(1, parent.width), max(1, parent.height))
        val overlay = parent.overlay
        overlay.add(ghost)

        val animator = ValueAnimator.ofFloat(0f, 1f)
        animator.duration = c.duration
        animator.interpolator = interpolatorFor(c.easing)
        animator.addUpdateListener { a ->
            val k = a.animatedValue as Float
            val f = a.animatedFraction
            node.setAlpha((snap.alpha + (endAlpha - snap.alpha) * min(1f, f * 1.25f)).coerceIn(0f, 1f))
            node.setTranslationX(snap.translationX + m.dx * k)
            node.setTranslationY(snap.translationY + m.dy * k)
            val s = snap.scale + (endScale - snap.scale) * k
            node.setScaleX(s)
            node.setScaleY(s)
            node.setRotationZ(m.rotation * k)
            node.setRotationX(m.rotationX * k)
            node.setRotationY(m.rotationY * k)
            if (m.blur > 0f) Blur.node(node, m.blur * f)
            ghost.invalidateSelf()
            parent.invalidate()
        }
        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                overlay.remove(ghost)
                snap.discard()
            }
        })
        animator.start()
    }

    fun onDetached(parent: ViewGroup, child: View) {
        if (layingOut === parent && holderOf(parent, child)) {
            removedInPass++
            val c = config()
            if (c.exitOn && snapshots.size < 4 && child.isLaidOut && child.bottom > 0 && child.top < parent.height) {
                try {
                    Snapshot.of(child)?.let(snapshots::add)
                } catch (e: Throwable) {
                    // 그리기에 실패하면 이 줄은 효과 없이
                }
            }
        }
        reset(child)
    }

    /** 다시 쓰이는 줄이 숨은 채로 남지 않게 원래 모습으로 */
    fun reset(child: View) {
        pending.remove(child)?.let { child.removeCallbacks(it) }
        running.remove(child)?.cancel()
        reveals.remove(child)?.cancel()
        shifting.remove(child)?.cancel()
        clear(child)
    }

    private fun clear(child: View) {
        child.alpha = 1f
        child.translationX = 0f
        child.translationY = 0f
        child.scaleX = 1f
        child.scaleY = 1f
        child.rotation = 0f
        child.rotationX = 0f
        child.rotationY = 0f
        Blur.clear(child)
        if (Build.VERSION.SDK_INT >= 28 && child.isPivotSet) child.resetPivot()
    }
}

// ── 플러그인 ──────────────────────────────────────────────────────

@Suppress("UNUSED")
val betterAnimationsPlugin = plugin {
    var unhooks = emptyList<XC_MethodHook.Unhook>()

    start {
        // 설정은 JS 쪽 스레드에서 다시 읽고, 메인 스레드에서 쓴다
        val config = AtomicReference(loadConfig(storageDir))

        val recyclerView = XposedHelpers.findClass(RECYCLER_VIEW, classLoader)
        val chatListView = XposedHelpers.findClass(CHAT_LIST_VIEW, classLoader)
        val getHolder: Method = recyclerView.getMethod("getChildViewHolder", View::class.java)
        val isRemoved: Method? = try {
            XposedHelpers.findClass(VIEW_HOLDER, classLoader).getDeclaredMethod("isRemoved").apply { isAccessible = true }
        } catch (e: Throwable) {
            log.w("ViewHolder.isRemoved not found; exit animations disabled")
            null
        }
        val removedHolder = { parent: ViewGroup, child: View ->
            try {
                val holder = getHolder.invoke(parent, child)
                holder != null && isRemoved?.invoke(holder) == true
            } catch (e: Throwable) {
                false
            }
        }
        val rows = Rows({ config.get() }, removedHolder)

        fun chat(param: XC_MethodHook.MethodHookParam): ViewGroup? =
            param.thisObject.takeIf { chatListView.isInstance(it) } as? ViewGroup

        unhooks = listOf(
            XposedHelpers.findAndHookMethod(
                recyclerView,
                "dispatchChildAttached",
                View::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val parent = chat(param) ?: return
                        val child = param.args[0] as? View ?: return
                        try {
                            rows.onAttached(parent, child)
                        } catch (e: Throwable) {
                            log.e("Failed to animate row", e)
                        }
                    }
                },
            ),
            XposedHelpers.findAndHookMethod(
                recyclerView,
                "dispatchChildDetached",
                View::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val parent = chat(param) ?: return
                        val child = param.args[0] as? View ?: return
                        try {
                            rows.onDetached(parent, child)
                        } catch (e: Throwable) {
                            log.e("Failed to handle removed row", e)
                        }
                    }
                },
            ),
            XposedHelpers.findAndHookMethod(
                recyclerView,
                "onLayout",
                java.lang.Boolean.TYPE,
                Integer.TYPE,
                Integer.TYPE,
                Integer.TYPE,
                Integer.TYPE,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val parent = chat(param) ?: return
                        try {
                            rows.beforeLayout(parent)
                        } catch (e: Throwable) {
                            log.e("Failed before layout", e)
                        }
                    }

                    override fun afterHookedMethod(param: MethodHookParam) {
                        val parent = chat(param) ?: return
                        try {
                            rows.afterLayout(parent)
                        } catch (e: Throwable) {
                            log.e("Failed after layout", e)
                        }
                    }
                },
            ),
        )

        // 큰 화면 전환
        val stack = AtomicReference(loadStackConfig(storageDir))
        val appContext = AtomicReference<android.content.Context?>(null)
        withAppContext { appContext.set(it.applicationContext ?: it) }
        val screens = ScreenTransitions(classLoader, { appContext.get() }, { stack.get() })
        val screenHook = try {
            screens.hook()
        } catch (e: Throwable) {
            log.e("Failed to hook screen transitions", e)
            null
        }
        if (screenHook != null) unhooks = unhooks + screenHook else log.w("Screen fragment not found; screen transitions stay in JS")

        // JS 설정 화면이 저장한 뒤 부른다
        registerNativeMethod("${manifest.id}.reload") {
            config.set(loadConfig(storageDir))
            stack.set(loadStackConfig(storageDir))
            true
        }
        // JS 쪽에서 네이티브 부분이 실렸는지, 화면 전환을 맡을 수 있는지 확인할 때
        registerNativeMethod("${manifest.id}.ping") {
            mapOf("pong" to true, "screens" to (screenHook != null), "played" to screens.played)
        }

        log.i("Hooked chat list (effect=${config.get().effect}, exit=${config.get().exitEffect})")
    }

    stop {
        for (unhook in unhooks) unhook.unhook()
        unhooks = emptyList()
    }
}
