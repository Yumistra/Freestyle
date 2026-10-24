@file:JvmName("MessageAnimationsPlugin")

package io.github.yumistra.messageanimations

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.BounceInterpolator
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.view.animation.PathInterpolator
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedHelpers
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod
import org.json.JSONObject
import java.io.File
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.cos
import kotlin.math.exp

/**
 * Message Animations
 *
 * 안드로이드 디스코드의 채팅 목록(ChatListView, RecyclerView)은 네이티브라 JS 로는 손댈 수 없다.
 * RecyclerView 가 새 줄(메시지, 날짜 구분선 등)을 붙일 때 부르는 dispatchChildAttached 를 후킹해서
 * 그 줄이 나타나는 애니메이션을 재생한다. 스크롤로 새로 보이는 줄, 새로 온 메시지, 채널을 열 때 보이는 줄이 모두 해당된다.
 *
 * 설정은 JS 쪽이 jsonStorage 로 저장하는 storage.json 을 읽는다. 설정을 바꾸면 JS 가 `<id>.reload` 를 부른다.
 */

private const val RECYCLER_VIEW = "androidx.recyclerview.widget.RecyclerView"
private const val CHAT_LIST_VIEW = "com.discord.chat.presentation.list.ChatListView"

private data class Config(
    val enabled: Boolean = true,
    val effect: String = "rise",
    val duration: Long = 320L,
    val easing: String = "out",
    /** 한꺼번에 붙은 줄들을 차례로 보여 줄 간격 (ms) */
    val stagger: Long = 30L,
)

private fun loadConfig(dir: File): Config {
    val defaults = Config()
    return try {
        val file = File(dir, "storage.json")
        if (!file.isFile) {
            defaults
        } else {
            val json = JSONObject(file.readText())
            Config(
                enabled = json.optBoolean("enabled", defaults.enabled),
                effect = json.optString("effect", defaults.effect),
                duration = json.optLong("duration", defaults.duration).coerceIn(50L, 2000L),
                easing = json.optString("easing", defaults.easing),
                stagger = json.optLong("stagger", defaults.stagger).coerceIn(0L, 200L),
            )
        }
    } catch (e: Throwable) {
        defaults
    }
}

/** 숨은 상태. 보이는 상태는 항상 원래 모습(투명도 1, 이동 0, 크기 1, 회전 0) */
private class Hidden(
    val alpha: Float = 0f,
    /** dp. 양수면 화면 아래쪽 줄은 아래에서, 위쪽 줄은 위에서 들어온다 */
    val dy: Float = 0f,
    /** dp. 양수면 오른쪽에서 */
    val dx: Float = 0f,
    val scale: Float = 1f,
    /** 도. 방향은 dy 와 같은 규칙 */
    val rotationX: Float = 0f,
)

private fun hiddenFor(effect: String): Hidden? = when (effect) {
    "none" -> null
    "fade" -> Hidden()
    "rise" -> Hidden(dy = 28f)
    "slip" -> Hidden(dx = 40f)
    "side" -> Hidden(dx = -48f)
    "scale" -> Hidden(scale = 0.9f)
    "pop" -> Hidden(scale = 0.6f)
    "drop" -> Hidden(dy = 40f, scale = 0.92f)
    "flip" -> Hidden(rotationX = 70f)
    else -> Hidden(dy = 28f)
}

/** 감쇠 진동. t=1 에서 1 로 끝나게 맞춘다 */
private fun damped(decay: Double, freq: Double) = TimeInterpolator { t ->
    if (t >= 1f) 1f else (1.0 - exp(-decay * t) * cos(freq * t)).toFloat()
}

private fun interpolatorFor(easing: String): TimeInterpolator = when (easing) {
    "linear" -> LinearInterpolator()
    "smooth" -> AccelerateDecelerateInterpolator()
    "expo" -> PathInterpolator(0.16f, 1f, 0.3f, 1f)
    "back" -> OvershootInterpolator(1.6f)
    "bounce" -> BounceInterpolator()
    "spring" -> damped(6.0, 12.0)
    "elastic" -> damped(4.0, 18.0)
    else -> DecelerateInterpolator(1.6f)
}

private class RowAnimations(private val config: () -> Config) {
    private val running = WeakHashMap<View, ValueAnimator>()
    private val pending = WeakHashMap<View, Runnable>()
    private var batchStart = 0L
    private var batchCount = 0

