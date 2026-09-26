import { describe, expect, it } from "vitest";
import { fileKind, meshFromStl } from "../src/load-stl";
import { boundingSize, flowBox, simplifyLabel, simplifyMesh, triangleCount } from "../src/mesh";
import type { TriangleMesh } from "../src/case";

const triangleStl = `solid tri
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 2 0 0
      vertex 2 2 0
    endloop
  endfacet
endsolid tri
`;

describe("fileKind", () => {
  it("accepts stl and step names", () => {
    expect(fileKind("teil.STL")).toBe("stl");
    expect(fileKind("teil.stp")).toBe("step");
    expect(fileKind("teil.STEP")).toBe("step");
    expect(fileKind("teil.obj")).toBeNull();
  });
});

describe("meshFromStl", () => {
  it("centers the triangle and reports its size", () => {
    const mesh = meshFromStl(new TextEncoder().encode(triangleStl).buffer);
    expect(triangleCount(mesh)).toBe(1);
    expect(boundingSize(mesh)).toEqual({ x: 2, y: 2, z: 0 });
    expect(mesh.positions[0]).toBeCloseTo(-1);
    expect(mesh.positions[1]).toBeCloseTo(-1);
    expect(mesh.positions[2]).toBeCloseTo(0);
  });
});

function planeGrid(cells: number): TriangleMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const x0 = x / cells;
      const x1 = (x + 1) / cells;
      const y0 = y / cells;
      const y1 = (y + 1) / cells;
      positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
      for (let corner = 0; corner < 6; corner += 1) {
        normals.push(0, 0, 1);
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

describe("flowBox", () => {
  it("leaves a long lee and wide flanks", () => {
    const box = flowBox({ x: 2, y: 1, z: 1 });
    expect(box.maxX).toBeGreaterThan(-box.minX);
    expect(box.maxY - box.minY).toBeGreaterThan(2);
    expect(box.maxZ - box.minZ).toBe(box.maxY - box.minY);
  });
});

describe("simplifyMesh", () => {
  it("keeps the mesh at zero and drops coplanar triangles when turned up", () => {
    expect(simplifyLabel(0)).toBe("aus");
    expect(simplifyLabel(20)).toBe("leicht");
    expect(simplifyLabel(50)).toBe("mittel");
    expect(simplifyLabel(80)).toBe("stark");
    const mesh = planeGrid(8);
    expect(triangleCount(simplifyMesh(mesh, 0))).toBe(triangleCount(mesh));
    const reduced = simplifyMesh(mesh, 100);
    expect(triangleCount(reduced)).toBeGreaterThan(0);
    expect(triangleCount(reduced)).toBeLessThan(triangleCount(mesh));
    const size = boundingSize(reduced);
    expect(size.x).toBeGreaterThan(0.5);
    expect(size.y).toBeGreaterThan(0.5);
  });
});
