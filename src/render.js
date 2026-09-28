// Three.js presentation of the industrial test chamber.
// Orthographic camera; gameplay is 2D in the XY plane (chamber 20x12 world units).
// Consumes immutable session snapshots; never mutates rules state.

import * as THREE from "../vendor/three.module.js";
import { EffectComposer } from "../vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "../vendor/three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "../vendor/three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "../vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "../vendor/three/addons/postprocessing/SMAAPass.js";
import { FXAAShader } from "../vendor/three/addons/shaders/FXAAShader.js";
import { RoomEnvironment } from "../vendor/three/addons/environments/RoomEnvironment.js";
import { CHAMBER, MATERIALS, JOINT_TYPES, makeRng } from "./rules.js";
import { resolve as resolveGfx, describe as describeGfx, SHADOW_MAP, PARTICLE_CAP } from "./gfx.js";

// Framing: the whole chamber plus MARGIN of breathing room on every side.
export const FRAMING = Object.freeze({ margin: 0.1 });

const CH_W = CHAMBER.w, CH_H = CHAMBER.h;
const CH_CX = CH_W / 2, CH_CY = CH_H / 2;

// Legacy tier names (pre-Graphics-panel saves) map onto presets.
const LEGACY_TIER = { low: "low", medium: "balanced", high: "high" };

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

// Deterministic value noise for the procedural surfaces (no Math.random: the
// chamber looks the same on every load).
function hashNoise(seed) {
  const rng = makeRng(seed >>> 0);
  return () => rng.next();
}

function canvasTexture(c, srgb = true) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Back wall: 5x3 brushed-steel panels (matching the seam meshes), per-panel
// tone, soot gathering toward the floor and stencilled bay numbers.
function makePanelTexture() {
  const W = 1024, H = 683;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const rnd = hashNoise(0x5eed);
  const pw = W / 5, ph = H / 3;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    const t = 40 + Math.floor(rnd() * 12);
    g.fillStyle = `rgb(${t},${t + 4},${t + 14})`;
    g.fillRect(i * pw, j * ph, pw, ph);
    // horizontal brushing
    for (let k = 0; k < 60; k++) {
      const y = j * ph + rnd() * ph;
      const a = 0.015 + rnd() * 0.025;
      g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(i * pw + rnd() * pw * 0.3, y, pw * (0.4 + rnd() * 0.6), 1 + rnd() * 1.5);
    }
    // bevel: light top/left edge, dark bottom/right edge
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(i * pw + 3, j * ph + 3, pw - 6, 3);
    g.fillRect(i * pw + 3, j * ph + 3, 3, ph - 6);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(i * pw + 3, (j + 1) * ph - 6, pw - 6, 3);
    g.fillRect((i + 1) * pw - 6, j * ph + 3, 3, ph - 6);
  }
  // soot / grime toward the floor
  const grime = g.createLinearGradient(0, H * 0.55, 0, H);
  grime.addColorStop(0, "rgba(10,8,6,0)");
  grime.addColorStop(1, "rgba(10,8,6,0.45)");
  g.fillStyle = grime;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 260; k++) {
    const x = rnd() * W, y = H * 0.4 + rnd() * H * 0.6, r = 2 + rnd() * 14;
    g.fillStyle = `rgba(8,6,4,${0.04 + rnd() * 0.06})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // stencilled bay numbers
  g.font = "bold 34px monospace";
  g.textBaseline = "top";
  g.fillStyle = "rgba(255,170,90,0.22)";
  g.fillText("BAY 07", pw * 0 + 18, 16);
  g.fillText("LOAD 4T", pw * 4 + 18, ph * 1 + 16);
  g.fillStyle = "rgba(220,230,255,0.13)";
  g.fillText("PF-68", pw * 2 + 18, 16);
  return canvasTexture(c);
}

// Floor front edge and side walls: diamond tread plate.
function makeTreadTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#8a8f99";
  g.fillRect(0, 0, 64, 64);
  const lug = (x, y, a) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = "#c4c9d2"; g.fillRect(-10, -2.5, 20, 5);
    g.fillStyle = "#5a5f69"; g.fillRect(-10, 1.5, 20, 1.5);
    g.restore();
  };
  lug(16, 16, Math.PI / 4); lug(48, 48, Math.PI / 4);
  lug(48, 16, -Math.PI / 4); lug(16, 48, -Math.PI / 4);
  const tex = canvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Body surface maps: white-ish so the material colour stays the identity cue.
function makeBodyTexture(kind) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  const rnd = hashNoise(kind.length * 977 + kind.charCodeAt(0));
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 128);
  if (kind === "wood") {
    for (let y = 0; y < 128; y += 2) {
      const a = 0.08 + 0.1 * Math.abs(Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3));
      g.fillStyle = `rgba(70,35,10,${a})`;
      g.fillRect(0, y, 256, 2);
    }
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = "rgba(60,28,8,0.35)"; g.lineWidth = 2;
      g.beginPath(); g.ellipse(40 + rnd() * 180, 20 + rnd() * 90, 10, 4, 0, 0, Math.PI * 2); g.stroke();
    }
  } else if (kind === "steel") {
    for (let k = 0; k < 400; k++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.06})`;
      g.fillRect(rnd() * 256, rnd() * 128, 30 + rnd() * 80, 1);
    }
    g.fillStyle = "rgba(40,45,55,0.55)";
    g.fillRect(0, 62, 256, 4);
    for (let x = 8; x < 256; x += 32) { g.beginPath(); g.arc(x, 56, 3, 0, Math.PI * 2); g.fill(); }
  } else if (kind === "rubber") {
    for (let x = 0; x < 256; x += 16) {
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(x, 54, 8, 20);
    }
  } else if (kind === "glass") {
    g.fillStyle = "rgba(255,255,255,1)";
  }
  return canvasTexture(c);
}

