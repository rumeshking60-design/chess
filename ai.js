"use strict";
// ═══════════════════════════════════════════════════════════
// ai.js — Chess Academy AI Coach Engine
// ─────────────────────────────────────────────────────────
// Provider priority (configured at runtime or via Settings):
//
//  "proxy"      → Anthropic Claude via PROXY_URL (best quality)
//  "openrouter" → Free Llama 3.3 70B via openrouter.ai
//  "gemini"     → Google Gemini 2.0 Flash (generous free tier)
//  "groq"       → Groq Llama 3.3 70B (ultra-fast free tier)
//  "local"      → Smart offline fallback (no key required)
//
// Setup: call AI.configure({provider, openrouterKey, …}) or
// point the user to the in-app AI Setup modal.
// ═══════════════════════════════════════════════════════════

import { Coach } from "./coach.js";
import { State }  from "./state.js";
import { PROXY_URL, AI_MODEL } from "./proxy.js";

// ── Configuration ────────────────────────────────────────────
export const AI_CONFIG = {
  provider:        "openrouter",
  openrouterKey:   "",
  geminiKey:       "",
  groqKey:         "",
  openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
  geminiModel:     "gemini-2.0-flash",
  groqModel:       "llama-3.3-70b-versatile",
  maxPerMinute:    10,
  storageKeyPrefix:"ai_chat_history_",
  _calls:          [],
};

// Restore persisted keys / provider choice from localStorage
(function restoreConfig() {
  const keys = {
    ai_openrouter_key: "openrouterKey",
    ai_gemini_key:     "geminiKey",
    ai_groq_key:       "groqKey",
    ai_provider:       "provider",
  };
  try {
    for (const [lsKey, cfgKey] of Object.entries(keys)) {
      const v = localStorage.getItem(lsKey);
      if (v) AI_CONFIG[cfgKey] = v;
    }
  } catch { /* storage unavailable */ }
})();

// ── Rate limiter ─────────────────────────────────────────────
function checkRateLimit() {
  const now = Date.now();
  AI_CONFIG._calls = AI_CONFIG._calls.filter(t => now - t < 60_000);
  if (AI_CONFIG._calls.length >= AI_CONFIG.maxPerMinute) return false;
  AI_CONFIG._calls.push(now);
  return true;
}

