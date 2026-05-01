"use strict";
// ═══════════════════════════════════════════════════════════
// STATE.JS — Multi-user state, event-driven, localStorage
// ═══════════════════════════════════════════════════════════

// ── Global storage keys (not per-user) ─────────────────────
const GLOBAL_KEYS = {
  usersIndex:     "cka_users_v1",
  currentUserId:  "cka_current_user_v1",
  coachAuth:      "cka_coach_auth_v3",
  loginState:     "cka_login_state_v1",
};

// Per-user blob key: cka_user_<id>
const userKey = id => `cka_user_${String(id || "").toLowerCase()}`;

// Legacy single-user keys (for migration only)
const LEGACY_KEYS = {
  profile:       "cka_profile_v3",
  games:         "cka_games_v3",
  tournaments:   "cka_tournaments_v3",
  registrations: "cka_registrations_v3",
  puzzle:        "cka_puzzle_v3",
  coachFeedback: "cka_coach_feedback_v3",
  trainingFocus: "cka_training_focus_v3",
  assignments:   "cka_assignments_v3",
  lastSync:      "cka_last_sync_v3",
  platformRatings:"cka_platform_ratings_v3",
  ratingHistory: "cka_rating_history_v3",
  ratingHistoryMeta: "cka_rating_history_meta_v1",
  puzzleHistory: "cka_puzzle_history_v3",
  streak:        "cka_streak_v3",
  onboarded:     "cka_onboarded_v3",
  coachAuth:     "cka_coach_auth_v3",
  loginState:    "cka_login_state_v1",
};

