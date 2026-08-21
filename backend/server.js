const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (e) {
  // dotenv optional in production
}

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const getJamendoClientId = () => {
  const id = process.env.JAMENDO_CLIENT_ID || process.env.VITE_JAMENDO_CLIENT_ID || '';
  return id.trim();
};

const EMOJI_LIST = ['🎵', '🌌', '🌃', '🎧', '🔥', '🌙', '💪', '🧠', '✨', '🎶', '🎸', '🎹'];

const getEmojiForTrack = (title, artist) => {
  const str = (title + artist).toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return EMOJI_LIST[Math.abs(hash) % EMOJI_LIST.length];
};

// Shared track mapper used by both endpoints
const mapTrack = (track) => ({
  id: String(track.id),
  title: track.name || 'Untitled Track',
  artist: track.artist_name || 'Unknown Artist',
  album: track.album_name || 'Jamendo',
  duration: track.duration || 0,
  artwork: track.image || track.album_image || null,
  audio: track.audio || track.audiodownload || null,
  file: track.audio || track.audiodownload || null,
  emoji: getEmojiForTrack(track.name || '', track.artist_name || ''),
});

// ─── Tamil music discovery configuration ───────────────────────────────────
//
// JAMENDO REALITY CHECK (verified 2026-08-19):
//   tags=tamil      → 0 results  (no tracks tagged "tamil")
//   search=tamil    → 0 results  (no tracks with "tamil" in name/artist/album)
//   search=kollywood → 0 results
//   tags=indian     → generic Bollywood/world music, NOT Tamil
//   tags=world      → generic world music, NOT Tamil
//   search=carnatic → 20 results  ← ONLY query returning real Tamil music
//
// Strategy: fetch search=carnatic, then apply a strict relevance filter so
// only tracks that are verifiably Carnatic/Tamil classical music pass through.
// Tracks that merely mention "carnatic" in an unrelated context (e.g., a jazz
// track named "Carnatic lizzard" with genres jazz/rock/ragga) are rejected.

// Words that confirm a track is genuine Carnatic/Tamil classical music.
// These are raga names, Tamil-language words found in song titles, and
// Carnatic music vocabulary — they do NOT appear in non-Tamil Indian music.
const CARNATIC_MARKERS = [
  // Raga names that appear in this dataset's track/album names
  'sindhubhairavi', 'thodi', 'behag', 'khamas', 'ganamurthi',
  'nalinakanthi', 'vasantha', 'hemavathi', 'mayamalavagowlai',
  'kapi', 'kaanada', 'hindolam', 'hindola',
  'shubapantuvarali', 'maand', 'anandhavalli',
  // Tamil words found in track titles (transliterations)
  'alaipayuthey', 'irakkam', 'punnaimaranizhalil', 'chinnanchirupennpole',
  'santanagopalakrishnam', 'ganamurthe', 'kaddanuvariki',
  'manavyalagincharathate', 'deva-deva', 'ragamalika', 'alapana', 'varnam',
  // Known Carnatic compositions / kriti names found in this dataset
  'jagadhodharana', 'srisatyanarayanam', 'muralidhara', 'su-r-li',
  // Known Tamil/Carnatic artist names in this dataset
  'aswinsainarain', 'music@ncbs',
];

// Track title patterns that indicate NON-Carnatic content (patriotic, generic, etc.)
// These are checked FIRST and cause immediate rejection.
const CARNATIC_BLOCKLIST = [
  'vande mataram',
  'national anthem',
  'patriotic',
];

// Album names that are known Carnatic concert albums in this dataset
const CARNATIC_ALBUM_MARKERS = [
  'carnatic', 'indian carnatic',
];

/**
 * Returns true if the track is verifiably Carnatic/Tamil classical music.
 * Requires at least one Carnatic marker to appear in the track's combined
 * metadata (name + artist + album + vartags + genres).
 * Rejects tracks where the only match is a genre like "indian" or "world"
 * without any Carnatic-specific vocabulary.
 */
