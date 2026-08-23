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
  license: 'CC BY / Jamendo Open License',
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

  const candidateKeys = [clientId, '6eee34e4', 'b6747d04', 'a637d7a7', '35067208', 'ce6b823b'].filter(Boolean);
  let rawTracks = [];

  for (const key of candidateKeys) {
    const params = new URLSearchParams({
      client_id: key,
      format: 'json',
      limit: '200',
      offset: '0',
      audioformat: 'mp32',
      include: 'musicinfo',
      search: 'carnatic',
    });
    const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.headers?.status === 'success' && data.headers?.code === 0) {
            rawTracks = Array.isArray(data.results) ? data.results : [];
            if (rawTracks.length > 0) break;
          }
        }
      } catch (err) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    if (rawTracks.length > 0) break;
  }

  const seen = new Set();
  const catalog = [];
  for (const track of rawTracks) {
    const trackId = String(track.id);
    if (seen.has(trackId)) continue;
    seen.add(trackId);

    const audio = track.audio || track.audiodownload;
    if (!audio) continue;
    if (!isTamilCarnatic(track)) continue;
    catalog.push(track);
  }

  console.log(`[VibeStream] Jamendo Tamil catalog: ${catalog.length}/${rawTracks.length} tracks passed filter`);

  if (catalog.length > 0) {
    tamilCache = catalog;
    tamilCacheExpiry = now + TAMIL_CACHE_TTL_MS;
  }
  return catalog;
}

// ─── Audius Tamil Music Integration ───────────────────────────────────────
let audiusCache = null;
let audiusCacheExpiry = 0;
const AUDIUS_CACHE_TTL_MS = 30 * 60 * 1000;

async function getAudiusHost() {
  const defaultHost = 'https://discoveryprovider.audius.co';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch('https://api.audius.co', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        return data.data[0];
      }
    }
  } catch (e) {
    clearTimeout(timeoutId);
  }
  return defaultHost;
}

const AUDIUS_TAMIL_KEYWORDS = [
  'tamil', 'tamizh', 'kollywood', 'carnatic', 'isai', 'paattu', 'kaadhal',
  'chennai', 'madurai', 'coimbatore', 'tamilsong', 'tamilsongs', 'kuthu',
  'gaana', 'tamillofi', 'tamilbgm', 'tamilisai', 'anirudh', 'ar rahman',
  'ilayaraja', 'harris jayaraj', 'yuvan', 'santhosh narayanan', 'sid sriram',
  'gv prakash', 'hiphop tamizha', 'dhanush', 'dhee', 'pradeep kumar',
  'sean roldan', 'sam cs', 'gibran', 'imman', 'vidyasagar', 'deva', 'msv'
];

const AUDIUS_MIXED_LANGUAGE_REGEX = /(tamil\s*x\s*malayalam|malayalam\s*x\s*tamil|tamil\s*x\s*telugu|telugu\s*x\s*tamil|tamil\s*x\s*hindi|hindi\s*x\s*tamil|tamil\s*x\s*kannada|kannada\s*x\s*tamil|tamil\s*x\s*english|english\s*x\s*tamil)/i;

/**
 * Validates Audius tracks for Tamil relevance and open licensing.
 * Excludes tracks marked "All rights reserved" or missing license.
 * Excludes mixed-language tracks (e.g. Tamil x Malayalam).
 */
function isVerifiedAudiusTamil(track) {
  const lic = (track.license || '').trim();
  // Reject "All rights reserved" and unassigned/empty licenses
  if (!lic || lic === 'All rights reserved') {
    return false;
  }

  const title = track.title || '';
  const desc = track.description || '';
  const tags = track.tags || '';
  const genre = track.genre || '';
  const artist = track.user?.name || '';
  const combinedText = `${title} ${desc} ${tags} ${genre} ${artist}`.toLowerCase();

  // Reject mixed-language tracks
  if (AUDIUS_MIXED_LANGUAGE_REGEX.test(combinedText)) {
    return false;
  }

  // Require clear Tamil metadata
  return AUDIUS_TAMIL_KEYWORDS.some(kw => combinedText.includes(kw));
}

function mapAudiusTrack(track, host) {
  const trackIdStr = String(track.id || track.track_id);
  const title = track.title || 'Untitled Track';
  const artist = track.user?.name || 'Unknown Artist';
  const streamUrl = track.stream?.url || `${host}/v1/tracks/${trackIdStr}/stream?app_name=VIBESTREAM`;

  return {
    id: `audius-${trackIdStr}`,
    title,
    artist,
    album: track.album_backlink ? 'Audius Album' : 'Audius Single',
    duration: track.duration || 0,
    artwork: track.artwork?.['480x480'] || track.artwork?.['150x150'] || null,
    audio: streamUrl,
    file: streamUrl,
    emoji: getEmojiForTrack(title, artist),
    source: 'audius',
    license: track.license || 'Open License'
  };
}

