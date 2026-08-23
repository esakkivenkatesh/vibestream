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

// Words that confirm a track is genuine Carnatic/Tamil classical music on Jamendo.
const CARNATIC_MARKERS = [
  'sindhubhairavi', 'thodi', 'behag', 'khamas', 'ganamurthi',
  'nalinakanthi', 'vasantha', 'hemavathi', 'mayamalavagowlai',
  'kapi', 'kaanada', 'hindolam', 'hindola',
  'shubapantuvarali', 'maand', 'anandhavalli',
  'alaipayuthey', 'irakkam', 'punnaimaranizhalil', 'chinnanchirupennpole',
  'santanagopalakrishnam', 'ganamurthe', 'kaddanuvariki',
  'manavyalagincharathate', 'deva-deva', 'ragamalika', 'alapana', 'varnam',
  'jagadhodharana', 'srisatyanarayanam', 'muralidhara', 'su-r-li',
  'aswinsainarain', 'music@ncbs',
];

const CARNATIC_BLOCKLIST = [
  'vande mataram',
  'national anthem',
  'patriotic',
];

const CARNATIC_ALBUM_MARKERS = [
  'carnatic', 'indian carnatic',
];

function isTamilCarnatic(track) {
  const name    = (track.name || '').toLowerCase();
  const artist  = (track.artist_name || '').toLowerCase();
  const album   = (track.album_name || '').toLowerCase();
  const vartags = (track.musicinfo?.tags?.vartags || []).join(' ').toLowerCase();
  const genres  = (track.musicinfo?.tags?.genres  || []).join(' ').toLowerCase();

  const nonCarnaticGenres = ['jazz', 'rock', 'ragga', 'hiphop', 'electronic', 'pop', 'reggae', 'metal', 'punk', 'blues', 'country', 'folk'];
  const hasBadGenre = nonCarnaticGenres.some(g => genres.includes(g));
  const hasSpecificCarnatic = CARNATIC_MARKERS.some(marker => vartags.includes(marker));
  if (hasBadGenre && !hasSpecificCarnatic) return false;

  const normalizedName = name.replace(/[-_ ]+/g, ' ');
  if (CARNATIC_BLOCKLIST.some(pattern => normalizedName.includes(pattern))) return false;

  const combined = `${name} ${artist} ${album} ${vartags}`;
  return CARNATIC_MARKERS.some(marker => combined.includes(marker)) ||
         CARNATIC_ALBUM_MARKERS.some(marker => album.includes(marker));
}

let jamendoTamilCache = null;
let jamendoTamilCacheExpiry = 0;
const JAMENDO_CACHE_TTL_MS = 30 * 60 * 1000;

