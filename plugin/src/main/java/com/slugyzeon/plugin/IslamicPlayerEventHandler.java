package com.slugyzeon.plugin;

import com.sedmelluq.discord.lavaplayer.player.event.AudioEventListener;
import com.sedmelluq.discord.lavaplayer.player.event.TrackStartEvent;
import com.sedmelluq.discord.lavaplayer.track.AudioTrack;
import com.slugyzeon.plugin.islamic.IslamicAudioFilter;
import dev.arbjerg.lavalink.api.IPlayer;
import dev.arbjerg.lavalink.api.ISocketContext;
import dev.arbjerg.lavalink.api.PluginEventHandler;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Intercepts player events across all connections in Lavalink.
 * Ensures any track attempting to play in a voice channel is verified as Islamic.
 * If secular audio starts, it immediately cuts the stream and logs a warning.
 */
@Component
public class IslamicPlayerEventHandler extends PluginEventHandler {

    private static final Logger log = LoggerFactory.getLogger(IslamicPlayerEventHandler.class);

    @Override
    public void onNewPlayer(@NotNull ISocketContext context, @NotNull IPlayer player) {
        log.info("🛡️ Attaching Islamic audio enforcement listener to player for guild: {}", player.getGuildId());
        player.getAudioPlayer().addListener((AudioEventListener) event -> {
            if (event instanceof TrackStartEvent) {
                AudioTrack track = ((TrackStartEvent) event).track;
                if (IslamicAudioFilter.isEnabled() && !IslamicAudioFilter.isIslamicTrack(track)) {
                    log.error("🚫 [ISLAMIC ENFORCER] Blocked unauthorized secular playback: \"{}\" by \"{}\". Terminating stream now!",
                            track.getInfo().title, track.getInfo().author);
                    player.getAudioPlayer().stopTrack();
                } else {
                    log.info("🎵 [STREAM ACTIVE] Playing: \"{}\" by \"{}\"",
                            track.getInfo().title, track.getInfo().author);
                }
            }
        });
    }
}
