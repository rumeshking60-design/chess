"use strict";
// ═══════════════════════════════════════════════════════════
// AI.JS — Chess Academy AI Coach Engine
// ─────────────────────────────────────────────────────────
// Free-first approach (2026 best options):
//
//  TIER 1 — Free w/ API key (recommended):
//   • Google Gemini 2.0 Flash (generous free tier, fast)
//     https://aistudio.google.com/app/apikey
//   • OpenRouter free models (meta-llama/llama-3.3-70b-instruct:free)
//     https://openrouter.ai/  → Create account → API Keys
//   • Groq (llama-3.3-70b, very fast free tier)
//     https://console.groq.com/
//
//  TIER 2 — Self-hosted proxy (private API key):
//   • Set PROXY_URL in proxy.js to your Cloudflare Worker / Vercel endpoint
//   • Use claude-sonnet-4-20250514 via Anthropic for best chess coaching
//
//  TIER 3 — Smart local fallback (always works, no key needed):
//   • Rule-based responses built from game data, weaknesses, etc.
//   • Covers 80% of common coaching questions reliably
//
// Configuration: Set AI_CONFIG below or call AI.configure({...}) at runtime.
// ═══════════════════════════════════════════════════════════

import { Coach } from "./coach.js";
import { State }  from "./state.js";
import { PROXY_URL, AI_MODEL } from "./proxy.js";

// ── Runtime configuration (editable by user via Settings) ──
export const AI_CONFIG = {
  // --- Preferred provider (try in order) ---
  // "proxy"    → uses PROXY_URL from proxy.js (Anthropic / any Claude model)
  // "openrouter" → free tier via OpenRouter (requires OPENROUTER_KEY)
  // "gemini"   → Google Gemini free tier (requires GEMINI_KEY)
  // "groq"     → Groq free tier (requires GROQ_KEY)
  // "local"    → always use smart local fallback (no key needed)
  provider: "openrouter",

  // --- API keys (store here at runtime OR inject from Settings UI) ---
  openrouterKey: "",   // from localStorage if set
  geminiKey:     "",
  groqKey:       "",

  // --- Model overrides ---
  openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
  geminiModel:     "gemini-2.0-flash",
  groqModel:       "llama-3.3-70b-versatile",

  // --- Rate limiting ---
  maxPerMinute: 10,
  _calls: [],

  // --- Chat history storage key ---
  storageKeyPrefix: "ai_chat_history_",
};

// Load persisted keys from localStorage
(function loadPersistedKeys() {
  try {
    const or = localStorage.getItem("ai_openrouter_key");
    const gm = localStorage.getItem("ai_gemini_key");
    const gq = localStorage.getItem("ai_groq_key");
    const pv = localStorage.getItem("ai_provider");
    if (or) AI_CONFIG.openrouterKey = or;
    if (gm) AI_CONFIG.geminiKey     = gm;
    if (gq) AI_CONFIG.groqKey       = gq;
    if (pv) AI_CONFIG.provider      = pv;
  } catch {}
})();

// ── Rate limiter ────────────────────────────────────────────
function checkRateLimit() {
  const now = Date.now();
  AI_CONFIG._calls = AI_CONFIG._calls.filter(t => now - t < 60000);
  if (AI_CONFIG._calls.length >= AI_CONFIG.maxPerMinute) return false;
  AI_CONFIG._calls.push(now);
  return true;
}

