import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SUN_DIR, PALETTE, SUN_RADIANCE, SKY_RADIANCE, GROUND_RADIANCE, createSharedUniforms, TUNING_DEFAULTS, applyTuning } from './config.js';
import { loadTuning } from './tuning.js';
import { initSheepShading } from './sheepShader.js';
import { createRig } from './sheep.js';
import { SHEEP_LOOKS, loadLook } from './sheepModels.js';
import { cloudUniforms } from './materials.js';

// 开发用：几种小羊外观并排站着，同样的光照，切换吃草 / 抬头 / 走路 / 小跑对比

const U = createSharedUniforms();
const tuning = await loadTuning(TUNING_DEFAULTS);
applyTuning(U, tuning);
initSheepShading(U, tuning);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.fog);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
camera.position.set(0, 1.6, 8.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;

const sun = new THREE.DirectionalLight(PALETTE.sun, SUN_RADIANCE * Math.PI);
sun.position.copy(SUN_DIR).multiplyScalar(20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(
  PALETTE.sky,
  new THREE.Color(PALETTE.ground).multiplyScalar(GROUND_RADIANCE / SKY_RADIANCE),
  SKY_RADIANCE * Math.PI
));
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#4e7a2c', roughness: 1 })
);
ground.receiveShadow = true;
scene.add(ground);
cloudUniforms.uTime.value = 45;

const sheep = [];
const tags = [];
for (const [i, def] of SHEEP_LOOKS.entries()) {
  const s = createRig();
  Object.assign(s, {
    x: (i - (SHEEP_LOOKS.length - 1) / 2) * 1.9, z: 0, vx: 0, vz: 0, heading: Math.PI / 2,
    state: 'flock', mode: 'graze', phase: Math.random() * 6, pitch: 1.2, yaw: 0, scale: 0.85, shrink: 1,
  });
  s.root.scale.setScalar(s.scale);
  s.root.position.set(s.x, 0, s.z);
  s.root.rotation.y = s.heading;
  scene.add(s.root);
  sheep.push(s);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = `${i + 1} · ${def.label}`;
  document.body.appendChild(tag);
  tags.push(tag);
  loadLook(def.id, scene).then((look) => { s.look = look; look.add(s); })
    .catch((e) => { console.error(e); tag.textContent += '（加载失败）'; });
}

let mode = 'graze';
for (const b of document.querySelectorAll('#bar button')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('#bar button')) o.classList.toggle('on', o === b);
  };
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const speed = { graze: 0, look: 0, walk: 1.0, trot: 2.8 }[mode];
  for (const [i, s] of sheep.entries()) {
    s.vx = Math.sin(s.heading) * speed;
    s.vz = Math.cos(s.heading) * speed;
    s.phase += (dt * speed * 5.2) / s.scale;
    const amp = Math.min(speed / 1.3, 1) * (speed > 2.4 ? 0.75 : 0.5);
    const sw = Math.sin(s.phase) * amp;
    s.legs[0].rotation.x = sw; s.legs[1].rotation.x = -sw; s.legs[2].rotation.x = -sw; s.legs[3].rotation.x = sw;
    s.tilt.position.y = Math.abs(Math.cos(s.phase)) * 0.045 * Math.min(speed / 2.5, 1);
    const tp = mode === 'graze' ? 1.2 + 0.07 * Math.sin(t * 8 + i) : mode === 'look' ? 0.05 : mode === 'walk' ? 0.12 : -0.12;
    const ty = mode === 'look' ? Math.sin(t * 0.8 + i) * 0.8 : 0;
    s.pitch += (tp - s.pitch) * (1 - Math.exp(-dt * 4));
    s.yaw += (ty - s.yaw) * (1 - Math.exp(-dt * 3));
    s.neck.rotation.x = s.pitch;
    s.neck.rotation.y = s.yaw;
    s.root.updateMatrixWorld(true);
    s.look?.sync([s], dt, t);

    v.set(s.x, 1.25, 0).project(camera);
    tags[i].style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    tags[i].style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
  controls.update();
  renderer.render(scene, camera);
});
