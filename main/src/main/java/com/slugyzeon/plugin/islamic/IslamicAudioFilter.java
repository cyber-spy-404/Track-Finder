package com.slugyzeon.plugin.islamic;

import com.sedmelluq.discord.lavaplayer.tools.FriendlyException;
import com.sedmelluq.discord.lavaplayer.track.AudioItem;
import com.sedmelluq.discord.lavaplayer.track.AudioPlaylist;
import com.sedmelluq.discord.lavaplayer.track.AudioReference;
import com.sedmelluq.discord.lavaplayer.track.AudioTrack;
import com.sedmelluq.discord.lavaplayer.track.AudioTrackInfo;
import com.sedmelluq.discord.lavaplayer.track.BasicAudioPlaylist;
import com.slugyzeon.plugin.ExtendedAudioTrack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.text.Normalizer;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Islamic Audio Filter & Enforcement Engine.
 * Ensures only Islamic content (Quran recitations, Nasheeds, Naat, Hamd, Duas, and Islamic audio)
 * is queried, loaded, and played across all APIs (Spotify, Gaana, Amazon Music, Pandora, YouTube).
 */
public class IslamicAudioFilter {

    private static final Logger log = LoggerFactory.getLogger(IslamicAudioFilter.class);

    private static volatile boolean enabled = false;
    private static volatile boolean strictFiltering = false;

    private static final Set<String> customKeywords = ConcurrentHashMap.newKeySet();
    private static final Set<String> blockedKeywords = ConcurrentHashMap.newKeySet();

    // Built-in core Islamic keywords and terms
    private static final Set<String> ISLAMIC_TERMS = new HashSet<>();

