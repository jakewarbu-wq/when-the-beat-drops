// Shared helpers for the serverless functions.
// Every AI/BPM call must come from a logged-in, allowed Spotify user, so a
// stranger who finds the site URL can't spend your API credit.

const SPOTIFY_API = process.env.SPOTIFY_API_BASE || "https://api.spotify.com/v1";

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(message, status = 500) {
  return json({ error: message }, status);
}

// Small in-memory cache so we don't hit Spotify's /me on every call.
const tokenCache = new Map();

export async function requireSpotifyUser(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw httpError(401, "Please log in with Spotify again.");

  const cached = tokenCache.get(token);
  let userId = cached && cached.expires > Date.now() ? cached.userId : null;

  if (!userId) {
    const res = await fetch(`${SPOTIFY_API}/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw httpError(401, "Your Spotify login has expired. Please log in again.");
    const me = await res.json();
    userId = me.id;
    tokenCache.set(token, { userId, expires: Date.now() + 10 * 60 * 1000 });
    if (tokenCache.size > 50) tokenCache.delete(tokenCache.keys().next().value);
  }

  const allowed = (process.env.ALLOWED_SPOTIFY_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(userId)) {
    throw httpError(403, "This Spotify account isn't allowed to use this app.");
  }
  return userId;
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function handle(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    return errorResponse(err.status ? err.message : "Something went wrong. Please try again.", err.status || 500);
  }
}

// Lowercase, strip accents, "(feat. x)", "- Remastered 2011" and punctuation,
// so "Don't Stop Me Now - Remastered" matches "dont stop me now".
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
