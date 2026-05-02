// ═══════════════════════════════════════════════════════════════════════════
// chess-core.js  — Shared Chess Engine  v1.0
// ─────────────────────────────────────────────────────────────────────────
//  Exports:
//    PIECE, PIECE_CHAR, UNICODE_PIECE, FEN_TO_PIECE   — constants
//    isWhitePiece, isBlackPiece, pieceColor           — helpers
//    INITIAL_FEN                                       — starting FEN
//    ChessState                                        — board model
//    applyMove, algebraicToSq, sqToAlgebraic          — move utilities
//    moveToSAN, sanToMove                              — SAN ↔ move
//    parsePGN, parsePgn                                — PGN parsers
//      parsePGN  → { headers, rawMoves[] }   (notation.js style)
//      parsePgn  → string[]                  (games.js / Chess.com style)
//    fuzzyCorrect                                      — auto-correction
//    analyzePGN, getStateAtIndex                       — analysis pipeline
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// § 1  Piece constants
// ─────────────────────────────────────────────────────────────────────────

export const PIECE = Object.freeze({
  EMPTY: 0,
  WP: 1, WN: 2, WB: 3, WR: 4, WQ: 5, WK: 6,
  BP: 7, BN: 8, BB: 9, BR: 10, BQ: 11, BK: 12,
});

export const PIECE_CHAR = {
  [PIECE.WP]: "P", [PIECE.WN]: "N", [PIECE.WB]: "B",
  [PIECE.WR]: "R", [PIECE.WQ]: "Q", [PIECE.WK]: "K",
  [PIECE.BP]: "p", [PIECE.BN]: "n", [PIECE.BB]: "b",
  [PIECE.BR]: "r", [PIECE.BQ]: "q", [PIECE.BK]: "k",
};

export const UNICODE_PIECE = {
  [PIECE.WK]: "♔", [PIECE.WQ]: "♕", [PIECE.WR]: "♖",
  [PIECE.WB]: "♗", [PIECE.WN]: "♘", [PIECE.WP]: "♙",
  [PIECE.BK]: "♚", [PIECE.BQ]: "♛", [PIECE.BR]: "♜",
  [PIECE.BB]: "♝", [PIECE.BN]: "♞", [PIECE.BP]: "♟",
};

export const FEN_TO_PIECE = {
  "P": PIECE.WP, "N": PIECE.WN, "B": PIECE.WB,
  "R": PIECE.WR, "Q": PIECE.WQ, "K": PIECE.WK,
  "p": PIECE.BP, "n": PIECE.BN, "b": PIECE.BB,
  "r": PIECE.BR, "q": PIECE.BQ, "k": PIECE.BK,
};

export const isWhitePiece = p => p >= 1 && p <= 6;
export const isBlackPiece = p => p >= 7 && p <= 12;
export const pieceColor   = p => p === 0 ? null : isWhitePiece(p) ? "w" : "b";

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ─────────────────────────────────────────────────────────────────────────
// § 2  ChessState — board model with FEN, clone, legal moves
// ─────────────────────────────────────────────────────────────────────────

export class ChessState {
  constructor() {
    this.board     = new Uint8Array(64);
    this.turn      = "w";
    this.castling  = { wk: true, wq: true, bk: true, bq: true };
    this.enPassant = -1;
    this.halfmoves = 0;
    this.fullmoves = 1;
  }

  clone() {
    const c        = new ChessState();
    c.board        = new Uint8Array(this.board);
    c.turn         = this.turn;
    c.castling     = { ...this.castling };
    c.enPassant    = this.enPassant;
    c.halfmoves    = this.halfmoves;
    c.fullmoves    = this.fullmoves;
    return c;
  }

  static fromFen(fen) {
    const s     = new ChessState();
    const parts = (fen || INITIAL_FEN).trim().split(/\s+/);
    let sq = 0;
    for (const ch of (parts[0] || "")) {
      if (ch === "/") continue;
      const n = parseInt(ch, 10);
      if (!isNaN(n)) sq += n;
      else s.board[sq++] = FEN_TO_PIECE[ch] ?? PIECE.EMPTY;
    }
    s.turn      = parts[1] === "b" ? "b" : "w";
    const cast  = parts[2] || "-";
    s.castling  = {
      wk: cast.includes("K"), wq: cast.includes("Q"),
      bk: cast.includes("k"), bq: cast.includes("q"),
    };
    s.enPassant = (parts[3] && parts[3] !== "-") ? algebraicToSq(parts[3]) : -1;
    s.halfmoves = parseInt(parts[4], 10) || 0;
    s.fullmoves = parseInt(parts[5], 10) || 1;
    return s;
  }

