import * as THREE from 'three';
import { chunkGeometry, makeTerrainMaterial } from './terrain.js';
import { treesForChunk, treeAssets } from './scenery.js';

// 无尽的河谷：以人为中心，按 256m 的区块随走随生成地形和树，远处的区块网格更粗，走远了就回收。
// 每帧只花几毫秒建新区块，前方的区块总是在进入视野（和雾）之前就准备好了。

const SIZE = 256;
const RADIUS = 1750;     // 地形区块铺到多远（再远是跟着人走的远景圈）
const TREE_RADIUS = 1100;
const TREE_DETAIL = 600; // 这以内用精细的云杉模型
const LODS = [[400, 64], [800, 32], [1300, 16], [Infinity, 8]]; // [距离以内, 每边分段数]

export class World {
  constructor(scene, U) {
    this.U = U;
    this.material = makeTerrainMaterial(U);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.obstacles = []; // 附近的树（共享数组，人和羊都引用它）
    this._obstacleKey = '';
  }

  segFor(d) {
    for (const [lim, seg] of LODS) if (d < lim) return seg;
    return 8;
  }

  update(cam, budgetMs = 4) {
    const t0 = performance.now();
    const ci = Math.floor(cam.x / SIZE), cj = Math.floor(cam.z / SIZE);
    const n = Math.ceil(RADIUS / SIZE) + 1;
    const wanted = new Set();
    const todo = [];
    for (let j = cj - n; j <= cj + n; j++) {
      for (let i = ci - n; i <= ci + n; i++) {
        const cx = (i + 0.5) * SIZE, cz = (j + 0.5) * SIZE;
        const d = Math.max(0, Math.hypot(cx - cam.x, cz - cam.z) - SIZE * 0.5);
        if (d > RADIUS) continue;
        const key = `${i},${j}`;
        wanted.add(key);
        const seg = this.segFor(d);
        const c = this.chunks.get(key);
        const wantTrees = d < TREE_RADIUS;
        const detail = d < TREE_DETAIL;
        if (!c || c.seg !== seg || (wantTrees && (c.trees === undefined || c.treeDetail !== detail)) || (!wantTrees && c.trees)) {
          todo.push({ key, i, j, seg, d, wantTrees, detail, dense: d < 450 });
        }
      }
    }
    // 回收走远的区块
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) {
        this.dispose(c);
        this.chunks.delete(key);
      }
    }
    // 近的先建；时间用完就留到下一帧
    todo.sort((a, b) => a.d - b.d);
    for (const w of todo) {
      if (performance.now() - t0 > budgetMs) break;
      let c = this.chunks.get(w.key);
      if (!c) {
        c = { seg: 0, mesh: null, trees: undefined };
        this.chunks.set(w.key, c);
      }
      if (c.seg !== w.seg) {
        const geo = chunkGeometry(w.i * SIZE, w.j * SIZE, SIZE, w.seg);
        if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = geo; }
        else { c.mesh = new THREE.Mesh(geo, this.material); this.group.add(c.mesh); }
        c.seg = w.seg;
      }
      if (w.wantTrees && (c.trees === undefined || c.treeDetail !== w.detail)) {
        if (c.trees) { this.group.remove(c.trees); c.trees.dispose(); }
        const a = treeAssets(this.U);
        c.trees = treesForChunk(w.i, w.j, SIZE, w.dense, a.material, w.detail ? a.detailed : a.simple);
        c.treeDetail = w.detail;
        if (c.trees) this.group.add(c.trees);
        c.i = w.i; c.j = w.j;
      }
      if (!w.wantTrees && c.trees) {
        this.group.remove(c.trees);
        c.trees.dispose();
        c.trees = undefined;
        c.treeDetail = undefined;
      }
    }
    this.refreshObstacles(ci, cj);
  }

  // 人周围 3×3 个区块里的树当作障碍
  refreshObstacles(ci, cj) {
    const keys = [];
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const c = this.chunks.get(`${i},${j}`);
      keys.push(c?.trees ? `${i},${j}` : '');
    }
    const key = keys.join('|');
    if (key === this._obstacleKey) return;
    this._obstacleKey = key;
    this.obstacles.length = 0;
    for (const k of keys) if (k) this.obstacles.push(...this.chunks.get(k).trees.userData.obstacles);
  }

  dispose(c) {
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.trees) { this.group.remove(c.trees); c.trees.dispose(); }
  }
}
