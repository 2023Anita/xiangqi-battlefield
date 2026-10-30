// 象棋·战场 — main game module
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPiece, buildBattlefield, heightAt, updateFlag, SK, MAT, PAL, labelTexture, NAMES } from './models.js';
import { Sfx } from './audio.js';
import { PeerTransport, newRoomCode, normalizeRoomCode, errorText } from './net.js';

const XQ = window.XQ, AIlib = window.XQAI;
const { Position, mvFrom, mvTo, RED, BLACK } = XQ;
const $ = (s) => document.querySelector(s);
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const params = new URLSearchParams(location.search);

// ============ renderer / scene ============
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, isMobile ? 1.75 : 2);
renderer.setPixelRatio(DPR); SK.uDpr.value = DPR;
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 6; controls.maxDistance = 30;
controls.maxPolarAngle = 1.32; controls.minPolarAngle = 0.0; controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 0.6;
controls.target.set(0, 0, 0.4);
const rt = new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 1.15); composer.addPass(bloom);
composer.addPass(new OutputPass());

const hemi = new THREE.HemisphereLight('#e8f0ff', '#b39a72', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.4); sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048); const sc = sun.shadow.camera; sc.left = -7.5; sc.right = 7.5; sc.top = 7.5; sc.bottom = -7.5; sc.near = 1; sc.far = 40;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const field = buildBattlefield(scene);

// ============ lighting presets ============
function gradTex(top, bottom, stars) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(1, bottom); x.fillStyle = g; x.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const PRESETS = {
  morning: { name: '晨光', bg: ['#a9cbe0', '#efe6d2'], hemi: ['#eef4ff', '#b49c74', 1.15], sun: ['#fff0d2', 2.5, [-7, 13, 9]], fire: 0.6, water: 1.0, bloom: 0.28, exp: 1.0, fog: '#e7e0cf' },
  dusk: { name: '黄昏', bg: ['#f0a066', '#5d4468'], hemi: ['#ffc8a0', '#4a3450', 0.8], sun: ['#ff9248', 2.4, [10, 5.5, -3]], fire: 2.5, water: 0.85, bloom: 0.45, exp: 1.05, fog: '#b97a66' },
  night: { name: '夜战', bg: ['#0b1222', '#22314a'], hemi: ['#5a70a0', '#181218', 0.5], sun: ['#a9bcff', 0.75, [6, 12, -7]], fire: 6, water: 0.5, bloom: 0.9, exp: 1.15, fog: '#121a2a' },
};
const view = { light: localStorage.getItem('xqbf-light') || 'morning', sketch: false, mode2d: false, labels: false, side: RED };
function applyLight() {
  const p = PRESETS[view.light] || PRESETS.morning;
  if (view.sketch) {
    scene.background = new THREE.Color('#f5f3ec'); hemi.color.set('#ffffff'); hemi.groundColor.set('#d8d4ca'); hemi.intensity = 1.25;
    sun.color.set('#ffffff'); sun.intensity = 2.0; sun.position.set(-6, 13, 8); renderer.toneMapping = THREE.NoToneMapping; bloom.enabled = false;
    field.lights.forEach((l) => (l.intensity = 0)); field.colorOnly.forEach((o) => (o.visible = false)); field.water.uniforms.uLight.value = 1;
    field.riverText.material.color.setRGB(0.12, 0.1, 0.08); scene.fog = null;
  } else {
    scene.background = gradTex(p.bg[0], p.bg[1]); hemi.color.set(p.hemi[0]); hemi.groundColor.set(p.hemi[1]); hemi.intensity = p.hemi[2];
    sun.color.set(p.sun[0]); sun.intensity = p.sun[1]; sun.position.set(...p.sun[2]); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = p.exp;
    bloom.enabled = true; bloom.strength = p.bloom; field.lights.forEach((l) => (l.intensity = p.fire)); field.colorOnly.forEach((o) => (o.visible = true));
    field.water.uniforms.uLight.value = p.water; field.riverText.material.color.setRGB(1, 1, 1);
    scene.fog = new THREE.Fog(p.fog, 70, 160);
  }
  SK.uSketch.value = view.sketch ? 1 : 0;
  MAT.outline.color.set(view.sketch ? '#1c1712' : view.light === 'night' ? '#0c0a10' : '#2a1a10');
  $('#btnLight').textContent = '光照·' + p.name; $('#btnSketch').classList.toggle('on', view.sketch);
  document.body.dataset.light = view.sketch ? 'sketch' : view.light;
}

// ============ time / tweens ============
let simTime = 0, timeScale = 1; const tweens = new Set();
const ease = { linear: (k) => k, inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2), out: (k) => 1 - Math.pow(1 - k, 3), in: (k) => k * k * k, outBack: (k) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); } };
function tween(dur, fn, e = ease.inOut) { return new Promise((res) => { tweens.add({ t0: simTime, dur: Math.max(dur, 0.0001), fn, e, res }); }); }
const wait = (s) => tween(s, () => { });
function updateTweens() { for (const tw of tweens) { const k = Math.min(1, (simTime - tw.t0) / tw.dur); tw.fn(tw.e(k), k); if (k >= 1) { tweens.delete(tw); tw.res(); } } }
const events = { pauseOn: null };
function emitEvent(name) { if (events.pauseOn === name) { timeScale = 0; events.paused = name; } }

// ============ FX: debris + dust ============
const FX = (() => {
  const N = 160, dGeo = new THREE.BoxGeometry(0.06, 0.04, 0.05);
  const debris = new THREE.InstancedMesh(dGeo, new THREE.MeshToonMaterial({ gradientMap: MAT.toon.gradientMap }), N); debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.castShadow = true; debris.frustumCulled = false; scene.add(debris);
  const dd = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: 1 }));
  const col = new THREE.Color(); for (let i = 0; i < N; i++) debris.setColorAt(i, col.set('#888'));
  const M = 400, pos = new Float32Array(M * 3), size = new Float32Array(M), alpha = new Float32Array(M), color = new Float32Array(M * 3);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); pg.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1)); pg.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const pm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: innerHeight * DPR * 0.5 } },
    vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC; uniform float uScale; void main(){ vA=aAlpha; vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/ -mv.z; gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying float vA; varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard; float a=smoothstep(0.5,0.1,r)*vA; gl_FragColor=vec4(vC,a); }' });
  const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  const pd = Array.from({ length: M }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 0.2, s1: 0.6, a: 0.6, c: new THREE.Color() }));
  let di = 0, pi = 0; const dummy = new THREE.Object3D();
  return {
    pm,
    burst(at, colors, n = 24, speed = 2.2, up = 2.5) {
      for (let k = 0; k < n; k++) {
        const d = dd[di]; di = (di + 1) % N; d.life = 1.6 + Math.random() * 0.6; d.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3));
        const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8); d.v.set(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s);
        d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); d.w.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6); d.s = 0.6 + Math.random() * 1.1;
        debris.setColorAt((di + N - 1) % N, col.set(view.sketch ? (Math.random() < 0.5 ? '#f2f0ea' : '#3a332c') : colors[k % colors.length]));
      }
      debris.instanceColor.needsUpdate = true;
    },
    dust(at, n = 20, spread = 0.6, color = '#c9b48a', s1 = 0.9, rise = 0.6, life = 1.4) {
      for (let k = 0; k < n; k++) {
        const d = pd[pi]; pi = (pi + 1) % M; d.life = d.max = life * (0.6 + Math.random() * 0.6);
        d.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * spread * 0.4, Math.random() * 0.1, (Math.random() - 0.5) * spread * 0.4));
        const a = Math.random() * Math.PI * 2; d.v.set(Math.cos(a) * spread, rise * (0.3 + Math.random()), Math.sin(a) * spread);
        d.s0 = 0.15 + Math.random() * 0.15; d.s1 = s1 * (0.6 + Math.random() * 0.6); d.a = 0.55 + Math.random() * 0.3; d.c.set(view.sketch ? '#b9b4aa' : color);
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        const d = dd[i];
        if (d.life > 0) { d.life -= dt; d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt); const gy = heightAt(d.p.x, d.p.z) + 0.02; if (d.p.y < gy) { d.p.y = gy; d.v.multiplyScalar(0.45); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.6); } d.r.addScaledVector(d.w, dt); }
        dummy.position.copy(d.p); dummy.rotation.set(d.r.x, d.r.y, d.r.z); dummy.scale.setScalar(d.life > 0 ? d.s * Math.min(1, d.life * 2) : 0); dummy.updateMatrix(); debris.setMatrixAt(i, dummy.matrix);
      }
      debris.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < M; i++) {
        const d = pd[i];
        if (d.life > 0) { d.life -= dt; d.v.multiplyScalar(1 - 1.8 * dt); d.p.addScaledVector(d.v, dt); const k = 1 - d.life / d.max; size[i] = d.s0 + (d.s1 - d.s0) * Math.sqrt(k); alpha[i] = d.a * (1 - k) * Math.min(1, k * 8); }
        else { alpha[i] = 0; size[i] = 0; }
        pos[i * 3] = d.p.x; pos[i * 3 + 1] = d.p.y; pos[i * 3 + 2] = d.p.z; color[i * 3] = d.c.r; color[i * 3 + 1] = d.c.g; color[i * 3 + 2] = d.c.b;
      }
      pg.attributes.position.needsUpdate = pg.attributes.aSize.needsUpdate = pg.attributes.aAlpha.needsUpdate = pg.attributes.aColor.needsUpdate = true;
    },
  };
})();
let shake = 0; const shakeOff = new THREE.Vector3();