  // Alias for Chess.com style callers
  static fromFEN(fen) { return ChessState.fromFen(fen); }

  toFen() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = "", empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (p === PIECE.EMPTY) { empty++; }
        else { if (empty) { row += empty; empty = 0; } row += PIECE_CHAR[p]; }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const cast = [
      this.castling.wk ? "K" : "", this.castling.wq ? "Q" : "",
      this.castling.bk ? "k" : "", this.castling.bq ? "q" : "",
    ].join("") || "-";
    const ep = this.enPassant >= 0 ? sqToAlgebraic(this.enPassant) : "-";
    return `${rows.join("/")} ${this.turn} ${cast} ${ep} ${this.halfmoves} ${this.fullmoves}`;
  }

  // Alias for external callers
  toFEN() { return this.toFen(); }

  kingSquare(color) {
    const king = color === "w" ? PIECE.WK : PIECE.BK;
    return this.board.indexOf(king);
  }

  isSquareAttacked(sq, byColor) {
    const b      = this.board;
    const knight = byColor === "w" ? PIECE.WN : PIECE.BN;
    for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr = (sq >> 3) + dr, nf = (sq & 7) + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && b[nr * 8 + nf] === knight) return true;
    }
    const bishop = byColor === "w" ? PIECE.WB : PIECE.BB;
    const queen  = byColor === "w" ? PIECE.WQ : PIECE.BQ;
    for (const [dr, df] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let nr = (sq >> 3) + dr, nf = (sq & 7) + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const p = b[nr * 8 + nf];
        if (p !== PIECE.EMPTY) { if (p === bishop || p === queen) return true; break; }
        nr += dr; nf += df;
      }
    }
    const rook = byColor === "w" ? PIECE.WR : PIECE.BR;
    for (const [dr, df] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = (sq >> 3) + dr, nf = (sq & 7) + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const p = b[nr * 8 + nf];
        if (p !== PIECE.EMPTY) { if (p === rook || p === queen) return true; break; }
        nr += dr; nf += df;
      }
    }
    const king = byColor === "w" ? PIECE.WK : PIECE.BK;
    for (const [dr, df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const nr = (sq >> 3) + dr, nf = (sq & 7) + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && b[nr * 8 + nf] === king) return true;
    }
    const pawn = byColor === "w" ? PIECE.WP : PIECE.BP;
    const pdr  = byColor === "w" ? 1 : -1;
    for (const df of [-1, 1]) {
      const nr = (sq >> 3) + pdr, nf = (sq & 7) + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && b[nr * 8 + nf] === pawn) return true;
    }
    return false;
  }

  isInCheck(color) {
    const kSq = this.kingSquare(color);
    return kSq >= 0 && this.isSquareAttacked(kSq, color === "w" ? "b" : "w");
  }

  legalMoves() {
    const moves    = [];
    const color    = this.turn;
    const myPiece  = p => pieceColor(p) === color;
    const oppPiece = p => p !== PIECE.EMPTY && pieceColor(p) !== color;

    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!myPiece(p)) continue;
      const r = sq >> 3, f = sq & 7;
      const pseudo = [];

      if (p === PIECE.WP || p === PIECE.BP) {
        const dir       = color === "w" ? -1 : 1;
        const startRank = color === "w" ? 6 : 1;
        const promRank  = color === "w" ? 0 : 7;
        const nr1 = r + dir;
        if (nr1 >= 0 && nr1 < 8) {
          if (this.board[nr1 * 8 + f] === PIECE.EMPTY) {
            _pushPawn(pseudo, sq, nr1 * 8 + f, p, PIECE.EMPTY, promRank, color);
            const nr2 = r + 2 * dir;
            if (r === startRank && nr2 >= 0 && nr2 < 8 && this.board[nr2 * 8 + f] === PIECE.EMPTY)
              pseudo.push({ from: sq, to: nr2 * 8 + f, piece: p, cap: PIECE.EMPTY, prom: 0 });
          }
          for (const df of [-1, 1]) {
            const nf2 = f + df;
            if (nf2 < 0 || nf2 >= 8) continue;
            const nSq = nr1 * 8 + nf2;
            if (oppPiece(this.board[nSq]))
              _pushPawn(pseudo, sq, nSq, p, this.board[nSq], promRank, color);
            if (this.enPassant >= 0 && nSq === this.enPassant)
              pseudo.push({ from: sq, to: nSq, piece: p, cap: color === "w" ? PIECE.BP : PIECE.WP, prom: 0, ep: true });
          }
        }
      } else if (p === PIECE.WN || p === PIECE.BN) {
        for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const nr = r + dr, nf2 = f + df;
          if (nr >= 0 && nr < 8 && nf2 >= 0 && nf2 < 8) {
            const nSq = nr * 8 + nf2;
            if (!myPiece(this.board[nSq]))
              pseudo.push({ from: sq, to: nSq, piece: p, cap: this.board[nSq], prom: 0 });
          }
        }
      } else if (p === PIECE.WB || p === PIECE.BB) {
        _slide(pseudo, this, sq, p, [[-1,-1],[-1,1],[1,-1],[1,1]], myPiece);
      } else if (p === PIECE.WR || p === PIECE.BR) {
        _slide(pseudo, this, sq, p, [[-1,0],[1,0],[0,-1],[0,1]], myPiece);
      } else if (p === PIECE.WQ || p === PIECE.BQ) {
        _slide(pseudo, this, sq, p, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]], myPiece);
      } else if (p === PIECE.WK || p === PIECE.BK) {
        for (const [dr, df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const nr = r + dr, nf2 = f + df;
          if (nr >= 0 && nr < 8 && nf2 >= 0 && nf2 < 8) {
            const nSq = nr * 8 + nf2;
            if (!myPiece(this.board[nSq]))
              pseudo.push({ from: sq, to: nSq, piece: p, cap: this.board[nSq], prom: 0 });
          }
        }
        const inChk = this.isInCheck(color);
        if (!inChk && color === "w" && sq === 60) {
          if (this.castling.wk && this.board[61] === 0 && this.board[62] === 0 &&
              !this.isSquareAttacked(61, "b") && !this.isSquareAttacked(62, "b"))
            pseudo.push({ from: sq, to: 62, piece: p, cap: 0, prom: 0, castle: "wk" });
          if (this.castling.wq && this.board[59] === 0 && this.board[58] === 0 && this.board[57] === 0 &&
              !this.isSquareAttacked(59, "b") && !this.isSquareAttacked(58, "b"))
            pseudo.push({ from: sq, to: 58, piece: p, cap: 0, prom: 0, castle: "wq" });
        }
        if (!inChk && color === "b" && sq === 4) {
          if (this.castling.bk && this.board[5] === 0 && this.board[6] === 0 &&
              !this.isSquareAttacked(5, "w") && !this.isSquareAttacked(6, "w"))
            pseudo.push({ from: sq, to: 6, piece: p, cap: 0, prom: 0, castle: "bk" });
          if (this.castling.bq && this.board[3] === 0 && this.board[2] === 0 && this.board[1] === 0 &&
              !this.isSquareAttacked(3, "w") && !this.isSquareAttacked(2, "w"))
            pseudo.push({ from: sq, to: 2, piece: p, cap: 0, prom: 0, castle: "bq" });
        }
      }

      for (const m of pseudo) {
        const next = applyMove(this, m);
        if (!next.isInCheck(color)) moves.push(m);
      }
    }
    return moves;
  }

  isCheckmate() { return this.isInCheck(this.turn) && this.legalMoves().length === 0; }
  isStalemate() { return !this.isInCheck(this.turn) && this.legalMoves().length === 0; }
  isDraw50()    { return this.halfmoves >= 100; }
}