// Round, soft-edged sprite for sparks and dust.
function makeSoftSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

// Warm pool of light under a ceiling lamp (additive, drawn on the back wall).
function makeLightPool() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d");
  // elliptical fall-off that reaches zero before every edge (no visible quad)
  g.setTransform(1, 0, 0, 4, 0, 0);
  const grd = g.createRadialGradient(64, 0, 2, 64, 0, 62);
  grd.addColorStop(0, "rgba(255,210,150,0.9)");
  grd.addColorStop(0.35, "rgba(255,180,110,0.3)");
  grd.addColorStop(1, "rgba(255,160,90,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 64);
  return canvasTexture(c);
}

// Colour grade + vignette. Runs on the linear HDR buffer just before OutputPass
// (tone mapping), so it only makes gentle moves and keeps >1 highlights intact.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      // gentle S-curve, a touch more saturation, warm highlights / cool shadows
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.95), smoothstep(0.15, 0.7, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.8));
      c *= 1.0 - uVignette * smoothstep(0.3, 0.8, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// ---------------------------------------------------------------- init

export function initRenderer(canvas, { onPick, graphics, detected } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_PALETTE.background);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);

  // lights: one dominant key + soft hemisphere fill + ambient base
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2df, 1.4);
  key.position.set(6, 10, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.HemisphereLight(0x9db4d8, 0x2a2018, 0.5);
  scene.add(fill);

  // Fit the key light's shadow frustum tightly around the chamber shell
  // (back wall to the front of the play plane) in light space.
  {
    const sc = key.shadow.camera;
    key.updateMatrixWorld();
    sc.position.copy(key.position);
    sc.lookAt(key.target.position);
    sc.updateMatrixWorld();
    const inv = sc.matrixWorldInverse;
    const bb = new THREE.Box3();
    const hw = (CH_W + 4) / 2, hh = (CH_H + 4) / 2;
    for (const x of [-hw, hw]) for (const y of [-hh, hh]) for (const z of [-1.4, 1.2]) {
      bb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    }
    sc.left = bb.min.x - 0.25; sc.right = bb.max.x + 0.25;
    sc.bottom = bb.min.y - 0.25; sc.top = bb.max.y + 0.25;
    sc.near = Math.max(0.1, -bb.max.z - 1); sc.far = -bb.min.z + 1;
    sc.updateProjectionMatrix();
  }

  // Image-based lighting (created on first use; `reflections` toggles it).
  let envTex = null;
  function ensureEnv() {
    if (envTex) return envTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    envTex = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return envTex;
  }

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
    targetGlow: new THREE.MeshBasicMaterial({
      color: palette.accent, map: makeSoftSprite(), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    payloadRing: new THREE.MeshBasicMaterial({ color: palette.accent }),
  };
  // Environment surfaces reflect the room light only faintly; bodies get more.
  for (const k of ["floor", "wall", "panel", "obstacle", "pin", "spring"]) mats[k].envMapIntensity = 0.35;
  mats.obstacle.envMapIntensity = 0.6;
  mats.cursor.depthTest = false;

  // Bodies: clear-coated physical materials. Colour is the identity cue and is
  // never darkened; surface maps (detail) are near-white multipliers.
  const BODY_LOOK = {
    steel: { roughness: 0.32, metalness: 0.85, clearcoat: 0.3, env: 1.0 },
    wood: { roughness: 0.55, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.35, env: 0.6 },
    glass: { roughness: 0.06, metalness: 0.0, clearcoat: 1.0, env: 1.4, opacity: 0.78 },
    rubber: { roughness: 0.8, metalness: 0.0, clearcoat: 0.15, env: 0.4 },
  };
  const bodyMats = {};
  for (const [id, m] of Object.entries(MATERIALS)) {
    const look = BODY_LOOK[id] || { roughness: 0.45, metalness: 0.05, clearcoat: 0.4, env: 0.7 };
    bodyMats[id] = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(m.color),
      roughness: look.roughness,
      metalness: look.metalness,
      clearcoat: look.clearcoat,
      clearcoatRoughness: look.clearcoatRoughness ?? 0.12,
      envMapIntensity: look.env,
      transparent: id === "glass",
      opacity: look.opacity ?? 1,
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
    // world-space UVs so tread plate keeps its scale on every slab
    for (const m of [floor, ceil]) worldUv(m);
    for (const c of envGroup.children) if (c.material === mats.wall) worldUv(c);
  }

  function worldUv(mesh, scale = 1 / 0.6) {
    const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + mesh.position.x) * scale, (pos.getY(i) + mesh.position.y) * scale);
    }
    uv.needsUpdate = true;
  }

  // Detail layer: ceiling lamp fixtures with warm light pools on the back
  // wall, pipe brackets and a gauge. Purely decorative, never pickable.
  const detailGroup = new THREE.Group();
  const lampMats = [];
  const poolMats = [];
  function buildDetail() {
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.5 });
    const poolTex = makeLightPool();
    for (const x of [-6.5, 0, 6.5]) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.34), housingMat);
      housing.position.set(x, CH_CY - 0.14, -0.82);
      detailGroup.add(housing);
      const lm = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: 0xffc48a, emissiveIntensity: 2.6 });
      lampMats.push(lm);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.08), lm);
      tube.position.set(x, CH_CY - 0.31, -0.7);
      detailGroup.add(tube);
      const pm = new THREE.MeshBasicMaterial({
        map: poolTex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      poolMats.push(pm);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), pm);
      pool.position.set(x, CH_CY - 0.3 - 4, -0.9);
      detailGroup.add(pool);
    }
    // gauge on the right wall panel
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.85, envMapIntensity: 0.2 }));
    dial.position.set(CH_CX + 1.2, CH_CY - 1.8, -0.9);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 8, 32), new THREE.MeshStandardMaterial({ color: 0x9aa2b8, roughness: 0.3, metalness: 0.9 }));
    bezel.position.copy(dial.position);
    const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.34), new THREE.MeshBasicMaterial({ color: 0xc0392b }));
    needle.position.set(dial.position.x, dial.position.y, -0.88);
    needle.geometry.translate(0, 0.14, 0);
    needle.rotation.z = -0.9;
    detailGroup.add(dial, bezel, needle);
    detailGroup.userData.needle = needle;
    detailGroup.visible = false;
    envGroup.add(detailGroup);
  }

  // decorative props, deterministic per level seed
  function buildDecor(seed) {
    const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.8, envMapIntensity: 0.3 });
    decorMats.push(crateMat);
    if (gfx && gfx.detail === "detailed") crateMat.map = texture("wood");
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
  buildDetail();

  // -------------------------------------------------------------- level content
  const targetRings = [];
  const targetGlows = [];
  const hazardMeshes = [];
  const decorMats = [];
  let builtLevelId = null;

  function buildLevel(level) {
    if (builtLevelId === level.id) return;
    if (builtLevelId !== null) disposeGroup(levelGroup);
    builtLevelId = level.id;
    decorMats.length = 0;
    targetRings.length = 0;
    targetGlows.length = 0;
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
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(t.r * 3, t.r * 3), mats.targetGlow);
      glow.position.set(t.x - CH_CX, t.y - CH_CY, -0.05);
      glow.visible = !!gfx && gfx.detail === "detailed";
      levelGroup.add(glow);
      targetGlows.push(glow);
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
  // Detailed bodies are true spheres (same 0.5 radius, so picking is unchanged):
  // they catch the key light, clear-coat highlight and room reflections.
  const sphereGeo = new THREE.SphereGeometry(0.5, 40, 28);
  sphereGeo.rotateX(Math.PI / 2);
  const payloadRingGeo = new THREE.TorusGeometry(0.6, 0.045, 8, 40);
  const currentBodyGeo = () => (gfx && gfx.detail === "detailed" ? sphereGeo : bodyGeo);

  function getBodyView(b) {
    let v = bodyViews.get(b.id);
    if (!v) {
      const mat = bodyMats[b.material].clone();
      if (gfx && gfx.detail === "detailed") mat.map = texture(b.material);
      const mesh = new THREE.Mesh(currentBodyGeo(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: "body", id: b.id, material: b.material };
      // payloads carry an accent ring matching the target rings
      if (b.kind === "payload") {
        const pr = new THREE.Mesh(payloadRingGeo, mats.payloadRing);
        pr.position.z = 0.05;
        mesh.add(pr);
      }
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
  const ghostCyl = bodyGeo.clone();
  const ghostSphere = sphereGeo.clone();
  const ghost = new THREE.Mesh(ghostCyl, mats.ghostOk);
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
  const MAX_PARTICLES = PARTICLE_CAP.high;
  let particleCap = PARTICLE_CAP.high;
  let particleBoost = 1; // >1 pushes sparks above the bloom threshold
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const softSprite = makeSoftSprite();
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
      pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = 0.7;
      const fade = (1 - p.life / p.ttl) * particleBoost;
      pCol[n * 3] = p.r * fade; pCol[n * 3 + 1] = p.g * fade; pCol[n * 3 + 2] = p.b * fade;
      n++;
    }
    pGeo.setDrawRange(0, n);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // Ambient dust drifting through the lamp light (background: animated).
  const DUST = 140;
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(DUST * 3);
  const dSeed = new Float32Array(DUST * 2);
  {
    const r = makeRng(0xd057);
    for (let i = 0; i < DUST; i++) {
      dPos[i * 3] = (r.next() - 0.5) * CH_W;
      dPos[i * 3 + 1] = (r.next() - 0.5) * CH_H;
      dPos[i * 3 + 2] = -0.6 + r.next() * 0.3;
      dSeed[i * 2] = r.next() * Math.PI * 2;
      dSeed[i * 2 + 1] = 0.08 + r.next() * 0.18;
    }
  }
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const dMat = new THREE.PointsMaterial({
    size: 0.09, map: softSprite, color: 0xffd9a8, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dust = new THREE.Points(dGeo, dMat);
  dust.layers.set(LAYER_FX);
  dust.frustumCulled = false;
  dust.visible = false;
  scene.add(dust);

  function updateDust(dt) {
    for (let i = 0; i < DUST; i++) {
      const ph = dSeed[i * 2], sp = dSeed[i * 2 + 1];
      let y = dPos[i * 3 + 1] + sp * dt;
      if (y > CH_CY) y -= CH_H;
      dPos[i * 3 + 1] = y;
      dPos[i * 3] += Math.sin(elapsed * 0.5 + ph) * 0.05 * dt;
    }
    dGeo.attributes.position.needsUpdate = true;
  }

  // -------------------------------------------------------------- state
  let reducedMotion = false;
  let paused = false;
  let prevSnap = null;
  let curSnap = null;
  let alpha = 1;
  let selection = null;
  let shakeAmp = 0;
  const shakeOffset = new THREE.Vector3();
  let elapsed = 0;

  // -------------------------------------------------------------- graphics settings
  let gfx = null;          // resolved settings (gfx.js)
  let gfxSaved = null;
  let detectedPreset = "balanced";
  let composer = null;
  let postKey = null;
  let postFailed = false;
  let gradePass = null;
  let adaptiveScale = 1;
  let frameTimes = [];
  let fps = 0;
  let pixelRatio = 0;
  let sizePx = [0, 0];
  let sizeDirty = true;
  let fpsEl = null;

  const texCache = {};
  function texture(name) {
    if (texCache[name]) return texCache[name];
    let t;
    if (name === "panel") t = makePanelTexture();
    else if (name === "tread") t = makeTreadTexture();
    else t = makeBodyTexture(name);
    if (name === "wood") { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    texCache[name] = t;
    return t;
  }

  function setMap(mat, map, bump = null, bumpScale = 1) {
    if (mat.map === map && mat.bumpMap === bump) return;
    mat.map = map;
    mat.bumpMap = bump;
    mat.bumpScale = bumpScale;
    mat.needsUpdate = true;
  }

  function applyDetail(on) {
    detailGroup.visible = on;
    setMap(mats.panel, on ? texture("panel") : null, on ? texture("panel") : null, 1.5);
    mats.panel.color.set(on ? 0xffffff : 0x2a2e3a);
    const tread = on ? texture("tread") : null;
    setMap(mats.floor, tread, tread, 1.2);
    setMap(mats.wall, tread, tread, 0.8);
    for (const m of decorMats) setMap(m, on ? texture("wood") : null);
    for (const g of targetGlows) g.visible = on;
    for (const v of bodyViews.values()) {
      v.mesh.geometry = on ? sphereGeo : bodyGeo;
      setMap(v.mesh.material, on ? texture(v.mesh.userData.material) : null);
    }
    ghost.geometry = on ? ghostSphere : ghostCyl;
  }

  function applyEmissiveBoost() {
    // With bloom, targets, payload rings and lamps are pushed above 1.0 so only
    // they glow; without it they stay in display range (no washed-out rings).
    const boost = gfx.bloom === "on" ? 2.2 : 1;
    mats.target.color.set(palette.accent).multiplyScalar(boost);
    mats.payloadRing.color.set(palette.accent).multiplyScalar(boost === 1 ? 1 : 1.6);
    mats.targetGlow.color.set(palette.accent);
    for (const lm of lampMats) lm.emissiveIntensity = gfx.bloom === "on" ? 2.6 : 1.2;
    particleBoost = gfx.particles === "high" ? (gfx.bloom === "on" ? 2.2 : 1.3) : 1;
  }

  // The post chain tone-maps the clear colour (direct rendering does not), which
  // crushes the dark backdrop; lift it so both paths show the same backdrop.
  function applyBackground() {
    const c = new THREE.Color(palette.background);
    if (gfx && gfx.post) c.multiplyScalar(2.4);
    scene.background = c;
  }

  function setGraphics(saved, detected) {
    gfxSaved = saved || {};
    if (detected) detectedPreset = detected;
    gfx = resolveGfx(gfxSaved, detectedPreset);
    canvas.dataset.gfxPreset = gfx.preset;

    const size = SHADOW_MAP[gfx.shadows];
    renderer.shadowMap.enabled = size > 0;
    key.castShadow = size > 0;
    if (size > 0 && key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }

    const refl = gfx.reflections === "on";
    scene.environment = refl ? ensureEnv() : null;
    // IBL supplies the fill when on; keep the no-reflection look as before.
    ambient.intensity = refl ? 0.18 : 0.45;
    fill.intensity = refl ? 0.4 : 0.5;

    particleCap = PARTICLE_CAP[gfx.particles];
    if (pool.length > particleCap) pool.splice(0, pool.length - particleCap);
    if (gfx.particles === "high") {
      pMat.map = softSprite; pMat.size = 0.2; pMat.blending = THREE.AdditiveBlending;
    } else {
      pMat.map = null; pMat.size = 0.14; pMat.blending = THREE.NormalBlending;
    }
    pMat.needsUpdate = true;

    dust.visible = gfx.background === "animated";
    applyBackground();
    applyDetail(gfx.detail === "detailed");
    applyEmissiveBoost();

    adaptiveScale = 1;
    frameTimes = [];
    postKey = null; // rebuild the post chain on the next frame
    sizeDirty = true;
    showFpsMeter(gfx.showFps);
    // materials pick up shadow / environment changes on recompile
    scene.traverse((n) => {
      if (n.material) for (const m of [].concat(n.material)) m.needsUpdate = true;
    });
    for (const v of bodyViews.values()) v.mesh.material.needsUpdate = true;
  }

  function applyQuality(tier) {
    // legacy API: a bare tier name selects that preset
    setGraphics({ ...(gfxSaved || {}), preset: LEGACY_TIER[tier] || tier }, detectedPreset);
  }

  function showFpsMeter(on) {
    if (on && !fpsEl) {
      fpsEl = document.createElement("div");
      fpsEl.id = "pf-fps";
      fpsEl.className = "pf-fps";
      fpsEl.setAttribute("aria-hidden", "true");
      document.body.append(fpsEl);
    }
    if (fpsEl) fpsEl.hidden = !on;
  }

  function buildPost(w, h) {
    if (composer) { composer.dispose(); composer = null; }
    gradePass = null;
    if (!gfx.post || postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: gfx.antialias === "msaa" ? 4 : 0,
      });
      const c = new EffectComposer(renderer, target);
      c.setPixelRatio(pixelRatio);
      c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (gfx.ao !== "off") {
        const ao = new GTAOPass(scene, camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        const hi = gfx.ao === "high";
        ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        c.addPass(ao);
      }
      if (gfx.bloom === "on") {
        // high threshold: only lamps, glowing rings, hazards and sparks bloom
        c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.5, 0.88));
      }
      if (gfx.grade === "on") {
        gradePass = new ShaderPass(GradeShader);
        c.addPass(gradePass);
      }
      c.addPass(new OutputPass());
      if (gfx.antialias === "smaa") c.addPass(new SMAAPass(pw, ph));
      if (gfx.antialias === "fxaa") {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        c.addPass(fxaa);
      }
      composer = c;
    } catch {
      // post-processing is an enhancement: render directly (the panel says so)
      postFailed = true;
      composer = null;
    }
  }

  // Adaptive resolution: average ~90 frames; step down when slow, back up when fast.
  function adapt(dtMs) {
    frameTimes.push(dtMs);
    if (frameTimes.length < 90) return false;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes.length = 0;
    fps = 1000 / avg;
    if (fpsEl && !fpsEl.hidden) fpsEl.textContent = `${Math.round(fps)} fps · ${Math.round(pixelRatio * 100) / 100}×`;
    if (!gfx.adaptive) return false;
    const before = adaptiveScale;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
    return before !== adaptiveScale;
  }

  function graphicsInfo() {
    return {
      preset: gfx.preset,
      resolved: gfx,
      summary: describeGfx(gfx, [Math.round(sizePx[0] * pixelRatio), Math.round(sizePx[1] * pixelRatio)]),
      pixels: [Math.round(sizePx[0] * pixelRatio), Math.round(sizePx[1] * pixelRatio)],
      fps: Math.round(fps),
      adaptiveScale: Math.round(adaptiveScale * 100) / 100,
      postFailed,
    };
  }

  let framingMargin = FRAMING.margin;

  function resize() {
    const wpx = canvas.clientWidth || 640;
    const hpx = canvas.clientHeight || 400;
    sizeDirty = true;
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
      const hb = gfx.bloom === "on" ? 1.6 : 1;
      for (const hm of hazardMeshes) {
        hm.material.emissiveIntensity = (0.45 + Math.sin(elapsed * 3.5) * 0.3) * hb;
      }
    }

    // background life: dust drift, lamp shimmer, gauge needle (frozen when static,
    // paused or under reduced motion)
    if (gfx.background === "animated" && !reducedMotion && !paused) {
      updateDust(dt);
      const base = gfx.bloom === "on" ? 2.6 : 1.2;
      lampMats.forEach((lm, i) => {
        const flick = i === 1 && Math.sin(elapsed * 0.7) > 0.985 ? 0.55 : 1; // rare stutter
        lm.emissiveIntensity = base * (0.94 + Math.sin(elapsed * (1.3 + i * 0.4) + i) * 0.06) * flick;
      });
      poolMats.forEach((pm, i) => { pm.opacity = 0.16 * (0.92 + Math.sin(elapsed * (1.3 + i * 0.4) + i) * 0.08); });
      if (detailGroup.userData.needle) detailGroup.userData.needle.rotation.z = -0.9 + Math.sin(elapsed * 0.9) * 0.08 + Math.sin(elapsed * 7.1) * 0.015;
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

    // Hidden canvas (menus): skip the GPU work entirely.
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0) {
      const rescale = adapt(dt * 1000);
      const ratio = Math.min(window.devicePixelRatio || 1, gfx.dprCap) * gfx.scale * adaptiveScale;
      if (sizeDirty || rescale || w !== sizePx[0] || h !== sizePx[1] || ratio !== pixelRatio) {
        sizeDirty = false;
        sizePx = [w, h];
        pixelRatio = ratio;
        renderer.setPixelRatio(ratio);
        renderer.setSize(w, h, false);
      }
      const k = gfx.post && !postFailed ? [gfx.ao, gfx.bloom, gfx.grade, gfx.antialias, w, h, pixelRatio].join("|") : "none";
      if (k !== postKey) { postKey = k; buildPost(w, h); }
      if (composer) {
        try { composer.render(dt); }
        catch { postFailed = true; postKey = null; composer = null; renderer.setRenderTarget(null); renderer.render(scene, camera); }
      } else {
        renderer.render(scene, camera);
      }
    }
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
  setGraphics(graphics || { preset: "low" }, detected);
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
      Object.assign(palette, theme.palette);
      applyBackground();
      mats.floor.color.set(palette.floor);
      mats.wall.color.set(palette.wall);
      mats.target.color.set(palette.accent);
      if (gfx) applyEmissiveBoost();
    },

    setQuality: applyQuality,
    setGraphics,
    graphicsInfo,

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
      bodyGeo.dispose(); sphereGeo.dispose(); payloadRingGeo.dispose();
      ghostCyl.dispose(); ghostSphere.dispose();
      pGeo.dispose(); pMat.dispose(); dGeo.dispose(); dMat.dispose(); softSprite.dispose();
      for (const t of Object.values(texCache)) t.dispose();
      if (envTex) envTex.dispose();
      if (composer) composer.dispose();
      if (fpsEl) fpsEl.remove();
      for (const d of disposables) { try { d.dispose(); } catch { /* already disposed */ } }
      renderer.dispose();
    },
  };
}

export default initRenderer;