    static {
        // Quran & Recitation terms
        Collections.addAll(ISLAMIC_TERMS,
                "quran", "qur'an", "quranic", "koran", "surah", "surat", "ayat", "ayah",
                "tilawat", "tilawah", "qirat", "qiraat", "recitation", "tajweed", "tajwid",
                "tafseer", "tafsir", "juz", "para", "ruqyah", "manzil", "mushaf", "tartil",
                "tarteel", "hafiz", "qari", "makki", "madani"
        );

        // All 114 Surahs (common transliterations)
        Collections.addAll(ISLAMIC_TERMS,
                "fatihah", "fateha", "fatiha", "baqarah", "bakara", "al-baqara",
                "ali imran", "al-imran", "imran", "nisa", "an-nisa", "maidah", "al-maidah",
                "anam", "al-anam", "araf", "al-araf", "anfal", "al-anfal", "tawbah", "tauba", "at-tawbah",
                "yunus", "surah hud", "surat hud", "yusuf", "ar-rad", "surah rad", "surat rad", "ibrahim", "hijr", "al-hijr",
                "nahl", "an-nahl", "isra", "al-isra", "kahf", "al-kahf", "maryam", "taha", "ta-ha",
                "anbiya", "al-anbiya", "hajj", "al-hajj", "muminun", "al-muminun", "an-nur", "al-nur", "surah nur", "surat nur",
                "furqan", "al-furqan", "shuara", "ash-shuara", "naml", "an-naml", "qasas", "al-qasas",
                "ankabut", "al-ankabut", "ar-rum", "surah rum", "surat rum", "luqman", "sajdah", "as-sajdah",
                "ahzab", "al-ahzab", "saba", "fatir", "yasin", "yaseen", "ya-sin", "ya-seen",
                "saffat", "as-saffat", "surah sad", "surat sad", "saad", "zumar", "az-zumar", "ghafir", "fussilat",
                "shura", "ash-shura", "zukhruf", "az-zukhruf", "dukhan", "ad-dukhan", "jathiyah",
                "ahqaf", "al-ahqaf", "muhammad", "fath", "al-fath", "hujurat", "al-hujurat",
                "surah qaf", "surat qaf", "dhariyat", "ad-dhariyat", "at-tur", "surah tur", "surat tur", "najm", "an-najm",
                "qamar", "al-qamar", "rahman", "ar-rahman", "waqiah", "al-waqiah", "waqia",
                "hadid", "al-hadid", "mujadilah", "hashr", "al-hashr", "mumtahanah",
                "saff", "as-saff", "jumuah", "al-jumuah", "jumah", "munafiqun", "al-munafiqun",
                "taghabun", "at-taghabun", "talaq", "at-talaq", "tahrim", "at-tahrim",
                "mulk", "al-mulk", "tabarak", "qalam", "al-qalam", "haqqah", "al-haqqah",
                "maarij", "al-maarij", "nuh", "jinn", "al-jinn", "muzzammil", "al-muzzammil",
                "muddathir", "al-muddathir", "qiyamah", "al-qiyamah", "insan", "al-insan", "dahr",
                "mursalat", "al-mursalat", "naba", "an-naba", "naziat", "an-naziat", "abasa",
                "takwir", "at-takwir", "infitar", "al-infitar", "mutaffifin", "al-mutaffifin",
                "inshiqaq", "al-inshiqaq", "burooj", "al-burooj", "tariq", "at-tariq",
                "al-ala", "surah ala", "surat ala", "ghashiyah", "al-ghashiyah", "fajr", "al-fajr", "balad", "al-balad",
                "shams", "ash-shams", "layl", "al-layl", "duha", "ad-duha", "sharh", "ash-sharh", "inshirah",
                "at-tin", "surah tin", "surat tin", "alaq", "al-alaq", "iqra", "qadr", "al-qadr", "bayyinah", "al-bayyinah",
                "zalzalah", "az-zalzalah", "adiyat", "al-adiyat", "qariah", "al-qariah",
                "takathur", "at-takathur", "al-asr", "surah asr", "surat asr", "humazah", "al-humazah",
                "al-fil", "surah fil", "surat fil", "quraysh", "maun", "al-maun", "kawthar", "al-kawthar", "kauthar",
                "kafirun", "al-kafirun", "nasr", "an-nasr", "masad", "al-masad", "lahab",
                "ikhlas", "al-ikhlas", "falaq", "al-falaq", "an-nas", "al-nas", "surah nas", "surat nas"
        );

        // Islamic Audio Genres & Categories
        Collections.addAll(ISLAMIC_TERMS,
                "nasheed", "nasheeds", "anasheed", "anashid", "nasyid", "naat", "na'at",
                "naath", "hamd", "madih", "madeeh", "munajat", "manqabat", "qawwali",
                "ilahiler", "ilahi", "kalam", "dua", "du'a", "dhikr", "zikr", "azkar",
                "adhkar", "tasbih", "tasbeeh", "salawat", "darood", "durood", "athan",
                "azan", "adhan", "khutbah", "bayan", "dars", "waaz", "waz", "mahfil", "naseeha",
                "nasiha", "nasihat", "tahajjud", "istighfar",
                "taraweeh", "tarawih", "acapella nasheed", "vocal only nasheed", "halal audio"
        );

        // Islamic Concepts, Holy Entities & Celebrations
        Collections.addAll(ISLAMIC_TERMS,
                "allah", "subhanallah", "alhamdulillah", "allahu akbar", "bismillah",
                "la ilaha illallah", "prophet muhammad", "holy prophet", "rasool", "rasul", "rasulullah", "nabi",
                "sahaba", "ahle bait", "ramadan", "ramadhan", "ramzan", "eid", "eid mubarak",
                "eid ul fitr", "eid ul adha", "makkah", "mecca", "madinah", "medina",
                "kaaba", "ka'bah", "masjid", "mosque", "hajj", "umrah", "islam", "islamic",
                "muslim", "halal", "deen", "iman", "tawhid", "sunnah", "hadith", "jannah",
                "akhirah", "shariah", "seerah", "sirah"
        );

        // Prominent Quran Reciters
        Collections.addAll(ISLAMIC_TERMS,
                "mishary", "alafasy", "al-afasy", "abdul rahman al-sudais", "al-sudais", "sudais",
                "saud al-shuraim", "al-shuraim", "shuraim", "maher al-muaiqly", "al-muaiqly", "muaiqly",
                "saad al-ghamdi", "al-ghamdi", "ghamdi", "yasser al-dossari", "al-dossari", "dossari",
                "abdul basit", "abdus samad", "abu bakr al-shatri", "al-shatri", "shatri",
                "ali jaber", "mahmoud khalil al-hussary", "al-hussary", "hussary", "husary",
                "mohamed siddiq al-minshawi", "al-minshawi", "minshawi", "islam sobhi",
                "raad al kurdi", "raad mohammad al kurdi", "mansour al-salimi", "salimi",
                "omar hisham al arabi", "nasser al qatami", "qatami", "idrees abkar", "abkar",
                "ahmed al ajmi", "al-ajmi", "ajmi", "fares abbad", "abbad", "hazaa al balushi",
                "balushi", "khalid al jaleel", "salah bukhatir", "wadee al yamani", "ahmed al nufais",
                "bandar baleela", "qari abdul basith", "qari waheed zafar"
        );

        // Prominent Nasheed & Islamic Artists
        Collections.addAll(ISLAMIC_TERMS,
                "maher zain", "sami yusuf", "harris j", "zain bhikha", "ahmed bukhatir",
                "omar esa", "siedd", "muhammad al muqit", "al muqit", "humood alkhudher",
                "humood", "mesut kurtis", "raef", "dawud wharnsby", "ali magrebi",
                "muhammad tariq", "baraa masoud", "mostafa atef", "amjad sabri",
                "nusrat fateh ali khan", "sabri brothers", "owais raza qadri", "owais qadri",
                "junaid jamshed", "fasih ud din soharwardi", "tariq jameel", "mufti menk",
                "menk", "mufti", "shaykh", "sheikh", "ustadh", "allama", "maulana",
                "nouman ali khan", "yasir qadhi", "dr zakir naik", "bilal assad"
        );

        // Arabic script terms
        Collections.addAll(ISLAMIC_TERMS,
                "قرآن", "قران", "سورة", "تلاوة", "تجويد", "تفسير", "نشيد", "اناشيد", "أناشيد",
                "نعت", "حمد", "دعاء", "أدعية", "ذكر", "أذكار", "اذكار", "إسلام", "اسلام",
                "إسلامي", "اسلامي", "الله", "محمد", "رسول", "رمضان", "مكة", "المدينة",
                "الكعبة", "حج", "عمرة", "الأذان", "الاذান", "تراويح", "مشاري", "العفاسي",
                "السديস", "الشريم", "المعيقلي", "الغامدي", "الدوسري", "الحصري", "المنشاوي",
                "عبد الباسط", "ماهر زين", "سامي يوسف", "حمود الخضر", "أحمد بوخاطر", "عمر عيسى"
        );

        // Bengali, Urdu & Subcontinental Islamic Genres & Terms
        Collections.addAll(ISLAMIC_TERMS,
                "gojol", "gozhol", "gajol", "ghazal", "gazal", "গজল", "নাত", "হামদ", "কোরআন", "সুরা", "তেলাওয়াত",
                "ওয়াজ", "মাহফিল", "বায়ান", "তাফসির", "নসিহত",
                "নবী", "রাসুল", "আল্লাহ", "ইসলামিক", "মাদরাসাহ", "কাফেলা", "কলরব", "kalarob", "kalarab", "abu rayhan",
                "mahfuzul alam", "sayed ahmad", "badhon", "ainuddin al azad", "motiur rahman mallik",
                "tariq monowar", "delwar hossain sayeedi", "mizanur rahman azhari", "azhari", "azhari bayan",
                "tawhid jamil", "anas nazeer", "hafiz jalabeeb", "iqra sisters", "laiba fatima",
                "kalam", "nazam", "nazm", "tarana",
                "hasbi rabbi", "kun anta", "tala al badru", "tala al-badru", "ya nabi salam alayka",
                "assalamu alayka", "maula ya salli", "mawla ya salli", "qamarun", "labbayk", "labbaik",
                "atuna tufuli", "a'tuna tufuli", "salawat", "darood sharif", "durood sharif",
                "watu illu", "watu izzu", "watu zillu", "mantasha", "man tasha", "tuizzu man tasha"
        );

        // Universal High-Traffic Islamic Hashtags & Slang
        Collections.addAll(ISLAMIC_TERMS,
                "#islamicstatus", "islamic status", "islamicstatus",
                "#islamicvids", "islamic vids", "islamicvids",
                "#islamicvideo", "islamic video", "islamic videos", "islamicvideo",
                "#islamickalam", "islamic kalam", "islamickalam",
                "#islamicvibes", "islamic vibes", "islamicvibes",
                "#islamicremix", "islamic remix", "islamicremix",
                "#islamicshorts", "islamic shorts", "islamicshorts",
                "#islamicreels", "islamic reels", "islamicreels",
                "#halalmusic", "halal music", "halalmusic",
                // Waz (Sermons, Bayans, Speeches) Hashtags & Keywords
                "#waz", "#islamicwaz", "islamic waz", "islamicwaz",
                "#islamicspeech", "islamic speech", "islamicspeech", "islamic speeches",
                "islamic lecture", "islamic lectures",
                "#bayan", "#emotionalbayan", "emotional bayan", "emotionalbayan",
                "#emotionalwaz", "emotional waz", "emotionalwaz",
                "emotional speech", "#mahfil",
                // Naat (Praises of the Holy Prophet ﷺ) Hashtags & Keywords
                "#naat", "#naatsharif", "naat sharif", "naat shareef", "naatsharif",
                "#newnaat", "new naat", "newnaat", "latest naat",
                "#madinah", "madinah", "medina", "#makkah", "makkah", "mecca",
                "#yarasoolallah", "ya rasool allah", "ya rasoolallah", "yarasoolallah", "ya habiballah",
                // Nasheed (Vocal Chants & Halal Bangers) Hashtags & Slang
                "#nasheed", "#nasheeds",
                "#halalbanger", "halal banger", "halalbanger", "halal bangers", "#halalbangers",
                "#vocalonly", "vocal only", "vocalonly", "vocal without music",
                "#nomusic", "no music", "nomusic", "instruments free", "instrument free",
                // Modern Gen-Z & Trending Community Hashtags
                "#halalvibes", "halal vibes", "halalvibes",
                "#muslimvibes", "muslim vibes", "muslimvibes",
                "#nasheedvibes", "nasheed vibes", "nasheedvibes",
                "#quranvibes", "quran vibes", "quranvibes",
                "#quranrecitation", "quran recitation", "quranrecitation",
                "#quranstatus", "quran status", "quranstatus",
                "#islamicreminder", "islamic reminder", "islamic reminders", "islamicreminder",
                "#islamicquotes", "islamic quotes", "islamicquotes",
                "#deenoverdunya", "deen over dunya", "deenoverdunya",
                "#tahajjudvibes", "tahajjud vibes",
                "#ramadanvibes", "ramadan vibes",
                "#eidvibes", "eid vibes",
                "#jummahmubarak", "jummah mubarak", "jummahmubarak",
                "#alhamdulillah", "#subhanallah", "#allahuakbar"
        );

        // Default prohibited secular terms (when strict filtering is enabled)
        Collections.addAll(blockedKeywords,
                // Dance, club, remix, electronic
                "remix", "dj", "dj remix", "dj song", "purulia", "club mix", "dance mix", "party song",
                "edm", "techno", "house music", "trance", "bass boosted", "slowed reverb", "lofi remix",
                "mashup", "disco", "rave", "nightclub", "strip club", "dance club",
                // Secular song descriptors
                "item song", "item number", "pop song", "pop music", "hip hop", "rap", "rock",
                "metal", "heavy metal", "punk", "romantic love duet", "romantic song", "love song",
                "breakup song", "sad love", "sexy", "vulgar", "explicit",
                // Secular regional pop industries
                "bhojpuri", "bollywood", "tollywood", "kollywood", "punjabi song", "bengali song",
                "hindi song", "tamil song", "telugu song", "kpop", "jpop",
                // Popular secular artists
                "lil nas", "taylor swift", "justin bieber", "drake", "eminem", "travis scott",
                "ariana grande", "billie eilish", "the weeknd", "dua lipa", "post malone",
                "bad bunny", "ed sheeran", "shakira", "rihanna", "beyonce", "katy perry",
                "bruno mars", "selena gomez", "alan walker", "martin garrix", "david guetta",
                "marshmello", "avicii", "skrillex", "tiesto", "zedd", "calvin harris",
                "dj snake", "chainsmokers", "bts", "blackpink", "arijit singh", "neha kakkar",
                "badshah", "honey singh", "mc stan", "sidhu moose wala", "karan aujla", "diljit dosanjh"
        );
    }

