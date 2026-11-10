package com.qojim.qoworkout

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.drawable.Icon
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Tout l'état "notification d'entraînement" vit dans des SharedPreferences :
 * le JS écrit l'état via le module, et les actions de la notification
 * (Passer / +30 s) ainsi que l'alarme de fin de repos le modifient côté
 * natif, même si le process JS est endormi ou tué. Le JS relit cet état au
 * retour au premier plan.
 *
 * Batterie : le chrono affiché dans la notification est rendu par le système
 * (setUsesChronometer) — aucun code ne tourne chaque seconde. Seule une
 * alarme unique est programmée pour la fin du repos.
 */
object WorkoutStore {
  private const val PREFS = "qo_workout_state"

  fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isActive(ctx: Context) = prefs(ctx).getBoolean("active", false)
  fun title(ctx: Context) = prefs(ctx).getString("title", "Entraînement") ?: "Entraînement"
  fun chronoBase(ctx: Context) = prefs(ctx).getLong("chronoBase", 0L)
  fun pausedSec(ctx: Context) = prefs(ctx).getLong("pausedSec", 0L)
  fun restEnd(ctx: Context) = prefs(ctx).getLong("restEnd", 0L)
  fun restTotal(ctx: Context) = prefs(ctx).getInt("restTotal", 0)
  fun setsDone(ctx: Context) = prefs(ctx).getInt("setsDone", 0)
  fun setsTotal(ctx: Context) = prefs(ctx).getInt("setsTotal", 0)
  fun beep(ctx: Context) = prefs(ctx).getBoolean("beep", true)
  fun foreground(ctx: Context) = prefs(ctx).getBoolean("foreground", false)

  fun setRest(ctx: Context, end: Long, total: Int) {
    prefs(ctx).edit().putLong("restEnd", end).putInt("restTotal", total).apply()
  }
}

object WorkoutNotifier {
  const val CHANNEL_ONGOING = "qo_workout_ongoing"
  /** v2 : canal silencieux, le son et la vibration sont joués par BeepPlayer. */
  const val CHANNEL_ALERT = "qo_workout_rest_end_v2"
  private const val OLD_CHANNEL_ALERT = "qo_workout_rest_done"
  /** L'alarme se déclenche 5 s avant la fin pour jouer le décompte 5 → 1. */
  const val COUNTDOWN_MS = 5_200L
  const val ID_ONGOING = 4201
  const val ID_ALERT = 4202

  const val ACTION_SKIP = "com.qojim.qoworkout.SKIP_REST"
  const val ACTION_ADD = "com.qojim.qoworkout.ADD_REST"
  const val ACTION_REST_END = "com.qojim.qoworkout.REST_END"

  private const val RC_OPEN = 1
  private const val RC_SKIP = 2
  private const val RC_ADD = 3
  private const val RC_ALARM = 4

  private fun nm(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = nm(ctx)
    if (manager.getNotificationChannel(CHANNEL_ONGOING) == null) {
      val ch = NotificationChannel(CHANNEL_ONGOING, "Entraînement en cours", NotificationManager.IMPORTANCE_LOW)
      ch.description = "Chrono de la séance et temps de repos restant"
      ch.setShowBadge(false)
      ch.enableVibration(false)
      ch.setSound(null, null)
      manager.createNotificationChannel(ch)
    }
    if (manager.getNotificationChannel(OLD_CHANNEL_ALERT) != null) {
      manager.deleteNotificationChannel(OLD_CHANNEL_ALERT)
    }
    if (manager.getNotificationChannel(CHANNEL_ALERT) == null) {
      val ch = NotificationChannel(CHANNEL_ALERT, "Fin du repos", NotificationManager.IMPORTANCE_HIGH)
      ch.description = "Alerte quand le temps de repos est écoulé (le bip est joué par l'app)"
      ch.enableVibration(false)
      ch.setSound(null, null)
      manager.createNotificationChannel(ch)
    }
  }

  private fun immutable(): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun openAppIntent(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    // Ramène simplement l'app au premier plan, là où l'utilisateur l'avait laissée.
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(ctx, RC_OPEN, launch, immutable())
  }

  private fun broadcast(ctx: Context, action: String, rc: Int): PendingIntent {
    val i = Intent(ctx, WorkoutReceiver::class.java).setAction(action).setPackage(ctx.packageName)
    return PendingIntent.getBroadcast(ctx, rc, i, immutable())
  }

  private fun formatClock(totalSec: Long): String {
    val s = if (totalSec < 0) 0 else totalSec
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%d:%02d", m, sec)
  }

