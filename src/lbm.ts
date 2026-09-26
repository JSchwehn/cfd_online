import { eulerFromAngles, type TriangleMesh } from "./case";
import { boundingSize, flowBox, type FlowBox } from "./mesh";
import * as THREE from "three";

const Q = 19;
const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1];
const OPP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17];
const W = [
  1 / 3,
  1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
];
export type Resolution = "coarse" | "medium" | "fine";

const GRID: Record<Resolution, { cells: number; limit: number }> = {
  coarse: { cells: 22, limit: 12000 },
  medium: { cells: 40, limit: 48000 },
  fine: { cells: 48, limit: 70000 },
};

export function gridForResolution(resolution: Resolution): { cells: number; limit: number } {
  return GRID[resolution];
}

/**
 * Air at Normalnull (15 °C, 1013 hPa, kinematic viscosity 1.46e-5 m²/s).
 * A true Reynolds number does not fit this grid, so this is the thinnest relaxation that stays stable.
 */
export const AIR_TAU = 0.52;
/** TRT magic parameter. Keeps bounce-back from adding extra slip. */
export const TRT_MAGIC = 0.25;

export type FlowModel = "bgk" | "trt";

export function tauMinus(tauPlus: number): number {
  return 0.5 + TRT_MAGIC / (tauPlus - 0.5);
}

export type Lbm = {
  nx: number;
  ny: number;
  nz: number;
  spacing: number;
  originX: number;
  originY: number;
  originZ: number;
  uIn: number;
  tau: number;
  tauMinus: number;
  model: FlowModel;
  solid: Uint8Array;
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
  particles: Float32Array;
  particleCount: number;
  surface: Float32Array;
  stuck: Float32Array;
  stuckCount: number;
  bodyMinX: number;
  bodyMinY: number;
  bodyMinZ: number;
  bodyMaxX: number;
  bodyMaxY: number;
  bodyMaxZ: number;
  slice: boolean;
  sliceVertical: boolean;
  outletOpen: boolean;
  recordTrails: boolean;
  trail: Float32Array;
  box: FlowBox;
  pull: Float32Array;
  push: Float32Array;
};

export const TRAIL = 16;
export const RESPAWNS_PER_STEP = 32;

export function turnStrength(ux: number, uy: number, uz: number): number {
  const speed = Math.hypot(ux, uy, uz);
  if (speed < 1e-8) {
    return 0;
  }
  return Math.hypot(uy, uz) / speed;
}

function writeTurn(strength: number, out: Float32Array, offset: number) {
  const t = Math.min(1, Math.max(0, strength) / 0.5);
  if (t < 0.5) {
    const u = t / 0.5;
    out[offset] = 0.16 + (0.95 - 0.16) * u;
    out[offset + 1] = 0.44 + (0.78 - 0.44) * u;
    out[offset + 2] = 0.86 + (0.15 - 0.86) * u;
    return;
  }
  const u = (t - 0.5) / 0.5;
  out[offset] = 0.95 + (0.86 - 0.95) * u;
  out[offset + 1] = 0.78 + (0.18 - 0.78) * u;
  out[offset + 2] = 0.15 + (0.12 - 0.15) * u;
}

export function turnColor(strength: number): { r: number; g: number; b: number } {
  const out = new Float32Array(3);
  writeTurn(strength, out, 0);
  return { r: out[0], g: out[1], b: out[2] };
}

export function latticeInlet(speedMps: number): number {
  if (!(speedMps > 0)) {
    return 0;
  }
  return Math.min(0.08, 0.03 + speedMps * 0.001);
}

function equilibrium(rho: number, ux: number, uy: number, uz: number, out: Float32Array, offset: number) {
  const usq = ux * ux + uy * uy + uz * uz;
  for (let q = 0; q < Q; q += 1) {
    const cu = CX[q] * ux + CY[q] * uy + CZ[q] * uz;
    out[offset + q] = W[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * usq);
  }
}

/** Zou-He velocity inlet on the west face. Unknown populations point downstream. */
function velocityInlet(f: Float32Array, offset: number, ux: number) {
  const known =
    f[offset] +
    f[offset + 3] +
    f[offset + 4] +
    f[offset + 5] +
    f[offset + 6] +
    f[offset + 15] +
    f[offset + 16] +
    f[offset + 17] +
    f[offset + 18] +
    2 * (f[offset + 2] + f[offset + 8] + f[offset + 10] + f[offset + 12] + f[offset + 14]);
  const rho = known / (1 - ux);
  if (!(rho > 0.2) || rho > 5) {
    equilibrium(1, ux, 0, 0, f, offset);
    return;
  }
  const pullY = 0.5 * (f[offset + 3] - f[offset + 4]);
  const pullZ = 0.5 * (f[offset + 5] - f[offset + 6]);
  const drive = rho * ux;
  f[offset + 1] = f[offset + 2] + drive / 3;
  f[offset + 7] = f[offset + 8] + drive / 6 - pullY;
  f[offset + 9] = f[offset + 10] + drive / 6 + pullY;
  f[offset + 11] = f[offset + 12] + drive / 6 - pullZ;
  f[offset + 13] = f[offset + 14] + drive / 6 + pullZ;
}

