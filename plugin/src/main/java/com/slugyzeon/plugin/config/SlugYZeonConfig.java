package com.slugyzeon.plugin.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import static com.slugyzeon.plugin.mirror.MirroringAudioSourceManager.ISRC_PATTERN;
import static com.slugyzeon.plugin.mirror.MirroringAudioSourceManager.QUERY_PATTERN;

@ConfigurationProperties(prefix = "plugins.slugyzeon")
@Component
public class SlugYZeonConfig {

    private String[] providers = {
            "dzisrc:" + ISRC_PATTERN,
            "ytsearch:\"" + ISRC_PATTERN + "\"",
            "ytsearch:" + QUERY_PATTERN
    };

    private boolean islamicOnly = true;
    private boolean strictFiltering = true;
    private java.util.List<String> customKeywords = new java.util.ArrayList<>();
    private java.util.List<String> blockedKeywords = new java.util.ArrayList<>();

    public String[] getProviders() {
        return providers;
    }

    public void setProviders(String[] providers) {
        this.providers = providers;
    }

    public boolean isIslamicOnly() {
        return islamicOnly;
    }

    public void setIslamicOnly(boolean islamicOnly) {
        this.islamicOnly = islamicOnly;
    }

    public boolean isStrictFiltering() {
        return strictFiltering;
    }

    public void setStrictFiltering(boolean strictFiltering) {
        this.strictFiltering = strictFiltering;
    }

    public java.util.List<String> getCustomKeywords() {
        return customKeywords;
    }

    public void setCustomKeywords(java.util.List<String> customKeywords) {
        this.customKeywords = customKeywords;
    }

    public java.util.List<String> getBlockedKeywords() {
        return blockedKeywords;
    }

    public void setBlockedKeywords(java.util.List<String> blockedKeywords) {
        this.blockedKeywords = blockedKeywords;
    }
}