"use strict";
// ═══════════════════════════════════════════════════════════
// components/ai-chat.js — AI Coach chat widget
//
// Responsibilities:
//   · Provider badge (which AI is active)
//   · Quick-action chips
//   · Send/receive messages, manage chat history
//   · Thinking animation → replace with response
//   · Toolbar: clear, export, copy last, inject PGN
//   · AI Setup modal (provider selection + API key)
// ═══════════════════════════════════════════════════════════

import { State }                   from "../state.js";
import { AI, AI_CONFIG, ChatHistory } from "../ai.js";
import { esc }                     from "../coach.js";
import { $, Toast, Modal, haptic } from "../ui-core.js";

// ── Quick-action chips ────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "♟ Analyse last game",  msg: "Can you analyse my most recent game and tell me what I could have done better?" },
  { label: "🧩 Give me a puzzle",  msg: "Give me a daily puzzle prescription and explain what tactical patterns I should focus on." },
  { label: "📖 Fix my opening",    msg: "What openings should I be playing at my current rating, and how can I improve my opening preparation?" },
  { label: "🏰 Endgame tips",      msg: "What endgame techniques should I be mastering at my current rating level?" },
  { label: "💪 Motivate me",       msg: "I want to improve — what's the most impactful thing I can do this week to gain rating points?" },
  { label: "🎯 Tactical training", msg: "Design a tactical training plan for me based on my weaknesses and current rating." },
];

// ── Provider setup instructions ───────────────────────────────
const PROVIDER_INFO = {
  openrouter: {
    label: "OpenRouter (Recommended — free Llama 3.3 70B)",
    html: `<strong>OpenRouter — free Llama 3.3 70B</strong><br>
      1. Go to <a href="https://openrouter.ai" target="_blank" style="color:var(--brand3)">openrouter.ai</a> → Sign up free<br>
      2. API Keys → Create new key<br>
      3. Free tier includes <strong>meta-llama/llama-3.3-70b-instruct:free</strong><br>
      4. Paste your key below and save.`,
    needsKey: true,
  },
  gemini: {
    label: "Google Gemini Flash (Free — very fast)",
    html: `<strong>Google Gemini Flash — generous free tier</strong><br>
      1. Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--brand3)">aistudio.google.com</a><br>
      2. Click <em>Create API key</em> — no billing required<br>
      3. Uses <strong>gemini-2.0-flash</strong><br>
      4. Paste your key below.`,
    needsKey: true,
  },
  groq: {
    label: "Groq (Free — ultra-fast inference)",
    html: `<strong>Groq — blazing-fast free tier</strong><br>
      1. Go to <a href="https://console.groq.com" target="_blank" style="color:var(--brand3)">console.groq.com</a> → Sign up<br>
      2. API Keys → Create key<br>
      3. Uses <strong>llama-3.3-70b-versatile</strong><br>
      4. Paste your key below.`,
    needsKey: true,
  },
  proxy: {
    label: "Custom Proxy (Anthropic Claude / other)",
    html: `<strong>Custom Proxy — Anthropic Claude or any model</strong><br>
      Deploy a Cloudflare Worker or Vercel function (see <code>proxy.js</code> for the template),
      then set <code>PROXY_URL</code> in proxy.js. Gives access to Claude Sonnet — best chess coaching quality.`,
    needsKey: false,
  },
  local: {
    label: "Local Mode — No key needed",
    html: `<strong>Offline Mode — no API key required</strong><br>
      Uses built-in chess coaching logic with your game data. Works fully offline.`,
    needsKey: false,
  },
};

// ── Minimal markdown → HTML formatter ─────────────────────────
function safeFormat(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g,       "<em>$1</em>")
    .replace(/^(\d+\.) /gm,    '<span style="font-weight:600;color:var(--brand3)">$1</span> ')
    .replace(/^(#{1,3}) (.+)$/gm, (_, h, t) =>
      `<div style="font-weight:700;color:var(--text);margin-top:8px;font-size:${h.length === 1 ? 15 : 13}px">${t}</div>`)
    .replace(/\[([^\]]+)\]\(#setup-ai\)/g,
      `<a href="#" class="inline-setup-link" style="color:var(--brand3);text-decoration:underline">$1</a>`)
    .replace(/\n/g, "<br>");
}

