// ─── Spotify Client Credentials token cache (module-scoped for warm reuse) ──
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  const clientId     = (process.env.SPOTIFY_CLIENT_ID     || '').trim();
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in environment.');
  }
  const now = Date.now();
  if (_spotifyToken && now < _spotifyTokenExpiry) return _spotifyToken;

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
  _spotifyTokenExpiry = now + (data.expires_in - 60) * 1000;
  return _spotifyToken;
}

function mapSpotifyTrack(track) {
  const artists = (track.artists || []).map(a => a.name).join(', ') || 'Unknown Artist';
  const images  = track.album?.images || [];
  const artwork = images.length > 0 ? images[0].url : null;
  return {
    source:      'spotify',
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
    // NOTE: no audio, no file, no preview_url — metadata only.
  };
}

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Parse URL carefully to support /api/songs or /songs
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

  // ─── Tamil music catalog endpoint ──────────────────────────────────────────
  // Must be checked BEFORE /songs because /songs/tamil also ends with /songs
  if (pathname.endsWith('/songs/tamil')) {
    const clientId = process.env.JAMENDO_CLIENT_ID ? process.env.JAMENDO_CLIENT_ID.trim() : '';

    if (!clientId || clientId === 'your_client_id_here') {
      return res.status(503).json({
        error: "Jamendo client ID not configured on server. Set JAMENDO_CLIENT_ID environment variable.",
        songs: [],
        total: 0
      });
    }

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
    });

    // Words that confirm a track is genuine Carnatic/Tamil classical music.
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
    const CARNATIC_BLOCKLIST = [
      'vande mataram',
      'national anthem',
      'patriotic',
    ];

    // Album names that are known Carnatic concert albums in this dataset
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

    let tamilCache = null;
    let tamilCacheExpiry = 0;
    const TAMIL_CACHE_TTL_MS = 30 * 60 * 1000;

    async function buildTamilCatalog(clientId) {
      const now = Date.now();
      if (tamilCache && now < tamilCacheExpiry) {
        return tamilCache;
      }

      console.log('[VibeStream] Building Tamil/Carnatic catalog from Jamendo...');

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

      const seen = new Set();
      const catalog = [];
      for (const track of rawTracks) {
        const trackId = String(track.id);
        if (seen.has(trackId)) continue;
        seen.add(trackId);

        const audio = track.audio || track.audiodownload;
        if (!audio) continue;
        if (!isTamilCarnatic(track)) {
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

    try {
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset'), 10) || 0, 0);

      if (urlObj.searchParams.get('refresh') === '1') {
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
  }

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

      const songs = results.map(track => ({
        id: String(track.id),
        title: track.name || 'Untitled Track',
        artist: track.artist_name || 'Unknown Artist',
        album: track.album_name || 'Jamendo',
        duration: track.duration || 0,
        artwork: track.image || track.album_image || null,
        audio: track.audio || track.audiodownload || null,
        file: track.audio || track.audiodownload || null,
        emoji: getEmojiForTrack(track.name || '', track.artist_name || ''),
      }));

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

  // ─── Spotify Tamil metadata endpoint ──────────────────────────────────────
  // GET /api/spotify/tamil?q=tamil+music&limit=50&offset=0
  // Metadata only — no audio, no streaming, no preview_url.
  if (pathname.endsWith('/spotify/tamil')) {
    const clientId     = (process.env.SPOTIFY_CLIENT_ID     || '').trim();
    const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      return res.status(503).json({
        error: 'Spotify credentials not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to environment.',
        tracks: [],
        total: 0,
      });
    }

    try {
      const rawQ   = (urlObj.searchParams.get('q') || 'tamil music').trim() || 'tamil music';
      const limit  = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit'),  10) || 50, 1), 50);
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset'), 10) || 0, 0);

      const token = await getSpotifyToken();

      const params = new URLSearchParams({
        q:      rawQ,
        type:   'track',
        market: 'IN',
        limit:  String(limit),
        offset: String(offset),
      });

      const searchRes = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!searchRes.ok) {
        const errText = await searchRes.text();
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

      const data   = await searchRes.json();
      const items  = data.tracks?.items || [];
      const total  = data.tracks?.total ?? 0;
      const tracks = items.map(mapSpotifyTrack);

      return res.status(200).json({
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
      return res.status(500).json({
        error: err.message || 'Internal server error fetching Spotify metadata',
        tracks: [],
        total: 0,
      });
    }
  }

  // Not found
  return res.status(404).json({ error: "Not found" });
};
