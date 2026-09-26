// @ts-expect-error Node fs types are not in this tsconfig
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { meshFromStep } from "../src/load-step";
import { boundingSize, triangleCount } from "../src/mesh";

describe("meshFromStep", () => {
  it("tessellates a cube into the selected unit", async () => {
    const file = readFileSync("node_modules/occt-import-js/test/testfiles/cube-units/cube-mm.step");
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const millimeters = await meshFromStep(buffer, "mm");
    const meters = await meshFromStep(buffer, "m");
    expect(triangleCount(millimeters)).toBeGreaterThan(0);
    expect(boundingSize(millimeters).x).toBeGreaterThan(1);
    expect(boundingSize(meters).x).toBeCloseTo(boundingSize(millimeters).x / 1000, 5);
  }, 30000);
});
