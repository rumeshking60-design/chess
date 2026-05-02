"use strict";
// ═══════════════════════════════════════════════════════════
// coach.js — Coach auth, feedback, assignments, weakness analysis
// ─────────────────────────────────────────────────────────
// ⚠️ SECURITY WARNING: The auth below is DEMO-ONLY.
// The hash is visible in source. Replace with a real backend
// session (Firebase Auth, Supabase, etc.) before deploying.
// ═══════════════════════════════════════════════════════════

import { State } from "./state.js";

// ── Demo credentials ─────────────────────────────────────────
// SHA-256 of "coach123". Change via proper backend before going live.
const DEFAULT_HASH = "b94a8fe5ccb19ba61c4c0873d391e987982fbbd3258bfc5bcb7ee0104f8edb8c";

const COACH_CONFIG = {
  email:   "coach@chessacademy.local",
  pwdHash: DEFAULT_HASH,
  name:    "Your Coach",
  title:   "Coach Mode · Assignments & Feedback",
};

async function hashPw(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Show warning when default credentials are used on a public URL
const _isDefaultCreds  = () => COACH_CONFIG.pwdHash === DEFAULT_HASH;
const _isRemoteOrigin  = () => !["localhost", "127.0.0.1", ""].includes(location.hostname)
                              && !location.hostname.startsWith("192.168.");
const _showSecBanner   = () => _isRemoteOrigin() && _isDefaultCreds();

// ── Shared utilities (exported for other modules) ────────────
export const esc = v =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtDate = iso => {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

// ── HTML template helpers ─────────────────────────────────────
export const tmpl = {
  securityWarningBanner() {
    return `
      <div id="coach-security-banner" role="alert"
           style="margin:0 16px 10px;padding:12px 14px;
                  background:#3d2800;border:1px solid var(--saffron);
                  border-radius:var(--r);display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:18px;flex-shrink:0">⚠️</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--saffron);margin-bottom:4px">
            Default coach credentials detected
          </div>
          <div style="font-size:12px;color:var(--text2);line-height:1.5">
            This app is using the demo password ("coach123") on a public URL.
            Anyone reading the source can log in as coach.
            <strong style="color:var(--saffron)">Change your password before sharing.</strong>
          </div>
        </div>
        <button onclick="this.closest('#coach-security-banner').remove()"
                title="Dismiss" aria-label="Dismiss warning"
                style="background:none;border:none;color:var(--saffron);font-size:16px;cursor:pointer;flex-shrink:0;padding:0">✕</button>
      </div>`;
  },

  loginBlock() {
    return `
      <div class="card" style="margin:0 16px 10px">
        <div class="card-inner">
          <div class="section-title" style="font-size:15px;margin-bottom:12px">Coach Login</div>
          <input id="coach-email" class="form-input" type="email"
            placeholder="coach@chessacademy.local" autocomplete="email"
            style="margin-bottom:8px" aria-label="Coach email">
          <input id="coach-password" class="form-input" type="password"
            placeholder="Enter coach password" autocomplete="current-password"
            style="margin-bottom:10px" aria-label="Coach password">
          <button id="coach-login-btn" class="btn btn-primary btn-full">Login as Coach</button>
          <div id="coach-login-error" role="alert"
               style="font-size:11px;color:var(--red);margin-top:6px;display:none"></div>
        </div>
      </div>`;
  },

  coachActiveBlock(name) {
    return `
      <div class="card" style="margin:0 16px 10px">
        <div class="card-inner" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--brand3)">🟢 Coach Mode Active</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(name)}</div>
          </div>
          <button id="coach-logout-btn" class="btn btn-secondary btn-sm">Logout</button>
        </div>
      </div>`;
  },

  studentsDashboard(students, currentUserId) {
    const cards = students.length
      ? students.map(s => {
          const p = s.profile || {};
          const title   = p.fullName || p.chesscom || s.id;
          const handles = [
            p.chesscom && `Chess.com: ${p.chesscom}`,
            p.lichess  && `Lichess: ${p.lichess}`,
          ].filter(Boolean).join(" · ");
          const lastSync = s.lastSync
            ? new Date(s.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : "Never";
          const active = String(currentUserId || "").toLowerCase() === String(s.id || "").toLowerCase();
          return `
            <button class="btn btn-secondary btn-full"
                    style="justify-content:space-between;margin-bottom:8px;${active ? "border-color:rgba(139,186,92,.35)" : ""}"
                    data-switch-student="${esc(s.id)}">
              <span style="text-align:left">
                <span style="display:block;font-weight:700">${esc(title)}</span>
                <span style="display:block;font-size:11px;color:var(--muted);font-weight:500">
                  ${esc(handles || "—")}${p.rating ? ` · Rating ${esc(p.rating)}` : ""} · Synced ${esc(lastSync)}
                </span>
              </span>
              <span style="color:${active ? "var(--brand3)" : "var(--muted)"};font-size:16px">${active ? "✓" : "›"}</span>
            </button>`;
        }).join("")
      : `<div style="text-align:center;padding:16px;color:var(--muted);font-size:12px">No students found on this device yet.</div>`;

    return `
      <div class="card" style="margin:0 16px 10px">
        <div class="card-inner">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
            <div>
              <div class="section-title" style="font-size:15px">My Students</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">Select a student to view their dashboard.</div>
            </div>
            <span class="pill pill-blue" style="font-size:10px">Coach</span>
          </div>
          ${cards}
        </div>
      </div>`;
  },

  feedbackForm(gameOptions) {
    const CATEGORIES = ["Technique", "Tactics", "Endgame", "Opening", "Time Management", "Mindset"];
    const FOCUS_OPTS = [
      ["endgames",       "Endgames"],
      ["tactics",        "Tactics"],
      ["openings",       "Openings"],
      ["calculation",    "Calculation"],
      ["time management","Time Management"],
    ];
    return `
      <div class="card" style="margin:0 16px 10px">
        <div class="card-inner">
          <div class="section-title" style="font-size:15px;margin-bottom:12px">Add Feedback</div>
          <select id="coach-game-id" class="form-input" style="margin-bottom:8px" aria-label="Select game">
            ${gameOptions}
          </select>
          <select id="coach-category" class="form-input" style="margin-bottom:8px" aria-label="Feedback category">
            ${CATEGORIES.map(c => `<option>${c}</option>`).join("")}
          </select>
          <select id="coach-focus" class="form-input" style="margin-bottom:8px" aria-label="Training focus">
            ${FOCUS_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
          <textarea id="coach-comment" class="form-input" rows="3"
            placeholder="Structured feedback for this game…"
            style="resize:vertical;min-height:72px;margin-bottom:8px"
            aria-label="Coach comment"></textarea>
          <button id="coach-save-feedback" class="btn btn-primary btn-full" style="margin-bottom:8px">
            💾 Save Feedback
          </button>
          <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
            <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">Add Assignment</div>
            <input id="assign-title" class="form-input" placeholder="Assignment title"
              style="margin-bottom:6px" aria-label="Assignment title">
            <input id="assign-desc"  class="form-input" placeholder="Description (optional)"
              style="margin-bottom:6px" aria-label="Assignment description">
            <input id="assign-due"   class="form-input" type="date"
              style="margin-bottom:8px" aria-label="Due date">
            <button id="coach-add-assignment" class="btn btn-secondary btn-full" style="font-size:12px">
              + Add Assignment
            </button>
          </div>
        </div>
      </div>`;
  },

  feedbackCard(f) {
    const pillCls = f.category === "Tactics" ? "pill-saffron"
                  : f.category === "Endgame"  ? "pill-blue"
                  : "pill-brand";
    return `
      <div class="coach-note-card"
           style="background:var(--surface);border:1px solid var(--border);
                  border-radius:var(--r);padding:13px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
          <span class="pill ${pillCls}" style="font-size:10px">${esc(f.category)}</span>
          <span style="font-size:10px;color:var(--muted)">${fmtDate(f.at)}</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">On: <em>${esc(f.gameLabel)}</em></div>
        <div style="font-size:13px;color:var(--text);line-height:1.5">${esc(f.comment)}</div>
        <div style="margin-top:6px;font-size:11px;color:var(--muted)">
          Focus → <strong style="color:var(--brand3)">${esc(f.focus)}</strong> · Coach ${esc(f.coachName)}
        </div>
      </div>`;
  },

  weaknessRow(w) {
    const COLOR = { danger: "--red", warn: "--saffron", info: "--blue", success: "--brand3" };
    const c = COLOR[w.type] || "--text2";
    return `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:18px">${w.icon}</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(${c})">${esc(w.label)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(w.detail)}</div>
        </div>
      </div>`;
  },

  assignmentRow(a, isCoach) {
    const done = a.status === "done";
    return `
      <div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);align-items:flex-start">
        <span style="font-size:18px">${done ? "✅" : "📋"}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;${done ? "color:var(--muted);text-decoration:line-through" : "color:var(--text)"}">
            ${esc(a.title)}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(a.desc)}</div>
          <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span class="pill pill-gray" style="font-size:10px">Due ${esc(a.due)}</span>
            ${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener" style="font-size:10px;color:var(--blue)">Open ↗</a>` : ""}
            ${!done && !isCoach
              ? `<button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:10px"
                         data-complete-assignment="${esc(a.id)}">Mark Done</button>`
              : ""}
          </div>
        </div>
      </div>`;
  },

  viewingPill(studentName) {
    return `
      <div style="margin:0 16px 8px;display:flex;align-items:center;gap:8px">
        <span class="pill pill-brand" style="font-size:10px">Viewing: ${esc(studentName || "Student")}</span>
      </div>`;
  },

  sectionLabel: text =>
    `<div style="margin:0 16px 2px;font-size:11px;color:var(--muted);
                 text-transform:uppercase;letter-spacing:.08em;font-weight:600">${esc(text)}</div>`,

  emptyState: msg =>
    `<div style="color:var(--muted);font-size:13px;padding:8px 0">${msg}</div>`,
};

// ── Weakness analysis ─────────────────────────────────────────
function analyzeWeaknesses(games) {
  if (!games.length) return [];

  const losses        = games.filter(g => g.result === "loss");
  const totalBlunders = games.reduce((s, g) => s + (g.blunders ?? 0), 0);
  const avgAcc        = games.reduce((s, g) => s + (g.accuracy ?? 80), 0) / games.length;

  const openingLosses = {};
  losses.forEach(g => { openingLosses[g.opening] = (openingLosses[g.opening] || 0) + 1; });
  const worstOpening = Object.entries(openingLosses).sort((a, b) => b[1] - a[1])[0];

  const insights = [];

  if (totalBlunders / games.length > 1.2)
    insights.push({ type: "danger", icon: "⚠️", label: "High blunder rate",
      detail: `${(totalBlunders / games.length).toFixed(1)} blunders/game — slow down and calculate before each move.` });

  if (avgAcc < 82)
    insights.push({ type: "warn", icon: "📉", label: "Accuracy below target",
      detail: `Avg ${avgAcc.toFixed(0)}% — aim for 85%+ with slower, more deliberate thinking.` });

  if (worstOpening)
    insights.push({ type: "info", icon: "📖", label: `Weak opening: ${worstOpening[0]}`,
      detail: `${worstOpening[1]} losses. Study the main plans and typical middlegame structures.` });

  if (losses.length / games.length > 0.45)
    insights.push({ type: "warn", icon: "♟", label: "Win rate below 55%",
      detail: "Focus on converting won positions — endgame technique is the highest-leverage fix." });

  if (!insights.length)
    insights.push({ type: "success", icon: "✅", label: "Strong overall performance",
      detail: `${avgAcc.toFixed(0)}% avg accuracy — keep up the consistency.` });

  return insights;
}

// ── Today's training plan ─────────────────────────────────────
const FOCUS_MAP = {
  endgames:          { icon: "♜", title: "Rook Endgame Studies",     sub: "30 min · Lichess practice",           link: "https://lichess.org/practice/rook-endings" },
  tactics:           { icon: "⚡", title: "Tactical Puzzles",          sub: "20 puzzles at your current rating",    link: "" },
  openings:          { icon: "📖", title: "Opening Repertoire Review", sub: "15 min · Focus on problem lines",     link: "" },
  calculation:       { icon: "🧮", title: "Calculation Training",      sub: "3 complex positions · 10 min each",   link: "" },
  "time management": { icon: "⏱", title: "Blitz Practice",            sub: "5 blitz games — play fast, think clearly", link: "" },
};

function generateTodayPlan(state) {
  const { trainingFocus, games, puzzle, assignments } = state;
  const plans = [];

  // Coach assignment takes top slot
  const pending = (assignments || []).filter(a => a.status === "pending");
  if (pending.length) {
    plans.push({ icon: "📋", title: `Coach Task: ${pending[0].title}`,
      sub: `Due ${pending[0].due}`, link: pending[0].link || "" });
  }

  // Training focus items
  trainingFocus.slice(0, 3).forEach(f => {
    const item = FOCUS_MAP[f];
    if (item) plans.push(item);
  });

  // Always include a daily puzzle item
  if (!plans.some(p => p.title.includes("Puzzle"))) {
    plans.push({ icon: "🧩", title: "Daily Puzzle Challenge",
      sub: `Current streak: ${puzzle?.streak ?? 0} days`, link: "" });
  }

  return plans.slice(0, 4);
}

// ── Coach panel renderer ──────────────────────────────────────
function renderCoachPanel(container, onAction) {
  if (!container) return;

  const st         = State.get();
  const isCoach    = st.coachAuth?.loggedIn;
  const games      = st.games.slice(0, 15);
  const weaknesses = analyzeWeaknesses(games);
  const students   = (State.listUsers?.() || [])
    .map(u => State.getUserSummary?.(u.id))
    .filter(Boolean);

  const gameOptions = games
    .map(g => `<option value="${esc(g.id)}">${esc(g.date)} — ${esc(g.opening)} (${esc(g.result)})</option>`)
    .join("");

  const feedbackHtml = st.coachFeedback?.length
    ? st.coachFeedback.slice(0, 8).map(f => tmpl.feedbackCard(f)).join("")
    : tmpl.emptyState("No coach notes yet");

  const weaknessHtml = weaknesses.length
    ? weaknesses.map(w => tmpl.weaknessRow(w)).join("")
    : tmpl.emptyState("Analysing games…");

  const assignHtml = st.assignments?.length
    ? st.assignments.slice(0, 4).map(a => tmpl.assignmentRow(a, isCoach)).join("")
    : tmpl.emptyState("No assignments yet");

  container.innerHTML = [
    _showSecBanner() ? tmpl.securityWarningBanner() : "",
    isCoach ? tmpl.coachActiveBlock(st.coachAuth.name || COACH_CONFIG.name) : tmpl.loginBlock(),
    isCoach ? tmpl.studentsDashboard(students, st.currentUserId) : "",
    isCoach ? tmpl.feedbackForm(gameOptions) : "",
    tmpl.sectionLabel("Weakness Analysis"),
    `<div class="card" style="margin:6px 16px 10px"><div class="card-inner" style="padding:8px 14px">${weaknessHtml}</div></div>`,
    tmpl.sectionLabel("Assignments"),
    `<div class="card" style="margin:6px 16px 10px"><div class="card-inner" style="padding:8px 14px">${assignHtml}</div></div>`,
    tmpl.sectionLabel("Coach Feedback"),
    `<div style="margin:6px 16px 10px">${feedbackHtml}</div>`,
  ].join("");

  // Bind assignment-complete buttons
  container.querySelectorAll("[data-complete-assignment]").forEach(btn => {
    btn.addEventListener("click", () => {
      State.updateAssignment(btn.dataset.completeAssignment, { status: "done" });
      onAction("assignmentCompleted");
      renderCoachPanel(container, onAction);
    });
  });

  // Bind student-switch buttons
  container.querySelectorAll("[data-switch-student]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.switchStudent;
      if (!id) return;
      State.switchUser(id);
      onAction("studentSwitched");
      renderCoachPanel(container, onAction);
    });
  });
}

