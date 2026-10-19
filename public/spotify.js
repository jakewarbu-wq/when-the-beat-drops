// Spotify login (Authorization Code with PKCE) and the few Web API calls the
// app needs. Uses the endpoints that still work for Development Mode apps
// after Spotify's February 2026 changes (/me/playlists, /playlists/{id}/items,
// /me/library/contains, search limit max 10).

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-top-read",
].join(" ");

const store = {
  get(k) {
    try { return JSON.parse(localStorage.getItem("wtbd." + k)); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem("wtbd." + k, JSON.stringify(v)); } catch {}
  },
  del(k) {
    try { localStorage.removeItem("wtbd." + k); } catch {}
  },
};
export { store };

let clientId = "";
export function setClientId(id) { clientId = id; }

export function redirectUri() {
  return location.origin + "/";
}

function randomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function sha256base64url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  store.set("pkce", { verifier, state });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge_method: "S256",
    code_challenge: await sha256base64url(verifier),
  });
  location.assign(`${AUTH_URL}?${params}`);
}

export function logout() {
  store.del("token");
  store.del("me");
}

// Called on page load. Returns true if we just finished a login.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return false;
  history.replaceState(null, "", location.pathname);
  if (error) throw new Error(error === "access_denied" ? "Spotify login was cancelled." : `Spotify login failed (${error}).`);

  const pkce = store.get("pkce");
  store.del("pkce");
  if (!pkce || pkce.state !== params.get("state")) throw new Error("Login didn't complete. Please try again.");

  await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: pkce.verifier,
  });
  return true;
}

async function tokenRequest(fields) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (fields.grant_type === "refresh_token") logout();
    throw new Error(data.error_description || "Couldn't log in to Spotify.");
  }
  const old = store.get("token") || {};
  store.set("token", {
    access: data.access_token,
    refresh: data.refresh_token || old.refresh,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  });
}

export function isLoggedIn() {
  const t = store.get("token");
  return Boolean(t && t.refresh);
}

let refreshing = null;
export async function accessToken() {
  const t = store.get("token");
  if (!t) throw new Error("Please log in with Spotify.");
  if (Date.now() < t.expires) return t.access;
  refreshing ||= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId })
    .finally(() => { refreshing = null; });
  await refreshing;
  return store.get("token").access;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = "GET", body, retries = 3 } = {}) {
  const url = path.startsWith("http") ? path : API + path;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken();
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 15);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      const t = store.get("token");
      if (t) { t.expires = 0; store.set("token", t); }
      continue;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error((data.error && data.error.message) || `Spotify error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}

export async function getMe() {
  const cached = store.get("me");
  if (cached) return cached;
  const me = await api("/me");
  const slim = { id: me.id, name: me.display_name || me.id, image: me.images && me.images[0] && me.images[0].url };
  store.set("me", slim);
  return slim;
}

// All playlists in her library. Spotify only lets Development Mode apps read
// the songs inside playlists she owns or collaborates on, so we flag those.
export async function getPlaylists(meId) {
  const out = [];
  let url = "/me/playlists?limit=50";
  while (url && out.length < 1000) {
    const page = await api(url);
    for (const p of page.items || []) {
      if (!p) continue;
      const count = (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? 0;
      out.push({
        id: p.id,
        name: p.name,
        image: p.images && p.images.length ? p.images[p.images.length - 1].url : "",
        count,
        mine: (p.owner && p.owner.id === meId) || Boolean(p.collaborative),
      });
    }
    url = page.next;
  }
  return out;
}

export function slimTrack(t) {
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artists: (t.artists || []).map((a) => a.name),
    artist: (t.artists || []).map((a) => a.name).join(", "),
    album: t.album && t.album.name,
    year: t.album && t.album.release_date ? t.album.release_date.slice(0, 4) : "",
    image: t.album && t.album.images && t.album.images.length
      ? (t.album.images.find((i) => i.width && i.width <= 300) || t.album.images[t.album.images.length - 1]).url
      : "",
    durationMs: t.duration_ms || 0,
    explicit: Boolean(t.explicit),
    url: (t.external_urls && t.external_urls.spotify) || `https://open.spotify.com/track/${t.id}`,
  };
}

export async function getPlaylistTracks(playlistId, max = 1000) {
  const out = [];
  let url = `/playlists/${playlistId}/items?limit=50`;
  while (url && out.length < max) {
    const page = await api(url);
    for (const row of page.items || []) {
      const t = row && (typeof row.item === "object" && row.item ? row.item : row.track);
      if (!t || typeof t !== "object" || t.type !== "track" || t.is_local || !t.id) continue;
      out.push(slimTrack(t));
    }
    url = page.next;
  }
  return out;
}

export async function searchTracks(q, limit = 5) {
  const params = new URLSearchParams({ q, type: "track", limit: String(Math.min(limit, 10)) });
  const data = await api(`/search?${params}`);
  return ((data && data.tracks && data.tracks.items) || []).filter(Boolean).map(slimTrack);
}

export async function getTopArtists() {
  try {
    const data = await api("/me/top/artists?limit=20&time_range=medium_term");
    return (data.items || []).map((a) => a.name);
  } catch {
    return [];
  }
}

// Returns a Set of track URIs that are in her Liked Songs.
export async function likedSet(uris) {
  const liked = new Set();
  for (let i = 0; i < uris.length; i += 40) {
    const chunk = uris.slice(i, i + 40);
    try {
      const flags = await api(`/me/library/contains?uris=${encodeURIComponent(chunk.join(","))}`);
      (flags || []).forEach((f, j) => f && liked.add(chunk[j]));
    } catch {
      // Not critical; just skip the "liked" badge.
    }
  }
  return liked;
}

export async function createPlaylist(name, description = "") {
  const p = await api("/me/playlists", { method: "POST", body: { name, public: false, description } });
  return { id: p.id, name: p.name, url: p.external_urls && p.external_urls.spotify };
}

export async function addToPlaylist(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlistId}/items`, { method: "POST", body: { uris: uris.slice(i, i + 100) } });
  }
}
