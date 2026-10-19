package com.cyberspy404.ahmmusic;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
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
                String js = String.format(java.util.Locale.US, "if (typeof window.handleAndroidMediaAction === 'function') { window.handleAndroidMediaAction('%s', %f); }", action, value);
                activeInstance.webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;

        // Safe status bar & navigation bar: keep clock, battery, and notch cleanly separated from web UI
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(Color.parseColor("#090A0D"));
            getWindow().setNavigationBarColor(Color.parseColor("#090A0D"));
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }

        // Request Notification permission on Android 13+ (API 33+) for media playback controls
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        webView = new WebView(this);
        webView.setFitsSystemWindows(true);
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
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Bridge for native Android music player detection & MediaSession
        webView.addJavascriptInterface(new AndroidAudioBridge(this), "AndroidAudioBridge");

        webView.setWebChromeClient(new android.webkit.WebChromeClient());
        webView.setKeepScreenOn(true);

        webView.setWebViewClient(new WebViewClient() {
            private boolean handleUrlOverride(WebView view, String url) {
                if (url == null) return false;

                // Keep local bundled assets and local loopback within the webview
                if (url.startsWith("file://") || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
                    return false;
                }

                // Intercept phone dialer links (Fixes ERR_UNKNOWN_URL_SCHEME for tel:)
                if (url.startsWith("tel:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept email client links
                if (url.startsWith("mailto:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept SMS links
                if (url.startsWith("sms:") || url.startsWith("smsto:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept custom Android intent URI schemes
                if (url.startsWith("intent:")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        if (intent != null) {
                            PackageManager pm = getPackageManager();
                            if (intent.resolveActivity(pm) != null) {
                                startActivity(intent);
                                return true;
                            }
                            String fallbackUrl = intent.getStringExtra("browser_fallback_url");
                            if (fallbackUrl != null && (fallbackUrl.startsWith("http://") || fallbackUrl.startsWith("https://"))) {
                                view.loadUrl(fallbackUrl);
                                return true;
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept Phone Call Links (Open dialer directly)
                if (url.startsWith("tel:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept Email Links
                if (url.startsWith("mailto:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Intercept Google Play market links
                if (url.startsWith("market:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                // Any other non-http scheme (e.g. app schemes)
                if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("javascript:") && !url.startsWith("file://")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }

                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrlOverride(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    return handleUrlOverride(view, request.getUrl().toString());
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // If a non-http scheme failed, ignore it so it doesn't navigate to white error screen
                if (failingUrl != null && (failingUrl.startsWith("tel:") || failingUrl.startsWith("mailto:") || failingUrl.startsWith("intent:"))) {
                    return;
                }
                if (failingUrl != null && !failingUrl.startsWith("http://") && !failingUrl.startsWith("https://") && !failingUrl.startsWith("file://")) {
                    view.loadUrl("file:///android_asset/public/index.html");
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame() && request.getUrl() != null) {
                    String failingUrl = request.getUrl().toString();
                    if (failingUrl.startsWith("tel:") || failingUrl.startsWith("mailto:") || failingUrl.startsWith("intent:")) {
                        return;
                    }
                    if (!failingUrl.startsWith("http://") && !failingUrl.startsWith("https://") && !failingUrl.startsWith("file://")) {
                        view.loadUrl("file:///android_asset/public/index.html");
                    }
                }
            }

            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.proceed();
            }
        });

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
            updateMediaState(title, artist, album, coverUrl, durationSec, positionSec, isPlaying, false);
        }

        @JavascriptInterface
        public void updateMediaState(String title, String artist, String album, String coverUrl, double durationSec, double positionSec, boolean isPlaying, boolean isBuffering) {
            MediaPlaybackService service = MediaPlaybackService.getInstance();
            if (service != null) {
                service.updateDirectState(title, artist, album, coverUrl, durationSec, positionSec, isPlaying, isBuffering);
                return;
            }

            Intent intent = new Intent(context, MediaPlaybackService.class);
            intent.setAction(MediaPlaybackService.ACTION_UPDATE_STATE);
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
            intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album);
            intent.putExtra(MediaPlaybackService.EXTRA_COVER, coverUrl);
            intent.putExtra(MediaPlaybackService.EXTRA_DURATION, durationSec);
            intent.putExtra(MediaPlaybackService.EXTRA_POSITION, positionSec);
            intent.putExtra(MediaPlaybackService.EXTRA_IS_PLAYING, isPlaying);
            intent.putExtra(MediaPlaybackService.EXTRA_IS_BUFFERING, isBuffering);

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public void preloadCover(String coverUrl) {
            MediaPlaybackService service = MediaPlaybackService.getInstance();
            if (service != null && coverUrl != null && !coverUrl.isEmpty()) {
                service.preloadCover(coverUrl);
            }
        }

        @JavascriptInterface
        public void setBuffering(boolean isBuffering) {
            MediaPlaybackService service = MediaPlaybackService.getInstance();
            if (service != null) {
                service.setBuffering(isBuffering);
                return;
            }

            Intent intent = new Intent(context, MediaPlaybackService.class);
            intent.setAction(MediaPlaybackService.ACTION_UPDATE_STATE);
            intent.putExtra(MediaPlaybackService.EXTRA_IS_BUFFERING, isBuffering);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
            // Android WebView manages AudioFocus natively for <audio> elements.
            // Avoid competing audio focus request from background service which steals focus and mutes HTML5 audio.
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
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if (window.BrowserPlayer && typeof window.BrowserPlayer.syncNativeState === 'function') { window.BrowserPlayer.syncNativeState(); }", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Do NOT call webView.onPause(). Background audio playback, queue transitions,
        // and media bridge updates must continue running uninterrupted when the screen is locked or app is minimized.
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (activeInstance == this) {
            activeInstance = null;
        }
    }
}

