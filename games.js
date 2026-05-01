"use strict";

import { State }    from "./state.js";
import { LiveSync } from "./liveSync.js";
import { Home }     from "./home.js";
import { Progress } from "./progress.js";
import { Settings } from "./settings.js";
import {
  $,
  $$,
  haptic,
  setText,
  emptyStateHtml,
  Toast,
  Modal,
} from "./ui-core.js";
import { esc } from "./coach.js";

// ═══════════════════════════════════════════════════════════
// GAMES LIST
// ═══════════════════════════════════════════════════════════

export const Games = {
  _pageSize: 10,
  _shown:    10,
  _activeFilter: "all",

  render(filter = "all") {
    this._activeFilter = filter;
    const host = $("games-list");
    if (!host) return;
    const all = State.get().games;

    const FILTERS = {
      win:        g => g.result === "win",
      loss:       g => g.result === "loss",
      draw:       g => g.result === "draw",
      "high-acc": g => (g.accuracy || 0) >= 88,
    };
    const filtered = FILTERS[filter] ? all.filter(FILTERS[filter]) : all;

    setText("games-count-pill", `${filtered.length} game${filtered.length !== 1 ? "s" : ""}`);

    if (!filtered.length) {
      host.innerHTML = emptyStateHtml({
        icon: "♟",
        heading: filter === "all" ? "No games yet" : `No ${filter} games`,
        sub: filter === "all"
          ? "Sync from Chess.com or Lichess to see your games here."
          : `No ${filter}s match the current filter.`,
        btnHtml: filter === "all"
          ? `<button class="btn btn-primary" style="margin-top:16px" id="empty-sync-btn">Sync games</button>`
          : "",
      });
      $("empty-sync-btn")?.addEventListener("click", async () => {
        await LiveSync.syncAll({
          toast:    (m, ms) => Toast.show(m, ms),
          setBadge: text => { const b = $("data-source-badge"); if (b) b.textContent = text; },
          setBusy:  on   => { const b = $("sync-data-btn"); if (b) { b.style.opacity = on ? "0.6" : "1"; b.style.pointerEvents = on ? "none" : ""; } },
        });
        Home.render(); Progress.render();
        Games.render(Games._activeFilter);
        Settings.render();
      });
      return;
    }

    const visible = filtered.slice(0, this._shown);
    host.innerHTML = visible.map(g => this._cardHtml(g)).join("");

    if (filtered.length > this._shown) {
      const remaining = Math.min(this._pageSize, filtered.length - this._shown);
      const btn = document.createElement("button");
      btn.id        = "load-more-games";
      btn.className = "btn btn-secondary btn-full";
      btn.style.cssText = "margin:10px 16px;width:calc(100% - 32px)";
      btn.textContent   = `Load ${remaining} more`;
      btn.addEventListener("click", () => { this._shown += this._pageSize; this.render(this._activeFilter); });
      host.appendChild(btn);
    }
  },

  _cardHtml(g) {
    const RC = { win: "pill-brand", loss: "pill-red", draw: "pill-saffron" };
    const SC = { "chess.com": "pill-saffron", lichess: "pill-blue" };
    const deltaHtml = g.delta != null ? `<span class="pill pill-gray">${esc(g.delta)}</span>` : "";
    const accHtml   = g.accuracy != null
      ? `<span class="pill pill-gray">${g.accuracy}% acc</span>`
      : `<span class="pill pill-gray" style="opacity:.5">acc N/A</span>`;

    return `
      <article class="game-card ${esc(g.result)}" data-open-game="${esc(g.id)}"
               tabindex="0" role="button"
               aria-label="${esc(g.result)} vs ${esc(g.opp)}: ${esc(g.opening)}">
        <div class="game-info" style="width:100%">
          <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px">
            <span class="pill ${RC[g.result] || "pill-gray"}">${esc(g.result)}</span>
            ${deltaHtml}
            <span class="pill ${SC[g.source] || "pill-gray"}" style="font-size:10px">${esc(g.source || "local")}</span>
            ${g.rated === false ? `<span class="pill pill-gray" style="font-size:10px">Casual</span>` : ""}
          </div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:3px">${esc(g.opening)}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px">
            vs ${esc(g.opp)}${g.oppRating ? ` (${g.oppRating})` : ""} &middot; ${esc(g.date)} &middot; ${esc(g.timeControl || "&#8212;")}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${accHtml}
            ${g.blunders != null
              ? `<span class="pill ${g.blunders ? "pill-red" : "pill-brand"}">${g.blunders} blunder${g.blunders !== 1 ? "s" : ""}</span>`
              : ""}
            <span class="pill pill-gray">${g.moves} moves</span>
          </div>
        </div>
        <div style="position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:16px" aria-hidden="true">&#8250;</div>
      </article>`;
  },

  bindGameViewer() {
    const list = $("games-list");
    if (!list) return;
    list.addEventListener("click",   e => this._handleOpen(e));
    list.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._handleOpen(e); }
    });
  },

  _handleOpen(e) {
    const id = e.target?.closest("[data-open-game]")?.dataset?.openGame;
    if (!id) return;
    const game = State.get().games.find(g => g.id === id);
    if (game) { haptic(6); GameViewer.open(game); }
  },
};

