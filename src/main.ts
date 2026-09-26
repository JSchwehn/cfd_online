import "./style.css";
import { makeFlowCase, type FlowCase, type LengthUnit, type TriangleMesh } from "./case";
import { createLbm, sampleTrails, setOutletOpen, setParticleCount, setParticleSlice, setRecordTrails, stepLbm, TRAIL, writeDrawnParticles, writeHeatmap, writeTrailSegments, writeTurnColors, type FlowModel, type Lbm, type Resolution } from "./lbm";
import { fileKind, meshFromStl } from "./load-stl";
import { boundingSize, simplifyLabel, simplifyMesh, triangleCount } from "./mesh";
import { createScene } from "./scene";
import { simToggleLabel, type SimPhase } from "./sim";

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

const form = requiredElement<HTMLFormElement>("#flow-form");
const fileInput = requiredElement<HTMLInputElement>("#file");
const speedInput = requiredElement<HTMLInputElement>("#speed");
const errorEl = requiredElement<HTMLParagraphElement>("#error");
const statusEl = requiredElement<HTMLParagraphElement>("#status");
const trianglesEl = requiredElement<HTMLElement>("#triangles");
const sizeXEl = requiredElement<HTMLElement>("#size-x");
const sizeYEl = requiredElement<HTMLElement>("#size-y");
const sizeZEl = requiredElement<HTMLElement>("#size-z");
const viewport = requiredElement<HTMLDivElement>("#viewport");

const lengthFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

type SourceFile = {
  kind: "stl" | "step";
  buffer: ArrayBuffer;
};

let source: SourceFile | null = null;
let loaded: TriangleMesh | null = null;
let mesh: TriangleMesh | null = null;
let meshGeneration = 0;
let flowCase: FlowCase | null = null;
let loadToken = 0;
let phase: SimPhase = "idle";
let lbm: Lbm | null = null;
let builtKey = "";
let preparing = false;

const simToggle = requiredElement<HTMLButtonElement>("#sim-toggle");
const simReset = requiredElement<HTMLButtonElement>("#sim-reset");

const scene = createScene(viewport, (angles) => {
  writeDegrees("yaw", angles.yaw);
  writeDegrees("pitch", angles.pitch);
  writeDegrees("roll", angles.roll);
  publish();
  showInfo();
});

function readNumber(id: string): number {
  return Number(requiredElement<HTMLInputElement>(`#${id}`).value);
}

function readUnit(): LengthUnit {
  const selected = form.querySelector<HTMLInputElement>('input[name="unit"]:checked');
  return selected?.value === "m" ? "m" : "mm";
}

function readAngles(): { yaw: number; pitch: number; roll: number } {
  return {
    yaw: (readNumber("yaw") * Math.PI) / 180,
    pitch: (readNumber("pitch") * Math.PI) / 180,
    roll: (readNumber("roll") * Math.PI) / 180,
  };
}

function writeDegrees(id: string, radians: number) {
  const degrees = (radians * 180) / Math.PI;
  requiredElement<HTMLInputElement>(`#${id}`).value = String(Math.round(degrees * 10) / 10);
}

function setError(message: string) {
  errorEl.hidden = message.length === 0;
  errorEl.textContent = message;
}

function setStatus(message: string) {
  statusEl.hidden = message.length === 0;
  statusEl.textContent = message;
}

function readResolution(): Resolution {
  const value = requiredElement<HTMLSelectElement>("#resolution").value;
  if (value === "coarse" || value === "fine") {
    return value;
  }
  return "medium";
}

function readModel(): FlowModel {
  const value = requiredElement<HTMLSelectElement>("#model").value;
  if (value === "trt") {
    return value;
  }
  return "bgk";
}

function caseKey(value: FlowCase): string {
  return `${meshGeneration}|${value.yaw.toFixed(3)}|${value.pitch.toFixed(3)}|${value.roll.toFixed(3)}|${value.speedMps}|${value.unitToMeters}|${readResolution()}|${readModel()}`;
}