function isTamilCarnatic(track) {
  const name    = (track.name || '').toLowerCase();
  const artist  = (track.artist_name || '').toLowerCase();
  const album   = (track.album_name || '').toLowerCase();
  const vartags = (track.musicinfo?.tags?.vartags || []).join(' ').toLowerCase();
  const genres  = (track.musicinfo?.tags?.genres  || []).join(' ').toLowerCase();

  // Reject tracks whose genres are purely non-Carnatic (e.g., jazz/rock/ragga)
  // even if the track name mentions "carnatic".
  const nonCarnaticGenres = ['jazz', 'rock', 'ragga', 'hiphop', 'electronic', 'pop', 'reggae', 'metal', 'punk', 'blues', 'country', 'folk'];
  const hasBadGenre = nonCarnaticGenres.some(g => genres.includes(g));
  // Allow only if a specific Carnatic marker appears in vartags (generic 'carnatic' alone is not enough)
  const hasSpecificCarnatic = CARNATIC_MARKERS.some(marker => vartags.includes(marker));
  if (hasBadGenre && !hasSpecificCarnatic) return false;

  // Blocklist: reject tracks with non-Carnatic title patterns regardless of artist/album
  const normalizedName = name.replace(/[-_ ]+/g, ' ');
  if (CARNATIC_BLOCKLIST.some(pattern => normalizedName.includes(pattern))) return false;

  // Must match at least one specific Carnatic marker anywhere in the track metadata
  const combined = `${name} ${artist} ${album} ${vartags}`;
  return CARNATIC_MARKERS.some(marker => combined.includes(marker)) ||
         CARNATIC_ALBUM_MARKERS.some(marker => album.includes(marker));
}

// In-memory cache (refreshes every 30 min)
let tamilCache = null;
let tamilCacheExpiry = 0;
const TAMIL_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Build (and cache) the Tamil-only Carnatic catalog.
 * Uses a single search=carnatic query (the only Jamendo query that reliably
 * returns Tamil/Carnatic classical music), then filters to confirmed tracks.
 */
async function buildTamilCatalog(clientId) {
  const now = Date.now();
  if (tamilCache && now < tamilCacheExpiry) {
    return tamilCache;
  }

  console.log('[VibeStream] Building Tamil/Carnatic catalog from Jamendo...');

  // search=carnatic is the single reliable source of Tamil music on Jamendo.
  // Note: tags=tamil/search=tamil both return 0 results as of 2026-08-19.
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: '200',
    offset: '0',
    audioformat: 'mp32',
    include: 'musicinfo',
    search: 'carnatic',
  });

  let rawTracks = [];
  try {
    const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.headers?.status === 'success' && data.headers?.code === 0) {
        rawTracks = Array.isArray(data.results) ? data.results : [];
      }
    }
  } catch (err) {
    console.error('[VibeStream] Error fetching carnatic tracks:', err);
  }

  // Apply strict Tamil/Carnatic relevance filter + require playable audio
  const seen = new Set();
  const catalog = [];
  for (const track of rawTracks) {
    const trackId = String(track.id);
    if (seen.has(trackId)) continue;
    seen.add(trackId);

    const audio = track.audio || track.audiodownload;
    if (!audio) continue;                // must be playable
    if (!isTamilCarnatic(track)) {       // must be verifiably Tamil/Carnatic
      console.log(`[VibeStream] Tamil filter: rejected "${track.name}" by "${track.artist_name}"`);
      continue;
    }
    catalog.push(track);
  }

  console.log(`[VibeStream] Tamil catalog: ${catalog.length}/${rawTracks.length} tracks passed Tamil filter`);

  tamilCache = catalog;
  tamilCacheExpiry = now + TAMIL_CACHE_TTL_MS;
  return catalog;
}

// ─── Health endpoint ────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  const clientId = getJamendoClientId();
  res.json({
    status: "ok",
    message: "VibeStream backend running",
    jamendo_client_id_set: !!clientId,
    jamendo_client_id_preview: clientId ? `${clientId.slice(0, 4)}****` : "NOT SET"
  });
});

