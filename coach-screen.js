"use strict";

import { State }   from "./state.js";
import { Coach, esc, tmpl as coachTmpl } from "./coach.js";
import { $, Toast, haptic, setText, updateNavBadge } from "./ui-core.js";

const isCoachViewing = () => State.get().loginState?.role === "coach";

const MILESTONES = [
  { rating: 1600, label: "1600 Club",        icon: "⭐", detail: "Solid opening knowledge" },
  { rating: 1700, label: "1700 Club",        icon: "🎯", detail: "Tactical vision & endgame basics" },
  { rating: 1800, label: "1800 Club",        icon: "🏆", detail: "Strategic planning unlocked" },
  { rating: 1900, label: "Candidate Master", icon: "🌟", detail: "Tournament-level preparation" },
  { rating: 2000, label: "Expert",           icon: "👑", detail: "Full game mastery" },
];

export function renderRoadmap() {
  const host = $("roadmap-list");
  if (!host) return;

  const r = State.get().profile.rating;

  host.innerHTML = MILESTONES.map((m, i) => {
    const done   = r >= m.rating;
    const active = !done && (i === 0 || r >= MILESTONES[i - 1].rating);
    const cls    = done ? "done" : active ? "active" : "locked";

    const badge = done
      ? `<div class="rm-badge"><span class="pill pill-brand" style="font-size:10px">✓ Achieved</span></div>`
      : active
      ? `<div class="rm-badge"><span class="pill pill-saffron" style="font-size:10px">Current goal — ${m.rating - r} pts away</span></div>`
      : "";

    return `
      <div class="roadmap-item">
        ${i < MILESTONES.length - 1 ? '<div class="roadmap-line"></div>' : ""}
        <div class="rm-dot ${cls}">${done ? "✓" : m.icon}</div>
        <div class="rm-content">
          <div class="rm-title">${esc(m.label)}</div>
          <div class="rm-meta">${esc(m.detail)}</div>
          ${badge}
        </div>
      </div>`;
  }).join("");
}

export function updateCoachHeader() {
  const st = State.get();
  const loggedIn = st.coachAuth?.loggedIn;

  const name  = loggedIn
    ? (st.coachAuth?.name || Coach.CONFIG?.name || "Coach")
    : (st.profile?.schoolCoach || "Coach");
  const title = loggedIn
    ? (Coach.CONFIG?.title || "Coach mode")
    : (st.profile?.category ? `${st.profile.category} training` : "Coach notes");

  setText("coach-name-title", `Coach ${name}`.trim());
  setText("coach-tagline", title);

  const av = $("coach-avatar-initial");
  if (av) av.textContent = (String(name).trim()[0] || "C").toUpperCase();
}

export function updateViewingPills() {
  const st   = State.get();
  const name = st.profile?.fullName || st.profile?.chesscom || st.currentUserId || "Student";
  const html = isCoachViewing() ? coachTmpl.viewingPill(name) : "";

  ["viewing-pill-home", "viewing-pill-progress", "viewing-pill-games", "viewing-pill-coach"]
    .forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = html;
    });
}

export function bindCoachScreen(onCoachAction) {
  const root = $("coach-notes-list");
  if (!root) return;

  Coach.renderCoachPanel(root, onCoachAction);

  root.addEventListener("click", async e => {
    const id = e.target?.id;

    if (id === "coach-login-btn") {
      const ok    = await Coach.login(
        $("coach-email")?.value    || "",
        $("coach-password")?.value || "",
      );
      const errEl = $("coach-login-error");
      if (!ok) {
        if (errEl) { errEl.textContent = "Invalid credentials."; errEl.style.display = "block"; }
        haptic([10, 50, 10]);
        return;
      }
      if (errEl) errEl.style.display = "none";
      haptic(15);
      Toast.show("✅ Coach login successful.");
      Coach.renderCoachPanel(root, onCoachAction);
      renderRoadmap();
      return;
    }

    if (id === "coach-logout-btn") {
      Coach.logout();
      Toast.show("Logged out.");
      Coach.renderCoachPanel(root, onCoachAction);
      return;
    }

    if (id === "coach-save-feedback") {
      const result = Coach.addFeedback({
        gameId:   $("coach-game-id")?.value,
        category: $("coach-category")?.value  || "Technique",
        focus:    $("coach-focus")?.value     || "tactics",
        comment:  $("coach-comment")?.value   || "",
      });
      if (!result.ok) { Toast.show(result.message); return; }
      haptic(15);
      Toast.show("💾 Feedback saved.");
      Coach.renderCoachPanel(root, onCoachAction);
      import("./progress.js").then(m => m.Progress?.render()).catch(() => {});
      return;
    }

    if (id === "coach-add-assignment") {
      const result = Coach.addAssignment({
        title: $("assign-title")?.value || "",
        desc:  $("assign-desc")?.value  || "",
        due:   $("assign-due")?.value   || "",
      });
      if (!result.ok) { Toast.show(result.message); return; }
      haptic(15);
      Toast.show("📋 Assignment added.");
      Coach.renderCoachPanel(root, onCoachAction);
      import("./home.js").then(m => m.Home?.renderTodayPlan()).catch(() => {});
      updateNavBadge();
    }
  });

  document.querySelector("[data-action='requestFeedback']")
    ?.addEventListener("click", () => Toast.show("📬 Review request sent to coach!"));
}
