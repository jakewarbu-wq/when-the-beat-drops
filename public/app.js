import * as sp from "./spotify.js";

const { store } = sp;
const CLASS_TAGS = ["Warm-up", "Flat road", "Climb", "Sprint", "Recovery", "Cool-down"];
const EXAMPLES = [
  "90s dance anthems for a hill climb",
  "Something like Calvin Harris but less mainstream",
  "A 45-min class: warm-up, 3 climbs, sprint finish, cool-down",
  "Clean pop remixes around 128 BPM for flat road",
];
const MAX_RESULTS = 20;

const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet-root");
const $toast = document.getElementById("toast");

const state = {
  config: null,
  me: null,
  playlists: [],
  playlistsLoaded: false,
  selected: new Set(store.get("selected") || []),
  tab: store.get("tab") || "playlists",
  plFilter: "",
  askText: store.get("askText") || "",
  results: store.get("results"),
  filters: { bpmMin: "", bpmMax: "", minMinutes: "", maxMinutes: "", cleanOnly: false, ...(store.get("filters") || {}) },
  showFilters: false,
  view: store.get("results") ? "results" : "pick",
  dismissed: store.get("dismissed") || [],
  topArtists: null,
  busy: null,
  error: "",
};

// ---------- utilities ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function normalize(s) {
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
const songKey = (title, artist) => `${normalize(title)}|${normalize(String(artist).split(/,|&| x | feat\.? | ft\.? | and /i)[0])}`;

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtLong(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

function saveResults() { store.set("results", state.results); }
function saveFilters() { store.set("filters", state.filters); }

let toastTimer;
function toast(msg, undo) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
  if (undo) $toast.querySelector("button").onclick = () => { undo(); $toast.classList.remove("show"); };
  $toast.classList.add("show");
  toastTimer = setTimeout(() => $toast.classList.remove("show"), undo ? 5000 : 3000);
}

async function backend(path, body) {
  const token = await sp.accessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.error || `Server error ${res.status}`;
    if (res.status === 403 && state.me) msg += ` (Spotify ID: ${state.me.id})`;
    throw new Error(msg);
  }
  return data;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n], n);
    }
  }));
  return out;
}

// ---------- Spotify verification ----------

const JUNK = /karaoke|tribute|made famous|in the style of|cover version|originally performed|instrumental version|8-bit|lullaby/i;