function syncSimButtons() {
  simToggle.disabled = !mesh || preparing;
  simToggle.textContent = simToggleLabel(phase);
  simReset.disabled = phase === "idle" || preparing;
  scene.setSimActive(phase !== "idle" || preparing);
}

function resetSim() {
  phase = "idle";
  lbm = null;
  builtKey = "";
  syncView();
  syncSimButtons();
}

function publish() {
  if (!mesh) {
    flowCase = null;
    if (phase !== "idle" || lbm) {
      resetSim();
    } else {
      syncSimButtons();
    }
    return;
  }
  const angles = readAngles();
  const next = makeFlowCase({
    mesh,
    unit: readUnit(),
    yaw: angles.yaw,
    pitch: angles.pitch,
    roll: angles.roll,
    speedMps: readNumber("speed"),
  });
  const key = caseKey(next);
  flowCase = next;
  if ((phase !== "idle" || lbm) && key !== builtKey) {
    resetSim();
    return;
  }
  syncSimButtons();
}

function showInfo() {
  if (!flowCase) {
    trianglesEl.textContent = "–";
    sizeXEl.textContent = "–";
    sizeYEl.textContent = "–";
    sizeZEl.textContent = "–";
    return;
  }
  const unit = readUnit();
  const size = boundingSize(flowCase.mesh);
  trianglesEl.textContent = String(triangleCount(flowCase.mesh));
  sizeXEl.textContent = `${lengthFormat.format(size.x)} ${unit}`;
  sizeYEl.textContent = `${lengthFormat.format(size.y)} ${unit}`;
  sizeZEl.textContent = `${lengthFormat.format(size.z)} ${unit}`;
}

function applyOrientation() {
  const angles = readAngles();
  scene.setOrientation(angles.yaw, angles.pitch, angles.roll);
  publish();
  showInfo();
}

async function rebuildFromSource() {
  if (!source) {
    return;
  }
  const token = ++loadToken;
  const unit = readUnit();
  const current = source;
  setStatus(current.kind === "step" ? "STEP wird gelesen…" : "");
  setError("");
  try {
    const next =
      current.kind === "stl"
        ? meshFromStl(current.buffer.slice(0))
        : await (await import("./load-step")).meshFromStep(current.buffer.slice(0), unit);
    if (token !== loadToken) {
      return;
    }
    loaded = next;
    applyLoadedMesh(true);
    setStatus("");
  } catch (error) {
    if (token !== loadToken) {
      return;
    }
    loaded = null;
    mesh = null;
    flowCase = null;
    scene.setMesh(null);
    resetSim();
    showInfo();
    setStatus("");
    setError(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  const kind = fileKind(file.name);
  if (!kind) {
    setError("Nur STL, STP oder STEP.");
    return;
  }
  void file.arrayBuffer().then((buffer) => {
    source = { kind, buffer };
    return rebuildFromSource();
  });
});

for (const input of form.querySelectorAll<HTMLInputElement>('input[name="unit"]')) {
  input.addEventListener("change", () => {
    if (source?.kind === "step") {
      void rebuildFromSource();
      return;
    }
    publish();
    showInfo();
  });
}

for (const id of ["yaw", "pitch", "roll"]) {
  requiredElement<HTMLInputElement>(`#${id}`).addEventListener("input", applyOrientation);
}

speedInput.addEventListener("input", () => {
  publish();
});

requiredElement<HTMLButtonElement>("#reset-angles").addEventListener("click", () => {
  requiredElement<HTMLInputElement>("#yaw").value = "0";
  requiredElement<HTMLInputElement>("#pitch").value = "0";
  requiredElement<HTMLInputElement>("#roll").value = "0";
  applyOrientation();
});

requiredElement<HTMLButtonElement>("#reset-view").addEventListener("click", () => {
  scene.resetView();
});

const wireframe = requiredElement<HTMLInputElement>("#wireframe");
wireframe.checked = false;
scene.setWireframe(false);
wireframe.addEventListener("change", () => {
  scene.setWireframe(wireframe.checked);
});

function closeInfo() {
  for (const pop of document.querySelectorAll<HTMLElement>(".info-pop")) {
    pop.hidden = true;
    pop.parentElement?.querySelector(".info-button")?.setAttribute("aria-expanded", "false");
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".info-button")) {
  const pop = button.parentElement?.querySelector<HTMLElement>(".info-pop");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!pop) {
      return;
    }
    const willOpen = pop.hidden;
    closeInfo();
    if (!willOpen) {
      return;
    }
    const rect = button.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 252)}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    button.setAttribute("aria-expanded", "true");
  });
  pop?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