// ============ markers ============
const ringGeo = new THREE.RingGeometry(0.3, 0.38, 32); ringGeo.rotateX(-Math.PI / 2);
const dotGeo = new THREE.CircleGeometry(0.1, 20); dotGeo.rotateX(-Math.PI / 2);
const mkMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false });
const hintMove = new THREE.InstancedMesh(dotGeo, mkMat(new THREE.Color(2.2, 1.7, 0.5)), 20); hintMove.renderOrder = 3; hintMove.count = 0; scene.add(hintMove);
const hintCap = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.5, 36).rotateX(-Math.PI / 2), mkMat(new THREE.Color(3, 0.35, 0.2)), 20); hintCap.renderOrder = 3; hintCap.count = 0; scene.add(hintCap);
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.52, 40).rotateX(-Math.PI / 2), mkMat(new THREE.Color(2.4, 1.9, 0.6))); selRing.visible = false; selRing.renderOrder = 3; scene.add(selRing);
const lastMk = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.48, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), mkMat(new THREE.Color(0.9, 0.55, 0.15))); m.visible = false; m.renderOrder = 2; scene.add(m); return m; });
const checkGlow = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.72, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.12, 0.06), transparent: true, opacity: 0.85, depthWrite: false })); checkGlow.visible = false;
const checkLight = new THREE.PointLight('#ff3018', 0, 3.5, 1.5); scene.add(checkLight); checkGlow.renderOrder = 4; scene.add(checkGlow);
const hintArrow = new THREE.Group(); scene.add(hintArrow);

// ============ pieces ============
const sqPos = (sq, y = 0) => new THREE.Vector3((sq % 9) - 4, y, ((sq / 9) | 0) - 4.5);
let pieces = new Array(90).fill(null);
const allPieces = new Set();
function spawn(code, sq) {
  const p = createPiece(code); p.sq = sq; const v = sqPos(sq); p.root.position.set(v.x, heightAt(v.x, v.z), v.z);
  p.baseYaw = p.side > 0 ? 0 : Math.PI; p.disc.rotation.y = view.side > 0 ? 0 : Math.PI;
  p.root.userData.piece = p; p.hit.userData.piece = p; scene.add(p.root); allPieces.add(p);
  p.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.side, NAMES[p.side][p.type]), depthTest: false, transparent: true })); p.label.scale.set(0.62, 0.62, 1); p.label.position.y = 1.0; p.label.renderOrder = 10; p.label.visible = view.labels; p.root.add(p.label);
  p.idle = Math.random() * 6;
  return p;
}
function removePiece(p) { scene.remove(p.root); allPieces.delete(p); p.root.traverse((o) => { if (o.userData.fadeMat) o.material.dispose(); }); }
function setupPieces() {
  for (const p of [...allPieces]) removePiece(p);
  pieces = new Array(90).fill(null);
  for (let s = 0; s < 90; s++) { const c = game.pos.board[s]; if (c) pieces[s] = spawn(c, s); }
}
// diff-sync visuals to the position (used by undo / load / network sync)
async function syncPieces(animated = true) {
  const want = game.pos.board, next = new Array(90).fill(null), pool = [];
  for (let s = 0; s < 90; s++) { const p = pieces[s]; if (!p) continue; if (want[s] === p.code) next[s] = p; else pool.push(p); }
  const jobs = [];
  for (let s = 0; s < 90; s++) {
    if (!want[s] || next[s]) continue;
    const i = pool.findIndex((p) => p.code === want[s]);
    if (i >= 0) { const p = pool.splice(i, 1)[0]; next[s] = p; p.sq = s; const to = sqPos(s); if (animated) { const from = p.root.position.clone(); jobs.push(tween(0.35, (k) => { p.root.position.lerpVectors(from, to, k); p.root.position.y = heightAt(p.root.position.x, p.root.position.z) + Math.sin(k * Math.PI) * 0.4; })); } else p.root.position.set(to.x, heightAt(to.x, to.z), to.z); }
    else { const p = spawn(want[s], s); next[s] = p; if (animated) { p.root.scale.setScalar(0.01); jobs.push(tween(0.35, (k) => p.root.scale.setScalar(Math.max(0.01, k)), ease.outBack)); } }
  }
  for (const p of pool) { if (animated) jobs.push(fadeOut(p, 0.3).then(() => removePiece(p))); else removePiece(p); }
  pieces = next;
  for (const p of allPieces) { p.holder.rotation.set(0, p.baseYaw, 0); p.root.rotation.set(0, 0, 0); }
  await Promise.all(jobs);
}
function setFade(p, a) {
  p.root.traverse((o) => {
    if (!o.isMesh || o === p.hit) return;
    if (!o.userData.fadeMat) { o.material = o.material.clone(); o.material.transparent = true; o.userData.fadeMat = true; if (o.material.onBeforeCompile) { /* keep sketch patch */ } }
    o.material.opacity = a; o.castShadow = a > 0.5;
  });
}
function fadeOut(p, dur) { return tween(dur, (k) => setFade(p, 1 - k)); }

