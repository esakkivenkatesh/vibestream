import { useEffect, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL !== undefined
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.DEV ? 'http://localhost:5000' : '')


const playlistCards = [
  { title: 'Chill Vibes', description: 'Relaxing music', emoji: '🎧' },
  { title: 'Top Hits', description: 'Your favorite hits', emoji: '🔥' },
  { title: 'Night Drive', description: 'Music for late nights', emoji: '🌙' },
  { title: 'Workout', description: 'Energy for your workout', emoji: '💪' },
  { title: 'Focus Flow', description: 'Music to concentrate', emoji: '🧠' },
]

const PLAYLIST_STORAGE_KEY = 'vibestream-playlists'
const RECENTLY_PLAYED_STORAGE_KEY = 'vibestream-recently-played'
const PLAYBACK_SETTINGS_STORAGE_KEY = 'vibestream-playback-settings'

const getStoredPlaylists = () => {
  try {
    const storedPlaylists = JSON.parse(
      window.localStorage.getItem(PLAYLIST_STORAGE_KEY) || '[]',
    )

    return Array.isArray(storedPlaylists)
      ? storedPlaylists.filter(
          (playlist) =>
            playlist &&
            typeof playlist.id === 'string' &&
            typeof playlist.name === 'string' &&
            Array.isArray(playlist.songTitles),
        )
      : []
  } catch {
    return []
  }
}

const getStoredRecentlyPlayed = () => {
  try {
    const storedSongs = JSON.parse(
      window.localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]',
    )

    return Array.isArray(storedSongs)
      ? storedSongs.filter((title) => typeof title === 'string')
      : []
  } catch {
    return []
  }
}

const getStoredPlaybackSettings = () => {
  try {
    const settings = JSON.parse(
      window.localStorage.getItem(PLAYBACK_SETTINGS_STORAGE_KEY) || '{}',
    )

    return {
      isShuffleEnabled: settings.isShuffleEnabled === true,
      repeatMode: ['off', 'song', 'all'].includes(settings.repeatMode)
        ? settings.repeatMode
        : 'off',
    }
  } catch {
    return { isShuffleEnabled: false, repeatMode: 'off' }
  }
}

const EMOJI_LIST = ['🎵', '🌌', '🌃', '🎧', '🔥', '🌙', '💪', '🧠', '✨', '🎶', '🎸', '🎹']
const getEmojiForTrack = (title, artist) => {
  const str = (title + artist).toLowerCase()
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return EMOJI_LIST[Math.abs(hash) % EMOJI_LIST.length]
}

