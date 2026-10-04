import * as THREE from 'three';
import {
  SUN_DIR, PALETTE, MAX_SHEEP, START_SHEEP, FOG_DENSITY,
  SUN_RADIANCE, SKY_RADIANCE, GROUND_RADIANCE, createSharedUniforms, TUNING_DEFAULTS, applyTuning, WALK_SPEED,
} from './config.js';
import { createHorizon, createLake, heightAt, LAKE } from './terrain.js';
import { valleyTilt } from './noise.js';
import { riverInfo, FLOW, ACROSS } from './rivers.js';
import { createSky } from './sky.js';
import { createGrass } from './grass.js';
import { createFlowers } from './flowers.js';
import { Bees } from './bees.js';
import { Soundscape } from './audio.js';
import { World } from './world.js';
import { Flock } from './flock.js';
import { SHEEP_LOOKS, loadLook, lookDef } from './sheepModels.js';
import { Walker } from './walker.js';
import { Post } from './post.js';
import { cloudUniforms } from './materials.js';
import { loadTuning, saveTuning } from './tuning.js';
import { createMenu } from './ui.js';
import { initSheepShading } from './sheepShader.js';

// 开发版（dev.html）：有调节面板、切换小羊模型、调试入口；正式版（index.html）只有画面和右上角的菜单
const DEV = window.YILI_DEV === true;

await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

const coarse = matchMedia('(pointer: coarse)').matches;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(PALETTE.fog, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 4000);

const U = createSharedUniforms();
// 可调参数：项目里的 tuning.json。开发版还会读浏览器里还没写回的改动，并在启动时写回一次，保证文件和画面一致
const tuning = await loadTuning(TUNING_DEFAULTS, { local: DEV });
applyTuning(U, tuning);
if (DEV) saveTuning(tuning);
initSheepShading(U, tuning);

// —— 光：太阳 + 天光；太阳的投影阴影跟着视线前方的一块区域走 ——
const sun = new THREE.DirectionalLight(PALETTE.sun, SUN_RADIANCE * Math.PI);
sun.castShadow = true;
const SHADOW_HALF = 20;
const SHADOW_RES = coarse ? 1024 : 2048;
sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 260 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(
  PALETTE.sky,
  new THREE.Color(PALETTE.ground).multiplyScalar(GROUND_RADIANCE / SKY_RADIANCE),
  SKY_RADIANCE * Math.PI
);
scene.add(hemi);
U.uShadowMatrix.value = sun.shadow.matrix;
U.uShadowTexel.value = 1 / SHADOW_RES;

const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
const shadowCenter = new THREE.Vector3();
// 阴影相机按贴图像素对齐移动，走动时影子边缘不会闪（太阳方向可在面板里调，基向量每帧重算）
function followShadow(center) {
  lightRight.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  lightUp.crossVectors(SUN_DIR, lightRight).normalize();
  const texel = (2 * SHADOW_HALF) / SHADOW_RES;
  const x = Math.round(center.dot(lightRight) / texel) * texel;
  const y = Math.round(center.dot(lightUp) / texel) * texel;
  shadowCenter.copy(lightRight).multiplyScalar(x).addScaledVector(lightUp, y).addScaledVector(SUN_DIR, center.dot(SUN_DIR));
  sun.target.position.copy(shadowCenter);
  sun.position.copy(shadowCenter).addScaledVector(SUN_DIR, 130);
}

// —— 场景 ——
const sky = createSky(U);
scene.add(sky);
const horizon = createHorizon(U);
scene.add(horizon);
const lake = createLake(U);
scene.add(lake);
const world = new World(scene, U);

const obstacles = world.obstacles;

// 脚边极细极密的一层 + 稍远处的一层（远处的草叶很小，一片就是一个三角形）；7→13 米之间两层逐根交替，没有分界线
const grassNear = createGrass(U, { count: coarse ? 200000 : 520000, size: 28, fadeOut: [7, 13], width: 0.017, height: 0.2, segs: 2, seed: 11 });
const grassMid = createGrass(U, { count: coarse ? 110000 : 300000, size: 90, fadeIn: [7, 13], fadeOut: [28, 44], width: 0.036, height: 0.2, segs: 1, seed: 23 });
scene.add(grassNear, grassMid);
const flowers = createFlowers(U, { count: coarse ? 3000 : 6500, size: 32 });
scene.add(flowers);
const bees = new Bees(scene, U, tuning, coarse ? 14 : 26);
const sound = new Soundscape(tuning);

// —— 人与羊 ——
const walker = new Walker();
walker.obstacles = obstacles;