// ============ piece animation ============
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function turn(p, yaw, dur = 0.18) { const a0 = p.holder.rotation.y, d = angDiff(a0, yaw); if (Math.abs(d) < 0.01) return Promise.resolve(); return tween(dur * Math.min(1.6, 0.5 + Math.abs(d) / 2), (k) => (p.holder.rotation.y = a0 + d * k)); }
function poseReset(p) {
  const P = p.parts;
  for (const n of ['legL', 'legR']) if (P[n]) P[n].rotation.x = 0;
  if (P.legs) P.legs.forEach((l) => (l.rotation.x = 0));
  if (P.upper) P.upper.position.y = 0.24;
  if (P.ele) { P.ele.rotation.x = 0; P.ele.position.y = 0; }
  if (P.mount) { P.mount.rotation.x = 0; P.mount.position.y = 0; }
}
function gait(p, phase, amp = 1) { // procedural locomotion per unit type
  const P = p.parts, s = Math.sin(phase), c = Math.cos(phase);
  if (P.legs) { // quadrupeds
    const fast = p.type === 4 || p.type === 5; const L = P.legs;
    if (fast) { L[0].rotation.x = s * 0.7 * amp; L[1].rotation.x = Math.sin(phase + 0.6) * 0.7 * amp; L[2].rotation.x = -Math.sin(phase + 0.3) * 0.7 * amp; L[3].rotation.x = -Math.sin(phase + 0.9) * 0.7 * amp; }
    else { L[0].rotation.x = s * 0.35 * amp; L[3].rotation.x = s * 0.35 * amp; L[1].rotation.x = -s * 0.35 * amp; L[2].rotation.x = -s * 0.35 * amp; }
    if (P.mount) { P.mount.position.y = Math.abs(c) * 0.04 * amp; P.mount.rotation.x = s * 0.06 * amp; }
    if (P.horse && p.type === 5) P.horse.position.y = Math.abs(c) * 0.03 * amp;
    if (P.ele) P.ele.position.y = Math.abs(s) * 0.02 * amp;
  }
  if (P.legL && p.type !== 4) { P.legL.rotation.x = s * 0.55 * amp; P.legR.rotation.x = -s * 0.55 * amp; if (P.upper) P.upper.position.y = 0.24 + Math.abs(c) * 0.012 * amp; if (P.armL) P.armL.rotation.x = -s * 0.35 * amp; }
  if (P.wheels) P.wheels.forEach((w) => (w.rotation.x = -phase * 0.9));
}
function travel(p, to, dur, opts = {}) { // move root from current to `to` (Vector3) with gait
  const from = p.root.position.clone(), dist = from.distanceTo(to), rate = opts.rate || (p.type === 4 ? 16 : p.type === 3 ? 7 : p.type === 5 || p.type === 6 ? 12 : 11);
  return tween(dur, (k, raw) => {
    p.root.position.lerpVectors(from, to, k);
    const g = heightAt(p.root.position.x, p.root.position.z);
    p.root.position.y = g + (opts.arc ? Math.sin(k * Math.PI) * opts.arc : 0);
    gait(p, raw * dist * rate, opts.arc ? 0.4 : 1);
  }, opts.ease || ease.inOut).then(() => poseReset(p));
}
function moveDur(p, dist) { const base = { 1: 0.5, 2: 0.45, 3: 0.75, 4: 0.55, 5: 0.32, 6: 0.42, 7: 0.42 }[p.type]; return Math.min(1.6, base + dist * (p.type === 5 ? 0.11 : p.type === 4 ? 0.12 : 0.16)); }
function playMoveSound(p) { const t = p.type; sfx.play(t === 4 ? 'hoof' : t === 5 ? 'roll' : t === 6 ? 'roll' : t === 3 ? 'stomp' : 'step'); if (t === 5) sfx.play('hoof'); }

async function killPiece(v, dir, strong = 1) {
  if (!v) return;
  const P = v.side > 0 ? PAL.red : PAL.black; const at = v.root.position.clone().add(new THREE.Vector3(0, 0.35, 0));
  FX.burst(at, [P.main, P.trim, P.dark, '#8d5c32', '#6c7078'], Math.round(18 * strong), 1.6 * strong, 2.2 * strong);
  FX.dust(v.root.position.clone(), 16, 0.7, '#cbb58a', 1.0);
  sfx.play('fall', 0.05);
  const axis = new THREE.Vector3(-dir.z, 0, dir.x).normalize(); const q0 = v.root.quaternion.clone(); const y0 = v.root.position.y;
  await tween(0.9, (k) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, -ease.out(Math.min(1, k * 1.6)) * 1.45); v.root.quaternion.copy(q0).premultiply(q); v.root.position.y = y0 - Math.max(0, k - 0.4) * 0.5; v.root.position.addScaledVector(dir, 0.006); setFade(v, 1 - Math.max(0, (k - 0.35) / 0.65)); }, ease.linear);
  removePiece(v);
}

async function animateMove(m, info) {
  const f = mvFrom(m), t = mvTo(m), p = pieces[f], victim = pieces[t];
  if (!p) return;
  pieces[f] = null; pieces[t] = p; p.sq = t;
  p.articulate(true);
  try { await animateMoveInner(p, victim, f, t); } finally { poseReset(p); p.holder.rotation.y = p.baseYaw; p.articulate(false); }
}
async function animateMoveInner(p, victim, f, t) {
  const from = sqPos(f), to = sqPos(t), d = to.clone().sub(from), dist = d.length(), dir = d.clone().normalize();
  const fwd = p.baseYaw, face = yawTo(d.x, d.z);
  if (!victim) {
    await turn(p, face); playMoveSound(p);
    await travel(p, to, moveDur(p, dist), { arc: p.type === 4 ? 0.3 : 0 });
    await turn(p, fwd);
    sfx.play('drum');
    return;
  }
  // ----- captures -----
  if (p.type === 6) { await trebuchetShot(p, victim, from, to, dir, dist, face); }
  else if (p.type === 5) { // chariot charge & ram
    await turn(p, face); sfx.play('roll'); sfx.play('hoof');
    await travel(p, to.clone().addScaledVector(dir, -0.55), Math.max(0.35, dist * 0.12 + 0.2), { ease: ease.in });
    sfx.play('crash'); sfx.play('clash'); shake = Math.max(shake, 0.12); emitEvent('impact');
    const kill = killPiece(victim, dir, 1.2);
    await travel(p, to, 0.25, { ease: ease.out }); await kill; await turn(p, fwd);
  } else if (p.type === 4) { // cavalry leap
    await turn(p, face); sfx.play('hoof');
    const mid = to.clone().addScaledVector(dir, -0.75);
    await travel(p, mid, Math.max(0.3, (dist - 0.75) * 0.14 + 0.2));
    sfx.play('whoosh');
    await travel(p, to, 0.45, { arc: 0.75, ease: ease.inOut });
    sfx.play('clash'); FX.dust(to.clone(), 14, 0.8); shake = Math.max(shake, 0.08); emitEvent('impact');
    await killPiece(victim, dir); await turn(p, fwd);
  } else if (p.type === 3) { // elephant stomp
    await turn(p, face); sfx.play('stomp');
    await travel(p, to.clone().addScaledVector(dir, -0.62), moveDur(p, dist - 0.62));
    const E = p.parts.ele; sfx.play('stomp');
    await tween(0.35, (k) => { E.rotation.x = 0.45 * k; E.position.y = 0.12 * k; }, ease.out);
    await tween(0.14, (k) => { E.rotation.x = 0.45 * (1 - k); E.position.y = 0.12 * (1 - k); }, ease.in);
    sfx.play('crash'); FX.dust(to.clone(), 26, 1.2, '#c8b07e', 1.2); shake = Math.max(shake, 0.18); emitEvent('impact');
    const kill = killPiece(victim, dir, 1.1);
    await travel(p, to, 0.45); await kill; await turn(p, fwd);
  } else { // soldiers / guards / general strike
    await turn(p, face); playMoveSound(p);
    await travel(p, to.clone().addScaledVector(dir, -0.5), moveDur(p, Math.max(0.2, dist - 0.5)));
    const A = p.parts.armR, W = p.parts.weapon; const a0 = A.rotation.x;
    if (p.type === 7) { // spear thrust
      sfx.play('thrust');
      await tween(0.16, (k) => { A.rotation.x = a0 - 1.2 * k; if (W) W.rotation.x = 0.35 + 1.2 * k; p.parts.upper.position.z = -0.05 * k; }, ease.out);
      sfx.play('clash'); emitEvent('impact');
      const kill = killPiece(victim, dir);
      await tween(0.25, (k) => { A.rotation.x = a0 - 1.2 * (1 - k); if (W) W.rotation.x = 0.35 + 1.2 * (1 - k); p.parts.upper.position.z = -0.05 * (1 - k); });
      await kill;
    } else { // sword slash
      await tween(0.18, (k) => { A.rotation.x = a0 - (2.6 + a0) * k; }, ease.out);
      sfx.play('clash'); sfx.play('thrust');
      await tween(0.14, (k) => { A.rotation.x = -2.6 + 2.9 * k; }, ease.in);
      emitEvent('impact'); const kill = killPiece(victim, dir);
      await tween(0.3, (k) => { A.rotation.x = 0.3 + (a0 - 0.3) * k; });
      await kill;
    }
    await travel(p, to, 0.3); await turn(p, fwd);
  }
  sfx.play('drum');
}

