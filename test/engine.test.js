// 规则引擎测试: node test/engine.test.js
const XQ = require('../src/engine.js');
const AI = require('../src/ai.js');
const { Position, perft } = XQ;
let fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const sq = (s) => (9 - +s[1]) * 9 + 'abcdefghi'.indexOf(s[0]);
const M = (a) => Position.parseIccs(a);
const has = (pos, a) => pos.legalMoves().includes(M(a));

// perft
const expect = [44, 1920, 79666];
for (let d = 1; d <= 3; d++) {
  const t = Date.now(); const n = perft(new Position(), d);
  ok(n === expect[d - 1], `perft(${d}) = ${n} (expected ${expect[d - 1]}, ${Date.now() - t}ms)`);
}
if (process.argv.includes('--deep')) { const t = Date.now(); const n = perft(new Position(), 4); ok(n === 3290240, `perft(4) = ${n} (${Date.now() - t}ms)`); }

// 将帅不能照面 flying general: red king moves onto open file facing black king -> illegal
{
  const p = new Position('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1');
  ok(!has(p, 'd0e0'), '飞将: 帅不能走到与将照面的位置');
  ok(has(p, 'd0d1'), '飞将: 帅可以在本列移动');
  const q = new Position('4k4/9/9/9/4R4/9/9/9/9/4K4 w - - 0 1');
  ok(!has(q, 'e5d5'), '飞将: 中间唯一子不能离开（会照面）');
  ok(has(q, 'e5e8'), '飞将: 车沿中线走仍挡住');
}
// 炮 screen
{
  const p = new Position('4k4/9/9/9/4p4/9/9/9/4C4/3K5 w - - 0 1'); // cannon e1, black pawn e5, black king e9
  ok(!has(p, 'e1e5'), '炮: 无炮架不能吃');
  ok(has(p, 'e1e4'), '炮: 可以平走到空点');
  const q = new Position('3k5/9/4p4/9/9/9/4P4/9/4C4/5K3 w - - 0 1'); // screen = red pawn e3, target black pawn e7
  ok(has(q, 'e1e7'), '炮: 隔一子可吃');
  const r2 = new Position('3k5/4p4/4p4/9/9/9/4P4/9/4C4/5K3 w - - 0 1');
  ok(!has(r2, 'e1e8'), '炮: 隔两子不能吃');
  ok(!has(r2, 'e1e5'), '炮: 炮架后空点不能走');
}
// 蹩马腿 horse leg
{
  const p = new Position('4k4/9/9/9/9/9/9/4P4/4N4/3K5 w - - 0 1'); // knight e1, pawn on e2 blocks upward
  ok(!has(p, 'e1d3') && !has(p, 'e1f3'), '马: 蹩马腿（向前被挡）');
  ok(has(p, 'e1c2') && has(p, 'e1g2'), '马: 横向不被挡');
}
// 塞象眼 + 象不过河
{
  const p = new Position('3k5/9/9/9/9/2B6/3P5/9/9/4K4 w - - 0 1'); // bishop c4 (row 5), pawn d3 blocks eye toward e2
  ok(!has(p, 'c4e2'), '象: 塞象眼');
  ok(has(p, 'c4a2'), '象: 未塞眼可走');
  ok(!has(p, 'c4a6') && !has(p, 'c4e6'), '象: 不能过河');
}
// 仕/帅 in palace
{
  const p = new Position('4k4/9/9/9/9/9/9/5A3/9/4K4 w - - 0 1'); // advisor f2
  ok(!has(p, 'f2g3') && !has(p, 'f2g1'), '仕: 不能出九宫');
  ok(has(p, 'f2e1'), '仕: 九宫内斜走');
}
// 兵 sideways only after crossing
{
  const p = new Position('4k4/9/9/9/9/9/4P4/9/9/3K5 w - - 0 1');
  ok(!has(p, 'e3d3') && has(p, 'e3e4'), '兵: 未过河不能横走');
  const q = new Position('4k4/9/9/9/4P4/9/9/9/9/3K5 w - - 0 1');
  ok(has(q, 'e5d5') && has(q, 'e5f5') && !has(q, 'e5e4'), '兵: 过河可横走、不能后退');
}
// cannot leave king in check; checkmate; stalemate (困毙)
{
  const p = new Position('3k5/9/9/9/9/9/9/9/9/3R1K3 b - - 0 1'); // rook d0 checks king d9 along d-file
  const st = p.status();
  ok(st.check && !st.over, '将军检测');
  ok(p.legalMoves().every((m) => { p.makeMove(m); const c = p.inCheck(-p.side); p.unmakeMove(); return !c; }), '应将: 所有着法都解除将军');
  const m2 = new Position('3k5/3R5/3R5/9/9/9/9/9/9/4K4 b - - 0 1');
  const s2 = m2.status();
  ok(s2.over && s2.result === 'checkmate' && s2.winner === 1, '将死检测 (双车)');
  // stalemate: black king d9 trapped, not in check
  const sm = new Position('3k5/R8/9/9/4R4/9/9/9/9/5K3 b - - 0 1');
  // king d9: d8? attacked by... let's verify with engine semantics
  const s3 = sm.status();
  ok(s3.over && s3.result === 'stalemate' && s3.winner === 1, '困毙检测（无子可动判负） got ' + JSON.stringify({ r: s3.result, c: s3.check }));
}
// 长将 / 长捉 / 循环 / 自然限着 (simplified Asian rules)
{
  const rep = (a, n) => Array(n).fill(a).flat();
  const play = (fen, ms) => { const p = new Position(fen); for (const a of ms) { const m = M(a); if (!p.isLegal(m)) return { p, err: 'illegal ' + a }; p.makeMove(m); const st = p.status(); if (st.over) return { p, st }; } return { p, st: p.status() }; };
  // 车长将: red rook a7→a8, black king d8↔d9, red rook a8↔a9 checking every move
  const PC = '9/3k5/R8/9/9/9/9/9/9/5K3 w - - 0 1', pcMoves = ['a7a8', ...rep(['d8d9', 'a8a9', 'd9d8', 'a9a8'], 3)];
  let r = play(PC, pcMoves);
  ok(r.st && r.st.result === 'perpetual_check' && r.st.winner === -1 && r.p.hist.length === 9 && XQ.resultText(r.st) === '红方长将，判负', '长将: 车反复将军第三次重复 → 红方长将判负 (' + (r.st && XQ.resultText(r.st)) + ')');
  // 马长捉无根车: red horse d2↔e4 attacks the unprotected black rook f6/f3 each move
  r = play('5k3/9/9/5r3/9/9/9/3N5/9/3K5 w - - 0 1', rep(['d2e4', 'f6f3', 'e4d2', 'f3f6'], 3));
  ok(r.st && r.st.result === 'perpetual_chase' && r.st.winner === -1 && XQ.resultText(r.st) === '红方长捉，判负', '长捉: 马反复捉无根车 → 红方长捉判负 (' + (r.st && XQ.resultText(r.st)) + ')');
  // mutual idle repetition → draw
  r = play('5k2r/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', rep(['a0a1', 'i9i8', 'a1a0', 'i8i9'], 3));
  ok(r.st && r.st.result === 'repetition' && r.st.winner === 0 && r.p.hist.length === 8 && XQ.resultText(r.st) === '循环局面，和棋', '循环: 双方闲着重复 → 和棋');
  // red perpetually checks, black king steps uncover horse attacks on unprotected cannons (black perpetually chases) → checker loses
  const CC = '3CC4/2nk1n3/9/9/9/4R4/9/9/9/5K3 w - - 0 1';
  { const q = new Position(CC); const i1 = q.moveInfo(M('e4d4')); q.makeMove(M('e4d4')); const i2 = q.moveInfo(M('d8e8')); ok(i1.chk && i2.chase.length === 1 && !i2.chk, '捉子检测: 将军着 / 闪出马捉无根炮'); }
  r = play(CC, rep(['e4d4', 'd8e8', 'd4e4', 'e8d8'], 3));
  ok(r.st && r.st.result === 'perpetual_check' && r.st.winner === -1, '长将对长捉: 长将方（红）判负');
  // undo after adjudication restores a live game; replaying re-adjudicates
  { const p = r.p; p.unmakeMove(); const s1 = p.status(); ok(!s1.over && p.repetitionCount() === 1, '判负后悔棋: 局面恢复，对局继续');
    p.makeMove(M('e8d8')); const s2 = p.status(); ok(s2.over && s2.result === 'perpetual_check', '悔棋后重走: 再次判负');
    const q = Position.load(p.serialize()); ok(q.status().result === 'perpetual_check', '读档后判定一致'); }
  // AI must not play the move that completes its own perpetual check (it is down material, so a plain draw would tempt it)
  { const p = new Position('9/3k5/R8/9/9/7rn/9/9/9/5K3 w - - 0 1'); for (const a of ['a7a8', ...rep(['d8d9', 'a8a9', 'd9d8', 'a9a8'], 1), 'd8d9', 'a8a9', 'd9d8']) p.makeMove(M(a));
    const res = AI.search(p, { depth: 5, time: 2000 }); const q = p.clone(); q.makeMove(res.move); const st = q.status();
    ok(st.result !== 'perpetual_check' && Position.iccs(res.move) !== 'a9a8', 'AI: 不走成长将判负 (chose ' + Position.iccs(res.move) + ', score ' + res.score + ')');
  }
  // 60 回合自然限着: 120 plies without capture (no repetition) → draw
  { const p = new Position(); const seen = new Set([p.hl + ':' + p.hh]); let stuck = false, early = false;
    while (p.hist.length < 120) { // greedy walk: first non-capture move reaching an unseen position that does not end the game early
      let pick;
      for (const m of p.legalMoves()) { if (p.board[m % 90]) continue; p.makeMove(m); const k = p.hl + ':' + p.hh, st = p.status(); p.unmakeMove(); if (!seen.has(k) && (!st.over || st.result === 'nocapture')) { pick = m; break; } }
      if (pick === undefined) { stuck = true; break; }
      p.makeMove(pick); seen.add(p.hl + ':' + p.hh); if (p.hist.length < 120 && p.status().over) { early = true; break; }
    }
    const st = p.status();
    ok(!stuck && !early && st.over && st.result === 'nocapture' && XQ.resultText(st) === '六十回合无吃子，和棋', '自然限着: 120 步无吃子 → 和棋 (' + p.hist.length + ' plies)');
    p.unmakeMove(); ok(!p.status().over, '自然限着: 第 119 步时未结束'); }
}
// notation
{
  const p = new Position();
  ok(p.notation(M('h2e2')) === '炮二平五', '记谱: 炮二平五 → ' + p.notation(M('h2e2')));
  p.makeMove(M('h2e2'));
  ok(p.notation(M('h9g7')) === '马8进7', '记谱: 马8进7 → ' + p.notation(M('h9g7')));
  p.makeMove(M('h9g7'));
  ok(p.notation(M('b0c2')) === '马八进七', '记谱: 马八进七');
  ok(p.notation(M('a0a1')) === '车九进一' && p.notation(M('i0i1')) === '车一进一', '记谱: 车九进一 / 车一进一');
  const d = new Position('4k4/9/9/9/9/9/9/2C6/9/2C1K4 w - - 0 1');
  ok(d.notation(M('c2e2')) === '前炮平五', '记谱: 前炮平五 → ' + d.notation(M('c2e2')));
}
// serialize / load round trip
{
  const p = new Position(); ['h2e2', 'h9g7', 'h0g2'].forEach((a) => p.makeMove(M(a)));
  const s = p.serialize(); const q = Position.load(s);
  ok(q.toFEN() === p.toFEN() && q.hist.length === 3, '存档/读档 往返: ' + s);
  let threw = false; try { Position.load(XQ.START_FEN + ' moves e3e5'); } catch (e) { threw = true; } ok(threw, '读档: 拒绝非法着法');
}
// AI sanity
{
  const p = new Position('3k5/R8/9/9/9/9/9/9/9/R3K4 w - - 0 1');
  const r = AI.search(p, { depth: 4, time: 3000 });
  p.makeMove(r.move); const s = p.status();
  ok(s.over && s.result === 'checkmate', 'AI: 一步杀 ' + Position.iccs(r.move) + ' score ' + r.score);
  const t = Date.now(); const r2 = AI.search(new Position(), { depth: 20, time: 1500 });
  ok(r2.move > 0, `AI: 开局搜索 depth ${r2.depth} nodes ${r2.nodes} in ${Date.now() - t}ms → ${new Position().notation(r2.move)}`);
}
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