    public static boolean isEnabled() {
        return enabled;
    }

    public static void setEnabled(boolean value) {
        enabled = value;
        log.info("Islamic Audio Filter enabled set to: {}", value);
    }

    public static boolean isStrictFiltering() {
        return strictFiltering;
    }

    public static void setStrictFiltering(boolean value) {
        strictFiltering = value;
        log.info("Islamic Audio Filter strictFiltering set to: {}", value);
    }

    public static void addCustomKeywords(Collection<String> keywords) {
        if (keywords != null) {
            for (String kw : keywords) {
                if (kw != null && !kw.trim().isEmpty()) {
                    customKeywords.add(kw.trim().toLowerCase());
                }
            }
        }
    }

    public static void addBlockedKeywords(Collection<String> keywords) {
        if (keywords != null) {
            for (String kw : keywords) {
                if (kw != null && !kw.trim().isEmpty()) {
                    blockedKeywords.add(kw.trim().toLowerCase());
                }
            }
        }
    }

    /**
     * Checks if an AudioTrack qualifies as Islamic audio.
     */
    public static boolean isIslamicTrack(AudioTrack track) {
        if (!enabled) return true;
        if (track == null) return false;

        AudioTrackInfo info = track.getInfo();
        String albumName = null;
        if (track instanceof ExtendedAudioTrack) {
            albumName = ((ExtendedAudioTrack) track).getAlbumName();
        }

        return isIslamicContent(info.title, info.author, albumName);
    }