const projectile = (() => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), new THREE.MeshToonMaterial({ color: '#8f8a80', gradientMap: MAT.toon.gradientMap, emissive: new THREE.Color('#ff5a10'), emissiveIntensity: 0.0 })); m.castShadow = true; const o = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), MAT.outline); const fire = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 1.2, 0.25), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })); fire.userData.fire = true; g.add(m, o, fire); g.visible = false; scene.add(g); return g; })();
async function trebuchetShot(p, victim, from, to, dir, dist, face) {
  const P = p.parts, arm = P.arm, cw = P.cw, sling = P.sling; const r0 = arm.rotation.x;
  await turn(p, face, 0.3);
  sfx.play('thunk');
  const setArm = (a) => { arm.rotation.x = a; cw.rotation.x = -a; sling.rotation.x = -a + Math.sin(a * 3) * 0.2; };
  let released = false;
  const release = () => {
    released = true; sling.children.forEach((c) => (c.visible = false)); sling.visible = true;
    const sp = new THREE.Vector3(); sling.getWorldPosition(sp);
    flyStone(sp, to.clone().add(new THREE.Vector3(0, 0.35, 0)), dist, dir, victim);
  };
  let flight;
  const flyStone = (a, b, dd, dv, v) => {
    sfx.play('whoosh'); projectile.visible = true; projectile.position.copy(a);
    const apex = Math.max(a.y, b.y) + 1.3 + dd * 0.16, dur = 0.85 + dd * 0.06;
    let puff = 0;
    flight = tween(dur, (k) => {
      projectile.position.lerpVectors(a, b, k); projectile.position.y = a.y + (b.y - a.y) * k + 4 * (apex - Math.max(a.y, b.y)) * k * (1 - k);
      projectile.rotation.x += 0.25; projectile.rotation.z += 0.17;
      if (k - puff > 0.025) { puff = k; FX.dust(projectile.position.clone(), 2, 0.08, view.light === 'night' ? '#ffb070' : '#bdb3a2', 0.7, 0.05, 1.3); }
      projectile.children[2].visible = !view.sketch; projectile.children[2].scale.setScalar(1 + Math.sin(k * 60) * 0.15);
      if (k > 0.5 && !flight.mid) { flight.mid = true; emitEvent('projectile-mid'); }
    }, ease.linear).then(() => {
      projectile.visible = false; sfx.play('crash'); shake = Math.max(shake, 0.3);
      FX.burst(b.clone(), ['#9a958c', '#7d786e', '#5f5a52'], 26, 2.4, 3.2); FX.dust(b.clone().setY(heightAt(b.x, b.z) + 0.05), 34, 1.5, '#c8b385', 1.5, 0.9, 1.8);
      emitEvent('impact');
      return killPiece(v, dv, 1.4);
    });
  };
  await tween(0.6, (k) => { setArm(r0 + (-2.15 - r0) * k); if (!released && arm.rotation.x < -1.0) release(); }, ease.in);
  if (!released) release();
  sfx.play('thunk');
  await tween(0.25, (k) => setArm(-2.15 + 0.25 * Math.sin(k * Math.PI)), ease.linear);
  await flight;
  // reload & roll forward
  const reset = tween(0.7, (k) => setArm(-2.15 + (r0 + 2.15) * k)).then(() => sling.children.forEach((c) => (c.visible = true)));
  sfx.play('roll');
  await travel(p, to, moveDur(p, dist));
  await reset; await turn(p, p.baseYaw);
}

// ============ game state ============
const sfx = new Sfx();
const game = {
  pos: new Position(), mode: 'local', human: { 1: true, '-1': true }, aiLevel: 'medium', notes: [], result: null, busy: false,
  selected: -1, targets: [], chain: Promise.resolve(), clocks: { 1: 0, '-1': 0 }, aiPending: 0,
  net: null, netRole: null, mySide: RED, hostSide: RED, room: null,
};
const LV_NAME = { easy: '易', medium: '中', hard: '难' };
function sideName(s) { return s > 0 ? '红方' : '黑方'; }
function canControl(side) {
  if (game.result) return false;
  if (game.mode === 'online') return side === game.mySide && game.net && game.net.connected;
  return !!game.human[side];
}

function newGame(opts = {}) {
  cancelAI();
  game.pos = opts.pos || new Position();
  game.notes = rebuildNotes(game.pos); game.result = null; game.clocks = { 1: 0, '-1': 0 };
  clearSelection(); setupPieces(); updateLastMove(); updateCheck(); refreshHUD(); hideBanner();
  saveLocal();
  orientCamera(true);
  maybeAI();
}
function rebuildNotes(pos) { // replay to build Chinese notation list
  const p = new Position(pos.startFen); const out = [];
  for (const h of pos.hist) { out.push({ txt: p.notation(h.m), side: p.side }); p.makeMove(h.m); }
  return out;
}

function clearSelection() { game.selected = -1; game.targets = []; selRing.visible = false; hintMove.count = 0; hintCap.count = 0; const sp = game.selPiece; if (sp) { sp.root.position.y = heightAt(sp.root.position.x, sp.root.position.z); game.selPiece = null; } }
function select(sq) {
  clearSelection();
  const p = pieces[sq]; if (!p) return;
  game.selected = sq; game.selPiece = p; game.targets = game.pos.legalFrom(sq);
  const v = sqPos(sq); selRing.position.set(v.x, heightAt(v.x, v.z) + 0.02, v.z); selRing.visible = true;
  let a = 0, b = 0; const d = new THREE.Object3D();
  for (const m of game.targets) { const t = mvTo(m), w = sqPos(t); d.position.set(w.x, heightAt(w.x, w.z) + 0.085, w.z); d.updateMatrix(); if (game.pos.board[t]) hintCap.setMatrixAt(b++, d.matrix); else hintMove.setMatrixAt(a++, d.matrix); }
  hintMove.count = a; hintCap.count = b; hintMove.instanceMatrix.needsUpdate = hintCap.instanceMatrix.needsUpdate = true;
  sfx.play('select');
}
function updateLastMove() {
  const h = game.pos.hist[game.pos.hist.length - 1];
  if (!h || h.m < 0) { lastMk.forEach((m) => (m.visible = false)); return; }
  [mvFrom(h.m), mvTo(h.m)].forEach((s, i) => { const v = sqPos(s); lastMk[i].position.set(v.x, heightAt(v.x, v.z) + 0.015, v.z); lastMk[i].visible = true; });
}
function updateCheck() {
  const side = game.pos.side, inCheck = game.pos.inCheck(side);
  const k = game.pos.kingSq(side);
  if (inCheck && k >= 0) { const v = sqPos(k); checkGlow.position.set(v.x, heightAt(v.x, v.z) + 0.02, v.z); checkGlow.visible = true; checkLight.position.set(v.x, 0.9, v.z); } else checkGlow.visible = false;
  return inCheck;
}

function onSquareClick(sq) {
  sfx.ensure();
  if (game.busy || game.result) return;
  const side = game.pos.side; if (!canControl(side)) { if (game.mode === 'online' && !game.result) toast(game.net && game.net.connected ? '等待对手走棋' : '未连接对手'); return; }
  if (game.selected >= 0) {
    const m = game.targets.find((x) => mvTo(x) === sq);
    if (m !== undefined) { clearSelection(); submitMove(m, 'local'); return; }
  }
  const p = game.pos.board[sq];
  if (p && Math.sign(p) === side) { if (game.selected === sq) clearSelection(); else select(sq); }
  else if (game.selected >= 0) { clearSelection(); sfx.play('error'); }
}

function submitMove(m, source) {
  game.chain = game.chain.then(() => playMove(m, source)).catch((e) => console.error(e));
  return game.chain;
}
async function playMove(m, source) {
  if (game.result) return false;
  if (!game.pos.isLegal(m)) { console.warn('illegal move rejected', m, source); if (source === 'net') netReject(); return false; }
  const ply = game.pos.hist.length;
  if (source === 'local' && game.mode === 'online') game.net.sendMove(m, ply);
  const note = game.pos.notation(m), mover = game.pos.side;
  game.pos.makeMove(m); game.notes.push({ txt: note, side: mover });
  game.busy = true; refreshHUD(); clearSelection(); hideHint();
  try { await animateMove(m); } finally { game.busy = false; }
  updateLastMove();
  const st = game.pos.status();
  const inCheck = updateCheck();
  if (st.over) endGame(st);
  else if (inCheck) { showBanner('将 军！', sideName(mover) + '将军', 'check', 1800); sfx.play('check'); }
  refreshHUD(); saveLocal(); if (game.netRole === 'host') saveHost();
  maybeAI();
  return true;
}

