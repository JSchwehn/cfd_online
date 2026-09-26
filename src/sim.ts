export type SimPhase = "idle" | "running" | "paused";

export function toggleSimPhase(phase: SimPhase): SimPhase {
  return phase === "running" ? "paused" : "running";
}

export function simToggleLabel(phase: SimPhase): "Start" | "Pause" {
  return phase === "running" ? "Pause" : "Start";
}

export function showRotationGizmo(hasModel: boolean, faceAlign: boolean, simulating: boolean): boolean {
  return hasModel && !faceAlign && !simulating;
}