function index(nx: number, ny: number, x: number, y: number, z: number): number {
  return x + nx * (y + ny * z);
}

export function createLbm(input: {
  mesh: TriangleMesh;
  yaw: number;
  pitch: number;
  roll: number;
  speedMps: number;
  model?: FlowModel;
  resolution?: Resolution;
  cells?: number;
  limit?: number;
  particles?: number;
  slice?: boolean;
}): Lbm {
  const world = transformedPositions(input.mesh, input.yaw, input.pitch, input.roll);
  const bounds = boundsOf(world);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 1e-6);
  const drawn = flowBox(boundingSize(input.mesh));
  const margin = span * 0.4;
  const minX = Math.min(bounds.minX, drawn.minX) - margin;
  const maxX = Math.max(bounds.maxX, drawn.maxX) + margin;
  const minY = Math.min(bounds.minY, drawn.minY) - margin;
  const maxY = Math.max(bounds.maxY, drawn.maxY) + margin;
  const minZ = Math.min(bounds.minZ, drawn.minZ) - margin;
  const maxZ = Math.max(bounds.maxZ, drawn.maxZ) + margin;
  const preset = GRID[input.resolution ?? "medium"];
  let nx = input.cells ?? preset.cells;
  let spacing = (maxX - minX) / nx;
  let ny = Math.max(8, Math.round((maxY - minY) / spacing));
  let nz = Math.max(8, Math.round((maxZ - minZ) / spacing));
  const limit = input.limit ?? preset.limit;
  if (nx * ny * nz > limit) {
    const scale = Math.cbrt((nx * ny * nz) / limit);
    spacing *= scale;
    nx = Math.max(8, Math.round((maxX - minX) / spacing));
    ny = Math.max(8, Math.round((maxY - minY) / spacing));
    nz = Math.max(8, Math.round((maxZ - minZ) / spacing));
  }
  const n = nx * ny * nz;
  const solid = new Uint8Array(n);
  markSurface(solid, world, nx, ny, nz, minX, minY, minZ, spacing);
  fillInterior(solid, nx, ny, nz);

  const uIn = latticeInlet(input.speedMps);
  const model = input.model ?? "bgk";
  const tau = AIR_TAU;
  const oddTau = tauMinus(tau);
  const ux = new Float32Array(n);
  const uy = new Float32Array(n);
  const uz = new Float32Array(n);
  const pull = new Float32Array(n * Q);
  const push = new Float32Array(n * Q);
  for (let i = 0; i < n; i += 1) {
    if (solid[i]) {
      continue;
    }
    equilibrium(1, uIn, 0, 0, pull, i * Q);
    ux[i] = uIn;
  }
  const count = input.particles ?? 480;
  const particles = new Float32Array(count * 3);
  const sim: Lbm = {
    nx,
    ny,
    nz,
    spacing,
    originX: minX,
    originY: minY,
    originZ: minZ,
    uIn,
    tau,
    tauMinus: oddTau,
    model,
    solid,
    ux,
    uy,
    uz,
    particles,
    particleCount: count,
    surface: world,
    stuck: new Float32Array(count * 3),
    stuckCount: 0,
    bodyMinX: bounds.minX,
    bodyMinY: bounds.minY,
    bodyMinZ: bounds.minZ,
    bodyMaxX: bounds.maxX,
    bodyMaxY: bounds.maxY,
    bodyMaxZ: bounds.maxZ,
    slice: input.slice ?? false,
    sliceVertical: false,
    outletOpen: true,
    recordTrails: false,
    trail: new Float32Array(count * TRAIL * 3),
    box: flowBox(boundingSize(input.mesh)),
    pull,
    push,
  };
  seedParticles(sim);
  return sim;
}

