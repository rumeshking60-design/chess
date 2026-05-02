"use strict";
// ═══════════════════════════════════════════════════════════
// ui.js — Chess Academy v4.3  (Orchestrator)
//
// This file is now a THIN BOOT LAYER.  It:
//   1. Imports all feature modules
//   2. Checks auth state → shows login gate or app
//   3. Calls initApp() which wires up every interaction
//
// Business logic, screen rendering, and state subscriptions
// have been extracted to:
//   core/router.js        — screen routing
//   core/auth.js          — login gate & session
//   core/events.js        — State.on() subscriptions
//   screens/coach-screen.js — coach panel, roadmap, pills
//   components/ai-chat.js  — AI coach chat widget
//
// ─────────────────────────────────────────────────────────
// If you need to add a new screen:
//   1. Add its init fn to INITS in core/router.js
//   2. Subscribe to relevant State events in core/events.js
//   3. Keep rendering logic in screens/<name>-screen.js
// ═══════════════════════════════════════════════════════════

// ── Services & state ────────────────────────────────────────
import { State }     from "./state.js";
import { Coach }     from "./coach.js";
import { LiveSync }  from "./liveSync.js";
import { Tournament } from "./tournament.js";

// ── Screen renderers ─────────────────────────────────────────
import { Home }     from "./home.js";
import { Progress } from "./progress.js";
import { Settings } from "./settings.js";
import { Games, GameViewer } from "./games.js";

// ── Core infrastructure ──────────────────────────────────────
import { Router, setRouterCoachHandler } from "./core/router.js";
import { Auth }    from "./core/auth.js";
import { bindStateEvents } from "./core/events.js";

// ── Screen modules ────────────────────────────────────────────
import {
  renderRoadmap,
  updateCoachHeader,
  updateViewingPills,
  bindCoachScreen,
} from "./screens/coach-screen.js";

// ── Components ────────────────────────────────────────────────
import { AICoach } from "./components/ai-chat.js";

// ── Modals & utility ─────────────────────────────────────────
import { bindProfileModal, bindPuzzleActions, bindRatingModal, bindSwipeToClose } from "./modals.js";
import { $, $$, haptic, setText, Toast, Modal, updateNavBadge } from "./ui-core.js";
import { NotationUI } from "./notation.js";

// ════════════════════════════════════════════════════════════
// § 1. COACH ACTION CALLBACK
// Used by both coach-screen and home-screen so the today
// plan and nav badge stay in sync after any coach mutation.
// ════════════════════════════════════════════════════════════

function onCoachAction(action) {
  Toast.show(
    action === "assignmentCompleted"
      ? "✅ Assignment marked complete!"
      : "Action taken."
  );
  Home.renderTodayPlan();
  updateNavBadge();
}

// Inject into router so the coach screen's lazy-init can use it
setRouterCoachHandler(onCoachAction);

// ════════════════════════════════════════════════════════════
// § 2. SYNC HELPERS  (progress badge + error prettifier)
// ════════════════════════════════════════════════════════════

function setSyncBusy(isBusy) {
  const btn = $("sync-data-btn");
  if (!btn) return;
  btn.style.opacity       = isBusy ? "0.6" : "1";
  btn.style.pointerEvents = isBusy ? "none" : "";
}

function setSyncBadge(text) {
  const b = $("data-source-badge");
  if (b) b.textContent = text;
}

function friendlySyncError(msg) {
  const s = String(msg || "");
  if (!navigator.onLine)        return "You're offline. We'll sync when you're back online.";
  if (/HTTP 404/i.test(s))      return "User not found. Double‑check your username(s).";
  if (/Timeout/i.test(s))       return "Sync timed out. Try again in a moment.";
  if (/Network error/i.test(s)) return "Network error. Check your connection and try again.";
  return s || "Sync failed. Please try again.";
}

// ════════════════════════════════════════════════════════════
// § 3. SETTINGS SCREEN BINDINGS
// (account inputs, sync button, reset, logout)
// ════════════════════════════════════════════════════════════

function bindSettingsScreen() {
  // Manual sync trigger
  $("sync-data-btn")?.addEventListener("click", async () => {
    let result = null;
    try {
      result = await LiveSync.syncAll({
        toast:    (m, ms) => Toast.show(m, ms),
        setBadge: setSyncBadge,
        setBusy:  setSyncBusy,
      });
    } catch (err) {
      Toast.show(friendlySyncError(err?.message || err), 3400);
      return;
    }
    // Refresh all data-dependent screens
    Home.render();
    Progress.render();
    const f = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    Games.render(f);
    Settings.render();
    if (result?.ts) {
      const t = new Date(result.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setText("last-sync-time", `Last synced: ${t}`);
    }
    if (result?.errors?.length) Toast.show(friendlySyncError(result.errors[0]), 3200);
  });

  // Save account handles + token
  $("save-account-settings-btn")?.addEventListener("click", () => {
    State.updateProfile({
      chesscom:     $("settings-chesscom-input")?.value.trim()      || "",
      lichess:      $("settings-lichess-input")?.value.trim()       || "",
      lichessToken: $("settings-lichess-token-input")?.value.trim() || "",
    });
    Settings.render();
    Toast.show("Account settings saved");
  });

  // Logout
  $("logout-btn")?.addEventListener("click", () => {
    if (!confirm("Logout and return to login screen?")) return;
    Auth.logout();
  });

  // Reset all data
  $("reset-data-btn")?.addEventListener("click", () => {
    if (!confirm("Reset all app data to defaults? This cannot be undone.")) return;
    State.resetAll();
    Home.render();
    Games._shown = Games._pageSize;
    Games.render("all");
    $$(".filter-chip").forEach(c => c.classList.toggle("active", c.dataset.filter === "all"));
    Toast.show("Data reset to defaults ✓");
  });

  // Refresh insights (Progress screen)
  $("refresh-insights-btn")?.addEventListener("click", () => {
    Progress.render();
    Toast.show("Insights refreshed ✓");
  });
}

// ════════════════════════════════════════════════════════════
// § 4. PWA SETUP
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

  // Install-to-homescreen prompt
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstall = e;
    if (!sessionStorage.getItem("installPromptShown")) {
      setTimeout(() => {
        Toast.show("📲 Add Chess Academy to your home screen!", 5000);
        sessionStorage.setItem("installPromptShown", "1");
      }, 8000);
    }
  });
  $("install-btn")?.addEventListener("click", async () => {
    if (!deferredInstall) { Toast.show("Already installed or not supported."); return; }
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === "accepted") Toast.show("✅ Chess Academy added to home screen!");
    deferredInstall = null;
  });

  // Connectivity banners
  window.addEventListener("offline", () => {
    Toast.show("📴 Offline — showing cached data", 4000);
    setSyncBadge("📴 Offline · cached");
  });
  window.addEventListener("online", () => Toast.show("📡 Back online", 2000));

  // Handle PWA shortcut query params
  const params = new URLSearchParams(location.search);
  if (params.get("action") === "puzzle") setTimeout(() => $("puzzle-cta")?.click(), 500);
  if (params.get("screen"))              setTimeout(() => Router.show(params.get("screen")), 100);
}

