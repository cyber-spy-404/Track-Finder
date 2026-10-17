package com.slugyzeon.plugin.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@ConfigurationProperties(prefix = "plugins.slugyzeon.youtube")
@Component
public class SlugYZeonYouTubeConfig {

    private boolean oembed = false;
    private boolean mirror = false;

    public boolean isOembed() {
        return oembed;
    }

    public void setOembed(boolean oembed) {
        this.oembed = oembed;
    }

    public boolean isMirror() {
        return mirror;
    }

    public void setMirror(boolean mirror) {
        this.mirror = mirror;
    }
}