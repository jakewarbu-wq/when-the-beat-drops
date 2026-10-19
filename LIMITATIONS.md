# What couldn't be built exactly as described, and why

1. **Hosted on Vercel, not Netlify.** The AI takes 20 to 60 seconds to pick a full list. Netlify's free plan cuts serverless functions off after 10 seconds, so searches would fail. Vercel's free plan allows up to 5 minutes. Vercel's free Hobby plan is meant for personal, non-commercial use; if they ever consider her class prep commercial, their Pro plan ($20/month) removes that question.

2. **Only her own playlists can be used for "From my playlists".** Since Spotify's February 2026 changes, personal (Development Mode) apps can only read the songs in playlists the user created or collaborates on. Playlists she just follows, including Spotify's own editorial ones, are listed as hidden with a tip: copy the playlist into one of her own and it works.

3. **"Play a preview" opens the song in Spotify.** Spotify removed 30-second preview clips for new apps, so the ▶ button opens the track in the Spotify app (or web player on a laptop). This matches the brief.

4. **Energy is always an AI estimate.** Spotify removed its energy data and GetSongBPM doesn't provide an equivalent, so the 1 to 10 energy bar is Claude's judgement.

5. **BPM isn't always the real figure.** GetSongBPM doesn't have every song. When it can't find one, the app shows the AI's estimate with an "approx." label, as the brief asked. The BPM filter uses the estimate in that case.

6. **Lists can come back shorter than 20.** The AI is asked for 22 songs, and any that can't be matched to a real Spotify track are dropped, so a list usually lands between 10 and 20. For class setlists, the AI also picks one backup song per section that fills any gap. The running time shown is the real total from Spotify, so it can be a few minutes off the requested length if songs were dropped.

7. **"Songs she doesn't already have" checks the playlists she picked.** Suggestions already in those playlists are removed. Songs in her Liked Songs get a "♥ Liked" badge instead of being hidden. Checking every one of her playlists would mean reading her whole library on each search, which would make it slow.

8. **Dismissed songs are remembered per device.** The list lives in the browser, so dismissing a song on her phone doesn't hide it on the laptop. Keeping it in sync would need a database and adds setup; it can be added later if it matters.

9. **Not yet tested against the live services.** The whole app was tested end to end on a simulated phone against simulated Spotify, Claude and GetSongBPM services: login, playlist reading, suggestions, dropping songs that don't exist, BPM lookup, filters, dismiss and undo, saving to new and existing playlists, and class setlists with running time. Real keys weren't available here, so the first real login is the first live test. GetSongBPM's documentation doesn't show a full response for title-plus-artist searches, so that part was built from their partial example. If every BPM shows "approx." even with the key set, that's the first place to look.