// ════════════════════════════════════════════════════════════
// § 5. MAIN APP INIT
// Runs once after successful login (student or coach).
// ════════════════════════════════════════════════════════════

let _appStarted = false;

function initApp() {
  // If already running (e.g. user switched profile), just refresh UI state.
  if (_appStarted) {
    updateCoachHeader();
    updateViewingPills();
    Home.render();
    Settings.render();
    return;
  }
  _appStarted = true;

  // ── Initial renders ──────────────────────────────────────
  try { Home.render();     } catch (e) { console.error("Boot Home.render:", e); }
  try { Settings.render(); } catch (e) { console.error("Boot Settings.render:", e); }
  updateCoachHeader();
  updateViewingPills();

  // ── Navigation ───────────────────────────────────────────
  // Bottom nav buttons
  $$(".nav-btn").forEach(btn =>
    btn.addEventListener("click", () => { haptic(4); Router.show(btn.dataset.screen); })
  );
  // Quick-cards on home (data-screen attribute, not nav buttons or screens themselves)
  $$("[data-screen]:not(.nav-btn):not(.screen)").forEach(el =>
    el.addEventListener("click", () => Router.show(el.dataset.screen))
  );

  // ── Game viewer ──────────────────────────────────────────
  GameViewer.bindControls();
  Games.bindGameViewer();

  // ── Games filter chips ───────────────────────────────────
  $$(".filter-chip").forEach(btn =>
    btn.addEventListener("click", () => {
      $$(".filter-chip").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      Games._shown = Games._pageSize;
      Games.render(btn.dataset.filter);
    })
  );

  // ── Modals ───────────────────────────────────────────────
  bindProfileModal();
  bindPuzzleActions();
  bindRatingModal();
  bindSwipeToClose();

  // Close any modal on Escape; trap focus within open modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") Modal.closeAll();
    if (e.key === "Tab")    Modal.trapFocus(e);
  });
  $$(".modal-overlay").forEach(m =>
    m.addEventListener("click", e => { if (e.target === m) Modal.close(m.id); })
  );

  // ── Tournaments ──────────────────────────────────────────
  Tournament.bind(
    $("tournaments-list"),
    $("tournament-detail-content"),
    msg => Toast.show(msg)
  );
  $("close-tournament-modal")
    ?.addEventListener("click", () => Modal.close("tournament-detail-modal"));
  Tournament.startAutoRefresh($("tournaments-list"), 60_000);

  // ── AI Coach ─────────────────────────────────────────────
  AICoach.bind();

  // ── Coach screen ─────────────────────────────────────────
  bindCoachScreen(onCoachAction);
  renderRoadmap();
  updateCoachHeader();
  updateViewingPills();

  // ── Settings screen ───────────────────────────────────────
  bindSettingsScreen();

  // ── State subscriptions ───────────────────────────────────
  bindStateEvents({
    renderHome:        ()  => Home.render(),
    renderProgress:    ()  => Progress.render(),
    renderGames:       (f) => { Games._shown = Games._pageSize; Games.render(f || "all"); },
    renderSettings:    ()  => Settings.render(),
    renderRoadmap,
    updateCoachHeader,
    updateViewingPills,
    onCoachAction,
    reloadNotation:    ()  => Router.reload("notation"),
  });

  // ── Background ratings sync ───────────────────────────────
  // Non-blocking; fires 3 s after boot to avoid competing with first paint.
  setTimeout(() => {
    if (!navigator.onLine) return;
    LiveSync.syncRatings()
      .then(r => {
        if (r && Object.keys(r).length) Toast.show("📡 Live ratings updated", 1800);
      })
      .catch(() => {});
  }, 3000);

  initPWA();
}

// ════════════════════════════════════════════════════════════
// § 6. BOOT ENTRY POINT
// ════════════════════════════════════════════════════════════

function boot() {
  Auth.bindLoginGate({
    onStudentLogin:       () => initApp(),
    onCoachStudentSelect: () => initApp(),
  });

  if (!Auth.isLoggedIn()) {
    Auth.showLoginGate();
    return;
  }

  Auth.showApp();
  initApp();
}

window.addEventListener("DOMContentLoaded", boot);