// 开场站在哪里：在出发点附近的谷底找一处面朝下游、越过眼前的草坡能望见湖的地方
// （湖在太阳的方向，视线稍微偏开一点，免得一睁眼就对着太阳）。羊群就聚在面前。
function findLakeView() {
  const yaw0 = Math.atan2(-FLOW.x, -FLOW.z) + 0.3;
  let best = null, bestScore = -1;
  for (let u = -700; u <= 700; u += 35) {
    for (const v of [-55, -20, 20, 55]) {
      const x = u * FLOW.x + v * ACROSS.x, z = u * FLOW.z + v * ACROSS.z;
      if (riverInfo(x, z).d < 5) continue;
      const eye = heightAt(x, z) + 1.6;
      const L = valleyTilt(u) + LAKE.level;
      let score = 0;
      for (let a = -0.45; a <= 0.451; a += 0.15) {
        const dx = -Math.sin(yaw0 + a), dz = -Math.cos(yaw0 + a);
        for (let dt = 500; dt <= 1700; dt += 60) {
          const tx = x + dx * dt, tz = z + dz * dt;
          if (heightAt(tx, tz) > L) continue;            // 那里不是湖面
          let ok = true;
          for (let d = 15; d < dt - 15; d += 12) {
            if (heightAt(x + dx * d, z + dz * d) > eye + (L - eye) * (d / dt)) { ok = false; break; }
          }
          if (ok) score++;
        }
      }
      score -= Math.abs(u) / 700;                          // 同样看得见，就选离出发点近的
      if (score > bestScore) { bestScore = score; best = { x, z, yaw: yaw0 }; }
    }
  }
  return best;
}
{
  const spot = findLakeView();
  if (spot) {
    walker.x = spot.x; walker.z = spot.z;
    walker.heading = walker.camYaw = walker.targetYaw = spot.yaw;
  }
}
walker.update(0, camera);
// 开场把人周围的地形一次性铺好
world.update(camera.position, Infinity);
horizon.userData.follow(camera.position.x, camera.position.z);
  lake.userData.follow(camera.position.x, camera.position.z);
camera.updateMatrixWorld();

const LOOK_KEY = 'yili.sheepLook';
const readLookPref = () => {
  try { return localStorage.getItem(LOOK_KEY); } catch { return null; }
};
// 记住的选择对不上现有的模型时，用默认的第一个
let lookId = DEV ? lookDef(new URLSearchParams(location.search).get('sheep') || readLookPref()).id : SHEEP_LOOKS[0].id;
let firstLook;
try {
  firstLook = await loadLook(lookId, scene);
} catch (e) {
  console.error(e);
  lookId = SHEEP_LOOKS.find((d) => d.id !== lookId).id;
  firstLook = await loadLook(lookId, scene);
}
const flock = new Flock(scene, firstLook, obstacles);
if (DEV) {
  const { createDevPanel } = await import('./devPanel.js');
  createDevPanel(U, tuning, { onSheepStyle: (toon) => flock.look.setStyle?.(toon) });
}

const tmp = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const herdCtx = { cx: 0, cz: 0, fx: 0, fz: 1, cam: camera.position, frustum };

function camForward() {
  camera.getWorldDirection(tmp);
  tmp.y = 0;
  return tmp.normalize();
}

// 羊群想聚在视线前方几步远的地方；视线转开时，它们会慢慢跟过去
function updateHerdCenter(dt) {
  const f = walker.herdForward(tmp);
  // 走着的时候羊群在前方几步远；停下来时就围拢到人身边
  const moving = Math.min(1, walker.speed / WALK_SPEED);
  const D = 2.2 + 0.55 * flock.spread + (2.0 + 0.45 * flock.spread) * moving;
  const tx = camera.position.x + f.x * D, tz = camera.position.z + f.z * D;
  const k = dt ? 1 - Math.exp(-dt * 1.2) : 1;
  herdCtx.cx += (tx - herdCtx.cx) * k;
  herdCtx.cz += (tz - herdCtx.cz) * k;
  herdCtx.fx += (f.x - herdCtx.fx) * k;
  herdCtx.fz += (f.z - herdCtx.fz) * k;
  const l = Math.hypot(herdCtx.fx, herdCtx.fz) || 1;
  herdCtx.fx /= l;
  herdCtx.fz /= l;
}

function updateFrustum() {
  camera.updateMatrixWorld();
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreen);
}

updateHerdCenter(0);
for (let i = 0; i < START_SHEEP; i++) {
  const s = flock.spawn(herdCtx.cx, herdCtx.cz, 'flock');
  const spread = 1.0 + 0.36 * Math.sqrt(START_SHEEP);
  const rx = -herdCtx.fz, rz = herdCtx.fx;
  s.x = herdCtx.cx + (s.offX * rx + s.offY * herdCtx.fx) * spread;
  s.z = herdCtx.cz + (s.offX * rz + s.offY * herdCtx.fz) * spread;
}

