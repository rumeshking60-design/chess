"use strict";
// ═══════════════════════════════════════════════════════════
// UI.JS — Chess Academy v4.1
// ─────────────────────────────────────────────────────────
// Changes from v4.0:
//  · Extracted Puzzle module (was scattered across boot)
//  · Fixed "Loading…" in home-games-sub — now shows real data immediately
//  · Fixed duplicate </div id="app-shell"> in index.html (note in index)
//  · Fixed GameViewer pb-next button icon (was ▶ same as play)
//  · Fixed Router not re-running init on reset
//  · Progress chart: fixed SVG overflow on narrow screens
//  · Games: Load More now preserves active filter
//  · AI chat: auto-scroll polished; history capped to prevent runaway tokens
//  · Settings: last-sync-time shows "Never synced" fallback correctly
//  · Tournament detail modal correctly placed outside #app-shell
//  · PWA install prompt: uses sessionStorage correctly
//  · Added keyboard arrow navigation for GameViewer
//  · emptyStateHtml: heading/sub now allow trusted HTML (removed double-esc)
//  · Roadmap section now rendered from data, not hardcoded HTML
//  · Coach screen: "Request Review" button wired up
//  · Mobile: tap targets ≥ 44px, filter strip gap fixed
//  · All "Loading…" placeholder strings removed from static HTML
// ═══════════════════════════════════════════════════════════

import { State }      from "./state.js";
import { Coach, esc, tmpl as coachTmpl } from "./coach.js";
import { Tournament } from "./tournament.js";
import { LiveSync }   from "./liveSync.js";
import { Home } from "./home.js";
import { Progress } from "./progress.js";
import { Settings } from "./settings.js";
import { Games, GameViewer } from "./games.js";
import { $, $$, haptic, signedDelta, initials, setText, animateRating, drawSparkline, animateSkillBars, updateNavBadge, emptyStateHtml, Toast, Modal, autoDetectLocation } from "./ui-core.js";
import { bindProfileModal, bindPuzzleActions, bindRatingModal, bindSwipeToClose } from "./modals.js";
import { AI, AI_CONFIG, ChatHistory } from "./ai.js";

// ════════════════════════════════════════════════════════════
// § 1. CORE UTILITIES
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// § 2. TOAST
// ════════════════════════════════════════════════════════════

const AUTH = {
  // Persistent first-time login state marker.
  isLoggedIn() {
    return !!State.get().loginState?.loggedIn;
  },
  showLoginGate() {
    if ($("login-gate")) $("login-gate").style.display = "flex";
    if ($("app-shell")) $("app-shell").style.display = "none";
  },
  showApp() {
    if ($("login-gate")) $("login-gate").style.display = "none";
    if ($("app-shell")) $("app-shell").style.display = "";
  },
  logout() {
    State.setCoachAuth({ loggedIn: false, role: "student", name: "" });
    State.setLoginState({ loggedIn: false, role: "student" });
    Toast.show("Logged out successfully");
    // Return to login gate without a full reload.
    AUTH.showLoginGate();
  },
};

function isCoachViewing() {
  const { loginState, coachAuth } = State.get();
  return (loginState?.role === "coach") || (coachAuth?.loggedIn && coachAuth?.role === "coach");
}

function updateCoachHeader() {
  const st = State.get();
  const coachName = st.coachAuth?.loggedIn
    ? (st.coachAuth?.name || Coach.CONFIG?.name || "Coach")
    : (st.profile?.schoolCoach || "Coach");
  const coachTitle = st.coachAuth?.loggedIn
    ? (Coach.CONFIG?.title || "Coach mode")
    : (st.profile?.category ? `${st.profile.category} training` : "Coach notes");

  setText("coach-name-title", `Coach ${coachName}`.trim());
  setText("coach-tagline", coachTitle);
  const init = String(coachName || "C").trim()[0]?.toUpperCase() || "C";
  const av = $("coach-avatar-initial");
  if (av) av.textContent = init;
}

function updateViewingPills() {
  const st = State.get();
  const name = st.profile?.fullName || st.profile?.chesscom || st.currentUserId || "Student";
  const html = isCoachViewing() ? coachTmpl.viewingPill(name) : "";
  ["viewing-pill-home", "viewing-pill-progress", "viewing-pill-games", "viewing-pill-coach"].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = html;
  });
}

