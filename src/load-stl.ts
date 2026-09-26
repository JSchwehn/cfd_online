import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { TriangleMesh } from "./case";
import { geometryToMesh } from "./mesh";

export function fileKind(name: string): "stl" | "step" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".stl")) {
    return "stl";
  }
  if (lower.endsWith(".stp") || lower.endsWith(".step")) {
    return "step";
  }
  return null;
}

export function meshFromStl(buffer: ArrayBuffer): TriangleMesh {
  return geometryToMesh(new STLLoader().parse(buffer));
}
