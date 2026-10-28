package com.maraei.vet;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.webkit.JavascriptInterface;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String START = "https://vetfarid.github.io/al-maraei-vet-app/";
    private static final String HOST = "vetfarid.github.io";
    private static final String PATH = "/al-maraei-vet-app";
    private String pendingText;

    private static boolean allowed(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPath() != null && (u.getPath().equals(PATH) || u.getPath().startsWith(PATH + "/"));
    }
    private WebView web;
    private ValueCallback<Uri[]> chooser;

    private class Bridge {
        @JavascriptInterface
        public void pick() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
                        startActivityForResult(i, 2);
                    } catch (Exception e) {
                    }
                }
            });
        }
    }

    // حفظ ملف (نسخة احتياطية) عبر منتقي ملفات النظام — لا يحتاج صلاحيات تخزين
    private class Files {
        @JavascriptInterface
        public void save(final String name, final String text) {
            final String safe = name == null ? "backup.json" : name.replaceAll("[^A-Za-z0-9._-]", "_");
            pendingText = text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType("application/json");
                        i.putExtra(Intent.EXTRA_TITLE, safe);
                        startActivityForResult(i, 3);
                    } catch (Exception e) {
                    }
                }
            });
        }
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF176B57);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "AndroidContacts");
        web.addJavascriptInterface(new Files(), "AndroidFiles");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (allowed(u)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = cb;
                try {
                    startActivityForResult(p.createIntent(), 1);
                } catch (Exception e) {
                    chooser = null;
                    return false;
                }
                return true;
            }
        });
        web.loadUrl(START);
    }

    private void sendContact(Uri u) {
        Cursor c = null;
        try {
            String[] cols = new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER};
            c = getContentResolver().query(u, cols, null, null, null);
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                String t = c.getString(1);
                web.evaluateJavascript("window.onContactPicked(" + JSONObject.quote(n == null ? "" : n) + "," + JSONObject.quote(t == null ? "" : t) + ")", null);
            }
        } catch (Exception e) {
        } finally {
            if (c != null) c.close();
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == 3) {
            if (res == RESULT_OK && data != null && data.getData() != null && pendingText != null) {
                try {
                    OutputStream o = getContentResolver().openOutputStream(data.getData());
                    if (o != null) {
                        o.write(pendingText.getBytes(StandardCharsets.UTF_8));
                        o.close();
                    }
                } catch (Exception e) {
                }
            }
            pendingText = null;
        } else if (req == 2) {
            if (res == RESULT_OK && data != null && data.getData() != null) sendContact(data.getData());
        } else if (req == 1 && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            chooser = null;
        } else {
            super.onActivityResult(req, res, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