// ── System-prompt builder ────────────────────────────────────
export function buildSystemPrompt() {
  const st = State.get();
  const { profile: p, games, ratingHistory: rh, trainingFocus,
          coachFeedback, streak, platformRatings } = st;

  // ── Stats summary ────────────────────────────────────────
  const total    = games.length || 1;
  const wins     = games.filter(g => g.result === "win").length;
  const losses   = games.filter(g => g.result === "loss").length;
  const draws    = games.filter(g => g.result === "draw").length;
  const winRate  = Math.round((wins / total) * 100);
  const avgAcc   = Math.round(games.reduce((s, g) => s + (g.accuracy ?? 80), 0) / total);
  const avgBlund = (games.reduce((s, g) => s + (g.blunders ?? 0), 0) / total).toFixed(1);

  // ── Recent games (last 5) ────────────────────────────────
  const recentGames = games.slice(0, 5).map((g, i) => {
    const acc   = g.accuracy != null ? `${g.accuracy}% acc` : "no acc";
    const delta = g.delta ? ` (${g.delta > 0 ? "+" : ""}${g.delta} pts)` : "";
    return `  ${i + 1}. ${g.result.toUpperCase()} vs ${g.opp} (${g.oppRating ?? "?"})`
         + `${delta} — ${g.opening} — ${acc} — ${g.moves}mv`;
  }).join("\n") || "  No games synced yet.";

  // ── Top openings ──────────────────────────────────────────
  const opCounts = {};
  games.forEach(g => { opCounts[g.opening] = (opCounts[g.opening] || 0) + 1; });
  const topOpenings = Object.entries(opCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => `${name} (${n}×)`).join(", ") || "Unknown";

  // ── Rating breakdown by platform ─────────────────────────
  const ccStr = platformRatings?.chesscom
    ? Object.entries(platformRatings.chesscom).filter(([, v]) => v)
        .map(([k, v]) => `Chess.com ${k}: ${v}`).join(", ")
    : null;
  const liStr = platformRatings?.lichess
    ? Object.entries(platformRatings.lichess).filter(([, v]) => v)
        .map(([k, v]) => `Lichess ${k}: ${v}`).join(", ")
    : null;
  const ratingBreakdown = [ccStr, liStr].filter(Boolean).join(" | ") || "No platform ratings yet.";

  // ── Rating trend ──────────────────────────────────────────
  const ratingTrend = rh.length >= 2
    ? (() => {
        const diff = rh.at(-1).rating - rh[0].rating;
        return `${diff >= 0 ? "+" : ""}${diff} over ${rh.length} months (${rh[0].rating} → ${rh.at(-1).rating})`;
      })()
    : "Insufficient history.";

  // ── Weaknesses + coach notes ──────────────────────────────
  const weaknesses = Coach.analyzeWeaknesses(games)
    .map(w => `  • ${w.label}: ${w.detail}`).join("\n")
    || "  • Not enough games to determine weaknesses yet.";

  const coachNotes = coachFeedback.slice(0, 3)
    .map(f => `  [${f.category}] ${f.comment.slice(0, 120)}`).join("\n")
    || "  None.";

  // ── Coaching language level ───────────────────────────────
  const levelHint = p.rating < 1200 ? "beginner — use simple terms and reassuring language"
    : p.rating < 1600                ? "intermediate — introduce strategic concepts gradually"
    : p.rating < 1900                ? "advanced — discuss positional subtleties freely"
    :                                  "expert — speak at a high theoretical level";

  return `You are "Coach Anand", an elite personal chess coach (≈2200–2400 Elo, inspired by Viswanathan Anand's teaching philosophy).

═══ STUDENT PROFILE ═══
Name: ${p.fullName || "Student"}
Location: ${p.location || "India"}
Category: ${p.category || "Club Player"}
Overall Rating: ${p.rating}  |  Streak: ${streak} day(s)
Rating Breakdown: ${ratingBreakdown}
Rating Trend: ${ratingTrend}
Chess.com: ${p.chesscom || "not linked"}  |  Lichess: ${p.lichess || "not linked"}

═══ RECENT PERFORMANCE (last ${games.length} games) ═══
W/L/D: ${wins}/${losses}/${draws} (${winRate}% win rate)
Avg Accuracy: ${games.length ? avgAcc + "%" : "N/A"}  |  Avg Blunders/game: ${games.length ? avgBlund : "N/A"}
Top Openings: ${topOpenings}
${recentGames}

═══ IDENTIFIED WEAKNESSES ═══
${weaknesses}

═══ TRAINING FOCUS ═══
${trainingFocus.join(", ") || "Not specified"}

═══ COACH NOTES ═══
${coachNotes}

═══ COACHING DIRECTIVES ═══
1. PERSONALISE every response to this student's rating, games, and weaknesses.
2. Be PRACTICAL — give concrete moves, opening lines, specific drills.
3. Use PROPER NOTATION (e.g. 1.e4 e5 2.Nf3 Nc6) when discussing positions.
4. Be ENCOURAGING but HONEST — celebrate wins, address losses constructively.
5. MATCH your language to their level: ${levelHint}.
6. Keep responses CONCISE and ACTIONABLE — 3–6 sentences, unless depth is needed.
7. End with ONE clear next action the student should take today.
8. Never fabricate game moves. If you lack data, say so and give general guidance.

Recommended resources: Lichess puzzles & studies, Chess.com lessons, Silman's Endgame Course, Naroditsky's Speed Run, Chessable courses, Stockfish analysis.`;
}