const RESULT_TXT = { checkmate: '绝杀', stalemate: '困毙', repetition: '三次重复局面·和棋', nocapture: '六十回合未吃子·和棋', material: '双方无进攻子力·和棋', resign: '认输', draw: '议和', timeout: '超时' };
function endGame(st, silentNet) {
  game.result = st; cancelAI(); clearSelection();
  let title, sub;
  if (st.winner) { title = (st.result === 'checkmate' ? '绝 杀！' : st.result === 'stalemate' ? '困 毙！' : st.result === 'resign' ? '认 输' : '胜 负') ; sub = sideName(st.winner) + '胜 · ' + (RESULT_TXT[st.result] || ''); }
  else { title = '和 棋'; sub = RESULT_TXT[st.result] || '和棋'; }
  showBanner(title, sub, st.winner > 0 ? 'win-red' : st.winner < 0 ? 'win-black' : 'draw', 0, true);
  sfx.play('gong');
  if (st.winner) victoryCamera(st.winner);
  refreshHUD(); saveLocal(); if (game.netRole === 'host' && !silentNet) { saveHost(); netSync(); }
}

// ============ AI (Web Worker via Blob, main-thread fallback) ============
let worker = null, aiReq = 0;
function getWorker() {
  if (worker !== null) return worker;
  try {
    const src = $('#xq-engine-src').textContent + '\n;\n' + $('#xq-ai-src').textContent;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onerror = (e) => { console.warn('worker failed, fallback', e); worker = false; };
  } catch (e) { console.warn('no worker', e); worker = false; }
  return worker;
}
function askEngine(opts) {
  const id = ++aiReq; const posStr = game.pos.serialize();
  return new Promise((res) => {
    const w = getWorker();
    if (w) { const h = (e) => { if (e.data.id !== id) return; w.removeEventListener('message', h); res(e.data.result || null); }; w.addEventListener('message', h); w.postMessage({ id, pos: posStr, opts }); }
    else setTimeout(() => res(AIlib.search(Position.load(posStr), opts)), 30);
  }).then((r) => ({ id, r }));
}
function cancelAI() { aiReq++; game.aiPending = 0; setThinking(false); }
function maybeAI() {
  if (game.mode !== 'ai' || game.result) return;
  const side = game.pos.side; if (game.human[side]) return;
  const ply = game.pos.hist.length; setThinking(true); game.aiPending = 1;
  const t0 = performance.now();
  askEngine(AIlib.LEVELS[game.aiLevel]).then(async ({ id, r }) => {
    if (id !== aiReq || game.pos.hist.length !== ply || game.result) return;
    const elapsed = performance.now() - t0; if (elapsed < 450) await new Promise((z) => setTimeout(z, 450 - elapsed));
    if (id !== aiReq) return;
    setThinking(false); game.aiPending = 0;
    if (r && r.move) submitMove(r.move, 'ai');
  });
}
async function showHint() {
  if (game.busy || game.result || !canControl(game.pos.side)) return;
  toast('军师推演中…'); const ply = game.pos.hist.length;
  const { r } = await askEngine({ depth: 6, time: 900 });
  if (!r || !r.move || game.pos.hist.length !== ply) return;
  hideHint(); const a = sqPos(mvFrom(r.move)), b = sqPos(mvTo(r.move));
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 1.2), transparent: true, opacity: 0.85, depthWrite: false });
  const len = a.distanceTo(b); const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, Math.max(0.01, len - 0.3)), mat); const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), mat);
  shaft.position.set(0, 0, -len / 2 + 0.15 - 0.15); head.rotation.x = -Math.PI / 2; head.position.set(0, 0, -len + 0.15);
  hintArrow.add(shaft, head); hintArrow.position.set(a.x, 0.12, a.z); hintArrow.rotation.y = yawTo(b.x - a.x, b.z - a.z);
  toast('建议：' + game.pos.notation(r.move));
  select(mvFrom(r.move));
}
function hideHint() { hintArrow.clear(); }

// ============ undo ============
function undo() {
  if (game.busy) { if (!game.undoQueued) { game.undoQueued = true; game.chain.then(() => { game.undoQueued = false; undo(); }); } return; }
  if (game.mode === 'online') { netRequest('undo'); return; }
  cancelAI();
  let n = 1;
  if (game.mode === 'ai') { // undo back to the human's turn
    n = game.human[game.pos.side] ? 2 : 1;
    if (game.pos.hist.length < n) n = game.pos.hist.length;
  }
  if (!game.pos.hist.length) { toast('已是开局'); return; }
  doUndo(n);
  maybeAI();
}
function doUndo(n) {
  for (let i = 0; i < n && game.pos.hist.length; i++) { game.pos.unmakeMove(); game.notes.pop(); }
  game.result = null; hideBanner(); clearSelection(); hideHint();
  syncPieces(true); updateLastMove(); updateCheck(); refreshHUD(); saveLocal(); orientCamera(false, true);
  sfx.play('select');
}

// ============ camera ============
let camAnim = null;
function boardFitDistance(polar) {
  const fov = THREE.MathUtils.degToRad(camera.fov), aspect = camera.aspect, t = Math.tan(fov / 2);
  const depth = polar < 0.1 ? 12.0 * (innerWidth > 760 ? 1.12 : 1.0) : 11.6 * (0.78 + 0.22 * Math.cos(polar)), width = 11.2;
  const hudPad = innerWidth > 900 ? 1.3 : 1.04, vPad = innerWidth > 760 ? 1.12 : 1.1;
  return Math.max((depth * vPad) / (2 * t), (width * hudPad) / (2 * t * aspect)) * (polar < 0.1 ? 1.0 : 1.02);
}
function camGoal() {
  const polar = view.mode2d ? 0.0001 : camera.aspect < 0.8 ? 0.38 : 0.8, az = view.side > 0 ? 0 : Math.PI;
  const dist = boardFitDistance(polar); const tgt = new THREE.Vector3(0, 0, view.mode2d ? 0.15 * view.side : 0.55 * view.side);
  const pos = new THREE.Vector3(Math.sin(az) * Math.sin(polar) * dist, Math.cos(polar) * dist, Math.cos(az) * Math.sin(polar) * dist).add(tgt);
  return { pos, tgt };
}
function animateCamera(pos, tgt, dur = 1.0) {
  const p0 = camera.position.clone(), t0 = controls.target.clone(); const id = {}; camAnim = id;
  // interpolate in spherical coordinates around the target for a smooth swing
  const s0 = new THREE.Spherical().setFromVector3(p0.clone().sub(t0)), s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(tgt));
  const dTheta = angDiff(s0.theta, s1.theta);
  return tween(dur, (k) => { if (camAnim !== id) return; const tg = t0.clone().lerp(tgt, k); const s = new THREE.Spherical(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + dTheta * k); camera.position.setFromSpherical(s).add(tg); controls.target.copy(tg); });
}
function orientCamera(instant, keep) {
  const want = desiredViewSide(); const changed = want !== view.side; view.side = want;
  for (const p of allPieces) p.disc.rotation.y = view.side > 0 ? 0 : Math.PI;
  field.riverText.rotation.z = view.side > 0 ? 0 : Math.PI;
  if (keep && !changed) return;
  controls.autoRotate = false;
  const g = camGoal(); if (instant) { camera.position.copy(g.pos); controls.target.copy(g.tgt); camera.lookAt(g.tgt); } else animateCamera(g.pos, g.tgt, 1.1);
}
function desiredViewSide() {
  if (game.mode === 'online') return game.mySide;
  if (game.mode === 'ai') return game.human[RED] ? RED : BLACK;
  return RED;
}
function set2D(on) {
  view.mode2d = on; controls.enableRotate = !on; view.labels = on || view.labelsUser;
  for (const p of allPieces) p.label.visible = view.labels;
  $('#btn2d').textContent = on ? '3D 视角' : '2D 俯视'; $('#btn2d').classList.toggle('on', on);
  const g = camGoal(); animateCamera(g.pos, g.tgt, 0.9);
}
function victoryCamera(winner) {
  const k = game.pos.kingSq(winner); if (k < 0) return; const v = sqPos(k);
  const az = winner > 0 ? 0.6 : Math.PI + 0.6; const tgt = new THREE.Vector3(v.x, 1.25, v.z);
  const pos = tgt.clone().add(new THREE.Vector3(Math.sin(az) * 4.6, 1.9, Math.cos(az) * 4.6));
  animateCamera(pos, tgt, 1.8).then(() => { if (game.result) { controls.autoRotate = true; controls.autoRotateSpeed = 0.8; } });
}

