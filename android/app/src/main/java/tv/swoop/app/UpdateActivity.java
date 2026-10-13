package tv.swoop.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ProgressBar;
import androidx.core.content.FileProvider;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;

public class UpdateActivity extends Activity {
    private static final String MANIFEST = "https://swoop081.github.io/swoop-tv/android-update.json";
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView status;
    private long downloadId = -1;
    private String apkName;
    private boolean installing = false;
    private BroadcastReceiver receiver;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(36,36,36,36);
        layout.setBackgroundColor(0xff0d0e12);
        TextView logo = new TextView(this);
        logo.setText("SwoopTV");
        logo.setTextColor(0xffffffff);
        logo.setTextSize(38);
        logo.setGravity(Gravity.CENTER);
        layout.addView(logo);
        ProgressBar spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spin = new LinearLayout.LayoutParams(80,80);
        spin.topMargin = 32; spin.gravity = Gravity.CENTER;
        layout.addView(spinner,spin);
        status = new TextView(this);
        status.setText("Checking for updates…");
        status.setTextColor(0xffcccccc);
        status.setTextSize(17);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0,24,0,0);
        layout.addView(status);
        setContentView(layout);
        check();
    }
    private void check() {
        new Thread(() -> {
            try {
                HttpURLConnection conn=(HttpURLConnection)new URL(MANIFEST+"?t="+System.currentTimeMillis()).openConnection();
                conn.setConnectTimeout(8000);conn.setReadTimeout(8000);
                conn.setRequestProperty("Cache-Control","no-cache");
                if(conn.getResponseCode()!=200)throw new Exception("Update service unavailable");
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                try(InputStream in=conn.getInputStream()){byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1){bytes.write(buf,0,n);if(bytes.size()>65536)throw new Exception("Invalid update metadata");}}
                JSONObject data=new JSONObject(bytes.toString("UTF-8"));
                String flavor=BuildConfig.FLAVOR;
                JSONObject item=data.getJSONObject(flavor);
                int latest=item.getInt("versionCode");
                String url=item.getString("url");
                if(!url.startsWith("https://github.com/Swoop081/swoop-tv/releases/download/"))throw new Exception("Invalid update URL");
                if(latest>BuildConfig.VERSION_CODE)main.post(()->offerUpdate(url,latest));
                else main.post(this::launch);
            }catch(Exception e){main.post(()->new AlertDialog.Builder(this).setTitle("Update check unavailable").setMessage("Could not check for a new SwoopTV version. You can retry or continue with the installed version.").setPositiveButton("Retry",(d,w)->check()).setNegativeButton("Continue", (d,w)->launch()).setCancelable(false).show());}
        }).start();
    }
    private void offerUpdate(String url,int version) {
        status.setText("SwoopTV update available");
        new AlertDialog.Builder(this).setTitle("SwoopTV update available").setMessage("A newer version is available. Download and install it before continuing. Android will ask you to approve installation.").setPositiveButton("Update",(d,w)->download(url,version)).setNegativeButton("Later",(d,w)->launch()).setCancelable(false).show();
    }
    private void download(String url,int version) {
        if(Build.VERSION.SDK_INT>=26&&!getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(this).setTitle("Allow SwoopTV updates").setMessage("Enable 'Allow from this source' for SwoopTV, then return to download the update.").setPositiveButton("Open settings",(d,w)->{Intent i=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName()));startActivity(i);status.setText("Return here to install the update");}).setNegativeButton("Cancel",(d,w)->launch()).show();
            return;
        }
        try {
            apkName="swooptv-"+BuildConfig.FLAVOR+"-"+version+".apk";
            DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));
            req.setTitle("SwoopTV update");
            req.setDescription("Downloading SwoopTV");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(this,Environment.DIRECTORY_DOWNLOADS,apkName);
            DownloadManager dm=(DownloadManager)getSystemService(DOWNLOAD_SERVICE);
            downloadId=dm.enqueue(req);
            status.setText("Downloading update…");
            receiver=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){if(i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID,-1)!=downloadId)return;DownloadManager.Query q=new DownloadManager.Query().setFilterById(downloadId);try(android.database.Cursor cursor=dm.query(q)){if(cursor!=null&&cursor.moveToFirst()){int state=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));if(state==DownloadManager.STATUS_SUCCESSFUL){install();return;}}}status.setText("Download failed");new AlertDialog.Builder(UpdateActivity.this).setMessage("Update download failed.").setPositiveButton("Retry",(d,w)->check()).setNegativeButton("Continue",(d,w)->launch()).show();}};
            IntentFilter filter=new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if(Build.VERSION.SDK_INT>=33)registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(receiver,filter);
        }catch(Exception e){status.setText("Update download failed");new AlertDialog.Builder(this).setMessage("Could not download the update.").setPositiveButton("Retry",(d,w)->check()).setNegativeButton("Continue",(d,w)->launch()).show();}
    }
    private void install() {
        try {
            File file=new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),apkName);
            Uri uri=FileProvider.getUriForFile(this,getPackageName()+".updates",file);
            Intent intent=new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri,"application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
            installing=true;
            status.setText("Approve installation to finish updating");
            startActivity(intent);
        }catch(Exception e){new AlertDialog.Builder(this).setMessage("Unable to open Android installer.").setPositiveButton("Continue",(d,w)->launch()).show();}
    }
    @Override protected void onResume(){super.onResume();if(installing){installing=false;main.postDelayed(()->{if(!isFinishing())check();},1200);}}
    private void launch(){startActivity(new Intent(this,MainActivity.class));finish();}
    @Override protected void onDestroy(){if(receiver!=null){try{unregisterReceiver(receiver);}catch(Exception ignored){}}super.onDestroy();}
}
