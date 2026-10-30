// The industrial test chamber on starhermit:scene, as the browser build's
// src/render.js drew it with three.js r161: the orthographic camera looking
// straight at the 20 × 12 chamber (gameplay in the XY plane), the panelled
// back wall with seams and rivets, the floor slab, ceiling and side walls,
// the hazard-striped floor edge, the per-level obstacles (with their bevel
// lip), chevron hazard strips and pulsing target rings (with soft glows), the
// seeded crates and pipes, the bodies (clear-coated physical on High/Ultra,
// Standard on Balanced, Lambert on Low; true spheres with surface maps when
// Surface detail is on, flat discs otherwise; payloads with an accent ring),
// pin and spring joints, the ghost, cursor and selection ring, the pooled
// spark bursts, the drifting dust, the lamp fixtures with their light pools,
// the twitching gauge needle and the low camera shake. The bodies are drawn
// from the session's snapshots interpolated between fixed steps; rendering
// never touches the rules state.
//
// From three.js r161 (physically based lights): colours as written, the
// punctual lights' intensities ÷ π (the engine takes three's legacy units).
// The old composer (RenderPass in half floats → GTAO → UnrealBloom 0.6 / 0.5 /
// 0.88 → the colour grade in linear light → OutputPass with ACES 1.05 →
// SMAA / FXAA) is the runtime's renderer.ao / bloom / grade / antialias in
// the same order. The old canvas sat between the rails: the camera spans the
// window and its frustum is offset so the chamber is framed in that
// rectangle (screens.ts paints the page around it).
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry,
  Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, OrthographicCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial,
  RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector3, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Rules, type GameEvent, type Level, type State, type Theme } from "./game.ts";
import { SPARK_MAX, DUST_MAX, sparkCap, type Look } from "./quality.ts";

const { w: CH_W, h: CH_H } = Rules.CHAMBER;
const CH_CX = CH_W / 2, CH_CY = CH_H / 2;
/** render.js FRAMING: the whole chamber plus this margin on every side ("Tight frame": 0.02). */
export const FRAMING = { margin: 0.1 };
const DEFAULT_PALETTE = { background: "#14161c", floor: "#3a3f4d", wall: "#565d70", accent: "#ff8a3d", uiAccent: "#ffb066" };
export interface Rect { x: number; y: number; width: number; height: number }

// ---------------------------------------------------------------- textures (render.js, unchanged drawing)
type Ctx = OffscreenCanvasRenderingContext2D;
function canvas(w: number, h: number): { c: OffscreenCanvas; g: Ctx } {
  const c = new OffscreenCanvas(w, h);
  return { c, g: c.getContext("2d")! as Ctx };
}
function canvasTexture(c: OffscreenCanvas, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(c);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function hashNoise(seed: number): () => number {
  const rng = Rules.makeRng(seed >>> 0);
  return () => rng.next();
}
function makeChevronTexture(): CanvasTexture {
  const { c, g } = canvas(128, 64);
  g.fillStyle = "#1a0d08";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#ff8a3d";
  for (let x = -64; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 64); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 64);
    g.closePath(); g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}
/** Back wall: 5 × 3 brushed-steel panels, soot toward the floor, stencilled bay numbers (authored at 1024 × 683). */
function makePanelTexture(size: number): CanvasTexture {
  const W = 1024, H = 683;
  const { c, g } = canvas(size, Math.round(size * H / W));
  g.scale(size / W, size / W);
  const rnd = hashNoise(0x5eed);
  const pw = W / 5, ph = H / 3;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    const t = 40 + Math.floor(rnd() * 12);
    g.fillStyle = `rgb(${t},${t + 4},${t + 14})`;
    g.fillRect(i * pw, j * ph, pw, ph);
    for (let k = 0; k < 60; k++) {
      const y = j * ph + rnd() * ph;
      const a = 0.015 + rnd() * 0.025;
      g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(i * pw + rnd() * pw * 0.3, y, pw * (0.4 + rnd() * 0.6), 1 + rnd() * 1.5);
    }
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(i * pw + 3, j * ph + 3, pw - 6, 3);
    g.fillRect(i * pw + 3, j * ph + 3, 3, ph - 6);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(i * pw + 3, (j + 1) * ph - 6, pw - 6, 3);
    g.fillRect((i + 1) * pw - 6, j * ph + 3, 3, ph - 6);
  }
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
  g.font = "bold 34px monospace";
  g.textBaseline = "top";
  g.fillStyle = "rgba(255,170,90,0.22)";
  g.fillText("BAY 07", pw * 0 + 18, 16);
  g.fillText("LOAD 4T", pw * 4 + 18, ph * 1 + 16);
  g.fillStyle = "rgba(220,230,255,0.13)";
  g.fillText("PF-68", pw * 2 + 18, 16);
  return canvasTexture(c);
}
/** Floor front edge and side walls: diamond tread plate. */
function makeTreadTexture(): CanvasTexture {
  const { c, g } = canvas(64, 64);
  g.fillStyle = "#8a8f99";
  g.fillRect(0, 0, 64, 64);
  const lug = (x: number, y: number, a: number): void => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = "#c4c9d2"; g.fillRect(-10, -2.5, 20, 5);
    g.fillStyle = "#5a5f69"; g.fillRect(-10, 1.5, 20, 1.5);
    g.restore();
  };
  lug(16, 16, Math.PI / 4); lug(48, 48, Math.PI / 4);
  lug(48, 16, -Math.PI / 4); lug(16, 48, -Math.PI / 4);
  const tex = canvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}
/** Body surface maps: white-ish multipliers so the material colour stays the identity cue (authored at 256 × 128). */
function makeBodyTexture(kind: string, size: number): CanvasTexture {
  const { c, g } = canvas(size, size / 2);
  g.scale(size / 256, size / 256);
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
  }
  return canvasTexture(c);
}
/** Round, soft-edged sprite for the dust and the target glows. */
function makeSoftSprite(): CanvasTexture {
  const { c, g } = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}
