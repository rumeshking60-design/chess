"use strict";
// ═══════════════════════════════════════════════════════════
// core/events.js — State subscription bindings
//
// Responsibilities:
//   · Subscribe to State events (profileChanged, gamesChanged, …)
//   · Fan out to the relevant screen renderers
//   · Keep all State.on() calls in one auditable place
//
// Call bindStateEvents(deps) once during boot after all
// modules are ready.  `deps` is an object of render functions
// so we avoid importing every module here (prevents cycles).
// ═══════════════════════════════════════════════════════════

import { State }      from "../state.js";
import { Tournament } from "../tournament.js";
import { Coach }      from "../coach.js";
import { $, $$, updateNavBadge } from "../ui-core.js";

/**
 * @typedef {Object} EventDeps
 * @property {Function} renderHome
 * @property {Function} renderProgress
 * @property {Function} renderGames       - called with active filter string
 * @property {Function} renderSettings
 * @property {Function} renderRoadmap
 * @property {Function} updateCoachHeader
 * @property {Function} updateViewingPills
 * @property {Function} onCoachAction
 * @property {Function} reloadNotation    - Router.reload("notation")
 * @property {import('./router.js').Router} router
 */

/**
 * Attach all State event listeners.
 * Safe to call once — State.on() accumulates listeners.
 *
 * @param {EventDeps} deps
 */
export function bindStateEvents(deps) {
  const {
    renderHome,
    renderProgress,
    renderGames,
    renderSettings,
    renderRoadmap,
    updateCoachHeader,
    updateViewingPills,
    onCoachAction,
    reloadNotation,
  } = deps;

  // ── Profile changed (name, rating, handles …) ────────────
  State.on("profileChanged", () => {
    updateViewingPills();
    renderHome();
    renderSettings();
  });

  // ── Games synced or merged ────────────────────────────────
  State.on("gamesChanged", () => {
    // Preserve whatever filter the user currently has active
    const activeFilter = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    if ($("games-list")) renderGames(activeFilter);
    renderProgress();
    renderHome();
  });

  // ── Multi-user switch ─────────────────────────────────────
  State.on("userChanged", () => {
    updateCoachHeader();
    updateViewingPills();
    renderHome();
    renderProgress();
    const activeFilter = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    if ($("games-list")) renderGames(activeFilter);
    renderSettings();
    renderRoadmap();
  });

  // ── Tournament data refreshed ─────────────────────────────
  State.on("tournamentsChanged", () => {
    Tournament.render($("tournaments-list"));
  });

  // ── New coach feedback saved ──────────────────────────────
  State.on("coachFeedbackAdded", () => {
    renderProgress();
  });

  // ── Assignments added / completed ─────────────────────────
  State.on("assignmentsChanged", () => {
    // Home "today's plan" card reflects pending assignments
    import("../home.js").then(m => m.Home.renderTodayPlan()).catch(() => {});
    updateNavBadge();
  });

  // ── Rating history updated (after Lichess sync) ───────────
  State.on("ratingHistoryChanged", () => {
    renderProgress();
  });

  // ── Full data reset ───────────────────────────────────────
  State.on("reset", () => {
    renderHome();
    renderGames("all");
    renderProgress();
    renderSettings();
    reloadNotation();
    Tournament.render($("tournaments-list"));
    Coach.renderCoachPanel($("coach-notes-list"), onCoachAction);
    renderRoadmap();
    updateCoachHeader();
    updateViewingPills();
  });

  // ── Coach auth toggled ────────────────────────────────────
  State.on("coachAuthChanged", () => {
    updateCoachHeader();
    updateViewingPills();
  });

  // ── Login state changed ───────────────────────────────────
  State.on("loginStateChanged", () => {
    updateViewingPills();
  });
}
