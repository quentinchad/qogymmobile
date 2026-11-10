package com.qojim.qoworkout

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class WorkoutStateRecord : Record {
  @Field var title: String = "Entraînement"
  /** Timestamp (ms) auquel le chrono valait 0, ou 0 si le chrono est en pause. */
  @Field var chronoBase: Double = 0.0
  /** Secondes affichées quand le chrono est en pause. */
  @Field var pausedSec: Double = 0.0
  /** Fin du repos en cours (ms epoch), ou 0. */
  @Field var restEnd: Double = 0.0
  @Field var restTotal: Int = 0
  @Field var setsDone: Int = 0
  @Field var setsTotal: Int = 0
  @Field var beep: Boolean = true
}

class QoWorkoutModule : Module() {
  companion object {
    @Volatile
    private var instance: QoWorkoutModule? = null

    fun emitRestChange(restEnd: Long, restTotal: Int, reason: String) {
      val m = instance ?: return
      try {
        m.sendEvent(
          "onRestChange",
          mapOf(
            "restEndAt" to restEnd.toDouble(),
            "restTotal" to restTotal,
            "reason" to reason
          )
        )
      } catch (_: Throwable) {
      }
    }
  }

  private val ctx: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("QoWorkout")

    Events("onRestChange")

    OnCreate {
      instance = this@QoWorkoutModule
    }

    OnDestroy {
      if (instance === this@QoWorkoutModule) instance = null
    }

    /** Publie / met à jour la notification d'entraînement. */
    Function("update") { state: WorkoutStateRecord ->
      val c = ctx
      WorkoutStore.prefs(c).edit()
        .putBoolean("active", true)
        .putString("title", state.title)
        .putLong("chronoBase", state.chronoBase.toLong())
        .putLong("pausedSec", state.pausedSec.toLong())
        .putLong("restEnd", state.restEnd.toLong())
        .putInt("restTotal", state.restTotal)
        .putInt("setsDone", state.setsDone)
        .putInt("setsTotal", state.setsTotal)
        .putBoolean("beep", state.beep)
        .commit()
      WorkoutNotifier.scheduleRestAlarm(c)
      WorkoutNotifier.render(c)
      if (state.restEnd > 0) WorkoutNotifier.clearAlert(c)
    }

    /** Fin de séance : retire la notification et l'alarme. */
    Function("stop") {
      val c = ctx
      WorkoutStore.prefs(c).edit().clear().commit()
      WorkoutNotifier.cancelAll(c)
    }

    /** État du repos tel que connu côté natif (peut avoir été modifié depuis la notification). */
    Function("getRest") {
      val c = ctx
      mapOf(
        "restEndAt" to WorkoutStore.restEnd(c).toDouble(),
        "restTotal" to WorkoutStore.restTotal(c),
        "active" to WorkoutStore.isActive(c)
      )
    }

    /** Indique si l'app est au premier plan (le JS gère alors lui-même les bips). */
    Function("setForeground") { fg: Boolean ->
      val c = ctx
      WorkoutStore.prefs(c).edit().putBoolean("foreground", fg).apply()
      if (fg) WorkoutNotifier.clearAlert(c)
    }

    Function("beep") { isFinal: Boolean ->
      WorkoutNotifier.beep(ctx, isFinal)
    }

    Function("vibrate") { ms: Int ->
      WorkoutNotifier.vibrate(ctx, longArrayOf(0, ms.toLong()))
    }
  }
}