/** Warm pool of light under a ceiling lamp (additive, on the back wall). */
function makeLightPool(): CanvasTexture {
  const { c, g } = canvas(128, 256);
  g.setTransform(1, 0, 0, 4, 0, 0);
  const grd = g.createRadialGradient(64, 0, 2, 64, 0, 62);
  grd.addColorStop(0, "rgba(255,210,150,0.9)");
  grd.addColorStop(0.35, "rgba(255,180,110,0.3)");
  grd.addColorStop(1, "rgba(255,160,90,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 64);
  return canvasTexture(c);
}


// ---------------------------------------------------------------- the scene
const EXPOSURE = 1.05;
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 20);
camera.lookAt(0, 0, 0);

// One dominant key + soft hemisphere fill + ambient base (render.js's r161 intensities; engine.minor 28).
const ambient = new AmbientLight(0xffffff, 0.45);
const key = new DirectionalLight(0xfff2df, 1.4);
key.position.set(6, 10, 14);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
const fill = new HemisphereLight(0x9db4d8, 0x2a2018, 0.5);
// render.js fitted the key light's shadow frustum tightly around the chamber shell (back wall to the front of
// the play plane) in light space; the light looks from its position at the origin.
{
  const f = new Vector3().sub(key.position).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const hw = (CH_W + 4) / 2, hh = (CH_H + 4) / 2, p = new Vector3();
  for (const x of [-hw, hw]) for (const y of [-hh, hh]) for (const z of [-1.4, 1.2]) {
    p.set(x, y, z).sub(key.position);
    const v = [p.dot(r), p.dot(u), -p.dot(f)];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
  }
  const sc = key.shadow.camera as OrthographicCamera;
  Object.assign(sc, { left: lo[0] - 0.25, right: hi[0] + 0.25, bottom: lo[1] - 0.25, top: hi[1] + 0.25, near: Math.max(0.1, -hi[2] - 1), far: -lo[2] + 1 });
  sc.updateProjectionMatrix();
}
scene.add(ambient, key, key.target, fill);

const envGroup = new Group();     // chamber shell, walls, decor
const levelGroup = new Group();   // obstacles, hazards, targets, crates and pipes (per level)
const bodyGroup = new Group();
const jointGroup = new Group();
const overlayGroup = new Group(); // ghost, selection, cursor
scene.add(envGroup, levelGroup, bodyGroup, jointGroup, overlayGroup);

const palette = { ...DEFAULT_PALETTE };
const chevron = makeChevronTexture();
const softSprite = makeSoftSprite();
const mats = {
  floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.9, metalness: 0.1 }),
  wall: new MeshStandardMaterial({ color: palette.wall, roughness: 0.8, metalness: 0.2 }),
  panel: new MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.85, metalness: 0.15 }),
  obstacle: new MeshStandardMaterial({ color: 0x7a8296, roughness: 0.5, metalness: 0.6 }),
  lip: new MeshStandardMaterial({ color: 0x9aa2b8, roughness: 0.35, metalness: 0.7 }),
  hazard: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0xff552e, emissiveIntensity: 0.6, map: chevron }),
  target: new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.85, side: DoubleSide }),
  ghostOk: new MeshBasicMaterial({ color: 0x4be38a, transparent: true, opacity: 0.4 }),
  ghostBad: new MeshBasicMaterial({ color: 0xe34b4b, transparent: true, opacity: 0.4 }),
  selectionRing: new MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, side: DoubleSide }),
  pin: new MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4, metalness: 0.5 }),
  spring: new MeshStandardMaterial({ color: 0x6fd3ff, roughness: 0.4, metalness: 0.3 }),
  cursor: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
  targetGlow: new MeshBasicMaterial({ color: palette.accent, map: softSprite, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
  payloadRing: new MeshBasicMaterial({ color: palette.accent }),
  seam: new MeshStandardMaterial({ color: 0x1c1f28, roughness: 0.9 }),
  rivet: new MeshStandardMaterial({ color: 0x4a5060, roughness: 0.4, metalness: 0.7 }),
  crate: new MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.8, envMapIntensity: 0.3 }),
  pipe: new MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.5, metalness: 0.6 }),
};
// Environment surfaces reflect the room light only faintly; bodies get more.
for (const k of ["floor", "wall", "panel", "pin", "spring"] as const) mats[k].envMapIntensity = 0.35;
mats.obstacle.envMapIntensity = 0.6;
mats.cursor.depthTest = false;

// Bodies: colour is the identity cue and never darkened; surface maps are near-white multipliers.
const BODY_LOOK: Record<string, { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness?: number; env: number; opacity?: number }> = {
  steel: { roughness: 0.32, metalness: 0.85, clearcoat: 0.3, env: 1.0 },
  wood: { roughness: 0.55, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.35, env: 0.6 },
  glass: { roughness: 0.06, metalness: 0.0, clearcoat: 1.0, env: 1.4, opacity: 0.78 },
  rubber: { roughness: 0.8, metalness: 0.0, clearcoat: 0.15, env: 0.4 },
};
type BodyMat = MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
function bodyMaterial(material: string, tier: string): BodyMat {
  const m = Rules.MATERIALS[material]!;
  const look = BODY_LOOK[material] ?? { roughness: 0.45, metalness: 0.05, clearcoat: 0.4, env: 0.7 };
  const base = { color: new Color(m.color), transparent: material === "glass", opacity: look.opacity ?? 1 };
  if (tier === "lambert") return new MeshLambertMaterial(base);
  if (tier === "standard") return new MeshStandardMaterial({ ...base, roughness: look.roughness, metalness: look.metalness, envMapIntensity: look.env });
  return new MeshPhysicalMaterial({
    ...base, roughness: look.roughness, metalness: look.metalness, clearcoat: look.clearcoat,
    clearcoatRoughness: look.clearcoatRoughness ?? 0.12, envMapIntensity: look.env,
  });
}