// ── Main export ───────────────────────────────────────────────
export const AICoach = {
  _history: [],
  _sending: false,

  /** Call once at boot — sets up the whole chat widget. */
  bind() {
    this._history = ChatHistory.load();
    this._renderHistory();
    this._renderProviderBadge();
    this._renderQuickActions();
    this._bindInput();
    this._bindToolbar();
    this._bindSetupModal();
    if (!this._history.length) this._showWelcome();
  },

  // ── Welcome message ────────────────────────────────────────
  _showWelcome() {
    const { profile: p, games } = State.get();
    const first    = p.fullName?.split(" ")[0] || "there";
    const gameInfo = games.length
      ? `${games.length} recent games to analyse`
      : "no games synced yet — sync first for personalised advice";
    this._appendMsg("assistant", [
      `👋 Hi ${first}! I'm **Coach Anand**, your personal AI chess coach.`,
      `You're rated **${p.rating}** with ${gameInfo}.`,
      "I can help with openings, tactics, endgames, game analysis, and training plans.",
      "**Try a quick action below**, or ask me anything!",
    ].join(" "), /* persist */ false);
  },

  // ── Render persisted history ───────────────────────────────
  _renderHistory() {
    const wrap = $("ai-chat-messages");
    if (!wrap) return;
    wrap.innerHTML = "";
    this._history.forEach(h => { if (h.content) this._appendMsg(h.role, h.content, false); });
    setTimeout(() => { wrap.scrollTop = wrap.scrollHeight; }, 50);
  },

  // ── Provider badge ─────────────────────────────────────────
  _renderProviderBadge() {
    const badge = $("ai-provider-badge");
    if (!badge) return;
    const label  = AI.getProviderLabel();
    const isLive = AI.hasApiKey();
    const dot    = `<span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;
                                 background:${isLive ? "var(--brand)" : "var(--saffron)"}"></span>`;
    const setupBtn = !isLive
      ? `<button id="ai-setup-link" style="background:none;border:none;color:var(--brand3);
                  font-size:10px;cursor:pointer;padding:0;margin-left:2px;text-decoration:underline">
           Set up free key ↗
         </button>`
      : "";
    badge.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;
                   color:var(--muted);padding:3px 8px;background:var(--surface);
                   border-radius:20px;border:1px solid var(--border)">
        ${dot}${esc(label)}${setupBtn}
      </span>`;
    $("ai-setup-link")?.addEventListener("click", () => Modal.open("ai-setup-modal"));
  },

  // ── Quick-action chips ─────────────────────────────────────
  _renderQuickActions() {
    const host = $("ai-quick-actions");
    if (!host) return;
    host.innerHTML = QUICK_ACTIONS.map(a =>
      `<button class="ai-quick-btn" data-msg="${esc(a.msg)}"
               style="background:var(--surface);border:1px solid var(--border);
                      border-radius:20px;padding:6px 12px;font-size:11px;
                      color:var(--text2);cursor:pointer;white-space:nowrap;
                      transition:border-color .15s,background .15s;flex-shrink:0">
         ${esc(a.label)}
       </button>`
    ).join("");
    host.addEventListener("click", e => {
      const btn = e.target?.closest(".ai-quick-btn");
      if (btn?.dataset.msg) this._sendMessage(btn.dataset.msg);
    });
  },

  // ── Input row ──────────────────────────────────────────────
  _bindInput() {
    const input   = $("ai-input");
    const sendBtn = $("ai-send-btn");
    if (!input || !sendBtn) return;

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
    // Auto-grow
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  },

  // ── Toolbar ────────────────────────────────────────────────
  _bindToolbar() {
    // Clear
    $("ai-clear-btn")?.addEventListener("click", () => {
      if (!this._history.length || !confirm("Clear chat history?")) return;
      this._history = [];
      ChatHistory.clear();
      const wrap = $("ai-chat-messages");
      if (wrap) wrap.innerHTML = "";
      this._showWelcome();
      Toast.show("Chat cleared");
    });

    // Export
    $("ai-export-btn")?.addEventListener("click", () => {
      if (!this._history.length) { Toast.show("No chat history to export"); return; }
      ChatHistory.export(this._history);
      Toast.show("Chat exported ✓");
    });

    // Copy last assistant message
    $("ai-copy-btn")?.addEventListener("click", () => {
      const last = [...this._history].reverse().find(h => h.role === "assistant");
      if (!last) { Toast.show("No response to copy"); return; }
      navigator.clipboard?.writeText(last.content)
        .then(() => Toast.show("Copied ✓"))
        .catch(() => {
          // Legacy fallback
          const ta = Object.assign(document.createElement("textarea"), { value: last.content });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          Toast.show("Copied ✓");
        });
    });

    // Inject last game PGN
    $("ai-pgn-btn")?.addEventListener("click", () => {
      const g = State.get().games[0];
      if (!g) { Toast.show("No recent games — sync first"); return; }
      const input   = $("ai-input");
      if (!input) return;
      const snippet = g.pgn ? g.pgn.slice(0, 200) + (g.pgn.length > 200 ? "…" : "") : "(no PGN)";
      const outcome = g.result === "win" ? "and won" : g.result === "loss" ? "and lost" : "(draw)";
      input.value = `Please analyse this game I played ${outcome} against ${g.opp}. Opening: ${g.opening}. PGN: ${snippet}`;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
      input.focus();
    });
  },

  // ── Setup modal ────────────────────────────────────────────
  _bindSetupModal() {
    if (!$("ai-setup-modal")) this._injectSetupModal();

    $("ai-setup-save-btn")?.addEventListener("click", () => {
      const provider = $("ai-provider-select")?.value || "openrouter";
      const key      = $("ai-api-key-input")?.value.trim() || "";
      const keyMap   = { openrouter: "openrouterKey", gemini: "geminiKey", groq: "groqKey" };
      const config   = { provider };
      if (keyMap[provider] && key) config[keyMap[provider]] = key;
      AI.configure(config);
      Modal.close("ai-setup-modal");
      this._renderProviderBadge();
      Toast.show("AI Coach configured ✓ — try sending a message!");
      haptic(15);
    });

    $("ai-setup-close-btn")
      ?.addEventListener("click", () => Modal.close("ai-setup-modal"));
    $("ai-provider-select")
      ?.addEventListener("change", () => this._updateSetupInstructions());
  },

  _injectSetupModal() {
    const providerOptions = Object.entries(PROVIDER_INFO)
      .map(([v, p]) => `<option value="${v}">${p.label}</option>`)
      .join("");

    const modal = document.createElement("div");
    modal.id        = "ai-setup-modal";
    modal.className = "modal-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-sheet" style="max-width:480px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:17px;font-weight:700;color:var(--text)">🤖 Set Up Free AI Coach</div>
          <button id="ai-setup-close-btn" class="btn btn-ghost btn-sm">✕</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6;
                    padding:10px;background:var(--surface);border-radius:var(--r);border:1px solid var(--border)">
          The AI Coach works <strong>for free</strong> — grab a key from any provider below.
          No credit card needed for any free tier.
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px">AI Provider</label>
          <select id="ai-provider-select" class="form-input" style="width:100%">${providerOptions}</select>
        </div>
        <div id="ai-setup-instructions"
             style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.7;
                    padding:10px;background:var(--surface);border-radius:var(--r)"></div>
        <div id="ai-key-field" style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px">API Key</label>
          <input id="ai-api-key-input" class="form-input" type="password"
                 placeholder="Paste your API key here" style="width:100%" autocomplete="off"/>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:16px">
          🔒 Your key is stored only in this browser (localStorage) — it never leaves your device.
        </div>
        <button id="ai-setup-save-btn" class="btn btn-primary btn-full">Save & Activate</button>
        <div style="margin-top:12px;text-align:center;font-size:11px;color:var(--muted)">
          ⚠️ AI Coach gives general chess advice. Use engine analysis for move-by-move accuracy.
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) Modal.close("ai-setup-modal"); });
    this._updateSetupInstructions();
  },

  _updateSetupInstructions() {
    const provider = $("ai-provider-select")?.value || "openrouter";
    const info     = PROVIDER_INFO[provider];
    const host     = $("ai-setup-instructions");
    const keyField = $("ai-key-field");
    if (host)     host.innerHTML = info?.html || "";
    if (keyField) keyField.style.display = info?.needsKey ? "" : "none";
  },

  // ── Message send / receive ─────────────────────────────────
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
      console.error("[AICoach]", err);
      this._replaceThinking("Sorry, something went wrong. Please try again in a moment.");
    } finally {
      this._sending = false;
    }
  },

  // ── DOM helpers ────────────────────────────────────────────
  _appendMsg(role, text, persist = true) {
    const wrap = $("ai-chat-messages");
    if (!wrap) return;

    const div       = document.createElement("div");
    div.className   = `ai-msg${role === "user" ? " user" : ""}`;
    div.dataset.role = role;

    div.innerHTML = role === "user"
      ? `<div class="ai-bubble user-bubble">${esc(text || "")}</div>`
      : `<div class="ai-avatar" aria-hidden="true">♞</div>
         <div class="ai-bubble assistant-bubble">${safeFormat(text || "")}</div>`;

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
    const div       = document.createElement("div");
    div.className   = "ai-msg";
    div.id          = "ai-thinking-row";
    div.innerHTML   = `
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
      if (bubble) {
        bubble.id = "";
        bubble.removeAttribute("aria-label");
        bubble.innerHTML = safeFormat(text);
      }
    } else {
      this._appendMsg("assistant", text, false);
    }
    $("ai-chat-messages")?.scrollTo({ top: 99_999, behavior: "smooth" });
  },
};

// Handle inline "Set up AI" links embedded in formatted responses
document.addEventListener("click", e => {
  if (e.target?.classList.contains("inline-setup-link")) {
    e.preventDefault();
    Modal.open("ai-setup-modal");
  }
});
