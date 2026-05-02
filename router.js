"use strict";
// ═══════════════════════════════════════════════════════════
// core/router.js — Screen routing with lazy initialisation
//
// Responsibilities:
//   · Map screen names → DOM ids
//   · Track which screens have been initialised
//   · Call init functions once per screen on first visit
//   · Expose show() and reload() for external callers
// ═══════════════════════════════════════════════════════════

import { $, $$ } from "../ui-core.js";
import { Games }       from "../games.js";
import { Progress }    from "../progress.js";
import { Settings }    from "../settings.js";
import { Tournament }  from "../tournament.js";
import { Coach }       from "../coach.js";
import { NotationUI }  from "../notation.js";

// Lazily-resolved to avoid circular imports at module parse time.
// Callers inject these via Router.setHandlers() during boot.
let _onCoachAction = () => {};

/**
 * Register the coach-action callback (set during boot to avoid
 * a circular dependency between router ↔ coach-screen).
 * @param {Function} fn
 */
export function setRouterCoachHandler(fn) {
  _onCoachAction = fn;
}

// ── Per-screen lazy init functions ──────────────────────────
// Each function is called exactly once, the first time the
// corresponding screen becomes active.  Keep them cheap —
// heavy data fetching lives in the individual screen modules.
const INITS = {
  games: () => Games.render("all"),

  progress: () => Progress.render(),

  notation: () => NotationUI.init(),

  tournaments: () => {
    Tournament.render($("tournaments-list"));
    Tournament.renderLeaderboard($("leaderboard-list"));
  },

  coach: () => {
    // Coach panel needs the action callback injected at boot time.
    Coach.renderCoachPanel($("coach-notes-list"), _onCoachAction);
  },

  settings: () => Settings.render(),
};

// ── Internal state ──────────────────────────────────────────
let _current = "home";
const _loaded = new Set(["home"]); // "home" is rendered synchronously at boot

// ── Public API ───────────────────────────────────────────────
export const Router = {
  /**
   * Switch to a named screen.  Skips if already active.
   * Calls the screen's init function on first visit.
   *
   * @param {string} name  - screen name matching data-screen attributes
   */
  show(name) {
    if (_current === name) return;

    // Hide all screens, activate the target
    $$(".screen").forEach(s => s.classList.remove("active"));
    const target = $(`screen-${name}`);
    if (!target) {
      console.warn(`Router.show: no element #screen-${name}`);
      return;
    }
    target.classList.add("active");

    // Sync nav button active state
    $$(".nav-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.screen === name)
    );

    // Reset scroll position on each navigation
    const vp = $("viewport");
    if (vp) vp.scrollTop = 0;

    _current = name;

    // Lazy init — run only once per screen per app session
    if (!_loaded.has(name)) {
      _loaded.add(name);
      try {
        INITS[name]?.();
      } catch (err) {
        console.error(`Router init "${name}":`, err);
      }
    }
  },

  /**
   * Force re-initialise a screen even if it has already been loaded.
   * Useful after a data reset or user switch.
   *
   * @param {string} name
   */
  reload(name) {
    _loaded.delete(name);
    if (_current === name) {
      _loaded.add(name);
      try {
        INITS[name]?.();
      } catch (err) {
        console.error(`Router reload "${name}":`, err);
      }
    }
  },

  /** Returns the currently active screen name. */
  current: () => _current,
};
