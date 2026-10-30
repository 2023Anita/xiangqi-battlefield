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
  _setStatus(state, info) { this.state = state; for (const cb of this._status) cb(state, info || {}); }
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