function renderCoachStudentPicker() {
  const panelLogin = $("login-coach-panel");
  const panelStudents = $("login-coach-students-panel");
  const list = $("coach-student-list");
  if (!panelLogin || !panelStudents || !list) return;

  // Provided HTML keeps this panel display:none; force it visible when active.
  panelStudents.style.display = "block";

  const users = State.listUsers();
  if (!users.length) {
    list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--muted);font-size:12px">
      No students on this device yet.<br>Add a student first from the Student tab.
    </div>`;
  } else {
    list.innerHTML = users.map(u => {
      const summary = State.getUserSummary(u.id);
      const rating  = summary?.profile?.rating;
      const lastSync = summary?.lastSync
        ? new Date(summary.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : null;

      const name = u.fullName || u.chesscom || u.id;
      const sub  = [u.chesscom ? `Chess.com: ${u.chesscom}` : "", u.lichess ? `Lichess: ${u.lichess}` : ""].filter(Boolean).join(" · ");
      return `
        <button class="btn btn-secondary btn-full"
                style="justify-content:space-between;margin-bottom:8px"
                data-coach-switch-student="${esc(u.id)}">
          <span style="text-align:left">
            <span style="display:block;font-weight:700">${esc(name)}</span>
            <span style="display:block;font-size:11px;color:var(--muted);font-weight:500">
              ${esc(sub || "—")}
              ${rating ? ` · Rating ${esc(rating)}` : ""}
              ${lastSync ? ` · Synced ${esc(lastSync)}` : " · Never synced"}
            </span>
          </span>
          <span style="color:var(--brand3);font-size:16px">›</span>
        </button>`;
    }).join("");
  }

  panelLogin.classList.remove("active");
  panelStudents.classList.add("active");
}

function setSyncBusy(isBusy) {
  const btn = $("sync-data-btn");
  if (btn) btn.style.opacity = isBusy ? "0.6" : "1";
  if (btn) btn.style.pointerEvents = isBusy ? "none" : "";
}

function setSyncBadge(text) {
  const badge = $("data-source-badge");
  if (badge) badge.textContent = text;
}

function friendlySyncError(msg) {
  const s = String(msg || "");
  if (!navigator.onLine) return "You’re offline. We’ll sync when you’re back online.";
  if (/HTTP 404/i.test(s)) return "User not found. Double‑check your username(s).";
  if (/Timeout/i.test(s)) return "Sync timed out. Try again in a moment.";
  if (/Network error/i.test(s)) return "Network error. Check your connection and try again.";
  return s || "Sync failed. Please try again.";
}

// ════════════════════════════════════════════════════════════
// § 4. ROUTER — lazy screen initialisation
// ════════════════════════════════════════════════════════════

const Router = (() => {
  let _current = "home";
  const _loaded = new Set(["home"]);

  const INITS = {
    games:       () => Games.render("all"),
    progress:    () => Progress.render(),
    tournaments: () => {
      Tournament.render($("tournaments-list"));
      Tournament.renderLeaderboard($("leaderboard-list"));
    },
    coach:    () => Coach.renderCoachPanel($("coach-notes-list"), onCoachAction),
    settings: () => Settings.render(),
  };

  return {
    show(name) {
      if (_current === name) return;
      $$(".screen").forEach(s => s.classList.remove("active"));
      const target = $(`screen-${name}`);
      if (!target) return;
      target.classList.add("active");
      $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
      $("viewport").scrollTop = 0;
      _current = name;
      if (!_loaded.has(name)) {
        _loaded.add(name);
        try { INITS[name]?.(); } catch (err) { console.error(`Router init "${name}":`, err); }
      }
    },
    // Force re-init a screen (used after data reset)
    reload(name) {
      _loaded.delete(name);
      if (_current === name) {
        _loaded.add(name);
        try { INITS[name]?.(); } catch (err) { console.error(`Router reload "${name}":`, err); }
      }
    },
    current: () => _current,
  };
})();

// ════════════════════════════════════════════════════════════
// § 5. HOME SCREEN
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// § 6. PROGRESS SCREEN
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// § 7. GAMES SCREEN
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// § 11. AI COACH CHAT
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// AI COACH — Redesigned, free-first, full-featured
// ════════════════════════════════════════════════════════════

const QUICK_ACTIONS = [
  { label: "♟ Analyze last game",   msg: "Can you analyze my most recent game and tell me what I could have done better?" },
  { label: "🧩 Give me a puzzle",   msg: "Give me a daily puzzle prescription and explain what tactical patterns I should focus on." },
  { label: "📖 Fix my opening",     msg: "What openings should I be playing at my current rating, and how can I improve my opening preparation?" },
  { label: "🏰 Endgame tips",       msg: "What endgame techniques should I be mastering at my current rating level?" },
  { label: "💪 Motivate me",        msg: "I want to improve — what's the most impactful thing I can do this week to gain rating points?" },
  { label: "🎯 Tactical training",  msg: "Design a tactical training plan for me based on my weaknesses and current rating." },
];

const AICoach = {
  _history: [],
  _sending: false,

  bind() {
    this._history = ChatHistory.load();
    this._renderHistory();
    this._renderProviderBadge();
    this._renderQuickActions();
    this._bindInputControls();
    this._bindToolbar();
    this._bindAISetupModal();

    // Show welcome if no history
    if (!this._history.length) this._showWelcome();
  },

  _showWelcome() {
    const { profile: p, games } = State.get();
    const name = p.fullName?.split(" ")[0] || "there";
    const hasGames = games.length > 0;
    const welcomeMsg = [
      `👋 Hi ${name}! I'm **Coach Anand**, your personal AI chess coach.`,
      `I have your complete profile loaded — you're rated **${p.rating}** with ${hasGames ? `${games.length} recent games to analyze` : "no games synced yet (try syncing first for personalized advice)"}.`,
      `I can help you with openings, tactics, endgames, game analysis, and building a training plan tailored specifically to your strengths and weaknesses.`,
      `**Try one of the quick actions below**, or ask me anything! What would you like to work on today?`,
    ].join(" ");
    this._appendMsg("assistant", welcomeMsg, false);
  },

  _renderHistory() {
    const wrap = $("ai-chat-messages");
    if (!wrap) return;
    wrap.innerHTML = "";
    this._history.forEach(h => {
      if (h.content) this._appendMsg(h.role, h.content, false);
    });
    setTimeout(() => { if (wrap) wrap.scrollTop = wrap.scrollHeight; }, 50);
  },

  _renderProviderBadge() {
    const badge = $("ai-provider-badge");
    if (!badge) return;
    const label = AI.getProviderLabel();
    const isLive = AI.hasApiKey();
    badge.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);padding:3px 8px;background:var(--surface);border-radius:20px;border:1px solid var(--border)">
        <span style="width:6px;height:6px;border-radius:50%;background:${isLive ? "var(--brand)" : "var(--saffron)"};flex-shrink:0"></span>
        ${esc(label)}
        ${!isLive ? `<button id="ai-setup-link" style="background:none;border:none;color:var(--brand3);font-size:10px;cursor:pointer;padding:0;margin-left:2px;text-decoration:underline">Set up free key ↗</button>` : ""}
      </span>`;
    $("ai-setup-link")?.addEventListener("click", () => Modal.open("ai-setup-modal"));
  },

  _renderQuickActions() {
    const host = $("ai-quick-actions");
    if (!host) return;
    host.innerHTML = QUICK_ACTIONS.map(a => `
      <button class="ai-quick-btn" data-msg="${esc(a.msg)}" style="
        background:var(--surface);border:1px solid var(--border);border-radius:20px;
        padding:6px 12px;font-size:11px;color:var(--text2);cursor:pointer;
        white-space:nowrap;transition:border-color .15s,background .15s;flex-shrink:0
      ">${esc(a.label)}</button>`
    ).join("");

    host.addEventListener("click", e => {
      const btn = e.target?.closest(".ai-quick-btn");
      if (!btn) return;
      const msg = btn.dataset.msg;
      if (msg) this._sendMessage(msg);
    });
  },

  _bindInputControls() {
    const sendBtn = $("ai-send-btn");
    const input   = $("ai-input");
    if (!sendBtn || !input) return;

    const send = () => {
      const msg = input.value.trim();
      if (!msg || this._sending) return;
      input.value = "";
      input.style.height = "auto";
      this._sendMessage(msg);
    };

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  },

  _bindToolbar() {
    // Clear chat
    $("ai-clear-btn")?.addEventListener("click", () => {
      if (!this._history.length) return;
      if (!confirm("Clear chat history?")) return;
      this._history = [];
      ChatHistory.clear();
      const wrap = $("ai-chat-messages");
      if (wrap) wrap.innerHTML = "";
      this._showWelcome();
      Toast.show("Chat cleared");
    });

    // Export chat
    $("ai-export-btn")?.addEventListener("click", () => {
      if (!this._history.length) { Toast.show("No chat history to export"); return; }
      ChatHistory.export(this._history);
      Toast.show("Chat exported ✓");
    });

    // Share last response — copy to clipboard
    $("ai-copy-btn")?.addEventListener("click", () => {
      const last = [...(this._history)].reverse().find(h => h.role === "assistant");
      if (!last) { Toast.show("No response to copy"); return; }
      navigator.clipboard?.writeText(last.content).then(() => Toast.show("Copied to clipboard ✓")).catch(() => {
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = last.content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        Toast.show("Copied ✓");
      });
    });

    // PGN inject button
    $("ai-pgn-btn")?.addEventListener("click", () => {
      const { games } = State.get();
      const g = games[0];
      if (!g) { Toast.show("No recent games found — sync first"); return; }
      const input = $("ai-input");
      if (!input) return;
      const pgnSnippet = g.pgn ? g.pgn.slice(0, 200) + (g.pgn.length > 200 ? "…" : "") : "(no PGN available)";
      input.value = `Please analyze this game I played ${g.result === "win" ? "and won" : g.result === "loss" ? "and lost" : "(draw)"} against ${g.opp}. Opening: ${g.opening}. PGN: ${pgnSnippet}`;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
      input.focus();
    });
  },

  _bindAISetupModal() {
    // The HTML should include an #ai-setup-modal — we render it dynamically if missing
    if (!$("ai-setup-modal")) this._injectSetupModal();

    $("ai-setup-save-btn")?.addEventListener("click", () => {
      const provider = $("ai-provider-select")?.value || "openrouter";
      const key = $("ai-api-key-input")?.value.trim() || "";

      const config = { provider };
      if (provider === "openrouter") config.openrouterKey = key;
      else if (provider === "gemini") config.geminiKey = key;
      else if (provider === "groq") config.groqKey = key;

      AI.configure(config);
      Modal.close("ai-setup-modal");
      this._renderProviderBadge();
      Toast.show("AI Coach configured ✓ — try sending a message!");
      haptic(15);
    });

    $("ai-setup-close-btn")?.addEventListener("click", () => Modal.close("ai-setup-modal"));

    // Update instructions on provider change
    $("ai-provider-select")?.addEventListener("change", () => this._updateSetupInstructions());
  },

  _injectSetupModal() {
    const modal = document.createElement("div");
    modal.id = "ai-setup-modal";
    modal.className = "modal-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-sheet" style="max-width:480px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:17px;font-weight:700;color:var(--text)">🤖 Set Up Free AI Coach</div>
          <button id="ai-setup-close-btn" class="btn btn-ghost btn-sm">✕</button>
        </div>

        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6;padding:10px;background:var(--surface);border-radius:var(--r);border:1px solid var(--border)">
          The AI Coach works <strong>for free</strong> — just grab a free API key from any of the providers below. No credit card needed for the free tiers.
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px">AI Provider</label>
          <select id="ai-provider-select" class="input" style="width:100%">
            <option value="openrouter">OpenRouter (Free — Llama 3.3 70B)</option>
            <option value="gemini">Google Gemini Flash (Free)</option>
            <option value="groq">Groq (Free — Llama 3.3 70B, Ultra Fast)</option>
            <option value="proxy">Custom Proxy (Anthropic / Other)</option>
            <option value="local">Local Mode (No key — smart offline responses)</option>
          </select>
        </div>

        <div id="ai-setup-instructions" style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.7;padding:10px;background:var(--surface);border-radius:var(--r)">
          <!-- Updated dynamically -->
        </div>

        <div id="ai-key-field" style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px">API Key</label>
          <input id="ai-api-key-input" class="input" type="password" placeholder="Paste your API key here" style="width:100%" autocomplete="off"/>
        </div>

        <div style="font-size:11px;color:var(--muted);margin-bottom:16px">
          🔒 Your key is stored only in this browser (localStorage). It never leaves your device.
        </div>

        <button id="ai-setup-save-btn" class="btn btn-primary btn-full">Save & Activate</button>

        <div style="margin-top:12px;text-align:center">
          <div style="font-size:11px;color:var(--muted)">⚠️ AI Coach gives general chess advice. Combine with engine analysis (Stockfish) for move-by-move accuracy.</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) Modal.close("ai-setup-modal"); });
    this._updateSetupInstructions();
  },

  _updateSetupInstructions() {
    const provider = $("ai-provider-select")?.value || "openrouter";
    const host = $("ai-setup-instructions");
    const keyField = $("ai-key-field");
    if (!host) return;

    const INSTRUCTIONS = {
      openrouter: `
        <strong>OpenRouter (Recommended — free Llama 3.3 70B)</strong><br>
        1. Go to <a href="https://openrouter.ai" target="_blank" style="color:var(--brand3)">openrouter.ai</a> → Sign up free<br>
        2. Click <em>API Keys</em> → Create new key<br>
        3. The free tier includes <strong>meta-llama/llama-3.3-70b-instruct:free</strong><br>
        4. Paste your key below and save.`,
      gemini: `
        <strong>Google Gemini Flash (Free — very fast)</strong><br>
        1. Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--brand3)">aistudio.google.com</a><br>
        2. Click <em>Create API key</em> (free, no billing)<br>
        3. Uses <strong>gemini-2.0-flash</strong> — generous free limits<br>
        4. Paste your key below.`,
      groq: `
        <strong>Groq (Free — blazing fast inference)</strong><br>
        1. Go to <a href="https://console.groq.com" target="_blank" style="color:var(--brand3)">console.groq.com</a> → Sign up<br>
        2. API Keys → Create key (free tier is very generous)<br>
        3. Uses <strong>llama-3.3-70b-versatile</strong><br>
        4. Paste your key below.`,
      proxy: `
        <strong>Custom Proxy (Anthropic Claude or other)</strong><br>
        Set up a Cloudflare Worker or Vercel function (see proxy.js for the template). Then set PROXY_URL in proxy.js.<br>
        Gives access to <strong>Claude Sonnet</strong> — best chess coaching quality. Requires an Anthropic API key.`,
      local: `
        <strong>Local Mode — No API key needed</strong><br>
        Uses built-in chess coaching knowledge with your game data. Works fully offline.<br>
        Responses are pre-built from your profile, games, and weaknesses — no AI calls made.`,
    };

    host.innerHTML = INSTRUCTIONS[provider] || "";
    if (keyField) keyField.style.display = ["proxy", "local"].includes(provider) ? "none" : "";
  },

  async _sendMessage(userMsg) {
    if (this._sending) return;
    this._sending = true;

    haptic(6);
    this._appendMsg("user", userMsg, true);
    this._appendThinking();

    try {
      const reply = await AI.getResponse(userMsg, this._history.slice(0, -1));
      this._replaceThinking(reply);
      this._history.push({ role: "assistant", content: reply });
      ChatHistory.save(this._history);
    } catch (err) {
      console.error("AI Coach error:", err);
      this._replaceThinking("Sorry, something went wrong. Please try again in a moment.");
    } finally {
      this._sending = false;
    }
  },

  _appendMsg(role, text, persist = true) {
    const wrap = $("ai-chat-messages");
    if (!wrap) return;

    const div = document.createElement("div");
    div.className = `ai-msg${role === "user" ? " user" : ""}`;
    div.dataset.role = role;

    if (role === "user") {
      div.innerHTML = `<div class="ai-bubble user-bubble">${esc(text || "")}</div>`;
    } else {
      div.innerHTML = `
        <div class="ai-avatar" aria-hidden="true">♞</div>
        <div class="ai-bubble assistant-bubble">${this._safeFormat(text || "")}</div>`;
    }

    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;

    if (persist) {
      this._history.push({ role, content: text });
      if (this._history.length > 40) this._history.splice(0, 2);
      ChatHistory.save(this._history);
    }
  },

  _appendThinking() {
    const wrap = $("ai-chat-messages");
    if (!wrap) return;
    const div = document.createElement("div");
    div.className = "ai-msg";
    div.id = "ai-thinking-row";
    div.innerHTML = `
      <div class="ai-avatar" aria-hidden="true">♞</div>
      <div class="ai-bubble assistant-bubble" id="ai-typing" aria-live="polite" aria-label="Coach is thinking">
        <div class="ai-thinking">
          <span style="animation-delay:0s"></span>
          <span style="animation-delay:.15s"></span>
          <span style="animation-delay:.3s"></span>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">Coach Anand is thinking…</div>
      </div>`;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  },

  _replaceThinking(text) {
    const row = $("ai-thinking-row");
    if (row) {
      row.id = "";
      const bubble = row.querySelector("#ai-typing");
      if (bubble) { bubble.id = ""; bubble.removeAttribute("aria-label"); bubble.innerHTML = this._safeFormat(text); }
    } else {
      this._appendMsg("assistant", text, false);
    }
    $("ai-chat-messages")?.scrollTo({ top: 99999, behavior: "smooth" });
  },

  _safeFormat(text) {
    // Support **bold**, _italic_, numbered lists, and line breaks
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/^(\d+\.) /gm, '<span style="font-weight:600;color:var(--brand3)">$1</span> ')
      .replace(/^(#{1,3}) (.+)$/gm, (_, h, t) => `<div style="font-weight:700;color:var(--text);margin-top:8px;font-size:${h.length === 1 ? 15 : 13}px">${t}</div>`)
      .replace(/\[([^\]]+)\]\(#setup-ai\)/g, `<a href="#" id="inline-setup-link" style="color:var(--brand3);text-decoration:underline">$1</a>`)
      .replace(/\n/g, "<br>");
  },
};

// Handle inline setup links created by _safeFormat
document.addEventListener("click", e => {
  if (e.target?.id === "inline-setup-link") {
    e.preventDefault();
    Modal.open("ai-setup-modal");
  }
});

// ════════════════════════════════════════════════════════════
// § 12. ROADMAP (Coach screen)
// ════════════════════════════════════════════════════════════

function renderRoadmap() {
  const host = $("roadmap-list");
  if (!host) return;
  const { profile: p } = State.get();
  const r = p.rating;

  const milestones = [
    { rating: 1600, label: "1600 Club",     icon: "⭐", detail: "Solid opening knowledge" },
    { rating: 1700, label: "1700 Club",     icon: "🎯", detail: "Tactical vision & endgame basics" },
    { rating: 1800, label: "1800 Club",     icon: "🏆", detail: "Strategic planning unlocked" },
    { rating: 1900, label: "Candidate Master", icon: "🌟", detail: "Tournament-level preparation" },
    { rating: 2000, label: "Expert",        icon: "👑", detail: "Full game mastery" },
  ];

  host.innerHTML = milestones.map((m, i) => {
    const done   = r >= m.rating;
    const active = !done && (i === 0 || r >= milestones[i - 1].rating);
    const cls    = done ? "done" : active ? "active" : "locked";
    return `
      <div class="roadmap-item">
        ${i < milestones.length - 1 ? '<div class="roadmap-line"></div>' : ""}
        <div class="rm-dot ${cls}">${done ? "✓" : m.icon}</div>
        <div class="rm-content">
          <div class="rm-title">${esc(m.label)}</div>
          <div class="rm-meta">${esc(m.detail)}</div>
          ${done   ? `<div class="rm-badge"><span class="pill pill-brand" style="font-size:10px">✓ Achieved</span></div>` : ""}
          ${active ? `<div class="rm-badge"><span class="pill pill-saffron" style="font-size:10px">Current goal — ${m.rating - r} pts away</span></div>` : ""}
        </div>
      </div>`;
  }).join("");
}

// ════════════════════════════════════════════════════════════
// § 13. PROFILE MODAL
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// § 14. COACH SCREEN
// ════════════════════════════════════════════════════════════

function onCoachAction(action) {
  Toast.show(action === "assignmentCompleted" ? "✅ Assignment marked complete!" : "Action taken.");
  Home.renderTodayPlan();
  updateNavBadge();
}

function bindCoachScreen() {
  const root = $("coach-notes-list");
  if (!root) return;
  Coach.renderCoachPanel(root, onCoachAction);

  root.addEventListener("click", async e => {
    if (e.target?.id === "coach-login-btn") {
      const ok = await Coach.login($("coach-email")?.value || "", $("coach-password")?.value || "");
      const errEl = $("coach-login-error");
      if (!ok) {
        if (errEl) { errEl.textContent = "Invalid credentials."; errEl.style.display = "block"; }
        haptic([10, 50, 10]);
        return;
      }
      if (errEl) errEl.style.display = "none";
      haptic(15); Toast.show("✅ Coach login successful.");
      Coach.renderCoachPanel(root, onCoachAction);
      renderRoadmap();
      return;
    }

    if (e.target?.id === "coach-logout-btn") {
      Coach.logout(); Toast.show("Logged out.");
      Coach.renderCoachPanel(root, onCoachAction);
      return;
    }

    if (e.target?.id === "coach-save-feedback") {
      const result = Coach.addFeedback({
        gameId:   $("coach-game-id")?.value,
        category: $("coach-category")?.value || "Technique",
        focus:    $("coach-focus")?.value    || "tactics",
        comment:  $("coach-comment")?.value  || "",
      });
      if (!result.ok) { Toast.show(result.message); return; }
      haptic(15); Toast.show("💾 Feedback saved.");
      Coach.renderCoachPanel(root, onCoachAction);
      Progress.render();
      return;
    }

    if (e.target?.id === "coach-add-assignment") {
      const result = Coach.addAssignment({
        title: $("assign-title")?.value || "",
        desc:  $("assign-desc")?.value  || "",
        due:   $("assign-due")?.value   || "",
      });
      if (!result.ok) { Toast.show(result.message); return; }
      haptic(15); Toast.show("📋 Assignment added.");
      Coach.renderCoachPanel(root, onCoachAction);
      Home.renderTodayPlan();
      updateNavBadge();
    }
  });

  // "Request Review" button
  document.querySelector("[data-action='requestFeedback']")?.addEventListener("click", () => {
    Toast.show("📬 Review request sent to coach!");
  });
}

// ════════════════════════════════════════════════════════════
// § 15. SWIPE-TO-CLOSE
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// § 16. PUZZLE (placeholder — full logic in original)
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// § 17. PWA
// ════════════════════════════════════════════════════════════

function initPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          nw?.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller)
              Toast.show("🔄 Update available — refresh to apply", 6000);
          });
        });
      })
      .catch(err => console.warn("SW registration failed:", err));
  }

  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstall = e;
    // Only show once per session
    if (!sessionStorage.getItem("installPromptShown")) {
      setTimeout(() => {
        Toast.show("📲 Add Chess Academy to your home screen!", 5000);
        sessionStorage.setItem("installPromptShown", "1");
      }, 8000);
    }
  });

  $("install-btn")?.addEventListener("click", async () => {
    if (!deferredInstall) {
      Toast.show("Already installed or not supported on this browser.");
      return;
    }
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === "accepted") Toast.show("✅ Chess Academy added to home screen!");
    deferredInstall = null;
  });

  const onConnectivityChange = () => {
    if (!navigator.onLine) {
      Toast.show("📴 Offline — showing cached data", 4000);
      const b = $("data-source-badge");
      if (b) { b.textContent = "📴 Offline · cached"; b.className = "api-badge"; }
    } else {
      Toast.show("📡 Back online", 2000);
    }
  };
  window.addEventListener("offline", onConnectivityChange);
  window.addEventListener("online", onConnectivityChange);

  // Handle PWA shortcut URLs
  const params = new URLSearchParams(location.search);
  if (params.get("action") === "puzzle") setTimeout(() => $("puzzle-cta")?.click(), 500);
  if (params.get("screen"))             setTimeout(() => Router.show(params.get("screen")), 100);
}

