// 程序化模型: 棋子兵种 + 沙盘战场. All geometry is built from Three.js primitives and baked
// (merged per animated part, vertex-coloured) to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PAL = {
  red: { main: '#c4341d', dark: '#7a1a0f', trim: '#e6ad2a', trim2: '#f8da7e', cloth: '#de4a2a', flag: '#c9231a', plume: '#e8321e', horse: '#8d4a25', horseDark: '#4f2713', disc: '#b52d19', discRim: '#e9b23a', pants: '#5a2116', ink: '#7a120a' },
  black: { main: '#226a6c', dark: '#0f3134', trim: '#7f6a45', trim2: '#a99064', cloth: '#2a6d68', flag: '#17191b', plume: '#20282a', horse: '#9a948a', horseDark: '#4d4944', disc: '#1b4b4f', discRim: '#b08a4c', pants: '#162a2b', ink: '#0b2224' },
};
export const COMMON = { skin: '#eac39b', wood: '#8d5c32', woodDark: '#5b391d', iron: '#5f646c', steel: '#cfd3d8', ivory: '#f2e7c9', elephant: '#8e8a86', elephantDark: '#6d6965', stone: '#a29c90', rope: '#cdb486', boot: '#2a1d16', straw: '#d8b65c' };

// ---------- shared materials (toon + ink outline + sketch hatching) ----------
export const SK = { uSketch: { value: 0 }, uPaper: { value: new THREE.Color('#f5f3ec') }, uInk: { value: new THREE.Color('#1c1712') }, uDpr: { value: 1 } };
function gradientMap(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; });
  const t = new THREE.DataTexture(data, steps.length, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
export const GRAD = gradientMap([95, 170, 225, 255]);
const HATCH_GLSL = `
#include <opaque_fragment>
if (uSketch > 0.5) {
  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  vec2 fc = gl_FragCoord.xy / uDpr;
  float d1 = abs(fract((fc.x + fc.y) / 5.0) - 0.5);
  float d2 = abs(fract((fc.x - fc.y) / 5.0) - 0.5);
  float l1 = 1.0 - smoothstep(0.08, 0.2, d1);
  float l2 = 1.0 - smoothstep(0.08, 0.2, d2);
  float h = 0.0;
  if (lum < 0.62) h = l1 * 0.75;
  if (lum < 0.38) h = max(h, l2 * 0.85);
  gl_FragColor = vec4(mix(uPaper, uInk, h), gl_FragColor.a);
}`;
export function patchMaterial(mat, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SK);
    sh.fragmentShader = 'uniform float uSketch; uniform vec3 uPaper; uniform vec3 uInk; uniform float uDpr;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', opts.noHatch ? '#include <color_fragment>\n if (uSketch > 0.5) { float gy = dot(diffuseColor.rgb, vec3(0.299,0.587,0.114)); diffuseColor.rgb = vec3(smoothstep(0.05, 0.5, gy) * 0.9 + 0.05); }' : '#include <color_fragment>\n if (uSketch > 0.5) diffuseColor.rgb = vec3(0.93);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n if (uSketch > 0.5) totalEmissiveRadiance *= 0.0;')
      .replace('#include <opaque_fragment>', opts.noHatch ? '#include <opaque_fragment>' : HATCH_GLSL);
  };
  mat.customProgramCacheKey = () => 'xq-sketch' + (opts.noHatch ? '-nh' : '');
  return mat;
}
export const MAT = {
  toon: patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD })),
  outline: new THREE.MeshBasicMaterial({ color: '#24170f', side: THREE.BackSide }),
};
MAT.outline.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, SK); sh.fragmentShader = 'uniform float uSketch; uniform vec3 uInk;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n if (uSketch > 0.5) gl_FragColor.rgb = uInk;'); };
MAT.outline.customProgramCacheKey = () => 'xq-outline';

// ---------- Kit: collects primitives, bakes into one vertex-coloured mesh + outline hull ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
let OUTLINE_W = 0.0105;
export function setOutlineWidth(w) { OUTLINE_W = w; }
function prep(geo) { let g = geo.index ? geo.toNonIndexed() : geo.clone(); g.deleteAttribute('uv'); g.clearGroups(); return g; }
export class Kit {
  constructor() { this.g = []; this.o = []; }
  add(geo, color, p, r, s, outline = true) {
    p = p || [0, 0, 0]; r = r || [0, 0, 0]; s = s || [1, 1, 1];
    const base = prep(geo);
    _m.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
    const g = base.clone().applyMatrix4(_m);
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.g.push(g);
    if (outline) {
      base.computeBoundingBox(); const bb = base.boundingBox, size = new THREE.Vector3(), ctr = new THREE.Vector3();
      bb.getSize(size); bb.getCenter(ctr);
      const f = [0, 1, 2].map((i) => 1 + (2 * OUTLINE_W) / Math.max(size.getComponent(i) * Math.abs(s[i]), 0.004));
      const o = base.clone(); o.deleteAttribute('normal');
      o.translate(-ctr.x, -ctr.y, -ctr.z); o.scale(f[0], f[1], f[2]); o.translate(ctr.x, ctr.y, ctr.z); o.applyMatrix4(_m);
      this.o.push(o);
    }
    return this;
  }
  box(w, h, d, col, p, r, ol) { return this.add(new THREE.BoxGeometry(w, h, d), col, p, r, [1, 1, 1], ol); }
  cyl(rt, rb, h, col, p, r, seg = 10, ol) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), col, p, r, [1, 1, 1], ol); }
  cone(rad, h, col, p, r, seg = 8, ol) { return this.add(new THREE.ConeGeometry(rad, h, seg), col, p, r, [1, 1, 1], ol); }
  sph(rad, col, p, s = [1, 1, 1], r = [0, 0, 0], seg = 10, ol) { return this.add(new THREE.SphereGeometry(rad, seg, Math.max(6, seg * 0.7 | 0)), col, p, r, s, ol); }
  hemi(rad, col, p, s = [1, 1, 1], r = [0, 0, 0]) { return this.add(new THREE.SphereGeometry(rad, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), col, p, r, s, true); }
  torus(R, t, col, p, r, ol) { return this.add(new THREE.TorusGeometry(R, t, 6, 18), col, p, r, [1, 1, 1], ol); }
  // beam between two points
  beam(a, b, th, col, ol = true, round = false) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length(), mid = A.clone().add(B).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); const e = new THREE.Euler().setFromQuaternion(q);
    const geo = round ? new THREE.CylinderGeometry(th / 2, th / 2, len, 6) : new THREE.BoxGeometry(th, len, th);
    return this.add(geo, col, mid.toArray(), [e.x, e.y, e.z], [1, 1, 1], ol);
  }
  bake(group, shadow = true) {
    if (!this.g.length) return group;
    const geo = mergeGeometries(this.g); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, MAT.toon); mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
    if (this.o.length) { const og = mergeGeometries(this.o); const om = new THREE.Mesh(og, MAT.outline); om.userData.outline = true; group.add(om); }
    return group;
  }
}

// Part tree helper: each named part is a Group with its own Kit, baked at the end.
class Rig {
  constructor() { this.root = new THREE.Group(); this.kits = new Map(); this.parts = {}; this.kits.set(this.root, new Kit()); }
  k(g = this.root) { return this.kits.get(g); }
  part(name, parent, pos = [0, 0, 0], rot = [0, 0, 0]) { const g = new THREE.Group(); g.position.set(...pos); g.rotation.set(...rot); g.name = name; (parent || this.root).add(g); this.kits.set(g, new Kit()); if (name) this.parts[name] = g; return g; }
  bake() { for (const [g, k] of this.kits) k.bake(g); return this; }
}

