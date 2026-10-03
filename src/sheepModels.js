import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHEEP_CAPACITY } from './sheep.js';
import { withClouds } from './materials.js';
import { makeSheepMaterial, sheepToonEnabled } from './sheepShader.js';

// 开发阶段用来对比的几种小羊外观（授权见 CREDITS.md；1 号是 CGTrader 版税授权，公开发布前需要加密打包）。
// 都是不带骨骼的静态模型：腿在顶点着色器里按步伐摆动，头部（分开的部件）绕脖子转动。
//   height    归一化后的总高度（米，乘上每只羊的体型系数）
//   headNode  用来判断头朝哪边的部件
//   headParts 能单独点头 / 转头的部件（名字前缀，含子孙）
//   hip       腿的上端（占总高度的比例），以下的部分会随步伐前后摆
//   wool      用羊毛材质的部件（按材质名）：绒面光泽 + 用颜色贴图本身做凹凸，一卷卷的毛有起伏
export const SHEEP_LOOKS = [
  {
    id: 'cgtrader', label: 'Realistic Sheep · WildMesh3D（CGTrader）',
    url: 'models/sheep_cgtrader/Sheep.gltf', height: 1.0, headNode: 'sm_1_0_0',
    headParts: ['sm_1_0_0', 'sm_2_0_0'], hip: 0.36, wool: ['Material.001', 'Material'],
  },
  {
    id: 'dibarts', label: 'Sheep · DibArts',
    url: 'models/sheep/scene.gltf', height: 1.05, headNode: 'Object_5', hip: 0.3,
  },
  {
    id: 'cartoon', label: 'Cartoon sheep · _Yen_',
    url: 'models/cartoon_sheep/scene.gltf', height: 1.05, headNode: 'face',
    headParts: ['face', 'ears', 'eyes', 'nose', 'mouth'], hip: 0.26,
    colors: { wool: '#e8e0cf' },
  },
];

export function lookDef(id) {
  return SHEEP_LOOKS.find((d) => d.id === id) || SHEEP_LOOKS[0];
}

const loader = new GLTFLoader();
const templates = new Map();

// 把模型转到“脚底在 y=0、头朝 +Z、高度为 height”的统一坐标里
function normalize(obj, headObj, height) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const center = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.add(obj);
  if (headObj) {
    // 取头部件包围盒的中心（有些模型的部件原点并不在部件上）
    const hp = new THREE.Box3().setFromObject(headObj, true).getCenter(new THREE.Vector3());
    wrap.rotation.y = -Math.atan2(hp.x - center.x, hp.z - center.z);
  }
  wrap.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(wrap, true);
  const s = height / (b2.max.y - b2.min.y);
  const c2 = b2.getCenter(new THREE.Vector3());
  const outer = new THREE.Group();
  outer.add(wrap);
  outer.scale.setScalar(s);
  outer.position.set(-c2.x * s, -b2.min.y * s, -c2.z * s);
  outer.updateMatrixWorld(true);
  return outer;
}

// DibArts 的模型用的是 KHR_materials_pbrSpecularGlossiness，新版 three 已不再解析，手动取出漫反射颜色
function applySpecGlossColors(gltf) {
  const json = gltf.parser.json;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const idx = gltf.parser.associations.get(o.material)?.materials;
    const sg = json.materials?.[idx]?.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (sg?.diffuseFactor) {
      o.material.color.setRGB(sg.diffuseFactor[0], sg.diffuseFactor[1], sg.diffuseFactor[2]);
      o.material.roughness = 1 - (sg.glossinessFactor ?? 0.3) * 0.6;
      o.material.metalness = 0;
    }
  });
}

// 羊毛：几乎没有镜面反射，边缘有绒毛透出的柔光（sheen），颜色贴图里的毛卷同时当作凹凸
function woolMaterial(src) {
  return new THREE.MeshPhysicalMaterial({
    name: src.name,
    map: src.map,
    color: src.color,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0.15,
    sheen: 1,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color('#fff4e4'),
    bumpMap: src.map,
    bumpScale: 2.6,
    side: src.side,
  });
}

const inGroup = (o, names) => {
  for (let p = o; p; p = p.parent) if (names.some((n) => p.name.startsWith(n))) return true;
  return false;
};

