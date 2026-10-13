package tv.swoop.app;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.util.Log;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.ui.PlayerView;

public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private FrameLayout root;
    private LinearLayout errorPanel;
    private TextView errorText;
    private String originalUrl;
    private boolean triedHls;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        originalUrl=getIntent().getStringExtra("url");
        if(originalUrl==null||originalUrl.isEmpty()){finish();return;}
        getWindow().getDecorView().setSystemUiVisibility(5894|1024|512);
        root=new FrameLayout(this);
        root.setBackgroundColor(0xff000000);
        setContentView(root);
        PlayerView view=new PlayerView(this);
        view.setUseController(true);
        root.addView(view,new FrameLayout.LayoutParams(-1,-1));
        errorPanel=new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(36,24,36,24);
        errorPanel.setBackgroundColor(0xee11151d);
        errorText=new TextView(this);
        errorText.setTextColor(0xffffffff);
        errorText.setTextSize(17);
        errorText.setGravity(Gravity.CENTER);
        errorPanel.addView(errorText,new LinearLayout.LayoutParams(-1,-2));
        Button retry=new Button(this);retry.setText("Retry stream");retry.setOnClickListener(v->{triedHls=false;errorPanel.setVisibility(android.view.View.GONE);playUrl(originalUrl);});
        errorPanel.addView(retry);
        Button close=new Button(this);close.setText("Back to SwoopTV");close.setOnClickListener(v->finish());
        errorPanel.addView(close);
        FrameLayout.LayoutParams overlay=new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER);
        root.addView(errorPanel,overlay);
        errorPanel.setVisibility(android.view.View.GONE);
        DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory()
            .setUserAgent("VLC/3.0.20 LibVLC/3.0.20")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000);
        player=new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this,http))).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener(){
            @Override public void onPlayerError(PlaybackException error){
                int status=0;Throwable cause=error;
                while(cause!=null){if(cause instanceof HttpDataSource.InvalidResponseCodeException){status=((HttpDataSource.InvalidResponseCodeException)cause).responseCode;break;}cause=cause.getCause();}
                Log.e("SwoopTVPlayer","Playback failed: "+error.getErrorCodeName()+" HTTP "+status+" (stream URL redacted)",error);
                if(!triedHls&&originalUrl.endsWith(".ts")){
                    triedHls=true;
                    playUrl(originalUrl.substring(0,originalUrl.length()-3)+".m3u8");
                    return;
                }
                String message="Unable to play this channel.\n"+error.getErrorCodeName()+(status>0?" · HTTP "+status:"")+"\n\n"+(status==401||status==403?"The streaming server rejected access. Check the provider's stream permissions.":status==404?"The provider did not return a stream for this channel.":"The stream may be unavailable or use an unsupported format.");
                errorText.setText(message);
                errorPanel.setVisibility(android.view.View.VISIBLE);
            }
        });
        playUrl(originalUrl);
    }
    private void playUrl(String url){player.stop();player.clearMediaItems();player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));player.prepare();player.play();}
    @Override protected void onStop(){super.onStop();if(player!=null){player.release();player=null;}}
}
