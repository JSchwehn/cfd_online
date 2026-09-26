import { describe, expect, it } from "vitest";
// @ts-expect-error Node fs types are not in this tsconfig
import { readFileSync } from "fs";
import type { TriangleMesh } from "../src/case";
import { AIR_TAU, createLbm, gridForResolution, RESPAWNS_PER_STEP, sampleCell, sampleTrails, setOutletOpen, setParticleCount, setParticleSlice, setRecordTrails, stepLbm, tauMinus, TRAIL, turnColor, turnStrength, writeDrawnParticles, writeHeatmap, writeTrailSegments } from "../src/lbm";
import { showRotationGizmo } from "../src/sim";

function plate(): TriangleMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array(9),
  };
}

function quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): number[] {
  return [ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz];
}

function cube(): TriangleMesh {
  const positions = new Float32Array([
    ...quad(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0),
    ...quad(0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1),
    ...quad(0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1),
    ...quad(1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0),
    ...quad(0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0),
    ...quad(0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1),
  ]);
  return { positions, normals: new Float32Array(positions.length) };
}

function wall(): TriangleMesh {
  const positions = new Float32Array([
    0, -2, -2, 0, 2, -2, 0, -2, 2,
    0, 2, -2, 0, 2, 2, 0, -2, 2,
  ]);
  return { positions, normals: new Float32Array(positions.length) };
}