export function setParticleCount(sim: Lbm, count: number) {
  const nextCount = Math.max(1, Math.round(count));
  const current = sim.particleCount;
  if (nextCount === current && sim.particles.length === nextCount * 3) {
    return;
  }
  const next = new Float32Array(nextCount * 3);
  next.set(sim.particles.subarray(0, Math.min(current, nextCount) * 3));
  const nextTrail = new Float32Array(nextCount * TRAIL * 3);
  nextTrail.set(sim.trail.subarray(0, Math.min(current, nextCount) * TRAIL * 3));
  const nextStuck = new Float32Array(nextCount * 3);
  const keptStuck = Math.min(sim.stuckCount, nextCount);
  nextStuck.set(sim.stuck.subarray(0, keptStuck * 3));
  sim.particles = next;
  sim.trail = nextTrail;
  sim.stuck = nextStuck;
  sim.stuckCount = keptStuck;
  sim.particleCount = nextCount;
  for (let i = current; i < nextCount; i += 1) {
    placeParticle(sim, i, true);
  }
}

const feqScratch = new Float64Array(Q);

function collideCell(sim: Lbm, f: Float32Array, base: number, rho: number, ux: number, uy: number, uz: number) {
  const usq = ux * ux + uy * uy + uz * uz;
  for (let q = 0; q < Q; q += 1) {
    const cu = CX[q] * ux + CY[q] * uy + CZ[q] * uz;
    feqScratch[q] = W[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * usq);
  }
  if (sim.model !== "trt") {
    const inv = 1 / sim.tau;
    for (let q = 0; q < Q; q += 1) {
      const i = base + q;
      f[i] += (feqScratch[q] - f[i]) * inv;
    }
    return;
  }
  const invPlus = 1 / sim.tau;
  const invMinus = 1 / sim.tauMinus;
  for (let q = 0; q < Q; q += 1) {
    const opp = OPP[q];
    if (opp < q) {
      continue;
    }
    const i = base + q;
    if (q === opp) {
      f[i] += (feqScratch[q] - f[i]) * invPlus;
      continue;
    }
    const j = base + opp;
    const symmetric = 0.5 * (f[i] + f[j]);
    const antisymmetric = 0.5 * (f[i] - f[j]);
    const symmetricEq = 0.5 * (feqScratch[q] + feqScratch[opp]);
    const antisymmetricEq = 0.5 * (feqScratch[q] - feqScratch[opp]);
    const nextSymmetric = symmetric - (symmetric - symmetricEq) * invPlus;
    const nextAntisymmetric = antisymmetric - (antisymmetric - antisymmetricEq) * invMinus;
    f[i] = nextSymmetric + nextAntisymmetric;
    f[j] = nextSymmetric - nextAntisymmetric;
  }
}

export function stepLbm(sim: Lbm) {
  const { nx, ny, nz, solid, uIn } = sim;
  const n = nx * ny * nz;
  const f = sim.pull;
  const g = sim.push;
  g.fill(0);
  for (let i = 0; i < n; i += 1) {
    if (solid[i]) {
      continue;
    }
    const base = i * Q;
    let rho = 0;
    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let q = 0; q < Q; q += 1) {
      const fq = f[base + q];
      rho += fq;
      ux += fq * CX[q];
      uy += fq * CY[q];
      uz += fq * CZ[q];
    }
    if (rho < 1e-6) {
      continue;
    }
    ux /= rho;
    uy /= rho;
    uz /= rho;
    sim.ux[i] = ux;
    sim.uy[i] = uy;
    sim.uz[i] = uz;
    collideCell(sim, f, base, rho, ux, uy, uz);
  }
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = index(nx, ny, x, y, z);
        if (solid[i]) {
          continue;
        }
        const base = i * Q;
        for (let q = 0; q < Q; q += 1) {
          const xn = x + CX[q];
          const yn = y + CY[q];
          const zn = z + CZ[q];
          const blocked = xn < 0 || yn < 0 || zn < 0 || xn >= nx || yn >= ny || zn >= nz || solid[index(nx, ny, xn, yn, zn)] === 1;
          if (blocked) {
            g[base + OPP[q]] = f[base + q];
          } else {
            g[index(nx, ny, xn, yn, zn) * Q + q] = f[base + q];
          }
        }
      }
    }
  }
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      const inlet = index(nx, ny, 0, y, z);
      if (!solid[inlet]) {
        velocityInlet(g, inlet * Q, uIn);
        sim.ux[inlet] = uIn;
        sim.uy[inlet] = 0;
        sim.uz[inlet] = 0;
      }
      if (sim.outletOpen) {
        const outlet = index(nx, ny, nx - 1, y, z);
        if (!solid[outlet]) {
          const upstream = index(nx, ny, nx - 2, y, z);
          const ux = solid[upstream] ? sim.uIn : sim.ux[upstream];
          const uy = solid[upstream] ? 0 : sim.uy[upstream];
          const uz = solid[upstream] ? 0 : sim.uz[upstream];
          equilibrium(1, ux, uy, uz, g, outlet * Q);
          sim.ux[outlet] = ux;
          sim.uy[outlet] = uy;
          sim.uz[outlet] = uz;
        }
      }
    }
  }
  sim.pull = g;
  sim.push = f;
  advectParticles(sim);
}

