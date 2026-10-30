// 中继联机测试: two headless pages (WebGL disabled, ?renderer=2d) play online through a LOCAL MQTT-over-WebSocket broker.
//  1. ?relay=only: join, moves both ways, illegal move rejected, undo, broker-drop reconnect + resync, guest reload, resign, bad room
//  2. PeerJS broker unreachable → host still creates the room (relay only), guest auto-falls back to relay
//  3. WebRTC blocked (ICE candidates dropped in the guest) with a working PeerJS broker → guest falls back to relay after 6 s
// run: NODE_PATH=../.pw/node_modules PLAYWRIGHT_BROWSERS_PATH=../.pw/browsers node test/relay.test.js
const { chromium } = require('playwright');
const path = require('path');
const startBroker = require('./mqtt-broker');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
let fail = 0; const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };
const status = (p) => p.evaluate(() => document.querySelector('#netStatus').textContent);
(async () => {
  const broker = await startBroker(9883);
  const { PeerServer } = require('peer'); PeerServer({ port: 9125, path: '/xq' });
  const MQ = '&mqtt=' + encodeURIComponent(broker.url);
  const PS_OK = '&peerserver=' + encodeURIComponent('localhost:9125/xq');
  const PS_DEAD = '&peerserver=' + encodeURIComponent('localhost:9/none');
  const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--use-gl=disabled', '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1'] });
  const logs = [];
  const open = async (ctx, q, init) => {
    const p = await ctx.newPage(); if (init) await p.addInitScript(init);
    p.on('pageerror', (e) => logs.push('pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); if (/switching to MQTT relay/.test(m.text())) logs.push('info: ' + m.text()); });
    await p.goto(url + q, { timeout: 90000 }); await p.waitForFunction(() => window.__xq, null, { timeout: 60000 }); return p;
  };
  const waitStatus = (p, re, t = 30000) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#netStatus').textContent), re.source, { timeout: t });
  const idle = (p, n) => p.waitForFunction((n) => __xq.game.pos.hist.length === n && !__xq.game.busy, n, { timeout: 20000 });

  // ---------- 1. relay only ----------
  {
    const hctx = await browser.newContext({ viewport: { width: 1000, height: 700 } }), gctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const host = await open(hctx, '?fresh&nomenu&renderer=2d&relay=only' + MQ);
    await host.evaluate(() => __xq.createRoom(1));
    await waitStatus(host, /等待对手加入/);
    const code = await host.evaluate(() => __xq.game.room);
    ok(/mqtt=/.test(await host.inputValue('#roomLink')), '邀请链接携带 mqtt 覆盖参数');
    const guest = await open(gctx, '?room=' + code + '&renderer=2d&relay=only' + MQ);
    await waitStatus(guest, /^已连接（中继）$/);
    await waitStatus(host, /^已连接（中继）$/);
    ok(true, '中继模式加入房间: 客人 ' + (await status(guest)) + ' / 房主 ' + (await status(host)));
    ok(await guest.evaluate(() => __xq.mode2d && __xq.game.mySide === -1 && __xq.game.net.mode === 'relay'), '客人执黑，传输=relay');
    { const m = await gctx.newPage(); await m.setViewportSize({ width: 390, height: 780 }); await m.goto(url + '?room=' + code + '&renderer=2d&relay=only' + MQ); await m.waitForFunction(() => /中继/.test(document.querySelector('#netStatus').textContent), null, { timeout: 30000 });
      await m.waitForTimeout(800); await m.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'relay-mobile.png') }); await m.close();
      await waitStatus(guest, /已连接（中继）|对手|中断/); await guest.reload(); await guest.waitForFunction(() => window.__xq, null, { timeout: 60000 }); await waitStatus(guest, /^已连接（中继）$/); await waitStatus(host, /^已连接（中继）$/); }
    await host.evaluate(() => __xq.play('h2e2')); await idle(guest, 1);
    ok((await guest.evaluate(() => __xq.game.notes[0].txt)) === '炮二平五', '房主走子 → 客人');
    await guest.evaluate(() => __xq.game.net.send({ t: 'move', m: 0 * 90 + 1, ply: 1 }));
    await guest.evaluate(() => __xq.game.net.send({ t: 'move', m: 7 * 90 + 4, ply: 1 })); // red piece / wrong side
    await host.waitForTimeout(1200);
    ok(await host.evaluate(() => __xq.game.pos.hist.length === 1) && await guest.evaluate(() => __xq.game.pos.hist.length === 1), '房主拒绝非法着法（双方仍为 1 步）');
    await guest.evaluate(() => __xq.play('h9g7')); await idle(host, 2);
    ok((await host.evaluate(() => __xq.game.notes[1].txt)) === '马8进7', '客人走子 → 房主');
    await host.evaluate(() => __xq.play('b2c2')); await idle(guest, 3);
    // undo request from guest → host accepts → back to guest's turn with its move taken back (2 plies)
    await guest.evaluate(() => document.querySelector('#btnUndo').click());
    await host.waitForSelector('#dialog.show', { timeout: 10000 }); await host.click('#dialog .ok');
    await guest.waitForFunction(() => __xq.game.pos.hist.length === 1, null, { timeout: 15000 });
    ok(await host.evaluate(() => __xq.game.pos.hist.length === 1), '悔棋请求/同意 经中继同步');
    // broker drop on the guest: host moves meanwhile (lost: clean session) → guest reconnects → host resyncs
    await guest.evaluate(() => __xq.game.net.subs.relay._drop());
    await guest.waitForTimeout(300);
    await guest.evaluate(() => __xq.play('b9c7')); // guest's own move while offline is queued by MQTT.js
    await host.waitForFunction(() => __xq.game.pos.hist.length === 2, null, { timeout: 20000 });
    await host.evaluate(() => __xq.play('b0c2'));
    await guest.waitForFunction(() => __xq.game.pos.hist.length === 3 && !__xq.game.busy, null, { timeout: 30000 });
    const fenH = await host.evaluate(() => __xq.game.pos.serialize()), fenG = await guest.evaluate(() => __xq.game.pos.serialize());
    ok(fenH === fenG, '中继断线重连后重新同步 (' + fenG.split(' moves ')[1] + ')');
    ok(/已连接（中继）/.test(await status(guest)), '重连后状态: ' + (await status(guest)));
    // guest reload = new session → host resyncs full position
    await guest.reload(); await guest.waitForFunction(() => window.__xq, null, { timeout: 60000 });
    await waitStatus(guest, /^已连接（中继）$/);
    await guest.waitForFunction(() => __xq.game.pos.hist.length === 3, null, { timeout: 20000 });
    ok((await guest.evaluate(() => __xq.game.pos.serialize())) === fenH, '客人刷新页面后恢复对局');
    await waitStatus(host, /^已连接（中继）$/);
    // host reload (session resume) → guest relinks to the new host instance
    await host.reload(); await host.waitForFunction(() => window.__xq, null, { timeout: 60000 });
    await waitStatus(host, /^已连接（中继）$/, 40000);
    await waitStatus(guest, /^已连接（中继）$/, 40000);
    await guest.evaluate(() => __xq.play('a9a8')); await idle(host, 4);
    const fen4 = await host.evaluate(() => __xq.game.pos.serialize());
    await guest.waitForFunction((f) => __xq.game.pos.serialize() === f && !__xq.game.busy, fen4, { timeout: 15000 }).catch(() => {});
    const g4 = await guest.evaluate(() => __xq.game.pos.serialize());
    ok(g4 === fen4, '房主刷新后恢复房间，客人自动重连并继续对局' + (g4 === fen4 ? '' : ' host=' + fen4.split(' moves ')[1] + ' guest=' + g4.split(' moves ')[1]));
    // draw offer refused, then resign
    await guest.evaluate(() => document.querySelector('#btnDraw').click());
    await host.waitForSelector('#dialog.show', { timeout: 10000 }); await host.click('#dialog .no');
    await guest.waitForFunction(() => /对手拒绝和棋/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 }).catch(() => {});
    ok(await guest.evaluate(() => /对手拒绝和棋/.test(document.querySelector('#toast').textContent)), '求和/拒绝 经中继');
    await guest.evaluate(() => document.querySelector('#btnResign').click()); await guest.click('#dialog .ok');
    await host.waitForFunction(() => __xq.game.result && __xq.game.result.result === 'resign', null, { timeout: 15000 });
    ok(await host.evaluate(() => __xq.game.result.winner === 1), '客人认输 → 房主（红）获胜');
    // rematch swaps colours
    await guest.evaluate(() => document.querySelector('#bannerNew').click());
    await host.waitForSelector('#dialog.show', { timeout: 10000 }); await host.click('#dialog .ok');
    await guest.waitForFunction(() => !__xq.game.result && __xq.game.mySide === 1 && __xq.game.pos.hist.length === 0, null, { timeout: 15000 });
    ok(await host.evaluate(() => __xq.game.mySide === -1), '再来一局并交换先后手（中继）');
    // guest leaves → host notices quickly (bye)
    await guest.close();
    await waitStatus(host, /对手已离开/, 25000).catch(() => {});
    ok(/对手已离开/.test(await status(host)), '客人离开后房主状态: ' + (await status(host)));
    // nonexistent room
    const bad = await open(gctx, '?room=ZZZZ99&renderer=2d&relay=only' + MQ);
    await bad.waitForFunction(() => document.querySelector('#netStatus').className.includes('bad'), null, { timeout: 30000 });
    ok(/房间不存在或房主已离开/.test(await status(bad)), '不存在的房间: ' + (await status(bad)));
    // host leaves → room disappears (presence cleared) → join fails cleanly
    await host.close();
    const late = await open(gctx, '?room=' + code + '&renderer=2d&relay=only' + MQ);
    await late.waitForFunction(() => document.querySelector('#netStatus').className.includes('bad'), null, { timeout: 30000 });
    ok(/房间不存在或房主已离开/.test(await status(late)), '房主离开后加入: ' + (await status(late)));
    await hctx.close(); await gctx.close();
  }
  // ---------- 2. PeerJS broker unreachable (auto mode) ----------
  {
    const hctx = await browser.newContext(), gctx = await browser.newContext();
    const host = await open(hctx, '?fresh&nomenu&renderer=2d' + PS_DEAD + MQ);
    await host.evaluate(() => __xq.createRoom(1));
    await waitStatus(host, /等待对手加入|bad/);
    ok(/等待对手加入/.test(await status(host)), 'PeerJS 不可达时仍能创建房间: ' + (await status(host)));
    await host.waitForTimeout(1500);
    ok(/等待对手加入/.test(await status(host)), '房主保持等待状态（不报错）');
    const code = await host.evaluate(() => __xq.game.room);
    const t0 = Date.now();
    const guest = await open(gctx, '?room=' + code + '&renderer=2d' + PS_DEAD + MQ);
    await waitStatus(guest, /^已连接（中继）$/, 30000);
    ok(true, 'PeerJS 不可达 → 客人自动改用中继 (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    await host.evaluate(() => __xq.play('h2e2')); await idle(guest, 1);
    await guest.evaluate(() => __xq.play('h9g7')); await idle(host, 2);
    ok(await host.evaluate(() => /已连接（中继）/.test(document.querySelector('#netStatus').textContent) && __xq.game.net.mode === 'relay'), '回退后双向走子');
    await hctx.close(); await gctx.close();
  }
  // ---------- 3. WebRTC blocked in the guest, PeerJS broker fine ----------
  {
    const hctx = await browser.newContext(), gctx = await browser.newContext();
    const host = await open(hctx, '?fresh&nomenu&renderer=2d' + PS_OK + MQ);
    await host.evaluate(() => __xq.createRoom(1));
    await waitStatus(host, /等待对手加入/);
    const code = await host.evaluate(() => __xq.game.room);
    const blockIce = () => { const R = window.RTCPeerConnection; window.RTCPeerConnection = class extends R { set onicecandidate(f) { } get onicecandidate() { return null; } addEventListener(t, f, o) { if (t !== 'icecandidate') super.addEventListener(t, f, o); } addIceCandidate() { return Promise.resolve(); } }; };
    const t0 = Date.now();
    const guest = await open(gctx, '?room=' + code + '&renderer=2d' + PS_OK + MQ, blockIce);
    await waitStatus(guest, /^已连接（中继）$/, 40000);
    const dt = (Date.now() - t0) / 1000;
    ok(dt >= 5, 'WebRTC 被阻断 → ' + dt.toFixed(1) + 's 后自动切换中继');
    await waitStatus(host, /^已连接（中继）$/);
    await host.evaluate(() => __xq.play('h2e2')); await idle(guest, 1);
    await guest.evaluate(() => __xq.play('h9g7')); await idle(host, 2);
    ok(true, '切换后对局正常');
    // control: normal guest on the same setup connects directly
    await guest.close();
    const g2 = await open(gctx, '?room=' + code + '&renderer=2d' + PS_OK + MQ);
    await waitStatus(g2, /^已连接（直连）$/, 30000).catch(() => {});
    ok(/已连接（直连）/.test(await status(g2)), 'WebRTC 可用时走直连: ' + (await status(g2)));
    await waitStatus(host, /^已连接（直连）$/, 15000).catch(() => {});
    ok(/已连接（直连）/.test(await status(host)) && (await g2.evaluate(() => __xq.game.pos.hist.length)) === 2, '房主切换到新的直连会话并同步: ' + (await status(host)));
    await hctx.close(); await gctx.close();
  }
  const errs = [...new Set(logs)].filter((l) => !/^info:/.test(l));
  console.log([...new Set(logs)].filter((l) => /^info:/.test(l)).slice(0, 3).join('\n'));
  console.log(errs.length ? 'console errors:\n' + errs.slice(0, 15).join('\n') : 'no console errors');
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  await browser.close(); broker.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
