"use strict";

import { State } from "./state.js";
import { esc } from "./coach.js";
import { LiveSync } from "./liveSync.js";
import { Home } from "./home.js";
import { Progress } from "./progress.js";
import { $, $$, setText, Toast, Modal, haptic } from "./ui-core.js";

export function renderRatingModal(ratings) {
  const host = $("rating-modal-body");
  if (!host) return;
  if (!ratings || !Object.keys(ratings).length) {
    host.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted)">No live ratings found.<br>Check your handles in Profile.</div>`;
    return;
  }
  host.innerHTML = `
    <div>${Object.entries(ratings).flatMap(([platform, types]) =>
      Object.entries(types).filter(([, v]) => v != null).map(([type, val]) => `
        <div class="platform-row">
          <div class="platform-name">${esc(platform)} ${esc(type)}</div>
          <div class="platform-rating">${val}</div>
        </div>`)
    ).join("")}</div>
    <div style="margin-top:16px;font-size:12px;color:var(--muted);text-align:center">Live from Chess.com &amp; Lichess APIs</div>`;
}

export function bindProfileModal() {
  const openProfile = () => {
    const { profile: p, platformRatings: pr } = State.get();
    const setVal = (id, v) => { if ($(id)) $(id).value = v; };
    setVal("profile-name",     p.fullName);
    setVal("profile-rating",   p.rating);
    setVal("profile-chesscom", p.chesscom || "");
    setVal("profile-lichess",  p.lichess  || "");
    setVal("profile-dob",      p.dob      || "");
    setVal("profile-category", p.category || "U-15");
    setVal("profile-coach",    p.schoolCoach || "");

    const rtSect = $("rating-trend-section"), rtList = $("platform-ratings-list");
    if (rtSect && rtList && Object.keys(pr).length) {
      rtSect.style.display = "block";
      rtList.innerHTML = Object.entries(pr).flatMap(([plat, types]) =>
        Object.entries(types).filter(([, v]) => v).map(([type, val]) => `
          <div class="platform-row">
            <div class="platform-name">${esc(plat)} ${esc(type)}</div>
            <div class="platform-rating">${val}</div>
          </div>`)
      ).join("");
    }
    if ($("rating-error")) $("rating-error").style.display = "none";
    Modal.open("profile-modal");
  };

  $("avatar-btn")?.addEventListener("click", openProfile);
  $$("[data-action='openProfile']").forEach(b => b.addEventListener("click", openProfile));
  $$("[data-action='closeProfile']").forEach(b => b.addEventListener("click", () => Modal.close("profile-modal")));

  document.querySelector("[data-action='saveProfile']")?.addEventListener("click", () => {
    const rating = Number($("profile-rating")?.value);
    const errEl  = $("rating-error");
    if (!Number.isFinite(rating) || rating < 100 || rating > 3000) {
      if (errEl) errEl.style.display = "block";
      $("profile-rating")?.focus();
      return;
    }
    if (errEl) errEl.style.display = "none";
    State.updateProfile({
      fullName:    $("profile-name")?.value.trim()     || State.get().profile.fullName,
      rating,
      chesscom:    $("profile-chesscom")?.value.trim() || "",
      lichess:     $("profile-lichess")?.value.trim()  || "",
      dob:         $("profile-dob")?.value             || "",
      category:    $("profile-category")?.value.trim() || "U-15",
      schoolCoach: $("profile-coach")?.value.trim()    || "",
    });
    Modal.close("profile-modal");
    Home.render();
    Progress.render();
    haptic([10, 30, 10]);
    Toast.show("Profile saved ✓");
  });
}

export function bindSwipeToClose() {
  $$(".modal-sheet").forEach(sheet => {
    let startY = 0, startX = 0;
    sheet.addEventListener("touchstart", e => {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    }, { passive: true });
    sheet.addEventListener("touchend", e => {
      const dy = e.changedTouches[0].clientY - startY;
      const dx = Math.abs(e.changedTouches[0].clientX - startX);
      // Only close on downward swipe, not horizontal scroll
      if (dy > 80 && dx < 40) {
        const overlay = sheet.closest(".modal-overlay");
        if (overlay) Modal.close(overlay.id);
      }
    }, { passive: true });
  });
}

export function bindPuzzleActions() {
  const puzzleActions = ["openPuzzle", "closePuzzle", "hintPuzzle", "showSolution", "resetPuzzle", "nextPuzzle"];

  // Open puzzle modal
  $$("[data-action='openPuzzle']").forEach(el =>
    el.addEventListener("click", () => {
      const { puzzle } = State.get();
      setText("puzzle-streak-count", puzzle.streak);
      const diffPill = $("puzzle-difficulty-pill");
      if (diffPill) diffPill.textContent = puzzle.difficulty;
      const ratingPill = $("puzzle-rating-pill");
      if (ratingPill) ratingPill.textContent = `Rating: ~${puzzle.rating}`;
      Modal.open("puzzle-modal");
    })
  );

  $$("[data-action='closePuzzle']").forEach(el =>
    el.addEventListener("click", () => Modal.close("puzzle-modal"))
  );

  // Hint / solution buttons provide feedback feedback
  $("puzzle-modal")?.addEventListener("click", e => {
    const action = e.target?.closest("[data-action]")?.dataset?.action;
    if (!action || !puzzleActions.includes(action)) return;

    if (action === "hintPuzzle") {
      const fb = $("puzzle-feedback");
      if (fb) { fb.textContent = "💡 Hint: Look for a forcing sequence that wins material."; fb.className = "puzzle-feedback warn"; }
    }
    if (action === "showSolution") {
      const fb = $("puzzle-feedback");
      if (fb) { fb.textContent = "The key move is a tactical combination — study the position carefully."; fb.className = "puzzle-feedback"; }
      $("show-solution-btn")?.classList.add("hidden");
    }
    if (action === "resetPuzzle") {
      const fb = $("puzzle-feedback");
      if (fb) { fb.textContent = "♟ Position reset. Find the best continuation."; fb.className = "puzzle-feedback"; }
      $$(".attempt-dot").forEach(d => d.className = "attempt-dot");
    }
    if (action === "nextPuzzle") {
      const result = State.applyPuzzleResult(true, State.get().puzzle.difficulty);
      setText("puzzle-streak-count", result.streak);
      Toast.show(`Puzzle complete! Rating: ${result.rating}`);
      Modal.close("puzzle-modal");
    }
  });
}

export function bindRatingModal() {
  $("rating-chip")?.addEventListener("click", () => {
    Modal.open("rating-modal");
    // Show spinner while fetching
    const body = $("rating-modal-body");
    if (body) body.innerHTML = `<div style="text-align:center;padding:20px"><div class="spin"></div></div>`;
    LiveSync.syncRatings().then(r => renderRatingModal(r));
  });
  $("close-rating-modal")?.addEventListener("click", () => Modal.close("rating-modal"));
}