async function buildJamendoTamilCatalog(clientId) {
  const now = Date.now();
  if (jamendoTamilCache && now < jamendoTamilCacheExpiry) {
    return jamendoTamilCache;
  }

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

  if (catalog.length > 0) {
    jamendoTamilCache = catalog;
    jamendoTamilCacheExpiry = now + JAMENDO_CACHE_TTL_MS;
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
  const timeoutId = setTimeout(() => controller.abort(), 3000);
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

function isAudiusAllowedLicense(lic) {
  if (!lic || typeof lic !== 'string') return false;
  const l = lic.trim().toLowerCase();

  // Explicitly reject NC (NonCommercial), ND (NoDerivs), and All rights reserved
  if (l.includes('nc') || l.includes('noncommercial') || l.includes('nd') || l.includes('noderivs') || l.includes('all rights reserved')) {
    return false;
  }

  // Allow CC BY, CC0, and Public Domain
  if (l.includes('cc by') || l === 'cc0' || l.includes('public domain') || l.includes('cc-by')) {
    return true;
  }

  return false;
}

function isVerifiedAudiusTamil(track) {
  const lic = (track.license || '').trim();
  if (!isAudiusAllowedLicense(lic)) {
    return false;
  }

  const title = track.title || '';
  const desc = track.description || '';
  const tags = track.tags || '';
  const genre = track.genre || '';
  const artist = track.user?.name || '';
  const combinedText = `${title} ${desc} ${tags} ${genre} ${artist}`.toLowerCase();

  if (AUDIUS_MIXED_LANGUAGE_REGEX.test(combinedText)) {
    return false;
  }

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

  audiusCache = catalog;
  audiusCacheExpiry = now + AUDIUS_CACHE_TTL_MS;
  return catalog;
}

async function buildCombinedTamilCatalog(clientId) {
  const jamendoRaw = await buildJamendoTamilCatalog(clientId);
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

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname.endsWith('/health')) {
    const clientId = process.env.JAMENDO_CLIENT_ID ? process.env.JAMENDO_CLIENT_ID.trim() : '';
    return res.status(200).json({
      status: "ok",
      message: "VibeStream Vercel API running",
      jamendo_client_id_set: !!clientId,
      jamendo_client_id_preview: clientId ? `${clientId.slice(0, 4)}****` : "NOT SET"
    });
  }

  // ─── Audius Tamil route ────────────────────────────────────────────────────
  if (pathname.endsWith('/audius/tamil')) {
    try {
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset'), 10) || 0, 0);

      if (urlObj.searchParams.get('refresh') === '1') {
        audiusCache = null;
        audiusCacheExpiry = 0;
      }

      const catalog = await buildAudiusTamilCatalog();
      const total = catalog.length;
      const page = catalog.slice(offset, offset + limit);

      return res.status(200).json({
        source: 'audius',
        songs: page,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      });
    } catch (error) {
      console.error('[VibeStream] Error fetching Audius Tamil catalog:', error);
      return res.status(500).json({
        error: 'Internal server error fetching Audius Tamil catalog',
        songs: [],
        total: 0
      });
    }
  }

  // ─── Tamil music catalog endpoint ──────────────────────────────────────────
  if (pathname.endsWith('/songs/tamil')) {
    const clientId = process.env.JAMENDO_CLIENT_ID ? process.env.JAMENDO_CLIENT_ID.trim() : '';

    try {
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset'), 10) || 0, 0);

      if (urlObj.searchParams.get('refresh') === '1') {
        jamendoTamilCache = null;
        jamendoTamilCacheExpiry = 0;
        audiusCache = null;
        audiusCacheExpiry = 0;
      }

      const catalog = await buildCombinedTamilCatalog(clientId);
      const total = catalog.length;
      const page = catalog.slice(offset, offset + limit);

      return res.status(200).json({
        songs: page,
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
  }

  // ─── General songs endpoint ─────────────────────────────────────────────────
  if (pathname.endsWith('/songs')) {
    const clientId = process.env.JAMENDO_CLIENT_ID ? process.env.JAMENDO_CLIENT_ID.trim() : '';

    if (!clientId || clientId === 'your_client_id_here') {
      return res.status(503).json({
        error: "Jamendo client ID not configured on server. Set JAMENDO_CLIENT_ID environment variable.",
        songs: [],
        total: 0
      });
    }

    try {
      const limitRaw = urlObj.searchParams.get('limit');
      const offsetRaw = urlObj.searchParams.get('offset');
      const searchRaw = urlObj.searchParams.get('search') || urlObj.searchParams.get('q') || '';
      const tagsRaw = urlObj.searchParams.get('tags') || '';

      const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(offsetRaw, 10) || 0, 0);

      const params = new URLSearchParams({
        client_id: clientId,
        format: 'json',
        limit: String(limit),
        offset: String(offset),
        audioformat: 'mp32',
        include: 'musicinfo',
      });

      if (tagsRaw.trim()) {
        params.set('tags', tagsRaw.trim());
      }

      if (searchRaw.trim()) {
        params.set('search', searchRaw.trim());
      } else if (!tagsRaw.trim()) {
        params.set('order', 'id_asc');
      }

      const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`);

      if (!response.ok) {
        return res.status(502).json({
          error: `Jamendo API returned HTTP ${response.status}`,
          songs: [],
          total: 0
        });
      }

      const data = await response.json();

      if (data.headers && (data.headers.status !== 'success' || data.headers.code !== 0)) {
        return res.status(502).json({
          error: data.headers.error_message || `Jamendo API error code ${data.headers.code}`,
          code: data.headers.code,
          songs: [],
          total: 0
        });
      }

      const results = Array.isArray(data.results) ? data.results : [];
      const songs = results.map(mapTrack);

      return res.status(200).json({
        songs,
        total: data.headers?.results_count ?? songs.length,
        limit,
        offset
      });

    } catch (error) {
      console.error('[VibeStream] Error fetching Jamendo songs:', error);
      return res.status(500).json({
        error: 'Internal server error fetching music catalog',
        songs: [],
        total: 0
      });
    }
  }

  // Not found
  return res.status(404).json({ error: "Not found" });
};

