// 构建脚本: node build.js → index.html (single self-contained file, works on file:// and GitHub Pages)
// ES modules are embedded as <script type="text/plain" data-mod="key"> blocks; a tiny bootstrap turns
// them into blob: URLs and installs an import map, so bare specifiers ('three', 'app/models.js') resolve offline.
const fs = require('fs'), path = require('path');
const ROOT = __dirname, V = path.join(ROOT, 'vendor'), S = path.join(ROOT, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');
const esc = (src) => src.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const mods = {};
mods['three'] = read(path.join(V, 'three.module.min.js'));
// addons: rewrite relative imports to bare keys
function addAddon(rel) {
  const key = 'three/addons/' + rel; if (mods[key]) return;
  let src = read(path.join(V, 'addons', rel));
  src = src.replace(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g, (m, spec) => { const r = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)); addAddon(r); return `from 'three/addons/${r}'`; });
  mods[key] = src;
}
['controls/OrbitControls.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'utils/BufferGeometryUtils.js'].forEach(addAddon);
for (const f of ['main.js', 'models.js', 'audio.js', 'net.js', 'board2d.js']) {
  mods['app/' + f] = read(path.join(S, f)).replace(/from\s+['"]\.\/([^'"]+)['"]/g, (m, s) => `from 'app/${s}'`);
}
const bootstrap = `(function(){var map={imports:{}};document.querySelectorAll('script[data-mod]').forEach(function(s){map.imports[s.dataset.mod]=URL.createObjectURL(new Blob([s.textContent],{type:'text/javascript'}));});
var im=document.createElement('script');im.type='importmap';im.textContent=JSON.stringify(map);document.head.appendChild(im);
var m=document.createElement('script');m.type='module';m.textContent="import 'app/main.js';";m.onerror=function(){document.getElementById('loading').textContent='加载失败，请使用新版 Chrome / Edge / Safari / Firefox';};document.body.appendChild(m);
window.addEventListener('error',function(e){var l=document.getElementById('loading');if(l&&!l.classList.contains('done'))l.textContent='启动出错：'+(e.message||e);});})();`;

let scripts = '';
scripts += `<script>/* PeerJS 1.5.4 (MIT) */\n${esc(read(path.join(V, 'peerjs.min.js')))}\n</script>\n`;
scripts += `<script>/* MQTT.js 5.16.1 (MIT) — relay fallback */\n${esc(read(path.join(V, 'mqtt.min.js')))}\n</script>\n`;
scripts += `<script id="xq-engine-src">\n${esc(read(path.join(S, 'engine.js')))}\n</script>\n`;
scripts += `<script id="xq-ai-src">\n${esc(read(path.join(S, 'ai.js')))}\n</script>\n`;
for (const [k, v] of Object.entries(mods)) scripts += `<script type="text/plain" data-mod="${k}">\n${esc(v)}\n</script>\n`;
scripts += `<script>${bootstrap}</script>`;
const html = read(path.join(S, 'index.template.html')).replace('<!--SCRIPTS-->', () => scripts);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB, modules:', Object.keys(mods).join(', '));
