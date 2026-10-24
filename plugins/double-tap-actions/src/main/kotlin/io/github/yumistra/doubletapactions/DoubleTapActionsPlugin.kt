@file:JvmName("DoubleTapActionsPlugin")

package io.github.yumistra.doubletapactions

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedHelpers
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeAsyncMethod
import io.github.revenge.xposed.api.registerNativeMethod
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

/**
 * Double Tap Actions 의 네이티브 부분: 메시지 바로 밑에 버튼 띄우기.
 *
 * 채팅 목록(ChatListView)은 네이티브라 JS 는 "어느 메시지인지"만 안다.
 * 그래서 목록에서 손가락이 닿은 줄을 기억해 두었다가 (두 번 누르기·당기기 모두 그 줄에서 시작한다),
 * JS 가 showActions 를 부르면 그 줄 밑에 버튼 줄을 띄우고, 누른 버튼의 id 를 돌려준다.
 */

private const val RECYCLER_VIEW = "androidx.recyclerview.widget.RecyclerView"
private const val CHAT_LIST_VIEW = "com.discord.chat.presentation.list.ChatListView"
/** 이보다 오래전에 닿은 줄은 쓰지 않는다 */
private const val TOUCH_TTL = 4000L

private class Touched(val row: WeakReference<View>, val at: Long)

private fun color(value: String?, fallback: Int): Int = try {
    if (value.isNullOrEmpty()) fallback else Color.parseColor(value)
} catch (e: Throwable) {
    fallback
}

/** 손가락 아래의 줄 (이동 중인 줄도 그 위치로) */
private fun childUnder(parent: ViewGroup, x: Float, y: Float): View? {
    for (i in parent.childCount - 1 downTo 0) {
        val c = parent.getChildAt(i)
        val left = c.left + c.translationX
        val top = c.top + c.translationY
        if (x >= left && x <= left + c.width && y >= top && y <= top + c.height) return c
    }
    return null
}

@Suppress("UNUSED")
val doubleTapActionsPlugin = plugin {
    var unhooks = emptyList<XC_MethodHook.Unhook>()

    start {
        var touched: Touched? = null
        var open: PopupWindow? = null

        val recyclerView = XposedHelpers.findClass(RECYCLER_VIEW, classLoader)
        val chatListView = XposedHelpers.findClass(CHAT_LIST_VIEW, classLoader)

        unhooks = listOf(
            XposedHelpers.findAndHookMethod(
                recyclerView,
                "onInterceptTouchEvent",
                MotionEvent::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val list = param.thisObject as? ViewGroup ?: return
                        if (!chatListView.isInstance(list)) return
                        val ev = param.args[0] as? MotionEvent ?: return
                        if (ev.actionMasked != MotionEvent.ACTION_DOWN) return
                        val row = childUnder(list, ev.x, ev.y) ?: return
                        touched = Touched(WeakReference(row), SystemClock.uptimeMillis())
                    }
                },
            ),
        )

        /**
         * args[0]: JSON {buttons:[{id,label,bg,fg,confirm?}], bg, inset}
         * 돌려주는 값: 누른 버튼 id, 닫으면 "", 띄울 줄이 없으면 "norow"
         */
        registerNativeAsyncMethod("${manifest.id}.showActions") { args ->
            val opts = try {
                JSONObject(args.getOrNull(0) as? String ?: "{}")
            } catch (e: Throwable) {
                JSONObject()
            }
            withContext(Dispatchers.Main) {
                val t = touched ?: return@withContext "norow"
                val row = t.row.get()
                if (row == null || !row.isAttachedToWindow || SystemClock.uptimeMillis() - t.at > TOUCH_TTL) {
                    return@withContext "norow"
                }
                open?.dismiss()
                suspendCancellableCoroutine { cont ->
                    var done = false
                    fun finish(result: String) {
                        if (done) return
                        done = true
                        if (cont.isActive) cont.resume(result)
                    }

                    val ctx = row.context
                    val dm = ctx.resources.displayMetrics
                    fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, dm).toInt()

                    val bar = LinearLayout(ctx)
                    bar.orientation = LinearLayout.HORIZONTAL
                    bar.setPadding(dp(4f), dp(4f), dp(4f), dp(4f))
                    bar.background = GradientDrawable().apply {
                        cornerRadius = dp(14f).toFloat()
                        setColor(color(opts.optString("bg"), Color.parseColor("#2b2d31")))
                    }
                    bar.elevation = dp(6f).toFloat()

                    lateinit var popup: PopupWindow
                    val buttons = opts.optJSONArray("buttons")
                    for (i in 0 until (buttons?.length() ?: 0)) {
                        val b = buttons!!.optJSONObject(i) ?: continue
                        val id = b.optString("id")
                        val tv = TextView(ctx)
                        tv.text = b.optString("label", id)
                        tv.setTextColor(color(b.optString("fg"), Color.WHITE))
                        tv.textSize = 14f
                        tv.paint.isFakeBoldText = true
                        tv.gravity = Gravity.CENTER
                        tv.setPadding(dp(16f), dp(8f), dp(16f), dp(8f))
                        tv.background = GradientDrawable().apply {
                            cornerRadius = dp(10f).toFloat()
                            setColor(color(b.optString("bg"), Color.parseColor("#5865f2")))
                        }
                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                        if (i > 0) lp.leftMargin = dp(6f)
                        tv.layoutParams = lp
                        // confirm 이 있으면 한 번 누르면 글자가 바뀌고, 한 번 더 눌러야 고른다
                        val confirm = b.optString("confirm")
                        var armed = confirm.isEmpty()
                        tv.setOnClickListener {
                            if (!armed) {
                                armed = true
                                tv.text = confirm
                                return@setOnClickListener
                            }
                            finish(id)
                            popup.dismiss()
                        }
                        bar.addView(tv)
                    }

                    popup = PopupWindow(bar, ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, true)
                    popup.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                    popup.isOutsideTouchable = true
                    popup.elevation = dp(6f).toFloat()
                    popup.setOnDismissListener {
                        if (open === popup) open = null
                        finish("")
                    }
                    open = popup
                    cont.invokeOnCancellation { row.post { popup.dismiss() } }

                    // 메시지 글자와 줄을 맞춘다 (아바타 자리만큼 안쪽에서)
                    val inset = dp(opts.optDouble("inset", 64.0).toFloat())
                    try {
                        popup.showAsDropDown(row, inset, dp(2f), Gravity.START)
                    } catch (e: Throwable) {
                        finish("norow")
                        return@suspendCancellableCoroutine
                    }
                    // 살짝 커지며 나타나기
                    bar.alpha = 0f
                    bar.scaleX = 0.9f
                    bar.scaleY = 0.9f
                    bar.pivotX = 0f
                    bar.pivotY = 0f
                    bar.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(160L).setInterpolator(DecelerateInterpolator()).start()
                }
            }
        }

        registerNativeMethod("${manifest.id}.ping") { "pong" }
        log.i("Ready to show message actions")
    }

    stop {
        for (unhook in unhooks) unhook.unhook()
        unhooks = emptyList()
    }
}
