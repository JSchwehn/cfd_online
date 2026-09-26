import occtimportjs from "occt-import-js";
import type { OcctInstance, OcctMesh } from "occt-import-js";
import * as THREE from "three";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import type { LengthUnit, TriangleMesh } from "./case";
import { centerMesh, mergeMeshes } from "./mesh";

let occtPromise: Promise<OcctInstance> | null = null;

function wasmPath(): string {
  if (import.meta.env.VITEST) {
    return decodeURIComponent(new URL("../node_modules/occt-import-js/dist/occt-import-js.wasm", import.meta.url).pathname);
  }
  return wasmUrl;
}

function loadOcct(): Promise<OcctInstance> {
  if (!occtPromise) {
    occtPromise = occtimportjs({
      locateFile: () => wasmPath(),
    }).catch((error: unknown) => {
      occtPromise = null;
      throw error;
    });
  }
  return occtPromise;
}

function trianglesFromOcctMesh(mesh: OcctMesh): TriangleMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
  geometry.setIndex(Array.from(mesh.index.array));
  if (mesh.attributes.normal) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
  }
  const flat = geometry.toNonIndexed();
  if (!flat.getAttribute("normal")) {
    flat.computeVertexNormals();
  }
  const positions = flat.getAttribute("position").array;
  const normals = flat.getAttribute("normal").array;
  geometry.dispose();
  flat.dispose();
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };
}

export async function meshFromStep(buffer: ArrayBuffer, unit: LengthUnit): Promise<TriangleMesh> {
  const occt = await loadOcct();
  const result = occt.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: unit === "mm" ? "millimeter" : "meter",
  });
  if (!result.success || result.meshes.length === 0) {
    throw new Error("STEP-Datei konnte nicht gelesen werden.");
  }
  const parts = result.meshes.map(trianglesFromOcctMesh);
  return centerMesh(mergeMeshes(parts));
}