// 在视野外找一个落脚点：相机左右两侧（或身后）20 多米
const sphere = new THREE.Sphere();
function findSpawn() {
  updateFrustum();
  const f = camForward();
  const fx = f.x, fz = f.z;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const side = Math.random() < 0.5 ? -1 : 1;
  for (let k = 0; k < 16; k++) {
    const rel = side * Math.min(Math.PI, hfov / 2 + 0.3 + Math.random() * 0.7 + k * 0.12);
    const dist = 18 + Math.random() * 9;
    const c = Math.cos(rel), s = Math.sin(rel);
    const dx = fx * c + fz * s, dz = -fx * s + fz * c;
    const x = camera.position.x + dx * dist, z = camera.position.z + dz * dist;
    if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 2)) continue;
    sphere.center.set(x, heightAt(x, z) + 0.5, z);
    sphere.radius = 1.3;
    if (frustum.intersectsSphere(sphere)) continue;
    return { x, z };
  }
  return null;
}

function addSheep() {
  if (flock.active >= MAX_SHEEP) return;
  const spot = findSpawn();
  if (spot) flock.spawn(spot.x, spot.z, 'enter');
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function removeSheep(px, py) {
  const list = flock.activeList();
  if (!list.length) return;
  updateFrustum();
  ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let target = flock.look.pick(raycaster);
  if (!target) {
    // 没点中：挑离点击位置最近的那只（屏幕上 160px 内），否则送走最后来的一只
    let best = 160;
    for (const s of list) {
      tmp.set(s.x, s.root.position.y + 0.6 * s.scale, s.z).project(camera);
      if (tmp.z > 1) continue;
      const sx = (tmp.x * 0.5 + 0.5) * innerWidth, sy = (-tmp.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - px, sy - py);
      if (d < best) { best = d; target = s; }
    }
  }
  if (!target) target = list[list.length - 1];
  const f = camForward();
  flock.dismiss(target, camera.position, f.x, f.z);
}

// —— 开发版：切换小羊模型（数字键 1–3 / M 轮换 / ?sheep=id）——
const devLabel = document.createElement('div');
Object.assign(devLabel.style, {
  position: 'fixed', left: '14px', bottom: '12px', padding: '4px 10px', borderRadius: '6px',
  font: '12px/1.4 -apple-system, "PingFang SC", sans-serif', color: '#fff', background: 'rgba(0,0,0,.45)',
  pointerEvents: 'none', opacity: '0', transition: 'opacity .4s',
});
document.body.appendChild(devLabel);
let devTimer = 0;
function showDev(text, sticky = false) {
  devLabel.textContent = text;
  devLabel.style.opacity = '1';
  clearTimeout(devTimer);
  if (!sticky) devTimer = setTimeout(() => { devLabel.style.opacity = '0'; }, 2200);
}

let switching = false;
async function switchLook(id) {
  if (switching || id === lookId) return;
  switching = true;
  const i = SHEEP_LOOKS.findIndex((d) => d.id === id);
  const def = SHEEP_LOOKS[i];
  showDev(`加载中 · ${def.label}`, true);
  try {
    flock.setLook(await loadLook(id, scene));
    lookId = id;
    try { localStorage.setItem(LOOK_KEY, id); } catch {}
    showDev(`${i + 1} · ${def.label}`);
  } catch (e) {
    console.error(e);
    showDev(`加载失败 · ${def.label}`);
  }
  switching = false;
}

// —— 输入：单击 / 双击 / 拖动 ——
let down = null;
let pending = null;
let lastTap = { t: 0, x: 0, y: 0 };
const DOUBLE_MS = 300;

canvas.addEventListener('pointerdown', (e) => {
  sound.start();
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false, touch: e.pointerType === 'touch' };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!down) return;
  const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
  down.lx = e.clientX; down.ly = e.clientY;
  if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
    down.moved = true;
    canvas.classList.add('dragging');
  }
  if (down.moved) {
    const k = down.touch ? 0.006 : 0.0042;
    walker.look(dx * k, dy * k);
  }
});
function endPointer(e) {
  if (!down) return;
  const tap = !down.moved && performance.now() - down.t < 500;
  down = null;
  canvas.classList.remove('dragging');
  if (tap && e.type === 'pointerup') handleTap(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function handleTap(x, y) {
  const now = performance.now();
  if (pending && now - lastTap.t < DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
    clearTimeout(pending);
    pending = null;
    removeSheep(x, y);
    return;
  }
  lastTap = { t: now, x, y };
  pending = setTimeout(() => { pending = null; addSheep(); }, DOUBLE_MS);
}

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;   // 在面板里输入颜色时不算
  sound.start();
  if (['Equal', 'NumpadAdd', 'Enter', 'NumpadEnter'].includes(e.code) || e.key === '+' || e.key === '=') {
    // 键盘版的“单击”：唤来一只羊
    if (!e.repeat) addSheep();
  } else if (['Minus', 'NumpadSubtract', 'Backspace', 'Delete'].includes(e.code) || e.key === '-' || e.key === '_' || e.key === '−') {
    // 键盘版的“双击”：送走画面中间附近的那只（没有就送走最后来的那只）
    e.preventDefault();
    if (!e.repeat) removeSheep(innerWidth / 2, innerHeight / 2);
  } else if (e.code === 'Space') {
    e.preventDefault();
    walker.walking = !walker.walking;
  } else if (e.code === 'ArrowLeft') walker.look(-0.12, 0);
  else if (e.code === 'ArrowRight') walker.look(0.12, 0);
  else if (e.code === 'ArrowUp') walker.look(0, -0.08);
  else if (e.code === 'ArrowDown') walker.look(0, 0.08);
  else if (DEV && /^Digit[1-9]$/.test(e.code)) {
    const def = SHEEP_LOOKS[Number(e.code.slice(5)) - 1];
    if (def) switchLook(def.id);
  } else if (e.code === 'KeyR') {
    walker.setMode(walker.mode === 'free' ? 'path' : 'free');
    if (DEV) showDev(walker.mode === 'free' ? '自由漫步：往视线方向走' : '沿固定小路走');
  } else if (DEV && e.code === 'KeyM') {
    const i = SHEEP_LOOKS.findIndex((d) => d.id === lookId);
    switchLook(SHEEP_LOOKS[(i + 1) % SHEEP_LOOKS.length].id);
  }
});

