"use strict";

import { State } from "./state.js";
import { esc } from "./coach.js";
import { $, initials, setText, Toast, haptic, autoDetectLocation } from "./ui-core.js";

function renderCoachSwitchStudentSection() {
  const host = $("coach-switch-student-section");
  if (!host) return;

  const { loginState, coachAuth, currentUserId } = State.get();
  const isCoach = (loginState?.role === "coach") || (coachAuth?.loggedIn && coachAuth?.role === "coach");
  host.style.display = isCoach ? "" : "none";
  if (!isCoach) return;

  const users = State.listUsers();
  if (!users.length) {
    host.innerHTML = `<div class="card card-inner" style="margin-top:10px">
      <div style="color:var(--muted);font-size:12px;text-align:center;padding:6px 0">
        No students on this device yet.
      </div>
    </div>`;
    return;
  }

  host.innerHTML = `
    <div class="settings-section-label">Coach</div>
    <div class="card card-inner" style="margin-top:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-weight:700;color:var(--text);font-size:13px">Switch Student</div>
          <div style="color:var(--muted);font-size:11px;margin-top:2px;line-height:1.35">
            Switch the active student profile on this device.
          </div>
        </div>
        <span class="pill pill-blue" style="font-size:10px">Coach mode</span>
      </div>
      <div id="coach-switch-student-list">
        ${users.map(u => {
          const name = u.fullName || u.chesscom || u.id;
          const sub  = [u.chesscom ? `Chess.com: ${u.chesscom}` : "", u.lichess ? `Lichess: ${u.lichess}` : ""].filter(Boolean).join(" · ");
          const active = String(u.id || "").toLowerCase() === String(currentUserId || "").toLowerCase();
          return `
            <button class="btn ${active ? "btn-primary" : "btn-secondary"} btn-full"
                    style="justify-content:space-between;margin-bottom:8px"
                    data-switch-student="${esc(u.id)}">
              <span style="text-align:left">
                <span style="display:block;font-weight:800">${esc(name)}</span>
                <span style="display:block;font-size:11px;color:var(--muted);font-weight:500">
                  ${esc(sub || "—")}
                </span>
              </span>
              <span style="color:${active ? "#0e0f0d" : "var(--brand3)"};font-size:16px">${active ? "✓" : "›"}</span>
            </button>`;
        }).join("")}
      </div>
    </div>`;

  const list = $("coach-switch-student-list");
  if (list && !list.dataset.bound) {
    list.dataset.bound = "1";
    list.addEventListener("click", e => {
      const id = e.target?.closest("[data-switch-student]")?.dataset?.switchStudent;
      if (!id) return;
      const summary = State.getUserSummary(id);
      const nm = summary?.profile?.fullName || summary?.profile?.chesscom || id;
      const res = State.switchUser(id);
      if (!res?.ok) { Toast.show("Could not switch student"); return; }
      haptic(10);
      Toast.show(`Switched to ${nm}`, 2200);
      renderCoachSwitchStudentSection();
    });
  }
}

// ── Data & Backup section ──────────────────────────────────
// Renders Export and Import buttons into #settings-backup-section.
// This element should exist in the HTML between account settings
// and the reset section. If absent, it is injected after the
// reset button's parent card.
function renderBackupSection() {
  let host = $("settings-backup-section");

  // Graceful injection if the host element isn't in the HTML yet
  if (!host) {
    const resetBtn = $("reset-data-btn");
    const parentCard = resetBtn?.closest(".card, .card-inner") || resetBtn?.parentElement;
    if (!parentCard) return; // can't inject without a reference point
    host = document.createElement("div");
    host.id = "settings-backup-section";
    parentCard.parentElement?.insertBefore(host, parentCard);
  }

  // Avoid re-rendering if already bound (keep listeners working)
  if (host.dataset.bound === "1") return;
  host.dataset.bound = "1";

  host.innerHTML = `
    <div class="settings-section-label" style="margin-top:16px">Data &amp; Backup</div>
    <div class="card card-inner" style="margin-top:6px">
      <p style="font-size:12px;color:var(--muted);line-height:1.5;margin:0 0 12px">
        💾 Your data is stored only in this browser. Export regularly to avoid losing progress if you clear browser storage.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="settings-export-btn" class="btn btn-secondary btn-sm" style="flex:1;min-width:120px">
          ↓ Export all data
        </button>
        <button id="settings-import-btn" class="btn btn-ghost btn-sm" style="flex:1;min-width:120px">
          ↑ Import backup
        </button>
      </div>
      <input id="settings-import-file" type="file" accept=".json" style="display:none" aria-label="Choose backup file">
    </div>`;

  // Export button
  $("settings-export-btn")?.addEventListener("click", () => {
    try {
      State.exportAll();
      Toast.show("Data exported ✓");
    } catch (err) {
      console.warn("Export failed:", err);
      Toast.show("Export failed — check browser permissions");
    }
  });

  // Import button — opens hidden file input
  $("settings-import-btn")?.addEventListener("click", () => {
    $("settings-import-file")?.click();
  });

  // File input handler — reads JSON, calls State.importAll, refreshes UI
  $("settings-import-file")?.addEventListener("change", async e => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const btn = $("settings-import-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }

    try {
      const text = await file.text();
      const result = State.importAll(text);
      if (!result.ok) {
        Toast.show(`Import failed: ${result.error}`, 4000);
        return;
      }
      Toast.show(`✅ Imported ${result.count} profile${result.count !== 1 ? "s" : ""} successfully`, 3000);
      haptic(15);

      // Refresh relevant screens after import
      Settings.render();
      try { (await import("./home.js")).Home.render(); } catch {}
    } catch (err) {
      console.warn("Import error:", err);
      Toast.show("Import failed — file could not be read", 3000);
    } finally {
      // Reset file input so same file can be re-selected if needed
      if (e.target) e.target.value = "";
      if (btn) { btn.disabled = false; btn.textContent = "↑ Import backup"; }
    }
  });
}

