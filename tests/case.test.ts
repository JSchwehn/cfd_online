import { describe, expect, it } from "vitest";
// @ts-expect-error Node fs types are not in this tsconfig
import { readFileSync } from "fs";
import { alignNormalToFlow, anglesFromEuler, eulerFromAngles, rotatePoint, unitToMeters } from "../src/case";

describe("view options", () => {
  it("starts with face align and wireframe off, hints behind an i", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('id="align-face" type="checkbox"');
    expect(html).not.toMatch(/id="align-face"[^>]*\bchecked\b/);
    expect(html).toContain('id="wireframe" type="checkbox"');
    expect(html).not.toMatch(/id="wireframe"[^>]*\bchecked\b/);
    expect(html).toContain('class="info-button"');
    expect(html).toContain('class="info-pop" hidden');
    expect(html).not.toContain('class="hint"');
  });
});

describe("unitToMeters", () => {
  it("maps millimeters and meters", () => {
    expect(unitToMeters("mm")).toBe(0.001);
    expect(unitToMeters("m")).toBe(1);
  });
});

describe("orientation", () => {
  it("yaws around the vertical axis", () => {
    const turned = rotatePoint(Math.PI / 2, 0, 0, { x: 1, y: 0, z: 0 });
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(-1);
  });

  it("pitches around the side axis", () => {
    const turned = rotatePoint(0, Math.PI / 2, 0, { x: 1, y: 0, z: 0 });
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(1);
    expect(turned.z).toBeCloseTo(0);
  });

  it("rolls around the wind axis", () => {
    const turned = rotatePoint(0, 0, Math.PI / 2, { x: 0, y: 1, z: 0 });
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(1);
  });

  it("reads the same angles back from the euler", () => {
    const euler = eulerFromAngles(0.2, -0.4, 0.6);
    expect(anglesFromEuler(euler)).toEqual({ yaw: 0.2, pitch: -0.4, roll: 0.6 });
  });

  it("points a face normal against the wind", () => {
    const aligned = alignNormalToFlow(0, 0, 0, { x: 0, y: 1, z: 0 });
    const turned = rotatePoint(aligned.yaw, aligned.pitch, aligned.roll, { x: 0, y: 1, z: 0 });
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.y).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(0);
  });

  it("keeps a face that already faces the wind", () => {
    const aligned = alignNormalToFlow(0, 0, 0, { x: -1, y: 0, z: 0 });
    expect(aligned.yaw).toBeCloseTo(0);
    expect(aligned.pitch).toBeCloseTo(0);
    expect(aligned.roll).toBeCloseTo(0);
  });

  it("aligns a face on an already rotated model", () => {
    const aligned = alignNormalToFlow(Math.PI / 2, 0, 0, { x: 0, y: 0, z: 1 });
    const turned = rotatePoint(aligned.yaw, aligned.pitch, aligned.roll, { x: 0, y: 0, z: 1 });
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.y).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(0);
  });
});
