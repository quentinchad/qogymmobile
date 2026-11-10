package com.qojim.qoworkout

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper

/**
 * Reçoit les actions de la notification (Passer / +30 s) et l'alarme de fin
 * de repos. Fonctionne même si l'app est fermée : tout l'état est dans
 * WorkoutStore, et le JS se resynchronise au retour.
 */
class WorkoutReceiver : BroadcastReceiver() {
  /**
   * Décompte de fin de repos, joué ici (côté natif) que l'app soit à l'écran,
   * en arrière-plan ou fermée : bip à 5, 4, 3, 2, 1 s puis double bip final.
   * goAsync() garde le CPU éveillé (wakelock de l'alarme) ~6 s maximum.
   */
  private fun runCountdown(ctx: Context, now: Long) {
    val prefs = WorkoutStore.prefs(ctx)
    val end = WorkoutStore.restEnd(ctx)
    // Alarme obsolète (repos annulé / prolongé) ou décompte déjà lancé.
    if (end <= 0L || end - now > WorkoutNotifier.COUNTDOWN_MS + 1500L) return
    if (prefs.getLong("seqEnd", 0L) == end) return
    prefs.edit().putLong("seqEnd", end).apply()

    val pending = goAsync()
    val h = Handler(Looper.getMainLooper())
    val stillCurrent = { WorkoutStore.isActive(ctx) && WorkoutStore.restEnd(ctx) == end }
    if (WorkoutStore.beep(ctx)) BeepPlayer.duck(ctx)

    for (k in 5 downTo 1) {
      val delay = end - k * 1000L - now
      if (delay < -250L) continue
      h.postDelayed({
        if (stillCurrent() && WorkoutStore.beep(ctx)) BeepPlayer.beep(ctx, false)
      }, maxOf(0L, delay))
    }

    h.postDelayed({
      if (stillCurrent()) {
        WorkoutStore.setRest(ctx, 0L, 0)
        WorkoutNotifier.render(ctx)
        QoWorkoutModule.emitRestChange(0L, 0, "end")
        if (WorkoutStore.beep(ctx)) BeepPlayer.beep(ctx, true)
        else WorkoutNotifier.vibrate(ctx, longArrayOf(0, 350))
        // « Repos terminé » uniquement si l'utilisateur n'est pas sur l'app.
        if (!WorkoutNotifier.isAppVisible(ctx)) WorkoutNotifier.alertRestDone(ctx)
      }
      h.postDelayed({
        BeepPlayer.unduck(ctx)
        pending.finish()
      }, 450)
    }, maxOf(0L, end - now))
  }

  override fun onReceive(context: Context, intent: Intent) {
    val ctx = context.applicationContext
    if (!WorkoutStore.isActive(ctx)) {
      WorkoutNotifier.cancelAll(ctx)
      return
    }
    val now = System.currentTimeMillis()
    when (intent.action) {
      WorkoutNotifier.ACTION_SKIP -> {
        WorkoutStore.setRest(ctx, 0L, 0)
        WorkoutNotifier.cancelRestAlarm(ctx)
        WorkoutNotifier.render(ctx)
        QoWorkoutModule.emitRestChange(0L, 0, "skip")
      }
      WorkoutNotifier.ACTION_ADD -> {
        val currentEnd = WorkoutStore.restEnd(ctx)
        val base = if (currentEnd > now) currentEnd else now
        val newEnd = base + 30_000L
        val newTotal = WorkoutStore.restTotal(ctx) + 30
        WorkoutStore.setRest(ctx, newEnd, newTotal)
        WorkoutNotifier.scheduleRestAlarm(ctx)
        WorkoutNotifier.render(ctx)
        QoWorkoutModule.emitRestChange(newEnd, newTotal, "add")
      }
      WorkoutNotifier.ACTION_REST_END -> runCountdown(ctx, now)
    }
  }
}
