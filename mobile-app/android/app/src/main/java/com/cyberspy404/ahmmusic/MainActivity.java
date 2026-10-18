package com.cyberspy404.ahmmusic;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    private static MainActivity activeInstance;
    private WebView webView;
    private long lastBackPressedTime = 0;
    private Toast exitToast;

    public static MainActivity getActiveInstance() {
        return activeInstance;
    }

    public static void dispatchMediaAction(String action, double value) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (activeInstance != null && activeInstance.webView != null) {
                String js = String.format("if (typeof window.handleAndroidMediaAction === 'function') { window.handleAndroidMediaAction('%s', %f); }", action, value);
                activeInstance.webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;

        // Enable edge-to-edge rendering into the display notch / camera cutout for Origin Island support
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.parseColor("#090A0D"));
        }

        // Request Notification permission on Android 13+ (API 33+) for media playback controls
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // Bridge for native Android music player detection & MediaSession
        webView.addJavascriptInterface(new AndroidAudioBridge(this), "AndroidAudioBridge");

        webView.setWebViewClient(new WebViewClient());

        // Loads local bundled web assets
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    public class AndroidAudioBridge {
        private final Context context;

        public AndroidAudioBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void updateMediaState(String title, String artist, String album, String coverUrl, double durationSec, double positionSec, boolean isPlaying) {
            Intent intent = new Intent(context, MediaPlaybackService.class);
            intent.setAction(MediaPlaybackService.ACTION_UPDATE_STATE);
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
            intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album);
            intent.putExtra(MediaPlaybackService.EXTRA_COVER, coverUrl);
            intent.putExtra(MediaPlaybackService.EXTRA_DURATION, durationSec);
            intent.putExtra(MediaPlaybackService.EXTRA_POSITION, positionSec);
            intent.putExtra(MediaPlaybackService.EXTRA_IS_PLAYING, isPlaying);

            try {
                if (isPlaying && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public void requestAudioFocus() {
            MediaPlaybackService service = MediaPlaybackService.getInstance();
            if (service != null) {
                service.requestAudioFocus();
            }
        }

        @JavascriptInterface
        public void abandonAudioFocus() {
            MediaPlaybackService service = MediaPlaybackService.getInstance();
            if (service != null) {
                service.abandonAudioFocus();
            }
        }

        @JavascriptInterface
        public boolean isNativeAndroidApp() {
            return true;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("(function(){ if (typeof window.handleAppBack === 'function') { return window.handleAppBack(); } return false; })()", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    new Handler(Looper.getMainLooper()).post(() -> {
                        if ("true".equalsIgnoreCase(value)) {
                            return;
                        }

                        if (webView.canGoBack()) {
                            webView.goBack();
                            return;
                        }

                        long currentTime = System.currentTimeMillis();
                        if (currentTime - lastBackPressedTime < 2000) {
                            if (exitToast != null) exitToast.cancel();
                            MainActivity.super.onBackPressed();
                        } else {
                            lastBackPressedTime = currentTime;
                            exitToast = Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT);
                            exitToast.show();
                        }
                    });
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (activeInstance == this) {
            activeInstance = null;
        }
    }
}

