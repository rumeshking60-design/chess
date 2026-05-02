// ═══════════════════════════════════════════════════════════════════════════
// notation.js — PGN Upload & Analysis UI  v2.0
// ─────────────────────────────────────────────────────────────────────────
//  All chess logic has moved to chess-core.js.
//  This file contains ONLY:
//    § 1  Canvas board renderer   (BoardRenderer)
//    § 2  Stockfish engine wrapper (StockfishEngine)
//    § 3  Notation UI controller  (NotationUI)  ← exported
// ═══════════════════════════════════════════════════════════════════════════

import {
  PIECE,
  UNICODE_PIECE,
  INITIAL_FEN,
  ChessState,
  isWhitePiece,
  pieceColor,
  applyMove,
  sanToMove,
  analyzePGN,
  getStateAtIndex,
} from "./chess-core.js";

// ─────────────────────────────────────────────────────────────────────────
// § 1  Canvas board renderer
// ─────────────────────────────────────────────────────────────────────────

const BC = {
  light:      "#f0d9b5",
  dark:       "#b58863",
  lastLight:  "rgba(205,210,106,0.82)",
  lastDark:   "rgba(170,162,58,0.82)",
  selLight:   "rgba(20,85,30,0.58)",
  selDark:    "rgba(20,85,30,0.58)",
  checkLight: "rgba(220,0,0,0.44)",
  checkDark:  "rgba(220,0,0,0.44)",
  coordLight: "#b58863",
  coordDark:  "#f0d9b5",
  hintDot:    "rgba(0,0,0,0.22)",
};