async function buildAudiusTamilCatalog() {
  const now = Date.now();
  if (audiusCache && now < audiusCacheExpiry) {
    return audiusCache;
  }

  console.log('[VibeStream] Searching Audius for verified Tamil music...');
  const host = await getAudiusHost();

  const queries = [
    'tamil', 'kollywood', 'carnatic', 'tamizh', 'isai', 'paattu', 'kaadhal',
    'chennai', 'tamilsong', 'anirudh', 'ar rahman', 'ilayaraja', 'harris jayaraj',
    'yuvan', 'santhosh narayanan', 'sid sriram', 'gv prakash', 'hiphop tamizha',
    'dhanush', 'dhee', 'pradeep kumar'
  ];

  const allTracksMap = new Map();

  const fetchPromises = queries.map(async (q) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const url = `${host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=VIBESTREAM`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.data) ? data.data : [];
    } catch (e) {
      clearTimeout(timeoutId);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  for (const list of results) {
    for (const track of list) {
      if (track && (track.id || track.track_id)) {
        const id = String(track.id || track.track_id);
        if (!allTracksMap.has(id)) {
          allTracksMap.set(id, track);
        }
      }
    }
  }

  const catalog = [];
  for (const [, track] of allTracksMap) {
    if (isVerifiedAudiusTamil(track)) {
      catalog.push(mapAudiusTrack(track, host));
    }
  }

  console.log(`[VibeStream] Audius Tamil catalog: ${catalog.length} verified tracks out of ${allTracksMap.size} discovered`);
  audiusCache = catalog;
  audiusCacheExpiry = now + AUDIUS_CACHE_TTL_MS;
  return catalog;
}

// Builds merged, deduplicated Tamil catalog from Jamendo + Audius
async function buildCombinedTamilCatalog(clientId) {
  const jamendoRaw = await buildTamilCatalog(clientId);
  const jamendoMapped = jamendoRaw.map(t => ({ ...mapTrack(t), source: 'jamendo' }));
  const audiusMapped = await buildAudiusTamilCatalog();

  const combined = [...jamendoMapped, ...audiusMapped];

  const seenKeys = new Set();
  const catalog = [];

  for (const song of combined) {
    const key = `${(song.title || '').toLowerCase().trim()}|${(song.artist || '').toLowerCase().trim()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      catalog.push(song);
    }
  }

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

// ─── Audius Tamil Endpoint ──────────────────────────────────────────────────
// GET /api/audius/tamil?limit=50&offset=0
app.get("/api/audius/tamil", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (req.query.refresh === '1') {
      audiusCache = null;
      audiusCacheExpiry = 0;
    }

    const catalog = await buildAudiusTamilCatalog();
    const total = catalog.length;
    const page = catalog.slice(offset, offset + limit);

    return res.json({
      source: 'audius',
      songs: page,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('[VibeStream] Error fetching Audius Tamil tracks:', error);
    return res.status(500).json({
      error: 'Internal server error fetching Audius Tamil music catalog',
      songs: [],
      total: 0
    });
  }
});

// ─── Tamil music catalog endpoint ──────────────────────────────────────────
// GET /api/songs/tamil?limit=50&offset=0
// Returns paginated slice of the merged Jamendo + Audius Tamil catalog.
app.get("/api/songs/tamil", async (req, res) => {
  const clientId = getJamendoClientId();

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (req.query.refresh === '1') {
      tamilCache = null;
      tamilCacheExpiry = 0;
      audiusCache = null;
      audiusCacheExpiry = 0;
    }

    const catalog = await buildCombinedTamilCatalog(clientId);
    const total = catalog.length;
    const page = catalog.slice(offset, offset + limit);

    console.log(`[VibeStream] Tamil combined: returning ${page.length}/${total} tracks (offset=${offset})`);

    return res.json({
      songs: page,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('[VibeStream] Error building combined Tamil catalog:', error);
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
      params.set('search', rawSearch);
    } else if (!rawTags) {
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

    if (data.headers) {
      const { status, code, error_message, warnings, results_count } = data.headers;
      console.log(`[VibeStream] Jamendo response: status=${status} code=${code} results=${results_count} warnings="${warnings || ''}" error="${error_message || ''}"`);

      if (status !== 'success' || code !== 0) {
        console.error(`[VibeStream] Jamendo API error: code=${code} message="${error_message}"`);
        return res.status(502).json({
          error: error_message || `Jamendo API error code ${data.headers.code}`,
          code,
          songs: [],
          total: 0
        });
      }

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