let look: Look | null = null;
const texCache = new Map<string, Texture>();
function texture(name: string): Texture {
  let t = texCache.get(name);
  if (t) return t;
  const b = look ? look.budget : { wallTex: 1024, bodyTex: 256 };
  if (name === "panel") t = makePanelTexture(b.wallTex);
  else if (name === "tread") t = makeTreadTexture();
  else t = makeBodyTexture(name, b.bodyTex);
  if (name === "wood") t.wrapS = t.wrapT = RepeatWrapping;
  texCache.set(name, t);
  return t;
}

function worldUv(mesh: Mesh, scale = 1 / 0.6): void {
  const pos = mesh.geometry.attributes.position!, uv = mesh.geometry.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + mesh.position.x) * scale, (pos.getY(i) + mesh.position.y) * scale);
  uv.needsUpdate = true;
}

// -------------------------------------------------------------- chamber shell (buildChamber)
const shellMeshes: Mesh[] = [];
{
  const back = new Mesh(new BoxGeometry(CH_W + 4, CH_H + 4, 0.4), mats.panel);
  back.position.set(0, 0, -1.2);
  back.receiveShadow = true;
  envGroup.add(back);
  for (let i = 0; i <= 5; i++) {
    const seam = new Mesh(new BoxGeometry(0.08, CH_H + 4, 0.06), mats.seam);
    seam.position.set(-(CH_W + 4) / 2 + i * ((CH_W + 4) / 5), 0, -0.96);
    envGroup.add(seam);
  }
  for (let i = 0; i <= 3; i++) {
    const seam = new Mesh(new BoxGeometry(CH_W + 4, 0.08, 0.06), mats.seam);
    seam.position.set(0, -(CH_H + 4) / 2 + i * ((CH_H + 4) / 3), -0.96);
    envGroup.add(seam);
  }
  const rivetGeo = new CylinderGeometry(0.09, 0.09, 0.08, 10);
  rivetGeo.rotateX(Math.PI / 2);
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 3; j++) {
    const r = new Mesh(rivetGeo, mats.rivet);
    r.position.set(-(CH_W + 4) / 2 + i * ((CH_W + 4) / 5), -(CH_H + 4) / 2 + j * ((CH_H + 4) / 3), -0.92);
    envGroup.add(r);
  }
  const floor = new Mesh(new BoxGeometry(CH_W, 0.6, 2.4), mats.floor);
  floor.position.set(0, -CH_CY - 0.3, -0.2);
  floor.receiveShadow = true;
  envGroup.add(floor);
  const ceil = new Mesh(new BoxGeometry(CH_W, 0.5, 2.0), mats.wall);
  ceil.position.set(0, CH_CY + 0.25, -0.3);
  envGroup.add(ceil);
  shellMeshes.push(floor, ceil);
  for (const s of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(0.5, CH_H + 1, 2.0), mats.wall);
    wall.position.set(s * (CH_CX + 0.25), 0, -0.3);
    envGroup.add(wall);
    shellMeshes.push(wall);
  }
  const strip = new Mesh(new BoxGeometry(CH_W, 0.12, 0.02), mats.hazard);
  strip.position.set(0, -CH_CY + 0.06, 0.02);
  envGroup.add(strip);
  for (const m of shellMeshes) worldUv(m);
}

// Detail layer: lamp fixtures with warm pools on the back wall and the gauge (decorative, never picked).
const detailGroup = new Group();
const lampMats: MeshStandardMaterial[] = [];
const poolMats: MeshBasicMaterial[] = [];
let needle: Mesh;
{
  const housingMat = new MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.5 });
  const poolTex = makeLightPool();
  for (const x of [-6.5, 0, 6.5]) {
    const housing = new Mesh(new BoxGeometry(1.8, 0.28, 0.34), housingMat);
    housing.position.set(x, CH_CY - 0.14, -0.82);
    detailGroup.add(housing);
    const lm = new MeshStandardMaterial({ color: 0x2a1a0a, emissive: 0xffc48a, emissiveIntensity: 2.6 });
    lampMats.push(lm);
    const tube = new Mesh(new BoxGeometry(1.5, 0.07, 0.08), lm);
    tube.position.set(x, CH_CY - 0.31, -0.7);
    detailGroup.add(tube);
    const pm = new MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false });
    poolMats.push(pm);
    const pool = new Mesh(new PlaneGeometry(5, 8), pm);
    pool.position.set(x, CH_CY - 0.3 - 4, -0.9);
    detailGroup.add(pool);
  }
  const dial = new Mesh(new CircleGeometry(0.42, 32), new MeshStandardMaterial({ color: 0x77736a, roughness: 0.85, envMapIntensity: 0.2 }));
  dial.position.set(CH_CX + 1.2, CH_CY - 1.8, -0.9);
  const bezel = new Mesh(new TorusGeometry(0.44, 0.06, 8, 32), new MeshStandardMaterial({ color: 0x9aa2b8, roughness: 0.3, metalness: 0.9 }));
  bezel.position.copy(dial.position);
  const needleGeo = new PlaneGeometry(0.04, 0.34);
  needleGeo.translate(0, 0.14, 0);
  needle = new Mesh(needleGeo, new MeshBasicMaterial({ color: 0xc0392b }));
  needle.position.set(dial.position.x, dial.position.y, -0.88);
  needle.rotation.z = -0.9;
  detailGroup.add(dial, bezel, needle);
  detailGroup.visible = false;
  envGroup.add(detailGroup);
}

