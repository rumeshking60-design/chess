"use strict";

import { $, $$ } from "./ui-core.js";
import { Games }       from "./games.js";
import { Progress }    from "./progress.js";
import { Settings }    from "./settings.js";
import { Tournament }  from "./tournament.js";
import { Coach }       from "./coach.js";
import { NotationUI }  from "./notation.js";

let _onCoachAction = () => {};

export function setRouterCoachHandler(fn) {
  _onCoachAction = fn;
}

const INITS = {
  games: () => Games.render("all"),

  progress: () => Progress.render(),

  notation: () => NotationUI.init(),

  tournaments: () => {
    Tournament.render($("tournaments-list"));
    Tournament.renderLeaderboard($("leaderboard-list"));
  },

  coach: () => {
    Coach.renderCoachPanel($("coach-notes-list"), _onCoachAction);
  },

  settings: () => Settings.render(),
};

let _current = "home";
const _loaded = new Set(["home"]);

export const Router = {
  show(name) {
    if (_current === name) return;

    $$(".screen").forEach(s => s.classList.remove("active"));
    const target = $(`screen-${name}`);
    if (!target) {
      console.warn(`Router.show: no element #screen-${name}`);
      return;
    }
    target.classList.add("active");

    $$(".nav-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.screen === name)
    );

    const vp = $("viewport");
    if (vp) vp.scrollTop = 0;

    _current = name;

    if (!_loaded.has(name)) {
      _loaded.add(name);
      try {
        INITS[name]?.();
      } catch (err) {
        console.error(`Router init "${name}":`, err);
      }
    }
  },

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

  current: () => _current,
};
