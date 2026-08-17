import React from 'react'
import { usePlayer } from '../context/PlayerContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'

const Player = () => {
  const {
    currentSong,
    likedSongs,
    toggleLikedSong,
    isShuffleEnabled,
    setIsShuffleEnabled,
    isPlaying,
    repeatMode,
    currentTime,
    duration,
    volume,
    isQueueOpen,
    setIsQueueOpen,
  } = usePlayer()

  const {
    togglePlay,
    playNext,
    playPrevious,
    handleVolumeChange,
    cycleRepeatMode,
    formatTime,
  } = useAudioPlayer()

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <footer className="player">
      <div className="now-playing">
        <div className="player-art">{currentSong ? currentSong.emoji : '🎵'}</div>

        <div>
          <strong>{currentSong ? currentSong.title : 'No song selected'}</strong>
          <span>
            {currentSong ? currentSong.artist : 'Choose a song to start listening'}
          </span>
        </div>

        <button
          type="button"
          className={`heart${
            currentSong && likedSongs.includes(currentSong.title) ? ' liked' : ''
          }`}
          aria-label={
            currentSong && likedSongs.includes(currentSong.title)
              ? 'Unlike current song'
              : 'Like current song'
          }
          disabled={!currentSong}
          onClick={() => currentSong && toggleLikedSong(currentSong.title)}
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
          <button type="button" onClick={playPrevious}>
            ◀
          </button>

          <button type="button" className="main-play" onClick={togglePlay}>
            {isPlaying ? '❚❚' : '▶'}
          </button>

          <button type="button" onClick={playNext}>
            ▶
          </button>
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
  )
}

export default Player
