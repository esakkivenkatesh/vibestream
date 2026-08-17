import React from 'react'
import { usePlayer } from '../context/PlayerContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'

const RecentlyPlayed = () => {
  const { recentlyPlayedSongs, selectedPlaylist, showLikedSongs } = usePlayer()
  const { playSong } = useAudioPlayer()

  if (selectedPlaylist || showLikedSongs || recentlyPlayedSongs.length === 0) {
    return null
  }

  return (
    <section className="recently-played-section">
      <div className="section-heading">
        <h2>Recently Played</h2>
      </div>
      <div className="recently-played-list">
        {recentlyPlayedSongs.map((song) => (
          <button
            type="button"
            className="recently-played-song"
            key={song.title}
            onClick={() => playSong(song)}
          >
            <span className="recent-song-art">{song.emoji}</span>
            <span className="recent-song-info">
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
            </span>
            <span className="recent-song-play">▶</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default RecentlyPlayed