export function sampleCell(sim: Lbm, x: number, y: number, z: number): { solid: boolean; ux: number } | null {
  const gx = Math.floor((x - sim.originX) / sim.spacing);
  const gy = Math.floor((y - sim.originY) / sim.spacing);
  const gz = Math.floor((z - sim.originZ) / sim.spacing);
  if (gx < 0 || gy < 0 || gz < 0 || gx >= sim.nx || gy >= sim.ny || gz >= sim.nz) {
    return null;
  }
  const i = index(sim.nx, sim.ny, gx, gy, gz);
  return { solid: sim.solid[i] === 1, ux: sim.ux[i] };
}

function transformedPositions(mesh: TriangleMesh, yaw: number, pitch: number, roll: number): Float32Array {
  const euler = eulerFromAngles(yaw, pitch, roll);
  const vector = new THREE.Vector3();
  const world = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    vector.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]).applyEuler(euler);
    world[i] = vector.x;
    world[i + 1] = vector.y;
    world[i + 2] = vector.z;
  }
  return world;
}

function boundsOf(positions: Float32Array) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function separated(min: number, max: number, radius: number): boolean {
  return min > radius || max < -radius;
}

/** Triangle versus a box centered at the origin. Vertices are already relative to that center. */
function triangleCutsBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  if (separated(Math.min(ax, bx, cx), Math.max(ax, bx, cx), hx)) {
    return false;
  }
  if (separated(Math.min(ay, by, cy), Math.max(ay, by, cy), hy)) {
    return false;
  }
  if (separated(Math.min(az, bz, cz), Math.max(az, bz, cz), hz)) {
    return false;
  }
  const e0x = bx - ax;
  const e0y = by - ay;
  const e0z = bz - az;
  const e1x = cx - ax;
  const e1y = cy - ay;
  const e1z = cz - az;
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const plane = nx * ax + ny * ay + nz * az;
  const reach = Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz;
  if (nx * nx + ny * ny + nz * nz > 1e-20 && separated(plane, plane, reach)) {
    return false;
  }
  const edges: Array<[number, number, number]> = [
    [e0x, e0y, e0z],
    [cx - bx, cy - by, cz - bz],
    [ax - cx, ay - cy, az - cz],
  ];
  const verts: Array<[number, number, number]> = [
    [ax, ay, az],
    [bx, by, bz],
    [cx, cy, cz],
  ];
  for (const [ex, ey, ez] of edges) {
    const px = verts.map((v) => ez * v[1] - ey * v[2]);
    if (separated(Math.min(...px), Math.max(...px), Math.abs(ez) * hy + Math.abs(ey) * hz)) {
      return false;
    }
    const py = verts.map((v) => ex * v[2] - ez * v[0]);
    if (separated(Math.min(...py), Math.max(...py), Math.abs(ex) * hz + Math.abs(ez) * hx)) {
      return false;
    }
    const pz = verts.map((v) => ey * v[0] - ex * v[1]);
    if (separated(Math.min(...pz), Math.max(...pz), Math.abs(ey) * hx + Math.abs(ex) * hy)) {
      return false;
    }
  }
  return true;
}

function markSurface(
  solid: Uint8Array,
  positions: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  originX: number,
  originY: number,
  originZ: number,
  spacing: number,
) {
  const half = spacing * 0.5;
  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t];
    const ay = positions[t + 1];
    const az = positions[t + 2];
    const bx = positions[t + 3];
    const by = positions[t + 4];
    const bz = positions[t + 5];
    const cx = positions[t + 6];
    const cy = positions[t + 7];
    const cz = positions[t + 8];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - originX) / spacing));
    const x1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - originX) / spacing));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - originY) / spacing));
    const y1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - originY) / spacing));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - originZ) / spacing));
    const z1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - originZ) / spacing));
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const mx = originX + (x + 0.5) * spacing;
          const my = originY + (y + 0.5) * spacing;
          const mz = originZ + (z + 0.5) * spacing;
          if (triangleCutsBox(ax - mx, ay - my, az - mz, bx - mx, by - my, bz - mz, cx - mx, cy - my, cz - mz, half, half, half)) {
            solid[index(nx, ny, x, y, z)] = 1;
          }
        }
      }
    }
  }
}

