package com.slugyzeon.plugin.spotify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;

public class SpotifyRequestPayload {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String operationName;
    private final String sha256Hash;
    private final ObjectNode variables;

    private SpotifyRequestPayload(String operationName, String sha256Hash) {
        this.operationName = operationName;
        this.sha256Hash = sha256Hash;
        this.variables = MAPPER.createObjectNode();
    }

    private SpotifyRequestPayload put(String key, Object value) {
        this.variables.set(key, MAPPER.valueToTree(value));
        return this;
    }

    public String getOperationName() {
        return operationName;
    }

    public String serialize() throws IOException {
        ObjectNode persistedQuery = MAPPER.createObjectNode();
        persistedQuery.put("version", 1);
        persistedQuery.put("sha256Hash", sha256Hash);

        ObjectNode extensions = MAPPER.createObjectNode();
        extensions.set("persistedQuery", persistedQuery);

        ObjectNode body = MAPPER.createObjectNode();
        body.set("variables", variables);
        body.put("operationName", operationName);
        body.set("extensions", extensions);

        return MAPPER.writeValueAsString(body);
    }

    private static final String searchHash = "4801118d4a100f756e833d33984436a3899cff359c532f8fd3aaf174b60b3b49";
    private static final String trackHash = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294";
    private static final String albumHash = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10";
    private static final String playlistHash = "7982b11e21535cd2594badc40030b745671b61a1fa66766e569d45e6364f3422";
    private static final String artistHash = "dd14c6043d8127b56c5acbe534f6b3c58714f0c26bc6ad41776079ed52833a8f";
    private static final String recommendationsHash = "c77098ee9d6ee8ad3eb844938722db60570d040b49f41f5ec6e7be9160a7c86b";

    public static SpotifyRequestPayload search(String query) {
        return new SpotifyRequestPayload("searchDesktop", searchHash)
                .put("searchTerm", query)
                .put("offset", 0)
                .put("limit", 20)
                .put("numberOfTopResults", 5)
                .put("includeAudiobooks", false)
                .put("includeArtistHasConcertsField", false)
                .put("includePreReleases", false)
                .put("includeLocalConcertsField", false)
                .put("includeAuthors", false);
    }

    public static SpotifyRequestPayload track(String id) {
        return new SpotifyRequestPayload("getTrack", trackHash)
                .put("uri", "spotify:track:" + id);
    }

    public static SpotifyRequestPayload recommendations(String seedTrackId) {
        return new SpotifyRequestPayload("internalLinkRecommenderTrack", recommendationsHash)
                .put("uri", "spotify:track:" + seedTrackId);
    }

    public static SpotifyRequestPayload album(String id) {
        return new SpotifyRequestPayload("getAlbum", albumHash)
                .put("uri", "spotify:album:" + id)
                .put("locale", "en")
                .put("offset", 0)
                .put("limit", 300);
    }

    public static SpotifyRequestPayload playlist(String id, int offset, int limit) {
        return new SpotifyRequestPayload("fetchPlaylist", playlistHash)
                .put("uri", "spotify:playlist:" + id)
                .put("offset", offset)
                .put("limit", limit)
                .put("enableWatchFeedEntrypoint", false);
    }

    public static SpotifyRequestPayload artist(String id) {
        return new SpotifyRequestPayload("queryArtistOverview", artistHash)
                .put("uri", "spotify:artist:" + id)
                .put("locale", "en")
                .put("includePrerelease", false);
    }
}