# When the Beat Drops

A phone-first web app for a spin instructor to find and organise class music. It logs in to Spotify, suggests songs from her playlists or from a plain-English request (including full class setlists), remixes past class playlists song by song, and saves the results to playlists.

- **Setup (non-technical):** [SETUP.md](SETUP.md)
- **What couldn't be built as described:** [LIMITATIONS.md](LIMITATIONS.md)

## How it works

```
Phone/laptop browser ──(Spotify login, PKCE)──> Spotify Web API
       │                                         (playlists, search, save)
       └──> /api/recommend ──> Claude API     (song ideas as JSON)
       └──> /api/bpm       ──> GetSongBPM API (real BPM)
```

1. The browser logs in to Spotify directly (Authorization Code with PKCE; no client secret).
2. For a search it sends her playlist contents or request to `/api/recommend`, which asks Claude for songs with reasons, class tags, energy and an estimated BPM.
3. The browser checks every suggestion with Spotify search and drops anything that doesn't resolve to a real track, plus songs already in the chosen playlists or dismissed earlier.
4. `/api/bpm` looks up real BPMs on GetSongBPM; misses show the AI estimate labelled "approx."

The AI and BPM keys live only in the serverless functions. Each function call must carry a valid Spotify token, and `ALLOWED_SPOTIFY_USER_IDS` limits use to her account.

Built for Spotify's post-February-2026 Development Mode API: `/me/playlists`, `/playlists/{id}/items`, `/me/library/contains`, `POST /me/playlists`, search limit 10. No `/recommendations`, `/audio-features`, `/audio-analysis`, related artists or preview URLs.

## Files

| Path | What it is |
|---|---|
| `public/index.html`, `styles.css` | The page and its look |
| `public/app.js` | Screens, search flow, Spotify matching, filters, actions |
| `public/spotify.js` | Spotify login and API calls |
| `api/recommend.js` | Calls Claude (model `claude-opus-5-5`, structured JSON output) |
| `api/bpm.js` | Calls GetSongBPM |
| `api/config.js` | Tells the browser the Spotify Client ID |
| `api/_lib/http.js` | Shared helpers, Spotify-token check |
| `vercel.json` | Gives the AI function up to 5 minutes |
| `dev-server.mjs` | Runs everything locally |

## Running it locally

Needs Node.js 20 or newer.

```
npm install
cp .env.example .env    # then fill in the keys
npm run dev             # http://127.0.0.1:3000
```

Add `http://127.0.0.1:3000/` as an extra Redirect URI in the Spotify app settings.