// —— 渲染 ——
const post = new Post();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  post.setSize(w, h, dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 头几秒测一下帧率，跑不动就降分辨率、减草（前 1.5 秒是着色器编译，不算）
const perf = { warm: 0, t: 0, frames: 0, done: false };
function adapt(dt) {
  if (perf.done) return;
  perf.warm += dt;
  if (perf.warm < 1.5) return;
  perf.t += dt; perf.frames++;
  if (perf.t < 3) return;
  const fps = perf.frames / perf.t;
  if (fps < 45) {
    if (dpr > 1) { dpr = 1; resize(); }
    grassNear.geometry.instanceCount = Math.round(grassNear.userData.maxCount * 0.6);
    grassMid.geometry.instanceCount = Math.round(grassMid.userData.maxCount * 0.7);
  }
  perf.done = true;
}

const clock = new THREE.Clock();
let first = true;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = (U.uTime.value += dt);
  cloudUniforms.uTime.value = time;
  sun.intensity = tuning.sky.sun * Math.PI;
  hemi.intensity = tuning.sky.skyLight * Math.PI;

  walker.update(dt, camera);
  updateFrustum();
  U.uCenter.value.copy(camera.position);
  sky.position.copy(camera.position);
  world.update(camera.position, 4);
  horizon.userData.follow(camera.position.x, camera.position.z);
  lake.userData.follow(camera.position.x, camera.position.z);

  cloudUniforms.uSunView.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
  updateHerdCenter(dt);
  flock.update(dt, time, herdCtx);
  { const f = camForward(); bees.update(dt, time, camera.position, f.x, f.z); }
  sound.update(dt, { camera, walker, flock, bees });

  followShadow(tmp.copy(camForward()).multiplyScalar(9).add(camera.position));
  post.render(renderer, scene, camera);
  if (sun.shadow.map && !U.uShadowOn.value) {
    U.uShadowMap.value = sun.shadow.map.texture;
    U.uShadowOn.value = 1;
  }

  adapt(dt);
  if (first) {
    first = false;
    requestAnimationFrame(() => document.getElementById('veil').classList.add('gone'));
    if (DEV) showDev(`${SHEEP_LOOKS.findIndex((d) => d.id === lookId) + 1} · ${SHEEP_LOOKS.find((d) => d.id === lookId).label}　（数字键 1–${SHEEP_LOOKS.length} / M 切换小羊模型）`);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

createMenu({ sound, maxSheep: MAX_SHEEP, right: DEV ? 262 : 14 });   // 开发版里让开调节面板

// 调试入口（开发版的控制台里可用）
if (DEV) window.__yili = { walker, flock, camera, addSheep, removeSheep, switchLook, U, sun, grassNear, grassMid, renderer, scene, post, world, horizon, lake, bees, sound };