// ── Build rich system prompt from current user state ────────
export function buildSystemPrompt() {
  const { profile: p, games, ratingHistory, trainingFocus, coachFeedback, streak, platformRatings } = State.get();

  const totalGames = games.length;
  const wins       = games.filter(g => g.result === "win").length;
  const losses     = games.filter(g => g.result === "loss").length;
  const draws      = games.filter(g => g.result === "draw").length;
  const winRate    = totalGames ? Math.round((wins / totalGames) * 100) : 0;

  const avgAcc     = totalGames
    ? Math.round(games.reduce((s, g) => s + (g.accuracy || 80), 0) / totalGames)
    : null;
  const avgBlunders = totalGames
    ? (games.reduce((s, g) => s + (g.blunders || 0), 0) / totalGames).toFixed(1)
    : null;

  const recentGames = games.slice(0, 5).map((g, i) => {
    const acc   = g.accuracy != null ? `${g.accuracy}% acc` : "no acc data";
    const delta = g.delta ? ` (${g.delta} rating)` : "";
    return `  ${i + 1}. ${g.result.toUpperCase()} vs ${g.opp} (${g.oppRating || "?"})${delta} — ${g.opening} — ${acc} — ${g.moves} moves`;
  }).join("\n") || "  No recent games synced yet.";

  const weaknesses = Coach.analyzeWeaknesses(games)
    .map(w => `  • ${w.label}: ${w.detail}`).join("\n") || "  • Not enough games to determine weaknesses yet.";

  const ccRatings = platformRatings?.chesscom
    ? Object.entries(platformRatings.chesscom).filter(([, v]) => v).map(([k, v]) => `Chess.com ${k}: ${v}`).join(", ")
    : null;
  const liRatings = platformRatings?.lichess
    ? Object.entries(platformRatings.lichess).filter(([, v]) => v).map(([k, v]) => `Lichess ${k}: ${v}`).join(", ")
    : null;
  const ratingBreakdown = [ccRatings, liRatings].filter(Boolean).join(" | ") || "No platform ratings fetched yet.";

  const ratingTrend = ratingHistory.length >= 2
    ? (() => {
        const first = ratingHistory[0].rating;
        const last  = ratingHistory[ratingHistory.length - 1].rating;
        const diff  = last - first;
        return `${diff >= 0 ? "+" : ""}${diff} over ${ratingHistory.length} months (${first} → ${last})`;
      })()
    : "Not enough history.";

  const focus      = trainingFocus.join(", ") || "Not specified";
  const coachNotes = coachFeedback.slice(0, 3)
    .map(f => `  [${f.category}] ${f.comment.slice(0, 120)}`).join("\n") || "  None.";

  // Opening analysis — most played
  const openingCounts = {};
  games.forEach(g => { openingCounts[g.opening] = (openingCounts[g.opening] || 0) + 1; });
  const topOpenings = Object.entries(openingCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => `${name} (${n}x)`).join(", ") || "Unknown";

  return `You are an elite chess coach named "Coach Anand" (inspired by Viswanathan Anand's teaching style) working one-on-one with a student. You are approximately 2200-2400 Elo strength.

═══ STUDENT PROFILE ═══
Name: ${p.fullName || "Student"}
Location: ${p.location || "India"}
Category: ${p.category || "Club Player"}
Overall Rating: ${p.rating}
Rating Breakdown: ${ratingBreakdown}
Rating Trend: ${ratingTrend}
Training Streak: ${streak} day(s)
Chess.com: ${p.chesscom || "not linked"}
Lichess: ${p.lichess || "not linked"}

═══ RECENT PERFORMANCE (last ${totalGames} games) ═══
W/L/D: ${wins}/${losses}/${draws} (${winRate}% win rate)
Avg Accuracy: ${avgAcc != null ? avgAcc + "%" : "N/A"}
Avg Blunders/game: ${avgBlunders || "N/A"}
Top Openings: ${topOpenings}

Recent Games:
${recentGames}

═══ IDENTIFIED WEAKNESSES ═══
${weaknesses}

═══ TRAINING FOCUS ═══
${focus}

═══ COACH NOTES ON FILE ═══
${coachNotes}

═══ YOUR COACHING APPROACH ═══
1. PERSONALIZE everything to this specific student's rating, games, and weaknesses above.
2. Be PRACTICAL — give concrete moves, positions, opening lines, specific exercises.
3. Use PROPER CHESS NOTATION (e.g., 1.e4 e5 2.Nf3 Nc6) when discussing positions.
4. Be ENCOURAGING but HONEST — celebrate wins, address losses constructively.
5. ADAPT your language to their level: ${p.rating < 1200 ? "beginner — use simple terms" : p.rating < 1600 ? "intermediate — introduce strategy concepts" : p.rating < 1900 ? "advanced — discuss positional subtleties" : "expert — speak at high level"}.
6. Give SPECIFIC TRAINING RECOMMENDATIONS: books, puzzle types, time controls, study methods.
7. When analyzing games, focus on the CRITICAL MOMENT (turning point) not every move.
8. Use the SOCRATIC METHOD occasionally — ask what they were thinking in critical positions.
9. Keep responses CONCISE and ACTIONABLE — 3-6 sentences unless a detailed explanation is needed.
10. Always end with ONE clear next action the student should take today.

Famous training resources you may recommend:
- Puzzles: Lichess puzzles (lichess.org/puzzles), Chess.com puzzles
- Books: "Silman's Complete Endgame Course", "How to Reassess Your Chess", "Chess Fundamentals" (Capablanca)
- Video: Chessable courses, Daniel Naroditsky's "Speed Run" on Twitch/YouTube
- Tools: Stockfish analysis, Lichess study feature

IMPORTANT: Never fabricate game moves or positions you haven't been given. If asked about a specific game, use only the data provided in the student's game history above. If you don't have enough data, say so honestly and give general guidance.`;
}