// ── Private helpers ──────────────────────────────────────────────────────

function _pushPawn(arr, from, to, piece, cap, promRank, color) {
  if ((to >> 3) === promRank) {
    const promos = color === "w"
      ? [PIECE.WQ, PIECE.WR, PIECE.WB, PIECE.WN]
      : [PIECE.BQ, PIECE.BR, PIECE.BB, PIECE.BN];
    for (const prom of promos) arr.push({ from, to, piece, cap, prom });
  } else {
    arr.push({ from, to, piece, cap, prom: 0 });
  }
}

function _slide(arr, state, sq, piece, dirs, myPiece) {
  const r = sq >> 3, f = sq & 7;
  for (const [dr, df] of dirs) {
    let nr = r + dr, nf = f + df;
    while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
      const nSq = nr * 8 + nf, target = state.board[nSq];
      if (myPiece(target)) break;
      arr.push({ from: sq, to: nSq, piece, cap: target, prom: 0 });
      if (target !== PIECE.EMPTY) break;
      nr += dr; nf += df;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// § 3  Move application & algebraic utilities
// ─────────────────────────────────────────────────────────────────────────

export function applyMove(state, move) {
  const next = state.clone();
  const { from, to, piece, cap, prom, ep, castle } = move;
  const color = state.turn;
  next.board[from] = PIECE.EMPTY;
  next.board[to]   = prom || piece;
  if (ep)              next.board[color === "w" ? to + 8 : to - 8] = PIECE.EMPTY;
  if (castle === "wk") { next.board[63] = PIECE.EMPTY; next.board[61] = PIECE.WR; }
  if (castle === "wq") { next.board[56] = PIECE.EMPTY; next.board[59] = PIECE.WR; }
  if (castle === "bk") { next.board[7]  = PIECE.EMPTY; next.board[5]  = PIECE.BR; }
  if (castle === "bq") { next.board[0]  = PIECE.EMPTY; next.board[3]  = PIECE.BR; }
  if (piece === PIECE.WK) { next.castling.wk = false; next.castling.wq = false; }
  if (piece === PIECE.BK) { next.castling.bk = false; next.castling.bq = false; }
  if (from === 63 || to === 63) next.castling.wk = false;
  if (from === 56 || to === 56) next.castling.wq = false;
  if (from === 7  || to === 7)  next.castling.bk = false;
  if (from === 0  || to === 0)  next.castling.bq = false;
  const isPawn = piece === PIECE.WP || piece === PIECE.BP;
  next.enPassant = (isPawn && Math.abs((from >> 3) - (to >> 3)) === 2) ? (from + to) >> 1 : -1;
  next.halfmoves = (isPawn || cap !== PIECE.EMPTY) ? 0 : state.halfmoves + 1;
  if (color === "b") next.fullmoves = state.fullmoves + 1;
  next.turn = color === "w" ? "b" : "w";
  return next;
}

export function algebraicToSq(s) {
  if (!s || s.length < 2) return -1;
  const f = s.charCodeAt(0) - 97, r = 8 - parseInt(s[1], 10);
  return (f < 0 || f > 7 || r < 0 || r > 7) ? -1 : r * 8 + f;
}

export function sqToAlgebraic(sq) {
  return String.fromCharCode(97 + (sq & 7)) + (8 - (sq >> 3));
}

// ─────────────────────────────────────────────────────────────────────────
// § 4  SAN ↔ move conversion
// ─────────────────────────────────────────────────────────────────────────

const _PLETTER = {
  [PIECE.WP]: "", [PIECE.BP]: "",
  [PIECE.WN]: "N", [PIECE.BN]: "N",
  [PIECE.WB]: "B", [PIECE.BB]: "B",
  [PIECE.WR]: "R", [PIECE.BR]: "R",
  [PIECE.WQ]: "Q", [PIECE.BQ]: "Q",
  [PIECE.WK]: "K", [PIECE.BK]: "K",
};

const _PROM_CHAR = {
  [PIECE.WQ]: "Q", [PIECE.BQ]: "Q",
  [PIECE.WR]: "R", [PIECE.BR]: "R",
  [PIECE.WB]: "B", [PIECE.BB]: "B",
  [PIECE.WN]: "N", [PIECE.BN]: "N",
};

export function moveToSAN(state, move, cachedLegal) {
  const { from, to, piece, prom, castle, ep } = move;
  if (castle === "wk" || castle === "bk") return "O-O";
  if (castle === "wq" || castle === "bq") return "O-O-O";

  const pieceType = _PLETTER[piece] ?? "";
  const isPawn    = pieceType === "";
  const isCapture = state.board[to] !== PIECE.EMPTY || ep;
  const toSq      = sqToAlgebraic(to);
  let dFile = "", dRank = "";

  if (!isPawn) {
    const ambig = (cachedLegal || state.legalMoves())
      .filter(m => m.to === to && m.piece === piece && m.from !== from);
    if (ambig.length) {
      const sameFile = ambig.some(m => (m.from & 7) === (from & 7));
      const sameRank = ambig.some(m => (m.from >> 3) === (from >> 3));
      if (!sameFile)       dFile = String.fromCharCode(97 + (from & 7));
      else if (!sameRank)  dRank = String(8 - (from >> 3));
      else { dFile = String.fromCharCode(97 + (from & 7)); dRank = String(8 - (from >> 3)); }
    }
  }

  let san = pieceType;
  if (isPawn && isCapture) san += String.fromCharCode(97 + (from & 7));
  san += dFile + dRank;
  if (isCapture) san += "x";
  san += toSq;
  if (prom) san += "=" + (_PROM_CHAR[prom] || "Q");

  const next = applyMove(state, move);
  if (next.isCheckmate())        san += "#";
  else if (next.isInCheck(next.turn)) san += "+";
  return san;
}

export function sanToMove(state, san, cachedLegal) {
  let s = san.replace(/[+#!?]/g, "").trim();

  // Castling
  if (s === "O-O-O" || s === "0-0-0" || s === "o-o-o")
    return (cachedLegal || state.legalMoves())
      .find(m => m.castle === (state.turn === "w" ? "wq" : "bq")) || null;
  if (s === "O-O" || s === "0-0" || s === "o-o")
    return (cachedLegal || state.legalMoves())
      .find(m => m.castle === (state.turn === "w" ? "wk" : "bk")) || null;

  // Promotion
  let promPiece = 0;
  const pm = s.match(/=([QRBNqrbn])$/);
  const _promMap = (c, ltr) => ({
    Q: c === "w" ? PIECE.WQ : PIECE.BQ, R: c === "w" ? PIECE.WR : PIECE.BR,
    B: c === "w" ? PIECE.WB : PIECE.BB, N: c === "w" ? PIECE.WN : PIECE.BN,
  })[ltr.toUpperCase()] || 0;

  if (pm) {
    promPiece = _promMap(state.turn, pm[1]);
    s = s.replace(/=[QRBNqrbn]$/, "");
  } else if (/^[a-h][18][QRBNqrbn]$/.test(s)) {
    promPiece = _promMap(state.turn, s.slice(-1));
    s = s.slice(0, -1);
  }

  const tm = s.match(/([a-h][1-8])$/);
  if (!tm) return null;
  const toSq = algebraicToSq(tm[1]);
  s = s.slice(0, -2).replace("x", "");

  let ptLetter = "";
  if (s.length > 0 && /[NBRQK]/.test(s[0])) { ptLetter = s[0]; s = s.slice(1); }

  let dFile = -1, dRank = -1;
  for (const ch of s) {
    if (/[a-h]/.test(ch)) dFile = ch.charCodeAt(0) - 97;
    else if (/[1-8]/.test(ch)) dRank = 8 - parseInt(ch, 10);
  }

  const color = state.turn;
  const WANTED = {
    "":  color === "w" ? [PIECE.WP] : [PIECE.BP],
    "N": color === "w" ? [PIECE.WN] : [PIECE.BN],
    "B": color === "w" ? [PIECE.WB] : [PIECE.BB],
    "R": color === "w" ? [PIECE.WR] : [PIECE.BR],
    "Q": color === "w" ? [PIECE.WQ] : [PIECE.BQ],
    "K": color === "w" ? [PIECE.WK] : [PIECE.BK],
  };
  const wanted = WANTED[ptLetter] || [];

  const cands = (cachedLegal || state.legalMoves()).filter(m => {
    if (!wanted.includes(m.piece))             return false;
    if (m.to !== toSq)                         return false;
    if (dFile >= 0 && (m.from & 7) !== dFile)  return false;
    if (dRank >= 0 && (m.from >> 3) !== dRank) return false;
    if (promPiece) { if (m.prom !== promPiece) return false; }
    else if (m.prom && ![PIECE.WQ, PIECE.BQ].includes(m.prom)) return false;
    return true;
  });
  return cands.length === 1 ? cands[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────
// § 5  PGN parsers
// ─────────────────────────────────────────────────────────────────────────

/**
 * parsePGN — notation.js style.
 * Returns { headers: {}, rawMoves: string[] }
 * Handles standard PGN with newline-separated [Tag "Value"] headers.
 */
export function parsePGN(pgn) {
  const result = { headers: {}, rawMoves: [] };
  let moveText = "";
  for (const line of (pgn || "").replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) {
      const m = t.match(/^\[(\w+)\s+"(.*)"\]$/);
      if (m) result.headers[m[1]] = m[2];
    } else if (t) {
      moveText += " " + t;
    }
  }
  moveText = moveText
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  result.rawMoves = moveText
    .split(/\s+/)
    .filter(t => t.length > 0 && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  return result;
}

/**
 * parsePgn — games.js / Chess.com style.
 * Returns a flat string[] of SAN half-moves.
 * Handles packed headers, fused move numbers, back-to-back moves, and all
 * known Chess.com API quirks.
 */
export function parsePgn(pgn) {
  if (!pgn || typeof pgn !== "string") return [];

  let text = pgn;

  // STEP 1: Strip [Tag "Value"] headers (multiple passes for packed tags)
  for (let i = 0; i < 6; i++) text = text.replace(/\[[^\[\]]*\]/g, " ");
  text = text.replace(/\[[^\]]*$/gm, " ");

  // STEP 2: Strip comments, variations, NAGs, % annotations
  text = text.replace(/\{[^}]*\}/g, " ");
  text = text.replace(/\([^)]*\)/g, " ");
  text = text.replace(/%[^\s]*/g, " ");
  text = text.replace(/\$\d+/g, " ");

  // STEP 3: Strip URLs and bare quoted strings left after header removal
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/"[^"]*"/g, " ");

  // STEP 4: Separate back-to-back fused moves (4 passes for long chains)
  for (let i = 0; i < 4; i++) {
    text = text.replace(/([a-h][1-8](?:[+#]|=[BKNQR])?)([a-hBKNQRO])/g, "$1 $2");
  }

  // STEP 5: Separate move numbers fused directly after moves
  text = text.replace(/([a-h][1-8])(\d{2,})/g, "$1 $2");

  // STEP 6: Strip move numbers
  text = text.replace(/\d+\.+/g, " ");

  // STEP 7: Strip result markers and termination keywords
  text = text.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " ");
  text = text.replace(
    /\b(won|by|resignation|checkmate|on|time|abandoned|forfeit|timeout|repetition|agreement|stalemate|insufficient|material)\b/gi,
    " "
  );

  // STEP 8: Tokenise
  const tokens = text.trim().split(/\s+/).filter(Boolean);

  // STEP 9: Strict SAN filter
  const SAN_RE = /^(O-O(?:-O)?(?:[+#])?|[BKNQR][a-h]?[1-8]?x?[a-h][1-8](?:=[BKNQR])?[+#!?]{0,2}|[a-h](?:x[a-h])?[1-8](?:=[BKNQR])?[+#!?]{0,2})$/;
  let moves = tokens.filter(t => SAN_RE.test(t));

  // STEP 10: Fallback brute-force scan if too few survived
  if (moves.length < 5) {
    const fallback = text.match(
      /\b(O-O(?:-O)?|[BKNQR][a-h]?[1-8]?x?[a-h][1-8](?:=[BKNQR])?|[a-h](?:x[a-h])?[1-8](?:=[BKNQR])?)[+#]?\b/g
    ) || [];
    if (fallback.length > moves.length) moves = fallback;
  }

  return moves.slice(0, 500);
}

// ─────────────────────────────────────────────────────────────────────────
// § 6  Auto-correction / fuzzy matching
// ─────────────────────────────────────────────────────────────────────────

export function fuzzyCorrect(state, rawSan) {
  const lm = state.legalMoves();
  if (!lm.length) return [];
  const norm   = rawSan.replace(/[+#!?]/g, "");
  const scored = lm.slice(0, 60).map(m => {
    const san = moveToSAN(state, m);
    return { move: m, san, score: _sanSim(norm, san.replace(/[+#]/g, "")) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score > 0.25).slice(0, 3);
}

function _sanSim(a, b) {
  const dA = a.match(/[a-h][1-8]$/)?.[0];
  const dB = b.match(/[a-h][1-8]$/)?.[0];
  const destBonus  = dA && dA === dB ? 0.45 : 0;
  const pA = /^[NBRQK]/.test(a) ? a[0] : "";
  const pB = /^[NBRQK]/.test(b) ? b[0] : "";
  const pieceBonus = (pA || pB) ? (pA === pB ? 0.25 : 0) : 0.1;
  return Math.min(1, destBonus + pieceBonus + _levenSim(a, b) * 0.3);
}

function _levenSim(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

// ─────────────────────────────────────────────────────────────────────────
// § 7  Full analysis pipeline
// ─────────────────────────────────────────────────────────────────────────

/**
 * Analyze a full PGN string.
 * Returns { headers, moves[], errors[], initialState, finalState }
 *
 * moves[i] = {
 *   san:         string       — canonical SAN (possibly auto-corrected)
 *   move:        object|null  — internal move descriptor
 *   state:       ChessState   — board BEFORE this move
 *   nextState:   ChessState   — board AFTER this move, or null
 *   original:    string       — raw token from PGN
 *   status:      "ok"|"corrected"|"ambiguous"|"illegal"
 *   corrections: string[]     — candidate corrected SANs
 * }
 */
export function analyzePGN(pgn) {
  const parsed       = parsePGN(pgn);
  const fen          = parsed.headers.FEN || INITIAL_FEN;
  let state          = ChessState.fromFen(fen);
  const initialState = state.clone();
  const moves        = [];
  const errors       = [];

  for (let i = 0; i < parsed.rawMoves.length; i++) {
    const raw     = parsed.rawMoves[i];
    const moveNum = Math.floor(i / 2) + 1;
    const side    = i % 2 === 0 ? "White" : "Black";

    const legalCache = state.legalMoves();
    const resolved   = sanToMove(state, raw, legalCache);

    if (resolved) {
      const san       = moveToSAN(state, resolved, legalCache);
      const nextState = applyMove(state, resolved);
      moves.push({ san, move: resolved, state, nextState, original: raw, status: "ok", corrections: [] });
      state = nextState;
    } else {
      const suggestions = fuzzyCorrect(state, raw);

      if (suggestions.length && suggestions[0].score > 0.65) {
        const best    = suggestions[0];
        const isAmbig = suggestions.length > 1 && suggestions[1].score > 0.58;
        const nextState = applyMove(state, best.move);
        errors.push({
          index: i, moveNum, side, original: raw, corrected: best.san,
          reason: `"${raw}" is not legal — auto-corrected to "${best.san}"` + (isAmbig ? " (multiple candidates)" : ""),
          suggestions: suggestions.map(s => s.san), ambiguous: isAmbig,
        });
        moves.push({
          san: best.san, move: best.move, state, nextState,
          original: raw, status: isAmbig ? "ambiguous" : "corrected",
          corrections: suggestions.map(s => s.san),
        });
        state = nextState;
      } else {
        errors.push({
          index: i, moveNum, side, original: raw, corrected: null,
          reason: suggestions.length
            ? `"${raw}" is not legal — did you mean: ${suggestions.map(s => s.san).join(", ")}?`
            : `"${raw}" is not a legal move in this position`,
          suggestions: suggestions.map(s => s.san), ambiguous: false,
        });
        moves.push({
          san: raw, move: null, state, nextState: null,
          original: raw, status: "illegal", corrections: suggestions.map(s => s.san),
        });
        break;
      }
    }
  }
  return { headers: parsed.headers, moves, errors, initialState, finalState: state };
}

/**
 * Return ChessState at a given move index.
 * index -1 → initial position; index n → position after move n.
 */
export function getStateAtIndex(analysis, index) {
  if (index < 0 || !analysis.moves.length) return analysis.initialState;
  const m = analysis.moves[Math.min(index, analysis.moves.length - 1)];
  return m.nextState || m.state;
}