    /**
     * Checks if content (title, author, album) qualifies as Islamic audio.
     */
    public static boolean isIslamicContent(String title, String author, String album) {
        if (!enabled) return true;

        String combined = normalizeText(
                (title != null ? title : "") + " " +
                (author != null ? author : "") + " " +
                (album != null ? album : "")
        );

        if (combined.trim().isEmpty()) {
            return false;
        }

        // Check against blocked keywords if strict filtering is enabled
        if (strictFiltering) {
            boolean islamicRemixAllowed = isIslamicRemix(combined);
            for (String blocked : blockedKeywords) {
                if (islamicRemixAllowed && (blocked.equals("remix") || blocked.equals("lofi remix") || blocked.equals("slowed reverb"))) {
                    continue;
                }
                if (containsTerm(combined, blocked)) {
                    log.debug("Track rejected due to blocked keyword \"{}\": {}", blocked, combined);
                    return false;
                }
            }
        }

        // Check custom keywords first
        for (String custom : customKeywords) {
            if (containsTerm(combined, custom)) {
                return true;
            }
        }

        // Check built-in Islamic terms
        for (String term : ISLAMIC_TERMS) {
            if (containsTerm(combined, term)) {
                return true;
            }
        }

        return false;
    }

    private static final String[] ISLAMIC_REMIX_EXCEPTIONS = {
        "islamic remix", "nasheed remix", "halal remix", "naat remix",
        "acapella remix", "vocal remix", "quran remix", "islamic slowed",
        "nasheed slowed", "halal slowed", "islamic lofi", "nasheed lofi", "halal lofi"
    };

