import React from 'react'
import { usePlayer } from '../context/PlayerContext'

const Topbar = () => {
  const { search, setSearch } = usePlayer()

  return (
    <header className="topbar">
      <div className="navigation-buttons">
        <button type="button">‹</button>
        <button type="button">›</button>
      </div>

      <div className="search-box">
        <span>⌕</span>
        <input
          type="text"
          placeholder="What do you want to listen to?"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="profile">
        <div className="profile-avatar">V</div>
        <span>Venkatesh</span>
        <span>⌄</span>
      </div>
    </header>
  )
}

export default Topbar
