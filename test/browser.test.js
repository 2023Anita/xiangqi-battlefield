// 浏览器功能测试: AI Web Worker + 在线联机 (two headless pages over PeerJS cloud / WebRTC)
// run: NODE_PATH=../.pw/node_modules PLAYWRIGHT_BROWSERS_PATH=../.pw/browsers node test/browser.test.js [ai|online]
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const which = process.argv[2] || 'all';
// --local-broker: start a PeerJS server on localhost (for sandboxes where the PeerJS cloud is unreachable)
let PS = '';
if (process.argv.includes('--local-broker')) { const { PeerServer } = require('peer'); PeerServer({ port: 9123, path: '/xq' }); PS = '&peerserver=' + encodeURIComponent('localhost:9123/xq'); console.log('local PeerJS broker on :9123'); }
let fail = 0; const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch({ args: ['--proxy-bypass-list=<-loopback>;localhost;127.0.0.1', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 480, height: 360 } });
  const logs = [];
  const open = async (q) => { const p = await ctx.newPage(); p.on('pageerror', (e) => logs.push('pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); await p.goto(url + q, { timeout: 90000 }); await p.waitForFunction(() => window.__xq, null, { timeout: 90000 }); await p.evaluate(() => { __xq.timeScale = 8; }); return p; };
  if (which === 'all' || which === 'ai') {
    const p = await open('?fresh&nomenu');
    await p.evaluate(() => { document.querySelector('#aiLevel button[data-v=easy]').click(); document.querySelector('#startAI').click(); __xq.timeScale = 8; });
    await p.evaluate(() => __xq.play('h2e2'));
    await p.waitForFunction(() => __xq.game.pos.hist.length >= 2, null, { timeout: 60000 });
    const st = await p.evaluate(() => ({ n: __xq.game.pos.hist.length, notes: __xq.game.notes.map((n) => n.txt), worker: true }));
    ok(st.n === 2, 'AI (Web Worker) replied: ' + st.notes.join(' '));
    await p.evaluate(() => document.querySelector('#btnUndo').click());
    await p.waitForFunction(() => __xq.game.pos.hist.length === 0, null, { timeout: 30000 }).catch(() => {});
    ok(await p.evaluate(() => __xq.game.pos.hist.length === 0 && __xq.game.pos.side === 1), '人机悔棋退回两步（动画中点击会排队执行）');
    await p.close();
  }
  if (which === 'all' || which === 'online') {
    const host = await open('?fresh&nomenu' + PS);
    await host.evaluate(() => { __xq.createRoom(1); });
    await host.waitForFunction(() => document.querySelector('#netStatus').textContent.includes('等待') || document.querySelector('#netStatus').className.includes('bad'), null, { timeout: 30000 });
    const hs = await host.evaluate(() => ({ code: __xq.game.room, status: document.querySelector('#netStatus').textContent, link: document.querySelector('#roomLink').value }));
    console.log('host status:', hs.status, 'code:', hs.code, 'link:', hs.link);
    if (!hs.status.includes('等待')) { ok(false, '房主连上 PeerJS 服务器 (' + hs.status + ')'); }
    else {
      const guest = await open('?room=' + hs.code + PS);
      await guest.waitForFunction(() => document.querySelector('#netStatus').textContent === '已连接' || document.querySelector('#netStatus').className.includes('bad'), null, { timeout: 45000 });
      const gs = await guest.evaluate(() => document.querySelector('#netStatus').textContent);
      ok(gs === '已连接', '客人通过邀请链接加入: ' + gs);
      await host.waitForFunction(() => document.querySelector('#netStatus').textContent === '已连接', null, { timeout: 20000 });
      ok(await guest.evaluate(() => __xq.game.mySide === -1), '客人执黑（房主执红）');
      // host move -> guest
      await host.evaluate(() => __xq.play('h2e2'));
      await guest.waitForFunction(() => __xq.game.pos.hist.length === 1, null, { timeout: 20000 });
      ok(true, '房主走子同步到客人: ' + (await guest.evaluate(() => __xq.game.notes[0].txt)));
      // guest illegal attempt (wrong turn / illegal) must be ignored by host
      await guest.evaluate(() => __xq.game.net.send({ t: 'move', m: 0 * 90 + 1, ply: 1 }));
      await host.waitForTimeout(800);
      ok(await host.evaluate(() => __xq.game.pos.hist.length === 1), '房主拒绝非法着法');
      // guest move -> host
      await guest.evaluate(() => __xq.play('h9g7'));
      await host.waitForFunction(() => __xq.game.pos.hist.length === 2, null, { timeout: 20000 });
      ok(true, '客人走子同步到房主: ' + (await host.evaluate(() => __xq.game.notes[1].txt)));
      // undo request from guest, host auto-accepts by clicking the dialog
      await guest.evaluate(() => document.querySelector('#btnUndo').click());
      await host.waitForSelector('#dialog.show', { timeout: 10000 }); await host.click('#dialog .ok');
      await guest.waitForFunction(() => __xq.game.pos.hist.length === 1, null, { timeout: 15000 });
      ok(await host.evaluate(() => __xq.game.pos.hist.length === 1), '悔棋请求/同意 同步');
      // reconnect: drop guest connection, it should come back and resync
      await guest.evaluate(() => __xq.game.net.conn.close());
      await guest.waitForFunction(() => document.querySelector('#netStatus').textContent === '已连接' && __xq.game.pos.hist.length === 1, null, { timeout: 45000 });
      ok(true, '断线重连并重新同步');
      await host.waitForFunction(() => __xq.game.net.connected, null, { timeout: 20000 });
      // draw offer
      await guest.evaluate(() => document.querySelector('#btnDraw').click());
      await host.waitForSelector('#dialog.show', { timeout: 10000 }); await host.click('#dialog .ok');
      await guest.waitForFunction(() => __xq.game.result && __xq.game.result.result === 'draw', null, { timeout: 15000 });
      ok(true, '求和/接受 同步');
      // rematch (colors swap)
      await host.evaluate(() => document.querySelector('#bannerNew').click());
      await guest.waitForSelector('#dialog.show', { timeout: 10000 }); await guest.click('#dialog .ok');
      await guest.waitForFunction(() => !__xq.game.result && __xq.game.mySide === 1 && __xq.game.pos.hist.length === 0, null, { timeout: 15000 });
      ok(await host.evaluate(() => __xq.game.mySide === -1), '再来一局并交换先后手');
      // resign
      await host.evaluate(() => { __xq.game.net.send({ t: 'resign' }); });
      await host.waitForTimeout(200);
      await guest.evaluate(() => { document.querySelector('#btnResign').click(); }); await guest.click('#dialog .ok');
      await host.waitForFunction(() => __xq.game.result && __xq.game.result.result === 'resign', null, { timeout: 15000 });
      ok(await host.evaluate(() => __xq.game.result.winner === -1), '认输同步（房主执黑获胜）');
      await guest.close();
    }
    await host.close();
  }
  if (which === 'all' || which === 'badroom') { // bad room code → clear error
    const g2 = await open('?room=ZZZZ99' + PS);
    await g2.waitForFunction(() => document.querySelector('#netStatus').className.includes('bad'), null, { timeout: 45000 });
    ok(true, '错误房间码提示: ' + (await g2.evaluate(() => document.querySelector('#netStatus').textContent)));
    await g2.close();
  }
  console.log(logs.length ? 'console errors:\n' + [...new Set(logs)].slice(0, 15).join('\n') : 'no console errors');
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