function pickMatch(cands, title, artist) {
  const wantT = normalize(title);
  const wantA = normalize(String(artist).split(/,|&| x | feat\.? | ft\.? /i)[0]);
  if (!wantT || !wantA) return null;
  let best = null;
  let bestScore = 0;
  for (const c of cands) {
    if (JUNK.test(c.title) || JUNK.test(c.album || "")) continue;
    const t = normalize(c.title);
    const exact = t === wantT;
    const loose = !exact && t.length >= 4 && wantT.length >= 4 && (t.startsWith(wantT) || wantT.startsWith(t));
    if (!exact && !loose) continue;
    const artistOk = c.artists.some((a) => {
      const n = normalize(a);
      return n && (n === wantA || n.includes(wantA) || wantA.includes(n));
    });
    if (!artistOk) continue;
    // Prefer exact title, then a plain version over live/remaster variants.
    const score = (exact ? 10 : 5) + (/live|remaster|edit|version/i.test(c.title) && !/live|remaster|edit|version/i.test(title) ? 0 : 2);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

async function verify(title, artist) {
  const primary = String(artist).split(/,|&| feat\.? | ft\.? /i)[0].trim();
  const cleanTitle = title.replace(/"/g, "");
  try {
    let cands = await sp.searchTracks(`track:"${cleanTitle}" artist:"${primary.replace(/"/g, "")}"`, 10);
    let m = pickMatch(cands, title, artist);
    if (m) return m;
    cands = await sp.searchTracks(`${cleanTitle} ${primary}`, 10);
    return pickMatch(cands, title, artist);
  } catch (err) {
    if (err.status === 401) throw err;
    return null;
  }
}

// ---------- the main flow ----------

const STEPS = {
  playlist: ["Reading your playlists", "Asking the AI for ideas", "Checking every song on Spotify", "Looking up BPM"],
  request: ["Asking the AI for ideas", "Checking every song on Spotify", "Looking up BPM"],
};

function setStep(i) {
  state.busy.step = i;
  render();
}

async function findSongs(mode) {
  if (state.busy) return;
  state.error = "";
  state.busy = { mode, step: 0 };
  render();
  window.scrollTo({ top: 0 });

  try {
    const dismissed = new Set(state.dismissed.flatMap((d) => [d.id, d.key]));
    const have = new Set();
    const payload = { mode, filters: activeFilters(), exclude: state.dismissed.slice(-150).map((d) => d.label) };
    let label = "";

    if (mode === "playlist") {
      const chosen = state.playlists.filter((p) => state.selected.has(p.id));
      if (!chosen.length) throw new Error("Pick at least one playlist first.");
      const lists = await pool(chosen, 3, (p) => sp.getPlaylistTracks(p.id));
      const all = lists.flat();
      if (!all.length) throw new Error("Those playlists look empty (or Spotify won't share their songs). Try another one.");
      all.forEach((t) => { have.add(t.id); have.add(songKey(t.title, t.artist)); });
      // Send an even sample so long playlists still fit.
      const step = Math.max(1, all.length / 250);
      const sample = [];
      for (let i = 0; i < all.length && sample.length < 250; i += step) sample.push(all[Math.floor(i)]);
      payload.tracks = sample.map((t) => ({ title: t.title, artist: t.artist, year: t.year }));
      payload.playlistNames = chosen.map((p) => p.name);
      label = chosen.map((p) => p.name).join(" + ");
      setStep(1);
    } else {
      const text = state.askText.trim();
      if (!text) throw new Error("Type what you're looking for first.");
      payload.request = text;
      if (state.topArtists === null) state.topArtists = await sp.getTopArtists();
      payload.topArtists = state.topArtists;
      label = text;
    }

    const ai = await backend("/api/recommend", payload);
    setStep(state.busy.step + 1);

    const seen = new Set();
    const raw = (ai.songs || []).filter((s) => s && s.title && s.artist);
    const checked = await pool(raw, 4, async (s) => {
      const track = await verify(s.title, s.artist);
      return track ? { s, track } : null;
    });
    let songs = [];
    for (const hit of checked) {
      if (!hit) continue;
      const { s, track } = hit;
      const key = songKey(track.title, track.artist);
      if (seen.has(track.id) || seen.has(key)) continue;
      if (have.has(track.id) || have.has(key)) continue;
      if (dismissed.has(track.id) || dismissed.has(key)) continue;
      seen.add(track.id); seen.add(key);
      songs.push({
        key,
        reason: s.reason,
        tags: (s.tags || []).filter((t) => CLASS_TAGS.includes(t)),
        energy: Math.max(1, Math.min(10, Number(s.energy) || 5)),
        approxBpm: Number(s.approx_bpm) || null,
        bpm: null,
        section: s.section || "",
        isBackup: Boolean(s.is_backup),
        track,
      });
    }

    const isClass = Boolean(ai.is_class_plan && (ai.sections || []).length);
    let sections = [];
    if (isClass) {
      sections = arrangeClass(ai.sections, songs, raw);
      songs = sections.flatMap((sec) => sec.songs);
    } else {
      songs = songs.filter((s) => !s.isBackup).slice(0, MAX_RESULTS);
    }

    if (!songs.length) throw new Error("None of the AI's suggestions could be found on Spotify. Try rewording your request.");

    setStep(state.busy.step + 1);
    await addBpm(songs);
    const liked = await sp.likedSet(songs.map((s) => s.track.uri));
    songs.forEach((s) => { s.liked = liked.has(s.track.uri); });

    state.results = {
      mode,
      label,
      createdAt: Date.now(),
      summary: ai.summary || "",
      style: ai.style || null,
      isClass,
      targetMinutes: ai.target_minutes || 0,
      dropped: raw.length - checked.filter(Boolean).length,
      sections: isClass ? sections.map((sec) => ({ name: sec.name, keys: sec.songs.map((s) => s.key), spare: sec.spare })) : [],
      songs,
    };
    saveResults();
    state.view = "results";
  } catch (err) {
    console.error(err);
    state.error = err.message || "Something went wrong.";
    if (!sp.isLoggedIn()) state.me = null;
  } finally {
    state.busy = null;
    render();
    window.scrollTo({ top: 0 });
  }
}

// Keep each section's main songs in order. If one couldn't be found on
// Spotify, its section's backup takes its place; unused backups become spares.
function arrangeClass(sectionNames, songs, raw) {
  const wanted = {};
  raw.forEach((s) => { if (!s.is_backup) wanted[s.section] = (wanted[s.section] || 0) + 1; });
  const out = sectionNames.map((name) => {
    const inSec = songs.filter((s) => s.section === name);
    const main = inSec.filter((s) => !s.isBackup);
    const backups = inSec.filter((s) => s.isBackup);
    while (main.length < (wanted[name] || 0) && backups.length) main.push(backups.shift());
    return { name, songs: main, leftover: backups };
  });
  const orphans = songs.filter((s) => !sectionNames.includes(s.section));
  if (orphans.length) out.push({ name: "Extras", songs: orphans.filter((s) => !s.isBackup), leftover: orphans.filter((s) => s.isBackup) });
  const spares = out.flatMap((s) => s.leftover);
  const result = out.filter((s) => s.songs.length).map(({ name, songs }) => ({ name, songs, spare: false }));
  if (spares.length) result.push({ name: "Spares", songs: spares, spare: true });
  return result;
}

async function addBpm(songs) {
  const cache = store.get("bpmCache") || {};
  const missing = songs.filter((s) => !(s.track.id in cache));
  if (missing.length && state.config.bpmConfigured) {
    for (let i = 0; i < missing.length; i += 40) {
      const chunk = missing.slice(i, i + 40);
      try {
        const res = await backend("/api/bpm", {
          songs: chunk.map((s) => ({
            key: s.track.id,
            // "Titanium (feat. Sia)" / "Strobe - Radio Edit" -> "Titanium" / "Strobe"
            title: s.track.title.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, "").trim() || s.track.title,
            artist: s.track.artists[0],
          })),
        });
        for (const s of chunk) cache[s.track.id] = res.results ? res.results[s.track.id] ?? null : null;
      } catch (err) {
        console.warn("BPM lookup failed", err);
      }
    }
    // Keep the cache from growing forever.
    const ids = Object.keys(cache);
    if (ids.length > 2000) ids.slice(0, ids.length - 2000).forEach((id) => delete cache[id]);
    store.set("bpmCache", cache);
  }
  songs.forEach((s) => { s.bpm = cache[s.track.id] ?? null; });
}

// ---------- filters ----------

function activeFilters() {
  const f = state.filters;
  const out = {};
  if (Number(f.bpmMin)) out.bpmMin = Number(f.bpmMin);
  if (Number(f.bpmMax)) out.bpmMax = Number(f.bpmMax);
  if (Number(f.minMinutes)) out.minMinutes = Number(f.minMinutes);
  if (Number(f.maxMinutes)) out.maxMinutes = Number(f.maxMinutes);
  if (f.cleanOnly) out.cleanOnly = true;
  return out;
}

function passes(song) {
  const f = activeFilters();
  const bpm = song.bpm || song.approxBpm;
  if (f.bpmMin && bpm && bpm < f.bpmMin) return false;
  if (f.bpmMax && bpm && bpm > f.bpmMax) return false;
  const min = song.track.durationMs / 60000;
  if (f.minMinutes && min < f.minMinutes) return false;
  if (f.maxMinutes && min > f.maxMinutes) return false;
  if (f.cleanOnly && song.track.explicit) return false;
  return true;
}

// ---------- rendering ----------

function render() {
  if (!state.config) return;
  if (!state.config.spotifyClientId) return renderSetupNeeded();
  if (!state.me) return renderLogin();
  $app.innerHTML = `
    ${header()}
    ${state.busy ? loadingView() : state.view === "results" && state.results ? `
      ${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}
      ${resultsView()}
      ${credit()}
    ` : `
      <div class="tabs" role="tablist">
        <button role="tab" data-action="tab" data-tab="playlists" aria-selected="${state.tab === "playlists"}">From my playlists</button>
        <button role="tab" data-action="tab" data-tab="ask" aria-selected="${state.tab === "ask"}">Ask for songs</button>
      </div>
      ${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}
      ${state.results ? `<button class="btn small ghost" style="margin-bottom:6px" data-action="show-results">See your last results →</button>` : ""}
      ${state.tab === "playlists" ? playlistView() : askView()}
      <div style="margin-top:22px">${filtersView()}</div>
      ${credit()}
    `}
  `;
  renderDock();
}

// The GetSongBPM credit is a static footer in index.html: their backlink
// checker reads the raw HTML and can't see anything drawn by this script.
function credit() {
  return "";
}

function header() {
  const me = state.me;
  const initial = esc((me.name || "?").trim().charAt(0).toUpperCase());
  return `<header class="top">
    <h1 class="brand">When the <span>Beat Drops</span></h1>
    <button class="avatar" data-action="account" aria-label="Account and settings"
      ${me.image ? `style="background-image:url('${esc(me.image)}')"` : ""}>${me.image ? "" : initial}</button>
  </header>`;
}

function renderLogin() {
  $app.innerHTML = `
    <section class="login">
      <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <h1 class="brand">When the<br><span>Beat Drops</span></h1>
      <p class="tagline">Find the perfect tracks for every climb, sprint and cool-down.</p>
      ${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}
      <button class="btn primary big" data-action="login">Log in with Spotify</button>
    </section>`;
  $sheet.innerHTML = "";
  renderDock();
}

function renderSetupNeeded() {
  $app.innerHTML = `
    <section class="login">
      <h1 class="brand">When the<br><span>Beat Drops</span></h1>
      <div class="notice"><strong>Almost there.</strong> The Spotify Client ID hasn't been added yet.
      Add <code>SPOTIFY_CLIENT_ID</code> in your Vercel project's Environment Variables, then redeploy (see SETUP.md, step 5).</div>
    </section>`;
}

function playlistView() {
  if (!state.playlistsLoaded) return `<div class="loading"><div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><p class="muted">Loading your playlists…</p></div>`;
  const usable = state.playlists.filter((p) => p.mine);
  const q = state.plFilter.trim().toLowerCase();
  const shown = usable.filter((p) => !q || p.name.toLowerCase().includes(q));
  const hiddenCount = state.playlists.length - usable.length;
  return `
    <h2>Pick your playlists</h2>
    <p class="muted small-text">I'll find similar songs you don't already have.</p>
    ${usable.length > 6 ? `<input class="search" type="search" placeholder="Search your playlists" value="${esc(state.plFilter)}" data-input="plFilter" aria-label="Search playlists">` : ""}
    ${usable.length ? `<ul class="plist">${shown.map((p) => `
      <li>
        <input type="checkbox" id="pl-${esc(p.id)}" data-action="pick" data-id="${esc(p.id)}" ${state.selected.has(p.id) ? "checked" : ""}>
        <label for="pl-${esc(p.id)}">
          <span class="cover" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ""}></span>
          <span><div class="name">${esc(p.name)}</div><div class="meta">${p.count} songs</div></span>
          <span class="check" aria-hidden="true"></span>
        </label>
      </li>`).join("")}</ul>` : `<p class="empty">You don't have any playlists of your own yet.</p>`}
    ${hiddenCount ? `<p class="muted small-text">${hiddenCount} playlist${hiddenCount === 1 ? "" : "s"} you follow but didn't make aren't shown. Spotify doesn't let personal apps read their songs. Tip: copy one into a playlist of your own to use it here.</p>` : ""}
  `;
}

function askView() {
  return `
    <h2>What do you need?</h2>
    <textarea class="ask" data-input="askText" placeholder="e.g. 90s dance anthems for a hill climb" aria-label="Describe the songs you want">${esc(state.askText)}</textarea>
    <div class="chips">${EXAMPLES.map((e) => `<button class="chip" data-action="example" data-text="${esc(e)}">${esc(e)}</button>`).join("")}</div>
  `;
}

function filtersView() {
  const f = state.filters;
  const lenOpts = (sel, vals) => `<option value="">Any</option>${vals.map((v) => `<option value="${v}" ${String(sel) === String(v) ? "selected" : ""}>${v} min</option>`).join("")}`;
  const count = Object.keys(activeFilters()).length;
  return `
    <div class="filters-toggle">
      <button class="btn small" data-action="toggle-filters" aria-expanded="${state.showFilters}">Filters${count ? ` (${count})` : ""}</button>
      ${count ? `<button class="btn small ghost" data-action="clear-filters">Clear</button>` : ""}
    </div>
    <div class="filters ${state.showFilters ? "" : "hidden"}">
      <div class="row">
        <label class="field">Min BPM<input type="number" inputmode="numeric" min="40" max="220" value="${esc(f.bpmMin)}" data-filter="bpmMin" placeholder="Any"></label>
        <label class="field">Max BPM<input type="number" inputmode="numeric" min="40" max="220" value="${esc(f.bpmMax)}" data-filter="bpmMax" placeholder="Any"></label>
      </div>
      <div class="row">
        <label class="field">Shortest<select data-filter="minMinutes">${lenOpts(f.minMinutes, [2, 3, 4, 5])}</select></label>
        <label class="field">Longest<select data-filter="maxMinutes">${lenOpts(f.maxMinutes, [3, 4, 5, 6, 7, 8, 10])}</select></label>
      </div>
      <label class="switch">Clean songs only<input type="checkbox" data-filter="cleanOnly" ${f.cleanOnly ? "checked" : ""}></label>
    </div>`;
}

function resultsView() {
  const r = state.results;
  const filters = filtersView();
  if (!r || !r.songs || !r.songs.length) return `<p class="empty">No songs left in this list. Tap New search to find more.</p>`;

  const byKey = new Map(r.songs.map((s) => [s.key, s]));
  const visible = r.songs.filter(passes);
  const hidden = r.songs.length - visible.length;
  const style = r.style || {};
  const pills = [...(style.genres || []), ...(style.eras || []), style.tempo_range, style.energy].filter(Boolean).slice(0, 8);

  let body;
  if (r.isClass) {
    const mainSongs = r.sections.filter((sec) => !sec.spare).flatMap((sec) => sec.keys.map((k) => byKey.get(k))).filter((s) => s && passes(s));
    const total = mainSongs.reduce((sum, s) => sum + s.track.durationMs, 0);
    body = `
      <div class="total"><div><div class="muted small-text">Total running time</div><strong>${fmtTime(total)}</strong></div>
        ${r.targetMinutes ? `<span class="muted">Target ${r.targetMinutes} min</span>` : ""}</div>
      ${r.sections.map((sec) => {
        const list = sec.keys.map((k) => byKey.get(k)).filter((s) => s && passes(s));
        if (!list.length) return "";
        const secTime = list.reduce((sum, s) => sum + s.track.durationMs, 0);
        return `<div class="section-head"><h3>${esc(sec.name)}</h3><span>${sec.spare ? "not in total" : fmtTime(secTime)}</span></div>
          ${sec.spare ? `<p class="spares-note">Backup picks in case you want to swap something.</p>` : ""}
          <ol class="songs">${list.map(songCard).join("")}</ol>`;
      }).join("")}`;
  } else {
    body = `<ol class="songs grid">${visible.map(songCard).join("")}</ol>`;
  }

  return `
    <h2>${r.isClass ? "Your class" : "Suggestions"}</h2>
    <div class="summary">
      <p class="muted small-text">${r.mode === "playlist" ? "Based on" : "You asked for"}: <strong style="color:var(--text)">${esc(r.label)}</strong></p>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
      ${pills.length ? `<div class="pills">${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join("")}</div>` : ""}
    </div>
    ${filters}
    ${hidden ? `<p class="muted small-text">${hidden} song${hidden === 1 ? "" : "s"} hidden by your filters.</p>` : ""}
    ${visible.length ? `<button class="btn" style="width:100%;margin-bottom:14px" data-action="save-all">Save ${r.isClass ? "this class" : "all"} to a playlist</button>` : ""}
    ${body}
    ${!visible.length ? `<p class="empty">No songs match your filters.</p>` : ""}
  `;
}

function songCard(s) {
  const t = s.track;
  const bpm = s.bpm
    ? `<span class="stat"><b>${s.bpm}</b><small>BPM</small></span>`
    : s.approxBpm
      ? `<span class="stat"><b>${s.approxBpm}</b><small>BPM</small><span class="approx" title="AI estimate">approx.</span></span>`
      : `<span class="stat"><b>–</b><small>BPM</small></span>`;
  const bars = Array.from({ length: 10 }, (_, i) => `<i class="${i < s.energy ? "on" : ""}"></i>`).join("");
  return `<li class="song" data-key="${esc(s.key)}">
    <div class="head">
      <div class="art" ${t.image ? `style="background-image:url('${esc(t.image)}')"` : ""}></div>
      <div style="min-width:0">
        <p class="title">${esc(t.title)}</p>
        <div class="artist">${esc(t.artist)}${t.year ? ` · ${esc(t.year)}` : ""}</div>
      </div>
    </div>
    <div class="stats">
      ${bpm}
      <span class="stat"><b>${fmtTime(t.durationMs)}</b></span>
      <span class="stat" aria-label="Energy ${s.energy} out of 10"><span class="energy">${bars}</span><small>${s.energy}/10</small></span>
      ${t.explicit ? `<span class="badge" title="Explicit">E</span>` : ""}
      ${s.liked ? `<span class="badge liked">♥ Liked</span>` : ""}
    </div>
    ${s.tags.length ? `<div class="tags">${s.tags.map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}
    ${s.reason ? `<p class="reason">${esc(s.reason)}</p>` : ""}
    <div class="actions">
      <a class="btn primary" href="${esc(t.url)}" target="_blank" rel="noopener">▶ Spotify</a>
      <button class="btn" data-action="add" data-key="${esc(s.key)}">+ Add</button>
      <button class="btn ghost" data-action="dismiss" data-key="${esc(s.key)}" aria-label="Dismiss ${esc(t.title)}">✕</button>
    </div>
  </li>`;
}

function loadingView() {
  const steps = STEPS[state.busy.mode];
  const now = state.busy.step;
  return `<div class="loading">
    <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <p class="step">${esc(steps[now] || "Almost done")}…</p>
    <p class="muted">The AI part can take up to a minute.</p>
    <ol>${steps.map((label, i) => `<li class="${i < now ? "done" : i === now ? "now" : "todo"}">${esc(label)}</li>`).join("")}</ol>
  </div>`;
}

function renderDock() {
  let dock = document.querySelector(".dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.className = "dock";
    document.body.appendChild(dock);
  }
  if (!state.me || state.busy || !state.config || !state.config.spotifyClientId) { dock.innerHTML = ""; return; }
  if (state.view === "results" && state.results) {
    dock.innerHTML = `<div class="inner"><button class="btn big" data-action="new-search">New search</button></div>`;
  } else if (state.tab === "playlists") {
    const n = state.selected.size;
    dock.innerHTML = `<div class="inner"><button class="btn primary big" data-action="go-playlist" ${n ? "" : "disabled"}>${n ? `Find similar songs (${n})` : "Pick a playlist"}</button></div>`;
  } else {
    dock.innerHTML = `<div class="inner"><button class="btn primary big" data-action="go-ask" ${state.askText.trim() ? "" : "disabled"}>Find songs</button></div>`;
  }
}

// ---------- sheets ----------

function closeSheet() { $sheet.innerHTML = ""; }

function openSheet(html, bind) {
  $sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  $sheet.querySelector(".sheet").addEventListener("click", (e) => e.stopPropagation());
  bind && bind($sheet.querySelector(".sheet"));
}

function openPlaylistPicker(title, uris, defaultName) {
  const own = state.playlists.filter((p) => p.mine);
  openSheet(`
    <h3>${esc(title)}</h3>
    <form class="newpl"><input name="name" value="${esc(defaultName)}" aria-label="New playlist name" maxlength="100"><button class="btn primary" type="submit">New</button></form>
    ${own.map((p) => `<button class="opt" data-pl="${esc(p.id)}"><span class="cover" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ""}></span>${esc(p.name)}</button>`).join("")}
  `, (el) => {
    el.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get("name").trim() || defaultName;
      closeSheet();
      try {
        const pl = await sp.createPlaylist(name, "Made with When the Beat Drops");
        await sp.addToPlaylist(pl.id, uris);
        state.playlists.unshift({ id: pl.id, name: pl.name, image: "", count: uris.length, mine: true });
        toast(`Saved to “${pl.name}”`);
      } catch (err) {
        toast(`Couldn't save: ${err.message}`);
      }
    });
    el.querySelectorAll("[data-pl]").forEach((b) => b.addEventListener("click", async () => {
      const pl = own.find((p) => p.id === b.dataset.pl);
      closeSheet();
      try {
        await sp.addToPlaylist(pl.id, uris);
        pl.count += uris.length;
        toast(`Added to “${pl.name}”`);
      } catch (err) {
        toast(`Couldn't add: ${err.message}`);
      }
    }));
  });
}