// ---------- unit builders (forward = -Z, ground at y=0) ----------
function humanoid(rig, parent, P, o = {}) {
  const S = o.scale || 1; const g = rig.part(o.name || 'body', parent, [0, 0, 0]); g.scale.setScalar(S);
  const legL = rig.part('legL', g, [-0.045, 0.24, 0]), legR = rig.part('legR', g, [0.045, 0.24, 0]);
  for (const L of [legL, legR]) { rig.k(L).box(0.058, 0.2, 0.066, P.pants, [0, -0.1, 0]).box(0.064, 0.055, 0.095, COMMON.boot, [0, -0.215, -0.012]); }
  const up = rig.part('upper', g, [0, 0.24, 0]); const k = rig.k(up);
  k.cyl(0.085, 0.125, 0.13, P.main, [0, 0.0, 0], 0, 12).cyl(0.122, 0.126, 0.02, P.trim, [0, -0.06, 0], 0, 12, false)
    .cyl(0.092, 0.092, 0.03, P.trim, [0, 0.075, 0], 0, 12)
    .cyl(0.105, 0.088, 0.17, o.armor || P.main, [0, 0.17, 0], 0, 12)
    .box(0.15, 0.12, 0.03, P.trim, [0, 0.18, -0.085]).box(0.05, 0.05, 0.02, P.trim2, [0, 0.19, -0.1])
    .sph(0.056, P.trim, [-0.112, 0.255, 0], [1, 0.72, 1.05]).sph(0.056, P.trim, [0.112, 0.255, 0], [1, 0.72, 1.05])
    .cyl(0.034, 0.038, 0.05, COMMON.skin, [0, 0.285, 0]).sph(0.066, COMMON.skin, [0, 0.352, 0])
    .box(0.012, 0.012, 0.01, '#2a1a10', [-0.024, 0.36, -0.06], 0, false).box(0.012, 0.012, 0.01, '#2a1a10', [0.024, 0.36, -0.06], 0, false);
  // helmet
  k.hemi(0.074, o.helm || P.trim, [0, 0.362, 0.004], [1, 1.05, 1.02]).cyl(0.082, 0.086, 0.016, P.dark, [0, 0.364, 0.004], 0, 14)
    .box(0.13, 0.05, 0.02, o.helm || P.trim, [0, 0.34, 0.06]);
  if (o.plume !== false) k.cone(0.012, 0.07, P.trim2, [0, 0.47, 0]).cone(o.bigPlume ? 0.05 : 0.032, o.bigPlume ? 0.16 : 0.09, P.plume, [0, o.bigPlume ? 0.56 : 0.515, o.bigPlume ? 0.02 : 0.0], [o.bigPlume ? 0.35 : 0.15, 0, 0], 7);
  if (o.cape) k.box(0.2, 0.36, 0.018, P.cloth, [0, 0.1, 0.1], [0.12, 0, 0]).box(0.2, 0.025, 0.02, P.trim, [0, 0.27, 0.085], [0.12, 0, 0]);
  if (o.wings) { k.box(0.012, 0.09, 0.05, P.trim2, [-0.08, 0.42, 0.01], [0, 0, 0.4]).box(0.012, 0.09, 0.05, P.trim2, [0.08, 0.42, 0.01], [0, 0, -0.4]); }
  const armL = rig.part('armL', up, [-0.128, 0.25, 0], [0, 0, 0.08]), armR = rig.part('armR', up, [0.128, 0.25, 0], [o.armR || -0.35, 0, -0.08]);
  for (const A of [armL, armR]) rig.k(A).cyl(0.03, 0.027, 0.2, o.armor || P.main, [0, -0.1, 0], 0, 8).cyl(0.032, 0.032, 0.05, P.trim, [0, -0.17, 0], 0, 8).sph(0.026, COMMON.skin, [0, -0.215, 0], [1, 1, 1], [0, 0, 0], 8);
  return { g, up, armL, armR, legL, legR };
}

function spear(rig, armR, P, len = 0.95) {
  const w = rig.part('weapon', armR, [0, -0.215, 0], [0.35, 0, 0]);
  rig.k(w).cyl(0.011, 0.011, len, COMMON.wood, [0, 0.22, 0], 0, 6).cone(0.026, 0.11, COMMON.steel, [0, 0.22 + len / 2 + 0.05, 0], 0, 4)
    .cyl(0.03, 0.03, 0.02, P.trim, [0, 0.22 + len / 2 - 0.015, 0], 0, 6).cone(0.035, 0.07, P.plume, [0, 0.22 + len / 2 - 0.045, 0], [Math.PI, 0, 0], 7);
  return w;
}
function sword(rig, armR, P, raised = true) {
  const w = rig.part('weapon', armR, [0, -0.215, 0], [raised ? -0.9 : 0.35, 0, 0]);
  rig.k(w).box(0.03, 0.06, 0.02, COMMON.woodDark, [0, 0.02, 0]).box(0.07, 0.015, 0.025, P.trim, [0, 0.055, 0]).box(0.026, 0.3, 0.008, COMMON.steel, [0, 0.21, 0]).cone(0.018, 0.04, COMMON.steel, [0, 0.38, 0], 0, 4);
  return w;
}

function buildSoldier(P) { // 兵/卒: spearman with small round shield
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const h = humanoid(rig, u, P, { scale: 1.3 });
  spear(rig, h.armR, P, 0.78);
  rig.k(h.armL).cyl(0.085, 0.085, 0.022, P.main, [-0.02, -0.17, -0.03], [0, 0, Math.PI / 2], 12).cyl(0.03, 0.03, 0.03, P.trim, [-0.035, -0.17, -0.03], [0, 0, Math.PI / 2], 8).torus(0.083, 0.008, P.trim, [-0.032, -0.17, -0.03], [0, Math.PI / 2, 0], false);
  return rig.bake();
}
function buildGuard(P) { // 仕/士: bodyguard with tower shield, raised sword, winged helmet
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const h = humanoid(rig, u, P, { scale: 1.32, wings: true, bigPlume: true, armor: P.dark, armR: -1.0 });
  sword(rig, h.armR, P, true);
  rig.k(h.armL).box(0.035, 0.32, 0.2, P.main, [-0.035, -0.17, -0.07]).box(0.04, 0.3, 0.035, P.trim, [-0.04, -0.17, -0.07]).box(0.04, 0.035, 0.18, P.trim, [-0.04, -0.17, -0.07])
    .sph(0.03, P.trim2, [-0.06, -0.17, -0.07]).box(0.04, 0.02, 0.2, P.trim, [-0.035, -0.02, -0.07], 0, false).box(0.04, 0.02, 0.2, P.trim, [-0.035, -0.32, -0.07], 0, false);
  return rig.bake();
}
function buildGeneral(P, glyph) { // 帅/将: general on a command platform with banner and war drum
  const rig = new Rig(); const k = rig.k();
  // platform (part of root so the unit can rotate separately)
  const u = rig.part('unit', null, [0, 0, 0]); const pk = rig.k(u);
  pk.box(0.62, 0.07, 0.62, COMMON.woodDark, [0, 0.035, 0]).box(0.5, 0.07, 0.5, COMMON.wood, [0, 0.105, 0]).box(0.52, 0.018, 0.52, P.trim, [0, 0.145, 0], 0, false)
    .box(0.42, 0.06, 0.03, P.main, [0, 0.105, -0.252], 0, false);
  for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) pk.cyl(0.018, 0.018, 0.16, P.trim, [x, 0.22, z], 0, 6).sph(0.024, P.trim2, [x, 0.31, z], [1, 1, 1], [0, 0, 0], 6);
  for (const [a, b] of [[[-0.25, 0.27, -0.25], [0.25, 0.27, -0.25]], [[-0.25, 0.27, 0.25], [0.25, 0.27, 0.25]], [[-0.25, 0.27, -0.25], [-0.25, 0.27, 0.25]], [[0.25, 0.27, -0.25], [0.25, 0.27, 0.25]]]) pk.beam(a, b, 0.014, P.dark, false);
  // war drum on stand
  pk.cyl(0.075, 0.075, 0.1, P.main, [-0.19, 0.25, 0.14], [Math.PI / 2, 0, 0.3], 12).cyl(0.078, 0.078, 0.012, COMMON.ivory, [-0.19, 0.25, 0.09], [Math.PI / 2, 0, 0.3], 12, false);
  const body = rig.part('fig', u, [0, 0.14, 0.02]);
  const h = humanoid(rig, body, P, { scale: 1.42, cape: true, bigPlume: true, armor: P.trim, helm: P.trim2, armR: -0.6 });
  sword(rig, h.armR, P, false);
  // banner pole + flag
  const pole = rig.part('pole', u, [0.22, 0.14, 0.2]);
  rig.k(pole).cyl(0.014, 0.016, 1.5, COMMON.woodDark, [0, 0.75, 0], 0, 6).cone(0.03, 0.08, P.trim2, [0, 1.54, 0], 0, 6).cyl(0.01, 0.01, 0.42, P.trim, [-0.21, 1.42, 0], [0, 0, Math.PI / 2], 6);
  const flag = makeFlag(0.42, 0.5, P, glyph); flag.position.set(-0.21, 1.17, 0); pole.add(flag); rig.parts.flag = flag;
  void k;
  return rig.bake();
}

