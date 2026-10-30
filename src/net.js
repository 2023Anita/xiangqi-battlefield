// 联机传输层 GameTransport — 游戏逻辑只依赖这个接口。
// PeerTransport: WebRTC P2P via PeerJS (default PeerJS cloud broker for signalling, Google/Cloudflare STUN).
export class GameTransport {
  constructor() { this._msg = []; this._status = []; }
  sendMove(move, ply) { this.send({ t: 'move', m: move, ply }); }
  onMove(cb) { this.onMessage((msg) => { if (msg.t === 'move') cb(msg.m, msg.ply); }); }
  send(_msg) { }
  onMessage(cb) { this._msg.push(cb); }
  onStatus(cb) { this._status.push(cb); }
  close() { }
  _emit(msg) { for (const cb of this._msg) cb(msg); }
  _setStatus(state, info) { this.state = state; this._lastInfo = info || {}; for (const cb of this._status) cb(state, info || {}); }
}

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRoomCode(n = 6) { let s = ''; const a = new Uint32Array(n); crypto.getRandomValues(a); for (let i = 0; i < n; i++) s += ROOM_ALPHABET[a[i] % ROOM_ALPHABET.length]; return s; }
export function normalizeRoomCode(s) { s = String(s || '').trim(); const m = /[?&]room=([A-Za-z0-9]+)/.exec(s); if (m) s = m[1]; return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
const PREFIX = 'xqbf-';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

const ERR = {
  'peer-unavailable': '房间不存在或房主已离开，请检查房间码',
  'unavailable-id': '房间码已被占用',
  'network': '网络限制，建议换网络或稍后重试',
  'server-error': '联机服务器暂时不可用，建议稍后重试',
  'socket-error': '网络限制，建议换网络或稍后重试',
  'socket-closed': '网络连接中断，建议换网络或稍后重试',
  'browser-incompatible': '当前浏览器不支持 WebRTC 联机',
  'webrtc': '无法建立点对点连接（可能是网络限制），建议换网络或稍后重试',
  'ice': '无法建立点对点连接（可能是网络限制），建议换网络或稍后重试',
  'timeout': '连接超时：网络限制，建议换网络或稍后重试',
  'no-peerjs': '联机组件加载失败',
};
export function errorText(type) { return ERR[type] || ('联机出错（' + type + '），建议换网络或稍后重试'); }

/* status states: 'connecting' | 'waiting' (host waiting for guest) | 'connected' | 'reconnecting' | 'opponent-left' | 'error' | 'closed' */
export class PeerTransport extends GameTransport {
  constructor({ role, code, peerOptions }) {
    super(); this.role = role; this.code = code; this.conn = null; this.peer = null; this.closed = false; this.lastSeen = 0; this.retries = 0;
    this.peerOptions = Object.assign({ debug: 1, config: { iceServers: ICE } }, peerOptions || {});
  }
  get hostId() { return PREFIX + this.code.toLowerCase(); }
  start() {
    if (typeof Peer === 'undefined') { this._setStatus('error', { type: 'no-peerjs', text: errorText('no-peerjs') }); return; }
    this._setStatus('connecting');
    const peer = this.role === 'host' ? new Peer(this.hostId, this.peerOptions) : new Peer(this.peerOptions);
    this.peer = peer;
    peer.on('open', () => { if (this.role === 'host') this._setStatus(this.conn && this.conn.open ? 'connected' : 'waiting'); else this._connect(); });
    peer.on('connection', (conn) => { if (this.role !== 'host') { conn.close(); return; } if (this.conn && this.conn !== conn) { try { this.conn.close(); } catch (e) { } } this._attach(conn); });
    peer.on('disconnected', () => { if (this.closed) return; setTimeout(() => { if (!this.closed && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) { } } }, 1500); });
    peer.on('error', (e) => this._onError(e));
    this._hb = setInterval(() => this._heartbeat(), 3000);
  }
  _connect() {
    if (this.closed) return;
    const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
    this._attach(conn);
    clearTimeout(this._connTimer);
    this._connTimer = setTimeout(() => { if (!conn.open && !this.closed) { try { conn.close(); } catch (e) { } this._retryOrFail('timeout'); } }, 15000);
  }
  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => { if (this.conn !== conn) return; clearTimeout(this._connTimer); this.retries = 0; this.lastSeen = Date.now(); this._setStatus('connected'); this._emit({ t: '_open' }); });
    conn.on('data', (d) => { if (this.conn !== conn) return; this.lastSeen = Date.now(); if (d && d.t === 'ping') return; if (d && typeof d === 'object') this._emit(d); });
    conn.on('close', () => { if (this.conn !== conn || this.closed) return; this._lost(); });
    conn.on('error', (e) => { if (this.conn !== conn) return; console.warn('conn error', e); });
    if (conn.peerConnection) conn.peerConnection.addEventListener('iceconnectionstatechange', () => { const s = conn.peerConnection && conn.peerConnection.iceConnectionState; if (s === 'failed' && this.conn === conn) { if (!conn.open) this._retryOrFail('ice'); else this._lost(); } });
  }
  _lost() {
    this._emit({ t: '_lost' });
    if (this.role === 'host') { this._setStatus('opponent-left'); return; }
    this._setStatus('reconnecting');
    this._retryOrFail(null);
  }
  _retryOrFail(type) {
    if (this.closed) return;
    if (this.role === 'host') { this._setStatus('error', { type, text: errorText(type) }); return; }
    if (this.retries++ < (this.everConnected ? 20 : 2)) { this._setStatus(this.everConnected ? 'reconnecting' : 'connecting'); setTimeout(() => { if (this.closed) return; if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (e) { } } this._connect(); }, 2500); }
    else this._setStatus('error', { type: type || 'timeout', text: errorText(type || 'timeout') });
  }
  _heartbeat() {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send({ t: 'ping' }); } catch (e) { }
    if (this.lastSeen && Date.now() - this.lastSeen > 12000) { const c = this.conn; this.lastSeen = 0; try { c.close(); } catch (e) { } if (this.conn === c) this._lost(); }
  }
  _onError(e) {
    const type = e && e.type || 'network';
    console.warn('peer error', type, e);
    if (type === 'peer-unavailable') { // host not online (yet / anymore)
      if (this.everConnected) { this._retryOrFail(null); return; }
      this._setStatus('error', { type, text: errorText(type) }); return;
    }
    if (type === 'unavailable-id') { this._setStatus('error', { type, text: errorText(type) }); return; }
    if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'server-error') {
      if (this.conn && this.conn.open) return; // P2P link still alive; broker hiccup only
    }
    this._setStatus('error', { type, text: errorText(type) });
  }
  _setStatus(s, info) { if (s === 'connected') this.everConnected = true; super._setStatus(s, info); }
  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); return true; } catch (e) { return false; } } return false; }
  get connected() { return !!(this.conn && this.conn.open); }
  close() { this.closed = true; clearInterval(this._hb); clearTimeout(this._connTimer); try { this.conn && this.conn.close(); } catch (e) { } try { this.peer && this.peer.destroy(); } catch (e) { } this._setStatus('closed'); }
}