const SEED = {
  profile: {
    id: "student-1",
    fullName: "Student",
    rating: 1648,
    chesscom: "",
    lichess: "",
    lichessToken: "",
    category: "U-15",
    schoolCoach: "Coach",
    dob: "2011-04-15",
    location: "Varanasi, Uttar Pradesh",
  },
  games: [
    { id: "g1", result: "win",  opening: "Sicilian Defense",    date: "27 Apr 2026", accuracy: 92, blunders: 0, delta: "+16", opp: "ArjunM1512",    oppRating: 1598, moves: 38, pgn: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Bg5 e6 7.f4 Be7 8.Qf3 Qc7 9.O-O-O Nbd7 10.g4 b5 11.Bxf6 Nxf6 12.g5 Nd7 13.f5 Ne5 14.Qh5 exf5 15.exf5 O-O 16.Nxb5 axb5 17.Nd5 Qd8 18.Nxe7+ Qxe7 19.Rxd6 Bb7 20.g6 hxg6 21.fxg6 fxg6 22.Rxg6+ Kh7 23.Rg7+ Kh8 24.Rxe7 Rxf1+ 25.Kd2 Rxa2 26.Rxb7 Ra6 27.Rxb5 Rd6+ 28.Kc3 Rfd1 29.Rb3 Nf3 30.Rh3 Ng5 31.Rh5 Ne6 32.Kc4 Kh7 33.Rh2 Kg6 34.Rg2+ Kf7 35.Rxg5 Ke7 36.Re5 Kf7 37.Rxe6 Kxe6 38.b4 1-0", source: "seed" },
    { id: "g2", result: "loss", opening: "QGD Exchange",        date: "24 Apr 2026", accuracy: 79, blunders: 2, delta: "-11", opp: "Prashant_UP",   oppRating: 1712, moves: 52, pgn: "1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.cxd5 exd5 5.Bg5 Be7 6.e3 O-O 7.Bd3 Nbd7 8.Qc2 Re8 9.Nge2 Nf8 10.O-O c6 11.Rab1 Ne6 12.Bh4 g6 13.f3 Nh5 14.Bxe7 Qxe7 15.Kh1 Ng7 16.f4 f5 17.g4 fxg4 18.Ng3 Nf5 19.Nxf5 gxf5 20.Rbg1 h5 21.Rg5 Qf6 22.h3 gxh3 23.Rxh5 Rxe3 24.Rg1 Ree8 25.Rh8+ Kxh8 26.Rxg7 Kxg7 27.Qxf5 Rxf5 0-1", source: "seed" },
    { id: "g3", result: "win",  opening: "Ruy Lopez Berlin",   date: "21 Apr 2026", accuracy: 88, blunders: 1, delta: "+13", opp: "KartikCh",      oppRating: 1621, moves: 45, pgn: "1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 5.d4 Nd6 6.Bxc6 dxc6 7.dxe5 Nf5 8.Qxd8+ Kxd8 9.Nc3 Ke8 10.b3 Ne7 11.Bb2 Ng6 12.h4 h5 13.Rad1 Be7 14.Ne2 Nxh4 15.Nxh4 Bxh4 16.Rd3 Be7 17.Nf4 Rh6 18.Nd5 Bd8 19.Rfd1 c5 20.Nf6+ Bxf6 21.exf6 g6 22.Re1+ Kf8 23.Re7 Rh7 24.Re8+ Kg8 25.Rxc8 Rxc8 26.Rd8+ Kh7 27.Rxc8 b5 28.Rc7 a5 29.Rxa7 b4 30.Ra6 c4 31.bxc4 b3 32.axb3 h4 33.c5 h3 34.gxh3 g5 35.c6 g4 36.hxg4 1-0", source: "seed" },
    { id: "g4", result: "draw", opening: "French Defense",     date: "18 Apr 2026", accuracy: 85, blunders: 1, delta: "+2",  opp: "MihirTD",      oppRating: 1655, moves: 60, pgn: "1.e4 e6 2.d4 d5 3.Nd2 Nf6 4.e5 Nfd7 5.Bd3 c5 6.c3 Nc6 7.Ne2 cxd4 8.cxd4 f6 9.exf6 Nxf6 10.Nf4 Bd6 11.O-O Qc7 12.Nxe6 Bxe6 13.Nf3 Ng4 14.h3 Nf6 15.Bg5 O-O 16.Qd2 Nxd4 17.Nxd4 Bxh3 18.Nxe6 Qxe6 19.gxh3 Qxh3 20.Bf4 Bxf4 21.Qxf4 Rae8 22.Rae1 Rxe1 23.Rxe1 Ng4 24.Re2 h6 25.Qg3 Qxg3 26.fxg3 Ne3 27.Bxh7+ Kxh7 28.Rxe3 Rxf2 29.g4 Rf4 30.g5 Rxg4+ 31.Kh2 hxg5 32.Rxd3 g4 33.Rd4 Rg3 34.Rg4 Rxg4 35.Kxg4 d4 36.Kg5 d3 37.Kxg6 d2 38.Kxg7 d1=Q 39.Kg6 Qd6+ 40.Kg7 Qe7+ 41.Kg6 Qf6+ 42.Kh7 Qf7+ 43.Kh6 Qf4+ 44.Kh7 Qh4+ 45.Kg7 g3 46.Kf6 g2 47.Ke5 g1=Q 48.Kd4 Qgd4+ 49.Ke5 Qdd5+ 50.Kf4 Qdf5# 0-1", source: "seed" },
    { id: "g5", result: "win",  opening: "King's Indian Defense", date: "15 Apr 2026", accuracy: 94, blunders: 0, delta: "+18", opp: "DeepakV1590", oppRating: 1575, moves: 32, pgn: "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O 6.Be2 e5 7.O-O Nc6 8.d5 Ne7 9.Ne1 Nd7 10.Be3 f5 11.f3 f4 12.Bf2 g5 13.Rc1 Ng6 14.Nd3 h5 15.c5 g4 16.cxd6 cxd6 17.Nb5 Rf6 18.Nxa7 Rxa7 19.b4 g3 20.hxg3 fxg3 21.Bxg3 Nf4 22.Nxf4 exf4 23.Bxf4 h4 24.Bg5 Rg6 25.Bf4 Nf6 26.g3 Ne4 27.gxh4 Rxg2+ 28.Kxg2 Qxh4 29.fxe4 Bf6 30.Be3 Bh3+ 31.Kh2 Qxe4 32.Rxf6 1-0", source: "seed" },
  ],
  tournaments: [
    { id: "delhi-junior", title: "Delhi Junior Rapid Open 2026",             venue: "Noida Indoor Sports Complex",    date: "12 May 2026",    rounds: "6 Rounds · 15+10", pool: "U-15 · Rated 1500–1900", fee: "INR 900",  totalSeats: 60, seatsLeft: 18, type: "Rapid",     eligible: true },
    { id: "up-state",     title: "UP State U-15 Classical Championship",     venue: "Lucknow Chess Academy Hall",     date: "18–22 May 2026", rounds: "7 Rounds · 60+30", pool: "FIDE Rated 1400–2000",   fee: "INR 1400", totalSeats: 50, seatsLeft: 11, type: "Classical", eligible: true },
    { id: "north-zone",   title: "North Zone Training Cup (Swiss)",          venue: "Gurugram Youth Chess Centre",    date: "29 May 2026",    rounds: "5 Rounds · 25+5",  pool: "Invitational 1550–1850", fee: "INR 750",  totalSeats: 40, seatsLeft: 9,  type: "Rapid",     eligible: true },
    { id: "national-u15", title: "National U-15 Open Chess Championship",    venue: "Chennai Chess Federation Hall",  date: "14–18 Jun 2026", rounds: "9 Rounds · 90+30", pool: "National U-15",          fee: "INR 2000", totalSeats: 128, seatsLeft: 34, type: "Classical", eligible: false },
  ],
  registrations: [],
  puzzle: { rating: 1520, streak: 7, solvedToday: 3, difficulty: "Hard", totalSolved: 84 },
  puzzleHistory: [],
  coachAuth: { loggedIn: false, role: "student", name: "" },
  trainingFocus: ["endgames", "tactics", "calculation"],
  coachFeedback: [
    { id: "cf-seed-1", at: "2026-04-28T10:00:00Z", coachName: "Coach", gameId: "g2", gameLabel: "QGD Exchange vs Prashant_UP", category: "Endgame", comment: "You allowed passive rook placement in move 22. In rook endgames, activity is everything — your rook must never be cornered. Study Capablanca's rook endings.", focus: "endgames" },
    { id: "cf-seed-2", at: "2026-04-25T09:30:00Z", coachName: "Coach", gameId: "g1", gameLabel: "Sicilian Defense vs ArjunM1512", category: "Tactics",  comment: "Excellent piece sacrifice on move 16 — Rxg6 showed real tactical vision. Keep sharpening calculation 3 moves ahead.", focus: "tactics" },
    { id: "cf-seed-3", at: "2026-04-20T15:00:00Z", coachName: "Coach", gameId: "g3", gameLabel: "Ruy Lopez Berlin vs KartikCh",  category: "Opening",   comment: "Berlin endgame handled very well. Study the Ne7 plan after ...Kxd8 — you deviated on move 10. Use Leko's games as reference.", focus: "openings" },
  ],
  assignments: [
    { id: "as-1", title: "Rook Endgame Fundamentals",      desc: "Complete 15 rook vs rook endgame studies on Lichess.",  due: "2026-05-05", status: "pending",    link: "https://lichess.org/practice/rook-endings" },
    { id: "as-2", title: "Sicilian Najdorf: 6.Bg5 Line",   desc: "Watch 3 Kasparov games in this variation. Note pawn structures.", due: "2026-05-08", status: "pending", link: "" },
    { id: "as-3", title: "Tactics: Back Rank Mate patterns", desc: "Solve 25 back-rank puzzles. Record your solving time.", due: "2026-04-30", status: "done",   link: "https://lichess.org/practice/defensive-moves" },
  ],
  ratingHistory: [
    { month: "Nov", rating: 1530 }, { month: "Dec", rating: 1558 },
    { month: "Jan", rating: 1571 }, { month: "Feb", rating: 1595 },
    { month: "Mar", rating: 1612 }, { month: "Apr", rating: 1635 },
    { month: "May", rating: 1648 },
  ],
  ratingHistoryMeta: { source: "seed", updatedAt: null, mode: "seed" },
  platformRatings: {},
  lastSync: null,
  streak: 17,
  onboarded: true,
  loginState: { loggedIn: false, role: "student" }, // global fallback
  coachAuth:  { loggedIn: false, role: "student", name: "" }, // global fallback
};

// ── Storage helpers ─────────────────────────────────────────
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function del(key) {
  try { localStorage.removeItem(key); } catch {}
}

function nowIso() {
  return new Date().toISOString();
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function normHandle(h) {
  return String(h || "").trim().toLowerCase();
}

function deriveUserId({ chesscom = "", lichess = "" } = {}) {
  const cc = normHandle(chesscom);
  const li = normHandle(lichess);
  return cc || li || "";
}

function defaultUserStateFromSeed() {
  const u = deepClone(SEED);
  delete u.loginState;
  delete u.coachAuth;
  return u;
}

function readUserState(id) {
  const u = read(userKey(id), null);
  if (u && typeof u === "object") return u;
  const fresh = defaultUserStateFromSeed();
  fresh.profile.id = id;
  return fresh;
}

function writeUserState(id, userState) {
  write(userKey(id), userState);
}

function readUsersIndex() {
  const idx = read(GLOBAL_KEYS.usersIndex, []);
  return Array.isArray(idx) ? idx : [];
}

function upsertUserIndex(entry) {
  const idx = readUsersIndex();
  const id = normHandle(entry?.id);
  if (!id) return idx;
  const next = idx.filter(u => normHandle(u.id) !== id);
  next.unshift({
    id,
    chesscom: entry?.chesscom || "",
    lichess: entry?.lichess || "",
    fullName: entry?.fullName || "",
    lastActiveAt: entry?.lastActiveAt || nowIso(),
    createdAt: entry?.createdAt || nowIso(),
  });
  write(GLOBAL_KEYS.usersIndex, next.slice(0, 50));
  return next;
}

function setCurrentUserId(id) {
  write(GLOBAL_KEYS.currentUserId, normHandle(id));
}

function getCurrentUserId() {
  return normHandle(read(GLOBAL_KEYS.currentUserId, ""));
}

function migrateLegacyIfNeeded() {
  const existingIdx = read(GLOBAL_KEYS.usersIndex, null);
  if (Array.isArray(existingIdx) && existingIdx.length) return;

  const legacyProfile = read(LEGACY_KEYS.profile, null);
  if (!legacyProfile) return;

  const id = deriveUserId({
    chesscom: legacyProfile?.chesscom,
    lichess: legacyProfile?.lichess,
  }) || "student";

  const userState = defaultUserStateFromSeed();
  userState.profile          = legacyProfile || userState.profile;
  userState.games            = read(LEGACY_KEYS.games,          userState.games);
  userState.tournaments      = read(LEGACY_KEYS.tournaments,    userState.tournaments);
  userState.registrations    = read(LEGACY_KEYS.registrations,  userState.registrations);
  userState.puzzle           = read(LEGACY_KEYS.puzzle,         userState.puzzle);
  userState.puzzleHistory    = read(LEGACY_KEYS.puzzleHistory,  userState.puzzleHistory);
  userState.coachFeedback    = read(LEGACY_KEYS.coachFeedback,  userState.coachFeedback);
  userState.trainingFocus    = read(LEGACY_KEYS.trainingFocus,  userState.trainingFocus);
  userState.assignments      = read(LEGACY_KEYS.assignments,    userState.assignments);
  userState.ratingHistory    = read(LEGACY_KEYS.ratingHistory,  userState.ratingHistory);
  userState.ratingHistoryMeta= read(LEGACY_KEYS.ratingHistoryMeta, userState.ratingHistoryMeta);
  userState.platformRatings  = read(LEGACY_KEYS.platformRatings,userState.platformRatings);
  userState.lastSync         = read(LEGACY_KEYS.lastSync,       userState.lastSync);
  userState.streak           = read(LEGACY_KEYS.streak,         userState.streak);
  userState.onboarded        = read(LEGACY_KEYS.onboarded,      userState.onboarded);

  userState.profile = { ...userState.profile, id };
  writeUserState(id, userState);
  upsertUserIndex({
    id,
    chesscom: userState.profile?.chesscom || "",
    lichess: userState.profile?.lichess || "",
    fullName: userState.profile?.fullName || "",
    lastActiveAt: nowIso(),
  });
  setCurrentUserId(id);

  const legacyCoachAuth = read(LEGACY_KEYS.coachAuth, null);
  if (legacyCoachAuth) write(GLOBAL_KEYS.coachAuth, legacyCoachAuth);
  const legacyLoginState = read(LEGACY_KEYS.loginState, null);
  if (legacyLoginState) write(GLOBAL_KEYS.loginState, legacyLoginState);
}

// ── Boot + load current user ────────────────────────────────
migrateLegacyIfNeeded();

const _global = {
  coachAuth:  read(GLOBAL_KEYS.coachAuth,  SEED.coachAuth),
  loginState: read(GLOBAL_KEYS.loginState, SEED.loginState),
};

let _currentUserId = getCurrentUserId();
if (!_currentUserId) {
  const idx = readUsersIndex();
  if (idx[0]?.id) {
    _currentUserId = normHandle(idx[0].id);
    setCurrentUserId(_currentUserId);
  }
}

let _user = _currentUserId ? readUserState(_currentUserId) : null;

// ── Event bus ──────────────────────────────────────────────
const _listeners = {};
function _emit(event, data) {
  (_listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.warn("State event error:", e); } });
}

