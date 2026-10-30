/* 象棋 AI: negamax alpha-beta + PVS, iterative deepening, transposition table,
 * MVV-LVA / killer / history move ordering, quiescence search, check extension, null-move pruning.
 * Requires engine.js (global XQ). In a Web Worker it listens for {id, pos, opts} messages. */
(function (root) {
  'use strict';
  const XQ = root.XQ || (typeof require === 'function' ? require('./engine.js') : null);
  const { K, A, B, N, R, C, P, RED } = XQ;
  const MATE = 30000, WIN = MATE - 200, PERP = 6000; // PERP: 长将/长捉 判负 score (a loss, but below mate scores)
  const VAL = [0, 0, 120, 120, 270, 600, 285, 30];

  // Piece-square tables from Red's perspective, indexed by sq (r=0 top/enemy side, r=9 own back rank)
  const PST = [];
  for (let t = 0; t <= 7; t++) PST[t] = new Int16Array(90);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const s = r * 9 + c, cd = Math.abs(c - 4); // distance from centre file
    // pawn
    let pv = 0;
    if (r <= 4) { pv = 40 + (4 - cd) * 6; if (r >= 1 && r <= 3) pv += 20 + (cd <= 1 ? 25 : 0); if (r === 0) pv = 10; }
    else if (r === 5 || r === 6) pv = (c % 2 === 0) ? (c === 4 ? 6 : 2) : 0;
    PST[P][s] = pv;
    // knight: centre and forward, bad on edges and back rank
    PST[N][s] = 20 - cd * 4 - (c === 0 || c === 8 ? 12 : 0) + (r <= 6 ? (7 - Math.abs(r - 3)) * 4 : 0) - (r === 9 ? 15 : 0);
    // rook: open forward rows, river rows
    PST[R][s] = (r === 4 || r === 5 ? 8 : 0) + (r <= 3 ? 10 : 0) + (cd === 0 ? -2 : 0) + (r === 9 && (c === 0 || c === 8) ? -10 : 0);
    // cannon: central file, home rows ok
    PST[C][s] = (cd === 0 ? 12 : 0) + (r === 7 ? 4 : 0) + (r <= 2 && cd <= 1 ? 8 : 0) - (r <= 1 ? 4 : 0);
    // advisors/bishops: centre squares
    PST[A][s] = (r === 8 && c === 4) ? 8 : 0;
    PST[B][s] = (r === 7 && c === 4) ? 10 : (r === 9 && (c === 2 || c === 6)) ? 2 : 0;
    PST[K][s] = (c === 4 ? 6 : 0) - (r <= 8 && r >= 7 ? 6 : 0);
  }
  const flip = (s) => (9 - ((s / 9) | 0)) * 9 + (s % 9);

  function evaluate(pos) {
    const b = pos.board; let sc = 0;
    for (let s = 0; s < 90; s++) {
      const p = b[s]; if (!p) continue;
      const t = p > 0 ? p : -p;
      if (p > 0) sc += VAL[t] + PST[t][s]; else sc -= VAL[t] + PST[t][flip(s)];
    }
    return pos.side === RED ? sc + 8 : -sc + 8; // small tempo bonus
  }

  // Transposition table
  const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE), ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
  const EXACT = 1, LOWER = 2, UPPER = 3;

  function search(pos0, opts) {
    opts = opts || {};
    const pos = pos0.clone();
    const maxDepth = opts.depth || 6, timeLimit = opts.time || 1000, noise = opts.noise || 0;
    const t0 = Date.now();
    let nodes = 0, stop = false;
    const killers = []; for (let i = 0; i < 128; i++) killers.push([0, 0]);
    const history = new Int32Array(8100);
    const rootPly = pos.hist.length;

    function timeUp() { if ((++nodes & 2047) === 0 && Date.now() - t0 > timeLimit) stop = true; return stop; }

    // repetition within the search path or game history: index of the earlier occurrence, or -1
    function repeatIndex() {
      const n = pos.hist.length; for (let i = n - 2; i >= 0 && i >= n - 30; i -= 2) { const e = pos.hist[i]; if (e.hl === pos.hl && e.hh === pos.hh) return i; } return -1;
    }
    // score of a repetition for the side to move: perpetual checker / chaser loses (Asian rules), otherwise draw
    function repetitionScore(i) {
      const v = pos.cycleVerdict(i);
      if (!v.loser) return 0;
      return v.loser === pos.side ? -PERP : PERP;
    }

    function order(moves, ttm, ply) {
      const b = pos.board, k = killers[ply] || [0, 0], sc = new Int32Array(moves.length);
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i], to = m % 90, f = (m / 90) | 0, cap = b[to];
        if (m === ttm) sc[i] = 1e9;
        else if (cap) sc[i] = 1e8 + VAL[Math.abs(cap)] * 16 - VAL[Math.abs(b[f])] / 8 + (Math.abs(cap) === K ? 1e7 : 0);
        else if (m === k[0]) sc[i] = 9e7; else if (m === k[1]) sc[i] = 8e7;
        else sc[i] = history[m];
      }
      const idx = Array.from(moves.keys()).sort((x, y) => sc[y] - sc[x]);
      return idx.map((i) => moves[i]);
    }

    function quiesce(alpha, beta, ply) {
      if (timeUp()) return 0;
      const side = pos.side, check = pos.inCheck(side);
      let best = -MATE + ply;
      if (!check) { const stand = evaluate(pos); if (stand >= beta) return stand; if (stand > alpha) alpha = stand; best = stand; }
      if (ply > 60) return best;
      const moves = order(pos.pseudoMoves(side, !check), 0, Math.min(ply, 127));
      let legal = 0;
      for (const m of moves) {
        pos.makeMove(m);
        if (pos.inCheck(side)) { pos.unmakeMove(); continue; }
        legal++;
        const s = -quiesce(-beta, -alpha, ply + 1);
        pos.unmakeMove();
        if (stop) return 0;
        if (s > best) { best = s; if (s > alpha) { alpha = s; if (s >= beta) return s; } }
      }
      if (check && !legal) return -MATE + ply; // mated (stalemate also loses in xiangqi, covered by not-check path rarely)
      return best;
    }

    function negamax(depth, alpha, beta, ply, allowNull) {
      if (ply > 0) { const ri = repeatIndex(); if (ri >= 0) return repetitionScore(ri); }
      const side = pos.side, check = pos.inCheck(side);
      if (check) depth++; // check extension
      if (depth <= 0) return quiesce(alpha, beta, ply);
      if (timeUp()) return 0;
      // mate distance pruning
      alpha = Math.max(alpha, -MATE + ply); beta = Math.min(beta, MATE - ply - 1); if (alpha >= beta) return alpha;
      const idx = pos.hl & TT_MASK; let ttm = 0;
      if (ttKey[idx] === pos.hh) {
        ttm = ttMove[idx];
        if (ply > 0 && ttDepth[idx] >= depth) {
          let s = ttScore[idx]; if (s > WIN) s -= ply; else if (s < -WIN) s += ply;
          const f = ttFlag[idx];
          if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
        }
      }
      const pvNode = beta - alpha > 1;
      // null move pruning
      if (allowNull && !pvNode && !check && depth >= 3 && ply > 0 && hasMaterial(side)) {
        pos.makeNull();
        const s = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (stop) return 0;
        if (s >= beta) return s >= WIN ? beta : s;
      }
      const moves = order(pos.pseudoMoves(side, false), ttm, Math.min(ply, 127));
      let best = -MATE + ply, bestMove = 0, legal = 0; const a0 = alpha;
      for (const m of moves) {
        const cap = pos.board[m % 90];
        pos.makeMove(m);
        if (pos.inCheck(side)) { pos.unmakeMove(); continue; }
        legal++;
        let s;
        if (legal === 1) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        else {
          // late move reduction for quiet late moves
          let red = (!check && !cap && depth >= 3 && legal > 4 && !pos.inCheck(pos.side)) ? 1 : 0;
          s = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && (red || s < beta)) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
        pos.unmakeMove();
        if (stop) return 0;
        if (ply === 0 && noise) s += Math.round((Math.random() - 0.5) * noise);
        if (s > best) {
          best = s; bestMove = m;
          if (ply === 0) rootBest = m;
          if (s > alpha) {
            alpha = s;
            if (s >= beta) {
              if (!cap) { const k = killers[Math.min(ply, 127)]; if (k[0] !== m) { k[1] = k[0]; k[0] = m; } history[m] += depth * depth; }
              break;
            }
          }
        }
      }
      if (!legal) return -MATE + ply; // checkmate or stalemate (困毙) both lose
      let st = best; if (st > WIN) st += ply; else if (st < -WIN) st -= ply;
      ttKey[idx] = pos.hh; ttMove[idx] = bestMove; ttScore[idx] = Math.max(-32000, Math.min(32000, st)); ttDepth[idx] = depth;
      ttFlag[idx] = best >= beta ? LOWER : best > a0 ? EXACT : UPPER;
      return best;
    }

    function hasMaterial(side) { const b = pos.board; let n = 0; for (let s = 0; s < 90; s++) { const p = b[s] * side; if (p === R || p === N || p === C) n++; } return n >= 2; }

    let rootBest = 0, result = { move: 0, score: 0, depth: 0 };
    const legalRoot = pos.legalMoves();
    if (!legalRoot.length) return { move: 0, score: -MATE, depth: 0, nodes: 0 };
    if (legalRoot.length === 1) return { move: legalRoot[0], score: 0, depth: 1, nodes: 1 };
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      const s = negamax(d, -MATE, MATE, 0, false);
      if (stop) { if (rootBest && d > 1 && result.move === 0) result.move = rootBest; break; }
      result = { move: rootBest || result.move, score: s, depth: d };
      if (Math.abs(s) > WIN) break; // found mate
      if (Date.now() - t0 > timeLimit * 0.55) break; // not enough time for another iteration
    }
    if (!result.move || legalRoot.indexOf(result.move) < 0) result.move = legalRoot[0];
    result.nodes = nodes; result.ms = Date.now() - t0;
    void rootPly;
    return result;
  }

  const LEVELS = { easy: { depth: 2, time: 400, noise: 80 }, medium: { depth: 5, time: 900, noise: 12 }, hard: { depth: 14, time: 2500, noise: 0 } };
  const AI = { search, evaluate, LEVELS, PERP };
  root.XQAI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;

  // Web Worker hookup
  if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = (e) => {
      const { id, pos, opts } = e.data;
      try { const p = XQ.Position.load(pos); const r = search(p, opts); self.postMessage({ id, result: r }); }
      catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
