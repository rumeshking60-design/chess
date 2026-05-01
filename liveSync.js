"use strict";
// ═══════════════════════════════════════════════════════════
// LIVESYNC.JS — Main sync engine (Chess.com + Lichess)
// ═══════════════════════════════════════════════════════════

import { State } from "./state.js";
import { Api }   from "./api.js";

// ── Small internal utilities (kept local to avoid API.js coupling) ──
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function safeFetchJson(url, opts = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, url };
    const data = await res.json();
    return { ok: true, data, status: res.status };
  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    return { ok: false, status: 0, error: isTimeout ? "Timeout" : "Network error", url };
  } finally {
    clearTimeout(tid);
  }
}

async function fetchWithBackoffJson(url, opts = {}, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await safeFetchJson(url, opts, 9000 + i * 1500);
    if (r.ok) return r;
    // 429 / 503 style backoff
    const retryable = r.status === 429 || r.status === 503;
    if (!retryable || i === tries - 1) return r;
    await sleep(400 * Math.pow(2, i));
  }
  return { ok: false, status: 0, error: "Unknown error", url };
}

function monthLabel(year, monthZeroBased) {
  const d = new Date(Date.UTC(year, monthZeroBased, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }); // "Jan 2025"
}

function normalizeMonthlyHistory(points = []) {
  // points: [[year, month, rating], ...] where month is 0-based.
  // We compress to last rating per month, sorted ascending.
  const map = new Map(); // key "YYYY-MM" => rating
  for (const row of points) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [y, m, r] = row;
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(r)) continue;
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    map.set(key, r); // later entry wins
  }
  const keys = [...map.keys()].sort();
  return keys.map(k => {
    const [y, mm] = k.split("-").map(Number);
    return { month: monthLabel(y, mm - 1), rating: map.get(k) };
  });
}

function pickPreferredDisplayRating(ratings) {
  // Prefer Lichess rapid → Chess.com rapid, then any available.
  const liRapid = ratings?.lichess?.rapid;
  const ccRapid = ratings?.chesscom?.rapid;
  return (Number.isFinite(liRapid) && liRapid > 0) ? liRapid
       : (Number.isFinite(ccRapid) && ccRapid > 0) ? ccRapid
       : (Number.isFinite(ratings?.lichess?.blitz) && ratings.lichess.blitz > 0) ? ratings.lichess.blitz
       : (Number.isFinite(ratings?.chesscom?.blitz) && ratings.chesscom.blitz > 0) ? ratings.chesscom.blitz
       : null;
}

async function fetchLichessRatingHistory(lichessUsername) {
  if (!lichessUsername) return { ok: false, reason: "no_username", history: [] };
  const url = `https://lichess.org/api/user/${encodeURIComponent(lichessUsername)}/rating-history`;
  const res = await fetchWithBackoffJson(url, {}, { tries: 3 });
  if (!res.ok) return { ok: false, reason: res.status === 404 ? "not_found" : "error", error: res.error, history: [] };

  const raw = Array.isArray(res.data) ? res.data : [];
  if (!raw.length) return { ok: true, reason: "empty", history: [], raw };

  // Prefer "Rapid" perf; otherwise first perf with points.
  const rapidObj = raw.find(x => String(x?.name || "").toLowerCase() === "rapid");
  const pick = rapidObj?.points?.length
    ? rapidObj
    : raw.find(x => Array.isArray(x?.points) && x.points.length) || null;

  if (!pick?.points?.length) return { ok: true, reason: "empty", history: [], raw };
  const history = normalizeMonthlyHistory(pick.points);
  return { ok: true, reason: pick === rapidObj ? "rapid" : "fallback", history, raw };
}

export const LiveSync = {
  // Sync everything: ratings + games + (Lichess) rating history
  async syncAll({ toast = null, setBadge = null, setBusy = null } = {}) {
    const errors = [];
    const notes  = [];
    const startedAt = Date.now();

    const busy = on => { try { setBusy?.(!!on); } catch {} };
    const badge = msg => { try { setBadge?.(msg); } catch {} };
    const info = msg => { try { toast?.(msg); } catch {} };

    const { profile } = State.get();
    const chesscom = profile?.chesscom || "";
    const lichess  = profile?.lichess  || "";
    const lichessToken = profile?.lichessToken || "";

    if (!chesscom && !lichess) {
      info("Add Chess.com or Lichess handle to sync.");
      return { ok: false, errors: ["No accounts linked"], notes };
    }
    if (!navigator.onLine) {
      info("📴 Offline — sync will retry when online");
      return { ok: false, errors: ["Offline"], notes };
    }

    busy(true);
    badge("⏳ Syncing…");

    // 1) Ratings
    try {
      info(lichess ? "Syncing from Lichess…" : "Syncing ratings…");
      const r = await Api.fetchRatings({ chesscom, lichess });
      if (r?.ratings && Object.keys(r.ratings).length) {
        State.setPlatformRatings(r.ratings);
        const preferred = pickPreferredDisplayRating(r.ratings);
        if (preferred && preferred !== State.get().profile.rating) State.updateProfile({ rating: preferred });
      }
      if (r?.errors?.length) errors.push(...r.errors);
    } catch (e) {
      errors.push("Ratings: sync failed");
    }

    // 2) Games
    try {
      info("Syncing recent games…");
      const g = await Api.fetchGames({ chesscom, lichess, lichessToken });
      if (g?.games?.length) {
        State.mergeGames(g.games);
        notes.push(`${g.games.length} games`);
      }
      if (g?.errors?.length) errors.push(...g.errors);
    } catch {
      errors.push("Games: sync failed");
    }

    // 3) Lichess rating history (progress graph)
    try {
      if (lichess) {
        info("Fetching Lichess rating history…");
        const h = await fetchLichessRatingHistory(lichess);
        if (h.ok && h.history.length) {
          State.setRatingHistory(h.history, { source: "lichess", mode: h.reason });
          notes.push(`history (${h.history.length} months)`);
        } else if (h.ok && !h.history.length) {
          State.setRatingHistory([], { source: "seed", mode: "empty" }); // keep seed visible
          notes.push("no history");
        } else {
          errors.push(h.reason === "not_found" ? "No Lichess user found" : `Lichess history: ${h.error || "failed"}`);
        }
      }
    } catch {
      errors.push("Lichess history: sync failed");
    }

    const ts = new Date().toISOString();
    State.setLastSync(ts);

    const elapsedMs = Date.now() - startedAt;
    if (!errors.length) {
      badge(`✅ Live · ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      info("✅ Synced successfully");
    } else {
      badge(`⚠️ Partial · ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      info(errors[0].includes("No Lichess user") ? "No Lichess data found" : "⚠️ Sync completed with warnings");
    }

    busy(false);
    return { ok: !errors.length, ts, errors, notes, elapsedMs };
  },

  async syncRatings() {
    const { chesscom, lichess } = State.get().profile;
    if (!chesscom && !lichess) return null;
    try {
      const r = await Api.fetchRatings({ chesscom, lichess });
      if (r?.ratings && Object.keys(r.ratings).length) State.setPlatformRatings(r.ratings);
      return r.ratings || null;
    } catch {
      return null;
    }
  },
};