// ============ picking ============
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; controls.autoRotate = false; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return; const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y; downAt = null;
  if (dx * dx + dy * dy > 64) return;
  const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const sq = pickSquare(); if (sq >= 0) onSquareClick(sq);
});
function pickSquare() {
  const hits = ray.intersectObjects([...allPieces].map((p) => p.hit), false);
  // prefer ground point if it lands on a legal target (so you can click an empty target behind a tall unit)
  const g = new THREE.Vector3(); let gsq = -1;
  if (ray.ray.intersectPlane(groundPlane, g)) { const c = Math.round(g.x + 4), r = Math.round(g.z + 4.5); if (c >= 0 && c < 9 && r >= 0 && r < 10 && Math.hypot(g.x - (c - 4), g.z - (r - 4.5)) < 0.5) gsq = r * 9 + c; }
  if (gsq >= 0 && game.selected >= 0 && game.targets.some((m) => mvTo(m) === gsq)) return gsq;
  if (hits.length) return hits[0].object.userData.piece.sq;
  return gsq;
}

// ============ HUD ============
function refreshHUD() {
  const side = game.pos.side;
  const ti = $('#turn'); ti.className = 'turn ' + (side > 0 ? 'red' : 'black'); ti.querySelector('.seal').textContent = side > 0 ? '帅' : '将';
  let label = sideName(side) + '走棋';
  if (game.mode === 'ai') label += game.human[side] ? '（你）' : '（AI）';
  if (game.mode === 'online') label += side === game.mySide ? '（你）' : '（对手）';
  if (game.result) label = '对局结束';
  ti.querySelector('.txt').textContent = label;
  $('#modeTag').textContent = game.mode === 'local' ? '本地双人' : game.mode === 'ai' ? '人机 · ' + LV_NAME[game.aiLevel] + ' · 执' + (game.human[RED] ? '红' : '黑') : '在线 · 执' + (game.mySide > 0 ? '红' : '黑') + (game.room ? ' · ' + game.room : '');
  // move list
  const ml = $('#moves'); let html = ''; const notes = game.notes; let i = 0, n = 1;
  if (notes.length && notes[0].side < 0) { html += `<li><b>${n++}.</b><span></span><span class="bk">${notes[0].txt}</span></li>`; i = 1; }
  for (; i < notes.length; i += 2) html += `<li><b>${n++}.</b><span class="rd">${notes[i].txt}</span><span class="bk">${notes[i + 1] ? notes[i + 1].txt : ''}</span></li>`;
  ml.innerHTML = html || '<li class="empty">尚无着法</li>'; ml.scrollTop = ml.scrollHeight;
  // captured trays
  const capR = [], capB = []; for (const h of game.pos.hist) if (h.cap) (h.cap > 0 ? capR : capB).push(h.cap);
  const chip = (c) => `<i class="chip ${c > 0 ? 'r' : 'b'}">${NAMES[Math.sign(c)][Math.abs(c)]}</i>`;
  $('#capByRed').innerHTML = capB.sort((a, b) => a - b).map(chip).join('') || '<em>—</em>';
  $('#capByBlack').innerHTML = capR.sort((a, b) => b - a).map(chip).join('') || '<em>—</em>';
  // buttons
  const online = game.mode === 'online';
  $('#btnUndo').textContent = online ? '请求悔棋' : '悔棋';
  $('#btnHint').style.display = online ? 'none' : '';
  $('#btnDraw').style.display = online ? '' : 'none'; $('#btnResign').style.display = online ? '' : 'none';
  $('#btnNew').textContent = online ? '再来一局' : '新局';
  $('#btnUndo').disabled = !game.pos.hist.length || (online && (!game.net || !game.net.connected));
}
function setThinking(on) { $('#thinking').classList.toggle('show', on); }
let bannerTimer = 0;
function showBanner(title, sub, cls, ms, buttons) {
  const b = $('#banner'); b.className = 'banner show ' + (cls || ''); b.querySelector('.t').textContent = title; b.querySelector('.s').textContent = sub || '';
  b.querySelector('.acts').style.display = buttons ? '' : 'none'; clearTimeout(bannerTimer); if (ms) bannerTimer = setTimeout(hideBanner, ms);
}
function hideBanner() { $('#banner').className = 'banner'; controls.autoRotate = false; }
let toastTimer = 0;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function fmtClock(s) { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function confirmDlg(text, okText = '同意', noText = '拒绝') {
  return new Promise((res) => { const d = $('#dialog'); d.querySelector('.msg').textContent = text; const ok = d.querySelector('.ok'), no = d.querySelector('.no'); ok.textContent = okText; no.textContent = noText; d.classList.add('show'); const done = (v) => { d.classList.remove('show'); ok.onclick = no.onclick = null; res(v); }; ok.onclick = () => done(true); no.onclick = () => done(false); });
}

// ============ persistence ============
function saveLocal() { if (game.mode === 'online') return; try { localStorage.setItem('xqbf-save', JSON.stringify({ pos: game.pos.serialize(), mode: game.mode, human: game.human, aiLevel: game.aiLevel, result: game.result })); } catch (e) { } }
function loadString(str) {
  const pos = Position.load(str);
  if (game.mode === 'online') { if (game.netRole !== 'host') { toast('联机对局中只有房主可以读档'); return false; } }
  newGame({ pos }); if (game.netRole === 'host') { saveHost(); netSync(); }
  const st = game.pos.status(); if (st.over) endGame(st);
  return true;
}

// ============ online play (host authoritative) ============
// optional self-hosted PeerJS broker: ?peerserver=host:port/path (default: PeerJS cloud)
function peerServerOptions() {
  const ps = params.get('peerserver'); if (!ps) return undefined;
  const m = /^(?:(wss?|https?):\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(ps); if (!m) return undefined;
  const secure = m[1] ? /s$/.test(m[1]) : !/^(localhost|127\.|192\.168\.|10\.)/.test(m[2]);
  return { host: m[2], port: m[3] ? +m[3] : secure ? 443 : 80, path: m[4] || '/', secure };
}
function shareSuffix() { return params.get('peerserver') ? '&peerserver=' + encodeURIComponent(params.get('peerserver')) : ''; }
function hostKey(code) { return 'xqbf-host-' + code; }
function saveHost() { if (game.netRole !== 'host') return; try { sessionStorage.setItem(hostKey(game.room), JSON.stringify({ pos: game.pos.serialize(), hostSide: game.hostSide, result: game.result })); } catch (e) { } }
function netState() { return { t: 'sync', pos: game.pos.serialize(), hostSide: game.hostSide, result: game.result }; }
function netSync() { if (game.net && game.netRole === 'host') game.net.send(netState()); }
function netReject() { if (game.netRole === 'host') netSync(); else if (game.net) game.net.send({ t: 'needSync' }); }
function setNetStatus(state, info) {
  const el = $('#netStatus'); const map = { connecting: ['连接中…', 'wait'], waiting: ['等待对手加入…', 'wait'], connected: ['已连接', 'ok'], reconnecting: ['连接中断，重新连接中…', 'wait'], 'opponent-left': ['对手已离开，等待重连…', 'bad'], error: [info && info.text || '连接失败', 'bad'], closed: ['已断开', 'bad'] };
  const [txt, cls] = map[state] || [state, 'wait']; el.textContent = txt; el.className = 'net ' + cls; el.style.display = game.mode === 'online' ? '' : 'none';
  const os = $('#onlineStatus'); if (os) { os.textContent = txt; os.className = 'ostatus ' + cls; }
  refreshHUD();
}
function startOnline(role, code, hostSide) {
  if (game.net) { game.net.close(); game.net = null; }
  cancelAI(); game.mode = 'online'; game.netRole = role; game.room = code;
  if (role === 'host') { game.hostSide = hostSide; game.mySide = hostSide; }
  const tr = new PeerTransport({ role, code, peerOptions: peerServerOptions() }); game.net = tr;
  tr.onStatus((s, info) => {
    setNetStatus(s, info);
    if (s === 'connected') { $('#onlineDlg').classList.remove('show'); closeMenu(); toast(role === 'host' ? '对手已加入！' : '已加入房间'); sfx.play('notify'); }
    if (s === 'opponent-left') toast('对手已离开，等待其重新连接…', 3500);
    if (s === 'reconnecting') toast('连接中断，正在重新连接…', 3000);
    if (s === 'error') { toast(info.text, 6000); $('#onlineErr').textContent = info.text; if (info.type === 'unavailable-id' && role === 'host' && !game.netResumed) { const nc = newRoomCode(); toast('房间码冲突，已换新码'); createRoom(game.hostSide, nc); } }
  });
  tr.onMessage(onNetMessage);
  tr.start();
  refreshHUD();
}
async function onNetMessage(msg) {
  const host = game.netRole === 'host';
  switch (msg.t) {
    case '_open': if (host) netSync(); else game.net.send({ t: 'hello' }); break;
    case 'hello': case 'needSync': if (host) netSync(); break;
    case 'sync': if (!host) applySync(msg); break;
    case 'move': {
      if (game.result) { netReject(); break; }
      const m = msg.m | 0;
      // wait for any running animation so ply bookkeeping is right
      await game.chain;
      if (msg.ply !== game.pos.hist.length || game.pos.side === game.mySide || !game.pos.isLegal(m)) { netReject(); break; }
      submitMove(m, 'net'); break;
    }
    case 'undoReq': { const ok = await confirmDlg('对手请求悔棋，是否同意？'); game.net.send({ t: 'undoAns', ok }); if (ok && host) hostUndo(-game.mySide); break; }
    case 'undoAns': if (msg.ok) { toast('对手同意悔棋'); if (host) hostUndo(game.mySide); } else toast('对手拒绝悔棋'); break;
    case 'drawOffer': { const ok = await confirmDlg('对手提议和棋，是否接受？', '接受', '拒绝'); game.net.send({ t: 'drawAns', ok }); if (ok && host) endGame({ over: true, result: 'draw', winner: 0 }); break; }
    case 'drawAns': if (msg.ok) { toast('对手接受和棋'); if (host) endGame({ over: true, result: 'draw', winner: 0 }); } else toast('对手拒绝和棋'); break;
    case 'resign': if (host) endGame({ over: true, result: 'resign', winner: game.mySide }); break;
    case 'rematchReq': { const ok = await confirmDlg(game.result ? '对手邀请再来一局（交换先后手），是否同意？' : '对手请求重新开局（交换先后手），是否同意？'); game.net.send({ t: 'rematchAns', ok }); if (ok && host) hostRematch(); break; }
    case 'rematchAns': if (msg.ok) { toast('对手同意，新局开始'); if (host) hostRematch(); } else toast('对手拒绝了新局'); break;
  }
}
function applySync(msg) {
  game.chain = game.chain.then(async () => {
    const pos = Position.load(msg.pos);
    game.hostSide = msg.hostSide; game.mySide = -msg.hostSide;
    const same = pos.serialize() === game.pos.serialize();
    if (!same) {
      // a single new move from the opponent? animate it nicely instead of snapping
      if (pos.hist.length === game.pos.hist.length + 1 && pos.serialize().startsWith(game.pos.serialize()) && !msg.result && !game.result) { await playMove(pos.hist[pos.hist.length - 1].m, 'sync'); }
      else { game.pos = pos; game.notes = rebuildNotes(pos); game.result = null; hideBanner(); clearSelection(); await syncPieces(true); updateLastMove(); updateCheck(); }
    }
    orientCamera(false, true);
    if (msg.result && !game.result) endGame(msg.result, true);
    if (!msg.result && game.result) { game.result = null; hideBanner(); }
    refreshHUD();
  });
}
function hostUndo(requesterSide) { // undo so that it is requesterSide's turn again, with their last move taken back
  game.chain = game.chain.then(() => { let n = game.pos.side === requesterSide ? 2 : 1; n = Math.min(n, game.pos.hist.length); if (n) doUndo(n); saveHost(); netSync(); });
}
function hostRematch() { game.hostSide = -game.hostSide; game.mySide = game.hostSide; newGame(); saveHost(); netSync(); toast('新局开始：你执' + (game.mySide > 0 ? '红' : '黑')); }
function netRequest(kind) {
  if (!game.net || !game.net.connected) { toast('尚未连接对手'); return; }
  if (kind === 'undo') { if (!game.pos.hist.length) return; game.net.send({ t: 'undoReq' }); toast('已发送悔棋请求'); }
  if (kind === 'draw') { game.net.send({ t: 'drawOffer' }); toast('已提议和棋'); }
  if (kind === 'rematch') { game.net.send({ t: 'rematchReq' }); toast('已发送新局邀请'); }
}
async function resign() {
  if (game.result) return;
  if (!(await confirmDlg('确定认输吗？', '认输', '取消'))) return;
  if (game.mode === 'online') { game.net.send({ t: 'resign' }); if (game.netRole === 'host') endGame({ over: true, result: 'resign', winner: -game.mySide }); else endGame({ over: true, result: 'resign', winner: -game.mySide }, true); }
  else endGame({ over: true, result: 'resign', winner: -game.pos.side });
}
function shareLink(code) { const base = location.href.split('#')[0].split('?')[0]; return base + '?room=' + code + shareSuffix(); }
function createRoom(hostSide, code) {
  code = code || newRoomCode(); game.netResumed = false;
  game.mode = 'online'; game.hostSide = hostSide; game.mySide = hostSide; game.netRole = 'host'; game.room = code;
  newGame(); startOnline('host', code, hostSide); saveHost();
  history.replaceState(null, '', '?room=' + code + '&host=1' + shareSuffix());
  $('#roomCode').textContent = code; $('#roomLink').value = shareLink(code); $('#onlineErr').textContent = '';
  $('#onlineDlg').classList.add('show');
}
function joinRoom(code) {
  code = normalizeRoomCode(code); if (code.length < 4) { $('#joinErr').textContent = '请输入正确的房间码'; return; }
  game.mode = 'online'; game.netRole = 'guest'; game.room = code; game.mySide = BLACK;
  newGame(); startOnline('guest', code);
  history.replaceState(null, '', '?room=' + code + shareSuffix());
  $('#roomCode').textContent = code; $('#roomLink').value = shareLink(code); $('#onlineErr').textContent = ''; $('#onlineDlg').classList.add('show'); $('#onlineDlg').classList.add('guest');
}
function leaveOnline() { if (game.net) { game.net.close(); game.net = null; } game.netRole = null; game.room = null; $('#netStatus').style.display = 'none'; history.replaceState(null, '', location.pathname); }

// ============ menu / buttons ============
function openMenu(tab) { $('#menu').classList.add('show'); if (tab) setTab(tab); $('#btnContinue').style.display = game.notes.length && !game.result ? '' : 'none'; }
function closeMenu() { $('#menu').classList.remove('show'); }
function setTab(t) { document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + t)); }
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => { seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); })));
const segVal = (id) => $('#' + id + ' button.on').dataset.v;
$('#startLocal').onclick = () => { sfx.ensure(); leaveOnline(); game.mode = 'local'; game.human = { 1: true, '-1': true }; closeMenu(); newGame(); };
$('#startAI').onclick = () => { sfx.ensure(); leaveOnline(); game.mode = 'ai'; const s = +segVal('aiSide'); game.human = { 1: s > 0, '-1': s < 0 }; game.aiLevel = segVal('aiLevel'); closeMenu(); newGame(); };
$('#createRoom').onclick = () => { sfx.ensure(); leaveOnline(); closeMenu(); createRoom(+segVal('hostSide')); };
$('#joinBtn').onclick = () => { sfx.ensure(); leaveOnline(); const c = $('#joinCode').value; closeMenu(); joinRoom(c); };
$('#btnContinue').onclick = closeMenu;
$('#copyCode').onclick = () => copy($('#roomCode').textContent, '房间码已复制');
$('#copyLink').onclick = () => copy($('#roomLink').value, '邀请链接已复制');
$('#onlineCancel').onclick = () => { $('#onlineDlg').classList.remove('show', 'guest'); leaveOnline(); game.mode = 'local'; game.human = { 1: true, '-1': true }; newGame(); openMenu('online'); };
$('#onlineHide').onclick = () => $('#onlineDlg').classList.remove('show');
function copy(text, msg) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg)).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(msg); } catch (e) { toast('复制失败，请手动复制'); } ta.remove(); }); }
$('#btnMenu').onclick = () => openMenu();
$('#btnUndo').onclick = undo;
$('#btnHint').onclick = showHint;
$('#btnNew').onclick = async () => { if (game.mode === 'online') { netRequest('rematch'); return; } if (game.notes.length && !game.result && !(await confirmDlg('放弃当前对局，开始新局？', '开始', '取消'))) return; newGame(); };
$('#btnDraw').onclick = () => netRequest('draw');
$('#btnResign').onclick = resign;
$('#btn2d').onclick = () => set2D(!view.mode2d);
$('#btnLight').onclick = () => { const ks = Object.keys(PRESETS); view.light = ks[(ks.indexOf(view.light) + 1) % ks.length]; view.sketch = false; localStorage.setItem('xqbf-light', view.light); applyLight(); };
$('#btnSketch').onclick = () => { view.sketch = !view.sketch; applyLight(); };
$('#btnLabels').onclick = () => { view.labelsUser = !view.labelsUser; view.labels = view.labelsUser || view.mode2d; for (const p of allPieces) p.label.visible = view.labels; $('#btnLabels').classList.toggle('on', view.labelsUser); };
$('#btnMute').onclick = () => { sfx.setMuted(!sfx.muted); $('#btnMute').textContent = sfx.muted ? '音效·关' : '音效·开'; sfx.play('select'); };
$('#btnMute').textContent = sfx.muted ? '音效·关' : '音效·开';
$('#btnSave').onclick = () => { $('#saveText').value = game.pos.serialize(); $('#saveErr').textContent = ''; $('#saveDlg').classList.add('show'); };
$('#saveCopy').onclick = () => copy($('#saveText').value, '棋局字符串已复制');
$('#saveLoad').onclick = () => { try { if (loadString($('#saveText').value)) { $('#saveDlg').classList.remove('show'); toast('读档成功'); } } catch (e) { $('#saveErr').textContent = '读档失败：' + e.message; } };
$('#saveClose').onclick = () => $('#saveDlg').classList.remove('show');
$('#bannerNew').onclick = () => { hideBanner(); if (game.mode === 'online') netRequest('rematch'); else newGame(); };
$('#bannerClose').onclick = () => hideBanner();
$('#btnPanel').onclick = () => document.body.classList.toggle('panels-open');
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } if (e.key === 'Escape') clearSelection(); });

