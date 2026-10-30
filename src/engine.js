/* 象棋规则引擎 (Xiangqi rules engine) — plain script, works in browser, Web Worker and Node.
 * Board: Int8Array(90), sq = r*9 + c, r=0 is Black's back rank (top), r=9 is Red's back rank (bottom).
 * Pieces: K=1 帅/将, A=2 仕/士, B=3 相/象, N=4 马, R=5 车, C=6 炮, P=7 兵/卒. Red > 0, Black < 0.
 * Move: from*90 + to (integer).
 */
(function (root) {
  'use strict';
  const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
  const RED = 1, BLACK = -1;
  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const FEN_CH = { k: K, a: A, b: B, e: B, n: N, h: N, r: R, c: C, p: P };
  const CH_FEN = ['', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];
  const NAMES_RED = ['', '帅', '仕', '相', '马', '车', '炮', '兵'];
  const NAMES_BLACK = ['', '将', '士', '象', '马', '车', '炮', '卒'];
  const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  const rowOf = (s) => (s / 9) | 0;
  const colOf = (s) => s % 9;
  const mv = (f, t) => f * 90 + t;
  const mvFrom = (m) => (m / 90) | 0;
  const mvTo = (m) => m % 90;
  const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
  const inPalace = (r, c, side) => c >= 3 && c <= 5 && (side === RED ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
  const ownHalf = (r, side) => (side === RED ? r >= 5 : r <= 4);

  // Zobrist keys (deterministic PRNG so worker and main agree)
  let seed = 0x9e3779b9;
  function rnd32() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
  const ZL = new Int32Array(15 * 90), ZH = new Int32Array(15 * 90);
  for (let i = 0; i < 15 * 90; i++) { ZL[i] = rnd32() | 0; ZH[i] = rnd32() | 0; }
  const ZSIDE_L = rnd32() | 0, ZSIDE_H = rnd32() | 0;
  const zi = (p, s) => (p + 7) * 90 + s;

  const KN_D = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  class Position {
    constructor(fen) { this.board = new Int8Array(90); this.side = RED; this.hist = []; this.hl = 0; this.hh = 0; this.kings = [0, 0]; this.fromFEN(fen || START_FEN); }

    clone() { const p = new Position(); p.board.set(this.board); p.side = this.side; p.hl = this.hl; p.hh = this.hh; p.kings = this.kings.slice(); p.hist = this.hist.map((h) => Object.assign({}, h)); p.startFen = this.startFen; return p; }

    fromFEN(fen) {
      const parts = fen.trim().split(/\s+/);
      const rows = parts[0].split('/');
      if (rows.length !== 10) throw new Error('FEN 行数错误');
      const b = new Int8Array(90);
      for (let r = 0; r < 10; r++) {
        let c = 0;
        for (const ch of rows[r]) {
          if (/[1-9]/.test(ch)) c += +ch;
          else {
            const t = FEN_CH[ch.toLowerCase()];
            if (!t || c > 8) throw new Error('FEN 字符错误: ' + ch);
            b[r * 9 + c] = ch === ch.toUpperCase() ? t : -t; c++;
          }
        }
        if (c !== 9) throw new Error('FEN 第' + (r + 1) + '行列数错误');
      }
      this.board = b;
      this.side = (parts[1] || 'w').toLowerCase() === 'b' ? BLACK : RED;
      this.hist = [];
      this.startFen = this.toFEN();
      this._rehash();
    }

    _rehash() {
      let l = 0, h = 0; this.kings = [-1, -1];
      for (let s = 0; s < 90; s++) { const p = this.board[s]; if (p) { l ^= ZL[zi(p, s)]; h ^= ZH[zi(p, s)]; if (p === K) this.kings[0] = s; if (p === -K) this.kings[1] = s; } }
      if (this.side === BLACK) { l ^= ZSIDE_L; h ^= ZSIDE_H; }
      this.hl = l; this.hh = h;
    }

    toFEN() {
      let out = [];
      for (let r = 0; r < 10; r++) {
        let row = '', e = 0;
        for (let c = 0; c < 9; c++) {
          const p = this.board[r * 9 + c];
          if (!p) { e++; continue; }
          if (e) { row += e; e = 0; }
          const ch = CH_FEN[Math.abs(p)]; row += p > 0 ? ch.toUpperCase() : ch;
        }
        if (e) row += e;
        out.push(row);
      }
      return out.join('/') + ' ' + (this.side === RED ? 'w' : 'b') + ' - - 0 ' + (1 + (this.hist.length >> 1));
    }

    kingSq(side) { return this.kings[side === RED ? 0 : 1]; }

    makeMove(m) {
      const f = mvFrom(m), t = mvTo(m), b = this.board, p = b[f], cap = b[t];
      this.hist.push({ m, cap, hl: this.hl, hh: this.hh });
      let l = this.hl ^ ZL[zi(p, f)] ^ ZL[zi(p, t)] ^ ZSIDE_L, h = this.hh ^ ZH[zi(p, f)] ^ ZH[zi(p, t)] ^ ZSIDE_H;
      if (cap) { l ^= ZL[zi(cap, t)]; h ^= ZH[zi(cap, t)]; }
      this.hl = l; this.hh = h;
      b[t] = p; b[f] = 0;
      if (p === K) this.kings[0] = t; else if (p === -K) this.kings[1] = t;
      if (cap === K) this.kings[0] = -1; else if (cap === -K) this.kings[1] = -1;
      this.side = -this.side;
      return cap;
    }

    unmakeMove() {
      const e = this.hist.pop(); if (!e) return null;
      const f = mvFrom(e.m), t = mvTo(e.m), b = this.board, p = b[t];
      b[f] = p; b[t] = e.cap;
      if (p === K) this.kings[0] = f; else if (p === -K) this.kings[1] = f;
      if (e.cap === K) this.kings[0] = t; else if (e.cap === -K) this.kings[1] = t;
      this.hl = e.hl; this.hh = e.hh; this.side = -this.side;
      return e;
    }

    // null move for search
    makeNull() { this.hist.push({ m: -1, cap: 0, hl: this.hl, hh: this.hh }); this.hl ^= ZSIDE_L; this.hh ^= ZSIDE_H; this.side = -this.side; }
    unmakeNull() { const e = this.hist.pop(); this.hl = e.hl; this.hh = e.hh; this.side = -this.side; }

    // Is square s attacked by side `by`? Includes flying-general (kings facing).
    attacked(s, by) {
      const b = this.board, r0 = rowOf(s), c0 = colOf(s);
      // rook / cannon / king(flying) along lines
      for (const [dr, dc] of ORTH) {
        let r = r0 + dr, c = c0 + dc, screens = 0;
        while (inBoard(r, c)) {
          const p = b[r * 9 + c];
          if (p) {
            if (screens === 0) {
              if (p === R * by) return true;
              if (p === K * by && dc === 0) return true; // flying general / adjacent king on file
              if (p === K * by && Math.abs(r - r0) + Math.abs(c - c0) === 1) return true;
              screens = 1;
            } else { if (p === C * by) return true; break; }
          }
          r += dr; c += dc;
        }
      }
      // knight: knight at s - d with leg next to the knight
      for (const [dr, dc] of KN_D) {
        const nr = r0 - dr, nc = c0 - dc; // knight position
        if (!inBoard(nr, nc)) continue;
        if (b[nr * 9 + nc] !== N * by) continue;
        const lr = nr + (Math.abs(dr) === 2 ? Math.sign(dr) : 0), lc = nc + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
        if (!b[lr * 9 + lc]) return true;
      }
      // pawn: enemy pawn moving forward onto s, or sideways after crossing
      const fwd = by === RED ? -1 : 1; // direction pawn of `by` moves in rows
      { const pr = r0 - fwd; if (pr >= 0 && pr < 10 && b[pr * 9 + c0] === P * by) return true; }
      for (const dc of [-1, 1]) {
        const pc = c0 + dc; if (pc < 0 || pc > 8) continue;
        if (b[r0 * 9 + pc] === P * by && !ownHalf(r0, by)) return true;
      }
      return false;
    }

    inCheck(side) { const k = this.kingSq(side === undefined ? this.side : side); if (k < 0) return true; return this.attacked(k, -(side === undefined ? this.side : side)); }

    // pseudo-legal moves; capturesOnly for quiescence
    pseudoMoves(side, capturesOnly, out) {
      const b = this.board; out = out || [];
      for (let s = 0; s < 90; s++) {
        const p = b[s]; if (!p || Math.sign(p) !== side) continue;
        const t = Math.abs(p), r0 = rowOf(s), c0 = colOf(s);
        const add = (r, c) => { const q = b[r * 9 + c]; if (q && Math.sign(q) === side) return; if (capturesOnly && !q) return; out.push(s * 90 + r * 9 + c); };
        switch (t) {
          case K: for (const [dr, dc] of ORTH) { const r = r0 + dr, c = c0 + dc; if (inPalace(r, c, side)) add(r, c); } break;
          case A: for (const [dr, dc] of DIAG) { const r = r0 + dr, c = c0 + dc; if (inPalace(r, c, side)) add(r, c); } break;
          case B: for (const [dr, dc] of DIAG) { const r = r0 + 2 * dr, c = c0 + 2 * dc; if (inBoard(r, c) && ownHalf(r, side) && !b[(r0 + dr) * 9 + c0 + dc]) add(r, c); } break;
          case N: for (const [dr, dc] of KN_D) { const r = r0 + dr, c = c0 + dc; if (!inBoard(r, c)) continue; const lr = r0 + (Math.abs(dr) === 2 ? dr / 2 : 0), lc = c0 + (Math.abs(dc) === 2 ? dc / 2 : 0); if (!b[lr * 9 + lc]) add(r, c); } break;
          case R: for (const [dr, dc] of ORTH) { let r = r0 + dr, c = c0 + dc; while (inBoard(r, c)) { const q = b[r * 9 + c]; if (!q) { if (!capturesOnly) out.push(s * 90 + r * 9 + c); } else { if (Math.sign(q) !== side) out.push(s * 90 + r * 9 + c); break; } r += dr; c += dc; } } break;
          case C: for (const [dr, dc] of ORTH) { let r = r0 + dr, c = c0 + dc, jumped = false; while (inBoard(r, c)) { const q = b[r * 9 + c]; if (!jumped) { if (!q) { if (!capturesOnly) out.push(s * 90 + r * 9 + c); } else jumped = true; } else if (q) { if (Math.sign(q) !== side) out.push(s * 90 + r * 9 + c); break; } r += dr; c += dc; } } break;
          case P: { const fwd = side === RED ? -1 : 1; if (inBoard(r0 + fwd, c0)) add(r0 + fwd, c0); if (!ownHalf(r0, side)) { if (c0 > 0) add(r0, c0 - 1); if (c0 < 8) add(r0, c0 + 1); } } break;
        }
      }
      return out;
    }

    legalMoves(side) {
      side = side === undefined ? this.side : side;
      const saved = this.side; this.side = side;
      const ps = this.pseudoMoves(side, false), out = [];
      for (const m of ps) { this.makeMove(m); if (!this.inCheck(side)) out.push(m); this.unmakeMove(); }
      this.side = saved;
      return out;
    }

    legalFrom(s) { return this.legalMoves().filter((m) => mvFrom(m) === s); }
    isLegal(m) { return this.legalMoves().indexOf(m) >= 0; }

    repetitionCount() { let n = 0; for (let i = this.hist.length - 1; i >= 0; i--) { const e = this.hist[i]; if (e.hl === this.hl && e.hh === this.hh) n++; } return n; }
    pliesSinceCapture() { let n = 0; for (let i = this.hist.length - 1; i >= 0; i--) { if (this.hist[i].cap) break; n++; } return n; }

    // index (into hist) of the k-th most recent earlier occurrence of the current position, or -1
    repetitionIndex(k) { k = k || 1; for (let i = this.hist.length - 1; i >= 0; i--) { const e = this.hist[i]; if (e.hl === this.hl && e.hh === this.hh && --k === 0) return i; } return -1; }

    // ---- 长将 / 长捉 (perpetual check / chase) ----
    // legal captures of `side`: Map attackerSq -> [targetSq]
    _captureMap(side) {
      const ps = this.pseudoMoves(side, true), map = new Map();
      for (const m of ps) {
        this.makeMove(m); const ok = !this.inCheck(side); this.unmakeMove();
        if (!ok) continue;
        const a = mvFrom(m); let l = map.get(a); if (!l) map.set(a, (l = [])); l.push(mvTo(m));
      }
      return map;
    }
    // Does attacker on `a` "chase" (捉) the piece on `t`? Simplified Asian-rules test (current board).
    _isChaseTarget(a, t) {
      const b = this.board, tp = b[t], T = Math.abs(tp), ts = Math.sign(tp), At = Math.abs(b[a]);
      if (T === K || At === K) return false;              // checks are judged separately; 将帅捉子不算
      if (T === P && ownHalf(rowOf(t), ts)) return false;  // 未过河兵卒不算
      if (At === T) return false;                          // 同兵种互捉 = 兑子
      if (T === R && (At === N || At === C || At === P)) return true; // 马/炮/兵捉车
      this.makeMove(a * 90 + t); const prot = this.attacked(t, ts); this.unmakeMove();
      return !prot;                                        // 捉无根子
    }
    // Info for move m from the current position: {chk: gives check, chase: [target squares newly chased]}
    moveInfo(m) {
      const side = this.side, f = mvFrom(m), t = mvTo(m);
      const before = this._captureMap(side);
      this.makeMove(m);
      const chk = this.inCheck(-side), after = this._captureMap(side), chase = [];
      for (const [a, ts] of after) {
        const prev = before.get(a === t ? f : a) || [];
        for (const x of ts) if (prev.indexOf(x) < 0 && this._isChaseTarget(a, x)) chase.push(x);
      }
      this.unmakeMove();
      return { chk, chase };
    }
    // Adjudicate the repetition cycle hist[start..end). Restores the position exactly.
    // Returns {loser: RED|BLACK|0, kind: 'check'|'chase'|null}
    cycleVerdict(start) {
      const n = this.hist.length; if (start < 0 || start >= n) return { loser: 0, kind: null };
      for (let i = start; i < n; i++) if (this.hist[i].m < 0) return { loser: 0, kind: null };
      const moves = []; while (this.hist.length > start) moves.push(this.unmakeMove().m); moves.reverse();
      const s0 = this.side, idx = (side) => (side === RED ? 0 : 1);
      // pass 1: checks (cheap)
      const allChk = [true, true], chk = [];
      for (const m of moves) { const sd = this.side; this.makeMove(m); const c = this.inCheck(this.side); chk.push(c); if (!c) allChk[idx(sd)] = false; }
      let verdict = null;
      if (allChk[0] && !allChk[1]) verdict = { loser: RED, kind: 'check' };
      else if (allChk[1] && !allChk[0]) verdict = { loser: BLACK, kind: 'check' };
      else if (allChk[0] && allChk[1]) verdict = { loser: 0, kind: null };
      if (!verdict) { // pass 2: chases (一将一捉 also counts as 长捉)
        for (let i = 0; i < moves.length; i++) this.unmakeMove();
        const viol = [true, true];
        for (let i = 0; i < moves.length; i++) {
          const sd = this.side;
          if (viol[idx(sd)] && !chk[i]) { const inf = this.moveInfo(moves[i]); if (!inf.chase.length) viol[idx(sd)] = false; }
          this.makeMove(moves[i]);
        }
        if (viol[0] && !viol[1]) verdict = { loser: RED, kind: 'chase' };
        else if (viol[1] && !viol[0]) verdict = { loser: BLACK, kind: 'chase' };
        else verdict = { loser: 0, kind: null };
      }
      void s0;
      return verdict;
    }

    // status of the side to move
    status() {
      const moves = this.legalMoves();
      const check = this.inCheck(this.side);
      if (!moves.length) return { over: true, result: check ? 'checkmate' : 'stalemate', winner: -this.side, check };
      if (this.repetitionCount() >= 2) { // 3rd occurrence: judge the moves since the previous-but-one occurrence
        const v = this.cycleVerdict(this.repetitionIndex(2));
        if (v.loser) return { over: true, result: v.kind === 'check' ? 'perpetual_check' : 'perpetual_chase', winner: -v.loser, loser: v.loser, check };
        return { over: true, result: 'repetition', winner: 0, check };
      }
      if (this.pliesSinceCapture() >= 120) return { over: true, result: 'nocapture', winner: 0, check };
      if (!this._hasAttackers()) return { over: true, result: 'material', winner: 0, check };
      return { over: false, check, moves };
    }
    _hasAttackers() { for (let s = 0; s < 90; s++) { const t = Math.abs(this.board[s]); if (t === N || t === R || t === C || t === P) return true; } return false; }

    // Chinese notation for move m in the current position (call BEFORE making it)
    notation(m) {
      const f = mvFrom(m), t = mvTo(m), b = this.board, p = b[f];
      if (!p) return '?';
      const side = Math.sign(p), type = Math.abs(p);
      const names = side === RED ? NAMES_RED : NAMES_BLACK;
      const fileNum = (c) => (side === RED ? 9 - c : c + 1);
      const numStr = (n) => (side === RED ? CN_NUM[n] : String(n));
      const fr = rowOf(f), fc = colOf(f), tr = rowOf(t), tc = colOf(t);
      // same-type pieces on the same file
      const same = [];
      for (let r = 0; r < 10; r++) if (b[r * 9 + fc] === p) same.push(r);
      let head;
      if (same.length >= 2 && type !== K) {
        // order front-to-back from the mover's perspective
        const order = side === RED ? same.slice().sort((a, c) => a - c) : same.slice().sort((a, c) => c - a);
        const idx = order.indexOf(fr);
        let pre;
        if (order.length === 2) pre = idx === 0 ? '前' : '后';
        else if (order.length === 3) pre = ['前', '中', '后'][idx];
        else pre = ['前', '二', '三', '四', '五'][idx];
        // pawns: if doubled on more than one file, keep file number (WXF)
        let multiFile = false;
        if (type === P) { for (let c = 0; c < 9; c++) { if (c === fc) continue; let n = 0; for (let r = 0; r < 10; r++) if (b[r * 9 + c] === p) n++; if (n >= 2) multiFile = true; } }
        head = multiFile ? pre + numStr(fileNum(fc)) : pre + names[type];
      } else head = names[type] + numStr(fileNum(fc));
      const forward = side === RED ? tr < fr : tr > fr;
      let act, dest;
      if (tr === fr) { act = '平'; dest = numStr(fileNum(tc)); }
      else {
        act = forward ? '进' : '退';
        if (type === N || type === B || type === A) dest = numStr(fileNum(tc));
        else dest = numStr(Math.abs(tr - fr));
      }
      return head + act + dest;
    }

    static iccs(m) { const f = mvFrom(m), t = mvTo(m); const sq = (s) => 'abcdefghi'[colOf(s)] + (9 - rowOf(s)); return sq(f) + sq(t); }
    static parseIccs(str) {
      const m = /^([a-i])([0-9])-?([a-i])([0-9])$/i.exec(str.trim()); if (!m) return -1;
      const s = (ch, d) => (9 - +d) * 9 + 'abcdefghi'.indexOf(ch.toLowerCase());
      return mv(s(m[1], m[2]), s(m[3], m[4]));
    }

    // save string: "<startFEN> moves m1 m2 ..." (UCCI style) — plain FEN also accepted by load()
    serialize() { const ms = this.hist.map((h) => Position.iccs(h.m)); return this.startFen + (ms.length ? ' moves ' + ms.join(' ') : ''); }
    static load(str) {
      str = String(str || '').trim().replace(/^position\s+/, '').replace(/^fen\s+/, '');
      if (str === 'startpos' || str.startsWith('startpos')) str = START_FEN + str.slice(8);
      const [fenPart, movePart] = str.split(/\s+moves\s+/);
      const pos = new Position(fenPart);
      if (pos.kingSq(RED) < 0 || pos.kingSq(BLACK) < 0) throw new Error('缺少帅或将');
      if (movePart) for (const tok of movePart.trim().split(/\s+/)) {
        const m = Position.parseIccs(tok);
        if (m < 0 || !pos.isLegal(m)) throw new Error('着法不合法: ' + tok);
        pos.makeMove(m);
      }
      return pos;
    }
  }

  function perft(pos, depth) {
    if (depth === 0) return 1;
    const ms = pos.legalMoves(); if (depth === 1) return ms.length;
    let n = 0; for (const m of ms) { pos.makeMove(m); n += perft(pos, depth - 1); pos.unmakeMove(); }
    return n;
  }

  const RESULT_TEXT = { checkmate: '绝杀', stalemate: '困毙', repetition: '循环局面，和棋', nocapture: '六十回合无吃子，和棋', material: '双方无进攻子力，和棋', resign: '认输', draw: '议和', timeout: '超时' };
  // Chinese reason line for a status() / game result object
  function resultText(st) {
    if (!st) return '';
    const sideCN = (s) => (s > 0 ? '红方' : '黑方');
    if (st.result === 'perpetual_check') return sideCN(st.loser || -st.winner) + '长将，判负';
    if (st.result === 'perpetual_chase') return sideCN(st.loser || -st.winner) + '长捉，判负';
    return RESULT_TEXT[st.result] || '';
  }

  const XQ = { Position, perft, resultText, K, A, B, N, R, C, P, RED, BLACK, START_FEN, NAMES_RED, NAMES_BLACK, mv, mvFrom, mvTo, rowOf, colOf, ZL, ZH };
  root.XQ = XQ;
  if (typeof module !== 'undefined' && module.exports) module.exports = XQ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