// ═══════════════════════════════════════════════════════════
// PGN PARSING
// ═══════════════════════════════════════════════════════════

/**
 * Robustly parse a PGN string (Chess.com or Lichess) into a clean
 * array of SAN half-moves: ["e4", "e5", "Nf3", "Nc6", ...]
 *
 * Handles all known Chess.com API quirks, including:
 *  - Normal PGN with newline-separated [Tag "value"] headers
 *  - Packed/concatenated headers with no whitespace, e.g.:
 *      [Event"Live Chess"][Site"Chess.com"]e4...
 *  - Headers smashed directly into moves, e.g.:
 *      [White"avzen_v"][Black"SWASTIK3157"]e426.e5Nc327.Nf6...
 *  - Move numbers fused to moves, e.g. "e426." "Nc327." "d5exf634."
 *  - Back-to-back moves with no separator, e.g. "e5Nc3" "Nf6f4"
 *  - Comments {…}, variations (…), NAGs $n, clock %clk / %eval
 *  - Player names / URLs / ECO codes / result strings in the body
 *  - Lichess "moves" field (plain space-separated SAN, no headers)
 *
 * Strategy: clean → split fused moves → split fused numbers → strip numbers → filter SAN.
 */
function parsePgn(pgn) {
  if (!pgn || typeof pgn !== "string") return [];

  let text = pgn;

  // ── STEP 1: Strip ALL [Tag "Value"] header blocks (6 passes) ─────────────
  // Chess.com packs tags together with no whitespace between them.
  // Multiple passes handle back-to-back packed tags like [A"x"][B"y"].
  for (let i = 0; i < 6; i++) {
    text = text.replace(/\[[^\[\]]*\]/g, " ");
  }
  // Safety net: wipe any unclosed bracket to end-of-line
  text = text.replace(/\[[^\]]*$/gm, " ");

  // ── STEP 2: Strip comments, variations, NAGs, % annotations ─────────────
  text = text.replace(/\{[^}]*\}/g, " ");     // { clock / eval comments }
  text = text.replace(/\([^)]*\)/g, " ");     // (sideline variations)
  text = text.replace(/%[^\s]*/g, " ");       // %clk 0:05:00, %eval, etc.
  text = text.replace(/\$\d+/g, " ");         // $1 $14 NAG codes

  // ── STEP 3: Strip URLs and quoted string remnants ────────────────────────
  // After bracket removal, header values like "avzen_v" or "2025.04.07"
  // can remain as bare quoted strings — nuke them.
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/"[^"]*"/g, " ");

  // ── STEP 4: Separate back-to-back moves with no whitespace ───────────────
  // Chess.com live API sometimes concatenates moves directly, e.g.:
  //   "e5Nc327." → should become "e5 Nc3 27."
  // Insert a space after each destination square [a-h][1-8] when immediately
  // followed by another move-starting character [a-hBKNQRO].
  // Run 4 passes to handle long chains like "e4e5Nf3Nc6".
  for (let i = 0; i < 4; i++) {
    text = text.replace(/([a-h][1-8](?:[+#]|=[BKNQR])?)([a-hBKNQRO])/g, "$1 $2");
  }

  // ── STEP 5: Separate move numbers fused directly after moves ─────────────
  // After step 4 a move like "Nc3" may still have the move number directly
  // attached as extra digits: "Nc327." → insert space → "Nc3 27."
  text = text.replace(/([a-h][1-8])(\d{2,})/g, "$1 $2");

  // ── STEP 6: Strip all move numbers (digit runs + dots) ───────────────────
  text = text.replace(/\d+\.+/g, " ");

  // ── STEP 7: Strip game result markers and garbage keywords ───────────────
  text = text.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ");
  text = text.replace(
    /\b(won|by|resignation|checkmate|on|time|abandoned|forfeit|timeout|repetition|agreement|stalemate|insufficient|material)\b/gi,
    " "
  );

  // ── STEP 8: Tokenise on whitespace ───────────────────────────────────────
  const tokens = text.trim().split(/\s+/).filter(Boolean);

  // ── STEP 9: Strict SAN filter ────────────────────────────────────────────
  // Valid SAN tokens:
  //   Castling:    O-O  or  O-O-O  (+ optional +/# suffix)
  //   Piece move:  [BKNQR] + optional disambig [a-h or 1-8] + optional x
  //                + destination [a-h][1-8] + optional =QRBN + optional +/#
  //   Pawn move:   [a-h] + optional (x[a-h]) + [1-8] + optional =QRBN + +/#
  // Everything else (stray letters, numbers, names, ECO codes) is discarded.
  const SAN_RE = /^(O-O(?:-O)?(?:[+#])?|[BKNQR][a-h]?[1-8]?x?[a-h][1-8](?:=[BKNQR])?[+#!?]{0,2}|[a-h](?:x[a-h])?[1-8](?:=[BKNQR])?[+#!?]{0,2})$/;
  let moves = tokens.filter(t => SAN_RE.test(t));

  // ── STEP 10: Fallback brute-force scan ───────────────────────────────────
  // If very few moves survived (extreme smashing that escaped all steps above),
  // scan the fully-cleaned text directly with a global SAN regex.
  if (moves.length < 5) {
    const fallbackMatches = text.match(
      /\b(O-O(?:-O)?|[BKNQR][a-h]?[1-8]?x?[a-h][1-8](?:=[BKNQR])?|[a-h](?:x[a-h])?[1-8](?:=[BKNQR])?)[+#]?\b/g
    ) || [];
    if (fallbackMatches.length > moves.length) moves = fallbackMatches;
  }

  // ── Safety cap: no real game exceeds 500 half-moves ──────────────────────
  return moves.slice(0, 500);
}

// ═══════════════════════════════════════════════════════════
// BOARD POSITION ENGINE  (lightweight SAN interpreter)
// ═══════════════════════════════════════════════════════════

const CHESS_UNICODE = {
  wK: "\u2654", wQ: "\u2655", wR: "\u2656", wB: "\u2657", wN: "\u2658", wP: "\u2659",
  bK: "\u265A", bQ: "\u265B", bR: "\u265C", bB: "\u265D", bN: "\u265E", bP: "\u265F",
};

// Board layout: board[rank][file], rank 0 = rank-8 (black back rank), file 0 = a-file.
const START_POSITION = [
  ["bR","bN","bB","bQ","bK","bB","bN","bR"],
  ["bP","bP","bP","bP","bP","bP","bP","bP"],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["wP","wP","wP","wP","wP","wP","wP","wP"],
  ["wR","wN","wB","wQ","wK","wB","wN","wR"],
];

/** Return a fresh deep-copy of the starting position. */
function freshBoard() {
  return START_POSITION.map(r => [...r]);
}

/**
 * Replay moves[0..upToIdx] from the starting position and return the resulting board.
 * @param {string[]} moves  - clean SAN half-move array
 * @param {number}   upToIdx - inclusive last move index to apply
 */
function buildBoardFromMoves(moves, upToIdx) {
  const board = freshBoard();
  const end   = Math.min(upToIdx, moves.length - 1);
  for (let i = 0; i <= end; i++) {
    _applyMove(board, moves[i], i % 2 === 0 /* white if even */);
  }
  return board;
}

/**
 * Mutate `board` in-place by applying one SAN half-move.
 * This is a visual approximation sufficient for the vast majority of games.
 *
 * @param {string[][]} board
 * @param {string}     san        - one SAN token, e.g. "e4", "Nxf6", "O-O-O"
 * @param {boolean}    whiteTurn
 */
function _applyMove(board, san, whiteTurn) {
  if (!san) return;

  const c = whiteTurn ? "w" : "b";

  // ── Castling ────────────────────────────────────────────────────────────
  if (san.startsWith("O-O")) {
    const rank = whiteTurn ? 7 : 0;
    if (san.startsWith("O-O-O")) {
      // Queenside
      board[rank][4] = ""; board[rank][2] = c + "K";
      board[rank][0] = ""; board[rank][3] = c + "R";
    } else {
      // Kingside
      board[rank][4] = ""; board[rank][6] = c + "K";
      board[rank][7] = ""; board[rank][5] = c + "R";
    }
    return;
  }

  // ── Strip decorators (check, mate, annotations) ─────────────────────────
  let s = san.replace(/[+#!?]/g, "");

  // ── Promotion — capture trailing "=X", remember promoted piece ──────────
  let promoPiece = "";
  const promoMatch = s.match(/=([QRBN])$/);
  if (promoMatch) {
    promoPiece = promoMatch[1];
    s = s.slice(0, -2);
  }

  // ── Destination square — always the last two characters ─────────────────
  if (s.length < 2) return;
  const destSq = s.slice(-2);
  const toFile = destSq.charCodeAt(0) - 97;   // 'a'→0 … 'h'→7
  const toRank = 8 - parseInt(destSq[1], 10); // '1'→7 … '8'→0
  if (toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) return;

  // ── Determine if pawn or piece move ─────────────────────────────────────
  const firstChar = s[0];
  const isPawn    = firstChar >= "a" && firstChar <= "h";

  if (isPawn) {
    // ── Pawn move ──────────────────────────────────────────────────────────
    const pawn      = c + "P";
    const isCapture = s.includes("x");

    if (isCapture) {
      // Capture: format is "fromFile x toSquare", e.g. "exd5", "fxg8"
      // fromFile is always s[0]; destination is the last two chars (already in toFile/toRank).
      const fromFile = s.charCodeAt(0) - 97;
      // White pawns move up (decreasing rank index), black move down (increasing rank index).
      const fromRank = toRank + (whiteTurn ? 1 : -1);
      if (fromRank >= 0 && fromRank < 8 && board[fromRank][fromFile] === pawn) {
        board[fromRank][fromFile] = "";
        board[toRank][toFile]     = promoPiece ? c + promoPiece : pawn;
      }
      // Note: en-passant leaves a ghost captured pawn — acceptable for visual replay.
    } else {
      // Normal advance: search up to 2 squares back in the direction the pawn came from.
      const dir = whiteTurn ? 1 : -1; // direction toward the pawn's origin
      for (let step = 1; step <= 2; step++) {
        const fr = toRank + dir * step;
        if (fr < 0 || fr > 7) break;
        if (board[fr][toFile] === pawn) {
          board[fr][toFile]     = "";
          board[toRank][toFile] = promoPiece ? c + promoPiece : pawn;
          break;
        }
        if (board[fr][toFile] !== "") break; // path is blocked
      }
    }
    return;
  }

  // ── Piece move ─────────────────────────────────────────────────────────
  const PIECE_LETTERS = { N: "N", B: "B", R: "R", Q: "Q", K: "K" };
  const pieceCode     = c + (PIECE_LETTERS[firstChar] || "P");

  // Disambiguator: the part between the piece letter and the destination square.
  // e.g. "Nef3" → middle = "e" (file disambig)
  //      "R1f3" → middle = "1" (rank disambig)
  //      "Qd1f3"→ middle = "d1" (full square disambig)
  const middle     = s.slice(1, -2).replace("x", "");
  let disambigFile = -1;
  let disambigRank = -1;
  if (middle.length === 1) {
    if (middle >= "a" && middle <= "h")  disambigFile = middle.charCodeAt(0) - 97;
    else if (middle >= "1" && middle <= "8") disambigRank = 8 - parseInt(middle, 10);
  } else if (middle.length === 2) {
    disambigFile = middle.charCodeAt(0) - 97;
    disambigRank = 8 - parseInt(middle[1], 10);
  }

  // Scan the board for the matching piece and move it
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (board[r][f] !== pieceCode) continue;
      if (disambigFile >= 0 && f !== disambigFile) continue;
      if (disambigRank >= 0 && r !== disambigRank) continue;
      board[r][f]           = "";
      board[toRank][toFile] = pieceCode;
      return;
    }
  }
}

/**
 * Extract the destination square string from a SAN token.
 *   "e4"     => "e4"
 *   "Nxf6"   => "f6"
 *   "exd5"   => "d5"
 *   "O-O"    => null  (no single destination square to highlight)
 */
function destSquareFromSan(san) {
  if (!san || san.startsWith("O-")) return null;
  const clean = san.replace(/[+#!?]/g, "").replace(/=[QRBN]$/, "");
  const dest  = clean.slice(-2);
  return /^[a-h][1-8]$/.test(dest) ? dest : null;
}

/** Convert algebraic square string to board [rank, file] indices. */
function squareToIdx(sq) {
  if (!sq || sq.length < 2) return null;
  const f = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return (f >= 0 && f <= 7 && r >= 0 && r <= 7) ? [r, f] : null;
}

// ═══════════════════════════════════════════════════════════
// CHESS BOARD RENDERER
// ═══════════════════════════════════════════════════════════

const ChessBoard = {
  draw(board, highlightSq = null) {
    const canvas = $("game-viewer-board");
    if (!canvas) return;

    // Responsive: largest multiple of 8 that fits the viewport
    const maxW  = Math.min((window.innerWidth || 400) - 48, 340);
    const size  = Math.floor(maxW / 8) * 8;
    const sq    = size / 8;

    canvas.width  = size;
    canvas.height = size;
    canvas.style.cssText =
      `width:${size}px;height:${size}px;display:block;margin:0 auto;` +
      `border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.5)`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const LIGHT = "#f0d9b5";
    const DARK  = "#b58863";
    const HL_L  = "#cdd26a";
    const HL_D  = "#aaa23a";

    let hlRank = -1, hlFile = -1;
    if (highlightSq) {
      const idx = squareToIdx(highlightSq);
      if (idx) [hlRank, hlFile] = idx;
    }

    // 1) Squares
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const light = (r + f) % 2 === 0;
        const hl    = r === hlRank && f === hlFile;
        ctx.fillStyle = hl ? (light ? HL_L : HL_D) : (light ? LIGHT : DARK);
        ctx.fillRect(f * sq, r * sq, sq, sq);
      }
    }

    // 2) Coordinate labels
    const lblSize = Math.max(8, Math.floor(sq * 0.22));
    ctx.font = `bold ${lblSize}px sans-serif`;
    for (let r = 0; r < 8; r++) {
      ctx.fillStyle    = (r + 0) % 2 === 0 ? DARK : LIGHT;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(String(8 - r), 2, r * sq + 2);
    }
    for (let f = 0; f < 8; f++) {
      ctx.fillStyle    = (f + 0) % 2 === 0 ? LIGHT : DARK;
      ctx.textAlign    = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(String.fromCharCode(97 + f), (f + 1) * sq - 2, size - 2);
    }

    // 3) Pieces — stroke pass for contrast then fill pass
    const pieceSize = Math.floor(sq * 0.80);
    ctx.font         = `${pieceSize}px serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r]?.[f];
        if (!piece) continue;
        const sym = CHESS_UNICODE[piece];
        if (!sym) continue;

        const cx      = f * sq + sq / 2;
        const cy      = r * sq + sq / 2;
        const isWhite = piece[0] === "w";

        ctx.strokeStyle = isWhite ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.25)";
        ctx.lineWidth   = Math.max(1, sq * 0.05);
        ctx.strokeText(sym, cx, cy);

        ctx.fillStyle = isWhite ? "#ffffff" : "#1c1c1c";
        ctx.fillText(sym, cx, cy);
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════
// GAME VIEWER
// ═══════════════════════════════════════════════════════════

export const GameViewer = {
  _moves:      [],
  _idx:        0,
  _game:       null,
  _autoTimer:  null,
  _blunderIdx: new Set(),

  open(game) {
    this._game       = game;
    this._idx        = 0;
    this._blunderIdx = new Set();
    clearInterval(this._autoTimer);
    this._autoTimer = null;

    // Reset play button
    const playBtn = $("pb-play");
    if (playBtn) {
      playBtn.textContent = "\u25B6";
      playBtn.title = "Play";
      playBtn.setAttribute("aria-label", "Play");
    }

    // Parse moves
    let moves = [];
    try {
      moves = parsePgn(game.pgn);
    } catch (err) {
      console.warn("GameViewer: PGN parse error", err);
    }
    this._moves = moves;

    // Debug log — helps diagnose PGN parsing issues in DevTools
    console.log("Parsed moves:", moves.length, moves.slice(0, 15));

    // Mark approximate blunder positions
    if ((game.blunders || 0) > 0 && moves.length) {
      this._blunderIdx.add(Math.floor(moves.length * 0.55));
      if (game.blunders > 1)
        this._blunderIdx.add(Math.min(moves.length - 1, Math.floor(moves.length * 0.75)));
    }

    setText("game-modal-title", `Game Review \u00B7 ${game.opening}`);

    // Analysis panel
    const analysis = $("game-analysis-panel");
    if (analysis) {
      const blunderNote = (game.blunders || 0) > 0
        ? ` \u00B7 <span style="color:var(--red)">${game.blunders} blunder${game.blunders > 1 ? "s" : ""}</span> (highlighted)`
        : " \u00B7 No critical blunders \u2014 clean game \u2713";
      const sourceNote = game.source && game.source !== "seed"
        ? `<br>Source: <span style="color:var(--blue)">${esc(game.source)}</span>`
        : "";
      // Warn if PGN parsing only recovered a partial move list
      const partialNote = moves.length > 0 && moves.length < 5
        ? `<br><span style="color:var(--saffron);font-size:11px">⚠️ Partial move list recovered (${moves.length} moves found)</span>`
        : "";
      analysis.innerHTML = `
        <div style="font-size:12px;color:var(--text2);line-height:1.6">
          <strong>Accuracy ${game.accuracy != null ? game.accuracy + "%" : "N/A"}</strong>
          \u00B7 ${moves.length || game.moves} moves${blunderNote}${sourceNote}${partialNote}
        </div>`;
    }

    this._renderMoveList(moves);

    // Open modal then draw board once canvas has real layout dimensions
    Modal.open("game-modal");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this._idx = 0;
      this._updateMoveDisplay();
    }));
  },

  /**
   * Render the move list as paired rows: "1. e4  e5  2. Nf3  Nc6 …"
   * Each half-move chip carries data-move-i for tap-to-jump.
   */
  _renderMoveList(moves) {
    const host = $("game-move-list");
    if (!host) return;

    if (!moves.length) {
      host.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px 0">
        Unable to replay this game \u2014 PGN not available.</div>`;
      return;
    }

    let html = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNum   = Math.floor(i / 2) + 1;
      const wBlunder  = this._blunderIdx.has(i)     ? " blunder" : "";
      const bBlunder  = this._blunderIdx.has(i + 1) ? " blunder" : "";
      const hasBlack  = i + 1 < moves.length;

      html += `<span class="move-pair">`;
      html += `<button class="move-chip${wBlunder}" data-move-i="${i}"
                 aria-label="${moveNum}. ${moves[i]}${wBlunder ? " blunder" : ""}">
                 ${moveNum}.\u202F${esc(moves[i])}
               </button>`;
      if (hasBlack) {
        html += `<button class="move-chip${bBlunder}" data-move-i="${i + 1}"
                   aria-label="${moveNum}... ${moves[i + 1]}${bBlunder ? " blunder" : ""}">
                   ${esc(moves[i + 1])}
                 </button>`;
      }
      html += `</span>`;
    }

    host.innerHTML = html;

    // Delegated click handlers
    host.querySelectorAll("[data-move-i]").forEach(btn =>
      btn.addEventListener("click", () => {
        this._idx = Number(btn.dataset.moveI);
        this._updateMoveDisplay();
      })
    );
  },

  /** Redraw the board canvas for the current move index. */
  _drawBoard() {
    const board = this._moves.length > 0
      ? buildBoardFromMoves(this._moves, this._idx)
      : freshBoard();
    const hl = destSquareFromSan(this._moves[this._idx] || "");
    ChessBoard.draw(board, hl);
  },

  /** Sync chip highlight state and redraw board. */
  _updateMoveDisplay() {
    const { _moves: moves, _idx: idx } = this;

    setText("pb-move-counter",
      moves.length ? `Move ${idx + 1} / ${moves.length}` : "No moves");

    $$("[data-move-i]").forEach(btn => {
      const active = Number(btn.dataset.moveI) === idx;
      btn.style.outline    = active ? "2px solid var(--brand)" : "none";
      btn.style.background = btn.classList.contains("blunder")
        ? (active ? "var(--red)"    : "var(--red-bg)")
        : (active ? "var(--surface2)" : "var(--surface)");
      btn.style.fontWeight = active ? "700" : "";
      if (active) {
        btn.setAttribute("aria-current", "true");
        btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        btn.removeAttribute("aria-current");
      }
    });

    this._drawBoard();
  },

  bindControls() {
    $("close-game-modal")?.addEventListener("click", () => {
      clearInterval(this._autoTimer); this._autoTimer = null;
      Modal.close("game-modal");
    });

    $("pb-start")?.addEventListener("click", () => {
      this._idx = 0; this._updateMoveDisplay();
    });
    $("pb-end")?.addEventListener("click", () => {
      this._idx = Math.max(0, this._moves.length - 1); this._updateMoveDisplay();
    });
    $("pb-prev")?.addEventListener("click", () => {
      if (this._idx > 0) { this._idx--; this._updateMoveDisplay(); }
    });
    $("pb-next")?.addEventListener("click", () => {
      if (this._idx < this._moves.length - 1) { this._idx++; this._updateMoveDisplay(); }
    });

    $("pb-play")?.addEventListener("click", () => {
      const btn = $("pb-play");
      if (this._autoTimer) {
        clearInterval(this._autoTimer); this._autoTimer = null;
        btn.textContent = "\u25B6"; btn.title = "Play"; btn.setAttribute("aria-label", "Play");
        return;
      }
      btn.textContent = "\u23F8"; btn.title = "Pause"; btn.setAttribute("aria-label", "Pause");
      this._autoTimer = setInterval(() => {
        if (this._idx >= this._moves.length - 1) {
          clearInterval(this._autoTimer); this._autoTimer = null;
          btn.textContent = "\u25B6"; btn.title = "Play"; btn.setAttribute("aria-label", "Play");
          return;
        }
        this._idx++;
        this._updateMoveDisplay();
      }, 700);
    });

    // Keyboard navigation
    document.addEventListener("keydown", e => {
      if (!$("game-modal")?.classList.contains("open")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (this._idx < this._moves.length - 1) { this._idx++; this._updateMoveDisplay(); }
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (this._idx > 0) { this._idx--; this._updateMoveDisplay(); }
      }
      if (e.key === "Home") { e.preventDefault(); this._idx = 0; this._updateMoveDisplay(); }
      if (e.key === "End")  {
        e.preventDefault();
        this._idx = Math.max(0, this._moves.length - 1); this._updateMoveDisplay();
      }
    });

    // Responsive redraw on resize
    window.addEventListener("resize", () => {
      if ($("game-modal")?.classList.contains("open")) this._drawBoard();
    });
  },
};
