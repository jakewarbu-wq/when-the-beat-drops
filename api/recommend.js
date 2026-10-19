// Asks Claude for song suggestions. The browser then checks every suggestion
// against Spotify search and drops anything that isn't a real track.
import Anthropic from "@anthropic-ai/sdk";
import { json, handle, httpError, requireSpotifyUser } from "./_lib/http.js";

const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
const EFFORT = process.env.AI_EFFORT || "low";
const SECTIONS = ["Warm-up", "Flat road", "Climb", "Sprint", "Recovery", "Cool-down"];

const SYSTEM = `You are the music brain of "When the Beat Drops", an app a spin (indoor cycling) instructor uses to find music for her classes.

How spin music works:
- Riders pedal to the beat. Flat road and sprints usually sit around 120-140 BPM (sprints often 130-150+ or double-time feel). Climbs ride at a slower cadence, typically 60-80 RPM, so songs around 120-160 BPM ridden on the half-time beat, or genuinely slow heavy tracks around 60-80 BPM, work well. Warm-up and cool-down are lower energy and gentler.
- Class-use tags: Warm-up, Flat road, Climb, Sprint, Recovery, Cool-down. A song can have more than one.
- Energy is your 1-10 estimate of intensity (1 = calm, 10 = all-out).

Rules:
- Only suggest real, released recordings that are on Spotify. Use the exact official song title and primary artist name as Spotify lists them. Never invent songs. If unsure a song exists, leave it out.
- Prefer the original studio version. Only name a remix if the remix is the point (give its official title, e.g. "Titanium (David Guetta Remix)").
- Never suggest any song in the "already has" or "don't suggest" lists.
- Each reason is one short line (under 90 characters) a busy instructor can scan, e.g. "high-energy house, similar to Calvin Harris, good for sprints".
- approx_bpm is your best estimate of the song's tempo in BPM (the app labels it "approx." unless a BPM database confirms it).
- Respect any filters given (BPM range, maximum length, clean only) as closely as you can.
- Vary artists: no more than two songs by the same artist unless asked.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "style", "is_class_plan", "target_minutes", "sections", "songs"],
  properties: {
    summary: { type: "string", description: "One or two sentences: what you understood and what you picked." },
    style: {
      type: "object",
      additionalProperties: false,
      required: ["genres", "eras", "energy", "tempo_range", "artists"],
      properties: {
        genres: { type: "array", items: { type: "string" } },
        eras: { type: "array", items: { type: "string" } },
        energy: { type: "string" },
        tempo_range: { type: "string" },
        artists: { type: "array", items: { type: "string" } },
      },
    },
    is_class_plan: { type: "boolean", description: "True when the request is for a whole class / ordered setlist." },
    target_minutes: { type: "integer", description: "Requested class length in minutes, or 0 if not a class plan." },
    sections: {
      type: "array",
      description: "For class plans: the ordered section names, e.g. Warm-up, Climb 1, Climb 2, Climb 3, Sprint finish, Cool-down. Empty otherwise.",
      items: { type: "string" },
    },
    songs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "artist", "reason", "tags", "energy", "approx_bpm", "section", "is_backup"],
        properties: {
          title: { type: "string" },
          artist: { type: "string" },
          reason: { type: "string" },
          tags: { type: "array", items: { type: "string", enum: SECTIONS } },
          energy: { type: "integer", description: "1-10" },
          approx_bpm: { type: "integer" },
          section: { type: "string", description: "For class plans, one of the names in sections. Empty string otherwise." },
          is_backup: { type: "boolean", description: "For class plans, true for the one spare song per section used if another can't be found. False otherwise." },
        },
      },
    },
  },
};

export function POST(request) {
  return handle(async () => {
    await requireSpotifyUser(request);
    if (!process.env.ANTHROPIC_API_KEY) throw httpError(500, "The AI key isn't set up yet (ANTHROPIC_API_KEY).");
    const body = await request.json().catch(() => ({}));
    const prompt = buildPrompt(body);

    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") throw httpError(422, "The AI couldn't help with that request. Try wording it differently.");
    if (response.stop_reason === "max_tokens") throw httpError(502, "The AI ran out of room. Try asking for a shorter list.");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw httpError(502, "The AI sent back something unreadable. Please try again.");
    }
    return json(result);
  });
}

function clip(s, n) {
  return String(s || "").slice(0, n);
}

function buildPrompt(body) {
  const mode = body.mode === "playlist" ? "playlist" : "request";
  const tracks = (Array.isArray(body.tracks) ? body.tracks : []).slice(0, 300);
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).slice(0, 300);
  const topArtists = (Array.isArray(body.topArtists) ? body.topArtists : []).slice(0, 20);
  const f = body.filters || {};
  const parts = [];

  if (mode === "playlist") {
    const names = (body.playlistNames || []).map((n) => clip(n, 100)).join(", ");
    parts.push(
      `She picked these playlists: ${names}.`,
      `Work out their style (genres, artists, era, energy, tempo range) and suggest 22 similar songs she doesn't already have. Tag each with the class uses it suits. This is not a class plan, so leave sections empty.`,
      `Songs in the playlists ("already has"):\n${tracks.map((t) => `- ${clip(t.title, 120)} — ${clip(t.artist, 80)}${t.year ? ` (${t.year})` : ""}`).join("\n")}`
    );
  } else {
    const req = clip(body.request, 1000).trim();
    if (!req) throw httpError(400, "Type what you're looking for first.");
    parts.push(
      `Her request: "${req}"`,
      `If she's asking for a whole class (it mentions a class length, or several sections like warm-up, climbs, sprints, cool-down), make it a class plan: list the sections in order, choose songs for each section in riding order so the total running time is close to the requested length, and add exactly one extra song per section with is_backup true. Otherwise suggest 22 songs that fit, with no sections.`
    );
    if (topArtists.length) parts.push(`For taste context only, artists she listens to a lot: ${topArtists.map((a) => clip(a, 80)).join(", ")}.`);
  }

  const filterBits = [];
  if (f.bpmMin) filterBits.push(`BPM at least ${Number(f.bpmMin)}`);
  if (f.bpmMax) filterBits.push(`BPM at most ${Number(f.bpmMax)}`);
  if (f.maxMinutes) filterBits.push(`songs no longer than ${Number(f.maxMinutes)} minutes`);
  if (f.minMinutes) filterBits.push(`songs at least ${Number(f.minMinutes)} minutes`);
  if (f.cleanOnly) filterBits.push(`clean (non-explicit) songs only`);
  if (filterBits.length) parts.push(`Filters: ${filterBits.join("; ")}.`);

  if (exclude.length) parts.push(`Don't suggest (she dismissed these):\n${exclude.map((e) => `- ${clip(e, 200)}`).join("\n")}`);
  return parts.join("\n\n");
}
