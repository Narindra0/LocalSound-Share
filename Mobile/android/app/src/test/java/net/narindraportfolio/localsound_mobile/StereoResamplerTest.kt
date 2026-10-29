package net.narindraportfolio.localsound_mobile

import android.media.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le rééchantillonnage est le seul calcul que rien d'autre ne vérifie : une
 * erreur de pas ou de report produirait des micro-coupures à chaque tampon,
 * inaudibles en test mais bien réelles à l'écoute.
 */
class StereoResamplerTest {

    private fun pcm16(samples: IntArray): ByteBuffer {
        val buffer = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.nativeOrder())
        samples.forEach { buffer.putShort(it.toShort()) }
        buffer.flip()
        return buffer
    }

    @Test
    fun `48 kHz stereo traverse sans changement`() {
        val resampler = StereoResampler()
        resampler.reset(48000, 2)
        val frames = 100
        val samples = IntArray(frames * 2) { it * 10 }
        resampler.convert(pcm16(samples), samples.size * 2, AudioFormat.ENCODING_PCM_16BIT)

        // Une trame de report reste pour le tampon suivant.
        assertEquals(frames - 1, resampler.outFrames)
        assertEquals(samples[0].toShort(), resampler.out[0])
        assertEquals(samples[1].toShort(), resampler.out[1])
    }

    @Test
    fun `44,1 kHz produit environ 48 kHz`() {
        val resampler = StereoResampler()
        resampler.reset(44100, 2)
        val frames = 441
        val samples = IntArray(frames * 2) { 1000 }
        resampler.convert(pcm16(samples), samples.size * 2, AudioFormat.ENCODING_PCM_16BIT)

        val expected = 441 * 48000 / 44100
        assertTrue(
            "attendu ≈ $expected trames, obtenu ${resampler.outFrames}",
            kotlin.math.abs(resampler.outFrames - expected) <= 2
        )
        assertEquals(1000.toShort(), resampler.out[0])
        assertEquals(1000.toShort(), resampler.out[1])
    }

    @Test
    fun `le report de phase évite une coupure entre deux tampons`() {
        val resampler = StereoResampler()
        resampler.reset(44100, 2)
        val frames = 441
        val samples = IntArray(frames * 2) { 8000 }
        val bytes = samples.size * 2
        resampler.convert(pcm16(samples), bytes, AudioFormat.ENCODING_PCM_16BIT)
        val first = resampler.outFrames
        resampler.convert(pcm16(samples), bytes, AudioFormat.ENCODING_PCM_16BIT)

        // Le deuxième tampon rattrape la trame reportée : ~480 par tampon.
        assertEquals(480, first + 1)
        assertTrue(resampler.outFrames in 478..482)
        for (index in 0 until resampler.outFrames * 2) {
            assertEquals("échantillon $index", 8000.toShort(), resampler.out[index])
        }
    }

    @Test
    fun `mono est dupliqué sur les deux canaux`() {
        val resampler = StereoResampler()
        resampler.reset(48000, 1)
        val samples = IntArray(20) { 1234 }
        resampler.convert(pcm16(samples), samples.size * 2, AudioFormat.ENCODING_PCM_16BIT)
        for (frame in 0 until resampler.outFrames) {
            assertEquals(resampler.out[frame * 2], resampler.out[frame * 2 + 1])
        }
    }

    @Test
    fun `le PCM flottant est accepté`() {
        val resampler = StereoResampler()
        resampler.reset(48000, 2)
        val buffer = ByteBuffer.allocate(4 * 4).order(ByteOrder.nativeOrder())
        buffer.putFloat(0.5f)
        buffer.putFloat(-0.5f)
        buffer.putFloat(0.25f)
        buffer.putFloat(-0.25f)
        buffer.flip()
        resampler.convert(buffer, buffer.limit(), AudioFormat.ENCODING_PCM_FLOAT)

        assertEquals(1, resampler.outFrames)
        assertTrue(resampler.out[0] > 16000)
        assertTrue(resampler.out[1] < -16000)
    }

    @Test
    fun `un échantillon fort ne dépasse pas la plage 16 bits`() {
        val resampler = StereoResampler()
        resampler.reset(48000, 2)
        val samples = intArrayOf(32767, -32768, 32767, -32768, 0, 0)
        resampler.convert(pcm16(samples), samples.size * 2, AudioFormat.ENCODING_PCM_16BIT)
        assertTrue(resampler.outFrames >= 1)
        assertEquals(32767.toShort(), resampler.out[0])
        assertEquals((-32768).toShort(), resampler.out[1])
    }
}