    public static boolean isIslamicRemix(String text) {
        if (text == null) return false;
        String t = text.toLowerCase(Locale.ROOT);
        String withSpaces = t.replace('-', ' ').replace('_', ' ').replace('#', ' ');
        String cleanSpaceless = t.replaceAll("[^a-z0-9]", "");
        for (String exp : ISLAMIC_REMIX_EXCEPTIONS) {
            if (withSpaces.contains(exp)) return true;
            if (cleanSpaceless.contains(exp.replace(" ", ""))) return true;
        }
        return false;
    }

    /**
     * Checks whether a search query contains explicit Islamic intent.
     */
    public static boolean isIslamicQuery(String query) {
        if (!enabled || query == null) return true;
        String normalized = normalizeText(query);

        for (String custom : customKeywords) {
            if (containsTerm(normalized, custom)) return true;
        }

        for (String term : ISLAMIC_TERMS) {
            if (containsTerm(normalized, term)) return true;
        }

        return false;
    }

    /**
     * Preprocesses and sanitizes search queries to steer search results towards Islamic audio.
     */
    public static String sanitizeSearchQuery(String query) {
        if (!enabled || query == null || query.trim().isEmpty()) {
            return query;
        }

        if (isIslamicQuery(query)) {
            return query;
        }

        // Append Islamic context to steer external APIs toward Islamic audio
        return query.trim() + " Islamic Nasheed";
    }

