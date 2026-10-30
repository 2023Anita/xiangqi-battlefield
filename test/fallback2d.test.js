// 2D 回退测试: headless Chromium with WebGL disabled → the game must start on the 2D Canvas board and be fully playable.
// run: NODE_PATH=../.pw/node_modules PLAYWRIGHT_BROWSERS_PATH=../.pw/browsers node test/fallback2d.test.js [--local-broker]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
let PS = '';
if (process.argv.includes('--local-broker')) { const { PeerServer } = require('peer'); PeerServer({ port: 9124, path: '/xq' }); PS = '&peerserver=' + encodeURIComponent('localhost:9124/xq'); }
let fail = 0; const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--use-gl=disabled', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  const open = async (q, vp) => {
    const p = await ctx.newPage(); if (vp) await p.setViewportSize(vp);
    p.on('pageerror', (e) => logs.push('pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
    await p.goto(url + q, { timeout: 90000 }); await p.waitForFunction(() => window.__xq, null, { timeout: 60000 }); return p;
  };
  const click = async (p, iccs) => { const [x, y] = await p.evaluate((a) => __xq.screenOf(a), iccs); await p.mouse.click(x, y); };
  const p = await open('?fresh&nomenu');
  ok(await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')) === false, 'WebGL 已在浏览器中禁用');
  const info = await p.evaluate(() => ({ m: __xq.mode2d, r: __xq.fallbackReason, overlay: document.querySelector('#loading').textContent, done: document.querySelector('#loading').classList.contains('done') }));
  ok(info.m && info.r === 'nowebgl' && info.done && !/启动出错/.test(info.overlay), '无 WebGL 时自动切换到 2D 棋盘（无报错遮罩）');
  await p.waitForFunction(() => document.querySelector('#toast').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
  ok((await p.textContent('#toast')) === '当前设备不支持 3D，已切换到 2D 棋盘', '提示: ' + (await p.textContent('#toast')));
  ok(await p.evaluate(() => ['btn2d', 'btnLight', 'btnSketch', 'btnLabels'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none')), '3D 专属按钮已隐藏');
  // local play with real mouse clicks on the canvas
  await click(p, 'h2'); ok(await p.evaluate(() => __xq.game.selected >= 0 && __xq.game.targets.length > 0), '点击选子并显示可走点');
  await click(p, 'e2'); await p.waitForFunction(() => __xq.game.pos.hist.length === 1 && !__xq.game.busy, null, { timeout: 10000 });
  await click(p, 'h9'); await click(p, 'g7'); await p.waitForFunction(() => __xq.game.pos.hist.length === 2 && !__xq.game.busy, null, { timeout: 10000 });
  ok((await p.evaluate(() => __xq.game.notes.map((n) => n.txt).join(' '))) === '炮二平五 马8进7', '本地对弈（鼠标点击）: ' + (await p.evaluate(() => __xq.game.notes.map((n) => n.txt).join(' '))));
  ok(/炮二平五/.test(await p.textContent('#moves')), '棋谱面板更新');
  await p.evaluate(() => { __xq.play('e2e6'); }); await p.waitForFunction(() => __xq.game.pos.hist.length === 3 && !__xq.game.busy, null, { timeout: 10000 });
  ok(await p.evaluate(() => __xq.board2d.sprites.length === 31 && /卒/.test(document.querySelector('#capByRed').textContent)), '吃子动画后棋子移除、战报更新');
  await p.click('#btnUndo'); await p.waitForFunction(() => __xq.game.pos.hist.length === 2, null, { timeout: 5000 }); await p.waitForTimeout(500);
  ok(await p.evaluate(() => __xq.board2d.sprites.length === 32), '悔棋恢复被吃棋子');
  // hint
  await p.click('#btnHint'); await p.waitForFunction(() => __xq.game.hintMove > 0, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => __xq.game.hintMove > 0), '提示（AI 推演）箭头');
  // save / load
  await p.click('#btnSave'); const saved = await p.inputValue('#saveText'); ok(/ moves h2e2 h9g7$/.test(saved), '存档字符串');
  await p.fill('#saveText', '3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1'); await p.click('#saveLoad'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __xq.board2d.sprites.length === 3 && __xq.game.pos.hist.length === 0), '读档后 2D 棋盘同步');
  // perpetual check adjudication banner in 2D
  await p.evaluate(() => __xq.load('9/3k5/R8/9/9/9/9/9/9/5K3 w - - 0 1 moves a7a8 d8d9 a8a9 d9d8 a9a8 d8d9 a8a9 d9d8'));
  await p.evaluate(() => __xq.play('a9a8')); await p.waitForFunction(() => __xq.game.result, null, { timeout: 10000 });
  const ban = await p.evaluate(() => document.querySelector('#banner .t').textContent + ' / ' + document.querySelector('#banner .s').textContent);
  ok(/红方长将，判负/.test(ban), '长将判负横幅: ' + ban);
  await p.click('#bannerClose'); await p.click('#btnUndo'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !__xq.game.result && __xq.game.pos.hist.length === 8), '判负后悔棋恢复对局');
  // menu → AI game (worker) as black-side view
  await p.click('#btnMenu'); await p.click('.tabs button[data-tab=ai]');
  await p.click('#aiSide button[data-v="-1"]'); await p.click('#aiLevel button[data-v=easy]'); await p.click('#startAI');
  await p.waitForFunction(() => __xq.game.pos.hist.length === 1 && !__xq.game.busy, null, { timeout: 30000 });
  ok(await p.evaluate(() => __xq.view.side === -1 && __xq.game.mode === 'ai'), '人机（执黑，棋盘翻转），AI 先行: ' + (await p.evaluate(() => __xq.game.notes[0].txt)));
  await p.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'fallback-2d-black.png') });
  // online menu and room creation
  await p.click('#btnMenu'); await p.click('.tabs button[data-tab=online]');
  ok(await p.isVisible('#createRoom'), '在线联机菜单可用');
  if (PS) {
    const host = await open('?fresh&nomenu' + PS);
    await host.evaluate(() => __xq.createRoom(1));
    await host.waitForFunction(() => document.querySelector('#netStatus').textContent.includes('等待'), null, { timeout: 20000 });
    const code = await host.evaluate(() => __xq.game.room);
    const guest = await open('?room=' + code + PS);
    await guest.waitForFunction(() => document.querySelector('#netStatus').textContent === '已连接', null, { timeout: 30000 });
    await host.waitForFunction(() => __xq.game.net && __xq.game.net.connected, null, { timeout: 20000 });
    await host.evaluate(() => __xq.play('h2e2')); await guest.waitForFunction(() => __xq.game.pos.hist.length === 1, null, { timeout: 15000 });
    ok(await guest.evaluate(() => __xq.mode2d && __xq.view.side === -1 && __xq.board2d.sprites.length === 32), '2D 在线联机: 房主走子同步到客人（客人视角翻转）');
    await host.evaluate(() => __xq.load('9/3k5/R8/9/9/9/9/9/9/5K3 w - - 0 1 moves a7a8 d8d9 a8a9 d9d8 a9a8 d8d9 a8a9'));
    await guest.waitForFunction(() => __xq.game.pos.hist.length === 7, null, { timeout: 15000 });
    await guest.evaluate(() => __xq.play('d9d8')); await host.waitForFunction(() => __xq.game.pos.hist.length === 8 && !__xq.game.busy, null, { timeout: 15000 });
    await host.evaluate(() => __xq.play('a9a8'));
    await guest.waitForFunction(() => __xq.game.result && __xq.game.result.result === 'perpetual_check', null, { timeout: 15000 }).catch(() => {});
    ok(await guest.evaluate(() => !!__xq.game.result && __xq.game.result.result === 'perpetual_check' && /红方长将，判负/.test(document.querySelector('#banner .s').textContent)), '在线: 房主判定的长将判负同步到客人');
    await guest.close(); await host.close();
  }
  // mobile width
  const m = await open('?fresh&nomenu', { width: 390, height: 780 });
  await m.waitForTimeout(600); await m.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'fallback-2d-mobile.png') }); await m.close();
  // red-side desktop screenshot with a selection + last move + check
  await p.click('.tabs button[data-tab=local]'); await p.click('#startLocal');
  await p.evaluate(() => __xq.load('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 moves h2e2 h9g7 e2e6 a9a8'));
  await p.waitForTimeout(500); await click(p, 'b2'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'fallback-2d.png') });
  ok(fs.existsSync(path.join(__dirname, '..', 'screenshots', 'fallback-2d.png')), '截图 screenshots/fallback-2d.png');
  // ?renderer=2d forces the fallback even with WebGL present (same flag path)
  const f = await open('?fresh&nomenu&renderer=2d'); ok(await f.evaluate(() => __xq.mode2d && __xq.fallbackReason === 'param'), '?renderer=2d 强制 2D'); await f.close();
  console.log(logs.length ? 'console errors:\n' + [...new Set(logs)].slice(0, 15).join('\n') : 'no console errors');
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