// ── Public API ────────────────────────────────────────────────
export const Coach = {
  CONFIG: COACH_CONFIG,
  tmpl,

  async login(email, password) {
    if (email.trim().toLowerCase() !== COACH_CONFIG.email) return false;
    const ok = (await hashPw(password)) === COACH_CONFIG.pwdHash;
    if (ok) State.setCoachAuth({ loggedIn: true, role: "coach", name: COACH_CONFIG.name });
    return ok;
  },

  logout() {
    State.setCoachAuth({ loggedIn: false, role: "student", name: "" });
  },

  addFeedback({ gameId, category, comment, focus }) {
    const st   = State.get();
    const game = st.games.find(g => g.id === gameId);
    if (!game)             return { ok: false, message: "Select a valid game." };
    if (!comment?.trim())  return { ok: false, message: "Comment cannot be empty." };

    State.addCoachFeedback({
      id:        `cf-${Date.now()}`,
      at:        new Date().toISOString(),
      coachName: st.coachAuth?.name || COACH_CONFIG.name,
      gameId,
      gameLabel: `${game.opening} vs ${game.opp}`,
      category,
      comment:   comment.trim(),
      focus,
    });

    // Merge focus area into training focus (max 4 items, no duplicates)
    const merged = [...new Set([focus, ...st.trainingFocus].filter(Boolean))].slice(0, 4);
    State.setTrainingFocus(merged);
    return { ok: true };
  },

  addAssignment({ title, desc, due }) {
    if (!title?.trim()) return { ok: false, message: "Title required." };
    State.addAssignment({
      id:     `as-${Date.now()}`,
      title:  title.trim(),
      desc:   desc?.trim() || "",
      due:    due || "TBD",
      status: "pending",
      link:   "",
    });
    return { ok: true };
  },

  analyzeWeaknesses,
  generateTodayPlan,
  renderCoachPanel,
};
