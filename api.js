"use strict";
// ═══════════════════════════════════════════════════════════
// API.JS — Chess.com + Lichess live data fetching
// ═══════════════════════════════════════════════════════════

const ENDPOINTS = {
  chesscom: "https://api.chess.com/pub",
  lichess:  "https://lichess.org/api",
};

// ── Low-level fetch with timeout + error capture ───────────
async function safeFetch(url, opts = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { ok: true, data };
  } catch(e) {
    const isTimeout = e?.name === "AbortError";
    return { ok: false, error: isTimeout ? "Timeout" : "Network error", url };
  } finally {
    clearTimeout(tid);
  }
}

// ── Parse NDJSON (Lichess) ─────────────────────────────────
function parseNdjson(text) {
  return String(text || "").split("\n")
    .map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── Format delta safely — no Math.random() ─────────────────
function formatDelta(val) {
  if (val == null || isNaN(Number(val))) return null;
  const n = Number(val);
  return `${n >= 0 ? "+" : ""}${n}`;
}

// ── Normalise Chess.com games → our schema ─────────────────
function normalizeChesscomGames(raw, myUsername, limit = 20) {
  if (!raw?.games?.length) return [];
  return raw.games
    .filter(g => g.pgn)
    .slice(-limit).reverse()
    .map((g, idx) => {
      const meWhite = g.white?.username?.toLowerCase() === myUsername.toLowerCase();
      const me  = meWhite ? g.white  : g.black;
      const opp = meWhite ? g.black  : g.white;

      const WIN_RESULTS  = ["win"];
      const LOSS_RESULTS = ["checkmated","resigned","timeout","abandoned","lose"];
      const result = WIN_RESULTS.includes(me?.result)  ? "win"
                   : LOSS_RESULTS.includes(me?.result) ? "loss" : "draw";

      const acc = Number(me?.accuracy);

      // Use real rating diff from API; null if unavailable (never fabricate)
      const rawDelta = me?.ratingDiff ?? me?.rating_diff ?? null;
      const delta    = formatDelta(rawDelta);

      return {
        id:          `cc-${g.uuid || idx}`,
        result,
        opening:     g.opening || g.eco || "Unknown Opening",
        date:        g.end_time
          ? new Date(g.end_time * 1000).toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric"
            })
          : "Unknown",
        accuracy:    acc > 0 ? acc : null,       // null = unknown, not guessed
        blunders:    me?.analysis?.blunders ?? null,
        mistakes:    me?.analysis?.mistakes  ?? null,
        delta,                                    // null if not provided by API
        opp:         opp?.username || "Opponent",
        oppRating:   Number(opp?.rating) || null,
        moves:       (g.pgn?.match(/\d+\./g) || []).length || 0,
        pgn:         g.pgn || "",
        timeControl: g.time_control || "—",
        source:      "chess.com",
        rated:       g.rated !== false,
      };
    });
}

// ── Normalise Lichess games → our schema ──────────────────
function normalizeLichessGames(text, myUsername, limit = 20) {
  return parseNdjson(text).slice(0, limit).map((g, idx) => {
    const myColor = g.players?.white?.user?.name?.toLowerCase() === myUsername.toLowerCase()
      ? "white" : "black";
    const me  = g.players?.[myColor];
    const opp = g.players?.[myColor === "white" ? "black" : "white"];

    const result = !g.winner ? "draw" : g.winner === myColor ? "win" : "loss";

    // Lichess provides ratingDiff directly
    const rawDelta = me?.ratingDiff ?? null;
    const delta    = formatDelta(rawDelta);

    return {
      id:          `li-${g.id || idx}`,
      result,
      opening:     g.opening?.name || "Opening",
      date:        g.createdAt
        ? new Date(g.createdAt).toLocaleDateString("en-IN", {
            day: "numeric", month: "short", year: "numeric"
          })
        : "Unknown",
      accuracy:    me?.analysis?.accuracy  ?? null,
      blunders:    me?.analysis?.blunder   ?? null,
      mistakes:    me?.analysis?.mistake   ?? null,
      delta,
      opp:         opp?.user?.name || "Lichess Opponent",
      oppRating:   Number(opp?.rating) || null,
      moves:       g.turns || 0,
      pgn:         g.moves || "",
      timeControl: g.clock ? `${Math.floor(g.clock.initial/60)}+${g.clock.increment}` : "—",
      source:      "lichess",
      rated:       g.rated !== false,
    };
  });
}

