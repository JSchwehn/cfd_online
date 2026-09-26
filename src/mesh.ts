import * as THREE from "three";
import type { TriangleMesh } from "./case";

export type BoxSize = { x: number; y: number; z: number };

export type FlowBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** Wake tunnel around a centered model: short inlet, long lee side, wide flanks. */
export function flowBox(size: BoxSize): FlowBox {
  const span = Math.max(size.x, size.y, size.z, 1e-6);
  const cross = span * 1.5;
  return {
    minX: -span,
    maxX: span * 3.2,
    minY: -cross,
    maxY: cross,
    minZ: -cross,
    maxZ: cross,
  };
}

export function triangleCount(mesh: TriangleMesh): number {
  return mesh.positions.length / 9;
}

export function simplifyLabel(strength: number): "aus" | "leicht" | "mittel" | "stark" {
  if (strength <= 0) {
    return "aus";
  }
  if (strength < 34) {
    return "leicht";
  }
  if (strength < 67) {
    return "mittel";
  }
  return "stark";
}

/** Welds vertices onto a grid. Strength 0 keeps the mesh, 100 uses the coarsest grid. */
export function simplifyMesh(mesh: TriangleMesh, strength: number): TriangleMesh {
  const level = Math.min(100, Math.max(0, strength));
  if (!(level > 0) || mesh.positions.length < 9) {
    return mesh;
  }
  const size = boundingSize(mesh);
  const span = Math.max(size.x, size.y, size.z, 1e-9);
  const cell = (span * level) / 100 * 0.15;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  const source = mesh.positions;
  for (let index = 0; index < source.length; index += 3) {
    if (source[index] < minX) minX = source[index];
    if (source[index + 1] < minY) minY = source[index + 1];
    if (source[index + 2] < minZ) minZ = source[index + 2];
  }
  type Bucket = { x: number; y: number; z: number; n: number };
  const buckets: Bucket[] = [];
  const indexOf = new Map<string, number>();
  const weld = (x: number, y: number, z: number) => {
    const key = `${Math.round((x - minX) / cell)},${Math.round((y - minY) / cell)},${Math.round((z - minZ) / cell)}`;
    const found = indexOf.get(key);
    if (found !== undefined) {
      const bucket = buckets[found];
      bucket.x += x;
      bucket.y += y;
      bucket.z += z;
      bucket.n += 1;
      return found;
    }
    const id = buckets.length;
    indexOf.set(key, id);
    buckets.push({ x, y, z, n: 1 });
    return id;
  };
  const corners: number[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < source.length; index += 9) {
    const a = weld(source[index], source[index + 1], source[index + 2]);
    const b = weld(source[index + 3], source[index + 4], source[index + 5]);
    const c = weld(source[index + 6], source[index + 7], source[index + 8]);
    if (a === b || b === c || a === c) {
      continue;
    }
    const key = [a, b, c].sort((left, right) => left - right).join(",");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    corners.push(a, b, c);
  }
  if (corners.length === 0) {
    return mesh;
  }
  const positions = new Float32Array(corners.length * 3);
  const normals = new Float32Array(corners.length * 3);
  for (let index = 0; index < corners.length; index += 3) {
    const point = (id: number) => {
      const bucket = buckets[id];
      return [bucket.x / bucket.n, bucket.y / bucket.n, bucket.z / bucket.n];
    };
    const [ax, ay, az] = point(corners[index]);
    const [bx, by, bz] = point(corners[index + 1]);
    const [cx, cy, cz] = point(corners[index + 2]);
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const base = index * 3;
    positions[base] = ax;
    positions[base + 1] = ay;
    positions[base + 2] = az;
    positions[base + 3] = bx;
    positions[base + 4] = by;
    positions[base + 5] = bz;
    positions[base + 6] = cx;
    positions[base + 7] = cy;
    positions[base + 8] = cz;
    for (let corner = 0; corner < 3; corner += 1) {
      normals[base + corner * 3] = nx;
      normals[base + corner * 3 + 1] = ny;
      normals[base + corner * 3 + 2] = nz;
    }
  }
  return { positions, normals };
}

export function boundingSize(mesh: TriangleMesh): BoxSize {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const positions = mesh.positions;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (positions.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

export function centerMesh(mesh: TriangleMesh): TriangleMesh {
  if (mesh.positions.length === 0) {
    throw new Error("Die Datei enthält kein Netz.");
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const source = mesh.positions;
  for (let index = 0; index < source.length; index += 3) {
    const x = source[index];
    const y = source[index + 1];
    const z = source[index + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const positions = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 3) {
    positions[index] = source[index] - centerX;
    positions[index + 1] = source[index + 1] - centerY;
    positions[index + 2] = source[index + 2] - centerZ;
  }
  return { positions, normals: mesh.normals };
}

export function geometryToMesh(geometry: THREE.BufferGeometry): TriangleMesh {
  const source = geometry.getIndex() ? geometry.toNonIndexed() : geometry;
  if (!source.getAttribute("normal")) {
    source.computeVertexNormals();
  }
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  if (!position || !normal || position.count === 0) {
    throw new Error("Die Datei enthält kein Netz.");
  }
  const mesh = {
    positions: new Float32Array(position.array),
    normals: new Float32Array(normal.array),
  };
  if (source !== geometry) {
    source.dispose();
  }
  geometry.dispose();
  return centerMesh(mesh);
}

export function mergeMeshes(parts: TriangleMesh[]): TriangleMesh {
  let length = 0;
  for (const part of parts) {
    length += part.positions.length;
  }
  const positions = new Float32Array(length);
  const normals = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    positions.set(part.positions, offset);
    normals.set(part.normals, offset);
    offset += part.positions.length;
  }
  return { positions, normals };
}