// ── Local fallback response library ─────────────────────────
// Each handler receives (profile, games, weaknesses, streak) and returns a string.
const LOCAL_HANDLERS = {
  opening(p, games, weaknesses) {
    const opCount = {};
    games.forEach(g => { opCount[g.opening] = (opCount[g.opening] || 0) + 1; });
    const top  = Object.entries(opCount).sort((a, b) => b[1] - a[1])[0];
    const weak = weaknesses.find(w => w.label?.toLowerCase().includes("opening"));
    const advice = p.rating < 1400
      ? "Master the principles: central pawns, quick development, early castling — don't memorise lines yet."
      : p.rating < 1700
      ? "Build a tight repertoire: 1–2 openings as White, solid answers to 1.e4 and 1.d4. Study the IDEAS, not move sequences."
      : `At ${p.rating}, your prep should reach move 15–20. Use Chessable for spaced-repetition opening study.`;
    return [
      `Your most-played opening is **${top?.[0] ?? "a variety of openings"}**.`,
      weak ? `Note: ${weak.detail}` : "",
      advice,
      "**Action today:** Pick ONE opening and study its core ideas for 20 minutes on Lichess.",
    ].filter(Boolean).join(" ");
  },

  endgame(p) {
    const essentials = p.rating < 1400
      ? "K+Q vs K, K+R vs K, and K+P vs K positions"
      : p.rating < 1700
      ? "all basic pawn endings, Lucena & Philidor rook positions, and B vs N endings"
      : "R+P vs R, complex pawn structures, and active king play";
    return [
      `Endgame mastery is where ratings grow fastest. For ${p.rating}, master ${essentials}.`,
      "**Key principle:** Activate your king immediately in the endgame — passive kings lose half-points.",
      "**Drill:** K+P vs K — practise converting as the stronger side and defending as the weaker side, 10 times a day.",
      "**Book:** *Silman's Complete Endgame Course* — jump straight to your rating chapter. Worth 50–100 points.",
    ].join(" ");
  },

  tactics(p, games) {
    const avgBlund = games.length
      ? (games.reduce((s, g) => s + (g.blunders ?? 0), 0) / games.length).toFixed(1)
      : "unknown";
    const patterns = p.rating < 1400
      ? "forks, pins, and back-rank mates"
      : p.rating < 1700
      ? "discovered attacks, interference, and zugzwang"
      : "deflection, overloading, and positional sacrifices";
    return [
      `You average **${avgBlund} blunders/game** — real rating to gain here.`,
      `Focus on these patterns for ${p.rating}: **${patterns}**.`,
      "**Method:** 5–10 puzzles daily at YOUR rating on Lichess. Quality beats quantity. Review wrong answers for 2 min each.",
      "**Action today:** Solve 10 Lichess puzzles. For every wrong answer, set up the position and replay until it feels natural.",
    ].join(" ");
  },

  strategy(p) {
    const advice = p.rating < 1500
      ? "Identify and attack weak pawns, place pieces on optimal squares (knight outposts!), and create passed pawns."
      : `Study **prophylaxis** (stopping opponent plans), **weak square complexes**, and pawn-structure transformations. Nimzovich's *My System* is essential.`;
    return [
      "The fundamental question after every move: **'What is my opponent threatening? What is my plan?'**",
      advice,
      "**Practice:** After each game ask yourself: 'Did I have a plan, or was I just reacting?' One honest analysis beats 10 blitz games.",
      "**Action today:** Review one recent loss and find the move where you lost your advantage.",
    ].join(" ");
  },

  lastGame(p, games) {
    if (!games.length) return "No synced games to analyse yet. Sync your Chess.com or Lichess account first, then ask me about a specific game.";
    const g      = games[0];
    const acc    = g.accuracy != null ? `**${g.accuracy}% accuracy**` : "no accuracy data";
    const blund  = g.blunders  != null ? ` with **${g.blunders} blunder(s)**` : "";
    const delta  = g.delta ? ` (${g.delta > 0 ? "+" : ""}${g.delta} pts)` : "";
    const verdict = g.result === "win"
      ? (g.accuracy && g.accuracy < 88
          ? `Good win! Your ${g.accuracy}% accuracy suggests missed opportunities — check where evaluation dipped.`
          : "Solid win — keep the momentum.")
      : g.result === "loss"
      ? (g.blunders
          ? `A loss with ${g.blunders} blunder(s) — find those moments in analysis and understand WHY each happened.`
          : "Find where you went from equal to losing — that transition is the most instructive moment.")
      : "A draw can mean many things: did you hold a worse position, or fail to convert a better one?";
    return [
      `Last game: **${g.result.toUpperCase()}** vs ${g.opp} (${g.oppRating ?? "?"})${delta} — ${g.opening}${blund ? `. ${acc}${blund}.` : "."}`,
      verdict,
      "**Action:** Open this game in Lichess/Chess.com analysis, find the first significant evaluation drop, and spend 5 minutes on that position.",
    ].filter(Boolean).join(" ");
  },

  puzzle(p) {
    const pr = Math.max(800, p.rating - 100);
    return [
      `Go to **lichess.org/puzzles** — your starting puzzle rating should be around **${pr}**.`,
      "**Rules for effective puzzle training:**",
      "1️⃣ No hints — struggle for 2 minutes before checking the solution.",
      "2️⃣ Every wrong answer: replay the position 3× until it feels natural.",
      "3️⃣ After 10 puzzles, review mistakes — pattern recognition compounds.",
      "**Action: Solve 10 puzzles right now.** Consistency beats marathon sessions.",
    ].join("\n");
  },

  motivation(p, games, _, streak) {
    const wins    = games.filter(g => g.result === "win").length;
    const winRate = games.length ? Math.round(wins / games.length * 100) : 0;
    const level   = p.rating < 1200 ? "just starting your chess journey — every game teaches something new"
      : p.rating < 1600              ? "building solid club-level skills — the breakthrough to 1600+ is close"
      : p.rating < 1900              ? "in the exciting zone where chess becomes deeply strategic"
      :                                "at an advanced level that few players ever reach";
    return [
      `${p.fullName}, you're on a **${streak}-day training streak** — that's what separates improvers from stagnators.`,
      games.length
        ? `Your ${winRate}% win rate across ${games.length} games shows ${winRate >= 55 ? "excellent form — capitalise on it!" : winRate >= 45 ? "steady play — a few key fixes will push you over 55%+" : "some inconsistency — let's find the pattern in your losses."}`
        : "Start syncing your games so I can give you truly personalised coaching.",
      `At ${p.rating}, you're ${level}.`,
      "**Remember:** Magnus Carlsen played 10,000+ games before his peak. Every game you play compounds. Keep going! 💪",
    ].join(" ");
  },

  generic(p, games, weaknesses) {
    const top = weaknesses[0];
    const g0  = games[0];
    return [
      `At ${p.rating}, your highest-impact improvement area is: ${top ? `**${top.label}** — ${top.detail}` : "building consistency by analysing your losses"}.`,
      g0 ? `Your recent ${g0.result} vs ${g0.opp} in the ${g0.opening} is worth revisiting — look at the critical moment around move 20+.` : "",
      "**My top recommendation:** 15 min of tactics puzzles + 10 min analysing one recent game. This 25-min routine compounds faster than blitz alone.",
    ].filter(Boolean).join(" ");
  },
};