function App() {
  const audioRef = useRef(null)
  const [songs, setSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [apiError, setApiError] = useState(null)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')

  const observerTarget = useRef(null)

  const fetchSongs = (searchQuery = '', currentOffset = 0, filter = 'all') => {
    if (currentOffset === 0) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    setApiError(null)

    const q = searchQuery.trim()

    let url
    if (!q && filter === 'tamil') {
      // Use the dedicated Tamil discovery endpoint
      url = `${API_URL}/api/songs/tamil?limit=50&offset=${currentOffset}`
    } else {
      let queryParam = `?limit=50&offset=${currentOffset}`
      if (q) {
        queryParam += `&search=${encodeURIComponent(q)}`
      }
      url = `${API_URL}/api/songs${queryParam}`
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch songs')
        return res.json()
      })
      .then((data) => {
        const rawList = Array.isArray(data) ? data : (data.songs || [])
        const mappedSongs = rawList.map((song) => ({
          id: String(song.id || song.title),
          title: song.title,
          artist: song.artist,
          album: song.album || 'Jamendo Collection',
          duration: song.duration || 0,
          artwork: song.artwork || song.image || null,
          audio: song.audio || song.file,
          emoji: song.emoji || getEmojiForTrack(song.title || '', song.artist || ''),
        }))
        
        if (currentOffset === 0) {
          setSongs(mappedSongs)
        } else {
          setSongs(prev => [...prev, ...mappedSongs])
        }

        // Use the explicit hasMore field if present (Tamil endpoint), otherwise
        // infer from page size (general endpoint returns up to 50 per page)
        if (typeof data.hasMore === 'boolean') {
          setHasMore(data.hasMore)
        } else {
          setHasMore(mappedSongs.length === 50)
        }
        setLoading(false)
        setLoadingMore(false)
        setApiError(null)
      })
      .catch((err) => {
        console.error('Error fetching Jamendo songs from backend:', err)
        setLoading(false)
        setLoadingMore(false)
        setApiError('Unable to load tracks from server. Please try again.')
      })
  }

  const loadMore = () => {
    if (!loading && !loadingMore && hasMore) {
      const newOffset = offset + 50
      setOffset(newOffset)
      fetchSongs(search, newOffset, activeFilter)
    }
  }

  useEffect(() => {
    let isMounted = true
    const timer = setTimeout(() => {
      if (isMounted) {
        setOffset(0)
        setHasMore(true)
        fetchSongs(search, 0, activeFilter)
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [search, activeFilter])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current)
      }
    }
  }, [observerTarget.current, hasMore, loading, loadingMore, offset, search, activeFilter])

  const createShuffledQueue = (currentSong, songList = songs) => {
    const queue = songList.filter((song) => song.title !== currentSong?.title)

    for (let index = queue.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      ;[queue[index], queue[randomIndex]] = [queue[randomIndex], queue[index]]
    }

    return queue
  }
  const [currentSong, setCurrentSong] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.65)
  const [likedSongs, setLikedSongs] = useState([])
  const [showLikedSongs, setShowLikedSongs] = useState(false)
  const [userPlaylists, setUserPlaylists] = useState(getStoredPlaylists)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null)
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [isAddSongsOpen, setIsAddSongsOpen] = useState(false)
  const [recentlyPlayed, setRecentlyPlayed] = useState(
    getStoredRecentlyPlayed,
  )
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(
    () => getStoredPlaybackSettings().isShuffleEnabled,
  )
  const [repeatMode, setRepeatMode] = useState(
    () => getStoredPlaybackSettings().repeatMode,
  )
  const [shuffleQueue, setShuffleQueue] = useState([])
  const [isQueueOpen, setIsQueueOpen] = useState(false)

  
  useEffect(() => {
    window.localStorage.setItem(
      PLAYLIST_STORAGE_KEY,
      JSON.stringify(userPlaylists),
    )
  }, [userPlaylists])

  useEffect(() => {
    window.localStorage.setItem(
      RECENTLY_PLAYED_STORAGE_KEY,
      JSON.stringify(recentlyPlayed),
    )
  }, [recentlyPlayed])

  useEffect(() => {
    window.localStorage.setItem(
      PLAYBACK_SETTINGS_STORAGE_KEY,
      JSON.stringify({ isShuffleEnabled, repeatMode }),
    )
  }, [isShuffleEnabled, repeatMode])

  useEffect(() => {
    if (!isShuffleEnabled) {
      setShuffleQueue([])
    } else if (currentSong) {
      setShuffleQueue(createShuffledQueue(currentSong))
    }
  }, [isShuffleEnabled])

  const filteredSongs = songs.filter((song) =>
    `${song.title} ${song.artist}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )

  const selectedPlaylist = userPlaylists.find(
    (playlist) => playlist.id === selectedPlaylistId,
  )

  const visibleSongs = selectedPlaylist
    ? filteredSongs.filter((song) =>
        selectedPlaylist.songTitles.includes(song.title),
      )
    : showLikedSongs
      ? filteredSongs.filter((song) => likedSongs.includes(song.title))
      : filteredSongs

  const upcomingSongs = (() => {
    if (!currentSong) return isShuffleEnabled ? shuffleQueue : songs
    if (repeatMode === 'song') return [currentSong]
    if (isShuffleEnabled) return shuffleQueue

    const currentIndex = songs.findIndex(
      (song) => song.title === currentSong.title,
    )
    const songsAfterCurrent = songs.slice(currentIndex + 1)

    return repeatMode === 'all'
      ? [...songsAfterCurrent, ...songs.slice(0, currentIndex)]
      : songsAfterCurrent
  })()

  const recentlyPlayedSongs = recentlyPlayed
    .map((title) => songs.find((song) => song.title === title))
    .filter(Boolean)

  const addRecentlyPlayed = (song) => {
    setRecentlyPlayed((currentSongs) => [
      song.title,
      ...currentSongs.filter((title) => title !== song.title),
    ])
  }

  const toggleLikedSong = (title) => {
    setLikedSongs((currentLikedSongs) =>
      currentLikedSongs.includes(title)
        ? currentLikedSongs.filter((likedTitle) => likedTitle !== title)
        : [...currentLikedSongs, title],
    )
  }

  const createPlaylist = (event) => {
    event.preventDefault()

    const name = playlistName.trim()
    if (!name) return

    const playlist = {
      id: `${Date.now()}-${name}`,
      name,
      songTitles: [],
    }

    setUserPlaylists((currentPlaylists) => [
      ...currentPlaylists,
      playlist,
    ])
    setSelectedPlaylistId(playlist.id)
    setShowLikedSongs(false)
    setIsAddSongsOpen(false)
    setPlaylistName('')
    setIsPlaylistModalOpen(false)
  }

  const addSongToSelectedPlaylist = (title) => {
    if (!selectedPlaylist) return

    setUserPlaylists((currentPlaylists) =>
      currentPlaylists.map((playlist) =>
        playlist.id === selectedPlaylist.id &&
        !playlist.songTitles.includes(title)
          ? { ...playlist, songTitles: [...playlist.songTitles, title] }
          : playlist,
      ),
    )
  }

  const openSongPicker = () => {
    if (selectedPlaylist) {
      setIsAddSongsOpen(true)
    }
  }

  const handlePlaylistSongAction = (title) => {
    if (!selectedPlaylist) return

    if (selectedPlaylist.songTitles.includes(title)) {
      openSongPicker()
      return
    }

    addSongToSelectedPlaylist(title)
  }

  const availablePlaylistSongs = selectedPlaylist
    ? songs.filter(
        (song) => !selectedPlaylist.songTitles.includes(song.title),
      )
    : []

  const playSong = async (song) => {
    const audio = audioRef.current

    if (!audio) return

    setCurrentSong(song)
    setCurrentTime(0)

    if (isShuffleEnabled) {
      setShuffleQueue(createShuffledQueue(song))
    }

    audio.src = song.audio
    audio.load()

    try {
      await audio.play()
      setIsPlaying(true)
      addRecentlyPlayed(song)
    } catch (error) {
      console.error('Audio could not play:', error)
      setIsPlaying(false)
    }
  }

  const changeSong = async (
    newSong,
    shouldPlay = isPlaying,
    shouldResetShuffleQueue = true,
  ) => {
    const audio = audioRef.current
    if (!audio) return

    setCurrentSong(newSong)
    setCurrentTime(0)

    if (isShuffleEnabled && shouldResetShuffleQueue) {
      setShuffleQueue(createShuffledQueue(newSong))
    }

    audio.src = newSong.audio
    audio.load()

    if (shouldPlay) {
      try {
        await audio.play()
        setIsPlaying(true)
        addRecentlyPlayed(newSong)
      } catch (error) {
        console.error('Audio could not play:', error)
        setIsPlaying(false)
      }
    }
  }

  const getRandomSong = (songToExclude) => {
    const choices = songs.filter((song) => song.title !== songToExclude?.title)
    return choices[Math.floor(Math.random() * choices.length)] || songs[0]
  }

  const restartCurrentSong = async (shouldPlay = isPlaying) => {
    const audio = audioRef.current
    if (!audio || !currentSong) return

    audio.currentTime = 0
    setCurrentTime(0)

    if (shouldPlay) {
      try {
        await audio.play()
        setIsPlaying(true)
      } catch (error) {
        console.error('Audio could not play:', error)
        setIsPlaying(false)
      }
    }
  }

  const playNext = async (shouldPlay = isPlaying) => {
    if (!currentSong) {
      await changeSong(isShuffleEnabled ? getRandomSong() : songs[0])
      return
    }

    if (repeatMode === 'song') {
      await restartCurrentSong(shouldPlay)
      return
    }

    if (isShuffleEnabled) {
      const nextSong = shuffleQueue[0] || getRandomSong(currentSong)
      setShuffleQueue((queue) => queue.slice(1))
      await changeSong(nextSong, shouldPlay, false)
      return
    }

    const currentIndex = songs.findIndex((s) => s.title === currentSong.title)
    const nextIndex = currentIndex + 1

    if (nextIndex < songs.length) {
      await changeSong(songs[nextIndex], shouldPlay)
    } else if (repeatMode === 'all') {
      await changeSong(songs[0], shouldPlay)
    } else {
      setIsPlaying(false)
      setCurrentTime(0)
    }
  }

  const playPrevious = async () => {
    if (!currentSong) {
      await changeSong(isShuffleEnabled ? getRandomSong() : songs[0])
      return
    }

    if (repeatMode === 'song') {
      await restartCurrentSong()
      return
    }

    if (isShuffleEnabled) {
      await changeSong(getRandomSong(currentSong), isPlaying)
      return
    }

    const currentIndex = songs.findIndex((s) => s.title === currentSong.title)
    const prevIndex = currentIndex - 1

    if (prevIndex >= 0) {
      await changeSong(songs[prevIndex], isPlaying)
    } else if (repeatMode === 'all') {
      await changeSong(songs[songs.length - 1], isPlaying)
    } else {
      await restartCurrentSong()
    }
  }

  const handleSongEnded = async () => {
    await playNext(true)
  }

  const cycleRepeatMode = () => {
    setRepeatMode((currentMode) =>
      currentMode === 'off'
        ? 'song'
        : currentMode === 'song'
          ? 'all'
          : 'off',
    )
  }

  const togglePlay = async () => {
    const audio = audioRef.current

    if (!audio) return

    if (!currentSong) {
      await playSong(isShuffleEnabled ? getRandomSong() : songs[0])
      return
    }

    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
        addRecentlyPlayed(currentSong)
      } catch (error) {
        console.error('Audio could not play:', error)
      }
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  const handleSeek = (event) => {
    const newTime = Number(event.target.value)
    setCurrentTime(newTime)
    if (audioRef.current) {
      audioRef.current.currentTime = newTime
    }
  }

  const handleVolumeChange = (event) => {
    const newVolume = Number(event.target.value)
    setVolume(newVolume)

    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
  }

  const formatTime = (time) => {
    if (!Number.isFinite(time)) return '0:00'

    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)

    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  const progressPercent =
    duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="app">
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleSongEnded}
      />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">●</span>
          VibeStream
        </div>

        <nav className="nav">
          <a
            className={`nav-item${
              showLikedSongs || selectedPlaylist ? '' : ' active'
            }`}
            href="#"
            onClick={() => {
              setShowLikedSongs(false)
              setSelectedPlaylistId(null)
              setIsAddSongsOpen(false)
            }}
          >
            <span>⌂</span>
            Home
          </a>

          <a className="nav-item" href="#">
            <span>⌕</span>
            Search
          </a>

          <a className="nav-item" href="#">
            <span>▣</span>
            Your Library
          </a>
        </nav>

        <div className="playlist-section">
          <div className="section-title">Your Playlists</div>

          <button
            type="button"
            className="playlist-link"
            onClick={() => setIsPlaylistModalOpen(true)}
          >
            ＋ Create Playlist
          </button>

          <a
            className="playlist-link"
            href="#liked-songs"
            onClick={(event) => {
              event.preventDefault()
              setShowLikedSongs(true)
              setSelectedPlaylistId(null)
              setIsAddSongsOpen(false)
            }}
          >
            ♥ Liked Songs
          </a>

          {userPlaylists.map((playlist) => (
            <a
              className={`playlist-link${
                selectedPlaylistId === playlist.id ? ' active' : ''
              }`}
              href={`#playlist-${playlist.id}`}
              key={playlist.id}
              onClick={(event) => {
                event.preventDefault()
                setSelectedPlaylistId(playlist.id)
                setShowLikedSongs(false)
                setIsAddSongsOpen(false)
              }}
            >
              {playlist.name}
            </a>
          ))}

          <a className="playlist-link" href="#">
            My Favorites
          </a>

          <a className="playlist-link" href="#">
            Study Music
          </a>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar">
          <div className="navigation-buttons">
            <button type="button">‹</button>
            <button type="button">›</button>
          </div>

          <div className="search-container" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div className="search-box">
              <span>⌕</span>

              <input
                type="text"
                placeholder="What do you want to listen to?"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            <button 
              type="button" 
              className={`filter-pill ${activeFilter === 'tamil' ? 'active' : ''}`}
              onClick={() => {
                const newFilter = activeFilter === 'tamil' ? 'all' : 'tamil';
                setActiveFilter(newFilter);
                if (newFilter === 'tamil') setSearch('');
              }}
              style={{
                background: activeFilter === 'tamil' ? '#1db954' : 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: 'pointer',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}
            >
              Tamil Music
            </button>
          </div>

          <div className="profile">
            <div className="profile-avatar">V</div>
            <span>Venkatesh</span>
            <span>⌄</span>
          </div>
        </header>

        <section className="hero">
          <p>Welcome back</p>
          <h1>{search ? 'Search results' : 'Good evening'}</h1>
          <span>
  {search
    ? `Results for "${search}"`
    : "Discover music you'll love."}
</span>
        </section>

        {!selectedPlaylist && !showLikedSongs && recentlyPlayedSongs.length > 0 && (
          <section className="recently-played-section">
            <div className="section-heading">
              <h2>Recently Played</h2>
            </div>
            <div className="recently-played-list">
              {recentlyPlayedSongs.map((song) => (
                <button
                  type="button"
                  className="recently-played-song"
                  key={song.id || song.title}
                  onClick={() => playSong(song)}
                >
                  <span className="recent-song-art">
                    {song.artwork ? (
                      <img src={song.artwork} alt={song.title} className="recent-artwork-img" />
                    ) : (
                      song.emoji || '🎵'
                    )}
                  </span>
                  <span className="recent-song-info">
                    <strong>{song.title}</strong>
                    <span>{song.artist}</span>
                  </span>
                  <span className="recent-song-play">▶</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Playlists */}
        <section>
          <div className="section-heading">
            <h2>Made for you</h2>
            <button
              type="button"
              onClick={() =>
                selectedPlaylist && setIsAddSongsOpen((isOpen) => !isOpen)
              }
            >
              {selectedPlaylist
                ? isAddSongsOpen
                  ? 'Close'
                  : 'Add Songs'
                : 'Show all'}
            </button>
          </div>

          <div className="cards">
            {playlistCards.map((playlist) => (
              <article className="card" key={playlist.title}>
                <div className="card-image">
                  {playlist.emoji}

                  <button
                    type="button"
                    className="play-button"
                    onClick={() => songs[0] && playSong(songs[0])}
                  >
                    ▶
                  </button>
                </div>

                <h3>{playlist.title}</h3>
                <p>{playlist.description}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Songs */}
        <section className="songs-section">
          <div className="section-heading">
            <h2>
              {selectedPlaylist
                ? selectedPlaylist.name
                : showLikedSongs
                  ? 'Liked Songs'
                  : 'Popular songs'}
            </h2>
            <button
              type="button"
              onClick={openSongPicker}
            >
              {selectedPlaylist ? '＋ Add Songs' : 'Show all'}
            </button>
          </div>

          <div className="song-list">
            {loading && (
              <div className="status-container">
                <div className="spinner" />
                <p>Loading songs from Jamendo...</p>
              </div>
            )}

            {!loading && apiError && (
              <div className="status-container error-container">
                <p>⚠️ {apiError}</p>
                <button type="button" className="retry-button" onClick={() => fetchSongs(search)}>
                  Retry
                </button>
              </div>
            )}

            {!loading && !apiError && visibleSongs.map((song, index) => (
              <div
                className="song-row"
                key={song.id || song.title}
                role="row"
                tabIndex={0}
                onDoubleClick={() => playSong(song)}
                onKeyDown={(e) => { if (e.key === 'Enter') playSong(song) }}
              >
                <span className="song-number">{index + 1}</span>

                <div className="song-art">
                  {song.artwork ? (
                    <img src={song.artwork} alt={song.title} className="song-artwork-img" />
                  ) : (
                    song.emoji || '🎵'
                  )}
                </div>

                <div className="song-info">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>

                <span className="song-album">
                  {song.album || 'Jamendo Collection'}
                </span>

                <span className="song-duration">
                  {currentSong?.title === song.title
                    ? formatTime(duration)
                    : formatTime(song.duration)}
                </span>

                <button
                  type="button"
                  className={`like-button${
                    likedSongs.includes(song.title) ? ' liked' : ''
                  }`}
                  aria-label={`${
                    likedSongs.includes(song.title) ? 'Unlike' : 'Like'
                  } ${song.title}`}
                  onClick={(e) => { e.stopPropagation(); toggleLikedSong(song.title) }}
                >
                  {likedSongs.includes(song.title) ? '♥' : '♡'}
                </button>

                <button
                  type="button"
                  className="playlist-add-button"
                  aria-label={
                    !selectedPlaylist
                      ? 'Select a playlist to add songs'
                      : selectedPlaylist.songTitles.includes(song.title)
                        ? 'Open song picker'
                        : `Add ${song.title} to ${selectedPlaylist.name}`
                  }
                  disabled={!selectedPlaylist}
                  onClick={(e) => { e.stopPropagation(); handlePlaylistSongAction(song.title) }}
                  title={
                    !selectedPlaylist
                      ? 'Select a playlist to add songs'
                      : selectedPlaylist.songTitles.includes(song.title)
                        ? 'Open song picker'
                        : `Add to ${selectedPlaylist.name}`
                  }
                >
                  ＋
                </button>

                <button
                  type="button"
                  className="more-button"
                  onClick={(e) => { e.stopPropagation(); playSong(song) }}
                >
                  {currentSong?.title === song.title && isPlaying
                    ? '❚❚'
                    : '▶'}
                </button>
              </div>
            ))}

            {!loading && !apiError && visibleSongs.length === 0 && (
              <div className="status-container empty-container">
                <p>
                  {selectedPlaylist
                    ? 'No songs in this playlist yet.'
                    : showLikedSongs
                      ? 'No liked songs yet.'
                      : search
                        ? `No songs found matching "${search}".`
                        : 'No songs available.'}
                </p>
              </div>
            )}
            
            {/* Infinite Scroll Observer Target */}
            {(!selectedPlaylist && !showLikedSongs && !loading && hasMore) && (
              <div 
                ref={observerTarget} 
                style={{ height: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '20px 0' }}
              >
                {loadingMore ? 'Loading more tracks...' : 'Scroll for more'}
              </div>
            )}
          </div>

        </section>
      </main>

      {/* Player */}
      <footer className="player">
        <div className="now-playing">
          <div className="player-art">
            {currentSong?.artwork ? (
              <img src={currentSong.artwork} alt={currentSong.title} className="player-artwork-img" />
            ) : (
              currentSong?.emoji || '🎵'
            )}
          </div>

          <div>
            <strong>
              {currentSong ? currentSong.title : 'No song selected'}
            </strong>

            <span>
              {currentSong
                ? currentSong.artist
                : 'Choose a song to start listening'}
            </span>
          </div>

          <button
            type="button"
            className={`heart${
              currentSong && likedSongs.includes(currentSong.title)
                ? ' liked'
                : ''
            }`}
            aria-label={
              currentSong && likedSongs.includes(currentSong.title)
                ? 'Unlike current song'
                : 'Like current song'
            }
            disabled={!currentSong}
            onClick={() =>
              currentSong && toggleLikedSong(currentSong.title)
            }
          >
            {currentSong && likedSongs.includes(currentSong.title) ? '♥' : '♡'}
          </button>
        </div>

        <div className="player-controls">
          <div className="controls">
            <button
              type="button"
              className={isShuffleEnabled ? 'active' : ''}
              aria-label="Shuffle"
              aria-pressed={isShuffleEnabled}
              onClick={() => setIsShuffleEnabled((enabled) => !enabled)}
              title="Shuffle"
            >
              ⇄
            </button>
            <button type="button" onClick={playPrevious}>◀</button>

            <button
              type="button"
              className="main-play"
              onClick={togglePlay}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>

            <button type="button" onClick={playNext}>▶</button>
            <button
              type="button"
              className={repeatMode !== 'off' ? 'active' : ''}
              aria-label={`Repeat: ${repeatMode}`}
              aria-pressed={repeatMode !== 'off'}
              onClick={cycleRepeatMode}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === 'song' ? '↻¹' : '↻'}
            </button>
          </div>

          <div className="progress">
            <span>{formatTime(currentTime)}</span>

            <div className="progress-bar">
              <div
                className="progress-value"
                style={{ width: `${progressPercent}%` }}
              />
              <input
                aria-label="Seek"
                className="seek-slider"
                max={duration || 0}
                min="0"
                onChange={handleSeek}
                step="0.5"
                type="range"
                value={currentTime}
              />
            </div>

            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-right">
          <button
            type="button"
            className={`queue-toggle${isQueueOpen ? ' active' : ''}`}
            aria-expanded={isQueueOpen}
            aria-label="Up Next queue"
            onClick={() => setIsQueueOpen((isOpen) => !isOpen)}
            title="Up Next"
          >
            ☷
          </button>
          <span>🔊</span>

          <div className="volume-bar">
            <input
              aria-label="Volume"
              className="volume-slider"
              max="1"
              min="0"
              onChange={handleVolumeChange}
              step="0.01"
              type="range"
              value={volume}
            />
          </div>
        </div>
      </footer>

      {isQueueOpen && (
        <aside className="queue-panel" aria-label="Up Next queue">
          <div className="queue-panel-heading">
            <h2>Up Next</h2>
            <button
              type="button"
              aria-label="Close queue"
              onClick={() => setIsQueueOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="queue-current-song">
            <span>
              {currentSong?.artwork ? (
                <img src={currentSong.artwork} alt={currentSong.title} className="queue-artwork-img" />
              ) : (
                currentSong?.emoji || '🎵'
              )}
            </span>
            <div>
              <strong>{currentSong ? currentSong.title : 'No song selected'}</strong>
              <small>{currentSong ? currentSong.artist : 'Choose a song to start'}</small>
            </div>
          </div>

          <div className="queue-upcoming-list">
            {upcomingSongs.map((song) => (
              <button
                type="button"
                className="queue-song"
                key={song.id || song.title}
                onClick={() => {
                  setIsQueueOpen(false)
                  playSong(song)
                }}
              >
                <span>
                  {song.artwork ? (
                    <img src={song.artwork} alt={song.title} className="queue-artwork-img" />
                  ) : (
                    song.emoji || '🎵'
                  )}
                </span>
                <div>
                  <strong>{song.title}</strong>
                  <small>{song.artist}</small>
                </div>
              </button>
            ))}
            {upcomingSongs.length === 0 && (
              <p className="queue-empty">No upcoming songs.</p>
            )}
          </div>
        </aside>
      )}

      {isPlaylistModalOpen && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="playlist-modal-title"
            aria-modal="true"
            className="playlist-modal"
            role="dialog"
          >
            <form onSubmit={createPlaylist}>
              <h2 id="playlist-modal-title">Create Playlist</h2>
              <label htmlFor="playlist-name">Playlist name</label>
              <input
                autoFocus
                id="playlist-name"
                onChange={(event) => setPlaylistName(event.target.value)}
                placeholder="My Playlist"
                required
                type="text"
                value={playlistName}
              />
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setPlaylistName('')
                    setIsPlaylistModalOpen(false)
                  }}
                >
                  Cancel
                </button>
                <button type="submit">Create</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedPlaylist && isAddSongsOpen && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="song-picker-title"
            aria-modal="true"
            className="playlist-modal song-picker-modal"
            role="dialog"
          >
            <h2 id="song-picker-title">Add songs</h2>
            <div className="song-picker-list">
              {availablePlaylistSongs.map((song) => (
                <button
                  type="button"
                  className="playlist-song-option"
                  key={song.title}
                  onClick={() => addSongToSelectedPlaylist(song.title)}
                >
                  <div className="song-art">{song.emoji}</div>
                  <div className="song-info">
                    <strong>{song.title}</strong>
                    <span>{song.artist}</span>
                  </div>
                  <span className="playlist-add-button">＋</span>
                </button>
              ))}
              {availablePlaylistSongs.length === 0 && (
                <p className="empty-song-list">All songs are in this playlist.</p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setIsAddSongsOpen(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