// Flag plane with glyph texture, waved per-frame by updateFlag()
const flagTexCache = new Map();
export function flagTexture(P, glyph) {
  const key = P.flag + glyph; if (flagTexCache.has(key)) return flagTexCache.get(key);
  const c = document.createElement('canvas'); c.width = 128; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = P.flag; x.fillRect(0, 0, 128, 160);
  x.strokeStyle = P.trim2; x.lineWidth = 8; x.strokeRect(6, 6, 116, 148);
  // flame tooth border
  x.fillStyle = P.trim; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(i * 16, 160); x.lineTo(i * 16 + 8, 146); x.lineTo(i * 16 + 16, 160); x.fill(); }
  if (glyph) { x.fillStyle = P.trim2; x.font = 'bold 84px "KaiTi","STKaiti","Kaiti SC","楷体","Noto Serif CJK SC","Noto Sans CJK SC",serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(glyph, 64, 76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; flagTexCache.set(key, t); return t;
}
export function makeFlag(w, h, P, glyph) {
  const geo = new THREE.PlaneGeometry(w, h, 8, 4); geo.translate(w / 2, 0, 0);
  geo.userData.base = geo.attributes.position.array.slice();
  const mat = patchMaterial(new THREE.MeshToonMaterial({ map: flagTexture(P, glyph), side: THREE.DoubleSide, gradientMap: GRAD }), { noHatch: true });
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.userData.flag = true; m.userData.phase = Math.random() * 6; return m;
}
export function updateFlag(m, t, strength = 1) {
  const pos = m.geometry.attributes.position, base = m.geometry.userData.base, w = m.geometry.parameters.width;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], u = x / w;
    pos.array[i * 3 + 2] = Math.sin(t * 4 + x * 9 + m.userData.phase + y * 2) * 0.05 * u * strength;
    pos.array[i * 3 + 1] = y - u * u * 0.03 * strength;
  }
  pos.needsUpdate = true; m.geometry.computeVertexNormals();
}