describe("simulation settings", () => {
  it("offers resolution and particle count in the form", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<input id="simplify" type="range" min="0" max="100" step="1" value="0"');
    expect(html).toContain('id="simplify-label">aus</span>');
    expect(html).toContain('<select id="model">');
    expect(html).toContain('<option value="bgk">BGK</option>');
    expect(html).toContain('<option value="trt" selected>TRT</option>');
    expect(html).not.toContain("Panel");
    expect(html).not.toContain('value="rans"');
    expect(html).toContain("Normalnull");
    expect(html).toContain("RANS");
    expect(html).toContain("setzt sie zurück");
    expect(html).toContain('<select id="resolution">');
    expect(html).toContain('<option value="medium" selected>mittel</option>');
    expect(html).not.toContain('id="swirl"');
    expect(html).toContain('<input id="particles" type="range" min="80" max="1600" step="40" value="480"');
    expect(html).toContain('id="particle-count">480</span>');
    expect(html).toContain('id="outlet-open" type="checkbox" checked');
    expect(html).toContain("Ausgang offen");
    expect(html).toContain("Stirnwand fehlt");
    expect(html).toContain('id="turn-color" type="checkbox"');
    expect(html).not.toMatch(/id="turn-color"[^>]*\bchecked\b/);
    expect(html).toContain('id="slice" type="checkbox"');
    expect(html).not.toMatch(/id="slice"[^>]*\bchecked\b/);
    expect(html).toContain('id="slice-turn" type="checkbox"');
    expect(html).not.toMatch(/id="slice-turn"[^>]*\bchecked\b/);
    expect(html).toContain("Mittelebene 90°");
    expect(html).toContain("auch wenn die liegende Mittelebene aus ist");
    expect(html).toContain('id="trails" type="checkbox"');
    expect(html).not.toMatch(/id="trails"[^>]*\bchecked\b/);
    expect(html).toContain('id="heatmap" type="checkbox"');
    expect(html).not.toMatch(/id="heatmap"[^>]*\bchecked\b/);
    expect(html).toContain('id="heatmap-turn" type="checkbox"');
    expect(html).not.toMatch(/id="heatmap-turn"[^>]*\bchecked\b/);
    expect(html).toContain("Heatmap 90°");
    expect(html).toContain("senkrecht vor das Bauteil");
    expect(html).not.toContain('id="wake"');
    expect(html).toContain("bleiben an der Oberfläche liegen");
    expect(html).toContain("gleich schnell bleibt");
    expect(html).toContain("schläft nicht ein");
    expect(html).toContain("Jede Zelle, die ein Dreieck schneidet");
  });

  it("marks the cells a slanted triangle cuts and leaves the air beside it", () => {
    const positions = new Float32Array([-1, -1, -1, 1, -1, 1, 0, 1, 0]);
    const sim = createLbm({
      mesh: { positions, normals: new Float32Array(9) },
      yaw: 0,
      pitch: 0,
      roll: 0,
      speedMps: 10,
      cells: 24,
      limit: 30000,
      particles: 1,
    });
    expect(sampleCell(sim, 0, -1 / 3, 0)?.solid).toBe(true);
    const step = sim.spacing * 3;
    expect(sampleCell(sim, -step * 0.707, -1 / 3, step * 0.707)?.solid).toBe(false);
  });

  it("keeps a closed body solid and the air in front of it fluid", () => {
    const sim = createLbm({ mesh: cube(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 16, limit: 8000, particles: 1 });
    expect(sampleCell(sim, 0.5, 0.5, 0.5)?.solid).toBe(true);
    expect(sampleCell(sim, -sim.spacing * 2, 0.5, 0.5)?.solid).toBe(false);
  });

  it("parks a particle on the surface instead of the cell in front", () => {
    const sim = createLbm({ mesh: wall(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 18, limit: 8000, particles: 1 });
    let placed = Number.NaN;
    for (let gx = 1; gx < sim.nx - 2; gx += 1) {
      const x = sim.originX + (gx + 0.97) * sim.spacing;
      const here = sampleCell(sim, x, 0, 0);
      const ahead = sampleCell(sim, x + sim.spacing * 0.2, 0, 0);
      if (here && !here.solid && ahead?.solid) {
        placed = x;
        break;
      }
    }
    expect(Number.isNaN(placed)).toBe(false);
    sim.particles[0] = placed;
    sim.particles[1] = 0;
    sim.particles[2] = 0;
    sim.particleCount = 1;
    stepLbm(sim);
    expect(sim.stuckCount).toBe(1);
    expect(sim.stuck[0]).toBeCloseTo(0, 3);
    expect(sim.stuck[0]).toBeGreaterThan(placed);
    const drawn = new Float32Array(12);
    expect(writeDrawnParticles(sim, drawn)).toBe(sim.particleCount + 1);
    expect(drawn[sim.particleCount * 3]).toBeCloseTo(0, 3);
  });

  it("leaves a free-stream particle in the flow", () => {
    const sim = createLbm({ mesh: wall(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 18, limit: 8000, particles: 1 });
    const x = sim.originX + sim.spacing * 2;
    expect(sampleCell(sim, x, 0, 0)?.solid).toBe(false);
    expect(sampleCell(sim, x + sim.spacing, 0, 0)?.solid).toBe(false);
    sim.particles[0] = x;
    sim.particles[1] = 0;
    sim.particles[2] = 0;
    sim.particleCount = 1;
    stepLbm(sim);
    expect(sim.stuckCount).toBe(0);
    let moved = 0;
    for (let i = 0; i < sim.particleCount; i += 1) {
      const px = sim.particles[i * 3];
      if (px > x && px < x + sim.spacing) {
        moved += 1;
      }
    }
    expect(moved).toBe(1);
  });

  it("blocks the outlet when it is closed", () => {
    const input = { mesh: cube(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 16, limit: 8000, particles: 1 };
    const open = createLbm(input);
    const shut = createLbm(input);
    expect(open.outletOpen).toBe(true);
    setOutletOpen(shut, false);
    for (let step = 0; step < 40; step += 1) {
      stepLbm(open);
      stepLbm(shut);
    }
    const y = Math.floor(open.ny / 2);
    const z = Math.floor(open.nz / 2);
    const i = open.nx - 2 + open.nx * (y + open.ny * z);
    expect(open.solid[i]).toBe(0);
    expect(open.ux[i]).toBeGreaterThan(shut.ux[i] + 0.005);
  });

  it("does not paint the open outlet as a wall", () => {
    const sim = createLbm({ mesh: cube(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 16, limit: 8000, particles: 1, model: "bgk" });
    const y = Math.floor(sim.ny / 2);
    const z = Math.floor(sim.nz / 2);
    const uy = 0.02;
    const weight = [1 / 3, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
    const cy = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
    for (let zz = 0; zz < sim.nz; zz += 1) {
      for (let yy = 0; yy < sim.ny; yy += 1) {
        for (let x = sim.nx - 3; x < sim.nx; x += 1) {
          const i = x + sim.nx * (yy + sim.ny * zz);
          if (sim.solid[i]) {
            continue;
          }
          for (let q = 0; q < 19; q += 1) {
            sim.pull[i * 19 + q] += weight[q] * 3 * cy[q] * uy;
          }
        }
      }
    }
    stepLbm(sim);
    const outlet = sim.nx - 1 + sim.nx * (y + sim.ny * z);
    expect(Math.abs(sim.uy[outlet])).toBeGreaterThan(0.005);
    const rgba = new Uint8Array(sim.nx * sim.ny * 4);
    writeHeatmap(sim, rgba, true);
    const edge = (y * sim.nx + sim.nx - 1) * 4;
    expect(rgba[edge + 2]).toBeGreaterThan(rgba[edge]);
  });

  it("keeps the wind from dying down", () => {
    const sim = createLbm({ mesh: cube(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 16, limit: 8000, particles: 4 });
    for (let step = 0; step < 400; step += 1) {
      stepLbm(sim);
    }
    let sum = 0;
    let count = 0;
    for (let z = 0; z < sim.nz; z += 1) {
      for (let y = 0; y < sim.ny; y += 1) {
        const i = 2 + sim.nx * (y + sim.ny * z);
        if (sim.solid[i]) {
          continue;
        }
        sum += sim.ux[i];
        count += 1;
      }
    }
    const mean = sum / count;
    expect(mean).toBeGreaterThan(sim.uIn * 0.7);
    expect(mean).toBeLessThan(sim.uIn * 1.5);
  });

  it("relaxes TRT apart from BGK", () => {
    expect(tauMinus(AIR_TAU)).toBeGreaterThan(AIR_TAU);
    const input = { mesh: wall(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 1 };
    const bgk = createLbm({ ...input, model: "bgk" });
    const trt = createLbm({ ...input, model: "trt" });
    expect(trt.tauMinus).toBeCloseTo(tauMinus(AIR_TAU));
    for (let step = 0; step < 30; step += 1) {
      stepLbm(bgk);
      stepLbm(trt);
    }
    let diff = 0;
    for (let i = 0; i < bgk.ux.length; i += 1) {
      diff += Math.abs(bgk.ux[i] - trt.ux[i]);
    }
    expect(diff).toBeGreaterThan(1e-6);
  });

  it("places the tunnel walls outside the drawn box", () => {
    const sim = createLbm({ mesh: cube(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 20, limit: 30000, particles: 1 });
    const y = (sim.box.maxY + sim.originY + sim.ny * sim.spacing) / 2;
    const cell = sampleCell(sim, 0, y, 0);
    expect(y).toBeGreaterThan(sim.box.maxY);
    expect(y).toBeLessThan(sim.originY + sim.ny * sim.spacing);
    expect(cell?.solid).toBe(false);
    expect(sim.box.maxX).toBeGreaterThan(-sim.box.minX);
  });

  it("paints a calm field blue and a shear layer red", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 1 });
    const rgba = new Uint8Array(sim.nx * sim.nz * 4);
    const calm = writeHeatmap(sim, rgba);
    expect(calm.vertical).toBe(false);
    let calmRed = 255;
    let calmBlue = 0;
    for (let z = 1; z < sim.nz - 1; z += 1) {
      for (let x = 1; x < sim.nx - 1; x += 1) {
        const pixel = (z * sim.nx + x) * 4;
        if (rgba[pixel + 3] === 0) {
          continue;
        }
        calmRed = rgba[pixel];
        calmBlue = rgba[pixel + 2];
        break;
      }
    }
    expect(calmBlue).toBeGreaterThan(calmRed);
    const x = Math.min(sim.nx - 2, 4);
    const z = Math.min(sim.nz - 2, 4);
    const above = x + sim.nx * (calm.row + 1 + sim.ny * z);
    const below = x + sim.nx * (calm.row - 1 + sim.ny * z);
    const center = x + sim.nx * (calm.row + sim.ny * z);
    sim.solid[above] = 0;
    sim.solid[below] = 0;
    sim.solid[center] = 0;
    sim.ux[above] = 0.3;
    sim.ux[below] = 0;
    writeHeatmap(sim, rgba);
    const hot = (z * sim.nx + x) * 4;
    expect(rgba[hot]).toBeGreaterThan(calmRed);
  });

  it("turns the heatmap upright around the wind", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 1 });
    const rgba = new Uint8Array(sim.nx * sim.ny * 4);
    const layout = writeHeatmap(sim, rgba, true);
    const midZ = (sim.box.minZ + sim.box.maxZ) / 2;
    expect(layout.vertical).toBe(true);
    expect(layout.width).toBe(sim.nx);
    expect(layout.height).toBe(sim.ny);
    expect(Math.abs(layout.z - midZ)).toBeLessThan(sim.spacing);
    const x = Math.min(sim.nx - 2, 4);
    const y = Math.min(sim.ny - 2, 4);
    const above = x + sim.nx * (y + 1 + sim.ny * layout.row);
    const below = x + sim.nx * (y - 1 + sim.ny * layout.row);
    const center = x + sim.nx * (y + sim.ny * layout.row);
    sim.solid[above] = 0;
    sim.solid[below] = 0;
    sim.solid[center] = 0;
    sim.ux[above] = 0.3;
    sim.ux[below] = 0;
    writeHeatmap(sim, rgba, true);
    const hot = (y * sim.nx + x) * 4;
    expect(rgba[hot]).toBeGreaterThan(rgba[hot + 2]);
  });

  it("colors straight flow blue and sideways flow red", () => {
    expect(turnStrength(0.05, 0, 0)).toBe(0);
    expect(turnStrength(0, 0.04, 0.03)).toBeCloseTo(1);
    const calm = turnColor(0);
    const spun = turnColor(1);
    expect(calm.b).toBeGreaterThan(calm.r);
    expect(spun.r).toBeGreaterThan(spun.b);
  });

  it("draws a mid-plane slice and a trail after a step", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 6, slice: true });
    const mid = (sim.box.minY + sim.box.maxY) / 2;
    stepLbm(sim);
    for (let i = 0; i < sim.particleCount; i += 1) {
      expect(sim.particles[i * 3 + 1]).toBeCloseTo(mid);
    }
    setParticleSlice(sim, false);
    let offPlane = 0;
    for (let i = 0; i < sim.particleCount; i += 1) {
      if (Math.abs(sim.particles[i * 3 + 1] - mid) > sim.spacing) {
        offPlane += 1;
      }
    }
    expect(offPlane).toBeGreaterThan(0);
    sim.stuck[0] = 0;
    sim.stuck[1] = mid;
    sim.stuck[2] = sim.box.maxZ;
    sim.stuckCount = 1;
    setParticleSlice(sim, true, true);
    expect(sim.stuckCount).toBe(0);
    const midZ = (sim.box.minZ + sim.box.maxZ) / 2;
    stepLbm(sim);
    let offY = 0;
    for (let i = 0; i < sim.particleCount; i += 1) {
      expect(sim.particles[i * 3 + 2]).toBeCloseTo(midZ);
      if (Math.abs(sim.particles[i * 3 + 1] - mid) > sim.spacing) {
        offY += 1;
      }
    }
    expect(offY).toBeGreaterThan(0);
    setParticleSlice(sim, true);
    const before = sim.particles[0];
    setRecordTrails(sim, true);
    sim.particles[0] = before + sim.spacing;
    sampleTrails(sim);
    const buffer = new Float32Array(sim.particleCount * (TRAIL - 1) * 6);
    expect(writeTrailSegments(sim, buffer)).toBeGreaterThan(0);
    expect(buffer[0] - buffer[3]).toBeGreaterThan(sim.spacing * 0.5);
  });

  it("refills only a limited number of particles per step", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: RESPAWNS_PER_STEP + 20 });
    for (let i = 0; i < sim.particleCount; i += 1) {
      sim.particles[i * 3] = sim.box.maxX + sim.spacing;
    }
    stepLbm(sim);
    expect(sim.particleCount).toBe(RESPAWNS_PER_STEP);
  });

  it("uses a finer grid for the fine preset", () => {
    expect(gridForResolution("coarse").cells).toBeLessThan(gridForResolution("medium").cells);
    expect(gridForResolution("medium").limit).toBeLessThan(gridForResolution("fine").limit);
    const mesh = plate();
    const coarse = createLbm({ mesh, yaw: 0, pitch: 0, roll: 0, speedMps: 10, resolution: "coarse", particles: 4 });
    const fine = createLbm({ mesh, yaw: 0, pitch: 0, roll: 0, speedMps: 10, resolution: "fine", particles: 4 });
    expect(fine.nx * fine.ny * fine.nz).toBeGreaterThan(coarse.nx * coarse.ny * coarse.nz);
    expect(createLbm({ mesh, yaw: 0, pitch: 0, roll: 0, speedMps: 10, particles: 4 }).tau).toBe(AIR_TAU);
  });

  it("resizes the particle buffer without rebuilding the grid", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 8 });
    const cells = sim.nx * sim.ny * sim.nz;
    setParticleCount(sim, 20);
    expect(sim.particles.length / 3).toBe(20);
    setParticleCount(sim, 5);
    expect(sim.particles.length / 3).toBe(5);
    expect(sim.particleCount).toBe(5);
    expect(sim.nx * sim.ny * sim.nz).toBe(cells);
  });

  it("seeds particles inside the visible box", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 24 });
    for (let i = 0; i < sim.particleCount; i += 1) {
      const x = sim.particles[i * 3];
      const y = sim.particles[i * 3 + 1];
      const z = sim.particles[i * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(sim.box.minX);
      expect(x).toBeLessThan(sim.box.maxX);
      expect(y).toBeGreaterThanOrEqual(sim.box.minY);
      expect(y).toBeLessThan(sim.box.maxY);
      expect(z).toBeGreaterThanOrEqual(sim.box.minZ);
      expect(z).toBeLessThan(sim.box.maxZ);
    }
  });

  it("replaces particles that leave so the inlet stays filled", () => {
    const sim = createLbm({ mesh: plate(), yaw: 0, pitch: 0, roll: 0, speedMps: 10, cells: 12, limit: 4000, particles: 3 });
    const inletMax = Math.max(sim.box.minX, sim.originX) + sim.spacing * 2.2;
    let insideX = 0;
    let y = 0;
    let z = 0;
    let found = false;
    for (let gx = 2; gx < sim.nx - 1 && !found; gx += 1) {
      for (let gy = 1; gy < sim.ny - 1 && !found; gy += 1) {
        for (let gz = 1; gz < sim.nz - 1 && !found; gz += 1) {
          const px = sim.originX + (gx + 0.5) * sim.spacing;
          const py = sim.originY + (gy + 0.5) * sim.spacing;
          const pz = sim.originZ + (gz + 0.5) * sim.spacing;
          const cell = sampleCell(sim, px, py, pz);
          if (cell && !cell.solid && px > inletMax && px < sim.box.maxX - sim.spacing) {
            insideX = px;
            y = py;
            z = pz;
            found = true;
          }
        }
      }
    }
    expect(found).toBe(true);
    sim.particles[0] = insideX;
    sim.particles[1] = y;
    sim.particles[2] = z;
    sim.particles[3] = sim.box.maxX + sim.spacing;
    sim.particles[4] = y;
    sim.particles[5] = z;
    sim.particles[6] = sim.box.maxX + sim.spacing;
    sim.particles[7] = y;
    sim.particles[8] = z;
    sim.particleCount = 3;
    stepLbm(sim);
    expect(sim.particleCount).toBe(3);
    let moved = 0;
    let replaced = 0;
    for (let i = 0; i < sim.particleCount; i += 1) {
      const x = sim.particles[i * 3];
      expect(x).toBeGreaterThanOrEqual(sim.box.minX);
      expect(x).toBeLessThan(sim.box.maxX);
      if (x > insideX) {
        moved += 1;
      }
      if (x < inletMax) {
        replaced += 1;
      }
    }
    expect(moved).toBe(1);
    expect(replaced).toBe(2);
  });
});

describe("rotation gizmo", () => {
  it("hides the gizmo while a simulation is active", () => {
    expect(showRotationGizmo(true, false, false)).toBe(true);
    expect(showRotationGizmo(true, false, true)).toBe(false);
    expect(showRotationGizmo(true, true, false)).toBe(false);
    expect(showRotationGizmo(false, false, false)).toBe(false);
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("Während der Rechnung ist das Drehkreuz ausgeblendet.");
  });
});