function _persistGlobal() {
  write(GLOBAL_KEYS.coachAuth, _global.coachAuth);
  write(GLOBAL_KEYS.loginState, _global.loginState);
}

// ── Rating history helpers ──────────────────────────────────
function _monthKey(label) {
  const s = String(label || "").trim();
  if (!s) return "";
  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) {
    return `${d1.getUTCFullYear()}-${String(d1.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const d2 = new Date(`${s} ${new Date().getFullYear()}`);
  if (!isNaN(d2.getTime())) {
    return `${d2.getUTCFullYear()}-${String(d2.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return s.toLowerCase();
}

function _normalizeHistory(history) {
  const arr = Array.isArray(history) ? history : [];
  return arr
    .map(h => ({ month: String(h?.month || "").trim(), rating: Number(h?.rating) }))
    .filter(h => h.month && Number.isFinite(h.rating))
    .map(h => ({ ...h, _k: _monthKey(h.month) }))
    .filter(h => h._k)
    .sort((a, b) => a._k.localeCompare(b._k));
}

function _mergeHistoryKeepLive({ live, seed, maxPoints = 12 } = {}) {
  const liveN = _normalizeHistory(live);
  const seedN = _normalizeHistory(seed);
  const map = new Map();
  seedN.forEach(h => map.set(h._k, { month: h.month, rating: h.rating }));
  liveN.forEach(h => map.set(h._k, { month: h.month, rating: h.rating }));
  const merged = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);
  return merged.slice(Math.max(0, merged.length - maxPoints));
}

// ── Game dedupe helper ──────────────────────────────────────
function _gameKey(g) {
  const id = String(g?.id || "").trim();
  if (id) return id;
  const p = String(g?.pgn || "").trim();
  const d = String(g?.date || "").trim();
  const o = String(g?.opp || "").trim();
  return `${d}::${o}::${p.slice(0, 80)}`;
}

export const State = {
  get() {
    const idx = readUsersIndex();
    const current = _currentUserId ? idx.find(u => normHandle(u.id) === normHandle(_currentUserId)) || null : null;
    return {
      // per-user
      ...(_user || defaultUserStateFromSeed()),
      // global/session
      coachAuth: _global.coachAuth,
      loginState: _global.loginState,
      // multi-user helpers
      currentUser: current,
      currentUserId: _currentUserId || "",
      users: idx,
    };
  },

  on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  },

  listUsers() {
    return readUsersIndex();
  },

  getUserSummary(id) {
    const uid = normHandle(id);
    if (!uid) return null;
    const u = readUserState(uid);
    return {
      id: uid,
      profile: u.profile || {},
      lastSync: u.lastSync || null,
      platformRatings: u.platformRatings || {},
    };
  },

  ensureUser({ chesscom, lichess = "", fullName = "" } = {}) {
    const id = deriveUserId({ chesscom, lichess });
    if (!id) return { ok: false, reason: "missing_id" };

    const existing = readUserState(id);
    existing.profile = {
      ...existing.profile,
      id,
      chesscom: String(chesscom || "").trim(),
      lichess:  String(lichess  || "").trim(),
      fullName: String(fullName || "").trim() || existing.profile.fullName || "",
    };
    writeUserState(id, existing);
    upsertUserIndex({
      id,
      chesscom: existing.profile.chesscom,
      lichess: existing.profile.lichess,
      fullName: existing.profile.fullName,
      lastActiveAt: nowIso(),
    });
    return { ok: true, id };
  },

  switchUser(id) {
    const nextId = normHandle(id);
    if (!nextId) return { ok: false };
    _currentUserId = nextId;
    setCurrentUserId(nextId);
    _user = readUserState(nextId);
    upsertUserIndex({
      id: nextId,
      chesscom: _user.profile?.chesscom || "",
      lichess:  _user.profile?.lichess  || "",
      fullName: _user.profile?.fullName || "",
      lastActiveAt: nowIso(),
    });
    _emit("userChanged", nextId);
    _emit("profileChanged", _user.profile);
    _emit("gamesChanged", _user.games);
    _emit("tournamentsChanged", _user.tournaments);
    _emit("assignmentsChanged", _user.assignments);
    _emit("coachFeedbackAdded", null);
    _emit("ratingHistoryChanged", { history: _user.ratingHistory, meta: _user.ratingHistoryMeta });
    return { ok: true, id: nextId };
  },

  updateProfile(patch) {
    if (!_user) return;
    _user.profile = { ..._user.profile, ...patch };
    writeUserState(_currentUserId, _user);
    upsertUserIndex({
      id: _currentUserId,
      chesscom: _user.profile?.chesscom || "",
      lichess:  _user.profile?.lichess  || "",
      fullName: _user.profile?.fullName || "",
      lastActiveAt: nowIso(),
    });
    _emit("profileChanged", _user.profile);
  },

  setGames(games) {
    if (!_user) return;
    _user.games = games;
    writeUserState(_currentUserId, _user);
    _emit("gamesChanged", games);
  },

  prependGames(games) {
    if (!_user) return;
    const existing = _user.games.filter(g => g.source === "seed");
    const merged = [...games, ...existing];
    const seen = new Set();
    _user.games = merged.filter(g => seen.has(g.id) ? false : seen.add(g.id));
    writeUserState(_currentUserId, _user);
    _emit("gamesChanged", _user.games);
  },

  mergeGames(games) {
    if (!_user) return;
    const incoming = Array.isArray(games) ? games : [];
    const existing = Array.isArray(_user.games) ? _user.games : [];
    const merged = [...incoming, ...existing];
    const seen = new Set();
    _user.games = merged.filter(g => {
      const k = _gameKey(g);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    writeUserState(_currentUserId, _user);
    _emit("gamesChanged", _user.games);
  },

  setTournaments(tournaments) {
    if (!_user) return;
    _user.tournaments = tournaments;
    writeUserState(_currentUserId, _user);
    _emit("tournamentsChanged", tournaments);
  },

  setCoachAuth(auth) {
    _global.coachAuth = { ..._global.coachAuth, ...auth };
    _persistGlobal();
    _emit("coachAuthChanged", _global.coachAuth);
  },

  addCoachFeedback(item) {
    if (!_user) return;
    _user.coachFeedback.unshift(item);
    writeUserState(_currentUserId, _user);
    _emit("coachFeedbackAdded", item);
  },

  setTrainingFocus(focus) {
    if (!_user) return;
    _user.trainingFocus = focus;
    writeUserState(_currentUserId, _user);
    _emit("trainingFocusChanged", focus);
  },

  addAssignment(item) {
    if (!_user) return;
    _user.assignments.unshift(item);
    writeUserState(_currentUserId, _user);
    _emit("assignmentsChanged", _user.assignments);
  },

  updateAssignment(id, patch) {
    if (!_user) return;
    const idx = _user.assignments.findIndex(a => a.id === id);
    if (idx < 0) return;
    _user.assignments[idx] = { ..._user.assignments[idx], ...patch };
    writeUserState(_currentUserId, _user);
    _emit("assignmentsChanged", _user.assignments);
  },

  setPlatformRatings(ratings) {
    if (!_user) return;
    _user.platformRatings = ratings;
    writeUserState(_currentUserId, _user);
    _emit("platformRatingsUpdated", ratings);
  },

  setRatingHistory(history, meta = {}) {
    if (!_user) return;
    const live = Array.isArray(history) ? history : [];
    const seed = SEED.ratingHistory;
    const hasLive = _normalizeHistory(live).length > 0;

    _user.ratingHistory = hasLive
      ? _mergeHistoryKeepLive({ live, seed, maxPoints: 12 })
      : _mergeHistoryKeepLive({ live: [], seed, maxPoints: 12 });

    _user.ratingHistoryMeta = {
      ...(_user.ratingHistoryMeta || SEED.ratingHistoryMeta),
      source: hasLive ? (meta.source || "lichess") : "seed",
      mode: meta.mode || (hasLive ? "live" : "seed"),
      updatedAt: hasLive ? new Date().toISOString() : (_user.ratingHistoryMeta?.updatedAt || null),
    };
    writeUserState(_currentUserId, _user);
    _emit("ratingHistoryChanged", { history: _user.ratingHistory, meta: _user.ratingHistoryMeta });
  },

  setLastSync(ts) {
    if (!_user) return;
    _user.lastSync = ts;
    writeUserState(_currentUserId, _user);
  },

  setLoginState(patch) {
    _global.loginState = { ..._global.loginState, ...patch };
    _persistGlobal();
    _emit("loginStateChanged", _global.loginState);
  },

  incrementStreak() {
    if (!_user) return;
    _user.streak += 1;
    writeUserState(_currentUserId, _user);
    _emit("streakChanged", _user.streak);
  },

  applyPuzzleResult(correct, difficulty) {
    if (!_user) return { ...SEED.puzzle, delta: 0 };
    const d = { Beginner: 0.8, Intermediate: 1.0, Hard: 1.15, Expert: 1.3 };
    const k = Math.round(20 * (d[difficulty] || 1));
    const expected = 1 / (1 + Math.pow(10, (1600 - _user.puzzle.rating) / 400));
    const score = correct ? 1 : 0;
    const delta = Math.round(k * (score - expected));
    _user.puzzle.rating = Math.max(800, Math.min(2800, _user.puzzle.rating + delta));
    _user.puzzle.streak = correct ? _user.puzzle.streak + 1 : 0;
    if (correct) {
      _user.puzzle.solvedToday += 1;
      _user.puzzle.totalSolved = (_user.puzzle.totalSolved || 0) + 1;
    }
    _user.puzzle.difficulty = difficulty;
    writeUserState(_currentUserId, _user);
    _emit("puzzleResult", { correct, delta, puzzle: _user.puzzle });
    return { ..._user.puzzle, delta };
  },

  // ── Data export: downloads a JSON backup of all users ────
  // Returns a JSON blob of all user data for download.
  // Safe to call at any time — does not mutate any state.
  exportAll() {
    const idx = readUsersIndex();
    const users = idx.map(u => ({ id: u.id, state: readUserState(u.id) }));
    const blob = { exportedAt: new Date().toISOString(), version: "v4", users };
    const str = JSON.stringify(blob, null, 2);
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([str], { type: "application/json" }));
    el.download = `chess-academy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 5000);
  },

  // ── Data import: restores an exported backup ─────────────
  // Validates structure before writing. Returns { ok, error }.
  importAll(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return { ok: false, error: "Invalid JSON — file could not be parsed." };
    }

    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "Backup file is not a valid object." };
    }
    if (parsed.version !== "v4") {
      return { ok: false, error: `Unsupported backup version: "${parsed.version}". Expected "v4".` };
    }
    if (!Array.isArray(parsed.users) || !parsed.users.length) {
      return { ok: false, error: "Backup contains no users." };
    }

    // Validate each user has a profile before writing anything
    for (const u of parsed.users) {
      if (!u.id || typeof u.id !== "string") {
        return { ok: false, error: `User entry missing valid id.` };
      }
      if (!u.state || !u.state.profile) {
        return { ok: false, error: `User "${u.id}" is missing a profile.` };
      }
    }

    // All valid — write each user blob and update the index
    for (const u of parsed.users) {
      writeUserState(u.id, u.state);
      upsertUserIndex({
        id: u.id,
        chesscom: u.state.profile?.chesscom || "",
        lichess:  u.state.profile?.lichess  || "",
        fullName: u.state.profile?.fullName || "",
        lastActiveAt: nowIso(),
      });
    }

    // Switch to the first imported user if no current user
    if (!_currentUserId && parsed.users[0]?.id) {
      _currentUserId = normHandle(parsed.users[0].id);
      setCurrentUserId(_currentUserId);
      _user = readUserState(_currentUserId);
    } else if (_currentUserId) {
      // Reload current user in case their data was updated
      _user = readUserState(_currentUserId);
    }

    _emit("userChanged", _currentUserId);
    _emit("profileChanged", _user?.profile);
    _emit("gamesChanged", _user?.games);

    return { ok: true, count: parsed.users.length };
  },

  resetAll() {
    // ⚠️ Developer warning: all user data is about to be deleted.
    // Call State.exportAll() first if you need to preserve data.
    console.warn("State.resetAll() called — all data will be lost. Use exportAll() first to back up your data.");

    const idx = readUsersIndex();
    idx.forEach(u => del(userKey(u.id)));
    del(GLOBAL_KEYS.usersIndex);
    del(GLOBAL_KEYS.currentUserId);
    del(GLOBAL_KEYS.coachAuth);
    del(GLOBAL_KEYS.loginState);

    _currentUserId = "";
    _user = null;
    _global.coachAuth = deepClone(SEED.coachAuth);
    _global.loginState = deepClone(SEED.loginState);

    _emit("reset", null);
  },
};
