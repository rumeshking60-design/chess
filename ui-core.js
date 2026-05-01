"use strict";
// Core UI utilities shared across screens/modules.

import { State } from "./state.js";

export const $ = id => document.getElementById(id);
export const $$ = sel => [...document.querySelectorAll(sel)];

export const haptic = (p = 8) => { try { navigator.vibrate?.(p); } catch {} };
export const signedDelta = n => (n == null || isNaN(n)) ? null : `${Number(n) >= 0 ? "+" : ""}${n}`;
export const initials = name => String(name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
export const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

export function animateRating(el, from, to, ms = 600) {
  if (!el || from === to) { if (el) el.textContent = to; return; }
  const start = performance.now();
  const step = now => {
    const t = Math.min((now - start) / ms, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    el.textContent = Math.round(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function drawSparkline(svgId, data, color = "#8bba5c") {
  const svg = $(svgId);
  if (!svg || !data?.length) return;
  const [W, H] = [60, 24];
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function animateSkillBars() {
  $$(".skill-bar-fill[data-target-width]").forEach(bar =>
    requestAnimationFrame(() => { bar.style.width = bar.dataset.targetWidth; })
  );
}

export function updateNavBadge() {
  const badge = document.querySelector(".nav-btn[data-screen='coach'] .nav-badge");
  if (!badge) return;
  const n = State.get().assignments.filter(a => a.status === "pending").length;
  badge.style.display = n > 0 ? "flex" : "none";
}

// Safe HTML empty state — heading/sub can be plain text or pre-trusted HTML strings
export function emptyStateHtml({ icon = "♟", heading, sub, btnHtml = "" } = {}) {
  return `
    <div style="text-align:center;padding:48px 20px">
      <div style="font-size:48px;margin-bottom:12px;opacity:.6">${icon}</div>
      <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">${heading}</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5;max-width:220px;margin:0 auto">${sub}</div>
      ${btnHtml}
    </div>`;
}

export const Toast = {
  _timer: null,
  show(msg, ms = 2600) {
    const t = $("toast");
    if (!t) return;
    clearTimeout(this._timer);
    t.textContent = msg;
    t.classList.add("show");
    this._timer = setTimeout(() => t.classList.remove("show"), ms);
  },
};

export async function autoDetectLocation() {
  try {
    const res = await fetch("https://ipapi.co/json/", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const city = String(data?.city || "").trim();
    const region = String(data?.region || "").trim();
    const country = String(data?.country_name || "").trim();
    if (!city) return null;
    if (region) return `${city}, ${region}`;
    if (country) return `${city}, ${country}`;
    return city;
  } catch {
    return null;
  }
}

// Modal helper (focus trap + swipe-to-close bindings live elsewhere)
export const Modal = {
  _prevFocus: null,

  open(id) {
    const el = $(id);
    if (!el) return;
    this._prevFocus = document.activeElement;
    el.classList.add("open");
    el.removeAttribute("aria-hidden");
    requestAnimationFrame(() => {
      el.querySelector("button:not(:disabled), [tabindex='0'], input, select, textarea, a[href]")?.focus();
    });
  },

  close(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    this._prevFocus?.focus();
    this._prevFocus = null;
  },

  closeAll() {
    $$(".modal-overlay").forEach(m => {
      m.classList.remove("open");
      m.setAttribute("aria-hidden", "true");
    });
    this._prevFocus?.focus();
    this._prevFocus = null;
  },

  trapFocus(e) {
    const sheet = document.querySelector(".modal-overlay.open .modal-sheet");
    if (!sheet) return;
    const focusable = [...sheet.querySelectorAll(
      "button:not(:disabled), [tabindex='0'], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"
    )];
    if (!focusable.length) return;
    const [first, last] = [focusable[0], focusable[focusable.length - 1]];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  },
};

