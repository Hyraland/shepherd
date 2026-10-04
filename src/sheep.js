import * as THREE from 'three';

// 羊的“骨架”（由羊群逻辑摆姿势）和脚下的接触阴影；外观见 sheepModels.js。

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const SHEEP_CAPACITY = 96;

// 每只羊的“骨架”：只是一组 Object3D，由羊群逻辑摆姿势（位置、朝向、坡度、点头、迈腿），
// 外观（glTF 模型，见 sheepModels.js）再按这副骨架画出来。
export function createRig() {
  const root = new THREE.Object3D();
  const tilt = new THREE.Object3D();
  root.add(tilt);
  const body = new THREE.Object3D();
  tilt.add(body);

  const neck = new THREE.Object3D();
  neck.position.set(0, 0.7, 0.46);
  neck.rotation.order = 'YXZ';
  const head = new THREE.Object3D();
  neck.add(head);
  tilt.add(neck);

  const legs = [];
  const legEnds = [];
  for (const [x, z] of [[0.15, 0.27], [-0.15, 0.27], [0.15, -0.3], [-0.15, -0.3]]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, 0.5, z);
    const end = new THREE.Object3D();
    pivot.add(end);
    tilt.add(pivot);
    legs.push(pivot);
    legEnds.push(end);
  }

  const shadow = new THREE.Object3D();
  shadow.position.y = 0.03;
  root.add(shadow);

  const scale = 0.6 + Math.random() * 0.32;
  root.scale.setScalar(scale);
  return {
    root, tilt, body, neck, head, legs, legEnds, shadow, scale,
    tint: 0.9 + Math.random() * 0.12,
  };
}

function dynamic(scene, mesh, cap) {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.userData.cap = cap;
  scene.add(mesh);
  return mesh;
}

// 羊脚下一圈很淡的接触阴影（真实投影只覆盖相机附近，这一圈让远处的羊也“站”在地上）
export class ContactShadows {
  constructor(scene) {
    const mat = new THREE.MeshBasicMaterial({
      map: blobTexture(), color: '#1d2414', transparent: true, opacity: 0.35,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = dynamic(scene, new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 1.25).rotateX(-Math.PI / 2), mat, SHEEP_CAPACITY), SHEEP_CAPACITY);
    this.mesh.renderOrder = 1;
  }

  sync(list) {
    const n = Math.min(list.length, SHEEP_CAPACITY);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, list[i].shadow.matrixWorld);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