// ── Intent detection ─────────────────────────────────────────
const INTENT_PATTERNS = [
  [/opening|repertoire|sicilian|french|caro|king.s indian|london|english|ruy lopez|italian/i, "opening"],
  [/endgame|rook end|pawn end|king.pawn|promot/i, "endgame"],
  [/tactic|puzzle|fork|pin|skewer|mate|combination|blunder|hanging/i, "tactics"],
  [/strateg|plan|weak pawn|outpost|positional|prophylaxis/i, "strategy"],
  [/last game|recent game|my game|analyz|review/i, "lastGame"],
  [/give me a puzzle|puzzle me|train me|daily puzzle/i, "puzzle"],
  [/motivat|discourage|los(ing streak)|frustrated|give up|difficult/i, "motivation"],
];

function detectIntent(msg) {
  for (const [re, intent] of INTENT_PATTERNS) {
    if (re.test(msg)) return intent;
  }
  return "generic";
}

// ── Smart local responder ─────────────────────────────────────
function localFallback(userMsg) {
  const { profile: p, games, streak } = State.get();
  const weaknesses = Coach.analyzeWeaknesses(games);
  const intent     = detectIntent(userMsg);
  const handler    = LOCAL_HANDLERS[intent] ?? LOCAL_HANDLERS.generic;
  const body       = handler(p, games, weaknesses, streak);
  return `${body}\n\n_⚠️ AI Coach is in offline mode. [Set up a free API key](#setup-ai) for full AI-powered coaching._`;
}

