// Three.js presentation of the industrial test chamber.
// Orthographic camera; gameplay is 2D in the XY plane (chamber 20x12 world units).
// Consumes immutable session snapshots; never mutates rules state.

import * as THREE from "../vendor/three.module.js";
import { CHAMBER, MATERIALS, JOINT_TYPES, makeRng } from "./rules.js";

// Framing: the whole chamber plus MARGIN of breathing room on every side.
export const FRAMING = Object.freeze({ margin: 0.1 });

const CH_W = CHAMBER.w, CH_H = CHAMBER.h;
const CH_CX = CH_W / 2, CH_CY = CH_H / 2;

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, particleCap: 200 },
  medium: { pixelRatio: 1.5, shadows: true, particleCap: 800 },
  high: { pixelRatio: 2, shadows: true, particleCap: 2000 },
};

const LAYER_FX = 1; // cosmetic particles; never part of picking

const DEFAULT_PALETTE = {
  background: "#14161c", floor: "#3a3f4d", wall: "#565d70", accent: "#ff8a3d", uiAccent: "#ffb066",
};

// ---------------------------------------------------------------- textures

function makeChevronTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#1a0d08";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#ff8a3d";
  for (let x = -64; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 64); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 64);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------- init

export function initRenderer(canvas, { onPick } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_PALETTE.background);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);

  // lights: one dominant key + soft fill + ambient base
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2df, 1.4);
  key.position.set(6, 10, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  scene.add(key);
  const fill = new THREE.HemisphereLight(0x9db4d8, 0x2a2018, 0.5);
  scene.add(fill);

  // -------------------------------------------------------------- groups
  const envGroup = new THREE.Group();      // chamber shell, walls, decor
  const levelGroup = new THREE.Group();    // obstacles, hazards, targets (per level)
  const bodyGroup = new THREE.Group();     // dynamic bodies
  const jointGroup = new THREE.Group();    // joints
  const overlayGroup = new THREE.Group();  // ghost, selection, cursor
  scene.add(envGroup, levelGroup, bodyGroup, jointGroup, overlayGroup);

  // -------------------------------------------------------------- disposables
  let disposables = [];
  function track(obj) {
    obj.traverse((n) => {
      if (n.geometry) disposables.push(n.geometry);
      if (n.material) {
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          disposables.push(m);
          if (m.map) disposables.push(m.map);
        }
      }
    });
  }
  function disposeGroup(group) {
    track(group);
    group.clear();
  }

  // -------------------------------------------------------------- materials
  const palette = { ...DEFAULT_PALETTE };
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.9, metalness: 0.1 }),
    wall: new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.8, metalness: 0.2 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.85, metalness: 0.15 }),
    obstacle: new THREE.MeshStandardMaterial({ color: 0x7a8296, roughness: 0.5, metalness: 0.6 }),
    hazard: new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.6, emissive: 0xff552e, emissiveIntensity: 0.6,
      map: makeChevronTexture(),
    }),
    target: new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    ghostOk: new THREE.MeshBasicMaterial({ color: 0x4be38a, transparent: true, opacity: 0.4 }),
    ghostBad: new THREE.MeshBasicMaterial({ color: 0xe34b4b, transparent: true, opacity: 0.4 }),
    selectionRing: new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    pin: new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4, metalness: 0.5 }),
    spring: new THREE.MeshStandardMaterial({ color: 0x6fd3ff, roughness: 0.4, metalness: 0.3 }),
    cursor: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
  };
  const bodyMats = {};
  for (const [id, m] of Object.entries(MATERIALS)) {
    bodyMats[id] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color),
      roughness: id === "glass" ? 0.15 : 0.45,
      metalness: id === "steel" ? 0.8 : 0.05,
      transparent: id === "glass",
      opacity: id === "glass" ? 0.85 : 1,
    });
  }

  // -------------------------------------------------------------- chamber shell
  function buildChamber() {
    // back wall with authored panel grid (beveled panels + seam lines)
    const back = new THREE.Mesh(new THREE.BoxGeometry(CH_W + 4, CH_H + 4, 0.4), mats.panel);
    back.position.set(0, 0, -1.2);
    back.receiveShadow = true;
    envGroup.add(back);

    const seamMat = new THREE.MeshStandardMaterial({ color: 0x1c1f28, roughness: 0.9 });
    for (let i = 0; i <= 5; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.08, CH_H + 4, 0.06), seamMat);
      seam.position.set(-(CH_W + 4) / 2 + i * ((CH_W + 4) / 5), 0, -0.96);
      envGroup.add(seam);
    }
    for (let i = 0; i <= 3; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(CH_W + 4, 0.08, 0.06), seamMat);
      seam.position.set(0, -(CH_H + 4) / 2 + i * ((CH_H + 4) / 3), -0.96);
      envGroup.add(seam);
    }
    // rivets on panel intersections
    const rivetGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10);
    rivetGeo.rotateX(Math.PI / 2);
    const rivetMat = new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.4, metalness: 0.7 });
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 3; j++) {
      const r = new THREE.Mesh(rivetGeo, rivetMat);
      r.position.set(-(CH_W + 4) / 2 + i * ((CH_W + 4) / 5), -(CH_H + 4) / 2 + j * ((CH_H + 4) / 3), -0.92);
      envGroup.add(r);
    }

    // floor slab and side walls (chamber bounds)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(CH_W, 0.6, 2.4), mats.floor);
    floor.position.set(0, -CH_CY - 0.3, -0.2);
    floor.receiveShadow = true;
    envGroup.add(floor);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(CH_W, 0.5, 2.0), mats.wall);
    ceil.position.set(0, CH_CY + 0.25, -0.3);
    envGroup.add(ceil);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, CH_H + 1, 2.0), mats.wall);
      wall.position.set(s * (CH_CX + 0.25), 0, -0.3);
      envGroup.add(wall);
    }
    // corner warning strip on the floor edge
    const strip = new THREE.Mesh(new THREE.BoxGeometry(CH_W, 0.12, 0.02), mats.hazard);
    strip.position.set(0, -CH_CY + 0.06, 0.02);
    envGroup.add(strip);
  }

  // decorative props, deterministic per level seed
  function buildDecor(seed) {
    const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.8 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.5, metalness: 0.6 });
    const n = 2 + rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const w = 0.6 + rng.next() * 0.8;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(w, w, w), crateMat);
      const side = rng.next() < 0.5 ? -1 : 1;
      crate.position.set(side * (CH_CX + 0.9 + rng.next() * 0.8), -CH_CY + w / 2, -0.6 + rng.next() * 0.3);
      crate.rotation.z = (rng.next() - 0.5) * 0.2;
      crate.castShadow = true;
      envGroup.add(crate);
    }
    for (let i = 0; i < 2; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, CH_H + 2, 8), pipeMat);
      pipe.position.set((rng.next() - 0.5) * (CH_W + 2), 0, -0.85);
      envGroup.add(pipe);
    }
  }

  buildChamber();

  // -------------------------------------------------------------- level content
  const targetRings = [];
  const hazardMeshes = [];
  let builtLevelId = null;

  function buildLevel(level) {
    if (builtLevelId === level.id) return;
    if (builtLevelId !== null) disposeGroup(levelGroup);
    builtLevelId = level.id;
    targetRings.length = 0;
    hazardMeshes.length = 0;

    for (const o of level.obstacles || []) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, 1.2), mats.obstacle);
      mesh.position.set(o.x + o.w / 2 - CH_CX, o.y + o.h / 2 - CH_CY, -0.1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      levelGroup.add(mesh);
      // bevel highlight strip on top edge
      const lip = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.05, 1.24),
        new THREE.MeshStandardMaterial({ color: 0x9aa2b8, roughness: 0.35, metalness: 0.7 }));
      lip.position.set(o.x + o.w / 2 - CH_CX, o.y + o.h - 0.025 - CH_CY, -0.1);
      levelGroup.add(lip);
    }
    for (const h of level.hazards || []) {
      const mat = mats.hazard.clone();
      mat.map = mats.hazard.map.clone();
      mat.map.repeat.set(Math.max(1, Math.round(h.w)), 1);
      mat.map.needsUpdate = true;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, 0.15), mat);
      mesh.position.set(h.x + h.w / 2 - CH_CX, h.y + h.h / 2 - CH_CY, 0.05);
      levelGroup.add(mesh);
      hazardMeshes.push(mesh);
    }
    for (const t of level.targets || []) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(t.r - 0.12, t.r, 48), mats.target);
      ring.position.set(t.x - CH_CX, t.y - CH_CY, 0.05);
      levelGroup.add(ring);
      const inner = new THREE.Mesh(new THREE.RingGeometry(t.r * 0.45, t.r * 0.45 + 0.06, 32), mats.target);
      inner.position.copy(ring.position);
      levelGroup.add(inner);
      targetRings.push(ring, inner);
    }
    buildDecor(level.seed || 1);
    track(levelGroup);
  }

  // -------------------------------------------------------------- bodies & joints
  const bodyViews = new Map(); // id -> { mesh, ring? }
  const jointViews = new Map();
  const interactive = []; // explicit pick list

  const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.6, 28);
  bodyGeo.rotateX(Math.PI / 2); // flat face toward camera

  function getBodyView(b) {
    let v = bodyViews.get(b.id);
    if (!v) {
      const mesh = new THREE.Mesh(bodyGeo, bodyMats[b.material].clone());
      mesh.castShadow = true;
      mesh.userData = { kind: "body", id: b.id };
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.035, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 })
      );
      rim.position.z = 0.31;
      mesh.add(rim);
      bodyGroup.add(mesh);
      v = { mesh, rim };
      bodyViews.set(b.id, v);
      interactive.push(mesh);
    }
    return v;
  }

  function getJointView(j) {
    let v = jointViews.get(j.id);
    if (!v) {
      const mat = j.type === "spring" ? mats.spring : mats.pin;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, j.type === "spring" ? 0.08 : 0.16, 0.1), mat);
      mesh.userData = { kind: "joint", id: j.id };
      if (j.type === "spring") {
        // coil look: small ridge segments
        for (let i = 0; i < 5; i++) {
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), mat);
          seg.position.x = -0.5 + (i + 0.5) / 5;
          mesh.add(seg);
        }
      }
      jointGroup.add(mesh);
      v = { mesh };
      jointViews.set(j.id, v);
    }
    return v;
  }

  // -------------------------------------------------------------- overlay: ghost, selection, cursor
  const ghost = new THREE.Mesh(bodyGeo.clone(), mats.ghostOk);
  ghost.visible = false;
  overlayGroup.add(ghost);

  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 40), mats.selectionRing);
  selRing.visible = false;
  overlayGroup.add(selRing);

  const cursorGroup = new THREE.Group();
  {
    const mk = (w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.cursor);
    const h1 = mk(0.7, 0.05), h2 = mk(0.05, 0.7);
    cursorGroup.add(h1, h2);
  }
  cursorGroup.position.z = 0.5;
  overlayGroup.add(cursorGroup);

  // -------------------------------------------------------------- particles (pooled)
  let particleCap = QUALITY.high.particleCap;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(QUALITY.high.particleCap * 3);
  const pCol = new Float32Array(QUALITY.high.particleCap * 3);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.layers.set(LAYER_FX);
  points.frustumCulled = false;
  scene.add(points);
  camera.layers.enable(LAYER_FX);
  const pool = []; // {x,y,vx,vy,life,ttl,r,g,b}
  let spawnRng = makeRng(1234);

  function burst(x, y, color, count, speed = 4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (pool.length >= particleCap) pool.shift();
      const a = spawnRng.next() * Math.PI * 2;
      const v = (0.3 + spawnRng.next() * 0.7) * speed;
      pool.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.5,
        life: 0, ttl: 0.5 + spawnRng.next() * 0.5, r: c.r, g: c.g, b: c.b,
      });
    }
  }

  function updateParticles(dt) {
    let n = 0;
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i];
      p.life += dt;
      if (p.life >= p.ttl) { pool.splice(i, 1); continue; }
      p.vy -= 6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const p of pool) {
      if (n >= particleCap) break;
      pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = 0.6;
      const fade = 1 - p.life / p.ttl;
      pCol[n * 3] = p.r * fade; pCol[n * 3 + 1] = p.g * fade; pCol[n * 3 + 2] = p.b * fade;
      n++;
    }
    pGeo.setDrawRange(0, n);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // -------------------------------------------------------------- state
  let paletteTheme = DEFAULT_PALETTE;
  let quality = "high";
  let reducedMotion = false;
  let paused = false;
  let prevSnap = null;
  let curSnap = null;
  let alpha = 1;
  let selection = null;
  let shakeAmp = 0;
  const shakeOffset = new THREE.Vector3();
  let elapsed = 0;

  function applyQuality(tier) {
    quality = QUALITY[tier] ? tier : "high";
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadows;
    key.castShadow = q.shadows;
    particleCap = q.particleCap;
    scene.traverse((n) => { if (n.material) n.material.needsUpdate = true; });
    resize();
  }

  let framingMargin = FRAMING.margin;

  function resize() {
    const wpx = canvas.clientWidth || 640;
    const hpx = canvas.clientHeight || 400;
    renderer.setSize(wpx, hpx, false);
    const aspect = wpx / Math.max(1, hpx);
    const m = framingMargin;
    const needW = CH_W * (1 + 2 * m) / 2;
    const needH = CH_H * (1 + 2 * m) / 2;
    let halfW = needW, halfH = needH;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH; camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
  window.addEventListener("resize", resize);
  resize();

  // -------------------------------------------------------------- picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function toNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return ndc;
  }

  function screenToWorld(clientX, clientY) {
    toNdc(clientX, clientY);
    const v = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
    return { x: v.x + CH_CX, y: v.y + CH_CY };
  }

  function worldToScreen(x, y) {
    const v = new THREE.Vector3(x - CH_CX, y - CH_CY, 0).project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (1 - v.y) / 2 * rect.height,
    };
  }

  function pickInteractive(clientX, clientY) {
    toNdc(clientX, clientY);
    // picking must ignore camera shake: raycast with the clean camera transform
    camera.position.sub(shakeOffset);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(interactive, false);
    camera.position.add(shakeOffset);
    camera.updateMatrixWorld();
    if (hits.length > 0) {
      const u = hits[0].object.userData;
      return { type: u.kind, id: u.id, world: screenToWorld(clientX, clientY) };
    }
    return { type: "floor", world: screenToWorld(clientX, clientY) };
  }

  // -------------------------------------------------------------- pointer
  function handlePick(ev) {
    if (onPick) onPick(pickInteractive(ev.clientX, ev.clientY), ev);
  }
  canvas.addEventListener("pointerdown", handlePick);

  // -------------------------------------------------------------- events / vfx
  function emitEvent(ev) {
    const at = (id) => {
      const v = bodyViews.get(id);
      return v ? { x: v.mesh.position.x, y: v.mesh.position.y } : null;
    };
    switch (ev.type) {
      case "spawn": burst(ev.x - CH_CX, ev.y - CH_CY, MATERIALS[ev.material]?.color || "#ffffff", 24, 3); break;
      case "joint": {
        const p = at(ev.a);
        if (p) burst(p.x, p.y, "#f2c14e", 14, 2);
        break;
      }
      case "delete": {
        const p = at(ev.target);
        if (p) burst(p.x, p.y, "#9aa2b8", 16, 2.5);
        break;
      }
      case "shatter": {
        const p = at(ev.id);
        if (p) burst(p.x, p.y, MATERIALS.glass.color, 40, 5);
        if (!reducedMotion) shakeAmp = Math.min(0.35, shakeAmp + 0.18);
        break;
      }
      case "destroyed": {
        const p = at(ev.id);
        if (p) burst(p.x, p.y, "#ff552e", 36, 5);
        if (!reducedMotion) shakeAmp = Math.min(0.35, shakeAmp + 0.15);
        break;
      }
      case "delivered": {
        const p = at(ev.id);
        if (p) burst(p.x, p.y, palette.accent, 40, 4);
        break;
      }
      case "impact": {
        if (ev.strong && !reducedMotion) shakeAmp = Math.min(0.2, shakeAmp + 0.05);
        break;
      }
    }
  }

  // -------------------------------------------------------------- render loop
  let raf = 0;
  let lastT = 0;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function draw(t) {
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    if (!document.hidden) elapsed += dt;

    // bodies from snapshot interpolation
    if (curSnap) {
      const seen = new Set();
      for (const b of curSnap.bodies) {
        seen.add(b.id);
        const v = getBodyView(b);
        let px = b.x, py = b.y;
        const pb = prevSnap && prevSnap.bodies.find((x) => x.id === b.id);
        if (pb) { px = lerp(pb.x, b.x, alpha); py = lerp(pb.y, b.y, alpha); }
        v.mesh.visible = true;
        const isSel = selection === b.id;
        v.mesh.position.set(px - CH_CX, py - CH_CY, isSel ? 0.35 : 0.1);
        v.mesh.rotation.z = b.id.charCodeAt(0) + px; // cheap deterministic spin cue
        v.rim.material.opacity = isSel ? 0.95 : 0;
        if (isSel) {
          selRing.visible = true;
          selRing.position.set(px - CH_CX, py - CH_CY, 0.06);
          if (!reducedMotion) {
            const s = 1 + Math.sin(elapsed * 5) * 0.06;
            selRing.scale.set(s, s, 1);
          }
        }
      }
      for (const [id, v] of bodyViews) {
        if (!seen.has(id)) {
          v.mesh.visible = false;
          if (selection === id) { selection = null; selRing.visible = false; }
        }
      }
      if (!selection) selRing.visible = false;

      // joints
      const seenJ = new Set();
      for (const j of curSnap.joints) {
        seenJ.add(j.id);
        const a = curSnap.bodies.find((x) => x.id === j.a);
        const b = curSnap.bodies.find((x) => x.id === j.b);
        if (!a || !b) continue;
        const v = getJointView(j);
        let ax = a.x, ay = a.y, bx = b.x, by = b.y;
        if (prevSnap) {
          const pa = prevSnap.bodies.find((x) => x.id === j.a);
          const pb2 = prevSnap.bodies.find((x) => x.id === j.b);
          if (pa) { ax = lerp(pa.x, a.x, alpha); ay = lerp(pa.y, a.y, alpha); }
          if (pb2) { bx = lerp(pb2.x, b.x, alpha); by = lerp(pb2.y, b.y, alpha); }
        }
        const mx = (ax + bx) / 2 - CH_CX, my = (ay + by) / 2 - CH_CY;
        const len = Math.hypot(bx - ax, by - ay);
        v.mesh.visible = true;
        v.mesh.position.set(mx, my, 0.0);
        v.mesh.rotation.z = Math.atan2(by - ay, bx - ax);
        v.mesh.scale.x = Math.max(0.05, len);
      }
      for (const [id, v] of jointViews) if (!seenJ.has(id)) v.mesh.visible = false;
    }

    // ambient animation (suppressed by reduced motion / paused)
    if (!reducedMotion && !paused) {
      for (const ring of targetRings) {
        const s = 1 + Math.sin(elapsed * 2.4 + ring.position.x) * 0.07;
        ring.scale.set(s, s, 1);
      }
      for (const hm of hazardMeshes) {
        hm.material.emissiveIntensity = 0.45 + Math.sin(elapsed * 3.5) * 0.3;
      }
    }

    updateParticles(paused ? 0 : dt);

    // camera shake (decaying, never affects picking)
    if (shakeAmp > 0.001 && !reducedMotion) {
      shakeOffset.set((spawnRng.next() - 0.5) * shakeAmp, (spawnRng.next() - 0.5) * shakeAmp, 0);
      shakeAmp *= Math.pow(0.001, dt); // fast decay
    } else {
      shakeOffset.set(0, 0, 0);
      shakeAmp = Math.max(0, shakeAmp - dt);
    }
    camera.position.set(shakeOffset.x, shakeOffset.y, 20);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(draw);
  }

  function startLoop() {
    if (!raf) { lastT = 0; raf = requestAnimationFrame(draw); }
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVis = () => { if (document.hidden) stopLoop(); else startLoop(); };
  document.addEventListener("visibilitychange", onVis);
  startLoop();

  // -------------------------------------------------------------- public API
  return {
    FRAMING,

    setSnapshot(state, interpAlpha = 1) {
      if (state !== curSnap) { prevSnap = curSnap || state; curSnap = state; }
      alpha = Math.max(0, Math.min(1, interpAlpha));
      buildLevel(state.level);
    },

    setTheme(theme) {
      if (!theme || !theme.palette) return;
      paletteTheme = theme.palette;
      Object.assign(palette, theme.palette);
      scene.background = new THREE.Color(palette.background);
      mats.floor.color.set(palette.floor);
      mats.wall.color.set(palette.wall);
      mats.target.color.set(palette.accent);
    },

    setQuality: applyQuality,

    setReducedMotion(v) {
      reducedMotion = !!v;
      if (reducedMotion) { shakeAmp = 0; shakeOffset.set(0, 0, 0); }
    },

    setPaused(v) { paused = !!v; },

    setGhost(g) {
      if (!g) { ghost.visible = false; return; }
      ghost.visible = true;
      ghost.material = g.ok ? mats.ghostOk : mats.ghostBad;
      ghost.position.set(g.x - CH_CX, g.y - CH_CY, 0.45);
    },

    setSelection(id) { selection = id; },

    setCursor(x, y) { cursorGroup.position.set(x - CH_CX, y - CH_CY, 0.5); },

    frameChamber() { resize(); },

    setFraming(margin) {
      framingMargin = Math.max(0, Math.min(0.5, Number(margin) || FRAMING.margin));
      resize();
    },

    emitEvent,

    screenToWorld,
    worldToScreen,
    pickInteractive,

    dispose() {
      stopLoop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      if (ro) ro.disconnect();
      canvas.removeEventListener("pointerdown", handlePick);
      disposeGroup(envGroup);
      disposeGroup(levelGroup);
      disposeGroup(bodyGroup);
      disposeGroup(jointGroup);
      disposeGroup(overlayGroup);
      for (const m of Object.values(mats)) { if (m.map) m.map.dispose(); m.dispose(); }
      for (const m of Object.values(bodyMats)) m.dispose();
      bodyGeo.dispose();
      pGeo.dispose(); pMat.dispose();
      for (const d of disposables) { try { d.dispose(); } catch { /* already disposed */ } }
      renderer.dispose();
    },
  };
}

export default initRenderer;
