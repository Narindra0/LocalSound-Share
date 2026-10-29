package net.narindraportfolio.localsound_mobile

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Musique du téléphone comme source du salon.
 *
 * Deux services dans une classe :
 *
 * - la liste des morceaux (`MediaStore`), avec la permission audio d'Android 13 ;
 * - un lecteur qui décode le fichier choisi (MP3, AAC, FLAC, OGG, WAV…) en
 *   PCM 16 bits stéréo 48 kHz, l'écrit sur l'`AudioTrack` local **et** pousse
 *   les mêmes blocs de 20 ms vers Dart par `localsound/library_stream`.
 *
 * L'écriture bloquante sur `AudioTrack` cadence le décodage : ce que la pièce
 * entend et ce que les auditeurs reçoivent avancent au même rythme, comme avec
 * le micro.
 */
class MusicLibrary(private val activity: Activity, messenger: BinaryMessenger) :
    MethodChannel.MethodCallHandler {

    companion object {
        const val METHOD_CHANNEL = "localsound/library"
        const val STREAM_CHANNEL = "localsound/library_stream"
        const val EVENTS_CHANNEL = "localsound/library_events"
        const val PERMISSION_REQUEST = 4103
        private const val OUT_RATE = 48000
        private const val BLOCK_FRAMES = OUT_RATE / 50 // 20 ms
    }

    private val channel = MethodChannel(messenger, METHOD_CHANNEL)
    private val main = Handler(Looper.getMainLooper())
    private var frames: EventChannel.EventSink? = null
    private var events: EventChannel.EventSink? = null
    private var permissionResult: MethodChannel.Result? = null

    @Volatile
    private var player: TrackPlayer? = null

    init {
        channel.setMethodCallHandler(this)
        EventChannel(messenger, STREAM_CHANNEL).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink?) {
                frames = sink
            }

            override fun onCancel(arguments: Any?) {
                frames = null
            }
        })
        EventChannel(messenger, EVENTS_CHANNEL).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink?) {
                events = sink
            }

            override fun onCancel(arguments: Any?) {
                events = null
            }
        })
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "requestPermission" -> requestPermission(result)
            "songs" -> songs(result)
            "play" -> play(call.argument<String>("uri"), result)
            "pause" -> {
                player?.pause()
                result.success(null)
            }
            "resume" -> {
                player?.resume()
                result.success(null)
            }
            "stop" -> {
                stopTrack()
                result.success(null)
            }
            "keepScreenOn" -> {
                keepScreenOn(call.argument<Boolean>("on") == true)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    /** Appelé par MainActivity après la fenêtre d'autorisation Android. */
    fun onPermissionResult(granted: Boolean) {
        permissionResult?.success(granted)
        permissionResult = null
    }

    private fun audioPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_AUDIO
        else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun hasPermission(): Boolean =
        activity.checkSelfPermission(audioPermission()) == PackageManager.PERMISSION_GRANTED

    private fun requestPermission(result: MethodChannel.Result) {
        if (hasPermission()) {
            result.success(true)
            return
        }
        permissionResult?.success(false)
        permissionResult = result
        activity.requestPermissions(arrayOf(audioPermission()), PERMISSION_REQUEST)
    }

    /// La requête porte sur des milliers de lignes : jamais sur le fil principal.
    private fun songs(result: MethodChannel.Result) {
        if (!hasPermission()) {
            result.success(emptyList<Map<String, Any>>())
            return
        }
        Thread {
            try {
                val items = querySongs()
                main.post { result.success(items) }
            } catch (err: Exception) {
                main.post { result.error("library", err.message ?: "Bibliothèque illisible.", null) }
            }
        }.start()
    }

    private fun querySongs(): List<Map<String, Any>> {
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION
        )
        val items = mutableListOf<Map<String, Any>>()
        activity.contentResolver.query(
            collection,
            projection,
            "${MediaStore.Audio.Media.DURATION} > ?",
            arrayOf("5000"),
            "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
        )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idColumn)
                    items.add(
                        mapOf(
                            "id" to id,
                            "title" to (cursor.getString(titleColumn) ?: "Sans titre"),
                            "artist" to (cursor.getString(artistColumn) ?: ""),
                            "album" to (cursor.getString(albumColumn) ?: ""),
                            "durationMs" to cursor.getLong(durationColumn),
                            "uri" to ContentUris.withAppendedId(collection, id).toString()
                        )
                    )
                }
            }
        return items
    }

    private fun play(rawUri: String?, result: MethodChannel.Result) {
        if (rawUri == null) {
            result.error("uri", "Aucun morceau choisi.", null)
            return
        }
        stopTrack()
        val track = TrackPlayer(Uri.parse(rawUri))
        player = track
        track.start()
        events?.let { sink -> main.post { sink.success(mapOf("type" to "started")) } }
        result.success(null)
    }

    private fun stopTrack() {
        val track = player
        player = null
        track?.release()
    }

    private fun keepScreenOn(on: Boolean) {
        main.post {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun report(type: String, message: String? = null) {
        val sink = events ?: return
        val payload = mutableMapOf<String, Any>("type" to type)
        if (message != null) payload["message"] = message
        main.post { sink.success(payload) }
    }

    /** Un morceau : décodage, rééchantillonnage, écoute locale et trames Dart. */
    private inner class TrackPlayer(private val uri: Uri) {
        @Volatile
        private var running = true

        @Volatile
        private var paused = false

        private var audio: AudioTrack? = null
        private val thread = Thread({ run() }, "localsound-music")
        private val resampler = StereoResampler()
        private val block = ShortArray(BLOCK_FRAMES * 2)
        private var pending = 0
        private var pacingAnchor = 0L
        private var emittedNanos = 0L

        fun start() {
            thread.isDaemon = true
            thread.start()
        }

        fun pause() {
            paused = true
            try {
                audio?.pause()
            } catch (_: Exception) {
            }
        }

        fun resume() {
            if (!running) return
            paused = false
            try {
                audio?.play()
            } catch (_: Exception) {
            }
        }

        fun release() {
            running = false
            try {
                audio?.pause()
                audio?.flush()
            } catch (_: Exception) {
            }
            if (Thread.currentThread() !== thread) {
                try {
                    thread.join(900)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }
            releaseAudio()
        }

        private fun releaseAudio() {
            val track = audio
            audio = null
            try {
                track?.stop()
            } catch (_: Exception) {
            }
            try {
                track?.release()
            } catch (_: Exception) {
            }
        }

        private fun run() {
            val extractor = MediaExtractor()
            var codec: MediaCodec? = null
            var completed = false
            try {
                extractor.setDataSource(activity, uri, null)
                var trackIndex = -1
                var format: MediaFormat? = null
                for (index in 0 until extractor.trackCount) {
                    val candidate = extractor.getTrackFormat(index)
                    val mime = candidate.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("audio/")) {
                        trackIndex = index
                        format = candidate
                        break
                    }
                }
                if (trackIndex < 0 || format == null) {
                    report("error", "Ce fichier ne contient pas d’audio lisible.")
                    return
                }
                extractor.selectTrack(trackIndex)
                val mime = format.getString(MediaFormat.KEY_MIME)!!
                val decoder = MediaCodec.createDecoderByType(mime)
                codec = decoder
                decoder.configure(format, null, null, 0)
                decoder.start()

                val inputRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                    format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                } else OUT_RATE
                val inputChannels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                    format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else 2
                resampler.reset(inputRate, inputChannels)

                val track = buildAudioTrack()
                    ?: run {
                        report("error", "La sortie audio du téléphone a refusé le format du salon.")
                        return
                    }
                audio = track
                track.play()

                val info = MediaCodec.BufferInfo()
                var inputDone = false
                var outputDone = false
                var encoding = AudioFormat.ENCODING_PCM_16BIT

                while (running && !outputDone) {
                    if (paused) {
                        Thread.sleep(30)
                        continue
                    }
                    if (!inputDone) {
                        val inIndex = decoder.dequeueInputBuffer(5000)
                        if (inIndex >= 0) {
                            val buffer = decoder.getInputBuffer(inIndex)
                            val size = if (buffer == null) -1 else extractor.readSampleData(buffer, 0)
                            if (buffer == null || size < 0) {
                                decoder.queueInputBuffer(
                                    inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                )
                                inputDone = true
                            } else {
                                decoder.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }

                    when (val outIndex = decoder.dequeueOutputBuffer(info, 5000)) {
                        MediaCodec.INFO_TRY_AGAIN_LATER, MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val outFormat = decoder.outputFormat
                            val rate = if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                                outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                            } else inputRate
                            val channels = if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                                outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            } else inputChannels
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                                outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)
                            ) {
                                encoding = outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
                            }
                            resampler.reset(rate, channels)
                        }
                        else -> if (outIndex >= 0) {
                            if (info.size > 0) {
                                val buffer = decoder.getOutputBuffer(outIndex)
                                if (buffer != null) {
                                    buffer.position(info.offset)
                                    buffer.limit(info.offset + info.size)
                                    resampler.convert(buffer, info.size, encoding)
                                    writeBlocks(resampler.outFrames)
                                }
                            }
                            decoder.releaseOutputBuffer(outIndex, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                outputDone = true
                            }
                        }
                    }
                }
                if (running) {
                    flushBlock()
                    completed = true
                }
            } catch (err: Exception) {
                if (running) report("error", err.message ?: "Morceau illisible.")
            } finally {
                try {
                    codec?.stop()
                } catch (_: Exception) {
                }
                try {
                    codec?.release()
                } catch (_: Exception) {
                }
                extractor.release()
                releaseAudio()
                if (running && player === this) player = null
                if (completed) report("ended")
            }
        }

        private fun buildAudioTrack(): AudioTrack? {
            val bytes = BLOCK_FRAMES * 4 * 4 // 80 ms de marge
            val track = try {
                AudioTrack(
                    AudioManager.STREAM_MUSIC,
                    OUT_RATE,
                    AudioFormat.CHANNEL_OUT_STEREO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bytes,
                    AudioTrack.MODE_STREAM
                )
            } catch (_: Exception) {
                return null
            }
            if (track.state != AudioTrack.STATE_INITIALIZED) {
                track.release()
                return null
            }
            track.setVolume(1f)
            return track
        }

        /** Découpe le PCM rééchantillonné en blocs de 20 ms, joués puis diffusés. */
        private fun writeBlocks(frames: Int) {
            var offset = 0
            while (offset < frames) {
                val take = min(BLOCK_FRAMES - pending, frames - offset)
                System.arraycopy(resampler.out, offset * 2, block, pending * 2, take * 2)
                pending += take
                offset += take
                if (pending == BLOCK_FRAMES) {
                    emitBlock(BLOCK_FRAMES)
                    pending = 0
                }
            }
        }

        private fun flushBlock() {
            if (pending == 0) return
            emitBlock(pending)
            pending = 0
        }

        private fun emitBlock(frames: Int) {
            val track = audio ?: return
            pace(frames)
            try {
                track.write(block, 0, frames * 2) // bloquant : cadence réelle
            } catch (_: Exception) {
                return
            }
            val sink = framesSink() ?: return
            val bytes = ByteArray(frames * 4)
            var index = 0
            for (sample in 0 until frames * 2) {
                val value = block[sample].toInt()
                bytes[index++] = (value and 0xFF).toByte()
                bytes[index++] = ((value shr 8) and 0xFF).toByte()
            }
            main.post { sink.success(bytes) }
        }

        private fun framesSink(): EventChannel.EventSink? = frames

        /**
         * Un bloc toutes les 20 ms, comme le micro.
         *
         * Le décodeur produit plus vite que le temps réel (et l'`AudioTrack`
         * absorbe 80 ms d'un coup) : sans ce rendez-vous, les auditeurs
         * recevraient plusieurs trames avec la même échéance et le lecteur web
         * les superposerait. Après une pause ou un décodage lent, on repart de
         * maintenant au lieu de rattraper d'un coup.
         */
        private fun pace(frames: Int) {
            val duration = frames * 1_000_000_000L / OUT_RATE
            val now = System.nanoTime()
            if (pacingAnchor == 0L) pacingAnchor = now - emittedNanos
            var target = pacingAnchor + emittedNanos
            if (now - target > 300_000_000L) {
                pacingAnchor = now - emittedNanos
                target = pacingAnchor + emittedNanos
            }
            val wait = target - now
            if (wait > 0) {
                try {
                    Thread.sleep(wait / 1_000_000L, (wait % 1_000_000L).toInt())
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }
            emittedNanos += duration
        }
    }
}