    /**
     * Asserts that a query does not violate Islamic content rules.
     */
    public static void assertIslamicQuery(String query) {
        if (!enabled || query == null) return;
        String normalized = normalizeText(query);

        if (strictFiltering) {
            boolean islamicRemixAllowed = isIslamicRemix(normalized);
            for (String blocked : blockedKeywords) {
                if (islamicRemixAllowed && (blocked.equals("remix") || blocked.equals("lofi remix") || blocked.equals("slowed reverb"))) {
                    continue;
                }
                if (containsTerm(normalized, blocked)) {
                    throw new FriendlyException(
                            "Search rejected: Only Islamic audio, Quran recitations, and Nasheeds are permitted.",
                            FriendlyException.Severity.COMMON,
                            null
                    );
                }
            }
        }
    }

    /**
     * Asserts that a track is Islamic. If not, throws a FriendlyException to prevent playback.
     */
    public static AudioTrack assertIslamicTrack(AudioTrack track) {
        if (!enabled || track == null) return track;

        if (!isIslamicTrack(track)) {
            log.warn("Blocked playback of non-Islamic track: \"{}\" by \"{}\"",
                    track.getInfo().title, track.getInfo().author);
            throw new FriendlyException(
                    "Playback rejected: Only Islamic audio (Quran recitations, Nasheeds, and Islamic content) is allowed by this node.",
                    FriendlyException.Severity.COMMON,
                    null
            );
        }

        return track;
    }

    /**
     * Filters a list of tracks, returning only those that qualify as Islamic audio.
     */
    public static List<AudioTrack> filterTracks(List<AudioTrack> tracks) {
        if (!enabled || tracks == null || tracks.isEmpty()) {
            return tracks;
        }

        List<AudioTrack> filtered = tracks.stream()
                .filter(IslamicAudioFilter::isIslamicTrack)
                .collect(Collectors.toList());

        log.debug("Islamic filter: kept {} of {} tracks", filtered.size(), tracks.size());
        return filtered;
    }

    /**
     * Filters a playlist, removing any non-Islamic tracks.
     */
    public static AudioItem filterPlaylist(AudioPlaylist playlist) {
        if (!enabled || playlist == null) {
            return playlist;
        }

        List<AudioTrack> filtered = filterTracks(playlist.getTracks());
        if (filtered.isEmpty()) {
            log.info("Playlist \"{}\" contained no Islamic tracks; returning NO_TRACK", playlist.getName());
            return AudioReference.NO_TRACK;
        }

        return new BasicAudioPlaylist(playlist.getName(), filtered, playlist.getSelectedTrack(), playlist.isSearchResult());
    }

    private static String normalizeText(String input) {
        if (input == null) return "";
        String normalized = Normalizer.normalize(input, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", ""); // Remove diacritics
        return normalized.toLowerCase(Locale.ROOT);
    }

    private static boolean containsTerm(String text, String term) {
        if (text == null || term == null || term.isEmpty()) return false;

        // Space/dash normalized check for multi-word or longer terms (> 4 characters)
        if (term.contains(" ") || term.length() > 4) {
            String cleanText = text.replace("-", " ").replace("'", "").replace("’", "");
            String cleanTerm = term.replace("-", " ").replace("'", "").replace("’", "");
            if (cleanText.contains(cleanTerm)) return true;
        }

        // For short terms (length <= 4), enforce word boundaries
        // Matches if preceded and followed by non-alphanumeric character or string start/end
        String regex = "(?i)(^|[^a-z0-9])" + Pattern.quote(term) + "([^a-z0-9]|$)";
        return Pattern.compile(regex).matcher(text).find();
    }
}