function openAccount() {
  const me = state.me;
  openSheet(`
    <h3>${esc(me.name)}</h3>
    <p class="muted small-text">Your Spotify ID: <code>${esc(me.id)}</code></p>
    <button class="opt" data-do="copy">Copy Spotify ID (for setup)</button>
    <button class="opt" data-do="undismiss">Bring back dismissed songs (${state.dismissed.length})</button>
    <button class="opt" data-do="logout">Log out</button>
  `, (el) => {
    el.querySelector('[data-do="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(me.id); toast("Copied"); } catch { toast(me.id); }
    };
    el.querySelector('[data-do="undismiss"]').onclick = () => {
      state.dismissed = [];
      store.set("dismissed", []);
      closeSheet();
      toast("Dismissed songs can be suggested again");
    };
    el.querySelector('[data-do="logout"]').onclick = () => {
      sp.logout();
      state.me = null;
      closeSheet();
      render();
    };
  });
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "close-sheet") return closeSheet();
  if (a === "login") return sp.login();
  if (a === "account") return openAccount();
  if (a === "tab") {
    state.tab = el.dataset.tab;
    store.set("tab", state.tab);
    state.error = "";
    return render();
  }
  if (a === "pick") {
    el.checked ? state.selected.add(el.dataset.id) : state.selected.delete(el.dataset.id);
    store.set("selected", [...state.selected]);
    return renderDock();
  }
  if (a === "example") {
    state.askText = el.dataset.text;
    store.set("askText", state.askText);
    return render();
  }
  if (a === "go-playlist") return findSongs("playlist");
  if (a === "go-ask") return findSongs("request");
  if (a === "new-search" || a === "show-results") {
    state.view = a === "new-search" ? "pick" : "results";
    state.error = "";
    render();
    return window.scrollTo({ top: 0 });
  }
  if (a === "toggle-filters") { state.showFilters = !state.showFilters; return render(); }
  if (a === "clear-filters") {
    state.filters = { bpmMin: "", bpmMax: "", minMinutes: "", maxMinutes: "", cleanOnly: false };
    saveFilters();
    return render();
  }
  const r = state.results;
  if (a === "add") {
    const s = r.songs.find((x) => x.key === el.dataset.key);
    return openPlaylistPicker(`Add “${s.track.title}” to…`, [s.track.uri], "Beat Drops picks");
  }
  if (a === "save-all") {
    const order = r.isClass
      ? r.sections.filter((sec) => !sec.spare).flatMap((sec) => sec.keys)
      : r.songs.map((s) => s.key);
    const byKey = new Map(r.songs.map((s) => [s.key, s]));
    const uris = order.map((k) => byKey.get(k)).filter((s) => s && passes(s)).map((s) => s.track.uri);
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return openPlaylistPicker(`Save ${uris.length} songs to…`, uris, r.isClass ? `Spin class ${date}` : `Beat Drops ${date}`);
  }
  if (a === "dismiss") return dismiss(el.dataset.key, el.closest(".song"));
});

