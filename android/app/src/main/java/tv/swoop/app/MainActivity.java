package tv.swoop.app;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Toast;

public class MainActivity extends Activity {
    private WebView browser;
    private static final String HOME = "https://swoop081.github.io/swoop-tv/";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        browser = new WebView(this);
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
        browser.setWebChromeClient(new WebChromeClient());
        browser.addJavascriptInterface(new Object() {
            @JavascriptInterface public void play(String url, String title) {
                runOnUiThread(() -> {
                    Uri uri = Uri.parse(url);
                    if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return;
                    Intent intent = new Intent(MainActivity.this, PlayerActivity.class);
                    intent.putExtra("url", url);
                    intent.putExtra("title", title);
                    startActivity(intent);
                });
            }
        }, "SwoopNative");
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "swoop081.github.io".equals(uri.getHost())) return false;
                try {
                    Intent external = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(external);
                } catch (Exception e) { Toast.makeText(MainActivity.this, "No compatible player installed", Toast.LENGTH_LONG).show(); }
                return true;
            }
        });
        browser.setFocusable(true);
        browser.setFocusableInTouchMode(true);
        setContentView(browser);
        browser.loadUrl(HOME);
    }
    @Override public void onBackPressed() {
        if (browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }
}
