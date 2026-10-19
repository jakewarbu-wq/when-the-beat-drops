// Looks up real BPMs from GetSongBPM (https://getsongbpm.com) for a batch of
// songs. Songs it can't find come back as null and the app shows the AI's
// estimate labelled "approx." instead.
import { json, handle, httpError, normalize, requireSpotifyUser } from "./_lib/http.js";

const BPM_API = process.env.GETSONGBPM_API_BASE || "https://api.getsong.co";
const MAX_SONGS = 40;
const CONCURRENCY = 5;

export function POST(request) {
  return handle(async () => {
    await requireSpotifyUser(request);
    const apiKey = process.env.GETSONGBPM_API_KEY;
    const body = await request.json().catch(() => ({}));
    const songs = Array.isArray(body.songs) ? body.songs.slice(0, MAX_SONGS) : [];
    if (!songs.length) throw httpError(400, "No songs to look up.");
    if (!apiKey) return json({ configured: false, results: {} });

    const results = {};
    let next = 0;
    async function worker() {
      while (next < songs.length) {
        const song = songs[next++];
        if (!song || !song.key) continue;
        results[song.key] = await lookup(apiKey, String(song.title || ""), String(song.artist || ""));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return json({ configured: true, results });
  });
}

async function lookup(apiKey, title, artist) {
  const url = new URL("/search/", BPM_API);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("type", "both");
  url.searchParams.set("lookup", `song:${title} artist:${artist}`);
  url.searchParams.set("limit", "5");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data.search) ? data.search : [];
    const wantTitle = normalize(title);
    const wantArtist = normalize(artist);
    const match = list.find((s) => {
      const t = normalize(s.title);
      const a = normalize(s.artist && s.artist.name);
      const titleOk = t === wantTitle || t.startsWith(wantTitle) || wantTitle.startsWith(t);
      const artistOk = a && (a.includes(wantArtist) || wantArtist.includes(a));
      return titleOk && artistOk;
    });
    const tempo = match ? parseInt(match.tempo, 10) : NaN;
    return Number.isFinite(tempo) && tempo > 0 ? tempo : null;
  } catch {
    return null;
  }
}
