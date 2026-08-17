import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react'
import {
  songs,
  PLAYLIST_STORAGE_KEY,
  RECENTLY_PLAYED_STORAGE_KEY,
  PLAYBACK_SETTINGS_STORAGE_KEY,
} from '../data/musicData'

const PlayerContext = createContext()

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

const createShuffledQueue = (currentSong) => {
  const queue = songs.filter((song) => song.title !== currentSong?.title)
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[queue[index], queue[randomIndex]] = [queue[randomIndex], queue[index]]
  }
  return queue
}

export const PlayerProvider = ({ children }) => {
  const audioRef = useRef(null)

  // Search & Navigation State
  const [search, setSearch] = useState('')
  const [showLikedSongs, setShowLikedSongs] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null)

  // Playback State
  const [currentSong, setCurrentSong] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.65)
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(
    () => getStoredPlaybackSettings().isShuffleEnabled,
  )
  const [repeatMode, setRepeatMode] = useState(
    () => getStoredPlaybackSettings().repeatMode,
  )
  const [shuffleQueue, setShuffleQueue] = useState([])
  const [isQueueOpen, setIsQueueOpen] = useState(false)

  // Library State
  const [likedSongs, setLikedSongs] = useState([])
  const [userPlaylists, setUserPlaylists] = useState(getStoredPlaylists)
  const [recentlyPlayed, setRecentlyPlayed] = useState(getStoredRecentlyPlayed)

  // Persistence
  useEffect(() => {
    window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(userPlaylists))
  }, [userPlaylists])

  useEffect(() => {
    window.localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify(recentlyPlayed))
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

  // Derived State
  const filteredSongs = useMemo(() => {
    return songs.filter((song) =>
      `${song.title} ${song.artist}`.toLowerCase().includes(search.toLowerCase()),
    )
  }, [search])

  const selectedPlaylist = useMemo(() => {
    return userPlaylists.find((playlist) => playlist.id === selectedPlaylistId)
  }, [userPlaylists, selectedPlaylistId])

  const visibleSongs = useMemo(() => {
    if (selectedPlaylist) {
      return filteredSongs.filter((song) => selectedPlaylist.songTitles.includes(song.title))
    }
    if (showLikedSongs) {
      return filteredSongs.filter((song) => likedSongs.includes(song.title))
    }
    return filteredSongs
  }, [filteredSongs, selectedPlaylist, showLikedSongs, likedSongs])

  const upcomingSongs = useMemo(() => {
    if (!currentSong) return isShuffleEnabled ? shuffleQueue : songs
    if (repeatMode === 'song') return [currentSong]
    if (isShuffleEnabled) return shuffleQueue

    const currentIndex = songs.findIndex((song) => song.title === currentSong.title)
    const songsAfterCurrent = songs.slice(currentIndex + 1)

    return repeatMode === 'all'
      ? [...songsAfterCurrent, ...songs.slice(0, currentIndex)]
      : songsAfterCurrent
  }, [currentSong, isShuffleEnabled, shuffleQueue, repeatMode])

  const recentlyPlayedSongs = useMemo(() => {
    return recentlyPlayed
      .map((title) => songs.find((song) => song.title === title))
      .filter(Boolean)
  }, [recentlyPlayed])

  // Actions
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

  const [isAddSongsOpen, setIsAddSongsOpen] = useState(false)
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false)

  const value = {
    audioRef,
    search,
    setSearch,
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    volume,
    setVolume,
    likedSongs,
    setLikedSongs,
    showLikedSongs,
    setShowLikedSongs,
    userPlaylists,
    setUserPlaylists,
    selectedPlaylistId,
    setSelectedPlaylistId,
    recentlyPlayed,
    isShuffleEnabled,
    setIsShuffleEnabled,
    repeatMode,
    setRepeatMode,
    shuffleQueue,
    setShuffleQueue,
    isQueueOpen,
    setIsQueueOpen,
    isAddSongsOpen,
    setIsAddSongsOpen,
    isPlaylistModalOpen,
    setIsPlaylistModalOpen,
    filteredSongs,
    selectedPlaylist,
    visibleSongs,
    upcomingSongs,
    recentlyPlayedSongs,
    addRecentlyPlayed,
    toggleLikedSong,
    createShuffledQueue,
  }

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export const usePlayer = () => {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider')
  }
  return context
}
