package io.github.yumistra.betteranimations

import android.graphics.Canvas
import android.graphics.Matrix
import android.view.View
import android.view.ViewGroup
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.reflect.Method
import java.lang.reflect.Modifier

/**
 * 멘션(핑) 노란 배경 같은 "메시지 뒤 배경"이 메시지 효과를 그대로 따라가게 한다.
 *
 * 디스코드는 이 배경을 메시지 줄 안이 아니라 채팅 목록의 ItemDecoration 이 목록 캔버스에 따로 그린다
 * (352: l9.a → l9.b.b(Canvas, View)). 그 그리기는 줄의 위치 이동(translationY)만 반영하고
 * 크기·회전·투명도는 모른다. 그래서 메시지가 커지며·흐려지며 나타나는 동안 배경만 제자리·제 크기로 있다가
 * 효과가 끝나면 맞아떨어진다.
 *
 * 채팅 목록에 붙은 ItemDecoration 들을 찾아, 그 안에서 "(Canvas, View) 로 줄 하나를 그리는" 메서드를 감싼다.
 * 그리는 동안만 캔버스에 그 줄의 변환(View.getMatrix)과 투명도를 걸어 준다.
 */
internal class Highlights(private val rvClass: Class<*>, private val log: (String, Throwable?) -> Unit) {
    private val done = HashSet<Class<*>>()
    private val hooked = HashSet<Method>()
    val hooks = ArrayList<XC_MethodHook.Unhook>()
    private val tmp = Matrix()
    var count = 0
        private set

    /** 채팅 목록이 처음 그려지기 전에 한 번 (장식은 목록을 만들 때 붙는다) */
    fun scan(list: ViewGroup) {
        for (deco in decorations(list)) {
            val cls = deco.javaClass
            if (!done.add(cls)) continue
            // 장식 자신 또는 그 필드(그리기 도우미)에 있는 (Canvas, View) → void 메서드
            val targets = ArrayList<Method>()
            targets.addAll(drawRowMethods(cls))
            var c: Class<*>? = cls
            while (c != null && c != Any::class.java) {
                for (f in c.declaredFields) {
                    if (Modifier.isStatic(f.modifiers) || f.type.isPrimitive) continue
                    val helper = try {
                        f.isAccessible = true
                        f.get(deco)
                    } catch (e: Throwable) {
                        null
                    } ?: continue
                    if (helper is View || helper is Collection<*>) continue
                    targets.addAll(drawRowMethods(helper.javaClass))
                }
                c = c.superclass
            }
            for (m in targets) hook(m)
        }
    }

    /** 목록의 ArrayList 필드 중에 ItemDecoration(목록 캔버스에 그리는 것)이 든 것 */
    private fun decorations(list: ViewGroup): List<Any> {
        val out = ArrayList<Any>()
        var c: Class<*>? = list.javaClass
        while (c != null && c != ViewGroup::class.java) {
            for (f in c.declaredFields) {
                if (Modifier.isStatic(f.modifiers) || !java.util.ArrayList::class.java.isAssignableFrom(f.type)) continue
                val items = try {
                    f.isAccessible = true
                    f.get(list) as? java.util.ArrayList<*>
                } catch (e: Throwable) {
                    null
                } ?: continue
                for (item in items.toList()) if (item != null && isDecoration(item.javaClass)) out.add(item)
            }
            c = c.superclass
        }
        return out
    }

    /** onDraw(Canvas, RecyclerView, State) 를 가진 클래스 */
    private fun isDecoration(cls: Class<*>): Boolean {
        var c: Class<*>? = cls
        while (c != null && c != Any::class.java) {
            if (c.declaredMethods.any { m -> m.parameterTypes.size == 3 && m.parameterTypes[0] == Canvas::class.java && m.parameterTypes[1].isAssignableFrom(rvClass) }) return true
            c = c.superclass
        }
        return false
    }

    private fun drawRowMethods(cls: Class<*>) = cls.declaredMethods.filter {
        !Modifier.isStatic(it.modifiers) && !Modifier.isAbstract(it.modifiers) && it.returnType == Void.TYPE &&
            it.parameterTypes.size == 2 && it.parameterTypes[0] == Canvas::class.java && it.parameterTypes[1] == View::class.java
    }

    private fun hook(m: Method) {
        if (!hooked.add(m)) return
        try {
            hooks.add(
                XposedBridge.hookMethod(
                    m,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            val canvas = param.args[0] as? Canvas ?: return
                            val view = param.args[1] as? View ?: return
                            val save = apply(canvas, view)
                            if (save >= 0) param.setObjectExtra("baSave", save)
                        }

                        override fun afterHookedMethod(param: MethodHookParam) {
                            val save = param.getObjectExtra("baSave") as? Int ?: return
                            (param.args[0] as? Canvas)?.restoreToCount(save)
                        }
                    },
                ),
            )
            count++
        } catch (e: Throwable) {
            log("Failed to hook ${m.declaringClass.name}.${m.name}", e)
        }
    }

    /**
     * 줄이 크기·회전·투명도 변환 중이면 캔버스에 같은 변환을 건다. 건 게 없으면 -1.
     * 도우미는 (left + translationX, top + translationY) 에 그리므로, 그 이동은 빼고 줄 행렬 전체를 다시 건다:
     * T(left, top) · M · T(−left − tx, −top − ty)
     */
    private fun apply(canvas: Canvas, v: View): Int {
        val transformed = v.scaleX != 1f || v.scaleY != 1f || v.rotation != 0f || v.rotationX != 0f || v.rotationY != 0f
        val faded = v.alpha < 1f
        if (!transformed && !faded) return -1
        val save = canvas.save()
        if (transformed) {
            tmp.set(v.matrix)
            canvas.translate(v.left.toFloat(), v.top.toFloat())
            canvas.concat(tmp)
            canvas.translate(-v.left - v.translationX, -v.top - v.translationY)
        }
        if (faded) {
            val l = v.left + v.translationX
            val t = v.top + v.translationY
            canvas.saveLayerAlpha(l, t, l + v.width, t + v.height, (v.alpha.coerceIn(0f, 1f) * 255).toInt())
        }
        return save
    }
}