// ── Public API ─────────────────────────────────────────────
export const Api = {

  async fetchRatings({ chesscom, lichess }) {
    const [ccStats, liProfile] = await Promise.all([
      chesscom ? safeFetch(`${ENDPOINTS.chesscom}/player/${chesscom}/stats`) : Promise.resolve({ ok: false }),
      lichess   ? safeFetch(`${ENDPOINTS.lichess}/user/${lichess}`)           : Promise.resolve({ ok: false }),
    ]);

    const ratings = {};
    const errors  = [];

    if (ccStats.ok) {
      ratings.chesscom = {
        rapid:  ccStats.data?.chess_rapid?.last?.rating  ?? null,
        blitz:  ccStats.data?.chess_blitz?.last?.rating  ?? null,
        bullet: ccStats.data?.chess_bullet?.last?.rating ?? null,
        puzzle: ccStats.data?.tactics?.highest?.rating   ?? null,
      };
    } else if (chesscom) {
      errors.push(`Chess.com: ${ccStats.error}`);
    }

    if (liProfile.ok) {
      ratings.lichess = {
        rapid:     liProfile.data?.perfs?.rapid?.rating     ?? null,
        blitz:     liProfile.data?.perfs?.blitz?.rating     ?? null,
        bullet:    liProfile.data?.perfs?.bullet?.rating    ?? null,
        classical: liProfile.data?.perfs?.classical?.rating ?? null,
        puzzle:    liProfile.data?.perfs?.puzzle?.rating    ?? null,
      };
    } else if (lichess) {
      errors.push(`Lichess: ${liProfile.error}`);
    }

    return { ratings, errors };
  },

  async fetchGames({ chesscom, lichess, lichessToken = "" }) {
    const [ccGames, liGames] = await Promise.all([
      chesscom ? this._fetchChessComRecentGames(chesscom, 40) : Promise.resolve({ ok: false }),
      lichess
        ? safeFetch(
            `${ENDPOINTS.lichess}/games/user/${lichess}?max=40&moves=true&opening=true&clocks=false&evals=true&pgnInJson=false`,
            {
              headers: {
                Accept: "application/x-ndjson",
                ...(lichessToken ? { Authorization: `Bearer ${lichessToken}` } : {}),
              },
            }
          )
        : Promise.resolve({ ok: false }),
    ]);

    const games  = [];
    const errors = [];

    if (ccGames.ok) games.push(...normalizeChesscomGames(ccGames.data, chesscom, 20));
    else if (chesscom) errors.push(`Chess.com games: ${ccGames.error}`);

    if (liGames.ok) games.push(...normalizeLichessGames(liGames.data, lichess, 20));
    else if (lichess) errors.push(`Lichess games: ${liGames.error}`);

    return { games, errors };
  },

  async loadAll({ chesscom, lichess, lichessToken = "" }) {
    const [ratingsResult, gamesResult] = await Promise.all([
      this.fetchRatings({ chesscom, lichess }),
      this.fetchGames({ chesscom, lichess, lichessToken }),
    ]);
    return {
      ratings: ratingsResult.ratings,
      games:   gamesResult.games,
      errors:  [...ratingsResult.errors, ...gamesResult.errors],
    };
  },

  async _fetchChessComRecentGames(chesscom, max = 40) {
    // Chess.com splits games by month archive. Fetch latest archives and merge.
    const archivesRes = await safeFetch(`${ENDPOINTS.chesscom}/player/${chesscom}/games/archives`);
    if (!archivesRes.ok) return archivesRes;
    const archives = Array.isArray(archivesRes.data?.archives) ? archivesRes.data.archives.slice(-3).reverse() : [];
    if (!archives.length) return { ok: true, data: { games: [] } };
    const monthly = await Promise.all(archives.map(url => safeFetch(url)));
    const allGames = monthly.filter(r => r.ok).flatMap(r => Array.isArray(r.data?.games) ? r.data.games : []);
    return { ok: true, data: { games: allGames.slice(-max) } };
  },
};