class BoardRenderer {
  constructor(canvas, opts = {}) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext("2d");
    this.flipped    = opts.flipped    || false;
    this.showCoords = opts.showCoords !== false;
    this._state     = null;
    this.lastMove   = null;   // { from, to }
    this.selectedSq = -1;
    this.hintSqs    = [];
    this._dpr       = window.devicePixelRatio || 1;
    this._sz        = 0;
    this.onMove     = opts.onMove || null;
    if (opts.interactive) this._bindInput();
  }

  resize() {
    const dpr = this._dpr, w = this.canvas.offsetWidth || 320;
    this.canvas.width  = w * dpr;
    this.canvas.height = w * dpr;
    this._sz = (w * dpr) / 8;
    this.render();
  }

  setState(s) { this._state = s; this.render(); }

  setLastMove(from, to) { this.lastMove = { from, to }; this.render(); }

  render() {
    if (!this._state || !this._sz) return;
    const { ctx, _sz: sz, flipped } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const checkSq = this._state.isInCheck(this._state.turn)
      ? this._state.kingSquare(this._state.turn)
      : -1;

    for (let sq = 0; sq < 64; sq++) {
      const r  = sq >> 3, f = sq & 7;
      const dr = flipped ? 7 - r : r, df = flipped ? 7 - f : f;
      const x  = df * sz, y = dr * sz;
      const isLight = (r + f) % 2 === 0;

      // Square fill
      let fill = isLight ? BC.light : BC.dark;
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to))
        fill = isLight ? BC.lastLight : BC.lastDark;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, sz, sz);

      // Check highlight
      if (sq === checkSq) {
        ctx.fillStyle = isLight ? BC.checkLight : BC.checkDark;
        ctx.fillRect(x, y, sz, sz);
      }

      // Selection highlight
      if (sq === this.selectedSq) {
        ctx.fillStyle = isLight ? BC.selLight : BC.selDark;
        ctx.fillRect(x, y, sz, sz);
      }

      // Legal-move hint dots / rings
      if (this.hintSqs.includes(sq)) {
        ctx.beginPath();
        if (this._state.board[sq] !== PIECE.EMPTY) {
          ctx.arc(x + sz / 2, y + sz / 2, sz * 0.45, 0, Math.PI * 2);
          ctx.strokeStyle = BC.hintDot;
          ctx.lineWidth   = sz * 0.09;
          ctx.stroke();
        } else {
          ctx.arc(x + sz / 2, y + sz / 2, sz * 0.17, 0, Math.PI * 2);
          ctx.fillStyle = BC.hintDot;
          ctx.fill();
        }
      }

      // Coordinates
      if (this.showCoords) {
        ctx.font         = `bold ${Math.max(8, sz * 0.14)}px sans-serif`;
        ctx.fillStyle    = isLight ? BC.coordLight : BC.coordDark;
        if (f === (flipped ? 7 : 0)) {
          ctx.textAlign = "left"; ctx.textBaseline = "top";
          ctx.fillText(String(8 - r), x + sz * 0.04, y + sz * 0.04);
        }
        if (r === (flipped ? 0 : 7)) {
          ctx.textAlign = "right"; ctx.textBaseline = "bottom";
          ctx.fillText(String.fromCharCode(97 + f), x + sz * 0.97, y + sz * 0.97);
        }
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }

      // Piece
      const p = this._state.board[sq];
      if (p !== PIECE.EMPTY) this._drawPiece(p, x + sz / 2, y + sz / 2, sz);
    }
  }

  _drawPiece(p, cx, cy, sz) {
    const ch = UNICODE_PIECE[p] || "?";
    this.ctx.font         = `${sz * 0.8}px serif`;
    this.ctx.textAlign    = "center";
    this.ctx.textBaseline = "middle";
    // Shadow pass for contrast
    this.ctx.fillStyle = "rgba(0,0,0,0.28)";
    this.ctx.fillText(ch, cx + sz * 0.025, cy + sz * 0.04);
    // Colour pass
    this.ctx.fillStyle = isWhitePiece(p) ? "#ffffff" : "#1a1a1a";
    this.ctx.fillText(ch, cx, cy);
    this.ctx.textAlign    = "left";
    this.ctx.textBaseline = "alphabetic";
  }

  _bindInput() {
    const canvas = this.canvas;
    const getSq  = e => {
      const rect = canvas.getBoundingClientRect();
      const cx   = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy   = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const sz   = rect.width / 8;
      const f    = Math.floor(cx / sz), r = Math.floor(cy / sz);
      const af   = this.flipped ? 7 - f : f, ar = this.flipped ? 7 - r : r;
      return (af >= 0 && af < 8 && ar >= 0 && ar < 8) ? ar * 8 + af : -1;
    };
    canvas.addEventListener("click", e => {
      const sq = getSq(e);
      if (sq < 0 || !this._state) return;
      if (this.selectedSq < 0) {
        if (pieceColor(this._state.board[sq]) === this._state.turn) {
          this.selectedSq = sq;
          this.hintSqs    = this._state.legalMoves().filter(m => m.from === sq).map(m => m.to);
          this.render();
        }
      } else {
        const move = this._state.legalMoves().find(m => m.from === this.selectedSq && m.to === sq);
        this.selectedSq = -1;
        this.hintSqs    = [];
        if (move && this.onMove) this.onMove(move);
        else this.render();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// § 2  Stockfish engine wrapper
// ─────────────────────────────────────────────────────────────────────────

const SF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";

class StockfishEngine {
  constructor() {
    this._w     = null;
    this._ready = false;
    this._cb    = null;
    this._p     = null;
  }

  init() {
    if (this._p) return this._p;
    this._p = this._load();
    return this._p;
  }

  async _load() {
    try {
      this._w           = new Worker(SF_CDN);
      this._w.onmessage = e => this._onMsg(e.data);
      this._w.onerror   = () => {};
      await this._cmd("uci",     "uciok",   5000);
      await this._cmd("isready", "readyok", 5000);
      this._w.postMessage("setoption name Threads value 1");
      this._ready = true;
      return true;
    } catch {
      this._w?.terminate();
      this._w     = null;
      this._ready = false;
      try { document.getElementById("na-engine-status").textContent = "Engine unavailable"; } catch {}
      try { document.getElementById("na-engine-checkbox").checked = false; } catch {}
      return false;
    }
  }

  _cmd(send, token, ms) {
    return new Promise((res, rej) => {
      const t    = setTimeout(() => rej(new Error("timeout")), ms);
      const prev = this._w.onmessage;
      this._w.onmessage = e => {
        if (typeof e.data === "string" && e.data.includes(token)) {
          clearTimeout(t); this._w.onmessage = prev; res();
        } else {
          prev?.(e);
        }
      };
      this._w.postMessage(send);
    });
  }

  _onMsg(data) {
    if (typeof data !== "string" || !this._cb) return;
    const mate  = data.match(/\bscore mate (-?\d+)/);
    const cp    = data.match(/\bscore cp (-?\d+)/);
    const pv    = data.match(/\bpv\s+(\S+)/);
    const depth = data.match(/\bdepth (\d+)/);
    if ((mate || cp) && depth) {
      const score = mate
        ? (parseInt(mate[1], 10) > 0 ? `+M${mate[1]}` : `-M${Math.abs(parseInt(mate[1], 10))}`)
        : ((parseInt(cp[1], 10) / 100).toFixed(2));
      this._cb({ score, bestMove: pv ? pv[1] : null, depth: parseInt(depth[1], 10), done: false });
    }
    if (data.startsWith("bestmove")) {
      const m = data.match(/bestmove\s+(\S+)/);
      this._cb({ bestMove: m ? m[1] : null, done: true });
    }
  }

  evaluate(fen, depth = 16, cb) {
    if (!this._ready || !this._w) { cb?.({ score: "N/A", bestMove: null, done: true }); return; }
    this._cb = cb;
    this._w.postMessage("stop");
    this._w.postMessage(`position fen ${fen}`);
    this._w.postMessage(`go depth ${depth}`);
  }

  stop() { this._w?.postMessage("stop"); this._cb = null; }
  get ready() { return this._ready; }
}

// ─────────────────────────────────────────────────────────────────────────
// § 3  Notation UI controller
// ─────────────────────────────────────────────────────────────────────────

export const NotationUI = (() => {
  let _analysis   = null;
  let _currentIdx = -1;
  let _board      = null;
  let _engine     = null;
  let _engineOn   = false;
  let _evalTimer  = null;
  let _autoPlay   = null;

  const $        = id  => document.getElementById(id);
  const esc      = s   => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const dbounce  = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ── init ──────────────────────────────────────────────────────────────

  function init() {
    _engine = new StockfishEngine();

    const canvas = $("na-board-canvas");
    if (canvas) {
      _board = new BoardRenderer(canvas, { showCoords: true, interactive: false });
      const ro = new ResizeObserver(() => _board.resize());
      ro.observe(canvas.parentElement || canvas);
      setTimeout(() => _board.resize(), 250);
      _board.setState(ChessState.fromFen(INITIAL_FEN));
    }

    _bindEvents();
  }

  // ── events ────────────────────────────────────────────────────────────

  function _bindEvents() {
    // Auto-parse while typing
    $("na-pgn-textarea")?.addEventListener("input", dbounce(() => {
      const v = $("na-pgn-textarea")?.value?.trim();
      if (v && v.length > 4) _run(v);
    }, 700));

    // Auto-grow textarea
    $("na-pgn-textarea")?.addEventListener("input", () => {
      const ta = $("na-pgn-textarea");
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    });

    $("na-load-btn")?.addEventListener("click",   () => { const v = $("na-pgn-textarea")?.value?.trim(); if (v) _run(v); else _toast("Paste a PGN first"); });
    $("na-clear-btn")?.addEventListener("click",  _reset);
    $("na-sample-btn")?.addEventListener("click", () => { const ta = $("na-pgn-textarea"); if (ta) ta.value = SAMPLE_PGN; _run(SAMPLE_PGN); });

    // File drop-zone
    const dz = $("na-drop-zone"), fi = $("na-file-input");
    dz?.addEventListener("click",    () => fi?.click());
    dz?.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("na-drag-over"); });
    dz?.addEventListener("dragleave", () => dz.classList.remove("na-drag-over"));
    dz?.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("na-drag-over"); const f = e.dataTransfer?.files[0]; if (f) _loadFile(f); });
    fi?.addEventListener("change",   () => { if (fi.files[0]) _loadFile(fi.files[0]); });

    // Navigation
    $("na-btn-start")?.addEventListener("click", () => _go(-1));
    $("na-btn-prev") ?.addEventListener("click", () => _go(_currentIdx - 1));
    $("na-btn-next") ?.addEventListener("click", () => _go(_currentIdx + 1));
    $("na-btn-end")  ?.addEventListener("click", () => _go(_analysis ? _analysis.moves.length - 1 : -1));
    $("na-btn-play") ?.addEventListener("click", _togglePlay);
    $("na-btn-flip") ?.addEventListener("click", () => { if (_board) { _board.flipped = !_board.flipped; _board.render(); } });

    // Engine toggle
    $("na-engine-checkbox")?.addEventListener("change", async () => {
      _engineOn = $("na-engine-checkbox")?.checked || false;
      const st  = $("na-engine-status");
      if (_engineOn) {
        if (st) st.textContent = "Initialising…";
        const ok = await _engine.init();
        if (!ok) {
          if (st) st.textContent = "Unavailable";
          _engineOn = false;
          if ($("na-engine-checkbox")) $("na-engine-checkbox").checked = false;
          return;
        }
        if (st) st.textContent = "Ready";
        if (_analysis) _reqEval();
      } else {
        _engine.stop();
        _setEval("—", null, null);
        if (st) st.textContent = "";
      }
    });

    // Keyboard
    document.addEventListener("keydown", e => {
      if (!$("screen-notation")?.classList.contains("active")) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); _go(_currentIdx - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); _go(_currentIdx + 1); }
      if (e.key === "Home")       { e.preventDefault(); _go(-1); }
      if (e.key === "End" && _analysis) { e.preventDefault(); _go(_analysis.moves.length - 1); }
    });
  }

  // ── file loading ──────────────────────────────────────────────────────

  function _loadFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const txt = e.target?.result;
      if (!txt) return;
      const ta = $("na-pgn-textarea"); if (ta) ta.value = txt;
      const fn = $("na-file-name");   if (fn) fn.textContent = file.name;
      _run(txt);
    };
    reader.readAsText(file);
  }

  // ── pipeline ──────────────────────────────────────────────────────────

  function _run(pgn) {
    try {
      _stopPlay();
      if (_board) _board.resize();
      _analysis   = analyzePGN(pgn);
      _currentIdx = -1;
      _renderAll();
      _go(_analysis.moves.length > 0 ? 0 : -1);
      setTimeout(() => $("na-board-canvas")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    } catch (err) {
      console.error("PGN analysis error:", err);
      _showParseErr("Failed to parse PGN: " + err.message);
    }
  }

  function _reset() {
    _stopPlay();
    _analysis = null; _currentIdx = -1;
    const ta = $("na-pgn-textarea"); if (ta) ta.value = "";
    const fn = $("na-file-name");   if (fn) fn.textContent = "";
    const panel = $("na-analysis-panel"); if (panel) panel.style.display = "none";
    if (_board) { _board.setState(ChessState.fromFen(INITIAL_FEN)); _board.lastMove = null; _board.render(); }
    _setEval("—", null, null);
  }

  // ── rendering ─────────────────────────────────────────────────────────

  function _renderAll() {
    if (!_analysis) return;
    const es = document.getElementById("na-empty-state"); if (es) es.style.display = "none";
    const panel = $("na-analysis-panel"); if (panel) panel.style.display = "";
    _renderHeaders();
    _renderErrors();
    _renderMoves();
    _updateNav();
  }

  function _renderHeaders() {
    const host = $("na-headers");
    if (!host || !_analysis) return;
    const h    = _analysis.headers;
    const KEYS = ["White","Black","Event","Site","Date","Round","Result","ECO","TimeControl","Termination"];
    const rows = KEYS.filter(k => h[k]).map(k =>
      `<div class="na-header-row"><span class="na-header-key">${esc(k)}</span><span class="na-header-val">${esc(h[k])}</span></div>`
    ).join("");
    host.innerHTML = rows || `<div style="font-size:12px;color:var(--muted)">No PGN headers found</div>`;
  }

  function _renderErrors() {
    const host = $("na-errors");
    if (!host || !_analysis) return;
    if (!_analysis.errors.length) {
      host.innerHTML = `<div class="na-ok-banner">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="2,8 6,12 14,4"/></svg>
        All ${_analysis.moves.length} move${_analysis.moves.length !== 1 ? "s" : ""} parsed cleanly
      </div>`;
      return;
    }
    host.innerHTML = _analysis.errors.map(err => {
      const ok    = !!err.corrected;
      const cls   = ok ? "na-error-corrected" : "na-error-bad";
      const badge = ok ? (err.ambiguous ? "Ambiguous" : "Auto-corrected") : "Illegal";
      const bdCls = ok ? "corrected" : "bad";
      const sugg  = err.suggestions.length
        ? `<div class="na-suggestions"><span>Suggestions:</span>${
            err.suggestions.slice(0, 3).map((s, i) =>
              `<button class="na-suggestion-btn" data-ei="${err.index}" data-si="${i}">${esc(s)}</button>`
            ).join("")
          }</div>`
        : "";
      return `<div class="na-error-card ${cls}" id="na-err-${err.index}">
        <div class="na-err-head">
          <span class="na-err-loc">Move ${err.moveNum} · ${err.side}</span>
          <span class="na-err-original">${esc(err.original)}</span>
          <span class="na-err-badge ${bdCls}">${badge}</span>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.55">${esc(err.reason)}</div>
        ${ok ? `<div style="font-size:11px;color:var(--saffron);margin-top:4px">Applied: <strong>${esc(err.corrected)}</strong></div>` : ""}
        ${sugg}
      </div>`;
    }).join("");
    host.querySelectorAll(".na-suggestion-btn").forEach(btn => {
      btn.addEventListener("click", () =>
        _applyCorr(parseInt(btn.dataset.ei, 10), parseInt(btn.dataset.si, 10))
      );
    });
  }

  function _renderMoves() {
    const host = $("na-move-list");
    if (!host || !_analysis) return;
    if (!_analysis.moves.length) {
      host.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0">No moves loaded</div>`;
      return;
    }
    let html = "";
    for (let i = 0; i < _analysis.moves.length; i++) {
      const m = _analysis.moves[i];
      if (i % 2 === 0) html += `<div class="na-move-row"><span class="na-move-num">${Math.floor(i / 2) + 1}.</span>`;
      const cls = ["na-move-chip",
        i === _currentIdx                               ? "na-active"    : "",
        m.status === "corrected" || m.status === "ambiguous" ? "na-corrected" : "",
        m.status === "illegal"                          ? "na-illegal"   : "",
      ].filter(Boolean).join(" ");
      const tip = m.status !== "ok" ? ` title="Originally: ${esc(m.original)}"` : "";
      html += `<button class="${cls}" data-mi="${i}"${tip}>${esc(m.san)}</button>`;
      if (i % 2 === 1 || i === _analysis.moves.length - 1) html += "</div>";
    }
    host.innerHTML = html;
    host.querySelectorAll(".na-move-chip").forEach(btn => {
      btn.addEventListener("click", () => _go(parseInt(btn.dataset.mi, 10)));
    });
  }

  /** Only update chip highlight classes — no full re-render. */
  function _syncHL() {
    const host = $("na-move-list");
    if (!host) return;
    host.querySelectorAll(".na-move-chip").forEach(btn => {
      btn.classList.toggle("na-active", parseInt(btn.dataset.mi, 10) === _currentIdx);
    });
    host.querySelector(".na-active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ── navigation ────────────────────────────────────────────────────────

  function _go(index) {
    if (!_analysis) return;
    const idx   = Math.max(-1, Math.min(_analysis.moves.length - 1, index));
    _currentIdx = idx;
    const state = getStateAtIndex(_analysis, idx);

    if (_board) {
      // Incremental update: only re-render, not a full setState rebuild
      _board._state = state;
      if (idx >= 0 && _analysis.moves[idx].move) {
        const m = _analysis.moves[idx].move;
        _board.lastMove = { from: m.from, to: m.to };
      } else {
        _board.lastMove = null;
      }
      _board.render();
    }

    _syncHL();
    _updateNav();
    if (_engineOn) _reqEval();
  }

  function _updateNav() {
    if (!_analysis) return;
    const total = _analysis.moves.length, idx = _currentIdx;

    const counter = $("na-move-counter");
    if (counter) counter.textContent = idx < 0 ? `Start / ${total}` : `${idx + 1} / ${total}`;

    const atStart = idx <= -1, atEnd = idx >= total - 1;
    const dis = (id, v) => { const el = $(id); if (el) el.disabled = v; };
    dis("na-btn-start", atStart); dis("na-btn-prev", atStart);
    dis("na-btn-next",  atEnd);   dis("na-btn-end",  atEnd);

    const state = getStateAtIndex(_analysis, idx);
    const st    = $("na-board-status");
    if (st) {
      if      (state.isCheckmate())              st.textContent = "♛ Checkmate";
      else if (state.isStalemate())              st.textContent = "½ Stalemate";
      else if (state.isDraw50())                 st.textContent = "½ 50-move rule";
      else if (state.isInCheck(state.turn))      st.textContent = `${state.turn === "w" ? "White" : "Black"} in check!`;
      else                                       st.textContent = `${state.turn === "w" ? "White" : "Black"} to move`;
    }
  }

  // ── auto-play ─────────────────────────────────────────────────────────

  function _togglePlay() {
    if (_autoPlay) { _stopPlay(); return; }
    if (!_analysis || _currentIdx >= _analysis.moves.length - 1) { _go(-1); setTimeout(_startPlay, 200); }
    else _startPlay();
  }

  function _startPlay() {
    const b = $("na-btn-play"); if (b) b.textContent = "⏸";
    _autoPlay = setInterval(() => {
      if (!_analysis || _currentIdx >= _analysis.moves.length - 1) { _stopPlay(); return; }
      _go(_currentIdx + 1);
    }, 850);
  }

  function _stopPlay() {
    if (_autoPlay) { clearInterval(_autoPlay); _autoPlay = null; }
    const b = $("na-btn-play"); if (b) b.textContent = "▶";
  }

  // ── engine eval ───────────────────────────────────────────────────────

  function _reqEval() {
    if (!_engineOn || !_engine.ready || !_analysis) return;
    clearTimeout(_evalTimer);
    _evalTimer = setTimeout(() => {
      _engine.stop();
      const fen = getStateAtIndex(_analysis, _currentIdx).toFen();
      _setEval("…", null, null);
      _engine.evaluate(fen, 16, ({ score, bestMove, depth }) => {
        if (score !== undefined) _setEval(score, bestMove, depth);
      });
    }, 250);
  }

  function _setEval(score, bestMove, depth) {
    const el = $("na-eval-label"); if (el) el.textContent = score || "—";
    const be = $("na-eval-best");  if (be) be.textContent = bestMove ? `Best: ${bestMove}` : "";
    const de = $("na-eval-depth"); if (de && depth) de.textContent = `d${depth}`;
    const fe = $("na-eval-fill");
    if (fe) {
      let pct = 50;
      if (score && score !== "…" && score !== "—" && score !== "N/A") {
        if (score.includes("M")) pct = score.startsWith("+") ? 95 : 5;
        else { const cp = parseFloat(score) * 100; pct = 50 + Math.tanh(cp / 400) * 45; }
      }
      fe.style.height = Math.max(5, Math.min(95, pct)) + "%";
    }
  }

  // ── correction ────────────────────────────────────────────────────────

  function _applyCorr(moveIndex, sugIndex) {
    if (!_analysis) return;
    const m   = _analysis.moves[moveIndex];
    const san = m.corrections[sugIndex];
    if (!san || !m.state) return;
    const corrMove = sanToMove(m.state, san);
    if (!corrMove) { _toast("Could not apply correction"); return; }
    m.san       = san;
    m.move      = corrMove;
    m.nextState = applyMove(m.state, corrMove);
    m.status    = "corrected";
    const err = _analysis.errors.find(e => e.index === moveIndex);
    if (err) err.corrected = san;

    // Re-propagate downstream moves
    let state = m.nextState;
    for (let i = moveIndex + 1; i < _analysis.moves.length; i++) {
      const mm = _analysis.moves[i];
      mm.state = state;
      if (mm.status === "illegal") break;
      const r = sanToMove(state, mm.san);
      if (r) { mm.move = r; mm.nextState = applyMove(state, r); state = mm.nextState; }
      else   { mm.status = "illegal"; mm.move = null; mm.nextState = null; break; }
    }
    _renderAll();
    _go(moveIndex);
    _toast(`Move ${Math.floor(moveIndex / 2) + 1} corrected → ${san}`);
  }

  // ── helpers ───────────────────────────────────────────────────────────

  function _showParseErr(msg) {
    const host = $("na-errors");
    if (host) host.innerHTML = `<div class="na-error-card na-error-bad">
      <div class="na-err-head"><span class="na-err-badge bad">Parse Error</span></div>
      <div style="font-size:12px;color:var(--red);margin-top:6px">${esc(msg)}</div>
    </div>`;
    const panel = $("na-analysis-panel"); if (panel) panel.style.display = "";
  }

  function _toast(msg) {
    try {
      const t = document.getElementById("toast"); if (!t) return;
      t.textContent = msg; t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2200);
    } catch {}
  }

  // Immortal Game — Anderssen vs Kieseritzky, London 1851
  const SAMPLE_PGN = `[Event "London"]
[White "Anderssen, A"]
[Black "Kieseritzky, L"]
[Result "1-0"]
[ECO "C33"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6
6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6
11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6
16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+
20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`;

  return { init };
})();