// ---------------------------------------------------------------------------------------------
// RelayTransport: fallback over public MQTT-over-WebSocket brokers (works where UDP / P2P is blocked).
// Topics xqbf/v1/<CODE>/host (published by host), …/guest (published by guest), …/presence (retained, host only).
// Both sides connect to EVERY broker in the list and listen on all of them (public brokers are not bridged, so this
// guarantees they meet on whichever broker both can reach); each side sends on the broker it last heard the other on.
// Envelope {k, f(sender id), to, q(seq), d}; k = hello | ack | nack | ping | msg | bye. QoS 1, duplicates dropped by seq.
export const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
Object.assign(ERR, {
  'relay-unreachable': '中继服务器无法连接，建议换网络或稍后重试',
  'no-mqtt': '中继联机组件加载失败',
});
function rid(n = 10) { const a = new Uint32Array(n); crypto.getRandomValues(a); let s = ''; for (let i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[a[i] % 36]; return s; }

export class RelayTransport extends GameTransport {
  constructor({ role, code, brokers, timing }) {
    super(); this.role = role; this.code = String(code).toUpperCase();
    this.brokers = brokers && brokers.length ? brokers : RELAY_BROKERS;
    this.id = rid(); this.seq = 0; this.pending = []; this.peerId = null; this.lastSeq = {}; this.clients = []; this.active = null;
    this.closed = false; this.linked = false; this.everLinked = false; this.lastSeen = 0; this.ticks = 0; this.startedAt = 0;
    this.T = Object.assign({ hb: 5000, dead: 20000, discover: 7000, join: 25000, unreachable: 12000 }, timing || {});
  }
  get kind() { return 'relay'; }
  _topic(s) { return 'xqbf/v1/' + this.code + '/' + s; }
  get connected() { return this.linked; }
  start() {
    if (typeof mqtt === 'undefined' || !mqtt.connect) { this._setStatus('error', { type: 'no-mqtt', text: errorText('no-mqtt') }); return; }
    this.startedAt = Date.now();
    this._setStatus('connecting');
    this.brokers.forEach((url, i) => this._open(url, i));
    this._hbT = setInterval(() => this._tick(), this.T.hb);
    this._unreachT = setTimeout(() => { if (!this.closed && !this.clients.some((e) => e.everOk)) this._fail('relay-unreachable', this.role === 'host'); }, this.T.unreachable);
  }
  _open(url, i) {
    const ent = { url, i, ok: false, everOk: false, pres: null, c: null };
    const opts = { clientId: 'xqbf_' + this.id + '_' + i, clean: true, keepalive: 30, connectTimeout: 8000, reconnectPeriod: 3000, protocolVersion: 4, resubscribe: false };
    if (this.role === 'host') opts.will = { topic: this._topic('presence'), payload: '', qos: 1, retain: true };
    else opts.will = { topic: this._topic('guest'), payload: JSON.stringify({ k: 'bye', f: this.id, w: 1 }), qos: 1, retain: false };
    let c; try { c = mqtt.connect(url, opts); } catch (e) { console.warn('relay connect failed', url, e); return; }
    ent.c = c; this.clients.push(ent);
    c.on('connect', () => {
      if (this.closed) return;
      const re = ent.everOk; ent.ok = ent.everOk = true;
      const subs = [this._topic(this.role === 'host' ? 'guest' : 'host')]; if (this.role === 'guest') subs.push(this._topic('presence'));
      c.subscribe(subs, { qos: 1 }, (err) => {
        if (err || this.closed) return;
        this._flush(ent); // queued moves first, so the host's resync below already includes them
        if (this.role === 'host') { this._presence(ent); if (re && this.linked) this._emit({ t: '_open' }); } // broker blip: resync guest
        else if (!this.linked || re) this._send(ent, 'hello');
      });
      if (!this._discT && this.role === 'guest') this._discT = setTimeout(() => this._discoverCheck(), this.T.discover);
      this._evalIdle();
    });
    c.on('close', () => { ent.ok = false; });
    c.on('error', (e) => console.warn('relay error', url, e && e.message));
    c.on('message', (topic, payload) => this._onMsg(ent, topic, payload));
  }
  _presence(ent) { try { ent.c.publish(this._topic('presence'), JSON.stringify({ h: this.id, t: Date.now() }), { qos: 1, retain: true }); } catch (e) { } }
  _send(ent, k, d) {
    if (!ent || !ent.c) return false;
    const env = { k, f: this.id, q: ++this.seq }; if (this.peerId && this.role === 'host') env.to = this.peerId; if (this.role === 'guest' && k !== 'hello' && this.peerId) env.to = this.peerId;
    if (d !== undefined) env.d = d;
    if (!ent.ok) { if (k === 'msg') this.pending.push(env); return k === 'msg'; } // offline: keep game messages for the next connect
    return this._pub(ent, env);
  }
  _pub(ent, env) { try { ent.c.publish(this._topic(this.role), JSON.stringify(env), { qos: 1 }); return true; } catch (e) { return false; } }
  _flush(ent) { const q = this.pending.splice(0); for (const env of q) this._pub(ent, env); }
  _pick() { if (this.active && this.active.ok) return this.active; return this.clients.find((e) => e.ok) || this.active; }
  send(msg) { if (!this.linked) return false; return this._send(this._pick(), 'msg', msg); }
  _onMsg(ent, topic, payload) {
    if (this.closed) return;
    const s = payload ? payload.toString() : '';
    if (topic === this._topic('presence')) {
      if (!s) { const had = ent.pres; ent.pres = null; if (had && this.linked && ent === this.active && had === this.peerId) this._lostLink(); return; }
      let p; try { p = JSON.parse(s); } catch (e) { return; }
      const changed = ent.pres !== p.h; ent.pres = p.h;
      if (!this.linked || (changed && p.h !== this.peerId)) this._send(ent, 'hello'); // host (re)appeared
      return;
    }
    let env; try { env = JSON.parse(s); } catch (e) { return; }
    if (!env || env.f === this.id) return;
    if (this.role === 'guest' && env.to && env.to !== this.id) return; // (host accepts guests that still address its previous instance)
    if (env.q != null) { if (this.lastSeq[env.f] >= env.q) return; this.lastSeq[env.f] = env.q; }
    if (this.role === 'host') {
      if (env.k === 'hello') {
        const fresh = env.f !== this.peerId || !this.linked;
        this.peerId = env.f; this.linked = this.everLinked = true; this.lastSeen = Date.now(); this.active = ent;
        this._send(ent, 'ack');
        if (fresh) this._setStatus('connected');
        this._emit({ t: '_open' }); // new session or guest-side reconnect: host resyncs
        return;
      }
      if (env.k === 'bye' && env.w && Date.now() - this.lastSeen < 3000) return; // stale last-will after a quick reconnect
      if (!this.linked && env.k !== 'bye') { // guest back after a drop / spurious will, or still talking to our pre-reload instance: (re)link
        this.peerId = env.f; this.linked = this.everLinked = true; this.lastSeen = Date.now(); this.active = ent; this._setStatus('connected');
        if (env.k === 'msg' && env.d && typeof env.d === 'object') this._emit(env.d);
        this._emit({ t: '_open' }); return;
      }
      if (env.f !== this.peerId || !this.linked) { if (env.k !== 'bye') { const pid = this.peerId; this.peerId = env.f; this._send(ent, 'nack'); this.peerId = pid; } return; }
    } else {
      if (env.k === 'ack') {
        this.peerId = env.f; this.lastSeen = Date.now(); this.active = ent;
        if (!this.linked) { this.linked = this.everLinked = true; this._setStatus('connected'); this._emit({ t: '_open' }); }
        return;
      }
      if (env.k === 'nack') { if (this.linked) this._lostLink(true); this._send(ent, 'hello'); return; }
      if (env.f !== this.peerId) { this._send(ent, 'hello'); return; }
      if (!this.linked) return;
    }
    this.lastSeen = Date.now(); this.active = ent;
    if (env.k === 'msg' && env.d && typeof env.d === 'object') this._emit(env.d);
    else if (env.k === 'bye') this._lostLink();
  }
  _lostLink(quiet) {
    if (!this.linked) return;
    this.linked = false; this._emit({ t: '_lost' });
    if (this.role === 'host') this._setStatus('opponent-left');
    else { this._setStatus('reconnecting'); if (!quiet) for (const e of this.clients) if (e.ok) this._send(e, 'hello'); }
  }
  _tick() {
    if (this.closed) return;
    this.ticks++;
    if (this.linked) {
      this._send(this._pick(), 'ping');
      if (Date.now() - this.lastSeen > this.T.dead) this._lostLink();
    } else if (this.role === 'guest') {
      for (const e of this.clients) if (e.ok) this._send(e, 'hello');
      if (!this.everLinked && this.state !== 'error' && Date.now() - this.startedAt > this.T.join && this.clients.some((e) => e.pres)) this._fail('timeout');
    }
    if (this.role === 'host' && this.ticks % 6 === 0) for (const e of this.clients) if (e.ok) this._presence(e);
  }
  _discoverCheck() {
    if (this.closed || this.everLinked || this.linked) return;
    if (!this.clients.some((e) => e.pres)) this._fail('peer-unavailable');
  }
  _evalIdle() { if (this.closed) return; if (this.role === 'host' && !this.linked && (this.state === 'connecting' || this.state === 'error')) this._setStatus(this.everLinked ? 'opponent-left' : 'waiting'); }
  _fail(type, keepTrying) {
    this._setStatus('error', { type, text: errorText(type) });
    if (!keepTrying) this._shutdown();
  }
  _shutdown() {
    this.closed = true; clearInterval(this._hbT); clearTimeout(this._unreachT); clearTimeout(this._discT);
    for (const e of this.clients) {
      try {
        if (e.ok) {
          if (this.linked) this._send(e, 'bye');
          if (this.role === 'host') e.c.publish(this._topic('presence'), '', { qos: 0, retain: true });
        }
        e.c.end(false);
      } catch (err) { }
    }
    this.linked = false;
  }
  // test hook: kill every broker socket as a network drop would; MQTT.js reconnects after reconnectPeriod (clean session →
  // messages addressed to us meanwhile are lost, our own QoS 1 publishes are queued and flushed on reconnect)
  _drop() { for (const e of this.clients) { try { e.c.stream && e.c.stream.destroy(); } catch (err) { } } }
  close() { if (this.closed) return; this._shutdown(); this._setStatus('closed'); }
}

// ---------------------------------------------------------------------------------------------
// HybridTransport: what the game actually uses.
//  host  — listens on BOTH PeerJS (direct) and MQTT (relay); whichever transport a guest session opens on becomes active.
//          A PeerJS broker outage never fails room creation (the relay keeps the room alive).
//  guest — tries WebRTC first; if not open within fallbackMs (or PeerJS errors) switches to the relay for good.
//  relayMode: 'auto' | 'only' (skip WebRTC) | 'off' (WebRTC only). Status info carries mode: 'direct' | 'relay'.
export class HybridTransport extends GameTransport {
  constructor({ role, code, peerOptions, relayBrokers, relayMode, resumed, fallbackMs, relayTiming }) {
    super(); this.role = role; this.code = code; this.peerOptions = peerOptions; this.relayBrokers = relayBrokers; this.relayTiming = relayTiming;
    this.relayMode = relayMode === 'only' || relayMode === 'off' ? relayMode : 'auto'; this.resumed = !!resumed;
    this.fallbackMs = fallbackMs || 6000; this.subs = {}; this.active = null; this.closed = false; this.peerRetries = 0;
  }
  get mode() { return this.active; }
  get connected() { const a = this.subs[this.active]; return !!(a && a.connected); }
  get conn() { const d = this.subs.direct; return d && d.conn; } // compat (tests)
  start() {
    this._setStatus('connecting');
    if (this.role === 'host') {
      if (this.relayMode !== 'only') this._addDirect();
      if (this.relayMode !== 'off') this._addRelay();
    } else if (this.relayMode === 'only') this._addRelay();
    else {
      this._addDirect();
      if (this.relayMode === 'auto' && !this.subs.relay) this._fbT = setTimeout(() => this._fallback('timeout'), this.fallbackMs);
    }
  }
  _addDirect() { this._add('direct', new PeerTransport({ role: this.role, code: this.code, peerOptions: this.peerOptions })); }
  _addRelay() { this._add('relay', new RelayTransport({ role: this.role, code: this.code, brokers: this.relayBrokers, timing: this.relayTiming })); }
  _add(kind, tr) {
    this.subs[kind] = tr;
    tr.onStatus((s, info) => { if (this.subs[kind] === tr && !this.closed) this._onSub(kind, s, info); });
    tr.onMessage((msg) => { if (this.subs[kind] === tr && !this.closed) this._onSubMsg(kind, msg); });
    tr.start();
  }
  _drop(kind) { const t = this.subs[kind]; delete this.subs[kind]; if (t) try { t.close(); } catch (e) { } }
  _fallback(reason) {
    if (this.closed || this.role !== 'guest' || this.relayMode !== 'auto' || this.subs.relay || this.retriedDirect) return;
    clearTimeout(this._fbT);
    if (this.active === 'direct' && this.connected) return;
    console.info('[xqbf] WebRTC unavailable (' + reason + '), switching to MQTT relay'); this.fbReason = reason;
    if (this.active === 'direct') this.active = null;
    this._drop('direct'); this._addRelay();
  }
  _onSub(kind, s, info) {
    if (this.role === 'guest') {
      if (kind === 'direct' && this.relayMode === 'auto') {
        if (s === 'connected') { clearTimeout(this._fbT); this.active = 'direct'; }
        else if (s === 'error') { this.directErr = info; if (!this.retriedDirect) { this._fallback(info && info.type || 'error'); return; } }
        else if (this.active !== 'direct') { this._st('connecting'); return; }
      }
      if (s === 'connected') { this.active = kind; this.everConnected = true; }
      // relay broker unreachable but the PeerJS broker already said the room does not exist → that is the real answer
      if (kind === 'relay' && s === 'error' && info && info.type === 'relay-unreachable') {
        if (this.directErr && this.directErr.type === 'peer-unavailable') info = this.directErr;
        else if (this.fbReason === 'timeout' && !this.retriedDirect && !this.everConnected) { // relay brokers blocked too: give slow WebRTC one more, unhurried try
          this.retriedDirect = true; console.info('[xqbf] relay unreachable, retrying WebRTC'); this._drop('relay'); this.active = null; this._addDirect(); return;
        }
      }
      this._st(s, info);
      return;
    }
    // host
    if (kind === 'direct' && s === 'error' && info && info.type === 'unavailable-id') {
      if (!this.resumed) { this._st('error', info); return; } // genuine room-code clash → caller picks a new code
      if (this.peerRetries++ < 5) { this._drop('direct'); setTimeout(() => { if (!this.closed && !this.subs.direct) this._addDirect(); }, 4000); } // our old tab still holds the id
    }
    if (s === 'connected') this.active = kind;
    this._recompute();
  }
  _recompute() {
    const a = this.subs[this.active];
    if (a && a.state === 'connected') return this._st('connected');
    if (a && a.state === 'opponent-left') return this._st('opponent-left');
    const subs = Object.values(this.subs), st = subs.map((t) => t.state);
    if (st.includes('waiting')) return this._st(this.active ? 'opponent-left' : 'waiting');
    if (st.includes('connecting') || st.includes('reconnecting') || !subs.length) return this._st('connecting');
    const err = (this.subs.relay && this.subs.relay.state === 'error' ? this.subs.relay : subs.find((t) => t.state === 'error'));
    this._st('error', err ? err._lastInfo : { type: 'network', text: errorText('network') });
  }
  _st(s, info) {
    info = Object.assign({}, info || {}, { mode: this.active });
    const key = s + '|' + (s === 'connected' ? this.active : '') + '|' + (info.text || '');
    if (key === this._lastKey) return; this._lastKey = key;
    this._setStatus(s, info);
  }
  _onSubMsg(kind, msg) {
    if (this.role === 'host' && msg && msg.t === '_open' && this.active !== kind) { this.active = kind; this._recompute(); }
    if (kind !== this.active) return;
    this._emit(msg);
  }
  send(msg) { const a = this.subs[this.active]; return a ? a.send(msg) : false; }
  close() { if (this.closed) return; this.closed = true; clearTimeout(this._fbT); for (const k of Object.keys(this.subs)) this._drop(k); this._setStatus('closed', { mode: this.active }); }
}
