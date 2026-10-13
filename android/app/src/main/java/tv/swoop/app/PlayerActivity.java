package tv.swoop.app;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

public class PlayerActivity extends Activity {
    private ExoPlayer player;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty()) { finish(); return; }
        PlayerView view = new PlayerView(this);
        view.setUseController(true);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        view.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(view);
        player = new ExoPlayer.Builder(this).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                Toast.makeText(PlayerActivity.this, "Playback failed: " + error.getErrorCodeName(), Toast.LENGTH_LONG).show();
            }
        });
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
        player.prepare();
        player.play();
    }
    @Override protected void onStop() {
        super.onStop();
        if (player != null) { player.release(); player = null; }
    }
}