function horse(rig, parent, P, o = {}) { // returns {g, legs[]} forward -Z
  const g = rig.part(o.name || 'horse', parent, o.pos || [0, 0, 0]); g.scale.setScalar(o.scale || 1);
  const k = rig.k(g); const H = o.color || P.horse, D = P.horseDark;
  k.sph(0.12, H, [0, 0.34, 0], [0.85, 0.85, 1.9]).sph(0.11, H, [0, 0.36, 0.12], [0.9, 0.9, 1.0])
    .beam([0, 0.38, -0.17], [0, 0.55, -0.27], 0.1, H).box(0.075, 0.08, 0.17, H, [0, 0.58, -0.33], [0.5, 0, 0])
    .box(0.06, 0.05, 0.06, D, [0, 0.545, -0.405], [0.5, 0, 0]).cone(0.014, 0.05, D, [-0.025, 0.65, -0.29], 0, 4).cone(0.014, 0.05, D, [0.025, 0.65, -0.29], 0, 4)
    .box(0.025, 0.2, 0.06, D, [0, 0.52, -0.22], [0.55, 0, 0]) // mane
    .beam([0, 0.38, 0.22], [0, 0.18, 0.3], 0.035, D) // tail
    .box(0.24, 0.025, 0.2, P.main, [0, 0.445, 0.0], 0, true).box(0.25, 0.1, 0.012, P.main, [0, 0.39, 0.0], [0, Math.PI / 2, 0], false)
    .box(0.012, 0.1, 0.2, P.main, [-0.105, 0.39, 0]).box(0.012, 0.1, 0.2, P.main, [0.105, 0.39, 0]).box(0.014, 0.02, 0.2, P.trim, [-0.106, 0.34, 0], 0, false).box(0.014, 0.02, 0.2, P.trim, [0.106, 0.34, 0], 0, false)
    .box(0.13, 0.02, 0.12, P.trim, [0, 0.462, 0.0], 0, false);
  const legs = [];
  for (const [x, z] of [[-0.055, -0.15], [0.055, -0.15], [-0.055, 0.15], [0.055, 0.15]]) {
    const L = rig.part('', g, [x, 0.33, z]); rig.k(L).cyl(0.026, 0.02, 0.3, H, [0, -0.15, 0], 0, 6).cyl(0.024, 0.026, 0.035, D, [0, -0.31, 0], 0, 6); legs.push(L);
  }
  return { g, legs };
}
function buildCavalry(P) { // 马: horse + armoured rider with halberd
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const mount = rig.part('mount', u, [0, 0, 0.02]); mount.scale.setScalar(1.22);
  const hs = horse(rig, mount, P); rig.parts.legs = hs.legs; rig.parts.horse = hs.g;
  const rider = rig.part('rider', hs.g, [0, 0.25, 0.03]);
  const h = humanoid(rig, rider, P, { scale: 0.92, armR: -0.7, bigPlume: true });
  h.legL.rotation.x = -1.2; h.legR.rotation.x = -1.2; h.legL.position.x = -0.085; h.legR.position.x = 0.085; h.legL.rotation.z = 0.35; h.legR.rotation.z = -0.35;
  const w = rig.part('weapon', h.armR, [0, -0.215, 0], [-0.25, 0, 0]);
  rig.k(w).cyl(0.01, 0.01, 0.8, COMMON.wood, [0, 0.2, 0], 0, 6).box(0.05, 0.11, 0.012, COMMON.steel, [0.02, 0.6, 0]).cone(0.018, 0.08, COMMON.steel, [0, 0.66, 0], 0, 4)
    .box(0.006, 0.08, 0.12, P.flag, [0, 0.5, 0.065], 0, false);
  return rig.bake();
}
function wheel(rig, parent, P, pos, R = 0.14, name = '') {
  const w = rig.part(name, parent, pos); const k = rig.k(w);
  k.torus(R, 0.018, COMMON.woodDark, [0, 0, 0], [0, Math.PI / 2, 0]).cyl(0.03, 0.03, 0.06, P.trim, [0, 0, 0], [0, 0, Math.PI / 2], 8);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; k.box(0.012, R * 2, 0.014, COMMON.wood, [0, 0, 0], [a, 0, 0], false); }
  return w;
}
function buildChariot(P) { // 车: horse-drawn war chariot carrying a ballista
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const body = rig.part('cart', u, [0, 0, 0.0]); body.scale.setScalar(1.0); const k = rig.k(body);
  k.box(0.32, 0.03, 0.3, COMMON.wood, [0, 0.18, 0]).box(0.32, 0.12, 0.022, P.main, [0, 0.25, -0.14]).box(0.022, 0.1, 0.3, P.main, [-0.16, 0.24, 0]).box(0.022, 0.1, 0.3, P.main, [0.16, 0.24, 0])
    .box(0.34, 0.02, 0.025, P.trim, [0, 0.315, -0.14], 0, false).box(0.025, 0.02, 0.3, P.trim, [-0.162, 0.295, 0], 0, false).box(0.025, 0.02, 0.3, P.trim, [0.162, 0.295, 0], 0, false)
    .cyl(0.02, 0.02, 0.44, COMMON.iron, [0, 0.14, 0.02], [0, 0, Math.PI / 2], 6)
    .sph(0.035, P.trim2, [0, 0.25, -0.155], [1, 1, 0.4]);
  // ballista
  const bal = rig.part('ballista', body, [0, 0.33, 0.02]); const b = rig.k(bal);
  b.box(0.05, 0.05, 0.36, COMMON.woodDark, [0, 0.03, 0]).cyl(0.02, 0.03, 0.08, COMMON.woodDark, [0, -0.02, 0.05], 0, 6)
    .beam([0, 0.04, -0.14], [-0.2, 0.06, -0.06], 0.022, COMMON.wood).beam([0, 0.04, -0.14], [0.2, 0.06, -0.06], 0.022, COMMON.wood)
    .beam([-0.2, 0.06, -0.06], [0, 0.065, 0.12], 0.006, COMMON.rope, false, true).beam([0.2, 0.06, -0.06], [0, 0.065, 0.12], 0.006, COMMON.rope, false, true)
    .box(0.07, 0.05, 0.05, P.trim, [0, 0.04, -0.15]).cyl(0.008, 0.008, 0.34, COMMON.wood, [0, 0.07, -0.03], [Math.PI / 2, 0, 0], 5).cone(0.018, 0.05, COMMON.steel, [0, 0.07, -0.22], [-Math.PI / 2, 0, 0], 4)
    .box(0.03, 0.06, 0.03, P.trim, [-0.2, 0.06, -0.06], 0, false).box(0.03, 0.06, 0.03, P.trim, [0.2, 0.06, -0.06], 0, false);
  rig.parts.wheels = [wheel(rig, body, P, [-0.2, 0.14, 0.02], 0.14, 'wheelL'), wheel(rig, body, P, [0.2, 0.14, 0.02], 0.14, 'wheelR')];
  // shafts + horse
  k.beam([-0.08, 0.2, -0.15], [-0.08, 0.3, -0.48], 0.016, COMMON.wood, true, true).beam([0.08, 0.2, -0.15], [0.08, 0.3, -0.48], 0.016, COMMON.wood, true, true);
  const hs = horse(rig, u, P, { pos: [0, 0, -0.36], scale: 0.8 }); rig.parts.legs = hs.legs; rig.parts.horse = hs.g;
  // driver
  const drv = rig.part('driver', body, [0, 0.0, 0.06]); const h = humanoid(rig, drv, P, { scale: 0.75, armR: -0.9 }); void h;
  return rig.bake();
}
function buildElephant(P) { // 相/象: armoured war elephant with howdah tower
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const e = rig.part('ele', u, [0, 0, 0.04]); e.scale.setScalar(1.12); const k = rig.k(e); const G = COMMON.elephant, GD = COMMON.elephantDark;
  k.sph(0.2, G, [0, 0.38, 0.02], [0.95, 0.9, 1.35]).sph(0.135, G, [0, 0.47, -0.25], [1, 1.05, 1])
    .sph(0.085, GD, [-0.12, 0.49, -0.22], [0.25, 1.2, 1]).sph(0.085, GD, [0.12, 0.49, -0.22], [0.25, 1.2, 1])
    .beam([0, 0.38, 0.28], [0, 0.22, 0.31], 0.02, GD)
    // caparison + armour
    .box(0.4, 0.2, 0.36, P.main, [0, 0.42, 0.02]).box(0.405, 0.03, 0.365, P.trim, [0, 0.32, 0.02], 0, false).box(0.41, 0.025, 0.37, P.trim, [0, 0.525, 0.02], 0, false)
    .box(0.12, 0.09, 0.012, P.trim, [0, 0.52, -0.37], [0.25, 0, 0]).sph(0.03, P.trim2, [0, 0.555, -0.375], [1, 1, 0.5])
    // tusks
    .beam([-0.06, 0.39, -0.33], [-0.08, 0.33, -0.45], 0.022, COMMON.ivory, true, true).beam([-0.08, 0.33, -0.45], [-0.075, 0.37, -0.52], 0.016, COMMON.ivory, true, true)
    .beam([0.06, 0.39, -0.33], [0.08, 0.33, -0.45], 0.022, COMMON.ivory, true, true).beam([0.08, 0.33, -0.45], [0.075, 0.37, -0.52], 0.016, COMMON.ivory, true, true);
  // trunk (animated)
  const tr = rig.part('trunk', e, [0, 0.43, -0.36], [0.15, 0, 0]);
  rig.k(tr).cyl(0.04, 0.05, 0.12, G, [0, -0.05, -0.02], [0.3, 0, 0], 8).cyl(0.032, 0.04, 0.12, G, [0, -0.15, -0.05], [0.15, 0, 0], 8).cyl(0.025, 0.032, 0.1, G, [0, -0.25, -0.05], [-0.25, 0, 0], 8).cyl(0.028, 0.022, 0.04, GD, [0, -0.31, -0.03], [-0.6, 0, 0], 8);
  // howdah tower
  const hw = rig.part('howdah', e, [0, 0.54, 0.04]); const w = rig.k(hw);
  w.box(0.28, 0.12, 0.26, COMMON.wood, [0, 0.06, 0]).box(0.29, 0.03, 0.27, P.trim, [0, 0.13, 0], 0, false);
  for (const [x, z] of [[-0.13, -0.12], [0.13, -0.12], [-0.13, 0.12], [0.13, 0.12]]) w.cyl(0.012, 0.012, 0.18, COMMON.woodDark, [x, 0.22, z], 0, 5);
  w.cone(0.24, 0.13, P.main, [0, 0.37, 0], [0, Math.PI / 4, 0], 4).cone(0.03, 0.08, P.trim2, [0, 0.47, 0], 0, 6).box(0.3, 0.02, 0.28, P.trim, [0, 0.31, 0], 0, false)
    .box(0.006, 0.07, 0.11, P.flag, [0, 0.55, 0.055], 0, false).cyl(0.006, 0.006, 0.18, COMMON.woodDark, [0, 0.52, 0], 0, 4, false);
  const legs = [];
  for (const [x, z] of [[-0.11, -0.13], [0.11, -0.13], [-0.11, 0.16], [0.11, 0.16]]) { const L = rig.part('', e, [x, 0.3, z]); rig.k(L).cyl(0.058, 0.064, 0.3, G, [0, -0.15, 0], 0, 8).cyl(0.07, 0.07, 0.03, P.trim, [0, -0.07, 0], 0, 8, false).cyl(0.066, 0.068, 0.02, COMMON.ivory, [0, -0.29, 0], 0, 8, false); legs.push(L); }
  rig.parts.legs = legs;
  return rig.bake();
}
function buildTrebuchet(P) { // 炮: counterweight trebuchet on wheels
  const rig = new Rig(); const u = rig.part('unit', null, [0, 0, 0]);
  const fr = rig.part('frame', u, [0, 0, -0.07]); fr.scale.setScalar(1.0); const k = rig.k(fr); const W = COMMON.wood, WD = COMMON.woodDark;
  k.box(0.04, 0.045, 0.66, WD, [-0.15, 0.09, 0]).box(0.04, 0.045, 0.66, WD, [0.15, 0.09, 0])
    .box(0.34, 0.04, 0.04, WD, [0, 0.09, -0.3]).box(0.34, 0.04, 0.04, WD, [0, 0.09, 0.3]).box(0.34, 0.03, 0.04, W, [0, 0.09, 0.0])
    .beam([-0.15, 0.1, -0.24], [-0.15, 0.58, 0], 0.035, W).beam([-0.15, 0.1, 0.24], [-0.15, 0.58, 0], 0.035, W)
    .beam([0.15, 0.1, -0.24], [0.15, 0.58, 0], 0.035, W).beam([0.15, 0.1, 0.24], [0.15, 0.58, 0], 0.035, W)
    .beam([-0.15, 0.3, -0.13], [0.15, 0.3, -0.13], 0.025, W).beam([-0.15, 0.3, 0.13], [0.15, 0.3, 0.13], 0.025, W)
    .beam([-0.15, 0.12, -0.2], [-0.15, 0.36, 0.1], 0.02, WD).beam([0.15, 0.12, -0.2], [0.15, 0.36, 0.1], 0.02, WD)
    .cyl(0.018, 0.018, 0.38, COMMON.iron, [0, 0.58, 0], [0, 0, Math.PI / 2], 8)
    .box(0.03, 0.07, 0.07, P.trim, [-0.15, 0.58, 0]).box(0.03, 0.07, 0.07, P.trim, [0.15, 0.58, 0])
    // side banners
    .box(0.006, 0.16, 0.13, P.main, [-0.175, 0.25, 0.0], 0, false).box(0.006, 0.16, 0.13, P.main, [0.175, 0.25, 0.0], 0, false)
    .box(0.007, 0.03, 0.135, P.trim, [-0.176, 0.32, 0], 0, false).box(0.007, 0.03, 0.135, P.trim, [0.176, 0.32, 0], 0, false)
    // winch wheel + stone pile
    .torus(0.07, 0.012, WD, [-0.19, 0.17, 0.2], [0, Math.PI / 2, 0]).torus(0.07, 0.012, WD, [0.19, 0.17, 0.2], [0, Math.PI / 2, 0])
    .sph(0.035, COMMON.stone, [0.05, 0.14, 0.24]).sph(0.03, COMMON.stone, [-0.03, 0.14, 0.26]).sph(0.028, COMMON.stone, [0.01, 0.17, 0.25]);
  rig.parts.wheels = [];
  for (const [x, z] of [[-0.19, -0.22], [0.19, -0.22], [-0.19, 0.22], [0.19, 0.22]]) rig.parts.wheels.push(wheel(rig, fr, P, [x, 0.07, z], 0.065));
  // arm: long end +Z (back) at rest, counterweight on the short end
  const arm = rig.part('arm', fr, [0, 0.58, 0], [0.86, 0, 0]); const a = rig.k(arm);
  a.box(0.04, 0.04, 0.78, W, [0, 0, 0.18]).box(0.05, 0.05, 0.05, P.trim, [0, 0, 0], 0, false).box(0.045, 0.045, 0.03, COMMON.iron, [0, 0, 0.5], 0, false)
    .box(0.05, 0.05, 0.03, COMMON.iron, [0, 0, -0.14], 0, false);
  const cw = rig.part('cw', arm, [0, 0, -0.2], [-0.86, 0, 0]); const c = rig.k(cw);
  c.cyl(0.006, 0.006, 0.08, COMMON.rope, [-0.05, -0.04, 0], 0, 4, false).cyl(0.006, 0.006, 0.08, COMMON.rope, [0.05, -0.04, 0], 0, 4, false)
    .box(0.16, 0.13, 0.14, P.main, [0, -0.14, 0]).box(0.17, 0.025, 0.15, P.trim, [0, -0.08, 0], 0, false).box(0.17, 0.025, 0.15, P.trim, [0, -0.2, 0], 0, false).sph(0.025, P.trim2, [0, -0.14, -0.072], [1, 1, 0.4]);
  // sling + stone at the long end
  const sl = rig.part('sling', arm, [0, 0, 0.57], [-0.86, 0, 0]);
  rig.k(sl).cyl(0.004, 0.004, 0.1, COMMON.rope, [0, -0.05, 0], 0, 4, false).sph(0.035, COMMON.stone, [0, -0.11, 0], [1, 1, 1], [0, 0, 0], 8);
  rig.parts.stone = sl;
  return rig.bake();
}

