package com.cyberspy404.ahmmusic;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private long lastBackPressedTime = 0;
    private Toast exitToast;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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

        webView.setWebViewClient(new WebViewClient());

        // Loads local bundled web assets, or fallback to dev bot IP
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            // First ask the web app if it has internal navigation/modals/expanded player to handle
            webView.evaluateJavascript("(function(){ if (typeof window.handleAppBack === 'function') { return window.handleAppBack(); } return false; })()", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    new Handler(Looper.getMainLooper()).post(() -> {
                        // "true" means JavaScript handled closing modal / expanded player / navigating back a view
                        if ("true".equalsIgnoreCase(value)) {
                            return;
                        }

                        // Otherwise check if WebView history can navigate back
                        if (webView.canGoBack()) {
                            webView.goBack();
                            return;
                        }

                        // At root page with nothing open: require double-tap back within 2 seconds to exit
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
}