// ── Smart local fallback responses ──────────────────────────
const LOCAL_RESPONSES = {
  opening: (p, games, weaknesses) => {
    const openingCounts = {};
    games.forEach(g => { openingCounts[g.opening] = (openingCounts[g.opening] || 0) + 1; });
    const top = Object.entries(openingCounts).sort((a, b) => b[1] - a[1])[0];
    const weak = weaknesses.find(w => w.label?.toLowerCase().includes("opening"));
    return [
      `${p.fullName}, let's talk openings! Your most-played is **${top ? top[0] : "a variety of openings"}**.`,
      weak ? `I notice ${weak.detail} — this is worth addressing directly.` : "",
      p.rating < 1400
        ? `At your rating, focus on these principles: control the center with pawns (1.e4 or 1.d4), develop your knights before bishops, castle early for king safety, and don't move the same piece twice unless necessary.`
        : p.rating < 1700
        ? `Build a small but solid repertoire: 1-2 openings as White, 1 solid response to e4 and d4. Study the first 10-12 moves deeply. Master the IDEAS behind each opening, not just memorizing moves.`
        : `At ${p.rating}, your opening prep should reach move 15-20 in your main lines. Study theoretical novelties and understand transpositions. Use Chessable for spaced-repetition opening study.`,
      `**Action today:** Pick ONE opening and study its core ideas for 20 minutes on Lichess. Focus on understanding, not memorization.`,
    ].filter(Boolean).join(" ");
  },

  endgame: (p, games) => {
    const essentials = p.rating < 1400
      ? "king + queen vs king, king + rook vs king, and basic king + pawn vs king positions"
      : p.rating < 1700
      ? "all basic pawn endgames, rook endgames (Lucena and Philidor positions), and bishop vs knight endings"
      : "rook + pawn vs rook, complex pawn structures, and king activity in the endgame";
    return [
      `Endgame mastery is where ratings grow fastest — games are won and lost here! For your current level (${p.rating}), master ${essentials}.`,
      `The most important principle: **Activate your king immediately** in the endgame. Most club players keep their king passive and it costs them half-points.`,
      `**Specific drill:** Set up a K+P vs K position and practice converting with the stronger side, then defending with the weaker side. Do this 10 times a day for a week.`,
      `Book recommendation: **"Silman's Complete Endgame Course"** — organized by rating level, so jump straight to your chapter. This alone can gain you 50-100 rating points.`,
    ].join(" ");
  },

  tactics: (p, games) => {
    const avgBlunders = games.length
      ? (games.reduce((s, g) => s + (g.blunders || 0), 0) / games.length).toFixed(1) : "unknown";
    return [
      `Tactics are the foundation of chess — everything else builds on them! You're averaging **${avgBlunders} blunders/game**, which tells me there's real rating to gain here.`,
      `At ${p.rating}, focus on these patterns in order: **forks, pins, skewers, discovered attacks, back-rank weaknesses, and removing the defender**.`,
      `**Proven training method (Zimin System):** Solve 5-10 puzzles daily at YOUR level — don't skip ahead. Quality beats quantity. Review wrong answers for 2 minutes each.`,
      `Use Lichess Puzzles (free, excellent quality) and filter by theme to systematically cover each tactic type. Aim for 85%+ accuracy, not speed.`,
      `**Action today:** Solve 10 Lichess puzzles. If you get one wrong, set up the position on a board and understand exactly why the solution works before moving on.`,
    ].join(" ");
  },

  strategy: (p, games) => {
    return [
      `Strategy is about making plans. The fundamental question after every move: **"What is my opponent threatening? What is my plan?"**`,
      p.rating < 1500
        ? `At your level, master these concepts first: 1) Identify and attack weak pawns, 2) Place your pieces on their best squares (outposts for knights!), 3) Create and convert passed pawns.`
        : `At ${p.rating}, study **prophylaxis** (preventing opponent's plans), **weak square complexes**, and **pawn structure transformations**. Nimzowitch's "My System" is the Bible for this.`,
      `**Practical tip:** After each game, ask yourself: "What was the key strategic moment? Did I have a plan, or was I just reacting?" One honest analysis per day beats 10 blitz games.`,
      `**Action today:** Review one of your recent losses. Find the move where you lost your advantage and ask: what should I have played instead, and why?`,
    ].join(" ");
  },

  lastGame: (p, games) => {
    if (!games.length) return `I don't have any synced games to analyze yet! Sync your Chess.com or Lichess account first, then ask me about a specific game.`;
    const g = games[0];
    const acc = g.accuracy != null ? `You played at **${g.accuracy}% accuracy**` : "Accuracy data wasn't available";
    const blunders = g.blunders != null ? ` with **${g.blunders} blunder(s)**` : "";
    const delta = g.delta ? ` (${g.delta} rating)` : "";
    return [
      `Let's look at your most recent game: **${g.result.toUpperCase()}** vs ${g.opp} (${g.oppRating || "?"})${delta} — ${g.opening}${blunders ? `. ${acc}${blunders}.` : "."}`,
      g.result === "win"
        ? `Good win! Even in victories, look for improvements. ${g.accuracy && g.accuracy < 88 ? `Your ${g.accuracy}% accuracy suggests there were missed opportunities — check where your evaluation dipped in Lichess analysis.` : "Solid game — keep the momentum going."}`
        : g.result === "loss"
        ? `A loss is a lesson in disguise. ${g.blunders ? `The ${g.blunders} blunder(s) likely decided the game — find those moments in Lichess analysis and understand WHY each blunder happened.` : "Analyze where you went from equal to losing — that transition point is the most instructive moment."}`
        : `A draw can mean many things. Did you hold a worse position, or fail to convert a better one? Both are instructive for different reasons.`,
      `**Action:** Open this game in Lichess/Chess.com analysis, find the moment your engine evaluation first dropped significantly, and spend 5 minutes understanding that position.`,
      g.pgn ? `(PGN available — you can paste it into lichess.org/analysis for a full computer review)` : "",
    ].filter(Boolean).join(" ");
  },

  puzzle: (p) => {
    const puzzleRating = Math.max(800, p.rating - 100);
    return [
      `Here's your puzzle prescription for today! 🧩`,
      `Go to **lichess.org/puzzles** right now. Your puzzle rating should be around **${puzzleRating}** — start there and let it calibrate.`,
      `**Rules for effective puzzle training:**`,
      `1️⃣ Don't use hints — struggle for at least 2 minutes before looking at the solution`,
      `2️⃣ For every wrong answer, set up the position and replay it 3 times until it feels natural`,
      `3️⃣ After 10 puzzles, review the ones you got wrong — pattern recognition builds through repetition`,
      `The patterns you should focus on at ${p.rating}: ${p.rating < 1400 ? "forks, pins, and back-rank mates" : p.rating < 1700 ? "discovered attacks, interference, and zugzwang" : "deflection, overloading, and positional sacrifices"}.`,
      `**Action: Solve 10 puzzles right now.** Track your puzzle streak — consistency beats marathon sessions.`,
    ].join("\n");
  },

  motivation: (p, games, streak) => {
    const wins = games.filter(g => g.result === "win").length;
    const winRate = games.length ? Math.round(wins / games.length * 100) : 0;
    return [
      `${p.fullName}, you're on a **${streak}-day training streak** — that's what separates improvers from stagnators. Most players never build consistency like this.`,
      games.length
        ? `Your ${winRate}% win rate across ${games.length} games shows ${winRate >= 55 ? "you're in excellent form — capitalize on it!" : winRate >= 45 ? "steady competitive play — a few key improvements will push you over 55%+" : "some inconsistency — let's find the pattern in your losses."}`
        : `Start syncing your games so I can give you truly personalized coaching based on your actual play.`,
      `At ${p.rating}, you are ${p.rating < 1200 ? "just starting your chess journey — every game teaches something new" : p.rating < 1600 ? "building solid club-level skills — the breakthrough to 1600+ is close" : p.rating < 1900 ? "in the exciting zone where chess becomes deeply strategic — enjoy the depth you're discovering" : "at an advanced level that few players reach — take pride in your work"}.`,
      `**Remember:** Magnus Carlsen played 10,000+ games before reaching his peak. You're investing in a skill that compounds. Keep going! 💪`,
    ].join(" ");
  },

  generic: (p, games, weaknesses) => {
    const weak0 = weaknesses[0];
    const g0 = games[0];
    return [
      `Great question! Let me give you personalized advice based on your current profile.`,
      `At ${p.rating}, your most impactful improvement area right now is: ${weak0 ? `**${weak0.label}** — ${weak0.detail}` : "building consistency by analyzing your games after every loss"}.`,
      g0 ? `Your recent ${g0.result} vs ${g0.opp} in the ${g0.opening} is worth studying — look at the moves around move 20+ where the game was decided.` : "",
      `**My top recommendation for you today:** Spend 15 minutes on tactics puzzles + 10 minutes analyzing one recent game. This 25-minute routine compounds faster than blitz games alone.`,
    ].filter(Boolean).join(" ");
  },
};