// ---------- glyph discs ----------
const discTexCache = new Map();
const FONT = '"KaiTi","STKaiti","Kaiti SC","楷体","BiauKai","Noto Serif CJK SC","Source Han Serif SC","Noto Sans CJK SC","Songti SC",serif';
export function discTexture(side, glyph) {
  const key = side + glyph; if (discTexCache.has(key)) return discTexCache.get(key);
  const P = side > 0 ? PAL.red : PAL.black, S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2); g.addColorStop(0, side > 0 ? '#f7e4bf' : '#e9e2c8'); g.addColorStop(1, side > 0 ? '#e6c58e' : '#cfc6a6');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.fill();
  x.strokeStyle = P.disc; x.lineWidth = 14; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 9, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = P.discRim; x.lineWidth = 4; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2); x.stroke();
  // decorative cloud-scroll ring (glyph lives on the medallion)
  x.strokeStyle = P.disc; x.globalAlpha = 0.35; x.lineWidth = 3;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, rx = S / 2 + Math.cos(a) * 78, ry = S / 2 + Math.sin(a) * 78; x.beginPath(); x.arc(rx, ry, 12, a, a + Math.PI * 1.4); x.stroke(); }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; discTexCache.set(key, t); return t;
}
export function labelTexture(side, glyph) { // round seal for 2D / label mode
  const key = 'L' + side + glyph; if (discTexCache.has(key)) return discTexCache.get(key);
  const P = side > 0 ? PAL.red : PAL.black, S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = side > 0 ? '#fbedd0' : '#eef0e4'; x.beginPath(); x.arc(128, 128, 126, 0, 7); x.fill(); x.strokeStyle = side > 0 ? '#b3200f' : '#123b40'; x.lineWidth = 16; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.stroke();
  x.strokeStyle = P.discRim; x.lineWidth = 4; x.beginPath(); x.arc(128, 128, 98, 0, 7); x.stroke();
  x.fillStyle = x.strokeStyle = side > 0 ? '#a81b0b' : '#0a2326'; x.font = 'bold 138px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 9; x.lineJoin = 'round'; x.strokeText(glyph, 128, 136); x.fillText(glyph, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; discTexCache.set(key, t); return t;
}
export const NAMES = { 1: ['', '帅', '仕', '相', '马', '车', '炮', '兵'], '-1': ['', '将', '士', '象', '马', '车', '炮', '卒'] };
const discSideGeo = new THREE.CylinderGeometry(0.4, 0.43, 0.07, 40, 1, true); discSideGeo.translate(0, 0.035, 0);
const discTopGeo = new THREE.CircleGeometry(0.4, 40); discTopGeo.rotateX(-Math.PI / 2); discTopGeo.translate(0, 0.0705, 0);
const discOutlineGeo = new THREE.CylinderGeometry(0.413, 0.443, 0.075, 40); discOutlineGeo.translate(0, 0.035, 0);
const medFaceGeo = new THREE.CircleGeometry(0.16, 32); medFaceGeo.translate(0, 0, 0.0135);
const medBackGeo = new THREE.CylinderGeometry(0.175, 0.175, 0.025, 32); medBackGeo.rotateX(Math.PI / 2);
const medOutGeo = new THREE.CylinderGeometry(0.188, 0.188, 0.04, 32); medOutGeo.rotateX(Math.PI / 2);
const medStandGeo = new THREE.BoxGeometry(0.1, 0.07, 0.06);
const medMatCache = new Map();
const discGeoCache = new Map();
function discGeos(type) {
  if (discGeoCache.has(type)) return discGeoCache.get(type);
  const g = type === 1;
  const mm = new THREE.Matrix4().compose(new THREE.Vector3(g ? -0.2 : 0.25, g ? 0.3 : 0.2, g ? 0.4 : 0.28), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.72, 0, 0)), new THREE.Vector3(1, 1, 1));
  const st = new THREE.Matrix4().compose(new THREE.Vector3(g ? -0.2 : 0.25, 0.1, g ? 0.42 : 0.3), new THREE.Quaternion(), new THREE.Vector3(1, g ? 2.6 : 1, 1));
  const strip = (geo) => { const x = geo.index ? geo.toNonIndexed() : geo.clone(); x.deleteAttribute('uv'); return x; };
  const side = mergeGeometries([strip(discSideGeo), strip(medBackGeo).applyMatrix4(mm), strip(medStandGeo).applyMatrix4(st)]);
  const outg = (geo) => { const x = strip(geo); x.deleteAttribute('normal'); return x; };
  const out = mergeGeometries([outg(discOutlineGeo), outg(medOutGeo).applyMatrix4(mm)]);
  const r = { side, out, medMatrix: mm }; discGeoCache.set(type, r); return r;
}
function medMat(side, glyph) { const k = side + glyph; if (!medMatCache.has(k)) medMatCache.set(k, patchMaterial(new THREE.MeshBasicMaterial({ map: labelTexture(side, glyph) }), { noHatch: true })); return medMatCache.get(k); }
const discMatCache = new Map();
function discMats(side, glyph) {
  const key = side + glyph; if (discMatCache.has(key)) return discMatCache.get(key);
  const P = side > 0 ? PAL.red : PAL.black;
  const r = { side: patchMaterial(new THREE.MeshToonMaterial({ color: P.disc, gradientMap: GRAD })), top: patchMaterial(new THREE.MeshToonMaterial({ map: discTexture(side, glyph), gradientMap: GRAD }), { noHatch: true }) };
  discMatCache.set(key, r); return r;
}