function fillInterior(solid: Uint8Array, nx: number, ny: number, nz: number) {
  const n = nx * ny * nz;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const push = (i: number) => {
    if (solid[i] || seen[i]) {
      return;
    }
    seen[i] = 1;
    queue[tail] = i;
    tail += 1;
  };
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      push(index(nx, ny, 0, y, z));
    }
  }
  if (tail === 0) {
    return;
  }
  let head = 0;
  while (head < tail) {
    const i = queue[head];
    head += 1;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    for (let q = 1; q <= 6; q += 1) {
      const xn = x + CX[q];
      const yn = y + CY[q];
      const zn = z + CZ[q];
      if (xn < 0 || yn < 0 || zn < 0 || xn >= nx || yn >= ny || zn >= nz) {
        continue;
      }
      push(index(nx, ny, xn, yn, zn));
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (!seen[i]) {
      solid[i] = 1;
    }
  }
}

function seedParticles(sim: Lbm) {
  const count = sim.particles.length / 3;
  for (let i = 0; i < count; i += 1) {
    placeParticle(sim, i, false);
  }
}

function spawnRange(min: number, max: number, inset: number): { min: number; max: number } {
  const lo = min + inset;
  const hi = max - inset;
  if (hi > lo) {
    return { min: lo, max: hi };
  }
  return { min, max };
}

function placeParticle(sim: Lbm, i: number, inletOnly: boolean) {
  const lattice = {
    minX: sim.originX,
    maxX: sim.originX + sim.spacing * sim.nx,
    minY: sim.originY,
    maxY: sim.originY + sim.spacing * sim.ny,
    minZ: sim.originZ,
    maxZ: sim.originZ + sim.spacing * sim.nz,
  };
  const xRange = spawnRange(Math.max(sim.box.minX, lattice.minX), Math.min(sim.box.maxX, lattice.maxX), sim.spacing * 0.5);
  const yRange = spawnRange(Math.max(sim.box.minY, lattice.minY), Math.min(sim.box.maxY, lattice.maxY), sim.spacing * 0.5);
  const zRange = spawnRange(Math.max(sim.box.minZ, lattice.minZ), Math.min(sim.box.maxZ, lattice.maxZ), sim.spacing * 0.5);
  const inlet = Math.min(xRange.min + sim.spacing * 1.5, xRange.max);
  const xHi = inletOnly ? inlet : xRange.max;
  const midY = (sim.box.minY + sim.box.maxY) / 2;
  const midZ = (sim.box.minZ + sim.box.maxZ) / 2;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const x = xRange.min + Math.random() * Math.max(xHi - xRange.min, 0);
    const y = sim.slice && !sim.sliceVertical ? midY : yRange.min + Math.random() * Math.max(yRange.max - yRange.min, 0);
    const z = sim.slice && sim.sliceVertical ? midZ : zRange.min + Math.random() * Math.max(zRange.max - zRange.min, 0);
    const id = cellIndex(sim, x, y, z);
    if (id < 0 || sim.solid[id] || !inBox(sim, x, y, z)) {
      continue;
    }
    sim.particles[i * 3] = x;
    sim.particles[i * 3 + 1] = y;
    sim.particles[i * 3 + 2] = z;
    resetTrail(sim, i, x, y, z);
    return;
  }
  const x = (xRange.min + inlet) / 2;
  const y = sim.slice && !sim.sliceVertical ? midY : (yRange.min + yRange.max) / 2;
  const z = sim.slice && sim.sliceVertical ? midZ : (zRange.min + zRange.max) / 2;
  sim.particles[i * 3] = x;
  sim.particles[i * 3 + 1] = y;
  sim.particles[i * 3 + 2] = z;
  resetTrail(sim, i, x, y, z);
}

export function setOutletOpen(sim: Lbm, open: boolean) {
  sim.outletOpen = open;
}

export function setRecordTrails(sim: Lbm, enabled: boolean) {
  sim.recordTrails = enabled;
  if (!enabled) {
    return;
  }
  for (let i = 0; i < sim.particleCount; i += 1) {
    resetTrail(sim, i, sim.particles[i * 3], sim.particles[i * 3 + 1], sim.particles[i * 3 + 2]);
  }
}