  /** (Re)publie la notification persistante à partir de l'état stocké. */
  fun render(ctx: Context) {
    if (!WorkoutStore.isActive(ctx)) {
      nm(ctx).cancel(ID_ONGOING)
      return
    }
    ensureChannels(ctx)
    val now = System.currentTimeMillis()
    val restEnd = WorkoutStore.restEnd(ctx)
    val resting = restEnd > now
    val title = WorkoutStore.title(ctx)
    val done = WorkoutStore.setsDone(ctx)
    val total = WorkoutStore.setsTotal(ctx)
    val setsText = if (total > 0) "$done / $total séries" else null

    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(ctx, CHANNEL_ONGOING)
    else
      @Suppress("DEPRECATION") Notification.Builder(ctx)

    b.setSmallIcon(R.drawable.qo_ic_workout)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setColor(0xFFD4A64A.toInt())
    openAppIntent(ctx)?.let { b.setContentIntent(it) }

    if (resting) {
      b.setContentTitle("Repos · $title")
        .setContentText(setsText?.let { "$it — prochaine série bientôt" } ?: "Prochaine série bientôt")
        .setUsesChronometer(true)
        .setWhen(restEnd)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true)
      b.addAction(Notification.Action.Builder(null as Icon?, "+30 s", broadcast(ctx, ACTION_ADD, RC_ADD)).build())
      b.addAction(Notification.Action.Builder(null as Icon?, "Passer le repos", broadcast(ctx, ACTION_SKIP, RC_SKIP)).build())
    } else {
      val base = WorkoutStore.chronoBase(ctx)
      b.setContentTitle(title)
      if (base > 0) {
        b.setUsesChronometer(true).setWhen(base)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(false)
        b.setContentText(setsText ?: "Séance en cours")
      } else {
        b.setUsesChronometer(false).setShowWhen(false)
        b.setContentText("En pause · ${formatClock(WorkoutStore.pausedSec(ctx))}" + (setsText?.let { " · $it" } ?: ""))
      }
    }

    try {
      nm(ctx).notify(ID_ONGOING, b.build())
    } catch (_: SecurityException) {
      // Permission de notification refusée : rien à faire.
    }
  }

  fun cancelAll(ctx: Context) {
    cancelRestAlarm(ctx)
    nm(ctx).cancel(ID_ONGOING)
    nm(ctx).cancel(ID_ALERT)
  }

  fun scheduleRestAlarm(ctx: Context) {
    val end = WorkoutStore.restEnd(ctx)
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = broadcast(ctx, ACTION_REST_END, RC_ALARM)
    am.cancel(pi)
    val now = System.currentTimeMillis()
    if (end <= now) return
    // Décompte déjà en cours pour cette fin de repos : ne pas le relancer.
    if (WorkoutStore.prefs(ctx).getLong("seqEnd", 0L) == end) return
    val at = maxOf(end - COUNTDOWN_MS, now + 50)
    try {
      val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
      if (canExact) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      } else {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      }
    } catch (_: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  fun cancelRestAlarm(ctx: Context) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(broadcast(ctx, ACTION_REST_END, RC_ALARM))
  }

  /** Alerte "Repos terminé" (son + vibration), utilisée quand l'app n'est pas à l'écran. */
  fun alertRestDone(ctx: Context) {
    ensureChannels(ctx)
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(ctx, CHANNEL_ALERT)
    else
      @Suppress("DEPRECATION") Notification.Builder(ctx)
    b.setSmallIcon(R.drawable.qo_ic_workout)
      .setContentTitle("Repos terminé 💪")
      .setContentText("C'est reparti : ${WorkoutStore.title(ctx)}")
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_ALARM)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setColor(0xFFD4A64A.toInt())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(20_000)
    openAppIntent(ctx)?.let { b.setContentIntent(it) }
    try {
      nm(ctx).notify(ID_ALERT, b.build())
    } catch (_: SecurityException) {
    }
  }

  /**
   * L'app est-elle réellement à l'écran ? Vérifié côté système (importance du
   * process + écran allumé) plutôt que via un drapeau envoyé par le JS, qui
   * peut être faux au démarrage. Écran verrouillé / éteint = pas visible.
   */
  fun isAppVisible(ctx: Context): Boolean {
    return try {
      val info = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(info)
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND && pm.isInteractive
    } catch (_: Throwable) {
      WorkoutStore.foreground(ctx)
    }
  }

  fun clearAlert(ctx: Context) {
    nm(ctx).cancel(ID_ALERT)
  }

  // ── Bips & vibrations ───────────────────────────────────────────────
  fun beep(ctx: Context, isFinal: Boolean) = BeepPlayer.beep(ctx, isFinal)

  fun vibrate(ctx: Context, pattern: LongArray) {
    try {
      val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(pattern, -1)
      }
    } catch (_: Throwable) {
    }
  }
}
