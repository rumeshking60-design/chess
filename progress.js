"use strict";

import { State } from "./state.js";
import { Coach, esc } from "./coach.js";
import {
  $,
  $$,
  setText,
  signedDelta,
  emptyStateHtml,
  animateSkillBars,
} from "./ui-core.js";

export const Progress = {
  render() {
    try { this._doRender(); } catch (err) { console.error("Progress.render:", err); }
  },

  _doRender() {
    const { profile: p, games, ratingHistory: rh, ratingHistoryMeta, streak, lastSync, trainingFocus, coachFeedback } = State.get();

    setText("prog-rating", p.rating);
    setText("prog-streak", `${streak}d`);

    const monthPill = $("progress-month-pill");
    if (monthPill) monthPill.textContent = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    // Live data badge
    const badge = $("data-source-badge");
    if (badge) {
      if (!navigator.onLine) {
        badge.textContent = "📴 Offline · cached"; badge.className = "api-badge";
      } else if (lastSync) {
        const t = new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        badge.textContent = `✅ Live · ${t}`; badge.className = "api-badge live";
      } else {
        badge.textContent = "📡 Seed data — tap Sync"; badge.className = "api-badge";
      }
    }

    const updatedEl = $("data-last-updated");
    if (updatedEl) {
      const src = ratingHistoryMeta?.source === "lichess" ? "Live from Lichess" : "Seed data";
      updatedEl.textContent = src;
    }

    // Monthly gain
    if (rh.length > 1) {
      const delta = rh[rh.length - 1].rating - rh[rh.length - 2].rating;
      setText("prog-monthly", signedDelta(delta) || "—");
    }

    this.renderChart(rh);

    if (!games.length) {
      ["skill-bars", "opening-perf", "time-heatmap"].forEach(id => {
        const el = $(id);
        if (el) el.innerHTML = emptyStateHtml({
          icon: "📊", heading: "No game data yet",
          sub: "Sync from Chess.com or Lichess to see your stats.",
        });
      });
      const insightsEl = $("progress-insights");
      if (insightsEl) insightsEl.innerHTML = `<div class="insight-item"><div class="insight-dot"></div><span style="color:var(--muted);font-size:13px">Sync games to get personalised AI insights.</span></div>`;
      setText("prog-winrate", "—"); setText("prog-acc", "—"); setText("prog-blunders", "—");
      return;
    }

    const total = games.length;
    const wins = games.filter(g => g.result === "win").length;
    const winRate = Math.round((wins / total) * 100);

    // BUG FIX 3: Only average games where accuracy is actually known
    const gamesWithAcc = games.filter(g => g.accuracy != null);
    const avgAcc = gamesWithAcc.length
      ? Math.round(gamesWithAcc.reduce((s, g) => s + g.accuracy, 0) / gamesWithAcc.length)
      : null;

    const avgBlunders = (games.reduce((s, g) => s + (g.blunders || 0), 0) / total).toFixed(1);

    setText("prog-winrate", `${winRate}%`);
    setText("prog-acc", avgAcc != null ? `${avgAcc}%` : "—");
    setText("prog-blunders", avgBlunders);

    this.renderSkillBars(games);
    this.renderOpeningPerf(games);
    this.renderInsights(games, { trainingFocus, coachFeedback });
    this.renderTimeHeatmap(games);
  },

  renderChart(ratingHistory) {
    const svg = $("progress-chart"), labelsEl = $("chart-labels");
    if (!svg || !ratingHistory.length) return;

    const W = 320, H = 100, pad = 20;
    const ratings = ratingHistory.map(r => r.rating);
    const min = Math.min(...ratings) - 30, max = Math.max(...ratings) + 30;
    const range = max - min || 1;
    const xS = i => pad + (i / Math.max(ratings.length - 1, 1)) * (W - pad * 2);
    const yS = v => H - pad - ((v - min) / range) * (H - pad * 2);

    const pts     = ratings.map((r, i) => `${xS(i)},${yS(r)}`).join(" ");
    const fillPts = `${xS(0)},${H - pad} ${pts} ${xS(ratings.length - 1)},${H - pad}`;
    const targetEnd = ratings[0] + 25 * (ratings.length - 1);
    const targetPts = [0, ratings.length - 1]
      .map(i => `${xS(i)},${yS(ratings[0] + (targetEnd - ratings[0]) * (i / Math.max(ratings.length - 1, 1)))}`)
      .join(" ");

    const gridLines = [min + 30, (min + max) / 2, max - 30].map(v => {
      const y = yS(v);
      return `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3 2"/>
              <text x="${pad - 2}" y="${y + 3}" text-anchor="end" font-size="8" fill="var(--muted)">${Math.round(v)}</text>`;
    }).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="var(--brand)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <polygon points="${fillPts}" fill="url(#chartGrad)"/>
      <polyline points="${targetPts}" fill="none" stroke="var(--border2)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${ratings.map((r, i) => `
        <circle cx="${xS(i)}" cy="${yS(r)}" r="3" fill="var(--brand)" stroke="var(--bg2)" stroke-width="1.5"/>
        <text x="${xS(i)}" y="${yS(r) - 7}" text-anchor="middle" font-size="9" fill="var(--text2)">${r}</text>`
      ).join("")}`;

    if (labelsEl) labelsEl.innerHTML = ratingHistory.map(r => `<span>${esc(r.month)}</span>`).join("");
  },

  renderSkillBars(games) {
    const host = $("skill-bars");
    if (!host) return;

    // BUG FIX 1: Only show skill bars when enough data exists (≥10 rated games).
    // Below threshold, show an honest empty state instead of invented scores.
    const ratedGames = games.filter(g => g.rated !== false);
    if (ratedGames.length < 10) {
      host.innerHTML = emptyStateHtml({
        icon: "📈",
        heading: "Not enough data yet",
        sub: `Play at least 10 rated games to unlock skill analysis. You have ${ratedGames.length} so far.`,
      });
      return;
    }

    // Only use real accuracy data — games without accuracy are excluded per-metric
    const gamesWithAcc = ratedGames.filter(g => g.accuracy != null);
    const gamesWithBlunders = ratedGames.filter(g => g.blunders != null);

    // If no accuracy data at all, skip metrics that depend on it
    const avgAcc = gamesWithAcc.length
      ? gamesWithAcc.reduce((s, g) => s + g.accuracy, 0) / gamesWithAcc.length
      : null;
    const avgBlunders = gamesWithBlunders.length
      ? gamesWithBlunders.reduce((s, g) => s + (g.blunders || 0), 0) / gamesWithBlunders.length
      : null;
    const avgMistakes = gamesWithBlunders.length
      ? gamesWithBlunders.reduce((s, g) => s + (g.mistakes || 0), 0) / gamesWithBlunders.length
      : null;

    // Build skills from real data only. Show "—" when data is unavailable.
    const skills = [];

    if (avgAcc != null) {
      // Accuracy-based skills: derived directly from average move accuracy
      skills.push({
        name: "Move Accuracy",
        score: Math.round(Math.min(100, avgAcc)),
        color: avgAcc >= 85 ? "" : "orange",
        note: `Based on ${gamesWithAcc.length} games with accuracy data`,
      });
      skills.push({
        name: "Tactical Vision",
        score: Math.round(Math.min(100, avgAcc - 5)),
        color: "",
        note: "Derived from move accuracy",
      });
    }

    if (avgBlunders != null) {
      // Blunder-based skill: lower blunders = higher score
      // Scale: 0 blunders/game → 95, 3+ → ~30
      const blunderScore = Math.round(Math.max(20, 95 - avgBlunders * 22));
      skills.push({
        name: "Calculation Depth",
        score: blunderScore,
        color: blunderScore < 50 ? "orange" : "",
        note: `Avg ${avgBlunders.toFixed(1)} blunders/game`,
      });
    }

    if (avgMistakes != null) {
      // Mistake-based skill
      const mistakeScore = Math.round(Math.max(20, 90 - avgMistakes * 15));
      skills.push({
        name: "Decision Accuracy",
        score: mistakeScore,
        color: mistakeScore < 50 ? "orange" : "",
        note: `Avg ${avgMistakes.toFixed(1)} mistakes/game`,
      });
    }

    if (!skills.length) {
      host.innerHTML = emptyStateHtml({
        icon: "📊",
        heading: "No accuracy data available",
        sub: "Sync games from Lichess (with computer analysis) or Chess.com to see skill scores.",
      });
      return;
    }

    host.innerHTML = `
      <div style="font-size:10px;color:var(--muted);margin-bottom:10px">
        📊 Scores derived from real game accuracy and blunder data
      </div>
      ${skills.map(s => `
        <div class="skill-bar-wrap">
          <div class="skill-bar-head">
            <span class="skill-name">${esc(s.name)}</span>
            <span class="skill-score">${s.score}/100</span>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">${esc(s.note)}</div>
          <div class="skill-bar-track">
            <div class="skill-bar-fill ${s.color}" style="width:0" data-target-width="${s.score}%"></div>
          </div>
        </div>`).join("")}`;
    setTimeout(animateSkillBars, 100);
  },

  renderOpeningPerf(games) {
    const host = $("opening-perf");
    if (!host) return;
    const stats = {};
    games.forEach(g => {
      if (!stats[g.opening]) stats[g.opening] = { w: 0, l: 0, d: 0 };
      stats[g.opening][g.result === "win" ? "w" : g.result === "loss" ? "l" : "d"]++;
    });
    const rows = Object.entries(stats)
      .map(([name, s]) => ({
        name, total: s.w + s.l + s.d,
        winRate: Math.round(s.w / (s.w + s.l + s.d || 1) * 100),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    host.innerHTML = rows.length
      ? rows.map(o => `
          <div class="opening-row">
            <span class="opening-name" title="${esc(o.name)}">${esc(o.name)}</span>
            <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${o.winRate}%"></div></div>
            <span class="opening-rate">${o.winRate}%</span>
          </div>`).join("")
      : `<div style="color:var(--muted);font-size:13px;padding:8px 0">No opening data yet</div>`;
  },

  renderInsights(games, { trainingFocus, coachFeedback }) {
    const host = $("progress-insights");
    if (!host) return;
    const weaknesses = Coach.analyzeWeaknesses(games);
    const dotColor = { danger: "var(--red)", warn: "var(--saffron)", coach: "var(--blue)", success: "var(--brand)" };
    const items = [
      { dot: "", text: `<strong>Training Focus:</strong> ${esc(trainingFocus?.join(", ") || "None set")}` },
      ...weaknesses.map(w => ({ dot: w.type, text: `<strong>${esc(w.label)}:</strong> ${esc(w.detail)}` })),
      ...(coachFeedback || []).slice(0, 2).map(f => ({
        dot: "coach", text: `<strong>Coach ${esc(f.category)}:</strong> ${esc(f.comment.slice(0, 100))}`,
      })),
    ];
    host.innerHTML = items.map(item => `
      <div class="insight-item">
        <div class="insight-dot" style="${item.dot ? `background:${dotColor[item.dot] || "var(--brand)"}` : ""}"></div>
        <span style="font-size:12.5px;color:var(--text2);line-height:1.5">${item.text}</span>
      </div>`).join("");
  },

  renderTimeHeatmap(games) {
    const host = $("time-heatmap");
    if (!host) return;

    const slots = [
      { label: "Morning",   wins: 0, total: 0 }, // 05:00–11:59
      { label: "Afternoon", wins: 0, total: 0 }, // 12:00–17:59
      { label: "Evening",   wins: 0, total: 0 }, // 18:00–26:59 (i.e. up to midnight + late)
    ];

    let parsedCount = 0;

    // BUG FIX 2: Use actual game date to determine time slot, not array index
    games.forEach(g => {
      if (!g.date) return;
      const d = new Date(g.date);
      // new Date() on a locale string like "27 Apr 2026" works in modern browsers
      if (isNaN(d.getTime())) return; // skip unparseable dates
      parsedCount++;
      const h = d.getHours();
      let slotIdx;
      if (h >= 5 && h < 12) slotIdx = 0;       // Morning
      else if (h >= 12 && h < 18) slotIdx = 1;  // Afternoon
      else slotIdx = 2;                          // Evening (18–4am treated as evening)
      slots[slotIdx].total++;
      if (g.result === "win") slots[slotIdx].wins++;
    });

    // If no games had parseable date/time, show an honest empty state
    if (parsedCount === 0) {
      host.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0;text-align:center">No time data available — game timestamps could not be parsed.</div>`;
      return;
    }

    const best = slots.reduce((b, s, i) =>
      (s.total && s.wins / s.total > (slots[b].total ? slots[b].wins / slots[b].total : 0)) ? i : b, 0);

    host.innerHTML = `<div class="time-heatmap">${
      slots.map((s, i) => {
        const rate = s.total ? Math.round((s.wins / s.total) * 100) : 0;
        return `<div class="time-slot${i === best && s.total > 0 ? " best" : ""}">
          <div class="time-slot-label">${esc(s.label)}</div>
          <div class="time-slot-val">${s.total ? `${rate}%` : "—"}</div>
          <div style="font-size:10px;color:var(--muted)">${s.total} game${s.total !== 1 ? "s" : ""}</div>
        </div>`;
      }).join("")
    }</div>`;
  },
};
