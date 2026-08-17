const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const songs = [
  {
    title: "Seval Kodi",
    artist: "Tamil",
    file: "/music/seval-kodi.mp3",
  },
  {
    title: "Dreaming",
    artist: "Tape Echo",
    file: "/music/tape-echo-dream-dreaming-567732.mp3",
  },
  {
    title: "The Mountain",
    artist: "Midnight Beat",
    file: "/music/the_mountain-midnight-beat-139503.mp3",
  },
  {
    title: "Lost in My Own World",
    artist: "Vishiv",
    file: "/music/vishiv-lost-in-my-own-world-424917.mp3",
  },
];

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "VibeStream backend is running" });
});

app.get("/api/songs", (req, res) => {
  res.json(songs);
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});