package com.slugyzeon.plugin.youtube;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.source.AudioSourceManager;
import com.sedmelluq.discord.lavaplayer.track.*;

import java.io.DataInput;
import java.io.DataOutput;
import java.io.IOException;
import java.lang.reflect.Field;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class YouTubeSourceManager implements AudioSourceManager {

    private static final Logger log = LoggerFactory.getLogger(YouTubeSourceManager.class);
    private static final String oembedUrl = "https://www.youtube.com/oembed?url=";
    private static final java.util.regex.Pattern VIDEO_ID_PATTERN = java.util.regex.Pattern.compile(
            "(?i)(?:v=|vi=|v/|vi/|youtu\\.be/|embed/|shorts/)([a-zA-Z0-9_-]{11})"
    );
    private final Function<Void, AudioPlayerManager> audioPlayerManager;
    private AudioSourceManager originalYouTubeSource;
    private final boolean oembed;
    private final boolean mirror;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.ALWAYS)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();

    public YouTubeSourceManager(
            boolean oembed,
            boolean mirror,
            Function<Void, AudioPlayerManager> audioPlayerManager) {
        this.oembed = oembed;
        this.mirror = mirror;
        this.audioPlayerManager = audioPlayerManager;
    }

    private static class OembedData {
        String title;
        String authorName;
        int width;
        int height;
        String type;
    }

    public Function<Void, AudioPlayerManager> getAudioPlayerManager() {
        return audioPlayerManager;
    }

    public boolean isMirror() {
        return mirror;
    }

    public AudioSourceManager getOriginalYouTubeSource() {
        return originalYouTubeSource;
    }

    @SuppressWarnings("unchecked")
    public boolean attachToYouTube(AudioPlayerManager manager) {
        List<AudioSourceManager> sources = findSourceList(manager);
        if (sources == null)
            return false;

        for (int i = 0; i < sources.size(); i++) {
            AudioSourceManager source = sources.get(i);
            if (source instanceof YouTubeSourceManager)
                continue;

            boolean isYouTube = "youtube".equalsIgnoreCase(source.getSourceName());
            if (!isYouTube) {
                String className = source.getClass().getName().toLowerCase();
                isYouTube = className.contains("youtube") || className.contains("youtubeaudiosource");
            }

            if (isYouTube) {
                this.originalYouTubeSource = source;
                sources.set(i, this);
                return true;
            }
        }

        return false;
    }

    @SuppressWarnings("unchecked")
    private List<AudioSourceManager> findSourceList(AudioPlayerManager manager) {
        Class<?> clazz = manager.getClass();

        while (clazz != null && clazz != Object.class) {
            for (Field field : clazz.getDeclaredFields()) {
                try {
                    field.setAccessible(true);
                    Object value = field.get(manager);
                    if (value instanceof List) {
                        List<?> list = (List<?>) value;
                        if (!list.isEmpty() && list.get(0) instanceof AudioSourceManager) {
                            return (List<AudioSourceManager>) value;
                        }
                        if (list.isEmpty() && field.getName().toLowerCase().contains("source")) {
                            return (List<AudioSourceManager>) value;
                        }
                    }
                } catch (Exception ignored) {
                }
            }
            clazz = clazz.getSuperclass();
        }

        return null;
    }

    @Override
    public String getSourceName() {
        return "youtube";
    }

    private boolean isYouTubeUrl(String url) {
        return url != null && (url.startsWith("http://") || url.startsWith("https://")) 
            && (url.contains("youtube.com") || url.contains("youtu.be"));
    }

    private String extractVideoId(String url) {
        if (url == null) return null;
        java.util.regex.Matcher matcher = VIDEO_ID_PATTERN.matcher(url);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    private OembedData fetchOembedData(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(oembedUrl + url))
                .GET()
                .build();
        HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() == 200) {
            JsonNode json = mapper.readTree(res.body());
            OembedData data = new OembedData();
            data.title = json.has("title") ? json.get("title").asText() : null;
            data.authorName = json.has("author_name") ? json.get("author_name").asText() : null;
            data.width = json.has("width") ? json.get("width").asInt() : 0;
            data.height = json.has("height") ? json.get("height").asInt() : 0;
            data.type = data.width > data.height ? "video" : "short";
            return data;
        }
        return null;
    }

    @Override
    public AudioItem loadItem(AudioPlayerManager manager, AudioReference reference) {
        if (originalYouTubeSource == null)
            return null;

        if (reference != null && reference.identifier != null) {
            String id = reference.identifier;
            if (id.startsWith("ytsearch:") || id.startsWith("ytmsearch:")) {
                String prefix = id.startsWith("ytsearch:") ? "ytsearch:" : "ytmsearch:";
                String query = id.substring(prefix.length()).trim();
                com.slugyzeon.plugin.islamic.IslamicAudioFilter.assertIslamicQuery(query);
                query = com.slugyzeon.plugin.islamic.IslamicAudioFilter.sanitizeSearchQuery(query);
                reference = new AudioReference(prefix + query, reference.title);
            }
        }

        AudioItem result = null;
        Exception loadException = null;

        try {
            result = originalYouTubeSource.loadItem(manager, reference);
        } catch (Exception e) {
            loadException = e;
        }

        if ((result == null || loadException != null) && oembed && isYouTubeUrl(reference.identifier)) {
            try {
                OembedData data = fetchOembedData(reference.identifier);
                if (data != null && data.title != null) {
                    String[] prefixes = {"ytsearch:", "ytmsearch:"};
                    String query = data.title + (data.authorName != null ? " " + data.authorName : "");
                    for (String prefix : prefixes) {
                        AudioItem searchResult = originalYouTubeSource.loadItem(manager, new AudioReference(prefix + query, null));
                        
                        if (searchResult instanceof AudioPlaylist) {
                            String videoId = extractVideoId(reference.identifier);
                            for (AudioTrack track : ((AudioPlaylist) searchResult).getTracks()) {
                                if (track.getIdentifier().equals(videoId) && !track.getInfo().isStream) {
                                    log.info("Resolved \"{}\" via https://youtube.com/oembed", track.getInfo().title);
                                    result = track;
                                    break;
                                }
                            }
                        } else if (searchResult instanceof AudioTrack) {
                            AudioTrack track = (AudioTrack) searchResult;
                            String videoId = extractVideoId(reference.identifier);
                            if (track.getIdentifier().equals(videoId) && !track.getInfo().isStream) {
                                log.info("Resolved \"{}\" via https://youtube.com/oembed", track.getInfo().title);
                                result = track;
                            }
                        }
                        if (result != null) break;
                    }
                }
            } catch (Exception ignored) {
            }
        }

        if (result != null) {
            if (result instanceof AudioTrack) {
                AudioTrack track = (AudioTrack) result;
                com.slugyzeon.plugin.islamic.IslamicAudioFilter.assertIslamicTrack(track);
                return wrapTrack(track);
            }
            if (result instanceof AudioPlaylist) {
                AudioPlaylist original = (AudioPlaylist) result;
                List<AudioTrack> filteredTracks = com.slugyzeon.plugin.islamic.IslamicAudioFilter.filterTracks(original.getTracks());
                if (filteredTracks.isEmpty()) {
                    return AudioReference.NO_TRACK;
                }
                List<AudioTrack> fixedTracks = new ArrayList<>();
                for (AudioTrack track : filteredTracks) {
                    fixedTracks.add(wrapTrack(track));
                }
                AudioTrack selectedTrack = original.getSelectedTrack() != null && com.slugyzeon.plugin.islamic.IslamicAudioFilter.isIslamicTrack(original.getSelectedTrack())
                        ? wrapTrack(original.getSelectedTrack())
                        : null;
                return new BasicAudioPlaylist(original.getName(), fixedTracks, selectedTrack, original.isSearchResult());
            }
            return result;
        }

        if (loadException != null && loadException instanceof RuntimeException) {
            throw (RuntimeException) loadException;
        }

        return null;
    }



    private AudioTrack wrapTrack(AudioTrack original) {
        return new YouTubeTrack(original.getInfo(), original.getInfo().identifier, original, this);
    }

    @Override
    public boolean isTrackEncodable(AudioTrack track) {
        if (track instanceof YouTubeTrack) {
            AudioTrack original = ((YouTubeTrack) track).getOriginalTrack();
            if (original != null && originalYouTubeSource != null) {
                return originalYouTubeSource.isTrackEncodable(original);
            }
            return true;
        }
        return originalYouTubeSource != null ? originalYouTubeSource.isTrackEncodable(track) : true;
    }

    @Override
    public void encodeTrack(AudioTrack track, DataOutput output) throws IOException {
        if (track instanceof YouTubeTrack) {
            AudioTrack original = ((YouTubeTrack) track).getOriginalTrack();
            if (original != null && originalYouTubeSource != null) {
                output.writeBoolean(true);
                originalYouTubeSource.encodeTrack(original, output);
            } else {
                output.writeBoolean(false);
            }
        } else if (originalYouTubeSource != null) {
            output.writeBoolean(true);
            originalYouTubeSource.encodeTrack(track, output);
        } else {
            output.writeBoolean(false);
        }
    }

    @Override
    public AudioTrack decodeTrack(AudioTrackInfo trackInfo, DataInput input) throws IOException {
        AudioTrack original = null;
        try {
            boolean hasOriginal = input.readBoolean();
            if (hasOriginal && originalYouTubeSource != null) {
                original = originalYouTubeSource.decodeTrack(trackInfo, input);
            }
        } catch (Exception ignored) {
        }
        
        return new YouTubeTrack(trackInfo, trackInfo.identifier, original, this);
    }

    @Override
    public void shutdown() {
        if (originalYouTubeSource != null)
            originalYouTubeSource.shutdown();
    }
}