// ── Detect intent from user message ─────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (/opening|repertoire|sicilian|french|caro|king.s indian|london|english|ruy lopez|italian/i.test(m)) return "opening";
  if (/endgame|rook ending|pawn ending|king.pawn|promote|promotion/i.test(m)) return "endgame";
  if (/tactic|puzzle|fork|pin|skewer|mate|combination|blunder|hanging/i.test(m)) return "tactics";
  if (/strategy|plan|weak|pawn structure|outpost|positional|prophylaxis/i.test(m)) return "strategy";
  if (/last game|recent game|my game|analyze|review/i.test(m)) return "lastGame";
  if (/give me a puzzle|puzzle me|train me|daily puzzle/i.test(m)) return "puzzle";
  if (/motivat|discourage|lose|losing streak|frustrated|give up|hard|difficult/i.test(m)) return "motivation";
  return "generic";
}

// ── Smart local responder ────────────────────────────────────
function localFallback(userMsg) {
  const { profile: p, games, streak } = State.get();
  const weaknesses = Coach.analyzeWeaknesses(games);
  const intent = detectIntent(userMsg);

  const handlers = {
    opening:    () => LOCAL_RESPONSES.opening(p, games, weaknesses),
    endgame:    () => LOCAL_RESPONSES.endgame(p, games),
    tactics:    () => LOCAL_RESPONSES.tactics(p, games),
    strategy:   () => LOCAL_RESPONSES.strategy(p, games),
    lastGame:   () => LOCAL_RESPONSES.lastGame(p, games),
    puzzle:     () => LOCAL_RESPONSES.puzzle(p),
    motivation: () => LOCAL_RESPONSES.motivation(p, games, streak),
    generic:    () => LOCAL_RESPONSES.generic(p, games, weaknesses),
  };

  const response = handlers[intent]?.() || handlers.generic();
  return `${response}\n\n_⚠️ AI Coach is running in offline mode. [Set up a free API key](#setup-ai) for full AI-powered coaching._`;
}

