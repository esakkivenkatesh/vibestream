import { useEffect } from 'react'
import { usePlayer } from '../context/PlayerContext'
import { songs } from '../data/musicData'

export const useAudioPlayer = () => {
  const {
    audioRef,
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    volume,
    setVolume,
    isShuffleEnabled,
    repeatMode,
    setRepeatMode,
    shuffleQueue,
    setShuffleQueue,
    addRecentlyPlayed,
    createShuffledQueue,
  } = usePlayer()

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume, audioRef])

  const getRandomSong = (songToExclude) => {
    const choices = songs.filter((song) => song.title !== songToExclude?.title)
    return choices[Math.floor(Math.random() * choices.length)] || songs[0]
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

  const playSong = async (song) => {
    await changeSong(song, true, true)
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

  const handleVolumeChange = (event) => {
    const newVolume = Number(event.target.value)
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
  }

  const cycleRepeatMode = () => {
    setRepeatMode((currentMode) =>
      currentMode === 'off' ? 'song' : currentMode === 'song' ? 'all' : 'off',
    )
  }

  const handleSongEnded = async () => {
    await playNext(true)
  }

  const formatTime = (time) => {
    if (!Number.isFinite(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  return {
    playSong,
    togglePlay,
    playNext,
    playPrevious,
    handleVolumeChange,
    cycleRepeatMode,
    handleSongEnded,
    formatTime,
  }
}
