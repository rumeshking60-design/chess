"use strict";

import { State } from "./state.js";
import { Coach, esc } from "./coach.js";
import {
  $,
  setText,
  initials,
  signedDelta,
  animateRating,
  drawSparkline,
  updateNavBadge,
} from "./ui-core.js";

export const Home = {
  _lastRating: null,

  render() {
    try { this._doRender(); } catch (err) { console.error("Home.render:", err); }
  },

  _doRender() {
    const { profile: p, games, ratingHistory: rh, streak } = State.get();

    // Top bar
    setText("top-bar-name", p.fullName);
    setText("top-bar-sub", `${p.category} · ${p.location || "Varanasi, Uttar Pradesh"}`);
    const init = initials(p.fullName);
    [$("avatar-btn"), $("settings-avatar")].forEach(el => { if (el) el.textContent = init; });

    // Animated rating
    const prev = this._lastRating;
    this._lastRating = p.rating;
    [$("hero-rating-num"), $("home-rating")].forEach(el => {
      if (!el) return;
      (prev !== null && prev !== p.rating) ? animateRating(el, prev, p.rating) : (el.textContent = p.rating);
    });

    // Milestone bar
    const next = Math.ceil((p.rating + 1) / 100) * 100;
    const prev100 = next - 100;
    setText("milestone-pts", `${next - p.rating} pts left`);
    setText("milestone-start", `Started ${prev100}`);
    const milestoneBar = $("milestone-bar");
    if (milestoneBar) milestoneBar.style.width = `${((p.rating - prev100) / 100) * 100}%`;
    // Update the milestone pill in section-head
    const milestonePill = document.querySelector(".milestone-goal-pill");
    if (milestonePill) milestonePill.textContent = next;

    // Stats
    const total = games.length || 1;
    const wins = games.filter(g => g.result === "win").length;
    const winRate = Math.round((wins / total) * 100);
    const monthlyGain = rh.length > 1 ? rh[rh.length - 1].rating - rh[rh.length - 2].rating : null;

    // Hero subtitle (remove hardcoded copy; keep it helpful)
    const heroSub = $("hero-sub-text");
    if (heroSub) {
      heroSub.textContent = monthlyGain != null
        ? `${signedDelta(monthlyGain)} this month · ${games.length ? `${winRate}% win rate` : "Sync games for insights"}`
        : (games.length ? `${games.length} games tracked · ${winRate}% win rate` : "Link accounts to sync your stats");
    }

    setText("home-monthly", monthlyGain !== null ? signedDelta(monthlyGain) : "—");
    setText("home-progress-sub", monthlyGain !== null ? `${signedDelta(monthlyGain)} this month` : "—");
    // Fix: show real data immediately instead of "Loading…"
    setText("home-games-sub", `${games.length} game${games.length !== 1 ? "s" : ""} · ${winRate}% wins`);
    setText("learning-streak", streak);
    setText("today-date-pill", new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" }));

    // Win-rate stat in hero (fixed — was hardcoded 74%)
    const heroWinrate = document.querySelector(".hero-winrate-val");
    if (heroWinrate) heroWinrate.textContent = `${winRate}%`;

    // Milestone description
    const weeksLeft = monthlyGain > 0 ? Math.ceil((next - p.rating) / (monthlyGain / 4.3)) : null;
    const milestoneDesc = $("milestone-desc");
    if (milestoneDesc) {
      milestoneDesc.innerHTML = (weeksLeft
        ? `At your current pace, you'll hit ${next} in <span class="brand-txt">~${weeksLeft} week${weeksLeft > 1 ? "s" : ""}</span>.`
        : `Keep playing consistently to build toward ${next}.`
      ) + " Focus on endgame conversion for the fastest gains.";
    }

    // AI insight banner (rotates daily, derived from data)
    const totalBlunders = games.reduce((s, g) => s + (g.blunders || 0), 0);
    const insights = [
      `Your endgame conversion is improving. Focus on rook vs rook endgames for maximum rating gain.`,
      `Win rate ${winRate}% across ${games.length} games. Push accuracy above 88% to break ${next}.`,
      `Blunder rate: ${(totalBlunders / total).toFixed(1)}/game. Slow down on move 20+ in complex positions.`,
      `Best opening: ${this._bestOpening(games)}. Keep building your repertoire around your strengths.`,
    ];
    const insightBanner = $("ai-daily-insight");
    if (insightBanner) {
      insightBanner.innerHTML = `
        <div class="insight-banner-icon">🧠</div>
        <div class="insight-banner-text">
          <strong>Today's AI Insight:</strong> ${esc(insights[new Date().getDate() % insights.length])}
        </div>`;
    }

    // Sparklines
    const sparkData = rh.map(r => r.rating);
    drawSparkline("streak-sparkline", sparkData);
    drawSparkline("streak-sparkline2", sparkData);

    this.renderTodayPlan();
    updateNavBadge();
  },

  _bestOpening(games) {
    const wins = {};
    games.filter(g => g.result === "win").forEach(g => { wins[g.opening] = (wins[g.opening] || 0) + 1; });
    const best = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : "your main openings";
  },

  renderTodayPlan() {
    const host = $("today-plan");
    if (!host) return;
    const plan = Coach.generateTodayPlan(State.get());
    if (!plan.length) {
      host.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:12px 0">No plan set — add training focus in Settings.</div>`;
      return;
    }
    host.innerHTML = plan.map((item, i) => `
      <div style="display:flex;align-items:center;gap:12px;padding:${i > 0 ? "10px 0 0" : "0 0 10px"};${i > 0 && i < plan.length - 1 ? "border-bottom:1px solid var(--border)" : ""}">
        <span style="font-size:22px;flex-shrink:0" aria-hidden="true">${item.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(item.title)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${esc(item.sub)}</div>
        </div>
        ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="flex-shrink:0;font-size:11px">Open ↗</a>` : ""}
      </div>`).join("");
  },
};