export const Settings = {
  render() {
    const { profile: p, lastSync } = State.get();
    setText("settings-name",     p.fullName);
    const loc = p.location || "Varanasi, Uttar Pradesh";
    setText("settings-meta",     `Rating ${p.rating} · ${loc}`);
    setText("settings-chesscom", p.chesscom || "Not linked");
    setText("settings-lichess",  p.lichess  || "Not linked");
    if ($("settings-avatar")) $("settings-avatar").textContent = initials(p.fullName);

    const locBtnHost = $("settings-location-actions");
    if (locBtnHost) {
      locBtnHost.innerHTML = `
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="change-location-btn">Change Location</button>
          <button class="btn btn-ghost btn-sm" id="auto-location-btn">Auto-detect</button>
        </div>`;

      $("change-location-btn")?.addEventListener("click", () => {
        const cur = State.get().profile?.location || "";
        const shown = cur || "Varanasi, Uttar Pradesh";
        const next = prompt("Enter your location (e.g., Varanasi, UP):", shown);
        if (next == null) return;
        const trimmed = String(next).trim();
        if (!trimmed) return;
        State.updateProfile({ location: trimmed });
        Settings.render();
        import("./home.js").then(m => m.Home.render()).catch(() => {});
        Toast.show(`Location updated: ${trimmed}`);
      });

      $("auto-location-btn")?.addEventListener("click", async () => {
        const btn = $("auto-location-btn");
        if (btn) { btn.disabled = true; btn.textContent = "Detecting…"; }
        Toast.show("Detecting location…", 1800);
        try {
          const loc = await autoDetectLocation();
          const finalLoc = loc || "Varanasi, Uttar Pradesh";
          State.updateProfile({ location: finalLoc });
          Settings.render();
          import("./home.js").then(m => m.Home.render()).catch(() => {});
          Toast.show(loc ? `Location set: ${loc}` : "Could not detect — using Varanasi, UP", 2600);
        } catch {
          Toast.show("Could not detect location", 2400);
          if (btn) { btn.disabled = false; btn.textContent = "Auto-detect"; }
        }
      });
    }

    const updatePill = (id, linked) => {
      const el = $(id);
      if (!el) return;
      el.textContent = linked ? "Linked" : "Not linked";
      el.className   = linked ? "pill pill-brand" : "pill pill-gray";
    };
    updatePill("chesscom-status", !!p.chesscom);
    updatePill("lichess-status",  !!p.lichess);
    const ccInput = $("settings-chesscom-input");
    const liInput = $("settings-lichess-input");
    const liTokenInput = $("settings-lichess-token-input");
    if (ccInput) ccInput.value = p.chesscom || "";
    if (liInput) liInput.value = p.lichess || "";
    if (liTokenInput) liTokenInput.value = p.lichessToken || "";

    const syncEl = $("last-sync-time");
    if (syncEl) {
      syncEl.textContent = lastSync
        ? `Last synced: ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Never synced";
    }

    renderCoachSwitchStudentSection();

    // Render the Data & Backup section (idempotent — only injects once)
    renderBackupSection();
  },
};
