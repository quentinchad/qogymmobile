package com.qojim.qoworkout

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Bip identique à celui de l'ancienne version web (Web Audio) :
 * onde carrée, attaque 5 ms, palier, coupure nette 15 ms avant la fin.
 *  - décompte (5 → 1 s) : 1000 Hz, 90 ms
 *  - fin du repos       : double bip 1400 Hz (100 ms, puis 140 ms à +150 ms)
 *
 * Joué sur le flux média (comme le site) : passe dans les écouteurs par
 * dessus la musique, que l'app soit à l'écran ou non. La musique est
 * brièvement baissée (audio focus "duck") pendant le décompte.
 */
object BeepPlayer {
  private const val RATE = 44100
  private val main by lazy { Handler(Looper.getMainLooper()) }

  private val attrs: AudioAttributes by lazy {
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
  }

  private fun square(freq: Int, durationMs: Int, out: ShortArray, offset: Int) {
    val n = durationMs * RATE / 1000
    val attack = (0.005 * RATE).toInt()
    val release = (0.015 * RATE).toInt()
    val amp = 0.8 * Short.MAX_VALUE
    val period = RATE.toDouble() / freq
    for (i in 0 until n) {
      if (offset + i >= out.size) break
      val env = when {
        i < attack -> i.toDouble() / attack
        i > n - release -> (n - i).toDouble() / release
        else -> 1.0
      }
      val v = if ((i % period) < period / 2) 1.0 else -1.0
      out[offset + i] = (v * amp * env).toInt().toShort()
    }
  }

  private val tick: ShortArray by lazy {
    ShortArray(90 * RATE / 1000).also { square(1000, 90, it, 0) }
  }

  private val go: ShortArray by lazy {
    ShortArray(290 * RATE / 1000).also {
      square(1400, 100, it, 0)
      square(1400, 140, it, 150 * RATE / 1000)
    }
  }

  private fun play(pcm: ShortArray) {
    try {
      val bytes = pcm.size * 2
      val track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        AudioTrack.Builder()
          .setAudioAttributes(attrs)
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .build()
          )
          .setTransferMode(AudioTrack.MODE_STATIC)
          .setBufferSizeInBytes(bytes)
          .build()
      } else {
        @Suppress("DEPRECATION")
        AudioTrack(
          AudioManager.STREAM_MUSIC, RATE, AudioFormat.CHANNEL_OUT_MONO,
          AudioFormat.ENCODING_PCM_16BIT, bytes, AudioTrack.MODE_STATIC
        )
      }
      track.write(pcm, 0, pcm.size)
      track.play()
      val ms = pcm.size * 1000L / RATE
      main.postDelayed({ try { track.release() } catch (_: Throwable) {} }, ms + 150)
    } catch (_: Throwable) {
    }
  }

  fun beep(ctx: Context, isFinal: Boolean) {
    play(if (isFinal) go else tick)
    WorkoutNotifier.vibrate(ctx, if (isFinal) longArrayOf(0, 100, 50, 140) else longArrayOf(0, 90))
  }

  // ── Audio focus : baisse la musique le temps du décompte ─────────────
  private var focusRequest: AudioFocusRequest? = null

  fun duck(ctx: Context) {
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(attrs)
          .build()
        focusRequest = req
        am.requestAudioFocus(req)
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      }
    } catch (_: Throwable) {
    }
  }

  fun unduck(ctx: Context) {
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { am.abandonAudioFocusRequest(it) }
        focusRequest = null
      } else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(null)
      }
    } catch (_: Throwable) {
    }
  }
}
