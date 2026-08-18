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

      if (searchRaw.trim()) {
        params.set('name_search', searchRaw.trim());
      } else {
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

  // Not found
  return res.status(404).json({ error: "Not found" });
};
