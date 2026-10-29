package net.narindraportfolio.localsound_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var audio: LocalSoundAudio? = null
    private var mic: MicCapture? = null
    private var library: MusicLibrary? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val bridge = LocalSoundAudio()
        audio = bridge
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LocalSoundAudio.CHANNEL)
            .setMethodCallHandler(bridge)
        val capture = MicCapture(this, flutterEngine.dartExecutor.binaryMessenger)
        mic = capture
        library = MusicLibrary(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MicCapture.PERMISSION_REQUEST) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
            mic?.onPermissionResult(granted)
        }
        if (requestCode == MusicLibrary.PERMISSION_REQUEST) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
            library?.onPermissionResult(granted)
        }
    }

    override fun onDestroy() {
        audio = null
        mic = null
        library = null
        super.onDestroy()
    }
}