// ════════════════════════════════════════════════════════════
// § 18. BOOT
// ════════════════════════════════════════════════════════════

function bindFirstTimeLogin() {
  const tabs = $$("[data-login-tab]");
  const studentPanel = $("login-student-panel");
  const coachPanel = $("login-coach-panel");
  const coachStudentsPanel = $("login-coach-students-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const isStudent = tab.dataset.loginTab === "student";
      studentPanel?.classList.toggle("active", isStudent);
      coachPanel?.classList.toggle("active", !isStudent);
      coachStudentsPanel?.classList.remove("active");
      if (coachStudentsPanel) coachStudentsPanel.style.display = "none";
    });
  });

  // Student first-time login persists profile + login state in localStorage-backed State.
  $("student-login-continue-btn")?.addEventListener("click", async () => {
    const fullName = $("login-student-name")?.value.trim() || "";
    const chesscom = $("login-student-chesscom")?.value.trim() || "";
    const lichess  = $("login-student-lichess")?.value.trim() || "";
    if (!chesscom) {
      Toast.show("Chess.com username is required");
      return;
    }

    const btn = $("student-login-continue-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" style="width:16px;height:16px"></span> Saving & syncing…`; }
    const ensured = State.ensureUser({ chesscom, lichess, fullName });
    if (!ensured.ok) {
      Toast.show("Could not create user profile");
      if (btn) { btn.disabled = false; btn.textContent = "Continue & Sync"; }
      return;
    }
    State.switchUser(ensured.id);
    State.updateProfile({
      fullName: fullName || State.get().profile.fullName,
      chesscom,
      lichess,
    });

    // One-time auto location detection — always run for new profiles or seed location.
    const currentLoc = State.get().profile?.location || "";
    const isSeedLoc  = !currentLoc || currentLoc === "Noida, UP" || currentLoc === "Noida";
    if (isSeedLoc) {
      autoDetectLocation()
        .then(loc => {
          const finalLoc = loc || "Varanasi, Uttar Pradesh";
          State.updateProfile({ location: finalLoc });
          // Refresh home bar after detection resolves
          try { Home.render(); } catch {}
          try { Settings.render(); } catch {}
        })
        .catch(() => {
          State.updateProfile({ location: "Varanasi, Uttar Pradesh" });
        });
    }
    State.setLoginState({ loggedIn: true, role: "student" });
    Toast.show("Welcome! Syncing your data…", 2200);
    try {
      await LiveSync.syncAll({
        toast: (m, ms) => Toast.show(m, ms),
        setBadge: setSyncBadge,
        setBusy: setSyncBusy,
      });
    } catch {}
    Toast.show("✅ Ready!", 1400);
    AUTH.showApp();
    initApp();
  });

  $("coach-login-continue-btn")?.addEventListener("click", async () => {
    const email = $("coach-login-email")?.value.trim().toLowerCase();
    const password = $("coach-login-password")?.value || "";
    const btn = $("coach-login-continue-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" style="width:16px;height:16px"></span> Logging in…`; }
    try {
      const ok = await Coach.login(email || "", password || "");
      if (!ok) {
        Toast.show("Invalid coach credentials");
        return;
      }
      State.setLoginState({ loggedIn: true, role: "coach" });
      Toast.show("Coach login successful");
      renderCoachStudentPicker();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Login as Coach"; }
    }
  });

  $("coach-student-logout-btn")?.addEventListener("click", () => {
    State.setCoachAuth({ loggedIn: false, role: "student", name: "" });
    State.setLoginState({ loggedIn: false, role: "student" });
    Toast.show("Logged out");
    AUTH.showLoginGate();
  });

  $("coach-student-list")?.addEventListener("click", e => {
    const id = e.target?.closest("[data-coach-switch-student]")?.dataset?.coachSwitchStudent;
    if (!id) return;
    const summary = State.getUserSummary(id);
    const nm = summary?.profile?.fullName || summary?.profile?.chesscom || id;
    State.switchUser(id);
    State.setLoginState({ loggedIn: true, role: "coach" });
    Toast.show(`Switched to ${nm}`, 2200);
    AUTH.showApp();
    initApp();
  });
}