function dismiss(key, card) {
  const r = state.results;
  const idx = r.songs.findIndex((s) => s.key === key);
  if (idx < 0) return;
  const song = r.songs[idx];
  const entry = { id: song.track.id, key, label: `${song.track.title} — ${song.track.artist}` };
  const secIdx = r.sections.findIndex((sec) => sec.keys.includes(key));
  const posInSec = secIdx >= 0 ? r.sections[secIdx].keys.indexOf(key) : -1;

  const apply = () => {
    r.songs.splice(idx, 1);
    if (secIdx >= 0) r.sections[secIdx].keys.splice(posInSec, 1);
    state.dismissed.push(entry);
    store.set("dismissed", state.dismissed.slice(-500));
    saveResults();
    render();
  };
  if (card) { card.classList.add("leaving"); setTimeout(apply, 180); } else apply();

  toast("Dismissed", () => {
    r.songs.splice(idx, 0, song);
    if (secIdx >= 0) r.sections[secIdx].keys.splice(posInSec, 0, key);
    state.dismissed = state.dismissed.filter((d) => d.key !== key);
    store.set("dismissed", state.dismissed);
    saveResults();
    render();
  });
}

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.input === "askText") {
    state.askText = el.value;
    store.set("askText", state.askText);
    return renderDock();
  }
  if (el.dataset.input === "plFilter") {
    state.plFilter = el.value;
    const pos = el.selectionStart;
    render();
    const again = document.querySelector('[data-input="plFilter"]');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.dataset.filter) return;
  state.filters[el.dataset.filter] = el.type === "checkbox" ? el.checked : el.value;
  saveFilters();
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.dataset.input === "askText") findSongs("request");
});

// ---------- start ----------

async function start() {
  try {
    const res = await fetch("/api/config");
    state.config = await res.json();
  } catch {
    $app.innerHTML = `<div class="notice error">Couldn't reach the app's server. Check your connection and refresh.</div>`;
    return;
  }
  sp.setClientId(state.config.spotifyClientId);
  if (!state.config.spotifyClientId) return render();

  try {
    await sp.handleRedirect();
  } catch (err) {
    state.error = err.message;
  }

  if (sp.isLoggedIn()) {
    try {
      state.me = await sp.getMe();
    } catch (err) {
      state.error = err.message;
      sp.logout();
    }
  }
  render();
  if (state.me) loadPlaylists();
}

async function loadPlaylists() {
  try {
    state.playlists = await sp.getPlaylists(state.me.id);
    const ids = new Set(state.playlists.map((p) => p.id));
    state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  } catch (err) {
    state.error = `Couldn't load your playlists: ${err.message}`;
  }
  state.playlistsLoaded = true;
  if (!state.busy) render();
}

start();
