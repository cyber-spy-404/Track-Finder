package com.slugyzeon.plugin.islamic;

import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.source.AudioSourceManager;
import com.sedmelluq.discord.lavaplayer.tools.FriendlyException;
import com.sedmelluq.discord.lavaplayer.tools.io.HttpConfigurable;
import com.sedmelluq.discord.lavaplayer.track.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.impl.client.HttpClientBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.DataInput;
import java.io.DataOutput;
import java.io.IOException;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Universal AudioSourceManager wrapper.
 * Intercepts all external audio sources (SoundCloud, HTTP, Bandcamp, Twitch, Vimeo, etc.)
 * to enforce strict Islamic audio filtering and block secular tracks.
 */
public class IslamicAudioSourceWrapper implements AudioSourceManager, HttpConfigurable {

    private static final Logger log = LoggerFactory.getLogger(IslamicAudioSourceWrapper.class);

    private final AudioSourceManager delegate;

    public IslamicAudioSourceWrapper(AudioSourceManager delegate) {
        this.delegate = delegate;
    }

    public AudioSourceManager getDelegate() {
        return delegate;
    }

    @Override
    public String getSourceName() {
        return delegate.getSourceName();
    }

    @Override
    public AudioItem loadItem(AudioPlayerManager manager, AudioReference reference) {
        if (IslamicAudioFilter.isEnabled()) {
            if (IslamicAudioFilter.isStrictFiltering() && reference != null && reference.identifier != null) {
                // If the search query or reference itself contains explicitly blocked terms, reject
                try {
                    IslamicAudioFilter.assertIslamicQuery(reference.identifier);
                } catch (FriendlyException e) {
                    log.warn("Search query rejected on [{}]: {}", delegate.getSourceName(), reference.identifier);
                    throw e;
                }
            }
        }

        AudioItem item;
        try {
            item = delegate.loadItem(manager, reference);
        } catch (FriendlyException fe) {
            throw fe;
        } catch (Exception e) {
            log.warn("Error loading item from [{}]: {}", delegate.getSourceName(), e.getMessage());
            return AudioReference.NO_TRACK;
        }

        if (item == null || item == AudioReference.NO_TRACK) {
            return item;
        }

        if (IslamicAudioFilter.isEnabled()) {
            if (item instanceof AudioTrack) {
                AudioTrack track = (AudioTrack) item;
                if (!IslamicAudioFilter.isIslamicTrack(track)) {
                    log.warn("Blocked non-Islamic track on [{}]: \"{}\" by \"{}\"",
                            delegate.getSourceName(), track.getInfo().title, track.getInfo().author);
                    if (IslamicAudioFilter.isStrictFiltering()) {
                        throw new FriendlyException(
                                "Playback rejected: Only Islamic audio (Quran recitations, Nasheeds, Naat, Hamd, Duas) is permitted.",
                                FriendlyException.Severity.COMMON,
                                null
                        );
                    }
                    return AudioReference.NO_TRACK;
                }
                return track;
            } else if (item instanceof AudioPlaylist) {
                return IslamicAudioFilter.filterPlaylist((AudioPlaylist) item);
            }
        }

        return item;
    }

    @Override
    public boolean isTrackEncodable(AudioTrack track) {
        return delegate.isTrackEncodable(track);
    }

    @Override
    public void encodeTrack(AudioTrack track, DataOutput output) throws IOException {
        delegate.encodeTrack(track, output);
    }

    @Override
    public AudioTrack decodeTrack(AudioTrackInfo trackInfo, DataInput input) throws IOException {
        AudioTrack track = delegate.decodeTrack(trackInfo, input);
        if (IslamicAudioFilter.isEnabled() && track != null) {
            if (!IslamicAudioFilter.isIslamicTrack(track)) {
                log.warn("Decoded non-Islamic track rejected: \"{}\" by \"{}\"",
                        trackInfo.title, trackInfo.author);
                throw new FriendlyException(
                        "Playback rejected: Only Islamic audio (Quran recitations, Nasheeds, Naat, Hamd, Duas) is permitted.",
                        FriendlyException.Severity.COMMON,
                        null
                );
            }
        }
        return track;
    }

    @Override
    public void shutdown() {
        delegate.shutdown();
    }

    @Override
    public void configureRequests(Function<RequestConfig, RequestConfig> configurator) {
        if (delegate instanceof HttpConfigurable) {
            ((HttpConfigurable) delegate).configureRequests(configurator);
        }
    }

    @Override
    public void configureBuilder(Consumer<HttpClientBuilder> configurator) {
        if (delegate instanceof HttpConfigurable) {
            ((HttpConfigurable) delegate).configureBuilder(configurator);
        }
    }
}