export function setParticleSlice(sim: Lbm, enabled: boolean, vertical = false) {
  const wasEnabled = sim.slice;
  const wasVertical = sim.sliceVertical;
  sim.slice = enabled;
  sim.sliceVertical = enabled && vertical;
  const midY = (sim.box.minY + sim.box.maxY) / 2;
  const midZ = (sim.box.minZ + sim.box.maxZ) / 2;
  for (let i = 0; i < sim.particleCount; i += 1) {
    const x = sim.particles[i * 3];
    let y = sim.particles[i * 3 + 1];
    let z = sim.particles[i * 3 + 2];
    if (sim.slice && sim.sliceVertical) {
      z = midZ;
      if (wasEnabled && !wasVertical) {
        y = sim.box.minY + Math.random() * (sim.box.maxY - sim.box.minY);
      }
    } else if (sim.slice) {
      y = midY;
      if (wasEnabled && wasVertical) {
        z = sim.box.minZ + Math.random() * (sim.box.maxZ - sim.box.minZ);
      }
    } else if (wasEnabled) {
      if (wasVertical) {
        z = sim.box.minZ + Math.random() * (sim.box.maxZ - sim.box.minZ);
      } else {
        y = sim.box.minY + Math.random() * (sim.box.maxY - sim.box.minY);
      }
    }
    sim.particles[i * 3 + 1] = y;
    sim.particles[i * 3 + 2] = z;
    resetTrail(sim, i, x, y, z);
  }
  if (!sim.slice) {
    return;
  }
  let kept = 0;
  for (let i = 0; i < sim.stuckCount; i += 1) {
    const y = sim.stuck[i * 3 + 1];
    const z = sim.stuck[i * 3 + 2];
    const onPlane = sim.sliceVertical ? Math.abs(z - midZ) <= sim.spacing * 0.25 : Math.abs(y - midY) <= sim.spacing * 0.25;
    if (!onPlane) {
      continue;
    }
    if (kept !== i) {
      sim.stuck[kept * 3] = sim.stuck[i * 3];
      sim.stuck[kept * 3 + 1] = y;
      sim.stuck[kept * 3 + 2] = z;
    }
    kept += 1;
  }
  sim.stuckCount = kept;
}

function resetTrail(sim: Lbm, i: number, x: number, y: number, z: number) {
  const base = i * TRAIL * 3;
  for (let k = 0; k < TRAIL; k += 1) {
    sim.trail[base + k * 3] = x;
    sim.trail[base + k * 3 + 1] = y;
    sim.trail[base + k * 3 + 2] = z;
  }
}

function pushTrail(sim: Lbm, fromIndex: number, toIndex: number, x: number, y: number, z: number) {
  const from = fromIndex * TRAIL * 3;
  const to = toIndex * TRAIL * 3;
  for (let k = TRAIL - 1; k > 0; k -= 1) {
    sim.trail[to + k * 3] = sim.trail[from + (k - 1) * 3];
    sim.trail[to + k * 3 + 1] = sim.trail[from + (k - 1) * 3 + 1];
    sim.trail[to + k * 3 + 2] = sim.trail[from + (k - 1) * 3 + 2];
  }
  sim.trail[to] = x;
  sim.trail[to + 1] = y;
  sim.trail[to + 2] = z;
}

export function writeTurnColors(sim: Lbm, out: Float32Array) {
  for (let i = 0; i < sim.particleCount; i += 1) {
    const x = sim.particles[i * 3];
    const y = sim.particles[i * 3 + 1];
    const z = sim.particles[i * 3 + 2];
    const gx = Math.floor((x - sim.originX) / sim.spacing);
    const gy = Math.floor((y - sim.originY) / sim.spacing);
    const gz = Math.floor((z - sim.originZ) / sim.spacing);
    let strength = 0;
    if (gx >= 0 && gy >= 0 && gz >= 0 && gx < sim.nx && gy < sim.ny && gz < sim.nz) {
      const id = index(sim.nx, sim.ny, gx, gy, gz);
      if (!sim.solid[id]) {
        strength = turnStrength(sim.ux[id], sim.uy[id], sim.uz[id]);
      }
    }
    writeTurn(strength, out, i * 3);
  }
  for (let i = 0; i < sim.stuckCount; i += 1) {
    writeTurn(0, out, (sim.particleCount + i) * 3);
  }
}

export function writeDrawnParticles(sim: Lbm, out: Float32Array): number {
  const moving = sim.particleCount;
  out.set(sim.particles.subarray(0, moving * 3), 0);
  out.set(sim.stuck.subarray(0, sim.stuckCount * 3), moving * 3);
  return moving + sim.stuckCount;
}