document.addEventListener("click", () => closeInfo());
form.addEventListener("scroll", () => closeInfo());

const alignFace = requiredElement<HTMLInputElement>("#align-face");
alignFace.checked = false;
scene.setFaceAlign(false);
alignFace.addEventListener("change", () => {
  scene.setFaceAlign(alignFace.checked);
});

function startSim(snapshot: FlowCase, key: string) {
  preparing = true;
  syncSimButtons();
  setStatus("Strömung wird vorbereitet…");
  requestAnimationFrame(() => {
    preparing = false;
    if (!flowCase || caseKey(flowCase) !== key) {
      resetSim();
      setStatus("");
      return;
    }
    try {
      lbm = createLbm({
        mesh: snapshot.mesh,
        yaw: snapshot.yaw,
        pitch: snapshot.pitch,
        roll: snapshot.roll,
        speedMps: snapshot.speedMps,
        model: readModel(),
        resolution: readResolution(),
        particles: readNumber("particles"),
      });
    } catch (error) {
      resetSim();
      setStatus("");
      setError(error instanceof Error ? error.message : "Die Strömung konnte nicht vorbereitet werden.");
      return;
    }
    builtKey = key;
    phase = "running";
    setOutletOpen(lbm, outletInput.checked);
    applySlice();
    setRecordTrails(lbm, trailsInput.checked);
    syncView();
    setStatus("");
    syncSimButtons();
  });
}

simToggle.addEventListener("click", () => {
  if (!flowCase || preparing) {
    return;
  }
  if (phase === "running") {
    phase = "paused";
    syncSimButtons();
    return;
  }
  const key = caseKey(flowCase);
  if (phase === "paused" && lbm && key === builtKey) {
    phase = "running";
    syncSimButtons();
    return;
  }
  startSim(flowCase, key);
});

simReset.addEventListener("click", () => {
  if (preparing) {
    return;
  }
  resetSim();
  setStatus("");
});

function animateSim() {
  requestAnimationFrame(animateSim);
  if (phase !== "running" || !lbm) {
    return;
  }
  const started = performance.now();
  let steps = 0;
  while (steps < 4 && performance.now() - started < 12) {
    stepLbm(lbm);
    steps += 1;
  }
  sampleTrails(lbm);
  syncView();
}
function showSimSettings() {
  requiredElement<HTMLElement>("#simplify-label").textContent = simplifyLabel(readNumber("simplify"));
  requiredElement<HTMLElement>("#particle-count").textContent = String(readNumber("particles"));
}

function applyLoadedMesh(fit: boolean) {
  if (!loaded) {
    return;
  }
  mesh = simplifyMesh(loaded, readNumber("simplify"));
  meshGeneration += 1;
  scene.setMesh(mesh, fit);
  applyOrientation();
}

requiredElement<HTMLInputElement>("#simplify").addEventListener("input", () => {
  showSimSettings();
  applyLoadedMesh(false);
});

requiredElement<HTMLSelectElement>("#model").addEventListener("change", () => {
  publish();
});

