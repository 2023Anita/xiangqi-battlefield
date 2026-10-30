// 2D Canvas 棋盘 — fallback renderer when WebGL is unavailable (or ?renderer=2d).
// Draws a traditional wooden board with round character pieces and drives the same game controller as the 3D view.
// The controller calls: reset(), sync(animated), animate(m), draw(), resize(); input arrives through onSquare(sq).
const NAMES = { 1: ['', '帅', '仕', '相', '马', '车', '炮', '兵'], '-1': ['', '将', '士', '象', '马', '车', '炮', '卒'] };
const FONT = '"KaiTi","STKaiti","Kaiti SC","楷体","BiauKai","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif';

export function createBoard2D({ canvas, game, view, tween, ease, sfx, onSquare }) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, cell = 40, ox = 0, oy = 0; // ox/oy = screen position of board point (col 0,row 0) in the current orientation
  let sprites = []; // {code, sq, r, c, alpha, scale, lift}
  let t = 0;

  // ---------- layout ----------
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const wide = W > 760, padSide = wide ? (W > 900 ? 236 : 200) : 8, padTop = wide ? 66 : 50, padBot = wide ? 64 : 60;
    const aw = Math.max(200, W - 2 * padSide), ah = Math.max(200, H - padTop - padBot);
    cell = Math.max(18, Math.min(aw / 9.3, ah / 10.3));
    ox = padSide + (aw - cell * 8) / 2; oy = padTop + (ah - cell * 9) / 2;
  }
  const flip = () => view.side < 0;
  // board (row, col) floats → screen px
  function toScreen(r, c) { if (flip()) { r = 9 - r; c = 8 - c; } return [ox + c * cell, oy + r * cell]; }
  function squareAt(x, y) {
    let c = Math.round((x - ox) / cell), r = Math.round((y - oy) / cell);
    if (c < 0 || c > 8 || r < 0 || r > 9) return -1;
    if (Math.hypot(x - (ox + c * cell), y - (oy + r * cell)) > cell * 0.5) return -1;
    if (flip()) { r = 9 - r; c = 8 - c; }
    return r * 9 + c;
  }

  // ---------- sprites ----------
  const mk = (code, sq) => ({ code, sq, r: (sq / 9) | 0, c: sq % 9, alpha: 1, scale: 1, lift: 0 });
  function reset() { sprites = []; const b = game.pos.board; for (let s = 0; s < 90; s++) if (b[s]) sprites.push(mk(b[s], s)); }
  const at = (sq) => sprites.find((p) => p.sq === sq && !p.dying);
  function fade(p, dur) { p.dying = true; return tween(dur, (k) => { p.alpha = 1 - k; p.scale = 1 + 0.35 * k; }).then(() => { sprites = sprites.filter((x) => x !== p); }); }
  function slide(p, sq, dur) {
    const r0 = p.r, c0 = p.c, r1 = (sq / 9) | 0, c1 = sq % 9; p.sq = sq;
    return tween(dur, (k) => { p.r = r0 + (r1 - r0) * k; p.c = c0 + (c1 - c0) * k; p.lift = Math.sin(k * Math.PI); }, ease.inOut).then(() => { p.r = r1; p.c = c1; p.lift = 0; });
  }
  async function animate(m) {
    const f = (m / 90) | 0, to = m % 90, p = at(f), victim = at(to);
    if (!p) { reset(); return; }
    sprites = sprites.filter((x) => x !== p); sprites.push(p); // draw mover on top
    const dist = Math.hypot(((to / 9) | 0) - p.r, (to % 9) - p.c);
    sfx.play(Math.abs(p.code) === 4 ? 'hoof' : Math.abs(p.code) === 5 || Math.abs(p.code) === 6 ? 'roll' : 'step');
    await slide(p, to, Math.min(0.55, 0.18 + dist * 0.05));
    if (victim) { sfx.play('clash'); sfx.play('fall', 0.05); await fade(victim, 0.25); } else sfx.play('drum');
  }
  // diff-sync to game.pos (undo / load / network sync)
  async function sync(animated = true) {
    const want = game.pos.board, keep = new Set(), pool = [], jobs = [];
    for (const p of sprites) { if (p.dying) continue; if (want[p.sq] === p.code && !keep.has(p.sq)) keep.add(p.sq); else pool.push(p); }
    for (let s = 0; s < 90; s++) {
      if (!want[s] || keep.has(s)) continue;
      const i = pool.findIndex((p) => p.code === want[s]);
      if (i >= 0) { const p = pool.splice(i, 1)[0]; if (animated) jobs.push(slide(p, s, 0.3)); else { p.sq = s; p.r = (s / 9) | 0; p.c = s % 9; } }
      else { const p = mk(want[s], s); sprites.push(p); if (animated) { p.scale = 0.01; jobs.push(tween(0.3, (k) => (p.scale = Math.max(0.01, k)), ease.outBack)); } }
      keep.add(s);
    }
    for (const p of pool) { if (animated) jobs.push(fade(p, 0.25)); else sprites = sprites.filter((x) => x !== p); }
    await Promise.all(jobs);
  }

  // ---------- drawing ----------
  let woodCache = null;
  function woodPattern() { // procedural wood grain, cached per size
    const key = Math.round(cell);
    if (woodCache && woodCache.key === key) return woodCache.pat;
    const w = Math.round(cell * 10 * DPR), h = Math.round(cell * 11 * DPR), c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#e9c98f'); g.addColorStop(0.5, '#ddb877'); g.addColorStop(1, '#e6c286'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) { // grain lines
      const y0 = rnd() * h, amp = 4 + rnd() * 14, ph = rnd() * 6, fr = 0.002 + rnd() * 0.004;
      x.strokeStyle = `rgba(${120 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},${30 + rnd() * 20 | 0},${0.05 + rnd() * 0.09})`; x.lineWidth = 0.6 + rnd() * 2.2 * DPR;
      x.beginPath(); for (let px = 0; px <= w; px += 8) { const py = y0 + Math.sin(px * fr + ph) * amp + Math.sin(px * fr * 3.1 + ph) * amp * 0.3; px ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    }
    woodCache = { key, pat: c }; return c;
  }
  function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  function gl(r0, c0, r1, c1) { const [a, b] = toScreen(r0, c0), [p, q] = toScreen(r1, c1); line(a, b, p, q); }
  function mark(r, c) { // 炮位/兵位 corner marks
    const [x, y] = toScreen(r, c), d = cell * 0.08, l = cell * 0.2;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
      ctx.beginPath(); ctx.moveTo(x + sx * d, y + sy * (d + l)); ctx.lineTo(x + sx * d, y + sy * d); ctx.lineTo(x + sx * (d + l), y + sy * d); ctx.stroke();
    }
  }
  function drawBoard() {
    // table
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75); bg.addColorStop(0, '#4a3324'); bg.addColorStop(1, '#1d140e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // wooden slab
    const m = cell * 0.62, bx = ox - m, by = oy - m, bw = cell * 8 + 2 * m, bh = cell * 9 + 2 * m;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = cell * 0.6; ctx.shadowOffsetY = cell * 0.15;
    ctx.fillStyle = '#d9b373'; ctx.fillRect(bx, by, bw, bh); ctx.restore();
    ctx.drawImage(woodPattern(), bx, by, bw, bh);
    ctx.strokeStyle = '#6b3f1d'; ctx.lineWidth = Math.max(2, cell * 0.06); ctx.strokeRect(bx + cell * 0.12, by + cell * 0.12, bw - cell * 0.24, bh - cell * 0.24);
    // grid
    ctx.strokeStyle = '#4a2a12'; ctx.lineCap = 'square';
    ctx.lineWidth = Math.max(2, cell * 0.05); { const [a, b] = toScreen(0, 0), [p, q] = toScreen(9, 8); ctx.strokeRect(Math.min(a, p) - cell * 0.07, Math.min(b, q) - cell * 0.07, Math.abs(p - a) + cell * 0.14, Math.abs(q - b) + cell * 0.14); }
    ctx.lineWidth = Math.max(1, cell * 0.025);
    for (let r = 0; r < 10; r++) gl(r, 0, r, 8);
    for (let c = 0; c < 9; c++) { if (c === 0 || c === 8) gl(0, c, 9, c); else { gl(0, c, 4, c); gl(5, c, 9, c); } }
    gl(0, 3, 2, 5); gl(0, 5, 2, 3); gl(7, 3, 9, 5); gl(7, 5, 9, 3);
    ctx.lineWidth = Math.max(1, cell * 0.02);
    for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]]) mark(r, c);
    // river
    const [, ry0] = toScreen(4, 0), [, ry1] = toScreen(5, 0), ry = (ry0 + ry1) / 2;
    ctx.fillStyle = 'rgba(74,42,18,.82)'; ctx.font = `bold ${cell * 0.52}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const [lx] = toScreen(0, 2), [rx] = toScreen(0, 6), left = Math.min(lx, rx), right = Math.max(lx, rx);
    ctx.fillText('楚　河', left, ry); ctx.fillText('漢　界', right, ry);
  }
  function ring(x, y, rad, color, width, alpha = 1) { ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  function corners(sq, color) { // last-move bracket marker
    const [x, y] = toScreen((sq / 9) | 0, sq % 9), d = cell * 0.47, l = cell * 0.16;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, cell * 0.055); ctx.lineCap = 'round';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sx * d, y + sy * (d - l)); ctx.lineTo(x + sx * d, y + sy * d); ctx.lineTo(x + sx * (d - l), y + sy * d); ctx.stroke(); }
  }
  function drawPiece(p) {
    const side = p.code > 0 ? 1 : -1, type = Math.abs(p.code);
    const [x0, y0] = toScreen(p.r, p.c), sel = game.selected === p.sq && !p.dying, lift = p.lift * cell * 0.18 + (sel ? cell * (0.07 + Math.sin(t * 5) * 0.02) : 0);
    const R = cell * 0.44 * p.scale, x = x0, y = y0 - lift;
    ctx.save(); ctx.globalAlpha = p.alpha;
    // shadow
    ctx.fillStyle = 'rgba(30,15,5,.38)'; ctx.beginPath(); ctx.ellipse(x0 + cell * 0.04 + lift * 0.3, y0 + cell * 0.06 + lift * 0.4, R * (1 + lift / cell * 0.3), R * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    // body: side edge then face
    ctx.fillStyle = '#b0844c'; ctx.beginPath(); ctx.arc(x, y + cell * 0.05, R, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R); g.addColorStop(0, '#fff3d6'); g.addColorStop(0.75, '#f0d7a4'); g.addColorStop(1, '#d9b57a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    const col = side > 0 ? '#b8281a' : '#1e1a17';
    ctx.strokeStyle = 'rgba(90,55,20,.7)'; ctx.lineWidth = Math.max(1, R * 0.05); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * 0.07); ctx.beginPath(); ctx.arc(x, y, R * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `bold ${R * 1.12}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(NAMES[side][type], x, y + R * 0.06);
    ctx.restore();
  }
  function arrow(m, color) {
    const [x0, y0] = toScreen((((m / 90) | 0) / 9) | 0, ((m / 90) | 0) % 9), [x1, y1] = toScreen(((m % 90) / 9) | 0, (m % 90) % 9);
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0), hw = cell * 0.22;
    ctx.save(); ctx.translate(x0, y0); ctx.rotate(a); ctx.globalAlpha = 0.8; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cell * 0.2, -cell * 0.06); ctx.lineTo(L - hw * 1.6, -cell * 0.06); ctx.lineTo(L - hw * 1.6, -hw); ctx.lineTo(L - cell * 0.12, 0); ctx.lineTo(L - hw * 1.6, hw); ctx.lineTo(L - hw * 1.6, cell * 0.06); ctx.lineTo(cell * 0.2, cell * 0.06); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function draw(time) {
    t = time || 0;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBoard();
    const pos = game.pos, h = pos.hist[pos.hist.length - 1];
    if (h && h.m >= 0) { corners((h.m / 90) | 0, 'rgba(40,110,170,.85)'); corners(h.m % 90, 'rgba(40,110,170,.95)'); }
    // check glow
    if (!game.busy && pos.inCheck(pos.side)) { const k = pos.kingSq(pos.side); if (k >= 0) { const [x, y] = toScreen((k / 9) | 0, k % 9); const g = ctx.createRadialGradient(x, y, cell * 0.3, x, y, cell * 0.75); g.addColorStop(0, 'rgba(255,40,20,.0)'); g.addColorStop(0.5, `rgba(255,40,20,${0.45 + Math.sin(t * 6) * 0.2})`); g.addColorStop(1, 'rgba(255,40,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, cell * 0.75, 0, Math.PI * 2); ctx.fill(); } }
    for (const p of sprites) drawPiece(p);
    // selection + legal targets
    if (game.selected >= 0) {
      const [x, y] = toScreen((game.selected / 9) | 0, game.selected % 9);
      ring(x, y - cell * 0.08, cell * 0.5, '#f2b632', Math.max(2, cell * 0.07), 0.75 + Math.sin(t * 5) * 0.25);
      for (const m of game.targets) {
        const s = m % 90, [tx, ty] = toScreen((s / 9) | 0, s % 9);
        if (pos.board[s]) ring(tx, ty, cell * 0.49, '#e0301c', Math.max(2, cell * 0.08), 0.9);
        else { ctx.fillStyle = 'rgba(30,140,70,.85)'; ctx.beginPath(); ctx.arc(tx, ty, cell * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
    if (game.hintMove) arrow(game.hintMove, 'rgba(20,150,90,1)');
  }

  // ---------- input ----------
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
    if (dx * dx + dy * dy > 100) return;
    const r = canvas.getBoundingClientRect(); const sq = squareAt(e.clientX - r.left, e.clientY - r.top);
    if (sq >= 0) onSquare(sq);
  });

  resize();
  return { reset, sync, animate, draw, resize, squareAt, screenOf: (sq) => toScreen((sq / 9) | 0, sq % 9), get sprites() { return sprites; } };
}
