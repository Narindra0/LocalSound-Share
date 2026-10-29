package net.narindraportfolio.localsound_mobile

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Micro du téléphone, au format exact du salon : 48 kHz, 16 bits, mono.
 *
 * Les blocs de 20 ms partent vers Dart par `localsound/mic_stream` ; la
 * conversion mono → stéréo et l'empaquetage LSP2 se font côté Dart, comme le
 * fait `server.js` quand il reçoit un chunk de la capture système.
 */
class MicCapture(private val activity: Activity, messenger: BinaryMessenger) :
    MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    companion object {
        const val METHOD_CHANNEL = "localsound/mic"
        const val STREAM_CHANNEL = "localsound/mic_stream"
        const val PERMISSION_REQUEST = 4102
        private const val SAMPLE_RATE = 48000
        private const val BLOCK_SAMPLES = SAMPLE_RATE / 50 // 20 ms
    }

    private val channel = MethodChannel(messenger, METHOD_CHANNEL)
    private val main = Handler(Looper.getMainLooper())
    private var record: AudioRecord? = null
    private var worker: Thread? = null
    private var sink: EventChannel.EventSink? = null
    private var permissionResult: MethodChannel.Result? = null

    @Volatile
    private var running = false

    init {
        channel.setMethodCallHandler(this)
        EventChannel(messenger, STREAM_CHANNEL).setStreamHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "requestPermission" -> requestPermission(result)
            "start" -> start(result)
            "stop" -> {
                stop()
                result.success(null)
            }
            "keepScreenOn" -> {
                keepScreenOn(call.argument<Boolean>("on") == true)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    private fun requestPermission(result: MethodChannel.Result) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            result.success(true)
            return
        }
        permissionResult?.success(false)
        permissionResult = result
        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST)
    }

    /** Appelé par MainActivity après la fenêtre d'autorisation Android. */
    fun onPermissionResult(granted: Boolean) {
        permissionResult?.success(granted)
        permissionResult = null
    }

    private fun start(result: MethodChannel.Result) {
        if (running) {
            result.success(true)
            return
        }
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            result.error("permission", "Autorisez le micro pour héberger le salon.", null)
            return
        }
        val minimum = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minimum <= 0) {
            result.error("audio", "Le micro refuse la fréquence du salon (48 kHz).", null)
            return
        }
        val capture = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minimum * 2, BLOCK_SAMPLES * 8)
            )
        } catch (err: Exception) {
            result.error("audio", err.message ?: "Micro indisponible.", null)
            return
        }
        if (capture.state != AudioRecord.STATE_INITIALIZED) {
            capture.release()
            result.error("audio", "Le micro n'a pas pu démarrer.", null)
            return
        }
        try {
            capture.startRecording()
        } catch (err: Exception) {
            capture.release()
            result.error("audio", err.message ?: "Micro indisponible.", null)
            return
        }
        record = capture
        running = true
        worker = Thread({ loop(capture) }, "localsound-mic").also {
            it.isDaemon = true
            it.start()
        }
        result.success(true)
    }

    private fun loop(capture: AudioRecord) {
        val samples = ShortArray(BLOCK_SAMPLES)
        while (running) {
            val read = try {
                capture.read(samples, 0, samples.size)
            } catch (_: Exception) {
                break
            }
            if (read <= 0) continue
            val bytes = ByteArray(read * 2)
            var index = 0
            for (i in 0 until read) {
                val value = samples[i].toInt()
                bytes[index++] = (value and 0xFF).toByte()
                bytes[index++] = ((value shr 8) and 0xFF).toByte()
            }
            val events = sink ?: continue
            main.post { events.success(bytes) }
        }
    }

    private fun stop() {
        running = false
        worker?.let { thread ->
            try {
                thread.join(500)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        worker = null
        record?.let { capture ->
            try {
                capture.stop()
            } catch (_: Exception) {
            }
            capture.release()
        }
        record = null
    }

    private fun keepScreenOn(on: Boolean) {
        main.post {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}
