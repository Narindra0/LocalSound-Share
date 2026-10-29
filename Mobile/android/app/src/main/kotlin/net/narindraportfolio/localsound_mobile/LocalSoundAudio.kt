package net.narindraportfolio.localsound_mobile

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Pont entre Flutter et AudioTrack : le PCM du salon arrive en s16le stéréo
 * 48 kHz et part directement au matériel, sans rééchantillonnage côté Kotlin.
 *
 * Le flux est continu (MODE_STREAM). Un bloc manquant produit du silence
 * d'AudioTrack, jamais un retard accumulé : la fraîcheur est décidée côté Dart.
 */
class LocalSoundAudio : MethodChannel.MethodCallHandler {
    companion object {
        const val CHANNEL = "localsound/audio"
    }

    private var track: AudioTrack? = null
    private var sampleRate = 48000
    private var channels = 2
    private var bufferMs = 160

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepare" -> result.success(prepare(call))
            "write" -> {
                val bytes = call.arguments as? ByteArray ?: ByteArray(0)
                result.success(write(bytes))
            }
            "start" -> result.success(start())
            "pause" -> {
                pause()
                result.success(null)
            }
            "flush" -> {
                flush()
                result.success(null)
            }
            "setVolume" -> {
                setVolume((call.argument<Double>("volume") ?: 1.0).toFloat())
                result.success(null)
            }
            "release" -> {
                release()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun prepare(call: MethodCall): Boolean {
        sampleRate = call.argument<Int>("sampleRate") ?: 48000
        channels = call.argument<Int>("channels") ?: 2
        bufferMs = call.argument<Int>("bufferMs") ?: 160
        release()

        val channelMask = if (channels == 1) {
            AudioFormat.CHANNEL_OUT_MONO
        } else {
            AudioFormat.CHANNEL_OUT_STEREO
        }
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(sampleRate)
            .setChannelMask(channelMask)
            .build()

        // Deux fois le minimum matériel : assez de marge pour absorber la gigue
        // du Wi-Fi sans ajouter plus d'une centaine de millisecondes de retard.
        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            channelMask,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuffer <= 0) return false
        val wanted = sampleRate * channels * 2 * bufferMs / 1000
        val bufferSize = maxOf(minBuffer * 2, wanted)

        val built: AudioTrack? = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        } catch (_: Exception) {
            null
        }
        if (built == null || built.state != AudioTrack.STATE_INITIALIZED) {
            built?.release()
            track = null
            return false
        }
        built.setVolume(1f)
        track = built
        return true
    }

    private fun start(): Boolean {
        val audio = track ?: return false
        if (audio.playState != AudioTrack.PLAYSTATE_PLAYING) {
            audio.play()
        }
        return audio.playState == AudioTrack.PLAYSTATE_PLAYING
    }

    private fun pause() {
        val audio = track ?: return
        if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) audio.pause()
    }

    private fun flush() {
        val audio = track ?: return
        if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) {
            audio.pause()
            audio.flush()
            audio.play()
        } else {
            audio.flush()
        }
    }

    private fun setVolume(value: Float) {
        track?.setVolume(value.coerceIn(0f, 1f))
    }

    private fun release() {
        track?.let { audio ->
            try {
                if (audio.playState == AudioTrack.PLAYSTATE_PLAYING) audio.stop()
            } catch (_: IllegalStateException) {
            }
            audio.flush()
            audio.release()
        }
        track = null
    }

    /** Écrit un bloc PCM ; `false` si le flux n'est pas prêt. */
    fun write(bytes: ByteArray): Boolean {
        val audio = track ?: return false
        if (audio.playState != AudioTrack.PLAYSTATE_PLAYING) return false
        val written = audio.write(bytes, 0, bytes.size, AudioTrack.WRITE_BLOCKING)
        return written >= 0
    }

    fun audioSessionId(): Int = track?.audioSessionId ?: AudioManager.ERROR
}