// 腿的摆动：髋部以下的顶点绕髋部高度的横轴转动；对角线上的两条腿同相（小跑步态）
function withGait(material, hipY) {
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aGait;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      {
        float hip = ${hipY.toFixed(4)};
        float w = smoothstep(hip, hip - 0.12, transformed.y);
        if (w > 0.0 && aGait.y > 0.0) {
          bool front = transformed.z > 0.0;
          bool left = transformed.x > 0.0;
          float a = sin(aGait.x + (front == left ? 0.0 : 3.14159)) * aGait.y * w;
          float dy = transformed.y - hip;
          transformed.y = hip + dy * cos(a);
          transformed.z += dy * sin(a);
        }
      }`
    );
  };
  material.customProgramCacheKey = () => 'gait' + hipY.toFixed(4);
  return material;
}

async function buildTemplate(def) {
  const gltf = await loader.loadAsync(def.url);
  applySpecGlossColors(gltf);
  const head = def.headNode ? gltf.scene.getObjectByName(def.headNode) : null;
  const outer = normalize(gltf.scene, head, def.height);
  const parts = [];
  const headBox = new THREE.Box3();
  outer.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) {
      // 镜像变换会把三角形翻面
      const idx = geo.index;
      if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
    }
    for (const k of Object.keys(geo.attributes)) if (k.startsWith('color')) geo.deleteAttribute(k);
    const name = (o.material.name || '') + ' ' + o.name;
    const override = Object.entries(def.colors || {}).find(([k]) => name.includes(k));
    let mat = o.material.clone();
    mat.vertexColors = false;
    if (def.wool?.includes(o.material.name) && mat.map) mat = woolMaterial(mat);
    if (override) mat.color.set(override[1]);
    if (mat.map) mat.map.anisotropy = 4;
    const isHead = def.headParts ? inGroup(o, def.headParts) : false;
    if (isHead) { geo.computeBoundingBox(); headBox.union(geo.boundingBox); }
    parts.push({ geo, mat, isHead });
  });
  // 脖子的转轴：头部件包围盒靠后、偏下的位置
  const pivot = headBox.isEmpty()
    ? new THREE.Vector3()
    : new THREE.Vector3(0, headBox.min.y + (headBox.max.y - headBox.min.y) * 0.35, headBox.min.z + (headBox.max.z - headBox.min.z) * 0.15);
  return { parts, pivot };
}

export async function loadLook(id, scene) {
  const def = lookDef(id);
  if (!templates.has(def.id)) templates.set(def.id, buildTemplate(def));
  return new ModelLook(scene, await templates.get(def.id), def);
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _c = new THREE.Color();

// 每个部件一个 InstancedMesh（保留原来的贴图和材质），所有羊一起画
class ModelLook {
  constructor(scene, data, def) {
    this.scene = scene;
    this.def = def;
    this.pivot = data.pivot;
    const toon = sheepToonEnabled();
    this.meshes = data.parts.map(({ geo, mat, isHead }) => {
      const g = geo.clone();
      const m = mat.clone();
      const hip = !isHead && def.hip ? def.hip * def.height : null;
      if (hip != null) {
        g.setAttribute('aGait', new THREE.InstancedBufferAttribute(new Float32Array(SHEEP_CAPACITY * 2), 2));
        withGait(m, hip);
      }
      withClouds(m);
      // 两套材质：写实（PBR）和插画光影，开发面板里切换
      const toonMat = makeSheepMaterial({ map: mat.map, color: mat.color, side: mat.side, hip });
      const mesh = new THREE.InstancedMesh(g, toon ? toonMat : m, SHEEP_CAPACITY);
      mesh.userData.materials = { real: m, toon: toonMat };
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.userData.isHead = isHead;
      scene.add(mesh);
      return mesh;
    });
    this.owners = [];
  }

  add() {}
  remove() {}

  setStyle(toon) {
    for (const mesh of this.meshes) mesh.material = toon ? mesh.userData.materials.toon : mesh.userData.materials.real;
  }

  sync(list) {
    const n = Math.min(list.length, SHEEP_CAPACITY);
    const p = this.pivot;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const speed = Math.hypot(s.vx, s.vz);
      const graze = Math.max(0, s.pitch);
      // 身体：吃草时微微前倾，走路时左右轻晃
      const roll = Math.sin(s.phase) * 0.035 * Math.min(speed / 1.5, 1);
      _m2.makeRotationFromEuler(_e.set(graze * 0.06, 0, roll));
      _m.multiplyMatrices(s.tilt.matrixWorld, _m2);
      // 头：绕脖子低头吃草、转头张望
      _m3.makeTranslation(p.x, p.y, p.z)
        .multiply(_m2.makeRotationFromEuler(_e.set(Math.min(graze, 1.2) * 0.55 - 0.05, s.yaw * 0.8, 0)))
        .multiply(_t.makeTranslation(-p.x, -p.y, -p.z));
      _m3.premultiply(_m);
      const amp = Math.min(speed / 1.3, 1) * (speed > 2.4 ? 0.6 : 0.42);
      for (const mesh of this.meshes) {
        mesh.setMatrixAt(i, mesh.userData.isHead ? _m3 : _m);
        mesh.setColorAt(i, _c.setScalar(s.tint));
        const gait = mesh.geometry.attributes.aGait;
        if (gait) { gait.array[i * 2] = s.phase; gait.array[i * 2 + 1] = amp; }
      }
      this.owners[i] = s;
    }
    this.owners.length = n;
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.geometry.attributes.aGait) mesh.geometry.attributes.aGait.needsUpdate = true;
    }
  }

  pick(raycaster) {
    let best = null, bd = Infinity;
    for (const mesh of this.meshes) {
      mesh.computeBoundingSphere();
      for (const h of raycaster.intersectObject(mesh, false)) {
        const s = this.owners[h.instanceId];
        if (s && s.state !== 'leave' && h.distance < bd) { bd = h.distance; best = s; }
      }
    }
    return best;
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.dispose();
      m.geometry.dispose();
      m.userData.materials.real.dispose();
      m.userData.materials.toon.dispose();
    }
  }
}