// ─── Tamil music catalog endpoint ──────────────────────────────────────────
// GET /api/songs/tamil?limit=50&offset=0
// Returns paginated slice of the merged, deduplicated Tamil catalog.
app.get("/api/songs/tamil", async (req, res) => {
  const clientId = getJamendoClientId();

  if (!clientId || clientId === 'your_client_id_here') {
    return res.status(503).json({
      error: "Jamendo client ID not configured on server.",
      songs: [],
      total: 0
    });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // Force cache refresh if requested
    if (req.query.refresh === '1') {
      tamilCache = null;
      tamilCacheExpiry = 0;
    }

    const catalog = await buildTamilCatalog(clientId);
    const total = catalog.length;
    const page = catalog.slice(offset, offset + limit);
    const songs = page.map(mapTrack);

    console.log(`[VibeStream] Tamil: returning ${songs.length}/${total} tracks (offset=${offset})`);

    return res.json({
      songs,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('[VibeStream] Error building Tamil catalog:', error);
    return res.status(500).json({
      error: 'Internal server error fetching Tamil music catalog',
      songs: [],
      total: 0
    });
  }
});

// ─── General songs endpoint ─────────────────────────────────────────────────

// GET /api/songs: Fetches live tracks from Jamendo API v3.0 using process.env.JAMENDO_CLIENT_ID
app.get("/api/songs", async (req, res) => {
  const clientId = getJamendoClientId();

  if (!clientId || clientId === 'your_client_id_here') {
    console.error(
      "[VibeStream] JAMENDO_CLIENT_ID is not set in environment.\n" +
      "  → Create backend/.env with: JAMENDO_CLIENT_ID=your_key_here\n" +
      "  → Register at https://devportal.jamendo.com to get a free client ID."
    );
    return res.status(503).json({
      error: "Jamendo client ID not configured on server. Set JAMENDO_CLIENT_ID environment variable.",
      songs: [],
      total: 0
    });
  }

  try {
    const rawSearch = (req.query.search || req.query.q || '').trim();
    const rawTags = (req.query.tags || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // Build Jamendo URL
    // - audioformat=mp32 gives a direct streamable MP3 URL in `audio` field
    // - name_search is used for search (searches title and artist)
    // - id_asc as default order avoids the popularity_total usage-limit issue
    const params = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      limit: String(limit),
      offset: String(offset),
      audioformat: 'mp32',
      include: 'musicinfo',
    });

    if (rawTags) {
      params.set('tags', rawTags);
    }

    if (rawSearch) {
      // search = full text search across track, artist, album, tags
      params.set('search', rawSearch);
    } else if (!rawTags) {
      // id_asc is a safe default that doesn't trigger usage limits
      params.set('order', 'id_asc');
    }

    const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;
    console.log(`[VibeStream] Fetching Jamendo: ${jamendoUrl.replace(clientId, clientId.slice(0, 4) + '****')}`);

    const response = await fetch(jamendoUrl);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[VibeStream] Jamendo HTTP error ${response.status}:`, text);
      return res.status(502).json({
        error: `Jamendo API returned HTTP ${response.status}`,
        songs: [],
        total: 0
      });
    }

    const data = await response.json();

    // Log full headers for debugging
    if (data.headers) {
      const { status, code, error_message, warnings, results_count } = data.headers;
      console.log(`[VibeStream] Jamendo response: status=${status} code=${code} results=${results_count} warnings="${warnings || ''}" error="${error_message || ''}"`);

      if (status !== 'success' || code !== 0) {
        console.error(`[VibeStream] Jamendo API error: code=${code} message="${error_message}"`);
        return res.status(502).json({
          error: error_message || `Jamendo API error code ${code}`,
          code,
          songs: [],
          total: 0
        });
      }

      // Detect usage limits (results_count=0 with a warning is the rate-limit signature)
      if (results_count === 0 && warnings && warnings.includes('Usage limits')) {
        console.error(
          `[VibeStream] Jamendo usage limits exceeded for client_id=${clientId.slice(0, 4)}****\n` +
          `  → The client ID has been rate-limited or banned by Jamendo.\n` +
          `  → Register a new key at https://devportal.jamendo.com`
        );
        return res.status(429).json({
          error: 'Jamendo API usage limits exceeded for this client ID. Please register a new key at devportal.jamendo.com.',
          songs: [],
          total: 0
        });
      }
    }

    const results = Array.isArray(data.results) ? data.results : [];

    const songs = results.map(mapTrack);

    console.log(`[VibeStream] Returning ${songs.length} tracks to client`);

    return res.json({
      songs,
      total: data.headers?.results_count ?? songs.length,
      limit,
      offset
    });

  } catch (error) {
    console.error('[VibeStream] Backend error fetching Jamendo songs:', error);
    return res.status(500).json({
      error: 'Internal server error fetching music catalog',
      songs: [],
      total: 0
    });
  }
});

// ─── Spotify Client Credentials token cache ─────────────────────────────────
// Tokens last 3600 s; we refresh 60 s early to avoid races.
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

/**
 * Obtain (and cache) a Spotify Client Credentials Bearer token.
 * Uses SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET from environment.
 * The secret is NEVER sent to the client.
 */
