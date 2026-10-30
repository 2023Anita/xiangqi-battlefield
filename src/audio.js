// 程序化音效 (procedural WebAudio): 战鼓、投石机、马蹄、金属碰撞、碎石、铜锣
export class Sfx {
  constructor() { this.ctx = null; this.muted = localStorage.getItem('xqbf-mute') === '1'; this.master = null; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.5, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }
  setMuted(m) { this.muted = m; localStorage.setItem('xqbf-mute', m ? '1' : '0'); if (this.master) this.master.gain.value = m ? 0 : 0.7; }
  _env(node, t, a, peak, dec) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); node.connect(g); g.connect(this.master); return g; }
  _osc(type, f0, f1, t, dur, peak) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur); this._env(o, t, 0.005, peak, dur); o.start(t); o.stop(t + dur + 0.05); return o; }
  _noise(t, dur, peak, type = 'lowpass', freq = 800, q = 0.7) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; s.connect(f); this._env(f, t, 0.004, peak, dur); s.start(t, Math.random()); s.stop(t + dur + 0.05); return s; }
  play(name, delay = 0) {
    if (this.muted || !this.ensure()) return; const t = this.ctx.currentTime + delay;
    switch (name) {
      case 'drum': this._osc('sine', 120, 48, t, 0.45, 0.9); this._noise(t, 0.12, 0.35, 'lowpass', 400); break;
      case 'select': this._osc('triangle', 660, 520, t, 0.08, 0.15); break;
      case 'step': this._noise(t, 0.06, 0.12, 'lowpass', 500); break;
      case 'hoof': for (let i = 0; i < 6; i++) { const tt = t + i * 0.11 + (i % 2) * 0.03; this._noise(tt, 0.05, 0.3, 'bandpass', 900 + Math.random() * 300, 3); this._osc('sine', 180, 90, tt, 0.05, 0.25); } break;
      case 'roll': this._noise(t, 0.7, 0.25, 'lowpass', 220); for (let i = 0; i < 5; i++) this._noise(t + i * 0.13, 0.04, 0.15, 'bandpass', 700, 4); break;
      case 'stomp': this._osc('sine', 70, 30, t, 0.6, 1.0); this._noise(t, 0.4, 0.5, 'lowpass', 250); break;
      case 'thunk': this._osc('sine', 90, 40, t, 0.3, 0.9); this._noise(t, 0.2, 0.6, 'lowpass', 600); this._osc('square', 300, 120, t, 0.08, 0.12); break;
      case 'whoosh': { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.45); f.frequency.exponentialRampToValueAtTime(500, t + 0.9); s.connect(f); this._env(f, t, 0.15, 0.25, 0.8); s.start(t); s.stop(t + 1.1); break; }
      case 'crash': this._noise(t, 0.6, 0.9, 'lowpass', 1500); this._osc('sine', 80, 30, t, 0.5, 0.9); for (let i = 0; i < 6; i++) this._noise(t + 0.05 + Math.random() * 0.4, 0.05, 0.25, 'bandpass', 1500 + Math.random() * 2000, 5); break;
      case 'clash': for (const f of [1210, 1730, 2480, 3170]) this._osc('triangle', f, f * 0.98, t, 0.35, 0.12); this._noise(t, 0.08, 0.4, 'highpass', 3000); break;
      case 'thrust': this._noise(t, 0.12, 0.3, 'bandpass', 2400, 2); this._osc('triangle', 1600, 1500, t + 0.08, 0.2, 0.1); break;
      case 'fall': this._noise(t, 0.35, 0.4, 'lowpass', 500); this._osc('sine', 110, 50, t + 0.1, 0.3, 0.4); break;
      case 'check': this._osc('sawtooth', 220, 220, t, 0.25, 0.12); this._osc('sawtooth', 330, 330, t + 0.18, 0.35, 0.12); this.play('drum'); this.play('drum', 0.18); break;
      case 'gong': for (const f of [110, 166, 223, 331, 447]) this._osc('sine', f * 1.02, f, t, 3.2, 0.18); this._noise(t, 0.3, 0.2, 'bandpass', 600, 1); break;
      case 'error': this._osc('square', 200, 160, t, 0.12, 0.08); break;
      case 'notify': this._osc('sine', 880, 880, t, 0.12, 0.15); this._osc('sine', 1320, 1320, t + 0.1, 0.18, 0.12); break;
    }
  }
}
