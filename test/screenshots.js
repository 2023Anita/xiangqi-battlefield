// 截图测试: NODE_PATH=<playwright node_modules> node test/screenshots.js
// Renders the built index.html via file:// in headless Chromium (SwiftShader software GL).
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'screenshots');
const url = 'file://' + path.join(ROOT, 'index.html') + '?fresh&nomenu';
const only = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const settle = (ms = 1500) => page.waitForTimeout(ms);
  if (only === 'mobile') { await page.goto('about:blank'); } else await page.goto(url);
  if (only !== 'mobile') { await page.waitForFunction(() => window.__xq, null, { timeout: 60000 }); await settle(2500); }
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('saved', name); };
  if (!only || only === 'start') await shot('01-start-default');
  if (!only || only === 'menu') { await page.evaluate(() => __xq.openMenu('ai')); await settle(600); await shot('00-menu'); await page.evaluate(() => __xq.closeMenu()); }
  if (!only || only === 'sketch') { await page.evaluate(() => __xq.sketch(true)); await settle(1200); await shot('02-sketch'); await page.evaluate(() => __xq.sketch(false)); }
  if (!only || only === 'capture') {
    // set up a cannon capture: 炮二平五 ... then 炮五进四 captures the central pawn over the screen
    await page.evaluate(async () => { __xq.timeScale = 4; await __xq.play('h2e2'); await __xq.play('h9g7'); __xq.timeScale = 1; });
    await settle(500);
    await page.evaluate(() => { __xq.events.pauseOn = 'projectile-mid'; __xq.play('e2e6'); });
    await page.waitForFunction(() => __xq.events.paused === 'projectile-mid', null, { timeout: 60000 });
    await settle(300); await shot('03-trebuchet-mid-capture');
    // same frozen frame from a side "action" camera
    const cam = await page.evaluate(() => { const c = __xq.camera, t = __xq.controls.target; const s = { p: c.position.toArray(), t: t.toArray() }; t.set(0, 1.0, 0.6); c.position.set(5.8, 3.4, 4.6); return s; });
    await settle(800); await shot('03b-trebuchet-mid-capture-side');
    await page.evaluate((s) => { __xq.camera.position.fromArray(s.p); __xq.controls.target.fromArray(s.t); }, cam);
    await page.evaluate(() => { __xq.events.pauseOn = 'impact'; __xq.events.paused = null; __xq.timeScale = 1; });
    await page.waitForFunction(() => __xq.events.paused === 'impact', null, { timeout: 60000 });
    await page.evaluate(() => { __xq.events.pauseOn = null; __xq.advance(0.28); });
    await shot('04-trebuchet-impact');
    await page.evaluate(() => { __xq.timeScale = 1; }); await page.evaluate(() => __xq.idle()); await settle(500);
    await shot('05-after-capture-check');
  }
  if (!only || only === '2d') { await page.evaluate(() => { __xq.set2D(true); __xq.advance(1.2); }); await settle(1200); await shot('06-2d-view'); await page.evaluate(() => { __xq.set2D(false); __xq.advance(1.2); }); }
  if (!only || only === 'dusk') { await page.evaluate(() => __xq.light('dusk')); await settle(1000); await shot('07-dusk'); }
  if (!only || only === 'night') { await page.evaluate(() => __xq.light('night')); await settle(1000); await shot('08-night'); await page.evaluate(() => __xq.light('morning')); }
  if (!only || only === 'close') {
    await page.evaluate(() => { const c = __xq.camera, t = __xq.controls.target; t.set(0, 0.3, 3.2); c.position.set(2.6, 2.6, 6.8); });
    await settle(1200); await shot('09-closeup-red');
    await page.evaluate(() => { const c = __xq.camera, t = __xq.controls.target; t.set(0, 0.3, -3.4); c.position.set(-2.4, 2.4, -0.2); });
    await settle(1200); await shot('10-closeup-black');
  }
  if (only === 'mate') {
    await page.evaluate(() => { __xq.load('3k5/9/9/p7p/9/2P3P2/9/9/2R6/4KR3 w - - 0 1'); });
    await settle(800);
    await page.evaluate(() => { __xq.timeScale = 1; __xq.play('c1d1'); });
    await page.waitForFunction(() => __xq.game.result, null, { timeout: 60000 });
    await page.evaluate(() => __xq.advance(2.5)); await settle(1500); await shot('13-checkmate');
  }
  if (only === 'check') {
    await page.evaluate(() => { __xq.load('4k4/9/9/9/9/9/9/9/4A4/2BK1R3 w - - 0 1'); });
    await settle(800); await page.evaluate(() => __xq.play('f0f9')); await page.evaluate(() => __xq.idle()); await page.evaluate(() => __xq.advance(0.4)); await settle(800); await shot('14-check');
  }
  if (!only || only === 'mobile') {
    await page.close();
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.goto(url, { timeout: 90000 }); await m.waitForFunction(() => window.__xq, null, { timeout: 60000 }); await m.waitForTimeout(3000);
    await m.screenshot({ path: path.join(OUT, '11-mobile.png') }); console.log('saved 11-mobile');
    await m.evaluate(() => __xq.openMenu('online')); await m.waitForTimeout(500); await m.screenshot({ path: path.join(OUT, '12-mobile-menu.png') }); console.log('saved 12-mobile-menu');
  }
  if (!page.isClosed()) console.log('fps (swiftshader):', await page.evaluate(() => __xq.fps()));
  console.log(errors.length ? 'console:\n' + [...new Set(errors)].slice(0, 30).join('\n') : 'no console errors');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