// -------------------------------------------------------------- level content (buildLevel)
const targetRings: Mesh[] = [];
const targetGlows: Mesh[] = [];
const hazardMeshes: Mesh[] = [];
const crates: Mesh[] = [];
let builtLevelId: string | null = null;
function disposeTree(o: Object3D): void {
  o.traverse((n) => {
    const m = n as Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
function buildLevel(level: Level): void {
  if (builtLevelId === level.id) return;
  for (const c of [...levelGroup.children]) { disposeTree(c); levelGroup.remove(c); }
  for (const h of hazardMeshes) { const mt = h.material as MeshStandardMaterial; mt.map?.dispose(); mt.dispose(); }
  builtLevelId = level.id;
  targetRings.length = 0; targetGlows.length = 0; hazardMeshes.length = 0; crates.length = 0;
  for (const o of level.obstacles || []) {
    const mesh = new Mesh(new BoxGeometry(o.w, o.h, 1.2), mats.obstacle);
    mesh.position.set(o.x + o.w / 2 - CH_CX, o.y + o.h / 2 - CH_CY, -0.1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    levelGroup.add(mesh);
    const lip = new Mesh(new BoxGeometry(o.w, 0.05, 1.24), mats.lip);
    lip.position.set(o.x + o.w / 2 - CH_CX, o.y + o.h - 0.025 - CH_CY, -0.1);
    levelGroup.add(lip);
  }
  for (const h of level.hazards || []) {
    const mat = mats.hazard.clone() as MeshStandardMaterial;
    mat.map = chevron.clone();
    mat.map.repeat.set(Math.max(1, Math.round(h.w)), 1);
    mat.map.needsUpdate = true;
    const mesh = new Mesh(new BoxGeometry(h.w, h.h, 0.15), mat);
    mesh.position.set(h.x + h.w / 2 - CH_CX, h.y + h.h / 2 - CH_CY, 0.05);
    levelGroup.add(mesh);
    hazardMeshes.push(mesh);
  }
  for (const t of level.targets || []) {
    const ring = new Mesh(new RingGeometry(t.r - 0.12, t.r, 48), mats.target);
    ring.position.set(t.x - CH_CX, t.y - CH_CY, 0.05);
    levelGroup.add(ring);
    const inner = new Mesh(new RingGeometry(t.r * 0.45, t.r * 0.45 + 0.06, 32), mats.target);
    inner.position.copy(ring.position);
    levelGroup.add(inner);
    targetRings.push(ring, inner);
    const glow = new Mesh(new PlaneGeometry(t.r * 3, t.r * 3), mats.targetGlow);
    glow.position.set(t.x - CH_CX, t.y - CH_CY, -0.05);
    glow.visible = !!look?.detailed;
    levelGroup.add(glow);
    targetGlows.push(glow);
  }
  // decorative props, deterministic per level seed (buildDecor)
  const rng = Rules.makeRng(((level.seed || 1) ^ 0x9e3779b9) >>> 0);
  const n = 2 + rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const w = 0.6 + rng.next() * 0.8;
    const crate = new Mesh(new BoxGeometry(w, w, w), mats.crate);
    const side = rng.next() < 0.5 ? -1 : 1;
    crate.position.set(side * (CH_CX + 0.9 + rng.next() * 0.8), -CH_CY + w / 2, -0.6 + rng.next() * 0.3);
    crate.rotation.z = (rng.next() - 0.5) * 0.2;
    crate.castShadow = true;
    levelGroup.add(crate);
    crates.push(crate);
  }
  applyEnvMaps();
  for (let i = 0; i < 2; i++) {
    const pipe = new Mesh(new CylinderGeometry(0.12, 0.12, CH_H + 2, 8), mats.pipe);
    pipe.position.set((rng.next() - 0.5) * (CH_W + 2), 0, -0.85);
    levelGroup.add(pipe);
  }
  applyEmissiveBoost();
}

// -------------------------------------------------------------- bodies and joints
interface BodyView { mesh: Mesh; rim: Mesh; material: string }
const bodyViews = new Map<string, BodyView>();
const jointViews = new Map<string, Mesh>();
const bodyGeo = new CylinderGeometry(0.5, 0.5, 0.6, 28);
bodyGeo.rotateX(Math.PI / 2); // flat face toward the camera
let sphereSegs = "";
let sphereGeo = new SphereGeometry(0.5, 40, 28);
sphereGeo.rotateX(Math.PI / 2);
const payloadRingGeo = new TorusGeometry(0.6, 0.045, 8, 40);
const rimGeo = new TorusGeometry(0.52, 0.035, 8, 32);
const detailed = (): boolean => !!look?.detailed;
function getBodyView(b: { id: string; kind: string; material: string }): BodyView {
  let v = bodyViews.get(b.id);
  if (v) return v;
  const mat = bodyMaterial(b.material, look?.budget.material ?? "physical");
  if (detailed()) mat.map = texture(b.material);
  const mesh = new Mesh(detailed() ? sphereGeo : bodyGeo, mat);
  mesh.castShadow = (look?.shadows ?? 0) > 0;
  mesh.receiveShadow = true;
  if (b.kind === "payload") {
    const pr = new Mesh(payloadRingGeo, mats.payloadRing);
    pr.position.z = 0.05;
    mesh.add(pr);
  }
  const rim = new Mesh(rimGeo, new MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }));
  rim.position.z = 0.31;
  mesh.add(rim);
  bodyGroup.add(mesh);
  if ("envMapIntensity" in mat) (mat as MeshStandardMaterial).envMap = look?.reflections ? envTex : null;
  v = { mesh, rim, material: b.material };
  bodyViews.set(b.id, v);
  return v;
}
function getJointView(j: { id: string; type: string }): Mesh {
  let mesh = jointViews.get(j.id);
  if (mesh) return mesh;
  const mat = j.type === "spring" ? mats.spring : mats.pin;
  mesh = new Mesh(new BoxGeometry(1, j.type === "spring" ? 0.08 : 0.16, 0.1), mat);
  if (j.type === "spring") {
    for (let i = 0; i < 5; i++) {
      const seg = new Mesh(new BoxGeometry(0.1, 0.22, 0.1), mat);
      seg.position.x = -0.5 + (i + 0.5) / 5;
      mesh.add(seg);
    }
  }
  jointGroup.add(mesh);
  jointViews.set(j.id, mesh);
  return mesh;
}
function clearViews(): void {
  for (const v of bodyViews.values()) { bodyGroup.remove(v.mesh); (v.mesh.material as Material).dispose(); (v.rim.material as Material).dispose(); }
  bodyViews.clear();
  for (const m of jointViews.values()) { jointGroup.remove(m); disposeTree(m); }
  jointViews.clear();
}

// -------------------------------------------------------------- overlay: ghost, selection, cursor
const ghostCyl = bodyGeo.clone();
let ghostSphere = sphereGeo.clone();
const ghost = new Mesh(ghostCyl, mats.ghostOk);
ghost.visible = false;
overlayGroup.add(ghost);
const selRing = new Mesh(new RingGeometry(0.62, 0.74, 40), mats.selectionRing);
selRing.visible = false;
overlayGroup.add(selRing);
const cursorGroup = new Group();
cursorGroup.add(new Mesh(new PlaneGeometry(0.7, 0.05), mats.cursor), new Mesh(new PlaneGeometry(0.05, 0.7), mats.cursor));
cursorGroup.position.z = 0.5;
overlayGroup.add(cursorGroup);

// -------------------------------------------------------------- particles (pooled sparks) and dust
const pGeo = new BufferGeometry();
const pPos = new Float32Array(SPARK_MAX * 3);
const pCol = new Float32Array(SPARK_MAX * 3);
pGeo.setAttribute("position", new BufferAttribute(pPos, 3));
pGeo.setAttribute("color", new BufferAttribute(pCol, 3));
pGeo.setDrawRange(0, 0);
const pMat = new PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
const points = new Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);
interface Spark { x: number; y: number; vx: number; vy: number; life: number; ttl: number; r: number; g: number; b: number }
const pool: Spark[] = [];
let particleCap = 300;
let particleBoost = 1;
const spawnRng = Rules.makeRng(1234);
function burst(x: number, y: number, color: string, count: number, speed = 4): void {
  const c = new Color(color);
  for (let i = 0; i < count; i++) {
    if (pool.length >= particleCap) pool.shift();
    const a = spawnRng.next() * Math.PI * 2;
    const v = (0.3 + spawnRng.next() * 0.7) * speed;
    pool.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.5, life: 0, ttl: 0.5 + spawnRng.next() * 0.5, r: c.r, g: c.g, b: c.b });
  }
}
function updateParticles(dt: number): void {
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i]!;
    p.life += dt;
    if (p.life >= p.ttl) { pool.splice(i, 1); continue; }
    p.vy -= 6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  let n = 0;
  for (const p of pool) {
    if (n >= particleCap) break;
    pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = 0.7;
    const fade = (1 - p.life / p.ttl) * particleBoost;
    pCol[n * 3] = p.r * fade; pCol[n * 3 + 1] = p.g * fade; pCol[n * 3 + 2] = p.b * fade;
    n++;
  }
  pGeo.setDrawRange(0, n);
  pGeo.attributes.position!.needsUpdate = true;
  pGeo.attributes.color!.needsUpdate = true;
}
const dGeo = new BufferGeometry();
const dPos = new Float32Array(DUST_MAX * 3);
const dSeed = new Float32Array(DUST_MAX * 2);
{
  const r = Rules.makeRng(0xd057);
  for (let i = 0; i < DUST_MAX; i++) {
    dPos[i * 3] = (r.next() - 0.5) * CH_W;
    dPos[i * 3 + 1] = (r.next() - 0.5) * CH_H;
    dPos[i * 3 + 2] = -0.6 + r.next() * 0.3;
    dSeed[i * 2] = r.next() * Math.PI * 2;
    dSeed[i * 2 + 1] = 0.08 + r.next() * 0.18;
  }
}
dGeo.setAttribute("position", new BufferAttribute(dPos, 3));
const dMat = new PointsMaterial({ size: 0.09, map: softSprite, color: 0xffd9a8, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
const dust = new Points(dGeo, dMat);
dust.frustumCulled = false;
dust.visible = false;
scene.add(dust);
let dustCount = 140;

// -------------------------------------------------------------- state
let reducedMotion = false;
let paused = false;
let prevSnap: State | null = null;
let curSnap: State | null = null;
let alpha = 1;
let selection: string | null = null;
let shakeAmp = 0;
const shakeOffset = new Vector3();
let elapsed = 0;
let framingMargin = FRAMING.margin;
let envTex: Texture | null = null;

// -------------------------------------------------------------- the look (setGraphics)
function applyEmissiveBoost(): void {
  // With bloom, targets, payload rings and lamps are pushed above 1.0 so only they glow.
  const bloom = !!look?.bloom;
  mats.target.color.set(palette.accent).multiplyScalar(bloom ? 2.2 : 1);
  mats.payloadRing.color.set(palette.accent).multiplyScalar(bloom ? 1.6 : 1);
  mats.targetGlow.color.set(palette.accent);
  for (const lm of lampMats) lm.emissiveIntensity = bloom ? 2.6 : 1.2;
  particleBoost = look?.particles === "high" ? (bloom ? 2.2 : 1.3) : 1;
}
/** The post chain tone-maps the clear colour as the old composer did (lifted 2.4× so it survived); direct rendering does not. */
function applyBackground(): void {
  const c = new Color(palette.background);
  const post = !!look && (look.ao !== "off" || look.bloom || look.grade || look.antialias === "fxaa" || look.antialias === "smaa");
  scene.background = post ? c.multiplyScalar(2.4) : c;
}
function setMap(mat: MeshStandardMaterial, map: Texture | null, bump: Texture | null = null, bumpScale = 1): void {
  if (mat.map === map && mat.bumpMap === bump) return;
  mat.map = map;
  mat.bumpMap = bump;
  mat.bumpScale = bumpScale;
}
function applyDetail(on: boolean): void {
  detailGroup.visible = on;
  setMap(mats.panel, on ? texture("panel") : null, on ? texture("panel") : null, 1.5);
  mats.panel.color.set(on ? 0xffffff : 0x2a2e3a);
  const tread = on ? texture("tread") : null;
  setMap(mats.floor, tread, tread, 1.2);
  setMap(mats.wall, tread, tread, 0.8);
  setMap(mats.crate, on ? texture("wood") : null);
  for (const g of targetGlows) g.visible = on;
  for (const v of bodyViews.values()) {
    v.mesh.geometry = on ? sphereGeo : bodyGeo;
    const m = v.mesh.material as MeshStandardMaterial;
    m.map = on ? texture(v.material) : null;
  }
  ghost.geometry = on ? ghostSphere : ghostCyl;
}
let builtMaterial = "";
let builtTex = "";
/**
 * r161 scaled scene.environment by each material's envMapIntensity; at engine minor 20 (three r185) the
 * scene environment ignores it, so every lit material carries the environment as its own envMap.
 */
function applyEnvMaps(): void {
  const env = look?.reflections ? envTex : null;
  scene.traverse((n) => {
    const m = (n as Mesh).material as MeshStandardMaterial | undefined;
    if (m && "envMapIntensity" in m && m.envMap !== env) m.envMap = env;
  });
}
/** The runtime's quality tier applied live (no reload): asset variants, effects and the post chain. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  const b = next.budget;
  // texture sizes
  const tk = `${b.wallTex}|${b.bodyTex}`;
  if (tk !== builtTex) {
    builtTex = tk;
    for (const m of [mats.panel, mats.floor, mats.wall, mats.crate]) { m.map = null; m.bumpMap = null; }
    for (const v of bodyViews.values()) (v.mesh.material as MeshStandardMaterial).map = null;
    for (const t of texCache.values()) t.dispose();
    texCache.clear();
  }
  // sphere segments
  const segs = b.sphere.join("x");
  if (segs !== sphereSegs) {
    sphereSegs = segs;
    const old = sphereGeo, oldGhost = ghostSphere;
    sphereGeo = new SphereGeometry(0.5, b.sphere[0], b.sphere[1]);
    sphereGeo.rotateX(Math.PI / 2);
    ghostSphere = sphereGeo.clone();
    for (const v of bodyViews.values()) if (v.mesh.geometry === old) v.mesh.geometry = sphereGeo;
    if (ghost.geometry === oldGhost) ghost.geometry = ghostSphere;
    old.dispose(); oldGhost.dispose();
  }
  // body shading model
  if (b.material !== builtMaterial) {
    builtMaterial = b.material;
    for (const v of bodyViews.values()) {
      const old = v.mesh.material as Material;
      v.mesh.material = bodyMaterial(v.material, b.material);
      if (detailed()) (v.mesh.material as MeshStandardMaterial).map = texture(v.material);
      old.dispose();
    }
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = next.shadows > 0;
  key.castShadow = next.shadows > 0;
  if (next.shadows > 0) key.shadow.mapSize = next.shadows;
  for (const v of bodyViews.values()) v.mesh.castShadow = next.shadows > 0;
  // reflections: the room environment replaces most of the flat fill
  if (next.reflections) {
    if (!envTex) {
      try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; } catch (e) { console.warn(`environment: ${String(e)}`); }
    }
  }
  applyEnvMaps();
  ambient.intensity = next.reflections ? 0.18 : 0.45;
  fill.intensity = next.reflections ? 0.4 : 0.5;
  // UnrealBloomPass(0.6, 0.5, 0.88): only lamps, glowing rings, hazards and sparks bloom.
  // three r161 page: bloom model "r160" with the page's strength 0.6 (engine.minor 30).
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.6, radius: 0.5, threshold: 0.88, resolution: b.bloomRes } : null;
  // GTAOPass: radius 0.9, distance exponent 1.4, thickness 1.5; 16 / 8 samples and the denoise per tier; blend 0.7.
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1,
    samples: next.ao === "high" ? 16 : 8, resolution: b.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader on the linear buffer before the tone mapping: an 0.18 S-curve, saturation 1.1, cool shadows /
  // warm highlights by a smoothstep of luma from 0.15 to 0.7, a 0.2 vignette from 0.3 to 0.8 (y scaled 0.8).
  renderer.grade = next.grade ? {
    space: "linear", overRange: "keep", contrast: 0.18, saturation: 1.1, split: [0.15, 0.7], shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.95],
    vignette: { amount: 0.2, inner: 0.3, outer: 0.8, scale: [1, 0.8] },
  } : null;
  renderer.antialias = next.antialias;
  particleCap = sparkCap(next);
  if (pool.length > particleCap) pool.splice(0, pool.length - particleCap);
  if (next.particles === "high") { pMat.map = softSprite; pMat.size = 0.2; pMat.blending = AdditiveBlending; }
  else { pMat.map = null; pMat.size = 0.14; pMat.blending = NormalBlending; }
  dust.visible = next.animated;
  dustCount = Math.min(DUST_MAX, b.dust);
  dGeo.setDrawRange(0, dustCount);
  applyBackground();
  applyDetail(next.detailed);
  applyEmissiveBoost();
}

/** The level's theme palette (render.js setTheme). */
export function setTheme(theme: Theme): void {
  Object.assign(palette, theme.palette);
  applyBackground();
  mats.floor.color.set(palette.floor);
  mats.wall.color.set(palette.wall);
  applyEmissiveBoost();
}

// -------------------------------------------------------------- snapshots and overlays
/** A new session snapshot; `interpAlpha` is how far the frame sits between the previous fixed step and this one. */
export function setSnapshot(state: State, interpAlpha = 1): void {
  if (state !== curSnap) { prevSnap = curSnap || state; curSnap = state; }
  alpha = Math.max(0, Math.min(1, interpAlpha));
  buildLevel(state.level);
}
/** A new chamber: the old views go (the browser build made a fresh renderer state per level id). */
export function resetChamber(): void {
  clearViews();
  prevSnap = curSnap = null;
  pool.length = 0;
  selection = null;
  shakeAmp = 0;
}
export function setGhost(g: { x: number; y: number; ok: boolean } | null): void {
  if (!g) { ghost.visible = false; return; }
  ghost.visible = true;
  ghost.material = g.ok ? mats.ghostOk : mats.ghostBad;
  ghost.position.set(g.x - CH_CX, g.y - CH_CY, 0.45);
}
export function setSelection(id: string | null): void { selection = id; }
export function setCursor(x: number, y: number, visible = true): void {
  cursorGroup.position.set(x - CH_CX, y - CH_CY, 0.5);
  cursorGroup.visible = visible;
}
export function setReducedMotion(v: boolean): void {
  reducedMotion = v;
  if (v) { shakeAmp = 0; shakeOffset.set(0, 0, 0); }
}
export function setPaused(v: boolean): void { paused = v; }
/** Settings › Camera default: the framing margin (Full chamber 0.1, Tight frame 0.02). */
export function setFraming(margin: number): void {
  const m = Math.max(0, Math.min(0.5, Number(margin) || FRAMING.margin));
  if (m !== framingMargin) { framingMargin = m; frameKey = ""; }
}
/** C: re-frame the camera (shake settled). */
export function frameChamber(): void { shakeAmp = 0; frameKey = ""; }
/** Whether the chamber draws (full-page screens cover the window). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

export function emitEvent(ev: GameEvent): void {
  const at = (id?: string): { x: number; y: number } | null => {
    const v = id ? bodyViews.get(id) : undefined;
    return v ? { x: v.mesh.position.x, y: v.mesh.position.y } : null;
  };
  switch (ev.type) {
    case "spawn": burst((ev.x ?? 0) - CH_CX, (ev.y ?? 0) - CH_CY, Rules.MATERIALS[ev.material ?? ""]?.color ?? "#ffffff", 24, 3); break;
    case "joint": { const p = at(ev.a); if (p) burst(p.x, p.y, "#f2c14e", 14, 2); break; }
    case "delete": { const p = at(ev.target); if (p) burst(p.x, p.y, "#9aa2b8", 16, 2.5); break; }
    case "shatter": {
      const p = at(ev.id);
      if (p) burst(p.x, p.y, Rules.MATERIALS.glass!.color, 40, 5);
      if (!reducedMotion) shakeAmp = Math.min(0.35, shakeAmp + 0.18);
      break;
    }
    case "destroyed": {
      const p = at(ev.id);
      if (p) burst(p.x, p.y, "#ff552e", 36, 5);
      if (!reducedMotion) shakeAmp = Math.min(0.35, shakeAmp + 0.15);
      break;
    }
    case "delivered": { const p = at(ev.id); if (p) burst(p.x, p.y, palette.accent, 40, 4); break; }
  }
}

// -------------------------------------------------------------- framing and picking
let frameKey = "";
let win = { w: 1, h: 1 };
let view: Rect = { x: 0, y: 0, width: 1, height: 1 };
/** World units per window pixel and the view rectangle's centre in world units (shake excluded). */
let unit = 0.01;
/** resize(): the chamber plus the margin fitted into the view rectangle; the frustum spans the whole window. */
function fitCamera(): void {
  const aspect = view.width / Math.max(1, view.height);
  const m = framingMargin;
  let halfW = (CH_W * (1 + 2 * m)) / 2, halfH = (CH_H * (1 + 2 * m)) / 2;
  if (halfW / halfH > aspect) halfH = halfW / aspect;
  else halfW = halfH * aspect;
  unit = (2 * halfW) / Math.max(1, view.width);
  const cx = view.x + view.width / 2, cy = view.y + view.height / 2;
  camera.left = -cx * unit;
  camera.right = (win.w - cx) * unit;
  camera.top = cy * unit;
  camera.bottom = -(win.h - cy) * unit;
  camera.updateProjectionMatrix();
}
/** Window pixels → chamber units (render.js screenToWorld, without the shake). */
export function screenToWorld(x: number, y: number): { x: number; y: number } {
  const cx = view.x + view.width / 2, cy = view.y + view.height / 2;
  return { x: (x - cx) * unit + CH_CX, y: -(y - cy) * unit + CH_CY };
}
/** Chamber units → window pixels. */
export function worldToScreen(x: number, y: number): { x: number; y: number } {
  const cx = view.x + view.width / 2, cy = view.y + view.height / 2;
  return { x: cx + (x - CH_CX) / unit, y: cy - (y - CH_CY) / unit };
}
/** Window pixels per chamber unit. */
export function pixelsPerUnit(): number { return 1 / unit; }
/**
 * The body under a window point (render.js pickInteractive: every body is hit as its 0.5-radius sphere,
 * the nearest surface first — with the camera straight on, the raised selected body, then the nearest centre).
 */
export function pick(x: number, y: number): string | null {
  if (!curSnap) return null;
  const w = screenToWorld(x, y);
  let best: string | null = null, bestZ = -Infinity;
  for (const b of curSnap.bodies) {
    const v = bodyViews.get(b.id);
    if (!v || !v.mesh.visible) continue;
    const px = v.mesh.position.x + CH_CX, py = v.mesh.position.y + CH_CY;
    const d2 = (w.x - px) ** 2 + (w.y - py) ** 2;
    if (d2 > 0.25) continue;
    const z = v.mesh.position.z + Math.sqrt(0.25 - d2);
    if (z > bestZ) { bestZ = z; best = b.id; }
  }
  return best;
}
/** A body's on-screen position (window px), interpolated as drawn. */
export function bodyScreen(id: string): { x: number; y: number } | null {
  const v = bodyViews.get(id);
  if (!v || !v.mesh.visible) return null;
  return worldToScreen(v.mesh.position.x + CH_CX, v.mesh.position.y + CH_CY);
}

// -------------------------------------------------------------- each frame (draw)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function update(dt: number, w: number, h: number, rect: Rect): void {
  dt = Math.min(0.05, dt);
  elapsed += dt;
  const fk = `${w}x${h}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
  if (w > 0 && h > 0 && rect.width > 0 && rect.height > 0 && fk !== frameKey) {
    frameKey = fk;
    win = { w, h };
    view = { ...rect };
    fitCamera();
  }
  if (curSnap) {
    const seen = new Set<string>();
    for (const b of curSnap.bodies) {
      seen.add(b.id);
      const v = getBodyView(b);
      let px = b.x, py = b.y;
      const pb = prevSnap?.bodies.find((x) => x.id === b.id);
      if (pb) { px = lerp(pb.x, b.x, alpha); py = lerp(pb.y, b.y, alpha); }
      v.mesh.visible = true;
      const isSel = selection === b.id;
      v.mesh.position.set(px - CH_CX, py - CH_CY, isSel ? 0.35 : 0.1);
      v.mesh.rotation.z = b.id.charCodeAt(0) + px; // cheap deterministic spin cue
      (v.rim.material as MeshBasicMaterial).opacity = isSel ? 0.95 : 0;
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
        if (selection === id) selection = null;
      }
    }
    if (!selection || !seen.has(selection)) selRing.visible = false;
    const seenJ = new Set<string>();
    for (const j of curSnap.joints) {
      const a = curSnap.bodies.find((x) => x.id === j.a);
      const b = curSnap.bodies.find((x) => x.id === j.b);
      if (!a || !b) continue;
      seenJ.add(j.id);
      const mesh = getJointView(j);
      let ax = a.x, ay = a.y, bx = b.x, by = b.y;
      if (prevSnap) {
        const pa = prevSnap.bodies.find((x) => x.id === j.a);
        const pb2 = prevSnap.bodies.find((x) => x.id === j.b);
        if (pa) { ax = lerp(pa.x, a.x, alpha); ay = lerp(pa.y, a.y, alpha); }
        if (pb2) { bx = lerp(pb2.x, b.x, alpha); by = lerp(pb2.y, b.y, alpha); }
      }
      mesh.visible = true;
      mesh.position.set((ax + bx) / 2 - CH_CX, (ay + by) / 2 - CH_CY, 0);
      mesh.rotation.z = Math.atan2(by - ay, bx - ax);
      mesh.scale.x = Math.max(0.05, Math.hypot(bx - ax, by - ay));
    }
    for (const [id, m] of jointViews) if (!seenJ.has(id)) m.visible = false;
  } else selRing.visible = false;

  // ambient animation (suppressed by reduced motion / paused)
  if (!reducedMotion && !paused) {
    for (const ring of targetRings) {
      const s = 1 + Math.sin(elapsed * 2.4 + ring.position.x) * 0.07;
      ring.scale.set(s, s, 1);
    }
    const hb = look?.bloom ? 1.6 : 1;
    for (const hm of hazardMeshes) (hm.material as MeshStandardMaterial).emissiveIntensity = (0.45 + Math.sin(elapsed * 3.5) * 0.3) * hb;
  }
  // background life: dust drift, lamp shimmer, gauge needle
  if (look?.animated && !reducedMotion && !paused) {
    for (let i = 0; i < dustCount; i++) {
      const ph = dSeed[i * 2]!, sp = dSeed[i * 2 + 1]!;
      let y = dPos[i * 3 + 1]! + sp * dt;
      if (y > CH_CY) y -= CH_H;
      dPos[i * 3 + 1] = y;
      dPos[i * 3] = dPos[i * 3]! + Math.sin(elapsed * 0.5 + ph) * 0.05 * dt;
    }
    dGeo.attributes.position!.needsUpdate = true;
    const base = look.bloom ? 2.6 : 1.2;
    lampMats.forEach((lm, i) => {
      const flick = i === 1 && Math.sin(elapsed * 0.7) > 0.985 ? 0.55 : 1; // rare stutter
      lm.emissiveIntensity = base * (0.94 + Math.sin(elapsed * (1.3 + i * 0.4) + i) * 0.06) * flick;
    });
    poolMats.forEach((pm, i) => { pm.opacity = 0.16 * (0.92 + Math.sin(elapsed * (1.3 + i * 0.4) + i) * 0.08); });
    needle.rotation.z = -0.9 + Math.sin(elapsed * 0.9) * 0.08 + Math.sin(elapsed * 7.1) * 0.015;
  }
  updateParticles(paused ? 0 : dt);
  // camera shake (decaying, never affects picking)
  if (shakeAmp > 0.001 && !reducedMotion) {
    shakeOffset.set((spawnRng.next() - 0.5) * shakeAmp, (spawnRng.next() - 0.5) * shakeAmp, 0);
    shakeAmp *= Math.pow(0.001, dt);
  } else {
    shakeOffset.set(0, 0, 0);
    shakeAmp = Math.max(0, shakeAmp - dt);
  }
  camera.position.set(shakeOffset.x, shakeOffset.y, 20);
}