// ---------- piece factory ----------
function bakeStatic(root) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  const toon = [], out = [], flags = [];
  root.traverse((o) => {
    if (!o.isMesh) return; m.multiplyMatrices(inv, o.matrixWorld);
    if (o.userData.flag) { flags.push({ mesh: o, matrix: m.clone() }); return; }
    const g = o.geometry.clone().applyMatrix4(m); (o.material === MAT.outline ? out : toon).push(g);
  });
  const r = { toon: mergeGeometries(toon), out: out.length ? mergeGeometries(out) : null, flags };
  r.toon.computeBoundingSphere(); return r;
}
const templates = new Map();
const BUILDERS = { 1: buildGeneral, 2: buildGuard, 3: buildElephant, 4: buildCavalry, 5: buildChariot, 6: buildTrebuchet, 7: buildSoldier };
function collectParts(root) {
  const parts = {}; root.traverse((o) => { if (o.name) parts[o.name] = o; });
  // multi-part lists are found by structure
  return parts;
}
export function createPiece(code) {
  const side = Math.sign(code), type = Math.abs(code), P = side > 0 ? PAL.red : PAL.black, glyph = NAMES[side][type];
  const key = code;
  if (!templates.has(key)) { const rig = BUILDERS[type](P, glyph); templates.set(key, rig); }
  const tpl = templates.get(key);
  const unit = tpl.root.clone(true);
  // flags must not share geometry (waved per piece)
  unit.traverse((o) => { if (o.userData.flag) { o.geometry = o.geometry.clone(); o.geometry.userData.base = o.geometry.attributes.position.array.slice(); } });
  const root = new THREE.Group();
  const discG = new THREE.Group(); const dm = discMats(side, glyph);
  // base disc + tilted name medallion (front-right, leaning back toward the default camera); merged per type
  const DG = discGeos(type);
  const ds = new THREE.Mesh(DG.side, dm.side), dt = new THREE.Mesh(discTopGeo, dm.top), dol = new THREE.Mesh(DG.out, MAT.outline), mf = new THREE.Mesh(medFaceGeo, medMat(side, glyph));
  mf.matrixAutoUpdate = false; mf.matrix.copy(DG.medMatrix);
  ds.receiveShadow = dt.receiveShadow = true; ds.castShadow = true; dol.userData.outline = true;
  discG.add(ds, dt, dol, mf); root.add(discG);
  // static (idle) version: whole rig merged into 2 draw calls; the articulated rig is shown only while animating
  if (!tpl.static) tpl.static = bakeStatic(tpl.root);
  const stat = new THREE.Group(); const sm = new THREE.Mesh(tpl.static.toon, MAT.toon); sm.castShadow = true; sm.receiveShadow = true; stat.add(sm);
  if (tpl.static.out) { const so = new THREE.Mesh(tpl.static.out, MAT.outline); so.userData.outline = true; stat.add(so); }
  for (const f of tpl.static.flags) { const fm = new THREE.Mesh(f.mesh.geometry.clone(), f.mesh.material); fm.geometry.userData.base = fm.geometry.attributes.position.array.slice(); fm.userData.flag = true; fm.userData.phase = Math.random() * 6; fm.castShadow = true; fm.matrixAutoUpdate = false; fm.matrix.copy(f.matrix); stat.add(fm); }
  unit.visible = false;
  const holder = new THREE.Group(); holder.position.y = 0.07; holder.scale.setScalar(1.12); holder.add(unit, stat); root.add(holder);
  if (side < 0) holder.rotation.y = Math.PI;
  // hit proxy
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.5; hit.userData.hit = true; root.add(hit);
  const parts = collectParts(unit);
  // structural lists (legs/wheels): find by matching template structure
  const lists = {};
  const mapList = (arr) => arr && arr.map((g) => { const path = []; let o = g; while (o && o !== tpl.root) { path.unshift(o.parent.children.indexOf(o)); o = o.parent; } let t = unit; for (const i of path) t = t.children[i]; return t; });
  lists.legs = mapList(tpl.parts.legs); lists.wheels = mapList(tpl.parts.wheels);
  const flag = []; holder.traverse((o) => { if (o.userData.flag) flag.push(o); });
  const piece = { root, holder, unit, stat, disc: discG, discTop: dt, hit, parts: Object.assign(parts, lists), flags: flag, code, side, type };
  piece.articulate = (on) => { unit.visible = on; stat.visible = !on; };
  return piece;
}

