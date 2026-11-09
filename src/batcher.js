// Draw everything the open world's chunks share a material for in one call per material.
//
// Every terrain chunk, every chunk's plants and every chunk's merged buildings and props was
// its own mesh, so the draw calls grew with the number of chunks in view (100+). Here each
// such mesh is copied into a THREE.BatchedMesh per material (and shadow flags and vertex
// layout), which draws all its pieces in one multi-draw call and still culls each piece
// against the camera (and the shadow camera) on its own.
//
// Chunks come and go as the player drives, and BatchedMesh only reclaims freed space by
// compacting its buffers (optimize(): a full re-upload, a visible hitch). So a removed piece
// keeps its slot, and a later piece that fits reuses it (best fit). Slots are rounded up to
// quarter-octave sizes so similar pieces fit each other's slots; terrain chunks, which are
// all the same size, reuse them exactly. Pieces of very different sizes (a forest chunk's
// plants against a desert's) still leave slots no new piece fits, so compact() drops them
// and shrinks the buffers at moments that are a pause anyway (fast travel).
import * as THREE from 'three';

const MIN_V = 1024, MIN_I = 2048, START_N = 16;   // smallest buffers; a batch starts at twice its first piece and grows by a quarter
const IDENTITY = new THREE.Matrix4();
const bucket = (n) => (n <= 0 ? 0 : Math.ceil(2 ** (Math.ceil(Math.log2(n) * 4) / 4)));

export class Batcher {
  /** @param {THREE.Object3D} parent where the batches are added */
  constructor(parent) {
    this.parent = parent;
    this.batches = new Map();
  }

  /** Whether a mesh can go into a batch: a plain mesh with one material and an indexed or non-indexed geometry. */
  static canBatch(o) {
    return o.isMesh && !o.isInstancedMesh && !o.isBatchedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !o.geometry.morphAttributes.position && o.geometry.attributes.position;
  }

  /**
   * Copy `geo` (already in world space) into the batch for `material`. Returns a handle for
   * remove(). The geometry is not kept: the caller may dispose it.
   */
  add(geo, material, castShadow, receiveShadow) {
    const indexed = !!geo.index;
    const key = [material.uuid, castShadow, receiveShadow, indexed, Object.keys(geo.attributes).sort().join(',')].join('|');
    const vc = geo.attributes.position.count, ic = indexed ? geo.index.count : 0;
    let b = this.batches.get(key);
    if (!b) {
      const bm = new THREE.BatchedMesh(START_N, Math.max(MIN_V, bucket(vc) * 2), Math.max(MIN_I, bucket(ic) * 2), material);
      bm.frustumCulled = false;            // the batch's own bounds go stale as chunks stream; each piece is culled instead
      bm.castShadow = castShadow; bm.receiveShadow = receiveShadow;
      this.parent.add(bm);
      b = { bm, nextV: 0, nextI: 0, created: 0, freeInst: 0, pool: [] };
      this.batches.set(key, b);
    }
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    // reuse the smallest free slot it fits in
    let best = -1;
    for (let i = 0; i < b.pool.length; i++) {
      const s = b.pool[i];
      if (s.rv >= vc && s.ri >= ic && (best < 0 || s.rv < b.pool[best].rv)) best = i;
    }
    let slot;
    if (best >= 0) {
      slot = b.pool[best];
      b.pool[best] = b.pool[b.pool.length - 1]; b.pool.pop();
      b.bm.setGeometryAt(slot.id, geo);
    } else {
      const rv = bucket(vc), ri = indexed ? bucket(ic) : -1;
      const needV = b.nextV + rv, needI = b.nextI + Math.max(0, ri);
      if (rv > b.bm.unusedVertexCount || (indexed && ri > b.bm.unusedIndexCount)) {
        // grow by a quarter (setGeometrySize copies the data into bigger buffers: rare)
        const capV = b.nextV + b.bm.unusedVertexCount, capI = b.nextI + b.bm.unusedIndexCount;
        b.bm.setGeometrySize(Math.max(needV, Math.ceil(capV * 1.25)), Math.max(needI, Math.ceil(capI * 1.25)));
      }
      slot = { id: b.bm.addGeometry(geo, rv, ri), rv, ri: Math.max(0, ri) };
      b.nextV = needV; b.nextI = needI;
    }
    if (b.freeInst === 0 && b.created >= b.bm.maxInstanceCount) b.bm.setInstanceCount(b.bm.maxInstanceCount * 2);
    const inst = b.bm.addInstance(slot.id);
    if (b.freeInst > 0) b.freeInst--; else b.created++;
    return { b, slot, inst };
  }