    fun onAttached(parent: ViewGroup, child: View) {
        val c = config()
        reset(child)
        if (!c.enabled) return
        val hidden = hiddenFor(c.effect) ?: return

        // 같은 순간에 붙은 줄들은 조금씩 늦게 시작해서 차례로 나타나게
        val now = SystemClock.uptimeMillis()
        if (now - batchStart > 48L) {
            batchStart = now
            batchCount = 0
        }
        val delay = (batchCount++ * c.stagger).coerceAtMost(c.stagger * 10L)

        // 레이아웃 전이라 위치를 모른다. 먼저 숨겨 두고, 다음 프레임에 방향을 정해 시작한다
        child.alpha = hidden.alpha
        child.scaleX = hidden.scale
        child.scaleY = hidden.scale

        val start = Runnable {
            pending.remove(child)
            val fromBelow = child.top + child.height / 2 >= parent.height / 2
            val sign = if (fromBelow) 1f else -1f
            val density = child.resources.displayMetrics.density
            val dy = hidden.dy * density * sign
            val dx = hidden.dx * density
            val rotationX = hidden.rotationX * sign

            val animator = ValueAnimator.ofFloat(0f, 1f)
            animator.duration = c.duration
            animator.startDelay = delay
            animator.interpolator = interpolatorFor(c.easing)
            animator.addUpdateListener { a ->
                val p = a.animatedValue as Float
                val q = 1f - p
                // 투명도는 튕기지 않게 따로 0~1 로 자른다
                child.alpha = (hidden.alpha + (1f - hidden.alpha) * (a.animatedFraction * 1.4f)).coerceIn(0f, 1f)
                child.translationY = dy * q
                child.translationX = dx * q
                val s = hidden.scale + (1f - hidden.scale) * p
                child.scaleX = s
                child.scaleY = s
                child.rotationX = rotationX * q
            }
            animator.addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (running[child] === animation) running.remove(child)
                    clear(child)
                }

                override fun onAnimationCancel(animation: Animator) {
                    clear(child)
                }
            })
            child.translationY = dy
            child.translationX = dx
            child.rotationX = rotationX
            running[child] = animator
            animator.start()
        }
        pending[child] = start
        child.post(start)
    }

    /** 다시 쓰이는 줄이 숨은 채로 남지 않게 원래 모습으로 */
    fun reset(child: View) {
        pending.remove(child)?.let { child.removeCallbacks(it) }
        running.remove(child)?.cancel()
        clear(child)
    }

    private fun clear(child: View) {
        child.alpha = 1f
        child.translationX = 0f
        child.translationY = 0f
        child.scaleX = 1f
        child.scaleY = 1f
        child.rotationX = 0f
    }
}

@Suppress("UNUSED")
val messageAnimationsPlugin = plugin {
    var unhooks = emptyList<XC_MethodHook.Unhook>()

    start {
        // 설정은 JS 쪽 스레드에서 다시 읽고, 메인 스레드에서 쓴다
        val config = AtomicReference(loadConfig(storageDir))
        val rows = RowAnimations { config.get() }

        val recyclerView = XposedHelpers.findClass(RECYCLER_VIEW, classLoader)
        val chatListView = XposedHelpers.findClass(CHAT_LIST_VIEW, classLoader)

        unhooks = listOf(
            XposedHelpers.findAndHookMethod(
                recyclerView,
                "dispatchChildAttached",
                View::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val parent = param.thisObject
                        if (!chatListView.isInstance(parent)) return
                        val child = param.args[0] as? View ?: return
                        try {
                            rows.onAttached(parent as ViewGroup, child)
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
                        if (!chatListView.isInstance(param.thisObject)) return
                        val child = param.args[0] as? View ?: return
                        try {
                            rows.reset(child)
                        } catch (e: Throwable) {
                            log.e("Failed to reset row", e)
                        }
                    }
                },
            ),
        )

        // JS 설정 화면이 저장한 뒤 부른다
        registerNativeMethod("${manifest.id}.reload") {
            config.set(loadConfig(storageDir))
            true
        }
        // JS 쪽에서 네이티브 부분이 실렸는지 확인할 때
        registerNativeMethod("${manifest.id}.ping") { "pong" }

        log.i("Hooked chat list rows (effect=${config.get().effect})")
    }

    stop {
        for (unhook in unhooks) unhook.unhook()
        unhooks = emptyList()
    }
}
