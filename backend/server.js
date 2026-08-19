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
// Strategy: run multiple Jamendo queries in parallel, merge, deduplicate by ID.
// Jamendo doesn't have a dedicated "Tamil" tag, so we use a combination of:
//  • tag searches for related genre tags
//  • full-text searches for Tamil-related keywords
const TAMIL_STRATEGIES = [
  // Tag-based queries
  { type: 'tags',   value: 'indian' },
  { type: 'tags',   value: 'carnatic' },
  { type: 'tags',   value: 'folk' },
  { type: 'tags',   value: 'world' },
  // Full-text search queries
  { type: 'search', value: 'tamil' },
  { type: 'search', value: 'carnatic' },
  { type: 'search', value: 'kollywood' },
  { type: 'search', value: 'india' },
  { type: 'search', value: 'south indian' },
];

// In-memory cache for merged Tamil catalog (refreshes every 30 min)
let tamilCache = null;
let tamilCacheExpiry = 0;
const TAMIL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch a single Jamendo query page.
 * Returns an array of raw track objects (or empty array on failure).
 */
async function fetchJamendoPage(clientId, strategy, limit, offset) {
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: String(limit),
    offset: String(offset),
    audioformat: 'mp32',
    include: 'musicinfo',
  });

  if (strategy.type === 'tags') {
    params.set('tags', strategy.value);
  } else {
    params.set('search', strategy.value);
  }

  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.headers || data.headers.status !== 'success' || data.headers.code !== 0) return [];
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

/**
 * Build (and cache) the merged Tamil catalog.
 * Runs all strategies in parallel, merges results, deduplicates by track ID,
 * filters out tracks with no audio URL, and returns a deduplicated list.
 */
async function buildTamilCatalog(clientId) {
  const now = Date.now();
  if (tamilCache && now < tamilCacheExpiry) {
    return tamilCache;
  }

  console.log('[VibeStream] Building Tamil catalog from Jamendo (multi-strategy)...');

  // Run all strategies in parallel, each fetching up to 200 results
  const results = await Promise.allSettled(
    TAMIL_STRATEGIES.map((strategy) => fetchJamendoPage(clientId, strategy, 200, 0))
  );

  const seen = new Set();
  const merged = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const tracks = result.value;
    for (const track of tracks) {
      const trackId = String(track.id);
      // Skip duplicates and tracks with no audio
      if (seen.has(trackId)) continue;
      const audio = track.audio || track.audiodownload;
      if (!audio) continue;
      seen.add(trackId);
      merged.push(track);
    }
  }

  console.log(`[VibeStream] Tamil catalog built: ${merged.length} unique tracks`);

  tamilCache = merged;
  tamilCacheExpiry = now + TAMIL_CACHE_TTL_MS;
  return merged;
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