// ---------- terrain / battlefield ----------
export function heightAt(x, z) { // ground height used by piece movement (river dip + bridges)
  const az = Math.abs(z);
  if (az < 0.5) {
    for (const bx of [-3, 3]) if (Math.abs(x - bx) < 0.3) return 0.1 * Math.cos((z / 0.62) * Math.PI / 2) + 0.02;
    if (az < 0.42) return -0.07 * Math.cos((az / 0.42) * Math.PI / 2);
  }
  return 0;
}
function sandHeight(x, z) {
  const az = Math.abs(z);
  let h = 0;
  if (az < 0.47) { const t = Math.max(0, (az - 0.22) / 0.25); h = -0.13 * (1 - t * t * (3 - 2 * t)); }
  // gentle dunes in the margins
  const ex = Math.max(0, Math.abs(x) - 4.25), ez = Math.max(0, Math.abs(z) - 4.75);
  if (ex > 0 || ez > 0) h += Math.min(0.06, (ex + ez) * 0.08) * (0.6 + 0.4 * Math.sin(x * 3.1 + z * 2.3));
  return h;
}
function noiseCanvas(w, h, base, spread, fibers) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  const id = x.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * spread; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  x.putImageData(id, 0, 0);
  if (fibers) { x.globalAlpha = 0.06; x.strokeStyle = '#8a7a5a'; for (let i = 0; i < fibers; i++) { x.lineWidth = Math.random() * 1.2; x.beginPath(); const sx = Math.random() * w, sy = Math.random() * h; x.moveTo(sx, sy); x.bezierCurveTo(sx + Math.random() * 40 - 20, sy + Math.random() * 40 - 20, sx + Math.random() * 60 - 30, sy + Math.random() * 60 - 30, sx + Math.random() * 80 - 40, sy + Math.random() * 80 - 40); x.stroke(); } }
  return c;
}
export function buildBattlefield(scene) {
  const out = { fires: [], flames: [], lights: [], flags: [], water: null, sketchOnly: [], colorOnly: [] };
  const sandMat = patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD }));
  // rice-paper table
  const paperTex = new THREE.CanvasTexture(noiseCanvas(512, 512, '#ece3cf', 14, 500)); paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping; paperTex.repeat.set(6, 6); paperTex.colorSpace = THREE.SRGBColorSpace;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), patchMaterial(new THREE.MeshToonMaterial({ map: paperTex, gradientMap: GRAD })));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.36; table.receiveShadow = true; scene.add(table);
  // wooden sand-table frame
  const ow0 = OUTLINE_W; OUTLINE_W = 0.03; const fk = new Kit(); const FW = 5.05, FD = 5.6, FH = 0.42;
  fk.box(FW * 2 + 0.3, FH, 0.3, '#6e4425', [0, -0.15, -FD - 0.15]).box(FW * 2 + 0.3, FH, 0.3, '#6e4425', [0, -0.15, FD + 0.15])
    .box(0.3, FH, FD * 2, '#6e4425', [-FW - 0.15, -0.15, 0]).box(0.3, FH, FD * 2, '#6e4425', [FW + 0.15, -0.15, 0])
    .box(FW * 2 + 0.36, 0.04, 0.36, '#c49a4a', [0, 0.07, -FD - 0.15], 0, false).box(FW * 2 + 0.36, 0.04, 0.36, '#c49a4a', [0, 0.07, FD + 0.15], 0, false)
    .box(0.36, 0.04, FD * 2 + 0.36, '#c49a4a', [-FW - 0.15, 0.07, 0], 0, false).box(0.36, 0.04, FD * 2 + 0.36, '#c49a4a', [FW + 0.15, 0.07, 0], 0, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fk.box(0.42, 0.5, 0.42, '#5a361c', [sx * (FW + 0.15), -0.1, sz * (FD + 0.15)]).sph(0.12, '#c49a4a', [sx * (FW + 0.15), 0.2, sz * (FD + 0.15)], [1, 0.6, 1]);
  const frame = fk.bake(new THREE.Group()); scene.add(frame); OUTLINE_W = ow0;
  // sand surface with river channel
  const sg = new THREE.PlaneGeometry(FW * 2, FD * 2, 101, 112); sg.rotateX(-Math.PI / 2);
  const p = sg.attributes.position, col = new Float32Array(p.count * 3), cA = new THREE.Color('#d9c08a'), cB = new THREE.Color('#c8a86c'), cW = new THREE.Color('#8c7a52'), cG = new THREE.Color('#9aa461'), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = sandHeight(x, z); p.setY(i, h);
    const n = Math.sin(x * 7.3 + z * 3.1) * Math.sin(z * 5.7 - x * 2.2) * 0.5 + 0.5;
    tmp.copy(cA).lerp(cB, n * 0.5 + Math.random() * 0.15);
    const az = Math.abs(z); if (az < 0.7) tmp.lerp(cW, Math.max(0, 1 - (az - 0.2) / 0.5) * 0.7);
    if (az > 0.42 && az < 0.85) tmp.lerp(cG, Math.max(0, 0.5 - Math.abs(az - 0.62) * 2.2) * (0.5 + 0.5 * Math.sin(x * 4)));
    if (Math.abs(x) > 4.3 || az > 4.8) tmp.lerp(cG, 0.25 * n);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3)); sg.computeVertexNormals();
  const sand = new THREE.Mesh(sg, sandMat); sand.receiveShadow = true; scene.add(sand); out.sand = sand;
  // animated river
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, uniforms: Object.assign({ uTime: { value: 0 }, uDeep: { value: new THREE.Color('#2f6f86') }, uShallow: { value: new THREE.Color('#6fb3b8') }, uLight: { value: 1 } }, SK),
    vertexShader: 'varying vec2 vUv; varying vec3 vW; uniform float uTime; void main(){ vUv=uv; vec3 p=position; p.z += sin(p.x*3.0+uTime*1.5)*0.004; vec4 w=modelMatrix*vec4(p,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uLight; uniform float uSketch; uniform vec3 uPaper; uniform vec3 uInk; varying vec2 vUv; varying vec3 vW;
      void main(){ float edge = abs(vUv.y-0.5)*2.0; vec3 c = mix(uDeep, uShallow, smoothstep(0.2,1.0,edge));
        float f = sin(vW.x*6.0 - uTime*2.2 + sin(vW.z*20.0+uTime)*1.5)*0.5+0.5; float f2 = sin(vW.x*13.0 - uTime*3.1 + vW.z*9.0)*0.5+0.5;
        float streak = smoothstep(0.86,1.0,f*f2); c += streak*0.35; c *= uLight;
        float a = 0.88 - smoothstep(0.8,1.0,edge)*0.6;
        if (uSketch > 0.5) { float w = abs(fract((vW.z*6.0 + sin(vW.x*5.0 - uTime*1.2)*0.25))-0.5); float line = 1.0 - smoothstep(0.03,0.08,w); c = mix(uPaper, uInk, line*0.8 + streak*0.4); a = 1.0; }
        gl_FragColor = vec4(c, a); }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(FW * 2, 0.9, 60, 4), waterMat); water.rotation.x = -Math.PI / 2; water.position.y = -0.065; water.renderOrder = 1; scene.add(water); out.water = waterMat;
  // grid lines (ink), slightly overshooting like a sketch
  const gl = new Kit(); const LW = 0.034, Y = 0.006, ink = '#2a1d14';
  const line = (x1, z1, x2, z2, w = LW) => { const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz); gl.add(new THREE.BoxGeometry(w, 0.004, len), ink, [(x1 + x2) / 2, Y, (z1 + z2) / 2], [0, Math.atan2(dx, dz), 0], [1, 1, 1], false); };
  for (let r = 0; r < 10; r++) line(-4.12, r - 4.5, 4.12, r - 4.5);
  for (let c = 0; c < 9; c++) { const x = c - 4; if (c === 0 || c === 8) line(x, -4.62, x, 4.62); else { line(x, -4.62, x, -0.5); line(x, 0.5, x, 4.62); } }
  // outer border (double line)
  for (const [w, o] of [[0.06, 0.28]]) { line(-4 - o, -4.5 - o, 4 + o, -4.5 - o, w); line(-4 - o, 4.5 + o, 4 + o, 4.5 + o, w); line(-4 - o, -4.5 - o, -4 - o, 4.5 + o, w); line(4 + o, -4.5 - o, 4 + o, 4.5 + o, w); }
  // palace diagonals
  for (const z0 of [-4.5, 2.5]) { line(-1, z0, 1, z0 + 2, 0.028); line(1, z0, -1, z0 + 2, 0.028); }
  // position marks (炮/兵 corners)
  const mark = (c, r) => { const x = c - 4, z = r - 4.5, a = 0.09, b = 0.25; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue; line(x + sx * a, z + sz * a, x + sx * b, z + sz * a, 0.026); line(x + sx * a, z + sz * a, x + sx * a, z + sz * b, 0.026); } };
  for (const [c, r] of [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]]) mark(c, r);
  const grid = gl.bake(new THREE.Group(), false); grid.children[0].material = new THREE.MeshBasicMaterial({ color: ink, polygonOffset: true, polygonOffsetFactor: -2 }); scene.add(grid);
  // 楚河 汉界 calligraphy on the water
  const tc = document.createElement('canvas'); tc.width = 1024; tc.height = 128; const tx = tc.getContext('2d');
  tx.font = 'bold 96px ' + FONT; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillStyle = 'rgba(250,240,215,0.92)'; tx.shadowColor = 'rgba(20,30,30,0.6)'; tx.shadowBlur = 6;
  tx.fillText('楚  河', 256, 68); tx.fillText('漢  界', 768, 68);
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace; tt.anisotropy = 8;
  const txt = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 0.62), new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthWrite: false, opacity: 0.95 }));
  txt.rotation.x = -Math.PI / 2; txt.position.set(0, -0.05, 0); txt.renderOrder = 2; scene.add(txt); out.riverText = txt;
  // stone bridges on files 二/八 (x = ±3)
  const bk = new Kit(); const ST = '#b4ad9f', STD = '#8d877b';
  for (const bx of [-3, 3]) {
    for (let i = 0; i < 9; i++) { const z0 = -0.6 + i * 0.15, h = heightAt(bx, z0) + 0.0; bk.box(0.56, 0.06, 0.16, i % 2 ? ST : '#a9a294', [bx, h - 0.02, z0], [(-0.6 + i * 0.15) * 0.25, 0, 0]); }
    for (const sx of [-0.3, 0.3]) { for (let i = 0; i < 8; i++) { const z0 = -0.52 + i * 0.15, h = heightAt(bx, z0); bk.box(0.05, 0.05, 0.13, STD, [bx + sx, h + 0.05, z0]); } bk.box(0.07, 0.12, 0.07, STD, [bx + sx, 0.05, -0.62]).box(0.07, 0.12, 0.07, STD, [bx + sx, 0.05, 0.62]).sph(0.04, '#d6cfbf', [bx + sx, 0.13, -0.62]).sph(0.04, '#d6cfbf', [bx + sx, 0.13, 0.62]); }
    bk.box(0.5, 0.1, 0.05, STD, [bx, -0.06, 0], 0); // arch keystone under deck
    bk.cyl(0.2, 0.2, 0.5, '#7d776c', [bx, -0.17, 0], [0, 0, Math.PI / 2], 12);
  }
  scene.add(bk.bake(new THREE.Group()));
  // palaces: palisade, flagpoles, braziers
  const pk = new Kit(); const WOOD = '#7a4f2b';
  const stake = (x, z) => pk.cyl(0.03, 0.035, 0.24, WOOD, [x, 0.1, z], [0, 0, (Math.random() - 0.5) * 0.12], 5).cone(0.035, 0.06, '#5b391d', [x, 0.25, z], 0, 5);
  const gap = (v, lines) => lines.some((L) => Math.abs(v - L) < 0.17);
  for (const [zF, zB, side] of [[-2.05, -4.95, -1], [2.05, 4.95, 1]]) {
    for (let x = -1.45; x <= 1.451; x += 0.11) { if (!gap(x, [-1, 0, 1])) stake(x, zF); if (!gap(x, [-1, 0, 1])) stake(x, zB); }
    const z1 = Math.min(zF, zB), z2 = Math.max(zF, zB);
    for (let z = z1; z <= z2 + 0.001; z += 0.11) { const ranks = side < 0 ? [-4.5, -3.5, -2.5] : [2.5, 3.5, 4.5]; if (!gap(z, ranks)) { stake(-1.45, z); stake(1.45, z); } }
    pk.beam([-1.45, 0.17, zF], [-0.17 - 0.0, 0.17, zF], 0.02, '#5b391d', false).beam([1.45, 0.17, zF], [1.17, 0.17, zF], 0.02, '#5b391d', false);
    // camp banners at the sand-table corners (kept outside the grid so they never hide pieces)
    const P = side > 0 ? PAL.red : PAL.black;
    for (const fx of [-4.72, 4.72]) {
      const fz = side * 5.12;
      pk.cyl(0.025, 0.03, 1.5, '#4e3018', [fx, 0.75, fz], 0, 6).cone(0.05, 0.1, P.trim2, [fx, 1.55, fz], 0, 6).cyl(0.012, 0.012, 0.42, P.trim, [fx - 0.21 * Math.sign(fx), 1.4, fz], [0, 0, Math.PI / 2], 5);
      const f = makeFlag(0.42, 0.52, P, side > 0 ? '漢' : '楚'); if (fx > 0) { f.rotation.y = Math.PI; } f.position.set(fx, 1.14, fz); scene.add(f); out.flags.push(f);
    }
    // braziers at the front corners
    for (const fx of [-1.45, 1.45]) {
      const bz = zF;
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; pk.beam([fx + Math.cos(a) * 0.12, 0.0, bz + Math.sin(a) * 0.12], [fx, 0.34, bz], 0.022, '#3d3a36'); }
      pk.cyl(0.13, 0.07, 0.1, '#5b5550', [fx, 0.38, bz], 0, 10).torus(0.13, 0.012, P.trim, [fx, 0.43, bz], [Math.PI / 2, 0, 0], false);
      const fire = new THREE.Group(); fire.position.set(fx, 0.44, bz);
      const fm1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 7), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.25) })); fm1.position.y = 0.1;
      const fm2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 0.9) })); fm2.position.y = 0.07;
      fire.add(fm1, fm2); scene.add(fire); out.flames.push(fire); out.colorOnly.push(fire);
      const L = new THREE.PointLight('#ff9a4a', 0, 4.5, 1.6); L.position.set(fx, 0.75, bz); scene.add(L); out.lights.push(L);
    }
  }
  scene.add(pk.bake(new THREE.Group()));
  // margin decor: pines and rocks (instanced)
  const trees = [], rocks = [];
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 70; i++) {
    let x, z; const edge = rnd() * 4 | 0;
    if (edge === 0) { x = -4.55 - rnd() * 0.35; z = (rnd() - 0.5) * 10.2; } else if (edge === 1) { x = 4.55 + rnd() * 0.35; z = (rnd() - 0.5) * 10.2; } else { x = (rnd() - 0.5) * 9.4; z = (edge === 2 ? -1 : 1) * (5.05 + rnd() * 0.4); }
    if (Math.abs(z) < 0.6) continue; if (Math.abs(x) < 1.6 && Math.abs(z) > 4.8) continue;
    (rnd() < 0.6 ? trees : rocks).push([x, z, 0.6 + rnd() * 0.6, rnd() * 6]);
  }
  const tk = new Kit(); tk.cyl(0.025, 0.03, 0.12, '#5b391d', [0, 0.06, 0], 0, 5).cone(0.14, 0.22, '#4f7a46', [0, 0.2, 0], 0, 6).cone(0.1, 0.18, '#5d8c50', [0, 0.32, 0], 0, 6);
  const tgeo = mergeGeometries(tk.g), togeo = mergeGeometries(tk.o);
  const rk = new Kit(); rk.add(new THREE.DodecahedronGeometry(0.09, 0), '#9a9384', [0, 0.03, 0], [0, 0, 0], [1.2, 0.7, 1]);
  const rgeo = mergeGeometries(rk.g), rogeo = mergeGeometries(rk.o);
  const inst = (g, list, mat, shadow) => { const m = new THREE.InstancedMesh(g, mat, list.length); const d = new THREE.Object3D(); list.forEach((t, i) => { d.position.set(t[0], sandHeight(t[0], t[1]), t[1]); d.rotation.y = t[3]; d.scale.setScalar(t[2]); d.updateMatrix(); m.setMatrixAt(i, d.matrix); }); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; };
  inst(tgeo, trees, MAT.toon, true); inst(togeo, trees, MAT.outline, false); inst(rgeo, rocks, MAT.toon, true); inst(rogeo, rocks, MAT.outline, false);
  return out;
}
