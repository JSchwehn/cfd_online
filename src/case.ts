import * as THREE from "three";

export type LengthUnit = "mm" | "m";

export type TriangleMesh = {
  positions: Float32Array;
  normals: Float32Array;
};

export type FlowAngles = {
  yaw: number;
  pitch: number;
  roll: number;
};

export type FlowCase = {
  mesh: TriangleMesh;
  unitToMeters: number;
  yaw: number;
  pitch: number;
  roll: number;
  speedMps: number;
};

/** Euler order: yaw around Y, then pitch around Z, then roll around X. */
export const EULER_ORDER = "YZX";

export function unitToMeters(unit: LengthUnit): number {
  if (unit === "mm") {
    return 0.001;
  }
  return 1;
}

export function makeFlowCase(input: {
  mesh: TriangleMesh;
  unit: LengthUnit;
  yaw: number;
  pitch: number;
  roll: number;
  speedMps: number;
}): FlowCase {
  return {
    mesh: input.mesh,
    unitToMeters: unitToMeters(input.unit),
    yaw: input.yaw,
    pitch: input.pitch,
    roll: input.roll,
    speedMps: input.speedMps,
  };
}

export function eulerFromAngles(yaw: number, pitch: number, roll: number): THREE.Euler {
  return new THREE.Euler(roll, yaw, pitch, EULER_ORDER);
}

export function anglesFromEuler(euler: THREE.Euler): FlowAngles {
  const ordered = euler.order === EULER_ORDER ? euler : new THREE.Euler().copy(euler).reorder(EULER_ORDER);
  return { yaw: ordered.y, pitch: ordered.z, roll: ordered.x };
}

export function rotatePoint(
  yaw: number,
  pitch: number,
  roll: number,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const vector = new THREE.Vector3(point.x, point.y, point.z).applyEuler(eulerFromAngles(yaw, pitch, roll));
  return { x: vector.x, y: vector.y, z: vector.z };
}

/** Turns the model so `normal` (model space) points against the wind, toward −X. */
export function alignNormalToFlow(
  yaw: number,
  pitch: number,
  roll: number,
  normal: { x: number; y: number; z: number },
): FlowAngles {
  const current = new THREE.Quaternion().setFromEuler(eulerFromAngles(yaw, pitch, roll));
  const worldNormal = new THREE.Vector3(normal.x, normal.y, normal.z).applyQuaternion(current);
  if (worldNormal.lengthSq() < 1e-12) {
    return { yaw, pitch, roll };
  }
  worldNormal.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(worldNormal, new THREE.Vector3(-1, 0, 0));
  const euler = new THREE.Euler().setFromQuaternion(turn.multiply(current), EULER_ORDER);
  return anglesFromEuler(euler);
}
