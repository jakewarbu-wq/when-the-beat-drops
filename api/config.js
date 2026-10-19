// Tells the browser which Spotify app to log in with, and which optional
// services are switched on. Contains nothing secret.
import { json } from "./_lib/http.js";

export function GET() {
  return json({
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || "",
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    bpmConfigured: Boolean(process.env.GETSONGBPM_API_KEY),
  });
}
