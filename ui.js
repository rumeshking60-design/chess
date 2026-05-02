"use strict";

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
import { Router, setRouterCoachHandler } from "./router.js";
import { Auth }    from "./auth.js";
import { bindStateEvents } from "./events.js";

// ── Screen modules ────────────────────────────────────────────
import {
  renderRoadmap,
  updateCoachHeader,
  updateViewingPills,
  bindCoachScreen,
} from "./coach-screen.js";

// ── Components ────────────────────────────────────────────────
import { AICoach } from "./ai-chat.js";

// ── Modals & utility ─────────────────────────────────────────
import { bindProfileModal, bindPuzzleActions, bindRatingModal, bindSwipeToClose } from "./modals.js";
import { $, $$, haptic, setText, Toast, Modal, updateNavBadge } from "./ui-core.js";
import { NotationUI } from "./notation.js";

// ════════════════════════════════════════════════════════════
// § 1. COACH ACTION CALLBACK
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

setRouterCoachHandler(onCoachAction);

// ════════════════════════════════════════════════════════════
// § 2. SYNC HELPERS
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
// ════════════════════════════════════════════════════════════

function bindSettingsScreen() {
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

  $("save-account-settings-btn")?.addEventListener("click", () => {
    State.updateProfile({
      chesscom:     $("settings-chesscom-input")?.value.trim()      || "",
      lichess:      $("settings-lichess-input")?.value.trim()       || "",
      lichessToken: $("settings-lichess-token-input")?.value.trim() || "",
    });
    Settings.render();
    Toast.show("Account settings saved");
  });

  $("logout-btn")?.addEventListener("click", () => {
    if (!confirm("Logout and return to login screen?")) return;
    Auth.logout();
  });

  $("reset-data-btn")?.addEventListener("click", () => {
    if (!confirm("Reset all app data to defaults? This cannot be undone.")) return;
    State.resetAll();
    Home.render();
    Games._shown = Games._pageSize;
    Games.render("all");
    $$(".filter-chip").forEach(c => c.classList.toggle("active", c.dataset.filter === "all"));
    Toast.show("Data reset to defaults ✓");
  });

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
    navigator.serviceWorker.register("/chess/sw.js")
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

  window.addEventListener("offline", () => {
    Toast.show("📴 Offline — showing cached data", 4000);
    setSyncBadge("📴 Offline · cached");
  });
  window.addEventListener("online", () => Toast.show("📡 Back online", 2000));

  const params = new URLSearchParams(location.search);
  if (params.get("action") === "puzzle") setTimeout(() => $("puzzle-cta")?.click(), 500);
  if (params.get("screen"))              setTimeout(() => Router.show(params.get("screen")), 100);
}

// ════════════════════════════════════════════════════════════
// § 5. MAIN APP INIT
// ════════════════════════════════════════════════════════════

let _appStarted = false;

function initApp() {
  if (_appStarted) {
    updateCoachHeader();
    updateViewingPills();
    Home.render();
    Settings.render();
    return;
  }
  _appStarted = true;

  try { Home.render();     } catch (e) { console.error("Boot Home.render:", e); }
  try { Settings.render(); } catch (e) { console.error("Boot Settings.render:", e); }
  updateCoachHeader();
  updateViewingPills();

  $$(".nav-btn").forEach(btn =>
    btn.addEventListener("click", () => { haptic(4); Router.show(btn.dataset.screen); })
  );
  $$("[data-screen]:not(.nav-btn):not(.screen)").forEach(el =>
    el.addEventListener("click", () => Router.show(el.dataset.screen))
  );

  GameViewer.bindControls();
  Games.bindGameViewer();

  $$(".filter-chip").forEach(btn =>
    btn.addEventListener("click", () => {
      $$(".filter-chip").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      Games._shown = Games._pageSize;
      Games.render(btn.dataset.filter);
    })
  );

  bindProfileModal();
  bindPuzzleActions();
  bindRatingModal();
  bindSwipeToClose();

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") Modal.closeAll();
    if (e.key === "Tab")    Modal.trapFocus(e);
  });
  $$(".modal-overlay").forEach(m =>
    m.addEventListener("click", e => { if (e.target === m) Modal.close(m.id); })
  );

  Tournament.bind(
    $("tournaments-list"),
    $("tournament-detail-content"),
    msg => Toast.show(msg)
  );
  $("close-tournament-modal")
    ?.addEventListener("click", () => Modal.close("tournament-detail-modal"));
  Tournament.startAutoRefresh($("tournaments-list"), 60_000);

  AICoach.bind();

  bindCoachScreen(onCoachAction);
  renderRoadmap();
  updateCoachHeader();
  updateViewingPills();

  bindSettingsScreen();

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