  /** Take a piece out of its batch; its slot is kept for the next piece that fits. */
  remove(h) {
    h.b.bm.deleteInstance(h.inst);
    h.b.freeInst++;
    h.b.pool.push(h.slot);
  }

  /**
   * Give back the space of removed pieces: drop their slots, pack the rest together and shrink
   * the buffers to fit (with a quarter to spare); batches left empty are freed. This re-uploads
   * the batches, so call it where a pause is expected anyway (a teleport), not every frame.
   */
  compact() {
    for (const [key, b] of this.batches) {
      if (b.created - b.freeInst === 0) { b.bm.removeFromParent(); b.bm.dispose(); this.batches.delete(key); continue; }
      if (!b.pool.length) continue;
      const capV = b.nextV + b.bm.unusedVertexCount, capI = b.nextI + b.bm.unusedIndexCount;
      for (const s of b.pool) b.bm.deleteGeometry(s.id);   // their instances were deleted already
      b.pool.length = 0;
      b.bm.optimize();
      b.nextV = capV - b.bm.unusedVertexCount; b.nextI = capI - b.bm.unusedIndexCount;
      const wantV = Math.max(MIN_V, Math.ceil(b.nextV * 1.25)), wantI = Math.max(MIN_I, Math.ceil(b.nextI * 1.25));
      if (wantV < capV * 0.8 || wantI < capI * 0.8) b.bm.setGeometrySize(Math.min(capV, wantV), Math.min(capI, wantI));
    }
  }

  /**
   * Move every batchable mesh under `group` (matrices already final) into batches, freeing
   * their geometry. Meshes whose material is not in `materials` (a Set), or that pass
   * `skip`, stay. Returns the handles.
   */
  absorb(group, materials, skip = null) {
    const handles = [], moved = [];
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!Batcher.canBatch(o) || !materials(o.material) || (skip && skip(o))) return;
      // a chunk's own geometry is transformed in place (it is freed right after); a shared one is copied
      const shared = !!o.geometry.userData.shared;
      const geo = shared ? o.geometry.clone() : o.geometry;
      if (!o.matrixWorld.equals(IDENTITY)) { geo.applyMatrix4(o.matrixWorld); geo.boundingSphere = null; }
      handles.push(this.add(geo, o.material, o.castShadow, o.receiveShadow));
      geo.dispose();
      moved.push(o);
    });
    for (const o of moved) o.removeFromParent();
    return handles;
  }

  /** Free every batch (their geometry and the batch's own data textures; materials are left to their owners). */
  dispose() {
    for (const { bm } of this.batches.values()) { bm.removeFromParent(); bm.dispose(); }
    this.batches.clear();
  }

  /** Pieces drawn / slots / vertex capacity per batch, for profiling. */
  stats() {
    return [...this.batches.values()].map(({ bm, nextV, created, freeInst, pool }) => ({ material: bm.material.type, live: created - freeInst, slots: pool.length + created - freeInst, usedV: nextV, capV: nextV + bm.unusedVertexCount }));
  }

  /** Vertex capacity of all batches together (for profiling). */
  totalCapacity() {
    let v = 0;
    for (const { bm, nextV } of this.batches.values()) v += nextV + bm.unusedVertexCount;
    return v;
  }
}