// ============ resize / loop ============
function onResize() {
  const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); bloom.resolution.set(w, h); FX.pm.uniforms.uScale.value = h * DPR * 0.5;
  controls.maxDistance = Math.max(30, boardFitDistance(0.0001) * 1.4);
}
addEventListener('resize', () => { onResize(); if (!game.result) { const g = camGoal(); animateCamera(g.pos, g.tgt, 0.4); } });
const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0; window.__fps = 0;
function frame() {
  requestAnimationFrame(frame);
  const rdt = Math.min(clock.getDelta(), 0.05), dt = rdt * timeScale;
  fpsAcc += rdt; fpsN++; if (fpsAcc > 1) { window.__fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  simStep(dt);
  // clocks
  if (!game.result && game.notes.length && !game.busy && document.visibilityState === 'visible') { game.clocks[game.pos.side] += rdt; }
  if ((fpsN & 7) === 0) { $('#clockR').textContent = fmtClock(game.clocks[1]); $('#clockB').textContent = fmtClock(game.clocks[-1]); }
  camera.position.sub(shakeOff); shakeOff.set(0, 0, 0);
  controls.update();
  if (shake > 0.001) { shakeOff.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake); camera.position.add(shakeOff); shake *= Math.pow(0.02, dt); }
  composer.render();
}
function simStep(dt) {
  simTime += dt; updateTweens(); FX.update(dt);
  const t = simTime;
  field.water.uniforms.uTime.value = t;
  for (const f of field.flags) updateFlag(f, t, 1);
  for (const p of allPieces) for (const f of p.flags) updateFlag(f, t + p.idle, 0.8);
  for (const fl of field.flames) { fl.scale.set(1 + Math.sin(t * 13 + fl.position.x) * 0.08, 1 + Math.sin(t * 17 + fl.position.z) * 0.18, 1 + Math.cos(t * 11) * 0.08); }
  const pf = PRESETS[view.light].fire; field.lights.forEach((l, i) => (l.intensity = view.sketch ? 0 : pf * (0.85 + Math.sin(t * 9 + i * 2) * 0.1 + Math.sin(t * 23 + i) * 0.05)));
  checkLight.intensity = checkGlow.visible && !view.sketch ? 4 + Math.sin(t * 6) * 2 : 0;
  if (checkGlow.visible) { checkGlow.material.opacity = 0.6 + Math.sin(t * 6) * 0.3; checkGlow.scale.setScalar(1 + Math.sin(t * 6) * 0.06); }
  if (selRing.visible) { selRing.material.opacity = 0.7 + Math.sin(t * 5) * 0.25; if (game.selPiece && !game.busy) game.selPiece.root.position.y = heightAt(game.selPiece.root.position.x, game.selPiece.root.position.z) + 0.06 + Math.sin(t * 5) * 0.02; }
}

