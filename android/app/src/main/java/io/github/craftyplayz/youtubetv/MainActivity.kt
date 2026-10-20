package io.github.craftyplayz.youtubetv

import android.app.AlertDialog
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.Rational
import android.view.OrientationEventListener
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

private const val PIP_ACTION = "io.github.craftyplayz.youtubetv.PIP"

// The household server's own page in a WebView, plus what a web page can't do on a phone by itself:
// picture-in-picture, turning sideways for full screen, keeping the screen on and the back button.
// The page finds these on window.YoutubeTvApp and hears back through 'app-*' events (web/src/app.ts).
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("app", MODE_PRIVATE) }
    private var server: String?
        get() = prefs.getString("server", null)
        set(value) = prefs.edit { putString("server", value) }
    private var playing = false
    private var dialog: AlertDialog? = null

    // After the full screen button turns the screen, hand rotation back to the phone once it's held that way,
    // so turning it back exits full screen like YouTube's app does
    private var forcedLandscape = false
    private val tilt by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(degrees: Int) {
                if (degrees == ORIENTATION_UNKNOWN) return
                val held = if (forcedLandscape) degrees in 60..120 || degrees in 240..300 else degrees <= 30 || degrees >= 330
                if (!held) return
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
                disable()
            }
        }
    }

    private val pipButtons = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            intent.getStringExtra("command")?.let(::command)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.BLACK), SystemBarStyle.dark(Color.BLACK))
        volumeControlStream = AudioManager.STREAM_MUSIC // the volume buttons change the video's volume

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false // Channels start playing by themselves, like a TV
            addJavascriptInterface(Bridge(), "YoutubeTvApp")
            webChromeClient = WebChromeClient() // shows the page's alert() and confirm() dialogs
            webViewClient = object : WebViewClient() {
                // Links off the server, like a commenter's link, open in the browser instead
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame || onServer(request.url)) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) unreachable()
                }
            }
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(web)
        }
        // Keeps the page clear of the status bar, navigation bar and camera cutout, and fills the screen once they're hidden
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        onBackPressedDispatcher.addCallback(this) {
            // The page closes whatever is open first (the Guide, Comments, full screen, a Channel); from the Channel list, leave
            web.evaluateJavascript("dispatchEvent(new Event('app-back', { cancelable: true }))") { notHandled ->
                if (notHandled != "false") moveTaskToBack(true)
            }
        }
        ContextCompat.registerReceiver(this, pipButtons, IntentFilter(PIP_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)

        server?.let(web::loadUrl) ?: askServer()
    }

    override fun onDestroy() {
        unregisterReceiver(pipButtons)
        tilt.disable()
        web.destroy()
        super.onDestroy()
    }

    // Leaving the app or closing the picture-in-picture window pauses: YouTube's player doesn't allow playing in the background
    override fun onStop() {
        super.onStop()
        command("pause")
        web.onPause()
    }

    override fun onStart() {
        super.onStart()
        web.onResume()
    }

    // Android 12 and later go to picture-in-picture by themselves (setAutoEnterEnabled); older versions are told here
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (playing && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        send("app-pip", isInPictureInPictureMode.toString())
    }

    private fun send(event: String, detail: String) =
        web.evaluateJavascript("dispatchEvent(new CustomEvent('$event', { detail: $detail }))", null)

    private fun command(name: String) = send("app-command", "'$name'")

    private fun onServer(url: Uri): Boolean {
        val home = Uri.parse(server ?: return false)
        return url.scheme == home.scheme && url.host == home.host && url.port == home.port
    }

    private fun pipParams(): PictureInPictureParams {
        fun button(icon: Int, label: Int, command: String) = RemoteAction(
            Icon.createWithResource(this, icon), getString(label), getString(label),
            PendingIntent.getBroadcast(
                this, command.hashCode(),
                Intent(PIP_ACTION).setPackage(packageName).putExtra("command", command),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        return PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(
                listOf(
                    button(android.R.drawable.ic_media_previous, R.string.previous, "previous"),
                    if (playing) button(android.R.drawable.ic_media_pause, R.string.pause, "togglePause")
                    else button(android.R.drawable.ic_media_play, R.string.play, "togglePause"),
                    button(android.R.drawable.ic_media_next, R.string.next, "next"),
                ),
            )
            .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setAutoEnterEnabled(playing) }
            .build()
    }

    private fun enterPip() {
        if (!isInPictureInPictureMode) runCatching { enterPictureInPictureMode(pipParams()) } // fails if turned off in Android's settings
    }

    private fun askServer() {
        val field = EditText(this).apply {
            hint = getString(R.string.server_hint)
            setText(server.orEmpty())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        val pad = (20 * resources.displayMetrics.density).toInt()
        show(
            AlertDialog.Builder(this)
                .setTitle(R.string.server_title)
                .setMessage(R.string.server_message)
                .setView(FrameLayout(this).apply { setPadding(pad, 0, pad, 0); addView(field) })
                .setCancelable(false)
                .setPositiveButton(android.R.string.ok) { _, _ ->
                    val text = field.text.toString().trim().trimEnd('/')
                    if (text.isEmpty()) return@setPositiveButton askServer()
                    server = if ("://" in text) text else "http://$text"
                    web.loadUrl(server!!)
                }
                .apply { if (server != null) setNegativeButton(android.R.string.cancel, null) },
        )
    }

    private fun unreachable() {
        web.loadUrl("about:blank") // instead of the WebView's own error page
        show(
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.unreachable, server))
                .setCancelable(false)
                .setPositiveButton(R.string.retry) { _, _ -> server?.let(web::loadUrl) }
                .setNeutralButton(R.string.change) { _, _ -> askServer() },
        )
    }

    private fun show(builder: AlertDialog.Builder) {
        dialog?.dismiss()
        dialog = builder.show()
    }

    // Called by the page on a background thread, so each hops to the main thread
    private inner class Bridge {
        @JavascriptInterface
        fun enterPip() = runOnUiThread { this@MainActivity.enterPip() }

        // Turns the screen for the full screen button; turning the phone by hand works on its own
        @JavascriptInterface
        fun rotate(landscape: Boolean) = runOnUiThread {
            forcedLandscape = landscape
            requestedOrientation =
                if (landscape) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            // With auto-rotate off it stays turned until the button is pressed again
            if (Settings.System.getInt(contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0) == 1) tilt.enable()
        }

        // Hides the status and navigation bars for full screen; a swipe from the edge brings them back for a moment
        @JavascriptInterface
        fun setImmersive(on: Boolean) = runOnUiThread {
            val bars = WindowCompat.getInsetsController(window, window.decorView)
            bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (on) bars.hide(WindowInsetsCompat.Type.systemBars()) else bars.show(WindowInsetsCompat.Type.systemBars())
        }

        @JavascriptInterface
        fun setPlaying(on: Boolean) = runOnUiThread {
            playing = on
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            setPictureInPictureParams(pipParams())
        }

        @JavascriptInterface
        fun changeServer() = runOnUiThread { askServer() }
    }
}
