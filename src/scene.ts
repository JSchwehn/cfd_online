import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { alignNormalToFlow, anglesFromEuler, EULER_ORDER, eulerFromAngles, type FlowAngles, type TriangleMesh } from "./case";
import { showRotationGizmo } from "./sim";
import type { Heatmap } from "./lbm";
import { boundingSize, flowBox } from "./mesh";

const tunnelMaterial = new THREE.LineBasicMaterial({ color: 0x9aa3b2 });
const particleMaterial = new THREE.PointsMaterial({ color: 0x2a6fdb, size: 1 });
const trailMaterial = new THREE.LineBasicMaterial({ color: 0x16325c, transparent: true, opacity: 0.9 });
const heatMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
const modelMaterial = new THREE.MeshStandardMaterial({
  color: 0xb7c4d4,
  metalness: 0.05,
  roughness: 0.6,
  side: THREE.DoubleSide,
});

function disposeObject(object: THREE.Object3D) {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function clearModel(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
    }
  }
}

function fitDistance(maxDim: number, fovDeg: number): number {
  return maxDim / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

export function createScene(container: HTMLElement, onOrientation: (angles: FlowAngles) => void) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f2f2);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const model = new THREE.Group();
  model.rotation.order = EULER_ORDER;
  scene.add(model);

  const arrows = new THREE.Group();
  scene.add(arrows);
  let particles: THREE.Points | null = null;
  let trails: THREE.LineSegments | null = null;
  let heat: THREE.Mesh | null = null;
  let heatTexture: THREE.DataTexture | null = null;

  let tunnel: THREE.LineSegments | null = null;

  const transform = new TransformControls(camera, renderer.domElement);
  transform.setMode("rotate");
  transform.setSpace("world");
  let faceAlign = false;
  let simulating = false;
  let pointerDown: { x: number; y: number } | null = null;
  let gizmoGesture = false;
  const raycaster = new THREE.Raycaster();

  transform.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value;
    if (event.value) {
      gizmoGesture = true;
    }
  });
  transform.addEventListener("objectChange", () => {
    onOrientation(anglesFromEuler(model.rotation));
  });
  scene.add(transform.getHelper());

  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
    gizmoGesture = transform.axis !== null;
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!faceAlign || !pointerDown || gizmoGesture || event.button !== 0) {
      pointerDown = null;
      return;
    }
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > 16) {
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit?.face) {
      return;
    }
    const localNormal = hit.face.normal.clone();
    const worldNormal = localNormal.clone().transformDirection(hit.object.matrixWorld);
    if (worldNormal.dot(raycaster.ray.direction) > 0) {
      localNormal.negate();
    }
    const current = anglesFromEuler(model.rotation);
    const aligned = alignNormalToFlow(current.yaw, current.pitch, current.roll, localNormal);
    setOrientation(aligned.yaw, aligned.pitch, aligned.roll);
    onOrientation(aligned);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const directional = new THREE.DirectionalLight(0xffffff, 0.9);
  directional.position.set(1.2, 2.2, 1.4);
  scene.add(directional);

  let outletOpen = true;
  let guideSize = { x: 1, y: 1, z: 1 };

  function tunnelPositions(along: number, cross: number, open: boolean): Float32Array {
    const hx = along / 2;
    const hy = cross / 2;
    const hz = cross / 2;
    const corner = [
      [-hx, -hy, -hz],
      [-hx, hy, -hz],
      [-hx, hy, hz],
      [-hx, -hy, hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [hx, hy, hz],
      [hx, -hy, hz],
    ];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    if (!open) {
      edges.push([4, 5], [5, 6], [6, 7], [7, 4]);
    }
    const data = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i += 1) {
      const a = corner[edges[i][0]];
      const b = corner[edges[i][1]];
      data.set([...a, ...b], i * 6);
    }
    return data;
  }

  function setGuides(size: { x: number; y: number; z: number }) {
    guideSize = size;
    const limits = flowBox(size);
    const along = limits.maxX - limits.minX;
    const cross = limits.maxY - limits.minY;
    if (tunnel) {
      tunnel.geometry.dispose();
      scene.remove(tunnel);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(tunnelPositions(along, cross, outletOpen), 3));
    tunnel = new THREE.LineSegments(geometry, tunnelMaterial);
    tunnel.position.set((limits.minX + limits.maxX) / 2, (limits.minY + limits.maxY) / 2, (limits.minZ + limits.maxZ) / 2);
    scene.add(tunnel);

    clearGroup(arrows);
    const length = along * 0.18;
    const originX = limits.minX;
    const spots: Array<[number, number, number]> = [
      [originX, cross * 0.28, 0],
      [originX, -cross * 0.28, 0],
      [originX, 0, cross * 0.28],
      [originX, 0, -cross * 0.28],
    ];
    const direction = new THREE.Vector3(1, 0, 0);
    for (const [x, y, z] of spots) {
      arrows.add(new THREE.ArrowHelper(direction, new THREE.Vector3(x, y, z), length, 0x2a6fdb, length * 0.28, length * 0.16));
    }
  }

  function fitCamera() {
    const target = tunnel ?? model;
    if (!target) {
      return;
    }
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const dist = fitDistance(maxDim, camera.fov) * 1.15;
    camera.near = Math.max(dist / 1000, 1e-4);
    camera.far = Math.max(dist * 40, 10);
    camera.updateProjectionMatrix();
    camera.position.set(center.x - dist * 0.35, center.y + dist * 0.45, center.z + dist * 0.95);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.update();
  }

  function setMesh(mesh: TriangleMesh | null, fit = true) {
    clearModel(model);
    transform.detach();
    if (!mesh) {
      setGuides({ x: 1, y: 1, z: 1 });
      fitCamera();
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
    model.add(new THREE.Mesh(geometry, modelMaterial));
    transform.attach(model);
    syncGizmo();
    setGuides(boundingSize(mesh));
    if (fit) {
      fitCamera();
    }
  }

  function setOrientation(yaw: number, pitch: number, roll: number) {
    const euler = eulerFromAngles(yaw, pitch, roll);
    model.rotation.set(euler.x, euler.y, euler.z);
  }

  function syncGizmo() {
    const show = showRotationGizmo(model.children.length > 0, faceAlign, simulating);
    transform.enabled = show;
    transform.getHelper().visible = show;
    if (!show) {
      transform.axis = null;
    }
  }

  function setSimActive(active: boolean) {
    simulating = active;
    syncGizmo();
  }

  function setFaceAlign(enabled: boolean) {
    faceAlign = enabled;
    container.classList.toggle("align-face", enabled);
    syncGizmo();
  }

  function setWireframe(enabled: boolean) {
    modelMaterial.wireframe = enabled;
    modelMaterial.color.set(enabled ? 0x3d4a5c : 0xb7c4d4);
  }

  function setParticles(positions: Float32Array | null, size = 1, count?: number, colors?: Float32Array | null) {
    particleMaterial.size = size;
    if (!positions) {
      if (particles) {
        scene.remove(particles);
        particles.geometry.dispose();
        particles = null;
      }
      return;
    }
    const drawn = count ?? positions.length / 3;
    if (!particles || particles.geometry.getAttribute("position").array !== positions) {
      if (particles) {
        scene.remove(particles);
        particles.geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      const attribute = new THREE.BufferAttribute(positions, 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", attribute);
      particles = new THREE.Points(geometry, particleMaterial);
      particles.renderOrder = 3;
      scene.add(particles);
    } else {
      particles.geometry.getAttribute("position").needsUpdate = true;
    }
    if (colors) {
      const existing = particles.geometry.getAttribute("color");
      if (!existing || existing.array !== colors) {
        const colorAttribute = new THREE.BufferAttribute(colors, 3);
        colorAttribute.setUsage(THREE.DynamicDrawUsage);
        particles.geometry.setAttribute("color", colorAttribute);
      } else {
        existing.needsUpdate = true;
      }
      particleMaterial.color.set(0xffffff);
    } else {
      particleMaterial.color.set(0x2a6fdb);
    }
    if (particleMaterial.vertexColors !== Boolean(colors)) {
      particleMaterial.vertexColors = Boolean(colors);
      particleMaterial.needsUpdate = true;
    }
    particles.geometry.setDrawRange(0, drawn);
  }

  function setTrails(positions: Float32Array | null, count = 0) {
    if (!positions || count === 0) {
      if (trails) {
        scene.remove(trails);
        trails.geometry.dispose();
        trails = null;
      }
      return;
    }
    if (!trails || trails.geometry.getAttribute("position").array !== positions) {
      if (trails) {
        scene.remove(trails);
        trails.geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      const attribute = new THREE.BufferAttribute(positions, 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", attribute);
      trails = new THREE.LineSegments(geometry, trailMaterial);
      trails.renderOrder = 2;
      scene.add(trails);
    } else {
      trails.geometry.getAttribute("position").needsUpdate = true;
    }
    trails.geometry.setDrawRange(0, count * 2);
  }

  function setHeatmap(rgba: Uint8Array | null, layout?: Heatmap) {
    if (!rgba || !layout) {
      if (heat) {
        heat.visible = false;
      }
      return;
    }
    if (!heatTexture || heatTexture.image.width !== layout.width || heatTexture.image.height !== layout.height) {
      heatTexture?.dispose();
      heatTexture = new THREE.DataTexture(rgba, layout.width, layout.height, THREE.RGBAFormat);
      heatTexture.magFilter = THREE.LinearFilter;
      heatTexture.minFilter = THREE.LinearFilter;
      heatTexture.colorSpace = THREE.NoColorSpace;
      heatTexture.needsUpdate = true;
      heatMaterial.map = heatTexture;
      heatMaterial.needsUpdate = true;
    } else {
      heatTexture.image.data = rgba;
      heatTexture.needsUpdate = true;
    }
    if (!heat) {
      heat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heatMaterial);
      heat.renderOrder = 1;
      scene.add(heat);
    }
    heat.visible = true;
    if (layout.vertical) {
      heat.rotation.set(0, 0, 0);
      heat.scale.set(layout.sizeX, layout.sizeY, 1);
      heat.position.set(layout.originX + layout.sizeX / 2, layout.originY + layout.sizeY / 2, layout.z);
      heatMaterial.depthTest = false;
    } else {
      heat.rotation.set(-Math.PI / 2, 0, 0);
      heat.scale.set(layout.sizeX, -layout.sizeZ, 1);
      heat.position.set(layout.originX + layout.sizeX / 2, layout.y, layout.originZ + layout.sizeZ / 2);
      heatMaterial.depthTest = true;
    }
  }

  function resize() {
    const width = container.clientWidth;
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
  }

  window.addEventListener("resize", resize);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  setGuides({ x: 1, y: 1, z: 1 });
  resize();
  fitCamera();

  function tick() {
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  function setOutletOpen(open: boolean) {
    outletOpen = open;
    setGuides(guideSize);
  }

  return { setMesh, setOrientation, setFaceAlign, setWireframe, setParticles, setTrails, setHeatmap, setOutletOpen, setSimActive, resetView: fitCamera, resize };
}
