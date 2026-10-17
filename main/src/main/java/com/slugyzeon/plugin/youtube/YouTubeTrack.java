package com.slugyzeon.plugin.youtube;

import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.source.AudioSourceManager;
import com.sedmelluq.discord.lavaplayer.tools.FriendlyException;
import com.sedmelluq.discord.lavaplayer.track.*;
import com.sedmelluq.discord.lavaplayer.track.playback.LocalAudioTrackExecutor;
import com.sedmelluq.discord.lavaplayer.container.MediaContainerDetection;
import com.sedmelluq.discord.lavaplayer.container.MediaContainerDetectionResult;
import com.sedmelluq.discord.lavaplayer.container.MediaContainerHints;
import com.sedmelluq.discord.lavaplayer.container.MediaContainerRegistry;
import java.net.URI;
import java.util.concurrent.CompletableFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class YouTubeTrack extends DelegatedAudioTrack {

    private static final Logger log = LoggerFactory.getLogger(YouTubeTrack.class);
    private static final String UA = "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
    
    private static final java.util.Map<String, String> MIRROR_SOURCES = new java.util.LinkedHashMap<>();
    static {
        MIRROR_SOURCES.put("spotify", "spsearch:");
        MIRROR_SOURCES.put("deezer", "dzsearch:");
        MIRROR_SOURCES.put("jiosaavn", "jssearch:");
        MIRROR_SOURCES.put("applemusic", "amsearch:");
    }
    private final YouTubeSourceManager sourceManager;
    private final String videoId;
    private final AudioTrack originalTrack;
    public YouTubeTrack(AudioTrackInfo trackInfo, String videoId, AudioTrack originalTrack,
            YouTubeSourceManager sourceManager) {
        super(trackInfo);
        this.videoId = videoId;
        this.originalTrack = originalTrack;
        this.sourceManager = sourceManager;
    }

    public AudioTrack getOriginalTrack() {
        return originalTrack;
    }

    private String cleanTitle(String title) {
        if (title == null) return "";
        String cleaned = title.replaceAll("(?i)\\s*[\\(\\[\\{【].*?[\\)\\]\\}】]", "");
        cleaned = cleaned.replaceAll("\\p{IsEmoji}+", "");
        cleaned = cleaned.replaceAll("(?i)\\s*\\b(?:official|music video|lyric video|lyrics|audio|hd|hq|4k|8k|full hd|1080p|720p|live|cover|remaster|remastered|feat\\.?|ft\\.?|remix)\\b.*", "");
        cleaned = cleaned.replaceAll("\\s*\\|.*", "");
        cleaned = cleaned.replaceAll("(?i)\\b(?:prod\\.?|produced)\\s+by\\b.*", "");
        cleaned = cleaned.replaceAll("\\s*[-|/:;*]+\\s*$", "");
        cleaned = cleaned.replaceAll("\\s{2,}", " ");
        return cleaned.trim();
    }

    @Override
    public void process(LocalAudioTrackExecutor executor) throws Exception {
        com.slugyzeon.plugin.islamic.IslamicAudioFilter.assertIslamicTrack(this);
        InternalAudioTrack fallback = null;
        if (originalTrack instanceof InternalAudioTrack) {
            fallback = (InternalAudioTrack) originalTrack;
        } else {
            try {
                AudioSourceManager ytSource = sourceManager.getOriginalYouTubeSource();
                if (ytSource != null) {
                    AudioPlayerManager manager = sourceManager.getAudioPlayerManager().apply(null);
                    AudioItem item = ytSource.loadItem(manager, new AudioReference(videoId, null));
                    if (item instanceof AudioTrack && item instanceof InternalAudioTrack) {
                        fallback = (InternalAudioTrack) item;
                    }
                }
            } catch (Exception ignored) {
            }
        }

        if (fallback != null) {
            try {
                processDelegate(fallback, executor);
                return;
            } catch (Exception e) {
                if (!sourceManager.isMirror() || trackInfo.isStream) {
                    throw e;
                }

                AudioPlayerManager manager = sourceManager.getAudioPlayerManager().apply(null);
                if (manager == null) throw e;

                java.util.Set<String> activeSources = new java.util.HashSet<>();
                for (AudioSourceManager sm : manager.getSourceManagers()) {
                    activeSources.add(sm.getSourceName());
                }

                for (java.util.Map.Entry<String, String> entry : MIRROR_SOURCES.entrySet()) {
                    if (!activeSources.contains(entry.getKey())) continue;
                    try {
                        AudioItem item = loadItemSync(manager, entry.getValue() + cleanTitle(trackInfo.title));
                        if (item instanceof AudioPlaylist && !((AudioPlaylist) item).getTracks().isEmpty()) {
                            item = ((AudioPlaylist) item).getTracks().get(0);
                        }
                        if (item instanceof InternalAudioTrack) {
                            log.info("Playing \"{}\" (Resolved) using {}!", cleanTitle(trackInfo.title), entry.getKey());
                            processDelegate((InternalAudioTrack) item, executor);
                            return;
                        }
                    } catch (Exception ignored) {
                    }
                }
                throw e;
            }
        }

        throw new FriendlyException(
                "Cannot play YouTube track (no source available)",
                FriendlyException.Severity.SUSPICIOUS,
                new RuntimeException("Video " + videoId));
    }

    private AudioItem loadItemSync(AudioPlayerManager manager, String reference) throws Exception {
        CompletableFuture<AudioItem> future = new CompletableFuture<>();
        manager.loadItem(reference, new com.sedmelluq.discord.lavaplayer.player.AudioLoadResultHandler() {
            @Override
            public void trackLoaded(AudioTrack track) {
                future.complete(track);
            }
            @Override
            public void playlistLoaded(AudioPlaylist playlist) {
                future.complete(playlist);
            }
            @Override
            public void noMatches() {
                future.complete(null);
            }
            @Override
            public void loadFailed(FriendlyException exception) {
                future.completeExceptionally(exception);
            }
        });
        return future.get(10, java.util.concurrent.TimeUnit.SECONDS);
    }

    @Override
    public AudioSourceManager getSourceManager() {
        return sourceManager;
    }

    @Override
    protected AudioTrack makeShallowClone() {
        return new YouTubeTrack(trackInfo, videoId, originalTrack, sourceManager);
    }
}