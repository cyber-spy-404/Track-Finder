package com.cyberspy404.ahmmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "spy_sec_music_playback";
    public static final int NOTIFICATION_ID = 40401;

    public static final String ACTION_PLAY = "com.cyberspy404.ahmmusic.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.cyberspy404.ahmmusic.ACTION_PAUSE";
    public static final String ACTION_TOGGLE = "com.cyberspy404.ahmmusic.ACTION_TOGGLE";
    public static final String ACTION_NEXT = "com.cyberspy404.ahmmusic.ACTION_NEXT";
    public static final String ACTION_PREV = "com.cyberspy404.ahmmusic.ACTION_PREV";
    public static final String ACTION_SEEK = "com.cyberspy404.ahmmusic.ACTION_SEEK";
    public static final String ACTION_UPDATE_STATE = "com.cyberspy404.ahmmusic.ACTION_UPDATE_STATE";
    public static final String ACTION_STOP = "com.cyberspy404.ahmmusic.ACTION_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_ALBUM = "extra_album";
    public static final String EXTRA_COVER = "extra_cover";
    public static final String EXTRA_DURATION = "extra_duration";
    public static final String EXTRA_POSITION = "extra_position";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";
    public static final String EXTRA_SEEK_POS = "extra_seek_pos";

    private static MediaPlaybackService instance;
    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;

    private String currentTitle = "Spy Sec Music";
    private String currentArtist = "CyberSpy 404";
    private String currentAlbum = "Lossless Audio";
    private String currentCover = "";
    private double currentDuration = 0.0;
    private double currentPosition = 0.0;
    private boolean isCurrentlyPlaying = false;

    private Bitmap cachedCoverBitmap = null;
    private String lastCoverLoaded = "";
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private PowerManager.WakeLock wakeLock;

    public static MediaPlaybackService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SpySecMusic:PlaybackWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}

        createNotificationChannel();
        initMediaSession();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Spy Sec Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active playback controls, song title, and live scrubbable progress bar");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "SpySecMusicSession");
        mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                MainActivity.dispatchMediaAction("play", 0);
            }

            @Override
            public void onPause() {
                MainActivity.dispatchMediaAction("pause", 0);
            }

            @Override
            public void onSkipToNext() {
                MainActivity.dispatchMediaAction("next", 0);
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.dispatchMediaAction("prev", 0);
            }

            @Override
            public void onSeekTo(long posMs) {
                double posSec = posMs / 1000.0;
                MainActivity.dispatchMediaAction("seek", posSec);
            }

            @Override
            public void onStop() {
                abandonAudioFocus();
                MainActivity.dispatchMediaAction("stop", 0);
                stopForeground(true);
                stopSelf();
            }
        });

        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_STICKY;
        }

        String action = intent.getAction();
        switch (action) {
            case ACTION_PLAY:
                MainActivity.dispatchMediaAction("play", 0);
                break;
            case ACTION_PAUSE:
                MainActivity.dispatchMediaAction("pause", 0);
                break;
            case ACTION_TOGGLE:
                if (isCurrentlyPlaying) {
                    MainActivity.dispatchMediaAction("pause", 0);
                } else {
                    MainActivity.dispatchMediaAction("play", 0);
                }
                break;
            case ACTION_NEXT:
                MainActivity.dispatchMediaAction("next", 0);
                break;
            case ACTION_PREV:
                MainActivity.dispatchMediaAction("prev", 0);
                break;
            case ACTION_SEEK:
                double seekPos = intent.getDoubleExtra(EXTRA_SEEK_POS, 0.0);
                MainActivity.dispatchMediaAction("seek", seekPos);
                break;
            case ACTION_UPDATE_STATE:
                handleUpdateState(intent);
                break;
            case ACTION_STOP:
                abandonAudioFocus();
                MainActivity.dispatchMediaAction("stop", 0);
                stopForeground(true);
                stopSelf();
                break;
        }

        return START_STICKY;
    }

    private void handleUpdateState(Intent intent) {
        currentTitle = intent.getStringExtra(EXTRA_TITLE);
        currentArtist = intent.getStringExtra(EXTRA_ARTIST);
        currentAlbum = intent.getStringExtra(EXTRA_ALBUM);
        String cover = intent.getStringExtra(EXTRA_COVER);
        currentDuration = intent.getDoubleExtra(EXTRA_DURATION, 0.0);
        currentPosition = intent.getDoubleExtra(EXTRA_POSITION, 0.0);
        isCurrentlyPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false);

        if (isCurrentlyPlaying) {
            if (wakeLock != null && !wakeLock.isHeld()) {
                try { wakeLock.acquire(12 * 60 * 60 * 1000L); } catch (Exception ignored) {}
            }
        } else {
            if (wakeLock != null && wakeLock.isHeld()) {
                try { wakeLock.release(); } catch (Exception ignored) {}
            }
        }

        if (currentTitle == null || currentTitle.isEmpty()) currentTitle = "Spy Sec Music";
        if (currentArtist == null || currentArtist.isEmpty()) currentArtist = "CyberSpy 404";
        if (currentAlbum == null || currentAlbum.isEmpty()) currentAlbum = "Lossless Audio";

        if (cover != null && !cover.equals(currentCover)) {
            currentCover = cover;
            loadCoverBitmap(cover);
        } else {
            publishPlaybackState();
        }
    }

    private void loadCoverBitmap(String coverUrl) {
        if (coverUrl.equals(lastCoverLoaded) && cachedCoverBitmap != null) {
            publishPlaybackState();
            return;
        }

        imageExecutor.execute(() -> {
            Bitmap bmp = null;
            try {
                if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
                    URL url = new URL(coverUrl);
                    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                    connection.setDoInput(true);
                    connection.setConnectTimeout(4000);
                    connection.setReadTimeout(4000);
                    connection.connect();
                    InputStream input = connection.getInputStream();
                    bmp = BitmapFactory.decodeStream(input);
                } else if (coverUrl.startsWith("file:///android_asset/")) {
                    String assetPath = coverUrl.replace("file:///android_asset/", "");
                    InputStream is = getAssets().open(assetPath);
                    bmp = BitmapFactory.decodeStream(is);
                }
            } catch (Exception ignored) {
            }

            if (bmp == null) {
                try {
                    bmp = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
                } catch (Exception ignored) {}
            }

            cachedCoverBitmap = bmp;
            lastCoverLoaded = coverUrl;
            publishPlaybackState();
        });
    }

    public void publishPlaybackState() {
        if (mediaSession == null) return;

        long durationMs = (long) (currentDuration * 1000);
        long positionMs = (long) (currentPosition * 1000);

        // 1. Build & Push MediaMetadataCompat (REQUIRED for Android 10+ system seekbar & track info)
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);

        if (cachedCoverBitmap != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cachedCoverBitmap);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, cachedCoverBitmap);
        }

        mediaSession.setMetadata(metaBuilder.build());

        // 2. Build & Push PlaybackStateCompat (Enables live scrubbable progress bar on Android 10, 11, 12, 13, 14, 15)
        long actions = PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_SEEK_TO |
                PlaybackStateCompat.ACTION_STOP;

        int state = isCurrentlyPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        float speed = isCurrentlyPlaying ? 1.0f : 0.0f;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, positionMs, speed);

        mediaSession.setPlaybackState(stateBuilder.build());

        // 3. Build MediaStyle Notification
        Notification notification = buildMediaNotification();

        if (isCurrentlyPlaying) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } else {
            // Keep notification showing in notification tray so user can resume playback anytime
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private Notification buildMediaNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pContent = PendingIntent.getActivity(
                this,
                0,
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent pPrev = buildActionPendingIntent(ACTION_PREV, 1);
        PendingIntent pToggle = buildActionPendingIntent(ACTION_TOGGLE, 2);
        PendingIntent pNext = buildActionPendingIntent(ACTION_NEXT, 3);

        int playPauseIcon = isCurrentlyPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseTitle = isCurrentlyPlaying ? "Pause" : "Play";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist + " • " + currentAlbum)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pContent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(isCurrentlyPlaying)
                .addAction(android.R.drawable.ic_media_previous, "Previous", pPrev)
                .addAction(playPauseIcon, playPauseTitle, pToggle)
                .addAction(android.R.drawable.ic_media_next, "Next", pNext)
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2)
                        .setShowCancelButton(true)
                        .setCancelButtonIntent(buildActionPendingIntent(ACTION_STOP, 4))
                );

        if (cachedCoverBitmap != null) {
            builder.setLargeIcon(cachedCoverBitmap);
        }

        return builder.build();
    }

    private PendingIntent buildActionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
    }

    public boolean requestAudioFocus() {
        if (audioManager == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();

            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            MainActivity.dispatchMediaAction("pause", 0);
                        }
                    })
                    .build();

            return audioManager.requestAudioFocus(audioFocusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            return audioManager.requestAudioFocus(
                    focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            MainActivity.dispatchMediaAction("pause", 0);
                        }
                    },
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    public void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        abandonAudioFocus();
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        imageExecutor.shutdown();
        instance = null;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
