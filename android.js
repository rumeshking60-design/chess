// ═══════════════════════════════════════════════════════════
// android.js — Android / TWA specific enhancements
//
// HOW TO USE:
//   Import this module at the bottom of your initPWA() fn:
//     import { initAndroid } from "./android.js";
//   Then call initAndroid() inside initPWA(), after your
//   existing SW registration block.
//
// What this module does:
//   · Detects TWA context (hides install banner inside TWA)
//   · Android back-button / history-stack handling
//   · Improved install banner (replaces the hidden #install-btn)
//   · Touch ripple for .nav-btn elements
//   · Reports display-mode to body dataset for CSS targeting
// ═══════════════════════════════════════════════════════════

import { Router } from "./core/router.js";
import { Modal }  from "./ui-core.js";

// ── TWA detection ────────────────────────────────────────────
// A TWA sets document.referrer to the Android app's asset URL.
// Alternatively it can be detected via the 'twa' UTM param
// injected in the manifest's start_url.
export function isTWA() {
  return (
    document.referrer.startsWith("android-app://") ||
    new URLSearchParams(location.search).get("utm_source") === "twa"
  );
}

// Returns true when running as an installed PWA (standalone)
export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    isTWA()
  );
}

// ── Back-button / history management ─────────────────────────
// Android back button fires popstate. We intercept it to:
//   1. Close open modals first
//   2. Navigate back between screens
//   3. Only let the OS handle "exit" when we're already home
let _screenHistory = ["home"];

export function pushScreen(name) {
  if (_screenHistory.at(-1) === name) return;
  _screenHistory.push(name);
  // Push a dummy history entry so Android back generates popstate
  history.pushState({ screen: name }, "", location.pathname + location.search);
  Router.show(name);
}

function handlePopState(e) {
  // If a modal is open, close it and push a new history entry so the back
  // button doesn't exit the app unexpectedly.
  const openModal = document.querySelector(".modal-overlay.active");
  if (openModal) {
    Modal.close(openModal.id);
    // Re-push so the next back press goes to the previous screen
    history.pushState({ screen: Router.current() }, "", location.pathname + location.search);
    return;
  }

  const prev = e.state?.screen ?? "home";

  // If we're at the stack root, let Android handle the back (exits TWA)
  if (_screenHistory.length <= 1) {
    _screenHistory = ["home"];
    return; // browser/OS handles exit
  }

  _screenHistory.pop();
  Router.show(prev);
}

// ── Install banner ────────────────────────────────────────────
// Shows a rich bottom-sheet banner instead of the hidden #install-btn.
let _deferredInstall = null;

function showInstallBanner() {
  const banner = document.getElementById("install-banner");
  if (!banner) return;
  banner.classList.add("visible");
}

function hideInstallBanner() {
  const banner = document.getElementById("install-banner");
  banner?.classList.remove("visible");
}

function bindInstallBanner() {
  const installBtn  = document.getElementById("install-btn");
  const dismissBtn  = document.getElementById("install-dismiss");

  installBtn?.addEventListener("click", async () => {
    if (!_deferredInstall) return;
    hideInstallBanner();
    _deferredInstall.prompt();
    const { outcome } = await _deferredInstall.userChoice;
    if (outcome === "accepted") {
      import("./ui-core.js").then(({ Toast }) =>
        Toast.show("✅ Chess Academy added to home screen!")
      );
    }
    _deferredInstall = null;
  });

  dismissBtn?.addEventListener("click", () => {
    hideInstallBanner();
    // Don't show again this session
    sessionStorage.setItem("installDismissed", "1");
  });
}

// ── Body display-mode attribute ───────────────────────────────
// Lets CSS do .body[data-display="standalone"] { ... }
function setDisplayMode() {
  let mode = "browser";
  if (isTWA())        mode = "twa";
  else if (isStandalone()) mode = "standalone";
  document.body.dataset.display = mode;
}

// ── Touch ripple for nav buttons ──────────────────────────────
function bindNavRipple() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("pointerdown", e => {
      const r = document.createElement("span");
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      r.style.cssText = `
        position:absolute;width:${size}px;height:${size}px;
        left:${e.clientX - rect.left - size / 2}px;
        top:${e.clientY - rect.top  - size / 2}px;
        background:rgba(139,186,92,.25);border-radius:50%;
        transform:scale(0);animation:ripple 0.4s ease-out forwards;
        pointer-events:none;z-index:0;
      `;
      // nav-btn must have position:relative for this to work
      btn.style.position = "relative";
      btn.style.overflow = "hidden";
      btn.appendChild(r);
      r.addEventListener("animationend", () => r.remove());
    });
  });

  // Inject the keyframe once
  if (!document.getElementById("ripple-style")) {
    const s = document.createElement("style");
    s.id = "ripple-style";
    s.textContent = `@keyframes ripple{to{transform:scale(2.5);opacity:0}}`;
    document.head.appendChild(s);
  }
}

// ── Public init ───────────────────────────────────────────────
export function initAndroid() {
  setDisplayMode();

  // Don't show install prompt when already running in TWA or standalone
  if (!isStandalone()) {
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      _deferredInstall = e;

      if (!sessionStorage.getItem("installDismissed") &&
          !sessionStorage.getItem("installPromptShown")) {
        setTimeout(() => {
          showInstallBanner();
          sessionStorage.setItem("installPromptShown", "1");
        }, 10_000); // 10 s delay — let user settle first
      }
    });

    bindInstallBanner();
  } else {
    // Inside TWA: hide any install UI permanently
    document.getElementById("install-banner")?.remove();
    document.getElementById("install-btn")?.remove();
  }

  // Back-button handling — only meaningful in standalone / TWA
  if (isStandalone()) {
    // Seed history with the current screen so first back press is meaningful
    history.replaceState({ screen: "home" }, "", location.pathname + location.search);
    window.addEventListener("popstate", handlePopState);

    // Patch Router.show to push history entries automatically
    const _originalShow = Router.show.bind(Router);
    Router.show = function(name) {
      if (Router.current() !== name) {
        _screenHistory.push(name);
        history.pushState({ screen: name }, "", location.pathname + location.search);
      }
      _originalShow(name);
    };
  }

  bindNavRipple();
}
