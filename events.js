"use strict";

import { State }      from "./state.js";
import { Tournament } from "./tournament.js";
import { Coach }      from "./coach.js";
import { $, $$, updateNavBadge } from "./ui-core.js";

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

  State.on("profileChanged", () => {
    updateViewingPills();
    renderHome();
    renderSettings();
  });

  State.on("gamesChanged", () => {
    const activeFilter = $$(".filter-chip.active")[0]?.dataset?.filter || "all";
    if ($("games-list")) renderGames(activeFilter);
    renderProgress();
    renderHome();
  });

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

  State.on("tournamentsChanged", () => {
    Tournament.render($("tournaments-list"));
  });

  State.on("coachFeedbackAdded", () => {
    renderProgress();
  });

  State.on("assignmentsChanged", () => {
    import("./home.js").then(m => m.Home.renderTodayPlan()).catch(() => {});
    updateNavBadge();
  });

  State.on("ratingHistoryChanged", () => {
    renderProgress();
  });

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

  State.on("coachAuthChanged", () => {
    updateCoachHeader();
    updateViewingPills();
  });

  State.on("loginStateChanged", () => {
    updateViewingPills();
  });
}