export type Heatmap = {
  width: number;
  height: number;
  vertical: boolean;
  row: number;
  y: number;
  z: number;
  originX: number;
  originY: number;
  originZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

function fluidVelocity(sim: Lbm, x: number, y: number, z: number, axis: 0 | 1 | 2): number | null {
  if (x < 0 || y < 0 || z < 0 || x >= sim.nx || y >= sim.ny || z >= sim.nz) {
    return null;
  }
  const id = index(sim.nx, sim.ny, x, y, z);
  if (sim.solid[id]) {
    return null;
  }
  if (axis === 0) {
    return sim.ux[id];
  }
  if (axis === 1) {
    return sim.uy[id];
  }
  return sim.uz[id];
}

function shear(sim: Lbm, x: number, y: number, z: number, axis: 0 | 1 | 2, dx: number, dy: number, dz: number): number {
  const center = fluidVelocity(sim, x, y, z, axis) ?? 0;
  const plus = fluidVelocity(sim, x + dx, y + dy, z + dz, axis) ?? center;
  const minus = fluidVelocity(sim, x - dx, y - dy, z - dz, axis) ?? center;
  return 0.5 * (plus - minus);
}

function vorticity(sim: Lbm, x: number, y: number, z: number): number {
  const wx = shear(sim, x, y, z, 1, 0, 0, 1) - shear(sim, x, y, z, 2, 0, 1, 0);
  const wy = shear(sim, x, y, z, 2, 0, 0, 1) - shear(sim, x, y, z, 0, 1, 0, 0);
  const wz = shear(sim, x, y, z, 0, 0, 1, 0) - shear(sim, x, y, z, 1, 1, 0, 0);
  return Math.hypot(wx, wy, wz);
}

function midIndex(mid: number, origin: number, spacing: number, count: number): number {
  let row = Math.round((mid - origin) / spacing - 0.5);
  if (row < 1) {
    row = 1;
  }
  if (row > count - 2) {
    row = count - 2;
  }
  return row;
}

function paintHeatCell(sim: Lbm, rgba: Uint8Array, x: number, y: number, z: number, pixel: number, scale: number, sample: Float32Array) {
  const id = index(sim.nx, sim.ny, x, y, z);
  if (sim.solid[id]) {
    rgba[pixel] = 41;
    rgba[pixel + 1] = 112;
    rgba[pixel + 2] = 219;
    rgba[pixel + 3] = 40;
    return;
  }
  writeTurn(Math.min(1, vorticity(sim, x, y, z) / scale), sample, 0);
  rgba[pixel] = Math.round(sample[0] * 255);
  rgba[pixel + 1] = Math.round(sample[1] * 255);
  rgba[pixel + 2] = Math.round(sample[2] * 255);
  rgba[pixel + 3] = 150;
}

export function writeHeatmap(sim: Lbm, rgba: Uint8Array, vertical = false): Heatmap {
  const scale = Math.max(sim.uIn, 0.02);
  const sample = new Float32Array(3);
  const width = sim.nx;
  const height = vertical ? sim.ny : sim.nz;
  const rowY = midIndex((sim.box.minY + sim.box.maxY) / 2, sim.originY, sim.spacing, sim.ny);
  const rowZ = midIndex((sim.box.minZ + sim.box.maxZ) / 2, sim.originZ, sim.spacing, sim.nz);
  const row = vertical ? rowZ : rowY;
  for (let v = 0; v < height; v += 1) {
    for (let x = 0; x < width; x += 1) {
      const y = vertical ? v : row;
      const z = vertical ? row : v;
      paintHeatCell(sim, rgba, x, y, z, (v * width + x) * 4, scale, sample);
    }
  }
  return {
    width,
    height,
    vertical,
    row,
    y: sim.originY + (rowY + 0.5) * sim.spacing,
    z: sim.originZ + (rowZ + 0.5) * sim.spacing,
    originX: sim.originX,
    originY: sim.originY,
    originZ: sim.originZ,
    sizeX: sim.nx * sim.spacing,
    sizeY: sim.ny * sim.spacing,
    sizeZ: sim.nz * sim.spacing,
  };
}

export function sampleTrails(sim: Lbm) {
  if (!sim.recordTrails) {
    return;
  }
  const minMove = sim.spacing * 0.7;
  const minMoveSq = minMove * minMove;
  for (let i = 0; i < sim.particleCount; i += 1) {
    const x = sim.particles[i * 3];
    const y = sim.particles[i * 3 + 1];
    const z = sim.particles[i * 3 + 2];
    const head = i * TRAIL * 3;
    const dx = x - sim.trail[head];
    const dy = y - sim.trail[head + 1];
    const dz = z - sim.trail[head + 2];
    if (dx * dx + dy * dy + dz * dz < minMoveSq) {
      continue;
    }
    pushTrail(sim, i, i, x, y, z);
  }
}

export function writeTrailSegments(sim: Lbm, out: Float32Array): number {
  let segments = 0;
  for (let i = 0; i < sim.particleCount; i += 1) {
    for (let k = 0; k < TRAIL - 1; k += 1) {
      const a = (i * TRAIL + k) * 3;
      const b = a + 3;
      const dx = sim.trail[a] - sim.trail[b];
      const dy = sim.trail[a + 1] - sim.trail[b + 1];
      const dz = sim.trail[a + 2] - sim.trail[b + 2];
      if (dx * dx + dy * dy + dz * dz < 1e-12) {
        continue;
      }
      const offset = segments * 6;
      if (offset + 6 > out.length) {
        return segments;
      }
      out[offset] = sim.trail[a];
      out[offset + 1] = sim.trail[a + 1];
      out[offset + 2] = sim.trail[a + 2];
      out[offset + 3] = sim.trail[b];
      out[offset + 4] = sim.trail[b + 1];
      out[offset + 5] = sim.trail[b + 2];
      segments += 1;
    }
  }
  return segments;
}

function cellIndex(sim: Lbm, x: number, y: number, z: number): number {
  const gx = Math.floor((x - sim.originX) / sim.spacing);
  const gy = Math.floor((y - sim.originY) / sim.spacing);
  const gz = Math.floor((z - sim.originZ) / sim.spacing);
  if (gx < 0 || gy < 0 || gz < 0 || gx >= sim.nx || gy >= sim.ny || gz >= sim.nz) {
    return -1;
  }
  return index(sim.nx, sim.ny, gx, gy, gz);
}

function inBox(sim: Lbm, x: number, y: number, z: number): boolean {
  return x >= sim.box.minX && x < sim.box.maxX && y >= sim.box.minY && y < sim.box.maxY && z >= sim.box.minZ && z < sim.box.maxZ;
}

function isSolid(sim: Lbm, x: number, y: number, z: number): boolean {
  const id = cellIndex(sim, x, y, z);
  return id >= 0 && sim.solid[id] === 1;
}

function rayHit(
  tris: Float32Array,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): { x: number; y: number; z: number } | null {
  if (dx * dx + dy * dy + dz * dz < 1e-16 || !(maxT > 0)) {
    return null;
  }
  let best = maxT;
  let hx = 0;
  let hy = 0;
  let hz = 0;
  let found = false;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i];
    const ay = tris[i + 1];
    const az = tris[i + 2];
    const e1x = tris[i + 3] - ax;
    const e1y = tris[i + 4] - ay;
    const e1z = tris[i + 5] - az;
    const e2x = tris[i + 6] - ax;
    const e2y = tris[i + 7] - ay;
    const e2z = tris[i + 8] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-8 && det < 1e-8) {
      continue;
    }
    const inv = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) {
      continue;
    }
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) {
      continue;
    }
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-4 && t < best) {
      best = t;
      hx = ox + dx * t;
      hy = oy + dy * t;
      hz = oz + dz * t;
      found = true;
    }
  }
  if (!found) {
    return null;
  }
  return { x: hx, y: hy, z: hz };
}