requiredElement<HTMLSelectElement>("#resolution").addEventListener("change", () => {
  publish();
});

requiredElement<HTMLInputElement>("#particles").addEventListener("input", () => {
  showSimSettings();
  if (!lbm || phase === "idle") {
    return;
  }
  setParticleCount(lbm, readNumber("particles"));
  syncView();
});

const outletInput = requiredElement<HTMLInputElement>("#outlet-open");
const turnColorInput = requiredElement<HTMLInputElement>("#turn-color");
const sliceInput = requiredElement<HTMLInputElement>("#slice");
const sliceTurnInput = requiredElement<HTMLInputElement>("#slice-turn");
const trailsInput = requiredElement<HTMLInputElement>("#trails");
const heatmapInput = requiredElement<HTMLInputElement>("#heatmap");
const heatmapTurnInput = requiredElement<HTMLInputElement>("#heatmap-turn");
outletInput.checked = true;
turnColorInput.checked = false;
sliceInput.checked = false;
sliceTurnInput.checked = false;
trailsInput.checked = false;
heatmapInput.checked = false;
heatmapTurnInput.checked = false;

let turnColors = new Float32Array(0);
let trailSegments = new Float32Array(0);
let heatmapBytes = new Uint8Array(0);
let drawnPositions = new Float32Array(0);

function syncView() {
  if (!lbm) {
    scene.setParticles(null);
    scene.setTrails(null);
    scene.setHeatmap(null);
    return;
  }
  const size = lbm.spacing * 0.4;
  const slots = lbm.particles.length / 3 + lbm.stuck.length / 3;
  if (drawnPositions.length < slots * 3) {
    drawnPositions = new Float32Array(slots * 3);
  }
  const drawn = writeDrawnParticles(lbm, drawnPositions);
  if (turnColorInput.checked) {
    if (turnColors.length < drawnPositions.length) {
      turnColors = new Float32Array(drawnPositions.length);
    }
    writeTurnColors(lbm, turnColors);
    scene.setParticles(drawnPositions, size, drawn, turnColors);
  } else {
    scene.setParticles(drawnPositions, size, drawn, null);
  }
  if (trailsInput.checked) {
    const need = (lbm.particles.length / 3) * (TRAIL - 1) * 6;
    if (trailSegments.length < need) {
      trailSegments = new Float32Array(need);
    }
    scene.setTrails(trailSegments, writeTrailSegments(lbm, trailSegments));
  } else {
    scene.setTrails(null);
  }
  if (heatmapInput.checked || heatmapTurnInput.checked) {
    const vertical = heatmapTurnInput.checked;
    const span = vertical ? lbm.ny : lbm.nz;
    const need = lbm.nx * span * 4;
    if (heatmapBytes.length !== need) {
      heatmapBytes = new Uint8Array(need);
    }
    scene.setHeatmap(heatmapBytes, writeHeatmap(lbm, heatmapBytes, vertical));
  } else {
    scene.setHeatmap(null);
  }
}

outletInput.addEventListener("change", () => {
  scene.setOutletOpen(outletInput.checked);
  if (lbm) {
    setOutletOpen(lbm, outletInput.checked);
  }
});
turnColorInput.addEventListener("change", () => {
  syncView();
});
function applySlice() {
  if (!lbm) {
    return;
  }
  setParticleSlice(lbm, sliceInput.checked || sliceTurnInput.checked, sliceTurnInput.checked);
}

sliceInput.addEventListener("change", () => {
  applySlice();
  syncView();
});
sliceTurnInput.addEventListener("change", () => {
  applySlice();
  syncView();
});
trailsInput.addEventListener("change", () => {
  if (lbm) {
    setRecordTrails(lbm, trailsInput.checked);
  }
  syncView();
});
heatmapInput.addEventListener("change", () => {
  syncView();
});
heatmapTurnInput.addEventListener("change", () => {
  syncView();
});

animateSim();
showSimSettings();
syncSimButtons();
