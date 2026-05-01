"use strict";
// ═══════════════════════════════════════════════════════════
// TOURNAMENT.JS — View-only tournament calendar + leaderboard
// ═══════════════════════════════════════════════════════════

import { State } from "./state.js";

const esc = v => String(v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Leaderboard seed (realistic Indian junior chess players) ──
const LEADERBOARD_SEED = [
  { name: "Aryan Chopra",    rating: 1872, school: "DPS Vasant Kunj",    wins: 14, city: "Delhi" },
  { name: "Riya Mehta",      rating: 1791, school: "Kendriya Vidyalaya", wins: 11, city: "Pune" },
  { name: "You",            rating: 1648, school: "Your school",         wins: 9,  city: "Noida", isMe: true },
  { name: "Kunal Sharma",    rating: 1634, school: "St. Xavier's Patna", wins: 8,  city: "Patna" },
  { name: "Diya Patel",      rating: 1612, school: "Amity School",       wins: 7,  city: "Jaipur" },
  { name: "Mihir Tiwari",    rating: 1598, school: "Ryan International", wins: 7,  city: "Mumbai" },
  { name: "Ananya Singh",    rating: 1574, school: "DPS Indirapuram",    wins: 6,  city: "Ghaziabad" },
  { name: "Rohan Das",       rating: 1561, school: "La Martiniere",      wins: 5,  city: "Kolkata" },
];

// ── Render tournament card ─────────────────────────────────
function renderCard(t, studentId) {
  const fillPct = Math.round(((t.totalSeats - t.seatsLeft) / t.totalSeats) * 100);
  const urgent = t.seatsLeft < 10;
  const typeColor = t.type === "Classical" ? "pill-blue" : "pill-brand";

  const urgentBadge = urgent
    ? `<span class="pill pill-red" style="font-size:10px;animation:pulse 2s infinite">🔴 ${t.seatsLeft} seats left</span>`
    : `<span class="pill pill-gray" style="font-size:10px">${t.seatsLeft} seats left</span>`;

  const eligibleBadge = t.eligible
    ? `<span class="pill pill-brand" style="font-size:10px">Eligible</span>`
    : `<span class="pill pill-gray" style="font-size:10px">Check rating</span>`;

  return `
    <div class="tourney-card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);margin:0 16px 10px;overflow:hidden;transition:border-color .15s"
         onmouseenter="this.style.borderColor='var(--border2)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="padding:14px 14px 0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.3;flex:1">🏆 ${esc(t.title)}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          <span class="pill ${typeColor}" style="font-size:10px">${esc(t.type)}</span>
          ${eligibleBadge}
          ${urgentBadge}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px">
          <div style="font-size:11px;color:var(--text2)">📅 ${esc(t.date)}</div>
          <div style="font-size:11px;color:var(--text2)">🕹️ ${esc(t.rounds)}</div>
          <div style="font-size:11px;color:var(--text2);grid-column:1/-1">📍 ${esc(t.venue)}</div>
          <div style="font-size:11px;color:var(--text2)">👥 ${esc(t.pool)}</div>
          <div style="font-size:11px;color:var(--text2)">💰 ${esc(t.fee)}</div>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:4px">
            <span>Seats filled</span><span>${fillPct}%</span>
          </div>
          <div style="height:5px;background:var(--surface);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${fillPct}%;border-radius:3px;background:${urgent?"var(--red)":"var(--brand)"};transition:width .4s ease"></div>
          </div>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding:10px 14px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" data-t-view="${esc(t.id)}">Details</button>
      </div>
    </div>`;
}

// ── Detail modal content ───────────────────────────────────
function renderDetailModal(t) {
  return `
    <div style="padding:4px 0">
      <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:12px">${esc(t.title)}</div>
      <div style="display:grid;gap:10px">
        ${[
          ["📅 Date", t.date],["📍 Venue", t.venue],["🕹️ Format", t.rounds],
          ["👥 Pool", t.pool],["💰 Entry Fee", t.fee],
          ["🪑 Seats Left", `${t.seatsLeft} / ${t.totalSeats}`],
          ["🏅 Type", t.type],
        ].map(([k,v])=>`
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:13px;color:var(--muted)">${k}</span>
            <span style="font-size:13px;color:var(--text);font-weight:500">${esc(v)}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

// ── Leaderboard renderer ───────────────────────────────────
function renderLeaderboard(container) {
  if (!container) return;
  const profile = State.get().profile;
  const rows = LEADERBOARD_SEED.map((p, i) => {
    const isMe = p.name === profile.fullName || p.isMe;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);${isMe?"background:var(--brand-bg);margin:0 -14px;padding:10px 14px;border-radius:var(--r)":""}">
        <div style="width:22px;text-align:center;font-family:var(--font-mono);font-size:12px;font-weight:600;color:${i<3?"var(--saffron)":"var(--muted)"}">
          ${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:${isMe?700:500};color:${isMe?"var(--brand3)":"var(--text)"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}${isMe?" (you)":""}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(p.city)} · ${esc(p.school)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text)">${p.rating}</div>
          <div style="font-size:10px;color:var(--muted)">${p.wins}W</div>
        </div>
      </div>`;
  }).join("");

  container.innerHTML = rows;
}

export const Tournament = {
  _timer: null,

  render(container) {
    if (!container) return;
    const { tournaments, profile } = State.get();
    const html = tournaments.map(t => renderCard(t, profile.id)).join("");
    container.innerHTML = html || `<div style="padding:24px;text-align:center;color:var(--muted)">No tournaments available</div>`;
  },

  bind(container, detailContainer, toast) {
    if (!container) return;
    container.addEventListener("click", e => {
      const viewId = e.target?.closest("[data-t-view]")?.dataset?.tView;

      if (viewId) {
        const t = State.get().tournaments.find(x => x.id === viewId);
        if (t && detailContainer) {
          detailContainer.innerHTML = renderDetailModal(t);
          document.getElementById("tournament-detail-modal")?.classList.add("open");
        }
      }
    });
  },

  renderLeaderboard,

  startAutoRefresh(container, intervalMs = 60000) {
    if (this._timer) clearInterval(this._timer);

    // View-only: seat counts are static until next backend sync.
    // This interval only re-renders existing tournament data — it never
    // mutates seat counts or any other state. Fake "booking" simulation
    // has been removed because it misleads users with manufactured urgency.
    this._timer = setInterval(() => {
      if (container) this.render(container);
    }, intervalMs);
  },

  stopAutoRefresh() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },
};
