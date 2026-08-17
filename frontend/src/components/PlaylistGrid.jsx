import React from 'react'
import { usePlayer } from '../context/PlayerContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { playlistCards, songs } from '../data/musicData'

const PlaylistGrid = () => {
  const { selectedPlaylist, setIsAddSongsOpen, isAddSongsOpen } = usePlayer()
  const { playSong } = useAudioPlayer()

  return (
    <section>
      <div className="section-heading">
        <h2>Made for you</h2>
        <button
          type="button"
          onClick={() => selectedPlaylist && setIsAddSongsOpen((isOpen) => !isOpen)}
        >
          {selectedPlaylist ? (isAddSongsOpen ? 'Close' : 'Add Songs') : 'Show all'}
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
                onClick={() => playSong(songs[0])}
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
  )
}

export default PlaylistGrid
