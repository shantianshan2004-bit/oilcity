package com.oilcity.archives;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

/**
 * 油城往事 —— 在线壳。
 *
 * 加载已部署的站点，保留其全部云端能力（登录、协作文档、音频上传与播放）。
 * 三处必须自己接管，否则在 APK 内会静默失效：
 *   1. DOM Storage —— 云端 SDK 用 localStorage 保存会话，不开则每次重启都要重新登录
 *   2. onShowFileChooser —— WebView 默认不支持 <input type="file">，留声机传音频会毫无反应
 *   3. 麦克风授权 —— 站内若走录音上传，需要把系统权限递给网页
 */
public class MainActivity extends AppCompatActivity {

    /** 站点地址：换域名时只改这一处。末尾斜杠不能省，否则相对路径会跳错层级。 */
    private static final String START_URL = "https://oil-city-archives.app.workbuddy.host/";

    /** 同域内的导航留在壳里，出了这个域交给系统浏览器。 */
    private static final String HOME_HOST = "oil-city-archives.app.workbuddy.host";

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_PERMISSIONS = 1002;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest permissionRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F3F0E8"));

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(2));
        barParams.topMargin = 0;
        root.addView(progressBar, barParams);

        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 会话持久化靠它
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);               // 版面已自适应，双指缩放在长文里反而碍事
        s.setBuiltInZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 站点自己管播放时机，别让系统再拦一层
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF); // 本站是纸色浅底，跟随系统反色会毁掉版式
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // 站内用 localStorage 存首屏状态；清缓存不能连数据一起清，否则刚登录就被登出
        webView.clearCache(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equalsIgnoreCase(HOME_HOST)
                        || host.endsWith(".workbuddy.host")
                        || host.endsWith(".workbuddy.cn"))) {
                    return false; // 站内跳转，留在壳里
                }
                openExternally(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            /** 留声机上传音频的关键：把网页的文件选择请求接到系统的选择器上。 */
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this,
                            "这台设备没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            /** 网页若请求录音/摄像头，交给系统弹窗，由用户决定。 */
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                permissionRequest = request;
                String[] wanted = request.getResources();
                java.util.ArrayList<String> needed = new java.util.ArrayList<>();
                for (String r : wanted) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        needed.add(android.Manifest.permission.RECORD_AUDIO);
                    } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                        needed.add(android.Manifest.permission.CAMERA);
                    }
                }
                if (needed.isEmpty()) {
                    request.deny();
                    return;
                }
                boolean granted = true;
                for (String p : needed) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, p)
                            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        granted = false;
                        break;
                    }
                }
                if (granted) {
                    request.grant(wanted);
                    permissionRequest = null;
                } else {
                    requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS);
                }
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "没有可以打开该链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_PERMISSIONS && permissionRequest != null) {
            boolean all = results.length > 0;
            for (int r : results) {
                if (r != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    all = false;
                    break;
                }
            }
            if (all) {
                permissionRequest.grant(permissionRequest.getResources());
            } else {
                permissionRequest.deny();
            }
            permissionRequest = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    /** 返回键先退网页历史，退到头了再退出应用——避免一点返回就把人甩出站点。 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
