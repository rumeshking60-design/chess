"use strict";

import { State }     from "./state.js";
import { Coach }     from "./coach.js";
import { LiveSync }  from "./liveSync.js";
import { $, $$, Toast, haptic } from "./ui-core.js";
import { esc }       from "./coach.js";

export async function autoDetectLocation() {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res   = await fetch("https://ipapi.co/json/", {
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const city   = String(data?.city   || "").trim();
    const region = String(data?.region || "").trim();
    if (!city) return null;
    return region ? `${city}, ${region}` : city;
  } catch {
    return null;
  }
}

function showLoginGate() {
  const gate = $("login-gate");
  const app  = $("app-shell");
  if (gate) gate.style.display = "flex";
  if (app)  app.style.display  = "none";
}

function showApp() {
  const gate = $("login-gate");
  const app  = $("app-shell");
  if (gate) gate.style.display = "none";
  if (app)  app.style.display  = "";
}

function renderCoachStudentPicker() {
  const panelLogin    = $("login-coach-panel");
  const panelStudents = $("login-coach-students-panel");
  const list          = $("coach-student-list");
  if (!panelLogin || !panelStudents || !list) return;

  panelStudents.style.display = "block";

  const users = State.listUsers();
  if (!users.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:16px;color:var(--muted);font-size:12px">
        No students on this device yet.<br>Add a student first from the Student tab.
      </div>`;
  } else {
    list.innerHTML = users.map(u => {
      const summary  = State.getUserSummary(u.id);
      const rating   = summary?.profile?.rating;
      const lastSync = summary?.lastSync
        ? new Date(summary.lastSync).toLocaleString([], {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })
        : null;
      const name = u.fullName || u.chesscom || u.id;
      const sub  = [
        u.chesscom ? `Chess.com: ${u.chesscom}` : "",
        u.lichess  ? `Lichess: ${u.lichess}`     : "",
      ].filter(Boolean).join(" · ");

      return `
        <button class="btn btn-secondary btn-full"
                style="justify-content:space-between;margin-bottom:8px"
                data-coach-switch-student="${esc(u.id)}">
          <span style="text-align:left">
            <span style="display:block;font-weight:700">${esc(name)}</span>
            <span style="display:block;font-size:11px;color:var(--muted);font-weight:500">
              ${esc(sub || "—")}
              ${rating   ? ` · Rating ${esc(rating)}` : ""}
              ${lastSync ? ` · Synced ${esc(lastSync)}` : " · Never synced"}
            </span>
          </span>
          <span style="color:var(--brand3);font-size:16px">›</span>
        </button>`;
    }).join("");
  }

  $$("[data-login-tab]").forEach(t => t.classList.remove("active"));
  panelLogin.classList.remove("active");
  panelStudents.classList.add("active");
}

export const Auth = {
  isLoggedIn: () => !!State.get().loginState?.loggedIn,
  showLoginGate,
  showApp,

  logout() {
    State.setCoachAuth({ loggedIn: false, role: "student", name: "" });
    State.setLoginState({ loggedIn: false, role: "student" });
    Toast.show("Logged out successfully");
    showLoginGate();
  },

  bindLoginGate({ onStudentLogin, onCoachStudentSelect }) {
    const tabs          = $$("[data-login-tab]");
    const studentPanel  = $("login-student-panel");
    const coachPanel    = $("login-coach-panel");
    const coachStudents = $("login-coach-students-panel");

    tabs.forEach(tab =>
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const isStudent = tab.dataset.loginTab === "student";
        studentPanel?.classList.toggle("active", isStudent);
        coachPanel?.classList.toggle("active", !isStudent);
        if (coachStudents) coachStudents.style.display = "none";
        coachStudents?.classList.remove("active");
      })
    );

    $("student-login-continue-btn")?.addEventListener("click", async () => {
      const fullName = $("login-student-name")?.value.trim()     || "";
      const chesscom = $("login-student-chesscom")?.value.trim() || "";
      const lichess  = $("login-student-lichess")?.value.trim()  || "";

      if (!chesscom) {
        Toast.show("Chess.com username is required");
        return;
      }

      const btn = $("student-login-continue-btn");
      if (btn) {
        btn.disabled   = true;
        btn.innerHTML  = `<span class="spin" style="width:16px;height:16px"></span> Saving & syncing…`;
      }

      try {
        const ensured = State.ensureUser({ chesscom, lichess, fullName });
        if (!ensured.ok) {
          Toast.show("Could not create user profile");
          return;
        }
        State.switchUser(ensured.id);
        State.updateProfile({
          fullName: fullName || State.get().profile.fullName,
          chesscom,
          lichess,
        });

        const currentLoc = State.get().profile?.location || "";
        const isSeedLoc  = !currentLoc
          || currentLoc === "Noida, UP"
          || currentLoc === "Noida";
        if (isSeedLoc) {
          autoDetectLocation()
            .then(loc => {
              State.updateProfile({ location: loc || "Varanasi, Uttar Pradesh" });
            })
            .catch(() => {
              State.updateProfile({ location: "Varanasi, Uttar Pradesh" });
            });
        }

        State.setLoginState({ loggedIn: true, role: "student" });
        Toast.show("Welcome! Syncing your data…", 2200);

        await LiveSync.syncAll({
          toast:    (m, ms) => Toast.show(m, ms),
          setBadge: text => { const b = $("data-source-badge"); if (b) b.textContent = text; },
          setBusy:  on => {
            const b = $("sync-data-btn");
            if (b) { b.style.opacity = on ? "0.6" : "1"; b.style.pointerEvents = on ? "none" : ""; }
          },
        }).catch(() => {});

        Toast.show("✅ Ready!", 1400);
        showApp();
        onStudentLogin(ensured.id);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Continue & Sync"; }
      }
    });

    $("coach-login-continue-btn")?.addEventListener("click", async () => {
      const email    = $("coach-login-email")?.value.trim().toLowerCase() || "";
      const password = $("coach-login-password")?.value || "";
      const btn      = $("coach-login-continue-btn");

      if (btn) {
        btn.disabled  = true;
        btn.innerHTML = `<span class="spin" style="width:16px;height:16px"></span> Logging in…`;
      }
      try {
        const ok = await Coach.login(email, password);
        if (!ok) {
          const errEl = $("coach-login-error");
          if (errEl) { errEl.textContent = "Invalid credentials."; errEl.style.display = "block"; }
          haptic([10, 50, 10]);
          return;
        }
        State.setLoginState({ loggedIn: true, role: "coach" });
        Toast.show("Coach login successful");
        renderCoachStudentPicker();
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Login as Coach"; }
      }
    });

    $("coach-student-logout-btn")?.addEventListener("click", () => {
      State.setCoachAuth({ loggedIn: false, role: "student", name: "" });
      State.setLoginState({ loggedIn: false, role: "student" });
      Toast.show("Logged out");
      showLoginGate();
    });

    $("coach-student-list")?.addEventListener("click", e => {
      const id = e.target?.closest("[data-coach-switch-student]")?.dataset?.coachSwitchStudent;
      if (!id) return;
      const summary = State.getUserSummary(id);
      const nm = summary?.profile?.fullName || summary?.profile?.chesscom || id;
      State.switchUser(id);
      State.setLoginState({ loggedIn: true, role: "coach" });
      Toast.show(`Switched to ${nm}`, 2200);
      showApp();
      onCoachStudentSelect(id);
    });
  },
};