// ── Provider implementations ─────────────────────────────────

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
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter ${res.status}: ${err?.error?.message || ""}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function queryGemini(messages, systemPrompt) {
  const key = AI_CONFIG.geminiKey;
  if (!key) throw new Error("No Gemini key");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_CONFIG.geminiModel}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 800 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

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
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Provider registry — makes adding new providers trivial ───
const PROVIDERS = {
  proxy:       cfg => PROXY_URL                && (() => (msgs, sys) => queryProxy(msgs, sys)),
  openrouter:  cfg => cfg.openrouterKey        && (() => (msgs, sys) => queryOpenRouter(msgs, sys)),
  gemini:      cfg => cfg.geminiKey            && (() => (msgs, sys) => queryGemini(msgs, sys)),
  groq:        cfg => cfg.groqKey              && (() => (msgs, sys) => queryGroq(msgs, sys)),
};

// ── Chat history persistence ──────────────────────────────────
export const ChatHistory = {
  _key() {
    try {
      return `${AI_CONFIG.storageKeyPrefix}${State.get().currentUserId || "default"}`;
    } catch { return `${AI_CONFIG.storageKeyPrefix}default`; }
  },

  load() {
    try { return JSON.parse(localStorage.getItem(this._key()) || "[]"); }
    catch { return []; }
  },

  save(history) {
    try { localStorage.setItem(this._key(), JSON.stringify(history.slice(-40))); }
    catch { /* quota exceeded / private mode */ }
  },

  clear() {
    try { localStorage.removeItem(this._key()); } catch {}
  },

  export(history) {
    const text = history
      .map(h => `[${h.role.toUpperCase()}]\n${h.content}`)
      .join("\n\n---\n\n");
    const a = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(new Blob([text], { type: "text/plain" })),
      download: `chess-coach-chat-${new Date().toISOString().slice(0, 10)}.txt`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};

// ── Public API ────────────────────────────────────────────────
export const AI = {
  configure(opts = {}) {
    Object.assign(AI_CONFIG, opts);
    const persist = {
      ai_openrouter_key: opts.openrouterKey,
      ai_gemini_key:     opts.geminiKey,
      ai_groq_key:       opts.groqKey,
      ai_provider:       opts.provider,
    };
    try {
      for (const [k, v] of Object.entries(persist)) {
        if (v != null) localStorage.setItem(k, v);
      }
    } catch {}
  },

  hasApiKey() {
    const { provider: pv } = AI_CONFIG;
    return !!(
      (pv === "proxy"       && PROXY_URL)              ||
      (pv === "openrouter"  && AI_CONFIG.openrouterKey) ||
      (pv === "gemini"      && AI_CONFIG.geminiKey)     ||
      (pv === "groq"        && AI_CONFIG.groqKey)
    );
  },

  getProviderLabel() {
    const { provider: pv } = AI_CONFIG;
    if (pv === "proxy"      && PROXY_URL)               return "Anthropic (proxy)";
    if (pv === "openrouter" && AI_CONFIG.openrouterKey) return `OpenRouter · ${AI_CONFIG.openrouterModel.split("/").pop()}`;
    if (pv === "gemini"     && AI_CONFIG.geminiKey)     return "Google Gemini Flash";
    if (pv === "groq"       && AI_CONFIG.groqKey)       return `Groq · ${AI_CONFIG.groqModel}`;
    return "Local (offline)";
  },

  async getResponse(userMsg, history = []) {
    if (!checkRateLimit()) {
      return "⏳ You're sending messages too quickly — please wait a moment before trying again.";
    }

    const systemPrompt = buildSystemPrompt();
    const messages = [
      ...history.slice(-10).filter(h => h.content).map(({ role, content }) => ({ role, content })),
      { role: "user", content: userMsg },
    ];

    // Resolve the active provider function (if key is present)
    const providerFn = PROVIDERS[AI_CONFIG.provider]?.(AI_CONFIG);
    if (providerFn) {
      try {
        const fn   = providerFn();
        const text = (await fn(messages, systemPrompt))?.trim();
        if (text) return text;
      } catch (err) {
        console.warn(`[AI] Provider "${AI_CONFIG.provider}" failed:`, err.message);
      }
    }

    // Graceful fallback to local responses
    return localFallback(userMsg);
  },
};