function park(sim: Lbm, x: number, y: number, z: number) {
  if (sim.stuckCount >= sim.stuck.length / 3) {
    return;
  }
  const offset = sim.stuckCount * 3;
  sim.stuck[offset] = x;
  sim.stuck[offset + 1] = y;
  sim.stuck[offset + 2] = z;
  sim.stuckCount += 1;
}

function advectParticles(sim: Lbm) {
  let write = 0;
  const count = sim.particleCount;
  for (let i = 0; i < count; i += 1) {
    const x = sim.particles[i * 3];
    const y = sim.particles[i * 3 + 1];
    const z = sim.particles[i * 3 + 2];
    const id = cellIndex(sim, x, y, z);
    if (id < 0 || sim.solid[id]) {
      continue;
    }
    const vx = sim.ux[id];
    const vy = sim.uy[id];
    const vz = sim.uz[id];
    const nextX = x + vx * sim.spacing;
    const nextY = sim.slice && !sim.sliceVertical ? (sim.box.minY + sim.box.maxY) / 2 : y + vy * sim.spacing;
    const nextZ = sim.slice && sim.sliceVertical ? (sim.box.minZ + sim.box.maxZ) / 2 : z + vz * sim.spacing;
    const hit = isSolid(sim, nextX, nextY, nextZ) ? rayHit(sim.surface, x, y, z, 1, 0, 0, sim.spacing * 2) : null;
    if (hit) {
      if (inBox(sim, hit.x, hit.y, hit.z)) {
        park(sim, hit.x, hit.y, hit.z);
      }
      continue;
    }
    if (!inBox(sim, nextX, nextY, nextZ) || isSolid(sim, nextX, nextY, nextZ)) {
      continue;
    }
    sim.particles[write * 3] = nextX;
    sim.particles[write * 3 + 1] = nextY;
    sim.particles[write * 3 + 2] = nextZ;
    if (sim.recordTrails && i !== write) {
      sim.trail.copyWithin(write * TRAIL * 3, i * TRAIL * 3, (i + 1) * TRAIL * 3);
    }
    write += 1;
  }
  const target = sim.particles.length / 3;
  const budget = Math.min(target, write + RESPAWNS_PER_STEP);
  while (write < budget) {
    placeParticle(sim, write, true);
    write += 1;
  }
  sim.particleCount = write;
}
