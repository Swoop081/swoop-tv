package tv.swoop.app;

import android.app.Activity;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;
import android.content.res.Configuration;
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
        boolean isTv = "tv".equals(BuildConfig.FLAVOR);
        if (isTv) {
            browser.getSettings().setUseWideViewPort(true);
            browser.getSettings().setLoadWithOverviewMode(true);
            browser.setInitialScale(75);
        }
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
        browser.setWebChromeClient(new WebChromeClient());
        browser.addJavascriptInterface(new Object() {
            @JavascriptInterface public String request(String address, int timeoutMs) {
                HttpURLConnection connection = null;
                try {
                    URL target = new URL(address);
                    String scheme = target.getProtocol();
                    if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) throw new Exception("Unsupported URL");
                    connection = (HttpURLConnection) target.openConnection();
                    connection.setConnectTimeout(Math.min(Math.max(timeoutMs, 1000), 30000));
                    connection.setReadTimeout(Math.min(Math.max(timeoutMs, 1000), 30000));
                    connection.setRequestProperty("Accept", "application/json");
                    int status = connection.getResponseCode();
                    InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    if (input != null) {
                        try (InputStream stream = input) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = stream.read(buffer)) != -1) {
                                output.write(buffer, 0, count);
                                if (output.size() > 25000000) throw new Exception("Response too large");
                            }
                        }
                    }
                    return new JSONObject().put("ok", status >= 200 && status < 300).put("status", status).put("body", output.toString("UTF-8")).toString();
                } catch (Exception error) {
                    return "{\"ok\":false,\"status\":0,\"error\":" + JSONObject.quote(error.getClass().getSimpleName() + ": " + error.getMessage()) + "}";
                } finally { if (connection != null) connection.disconnect(); }
            }
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