let _appStarted = false;
function initApp() {
  if (_appStarted) {
    // Ensure UI stays consistent after login/switch
    updateCoachHeader();
    updateViewingPills();
    Home.render();
    Settings.render();
    return;
  }
  _appStarted = true;

  // Initial render
  try { Home.render(); } catch (err) { console.error("Boot — Home.render:", err); }
  try { Settings.render(); } catch (err) { console.error("Boot — Settings.render:", err); }
  try { updateCoachHeader(); } catch {}
  try { updateViewingPills(); } catch {}

  // Navigation
  $$(".nav-btn").forEach(btn =>
    btn.addEventListener("click", () => { haptic(4); Router.show(btn.dataset.screen); })
  );
  // Quick-cards (data-screen but not nav buttons or screens)
  $$("[data-screen]:not(.nav-btn):not(.screen)").forEach(el =>
    el.addEventListener("click", () => Router.show(el.dataset.screen))
  );

  // Game viewer
  GameViewer.bindControls();
  Games.bindGameViewer();

  // Puzzle
  bindPuzzleActions();

  // Modals
  bindProfileModal();
  bindSwipeToClose();
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") Modal.closeAll();
    if (e.key === "Tab")    Modal.trapFocus(e);
  });
  $$(".modal-overlay").forEach(m =>
    m.addEventListener("click", e => { if (e.target === m) Modal.close(m.id); })
  );

  // Rating chip → rating modal
  bindRatingModal();

  // Tournaments
  Tournament.bind($("tournaments-list"), $("tournament-detail-content"), msg => Toast.show(msg));
  $("close-tournament-modal")?.addEventListener("click", () => Modal.close("tournament-detail-modal"));
  Tournament.startAutoRefresh($("tournaments-list"), 60000);

  // Filter chips — reset _shown on new filter
  $$(".filter-chip").forEach(btn =>
    btn.addEventListener("click", () => {
      $$(".filter-chip").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      Games._shown = Games._pageSize;
      Games.render(btn.dataset.filter);
    })
  );

  // AI coach & coach screen
  AICoach.bind();
  bindCoachScreen();
  renderRoadmap();
  updateCoachHeader();
  updateViewingPills();

  // Settings
  $("sync-data-btn")?.addEventListener("click", async () => {
    let result = null;
    try {
      result = await LiveSync.syncAll({
        toast: (m, ms) => Toast.show(m, ms),
        setBadge: setSyncBadge,
        setBusy: setSyncBusy,
      });
    } catch (err) {
      console.warn("Sync failed:", err);
      Toast.show(friendlySyncError(err?.message || err), 3400);
      return;
    }
    // Refresh key screens after successful/partial sync (keeps existing functionality intact)
    Home.render();
    Progress.render();
    const f = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    Games.render(f);
    Settings.render();
    // Update settings pill immediately
    if (result?.ts) {
      const t = new Date(result.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setText("last-sync-time", `Last synced: ${t}`);
    }
    if (result?.errors?.length) Toast.show(friendlySyncError(result.errors[0]), 3200);
  });
  $("save-account-settings-btn")?.addEventListener("click", () => {
    State.updateProfile({
      chesscom: $("settings-chesscom-input")?.value.trim() || "",
      lichess: $("settings-lichess-input")?.value.trim() || "",
      lichessToken: $("settings-lichess-token-input")?.value.trim() || "",
    });
    Settings.render();
    Toast.show("Account settings saved");
  });
  $("logout-btn")?.addEventListener("click", () => {
    if (!confirm("Logout and return to login screen?")) return;
    AUTH.logout();
  });
  $("reset-data-btn")?.addEventListener("click", () => {
    if (!confirm("Reset all app data to defaults? This cannot be undone.")) return;
    State.resetAll();
    // Re-init all screens
    Home.render();
    Games._shown = Games._pageSize;
    Games.render("all");
    // Reset filter chip UI
    $$(".filter-chip").forEach(c => c.classList.toggle("active", c.dataset.filter === "all"));
    Toast.show("Data reset to defaults ✓");
  });
  $("refresh-insights-btn")?.addEventListener("click", () => {
    Progress.render(); Toast.show("Insights refreshed ✓");
  });

  // State subscriptions
  State.on("profileChanged", () => { updateViewingPills(); Home.render(); Settings.render(); });
  State.on("gamesChanged", () => {
    const f = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    Games.render(f); Progress.render(); Home.render();
  });
  State.on("userChanged", () => {
    // Smooth multi-user switching: rerender all relevant screens
    updateCoachHeader();
    updateViewingPills();
    Home.render();
    Progress.render();
    const f = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    Games._shown = Games._pageSize;
    Games.render(f);
    Settings.render();
    renderRoadmap();
  });
  State.on("tournamentsChanged", () => Tournament.render($("tournaments-list")));
  State.on("coachFeedbackAdded", () => Progress.render());
  State.on("assignmentsChanged", () => { Home.renderTodayPlan(); updateNavBadge(); });
  State.on("reset", () => {
    Home.render();
    Games.render("all");
    Progress.render();
    Settings.render();
    Tournament.render($("tournaments-list"));
    Coach.renderCoachPanel($("coach-notes-list"), onCoachAction);
    renderRoadmap();
    updateCoachHeader();
    updateViewingPills();
  });

  // Background ratings sync (non-blocking, 3s delay)
  setTimeout(() => {
    if (!navigator.onLine) return;
    LiveSync.syncRatings()
      .then(r => { if (r && Object.keys(r).length) Toast.show("📡 Live ratings updated", 1800); })
      .catch(() => {});
  }, 3000);

  initPWA();
}

function boot() {
  bindFirstTimeLogin();
  if (!AUTH.isLoggedIn()) {
    AUTH.showLoginGate();
    return;
  }
  AUTH.showApp();
  initApp();
}

window.addEventListener("DOMContentLoaded", boot);