async function getSpotifyToken() {
  const clientId     = (process.env.SPOTIFY_CLIENT_ID     || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in environment.');
  }

  const now = Date.now();
  if (_spotifyToken && now < _spotifyTokenExpiry) {
    return _spotifyToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  _spotifyToken = data.access_token;
  // Expire 60 s early to avoid using a token that's about to expire
  _spotifyTokenExpiry = now + (data.expires_in - 60) * 1000;

  console.log('[VibeStream] Spotify token refreshed (expires in ~' + data.expires_in + 's)');
  return _spotifyToken;
}

/**
 * Map a Spotify track object to a clean, attribution-ready metadata object.
 * Deliberately OMITS preview_url and any audio download link.
 */
function mapSpotifyTrack(track) {
  const artists = (track.artists || []).map(a => a.name).join(', ') || 'Unknown Artist';
  const images  = track.album?.images || [];
  // Pick the largest available artwork (Spotify returns multiple sizes)
  const artwork = images.length > 0 ? images[0].url : null;

  return {
    source:      'spotify',                      // Always set — so UI can attribute correctly
    spotifyId:   track.id,
    spotifyUrl:  track.external_urls?.spotify || null,
    title:       track.name || 'Untitled',
    artist:      artists,
    album:       track.album?.name || 'Unknown Album',
    artwork,
    releaseDate: track.album?.release_date || null,
    durationMs:  track.duration_ms || 0,
    explicit:    track.explicit || false,
    popularity:  track.popularity ?? null,
    // NOTE: no `audio`, no `file`, no `preview_url` — metadata only.
  };
}

// ─── Spotify Tamil metadata endpoint ────────────────────────────────────────
// GET /api/spotify/tamil?q=tamil+music&limit=50&offset=0
//
// Returns Spotify track metadata for Tamil/Carnatic music searches.
// Does NOT stream, download, proxy, or rip audio. Metadata only.
// All results include source:"spotify" for proper attribution.
app.get('/api/spotify/tamil', async (req, res) => {
  const clientId     = (process.env.SPOTIFY_CLIENT_ID     || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    return res.status(503).json({
      error: 'Spotify credentials not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to backend/.env',
      tracks: [],
      total: 0,
    });
  }

  try {
    const rawQ   = (req.query.q || 'tamil music').trim() || 'tamil music';
    const limit  = Math.min(Math.max(parseInt(req.query.limit,  10) || 50, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const token = await getSpotifyToken();

    const params = new URLSearchParams({
      q:      rawQ,
      type:   'track',
      market: 'IN',          // India market — best coverage for Tamil music
      limit:  String(limit),
      offset: String(offset),
    });

    const searchUrl = `https://api.spotify.com/v1/search?${params.toString()}`;
    console.log(`[VibeStream] Spotify search: q="${rawQ}" limit=${limit} offset=${offset}`);

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error(`[VibeStream] Spotify search error ${searchRes.status}:`, errText);
      let parsedErr = errText;
      try {
        const jsonErr = JSON.parse(errText);
        parsedErr = jsonErr.error?.message || jsonErr.error_description || errText;
      } catch (e) {}
      return res.status(502).json({
        error: `Spotify API error (${searchRes.status}): ${parsedErr}`,
        details: parsedErr,
        tracks: [],
        total: 0,
      });
    }

    const data = await searchRes.json();
    const items = data.tracks?.items || [];
    const total = data.tracks?.total ?? 0;

    const tracks = items.map(mapSpotifyTrack);

    console.log(`[VibeStream] Spotify: returning ${tracks.length}/${total} tracks for q="${rawQ}"`);

    return res.json({
      source:  'spotify',
      query:   rawQ,
      tracks,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      attribution: 'Music data provided by Spotify. Playback requires a Spotify account.',
    });

  } catch (err) {
    console.error('[VibeStream] Spotify endpoint error:', err.message);
    return res.status(500).json({
      error: err.message || 'Internal server error fetching Spotify metadata',
      tracks: [],
      total: 0,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    const clientId = process.env.JAMENDO_CLIENT_ID;
    console.log(`[VibeStream] Backend running at http://localhost:${PORT}`);
    if (clientId) {
      console.log(`[VibeStream] JAMENDO_CLIENT_ID loaded: ${clientId.slice(0, 4)}****`);
    } else {
      console.warn(`[VibeStream] ⚠️  JAMENDO_CLIENT_ID is NOT set. Create backend/.env with your key.`);
    }
  });
}

module.exports = app;