// ── Provider: Anthropic proxy ────────────────────────────────
async function queryProxy(messages, systemPrompt) {
  if (!PROXY_URL) throw new Error("No PROXY_URL configured");
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

// ── Provider: OpenRouter (free models) ──────────────────────
async function queryOpenRouter(messages, systemPrompt) {
  const key = AI_CONFIG.openrouterKey;
  if (!key) throw new Error("No OpenRouter key");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": location.origin,
      "X-Title": "Chess Academy AI Coach",
    },
    body: JSON.stringify({
      model: AI_CONFIG.openrouterModel,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter ${res.status}: ${err?.error?.message || ""}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Provider: Google Gemini ──────────────────────────────────
async function queryGemini(messages, systemPrompt) {
  const key = AI_CONFIG.geminiKey;
  if (!key) throw new Error("No Gemini key");
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_CONFIG.geminiModel}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 800 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ── Provider: Groq (llama, very fast) ───────────────────────
async function queryGroq(messages, systemPrompt) {
  const key = AI_CONFIG.groqKey;
  if (!key) throw new Error("No Groq key");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: AI_CONFIG.groqModel,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Chat history persistence ─────────────────────────────────
export const ChatHistory = {
  _key() {
    try {
      const id = State.get().currentUserId || "default";
      return `${AI_CONFIG.storageKeyPrefix}${id}`;
    } catch { return `${AI_CONFIG.storageKeyPrefix}default`; }
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key());
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  save(history) {
    try {
      // Keep last 40 messages to avoid unbounded growth
      const trimmed = history.slice(-40);
      localStorage.setItem(this._key(), JSON.stringify(trimmed));
    } catch {}
  },

  clear() {
    try { localStorage.removeItem(this._key()); } catch {}
  },

  export(history) {
    const lines = history.map(h =>
      `[${h.role.toUpperCase()}]\n${h.content}\n`
    ).join("\n---\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chess-coach-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};

// ── Public API ───────────────────────────────────────────────
export const AI = {
  configure(opts = {}) {
    Object.assign(AI_CONFIG, opts);
    try {
      if (opts.openrouterKey) localStorage.setItem("ai_openrouter_key", opts.openrouterKey);
      if (opts.geminiKey)     localStorage.setItem("ai_gemini_key",     opts.geminiKey);
      if (opts.groqKey)       localStorage.setItem("ai_groq_key",       opts.groqKey);
      if (opts.provider)      localStorage.setItem("ai_provider",       opts.provider);
    } catch {}
  },

  hasApiKey() {
    return !!(
      (AI_CONFIG.provider === "proxy"       && PROXY_URL) ||
      (AI_CONFIG.provider === "openrouter"  && AI_CONFIG.openrouterKey) ||
      (AI_CONFIG.provider === "gemini"      && AI_CONFIG.geminiKey) ||
      (AI_CONFIG.provider === "groq"        && AI_CONFIG.groqKey)
    );
  },

  getProviderLabel() {
    if (AI_CONFIG.provider === "proxy" && PROXY_URL) return "Anthropic (proxy)";
    if (AI_CONFIG.provider === "openrouter" && AI_CONFIG.openrouterKey) return `OpenRouter (${AI_CONFIG.openrouterModel.split("/").pop()})`;
    if (AI_CONFIG.provider === "gemini" && AI_CONFIG.geminiKey) return `Google Gemini`;
    if (AI_CONFIG.provider === "groq" && AI_CONFIG.groqKey) return `Groq (${AI_CONFIG.groqModel})`;
    return "Local (offline mode)";
  },

  async getResponse(userMsg, history = []) {
    if (!checkRateLimit()) {
      return "⏳ You're sending messages too quickly! Please wait a moment before trying again.";
    }

    const systemPrompt = buildSystemPrompt();
    const messages = history
      .slice(-10)
      .filter(h => h.content)
      .map(h => ({ role: h.role, content: h.content }));
    messages.push({ role: "user", content: userMsg });

    // Try providers in order
    const providers = [
      AI_CONFIG.provider === "proxy"       && PROXY_URL                 && (() => queryProxy(messages, systemPrompt)),
      AI_CONFIG.provider === "openrouter"  && AI_CONFIG.openrouterKey   && (() => queryOpenRouter(messages, systemPrompt)),
      AI_CONFIG.provider === "gemini"      && AI_CONFIG.geminiKey        && (() => queryGemini(messages, systemPrompt)),
      AI_CONFIG.provider === "groq"        && AI_CONFIG.groqKey          && (() => queryGroq(messages, systemPrompt)),
    ].filter(Boolean);

    for (const attempt of providers) {
      try {
        const text = await attempt();
        if (text && text.trim()) return text.trim();
      } catch (err) {
        console.warn("AI provider failed:", err.message);
      }
    }

    // All providers failed or none configured → smart local fallback
    return localFallback(userMsg);
  },
};