// ============ boot ============
onResize(); applyLight();
let restored = false;
const roomParam = params.get('room') ? normalizeRoomCode(params.get('room')) : null;
if (roomParam && params.get('host') === '1') {
  const saved = sessionStorage.getItem(hostKey(roomParam));
  if (saved) {
    const s = JSON.parse(saved); game.mode = 'online'; game.netRole = 'host'; game.hostSide = s.hostSide; game.mySide = s.hostSide; game.room = roomParam; game.netResumed = true;
    newGame({ pos: Position.load(s.pos) }); if (s.result) game.result = s.result;
    startOnline('host', roomParam, s.hostSide); $('#roomCode').textContent = roomParam; $('#roomLink').value = shareLink(roomParam); restored = true;
    toast('已恢复房间 ' + roomParam + '，等待对手重连');
  }
}
if (!restored && roomParam) { joinRoom(roomParam); restored = true; }
if (!restored) {
  try { const s = JSON.parse(localStorage.getItem('xqbf-save') || 'null'); if (s && s.pos && !params.has('fresh')) { game.mode = s.mode === 'ai' ? 'ai' : 'local'; game.human = s.mode === 'ai' ? s.human : { 1: true, '-1': true }; game.aiLevel = s.aiLevel || 'medium'; newGame({ pos: Position.load(s.pos) }); if (s.result) { game.result = s.result; } restored = true; } } catch (e) { }
  if (!restored) newGame();
  if (!params.has('nomenu')) openMenu('local');
}
setNetStatus(game.net ? game.net.state || 'connecting' : 'closed');
frame();
$('#loading').classList.add('done');

// test / debug hooks
window.__xq = {
  game, view, events, THREE, scene, camera, controls,
  get timeScale() { return timeScale; }, set timeScale(v) { timeScale = v; },
  play: (iccs) => submitMove(Position.parseIccs(iccs), 'local'),
  load: (s) => loadString(s), sketch: (on) => { view.sketch = on; applyLight(); }, light: (n) => { view.light = n; view.sketch = false; applyLight(); },
  set2D, closeMenu, openMenu, select: (iccs) => select(Position.parseIccs(iccs + 'a0') / 90 | 0), newGame, startOnline, createRoom, joinRoom,
  idle: () => game.chain, fps: () => window.__fps,
  advance: (sec, h = 1 / 60) => { for (let x = 0; x < sec; x += h) simStep(h); },
};
