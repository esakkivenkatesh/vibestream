import React from 'react'
import { usePlayer } from '../context/PlayerContext'

const Sidebar = () => {
  const {
    showLikedSongs,
    setShowLikedSongs,
    selectedPlaylistId,
    setSelectedPlaylistId,
    setIsAddSongsOpen,
    userPlaylists,
    setIsPlaylistModalOpen,
    selectedPlaylist,
  } = usePlayer()

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-icon">●</span>
        VibeStream
      </div>

      <nav className="nav">
        <a
          className={`nav-item${
            showLikedSongs || selectedPlaylistId ? '' : ' active'
          }`}
          href="#"
          onClick={(e) => {
            e.preventDefault()
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
          className={`playlist-link${showLikedSongs ? ' active' : ''}`}
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
  )
}

export default Sidebar