/** Convertit n'importe quel PCM décodé (mono/stéréo, 8→192 kHz) en stéréo 48 kHz. */
internal class StereoResampler {
    var out = ShortArray(4096)
        private set
    var outFrames = 0
        private set

    private var step = 1.0
    private var inputs = 2
    private var position = 0.0
    private var previousLeft = 0f
    private var previousRight = 0f
    private var source = FloatArray(0)

    fun reset(rate: Int, channels: Int) {
        val inputRate = if (rate in 8000..192000) rate else 48000
        inputs = if (channels in 1..8) channels else 2
        step = inputRate.toDouble() / 48000.0
        position = 0.0
        previousLeft = 0f
        previousRight = 0f
        outFrames = 0
    }

    fun convert(buffer: ByteBuffer, size: Int, encoding: Int) {
        val floats = encoding == AudioFormat.ENCODING_PCM_FLOAT
        val bytesPerSample = if (floats) 4 else 2
        val frames = size / (bytesPerSample * inputs)
        if (frames <= 0) {
            outFrames = 0
            return
        }
        buffer.order(ByteOrder.nativeOrder())
        if (source.size < frames * 2) source = FloatArray(frames * 2)
        if (floats) {
            val samples = buffer.asFloatBuffer()
            val available = samples.remaining()
            for (frame in 0 until frames) {
                val base = frame * inputs
                if (inputs == 1) {
                    val value = if (base < available) samples.get(base) else 0f
                    source[frame * 2] = value
                    source[frame * 2 + 1] = value
                } else {
                    source[frame * 2] = if (base < available) samples.get(base) else 0f
                    source[frame * 2 + 1] = if (base + 1 < available) samples.get(base + 1) else 0f
                }
            }
        } else {
            val samples = buffer.asShortBuffer()
            val available = samples.remaining()
            for (frame in 0 until frames) {
                val base = frame * inputs
                if (inputs == 1) {
                    val value = if (base < available) samples.get(base) / 32768f else 0f
                    source[frame * 2] = value
                    source[frame * 2 + 1] = value
                } else {
                    source[frame * 2] = if (base < available) samples.get(base) / 32768f else 0f
                    source[frame * 2 + 1] =
                        if (base + 1 < available) samples.get(base + 1) / 32768f else 0f
                }
            }
        }

        val estimate = (frames / step).toInt() + 4
        if (out.size < estimate * 2) out = ShortArray(estimate * 2)
        var index = 0
        var cursor = position
        while (true) {
            val frame = floor(cursor).toInt()
            if (frame + 1 >= frames) break
            val fraction = (cursor - frame).toFloat()
            val leftA = if (frame < 0) previousLeft else source[frame * 2]
            val rightA = if (frame < 0) previousRight else source[frame * 2 + 1]
            val leftB = source[(frame + 1) * 2]
            val rightB = source[(frame + 1) * 2 + 1]
            out[index * 2] = toShort(leftA + (leftB - leftA) * fraction)
            out[index * 2 + 1] = toShort(rightA + (rightB - rightA) * fraction)
            index++
            cursor += step
        }
        position = cursor - frames
        previousLeft = source[(frames - 1) * 2]
        previousRight = source[(frames - 1) * 2 + 1]
        outFrames = index
    }

    private fun toShort(sample: Float): Short {
        // Échelle 32768 puis arrondi : un échantillon inchangé revient identique.
        val value = (sample * 32768f).roundToInt()
        return value.coerceIn(-32768, 32767).toShort()
    }
}
