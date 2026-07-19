/* ===================================================================
   Papi — ProcessRoom
   A real 3D room (Three.js), not a flat background image, that the
   camera travels through as the visitor scrolls: a curved rotunda with
   a ceiling oculus, two side doorway alcoves, a center back doorway,
   and a raised platform — built from primitive geometry + warm PBR
   materials + one shadow-casting light, rather than an imported model
   (this project has no asset pipeline for authored 3D models, and none
   of the geometry here needs sculpted detail to read at this scale).
   The look is a stylized, warm-toned architectural space in the spirit
   of the reference photo, not an attempt at a photoreal render of it —
   that would need authored PBR texture maps this project doesn't have.

   Depth of field: rather than a true post-processing bokeh pass
   (EffectComposer + BokehPass — a real per-pixel cost every frame,
   worse on mobile, and another vendored addon on top of three.module.
   min.js), distance is cued with exponential fog (THREE.FogExp2) plus
   a CSS blur on the two inactive step labels' own DOM text. Same "the
   falloff/blur lives in a cheap static layer, not a per-frame filter"
   approach as js/process-fog.js's own header explains for its ambient
   vapor, and js/liquid-image-fluid.js's whole reason for never using
   backdrop-filter.

   Scroll drives a single continuous camera path (a CatmullRomCurve3
   through one keyframe per step) — arc-length sampled so the four
   "stops" are real geometric waypoints, not faked by pausing a timer.
   Position and look-at both ease per quarter of the section's scroll
   range (slow near each stop, quick between them) rather than moving
   at constant speed the whole way, for the "arriving" character the
   brief asks for without literal dead stops.

   Architectural refinement pass (geometry/materials/lighting only —
   the room's layout, the camera path and every scroll/parallax/
   reduced-motion behavior above are all unchanged):

   - The doorways are now real carved openings — a THREE.Shape with a
     hole (the rounded-top opening) extruded with bevelEnabled, so the
     hole's inner tunnel walls and rounded rim come from Three's own
     extrusion algorithm rather than a hand-rolled tube (safer than
     guessing at per-vertex tunnel normals by hand).
   - The ceiling is a real dome — a LatheGeometry revolved from a
     quarter-ellipse profile that's tangent to the wall at one end and
     tangent to the flat oculus lip at the other, not a flat ring.
   - "Handcrafted" imperfection is a low-frequency sine-sum wobble on
     the wall/dome radius (a few fixed sine terms at different
     frequencies/phases, not Math.random) — smooth and organic rather
     than jagged, and identical on every load rather than reshuffling.
   - "Indirect bounce" is faked with a few extra low-intensity, non-
     shadow-casting fill lights placed where bounced light would
     actually land (floor-ward, doorway-ward) instead of one dominant
     spotlight — real bounce lighting would mean baked lightmaps or a
     voxel-GI pass, neither of which this project has a pipeline for.
   - AO/contact shadows are soft canvas-gradient decals (a dark ring
     where the wall meets the floor, a soft blob under the stone seat)
     — the same "the falloff IS the blur, not a per-frame filter"
     technique documented above and in js/process-fog.js's own header,
     rather than a real SSAO pass.

   Materials pass — real PBR texture sets, not solid colours:
   every wall/ceiling/floor/platform/seat/doorway/stepping-stone
   material below loads its own color+normal+roughness(+AO where the
   source set has one) maps from img/textures/<surface>/, downloaded
   once from ambientCG (CC0, commercially usable) and saved locally —
   nothing fetches from ambientcg.com at runtime. Sources, for
   attribution/re-download:
     walls           ambientCG Plaster001        (2K)
     ceiling/doorway ambientCG Concrete035/036   (2K/1K)
     floor           ambientCG Marble006         (2K)
     platform        ambientCG Marble016         (2K)
     seat            ambientCG Rock019           (1K)
     stepping stones ambientCG Rock028           (1K)
   Displacement maps were downloaded but aren't wired in — this
   room's geometry (a handful of large ribbons/lathes/extrusions) isn't
   subdivided finely enough for true vertex displacement to read as
   surface detail rather than blobby distortion; shipping the maps
   unused would just be dead weight, so they were left out of
   img/textures entirely. Every load goes through _loadPBRSet() below,
   which assigns the texture immediately (so a slow load never blocks
   first paint — the material already has its own solid base colour
   as an interim look) and falls back to that same solid colour if the
   file 404s, rather than leaving a broken/blank map reference.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

const ROOM = {
  radius: 9,
  height: 6.4,
  oculusRadius: 2.3,
  domeRise: 2.1,
  // full 360 deg enclosure — an early version left a gap at the front
  // (no "entrance" is ever actually seen, the camera only ever looks
  // inward), but any camera position close enough to a side doorway
  // could see past that gap's terminal edge into empty space beyond,
  // reading as a hard diagonal seam across the frame. A fully closed
  // wall removes that failure mode regardless of how the camera path
  // gets tuned later, rather than having to keep both in sync by hand.
  wallTheta: Math.PI,
  doorTheta: 0.62,      // angle of each side doorway, either side of straight back
  wallSegments: 96,
};

const CONFIG = {
  dprCap: 1.5,
  dprCapMobile: 1.15,
  shadowSize: 1024,
  shadowSizeMobile: 512,
  settleMs: 1400,
  parallaxMax: 0.16,
};

// a few fixed low-frequency sine terms, not Math.random — smooth,
// organic "hand-plastered" waviness on the wall/dome radius rather
// than jagged per-vertex noise, and stable across reloads
function radiusWobble(theta){
  return 0.035 * Math.sin(theta * 2.3 + 0.7)
       + 0.02  * Math.sin(theta * 5.1 + 2.1)
       + 0.015 * Math.sin(theta * 9.7 + 4.4);
}

// wall-anchored coordinates all share this one parameterization — theta
// measured from straight back (0 = due back, +/- toward the sides) —
// so the wall ribbon and every doorway/marker mounted on it line up
// exactly, with no separate axis-convention translation anywhere else.
function wallPoint(theta, radius){
  return {
    x: radius * Math.sin(theta),
    z: -radius * Math.cos(theta),
  };
}

function buildWallGeometry(radius, height, thetaStart, thetaEnd, segments){
  const positions = [], normals = [], uvs = [], indices = [];
  for(let i = 0; i <= segments; i++){
    const t = i / segments;
    const theta = thetaStart + (thetaEnd - thetaStart) * t;
    const p = wallPoint(theta, radius + radiusWobble(theta));
    // normal tilted slightly by the wobble's own local slope (its
    // derivative) rather than the plain radial inward normal — a
    // wavering wall whose lighting normal stays perfectly radial reads
    // as flat-shaded facets sitting on a bumpy surface rather than the
    // surface itself actually being uneven
    const dTheta = 0.01;
    const pNext = wallPoint(theta + dTheta, radius + radiusWobble(theta + dTheta));
    const tangent = { x: pNext.x - p.x, z: pNext.z - p.z };
    const tLen = Math.hypot(tangent.x, tangent.z) || 1;
    const nx = -tangent.z / tLen, nz = tangent.x / tLen;
    positions.push(p.x, 0, p.z,  p.x, height, p.z);
    normals.push(nx, 0, nz,  nx, 0, nz);
    uvs.push(t * 6, 0,  t * 6, 1);
  }
  for(let i = 0; i < segments; i++){
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b,  b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// a real dome — a quarter-ellipse profile revolved around the vertical
// axis, tangent to the wall at one end (matches its height, vertical
// slope) and tangent to the flat oculus lip at the other (horizontal
// slope) — not a flat ring standing in for one
function buildDomeGeometry(outerRadius, wallTop, oculusRadius, rise, steps, segments){
  const pts = [];
  for(let i = 0; i <= steps; i++){
    const phi = (i / steps) * (Math.PI / 2);
    const x = oculusRadius + (outerRadius - oculusRadius) * Math.cos(phi);
    const y = wallTop + rise * Math.sin(phi);
    pts.push(new THREE.Vector2(x, y));
  }
  return new THREE.LatheGeometry(pts, segments);
}

// the stepping stones' own rounded rim band ONLY — no flat centre
// point in this profile, unlike an earlier version that revolved the
// whole puck (flat top included) as one LatheGeometry. Lathe UVs
// unwrap along the profile's own path, so including the flat top's
// centre-to-edge line in that same revolve packed the entire radial
// span of a flat disc face into a short stretch of the V coordinate —
// on a real photographic rock texture that reads as the image being
// wrung into a tight spiral toward the centre, an actual hole-like
// vortex rather than a solid stone. Pairing this rim-only band with a
// separate flat CircleGeometry cap (ordinary, non-pinched radial UV —
// see where this is used) fixes that without losing the rounded edge.
function buildStoneRimGeometry(radius, thickness, bevel, segments){
  const b = Math.min(bevel, thickness / 2 - 0.001, radius * 0.4);
  const half = thickness / 2;
  const pts = [];
  const steps = 6;
  for(let i = 0; i <= steps; i++){
    const phi = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + b * Math.sin(phi), half - b * (1 - Math.cos(phi))));
  }
  for(let i = steps; i >= 0; i--){
    const phi = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + b * Math.sin(phi), -half + b * (1 - Math.cos(phi))));
  }
  return new THREE.LatheGeometry(pts, segments);
}

// the recessed platform's own drop from floor level down to its sunken
// floor — a rounded lip at the top (where it meets the main floor)
// easing into a straight vertical drop, rather than a sharp step
function buildRecessedRiserGeometry(radius, depth, bevel, segments){
  const pts = [];
  const steps = 6;
  for(let i = 0; i <= steps; i++){
    const phi = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - bevel * (1 - Math.cos(phi)), -bevel * Math.sin(phi)));
  }
  pts.push(new THREE.Vector2(radius - bevel, -depth));
  return new THREE.LatheGeometry(pts, segments);
}

// displaces every vertex along its own normal by a deterministic,
// multi-frequency "noise" (a handful of sine terms at different
// frequencies/phases/axes, not Math.random — stable across reloads,
// same convention as radiusWobble above) plus a few concentrated
// inward divots for chip-like damage — breaks the icosahedron's
// perfect symmetry into something that reads as carved/eroded rather
// than a smooth mathematical blob, then recomputes normals so lighting
// actually reacts to the new bumpy surface instead of the old smooth
// one
function sculptStoneGeometry(geometry, seed, chips){
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for(let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    let d = 0;
    d += 0.09 * Math.sin(v.x * 1.3 + seed) * Math.cos(v.y * 1.1 - seed * 0.7);
    d += 0.05 * Math.sin(v.y * 2.6 + v.z * 2.1 + seed * 1.3);
    d += 0.035 * Math.sin(v.x * 4.7 - v.z * 3.9 + seed * 0.4) * Math.sin(v.y * 3.3);
    chips.forEach((ch) => {
      const dist = v.distanceTo(ch.center);
      if(dist < ch.radius) d -= ch.depth * (1 - dist / ch.radius) ** 2;
    });
    v.addScaledVector(n, d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

// traces a rounded-top rectangle into an existing Shape/Path — shared
// by the doorway's outer wall-patch boundary and its inner hole, so
// both come out of the same real Three.js extrusion rather than a
// hand-built tube with guessed normals
function tracePath(path, width, height, cornerRadius){
  const hw = width / 2;
  path.moveTo(-hw, 0);
  path.lineTo(-hw, height - cornerRadius);
  path.quadraticCurveTo(-hw, height, -hw + cornerRadius, height);
  path.lineTo(hw - cornerRadius, height);
  path.quadraticCurveTo(hw, height, hw, height - cornerRadius);
  path.lineTo(hw, 0);
  path.lineTo(-hw, 0);
}

// a rounded ceramic urn profile — narrow foot, full belly, narrowing
// neck, small flared lip — revolved into a real vessel rather than a
// generic cylinder, for the centrepiece sitting past the back doorway
function buildVaseGeometry(){
  const pts = [
    new THREE.Vector2(0, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.25, 0.04),
    new THREE.Vector2(0.22, 0.13), new THREE.Vector2(0.29, 0.22), new THREE.Vector2(0.32, 0.35),
    new THREE.Vector2(0.27, 0.47), new THREE.Vector2(0.15, 0.55), new THREE.Vector2(0.12, 0.59),
    new THREE.Vector2(0.16, 0.61),
  ];
  return new THREE.LatheGeometry(pts, 28);
}

// a solid wall-plaster patch with a real through-hole for the doorway
// opening — ExtrudeGeometry computes the hole's inner tunnel walls and
// (with bevelEnabled) its rounded rim automatically, which is far more
// reliable than hand-rolling a tube mesh's per-vertex normals. Depth
// and bevel both sized up from an earlier pass for a genuinely thick,
// chamfered opening rather than a thin plate with a soft edge.
//
// Built flat (in local X/Y/Z) and then bent onto the wall's own
// cylindrical curvature: local X (arc-length across the doorway)
// becomes an angular offset from the doorway's own centre theta, and
// local Z (extrusion depth) reduces the radius — receding straight
// into the wall — instead of moving in a straight world-space line.
// An earlier flat version sat as a flat rectangular slab in front of
// the curved wall, which at any oblique angle read as a block
// protruding out of the wall (looking like a pillar) rather than an
// opening actually carved into it. Returned already positioned in
// room space, not doorway-local space — see _buildDoorway for why.
function buildDoorwayPatchGeometry(centerTheta, radius){
  const shape = new THREE.Shape();
  tracePath(shape, 3.6, 5.6, 0.5);
  const hole = new THREE.Path();
  tracePath(hole, 2.3, 3.6, 0.42);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.85, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4, steps: 1,
  });
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for(let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const theta = centerTheta + v.x / radius;
    const p = wallPoint(theta, radius - v.z);
    pos.setXYZ(i, p.x, v.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// a small canvas-generated blotch pattern used as a roughness map on
// the plaster surfaces — generated at a low resolution and left to the
// a fixed, simple vertical gradient used as the floor's reflection
// environment — warm/bright near the top (standing in for the oculus
// light and dome), dark near the bottom (the floor's own surroundings)
// — a static texture rather than a live per-frame planar-reflection
// render pass, which is real cost this scroll-driven section doesn't
// need to pay for a "subtle" sheen
function makeFloorEnvTexture(){
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#f2e6cc');
  grad.addColorStop(0.3, '#7d7264');
  grad.addColorStop(0.65, '#332e28');
  grad.addColorStop(1, '#0c0a08');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// loads one map into one material slot, tuned for tiling at this
// room's own scale — assigns the texture immediately (so a slow
// network load never blocks first paint; the material's own solid
// base colour is already a reasonable interim look) and, if the file
// 404s, nulls the slot back out rather than leaving a broken/blank
// texture reference so the surface still renders as its solid colour
function loadPBRMap(loader, path, material, slot, repeatX, repeatY, anisotropy, srgb){
  const tex = loader.load(path, undefined, undefined, () => {
    material[slot] = null;
    material.needsUpdate = true;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  if(srgb) tex.colorSpace = THREE.SRGBColorSpace;
  material[slot] = tex;
  return tex;
}

// wires a full color/normal/roughness(+AO) set from img/textures/
// <folder>/ into an already-constructed material — see this file's
// own header for exactly which ambientCG set backs each folder, and
// why there's no displacementMap here
function loadPBRSet(loader, folder, material, repeatX, repeatY, anisotropy, hasAO){
  const base = `img/textures/${folder}`;
  loadPBRMap(loader, `${base}/color.jpg`, material, 'map', repeatX, repeatY, anisotropy, true);
  loadPBRMap(loader, `${base}/normal.jpg`, material, 'normalMap', repeatX, repeatY, anisotropy, false);
  loadPBRMap(loader, `${base}/roughness.jpg`, material, 'roughnessMap', repeatX, repeatY, anisotropy, false);
  if(hasAO) loadPBRMap(loader, `${base}/ao.jpg`, material, 'aoMap', repeatX, repeatY, anisotropy, false);
}

// a soft-edged radial gradient (dark centre, fading to transparent) —
// used as an alpha-blended decal for the stone seat's own contact
// shadow — the same "the falloff IS the blur" technique as
// js/process-fog.js's ambient vapor, standing in for a real
// SSAO/contact-shadow pass this scene doesn't render
function makeShadowDecalTexture(peakAlpha){
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(0,0,0,${peakAlpha})`);
  grad.addColorStop(0.7, `rgba(0,0,0,${peakAlpha * 0.4})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// the inverse of the decal above — transparent through most of the
// middle, darkening only near the outer rim — mapped onto a full
// floor-sized disc (CircleGeometry, whose UV-to-radius mapping is
// simple and predictable, unlike RingGeometry's) this reads as a soft
// contact shadow all the way around where the floor meets the wall,
// without needing a second shadow-casting light for that seam
// warm dark-brown "grime", not pure black — real contact dirt at a
// wall/floor or platform/floor seam has colour to it, and a perfectly
// smooth ring reads as a lighting vignette rather than accumulated
// dirt, so a scatter of small soft blotches breaks up the ring's own
// otherwise-uniform edge
function makeEdgeVignetteTexture(peakAlpha, seed){
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const [r, g, b] = [46, 36, 26];
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.72, `rgba(${r},${g},${b},${peakAlpha * 0.35})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},${peakAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  let s = seed >>> 0;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
  for(let i = 0; i < 46; i++){
    const ang = rand() * Math.PI * 2;
    const rad = size * 0.36 + rand() * size * 0.14;
    const x = size / 2 + Math.cos(ang) * rad, y = size / 2 + Math.sin(ang) * rad;
    const rr = 5 + rand() * 16;
    const a = peakAlpha * (0.18 + rand() * 0.3);
    const sg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    sg.addColorStop(0, `rgba(${(r * 0.7) | 0},${(g * 0.7) | 0},${(b * 0.7) | 0},${a})`);
    sg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = sg;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return new THREE.CanvasTexture(canvas);
}

// thin, low-opacity random line strokes — a subtle "well-worn stone
// floor" scratch pass, layered above the floor as its own decal rather
// than baked into the roughness map (keeps the real photographed
// roughness map untouched, and this can tile independently of it)
function makeScratchesTexture(seed){
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  let s = seed >>> 0;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
  for(let i = 0; i < 110; i++){
    const x1 = rand() * size, y1 = rand() * size;
    const len = 18 + rand() * 65;
    const ang = rand() * Math.PI * 2;
    const x2 = x1 + Math.cos(ang) * len, y2 = y1 + Math.sin(ang) * len;
    ctx.strokeStyle = `rgba(255,248,238,${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 0.6 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

class ProcessRoom {
  constructor(section, container, canvas, stepEls, dotEls){
    this.section = section;
    this.container = container;
    this.canvas = canvas;
    this.stepEls = stepEls;
    this.dotEls = dotEls;
    this.enabled = false;

    this.prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.isCoarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this.isMobile = window.innerWidth < 860;

    let renderer;
    try{
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    }catch(e){
      return;
    }
    this.renderer = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    this.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x100d0a, 0.05);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 40);
    this.mouse = { x: 0, y: 0 };
    this.mouseTarget = { x: 0, y: 0 };

    this._buildRoom();
    this._buildLights();
    this._buildKeyframes();

    this._state = {
      progress: 0,
      pinnedLow: false,
      pinnedHigh: false,
      activeStage: -1,
      rafId: null,
    };

    this._resize();
    this._bindEvents();
    this._renderStatic();
  }

  // -----------------------------------------------------------------
  // geometry / materials / lighting
  // -----------------------------------------------------------------
  _buildRoom(){
    const R = ROOM.radius, H = ROOM.height;
    const group = new THREE.Group();
    this.scene.add(group);

    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // warm gray-brown lime plaster, not chocolate brown — real PBR set
    // (see this file's header for source/attribution), base colour
    // below is just the fallback if the texture fails to load
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x8c8170, roughness: 0.95, metalness: 0.02,
    });
    wallMat.normalScale = new THREE.Vector2(1.4, 1.4); // more pronounced micro-relief under grazing light
    loadPBRSet(loader, 'walls', wallMat, 2, 2, anisotropy, true);
    const wallGeo = buildWallGeometry(R, H, -ROOM.wallTheta, ROOM.wallTheta, ROOM.wallSegments);
    wallGeo.setAttribute('uv2', wallGeo.attributes.uv); // aoMap needs a second UV channel
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.receiveShadow = true;
    group.add(wall);

    // dark polished charcoal floor with restrained warm reflections —
    // MeshPhysicalMaterial (real marble PBR set + a fixed gradient
    // envMap for a soft sheen; see this file's header for why that's a
    // static texture rather than a live planar-reflection pass)
    const floorMat = new THREE.MeshPhysicalMaterial({
      color: 0x18140f, roughness: 0.18, metalness: 0.08,
      clearcoat: 0.5, clearcoatRoughness: 0.22,
      envMap: makeFloorEnvTexture(), envMapIntensity: 0.85,
    });
    loadPBRSet(loader, 'floor', floorMat, 5, 5, anisotropy, true);
    const floorGeo = new THREE.CircleGeometry(R, 64);
    floorGeo.setAttribute('uv2', floorGeo.attributes.uv);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // dark charcoal architectural concrete, a real dome (not a flat
    // ring) — see buildDomeGeometry's own header
    const domeGeo = buildDomeGeometry(R, H, ROOM.oculusRadius, ROOM.domeRise, 14, 96);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x39352d, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    });
    loadPBRSet(loader, 'ceiling', domeMat, 6, 2, anisotropy, true);
    domeGeo.setAttribute('uv2', domeGeo.attributes.uv);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.receiveShadow = true;
    group.add(dome);

    // the oculus's own bright warm ivory stone interior, where the
    // dome meets the opening, at the dome's own apex height (wallTop +
    // rise), not the wall's height
    const lipMat = new THREE.MeshBasicMaterial({ color: 0xfdf3dc });
    const lip = new THREE.Mesh(new THREE.RingGeometry(ROOM.oculusRadius - 0.06, ROOM.oculusRadius, 48), lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = H + ROOM.domeRise - 0.02;
    group.add(lip);

    // a visible light-shaft mesh (a thin transparent cone) was tried
    // here for the "beam through the oculus" look and pulled back out
    // — tested directly against the actual camera path and it read as
    // a hard, wrong diagonal seam across large parts of the frame
    // whenever the camera got close to or nearly tangent with its
    // single-layer conical surface (a real artifact of a zero-
    // thickness additive mesh with no per-triangle depth sorting, not
    // a one-off glitch — reproduced at more than one camera stage).
    // The spotlight + glowing oculus lip + fog already read as "light
    // spilling from the hole" without needing a literal visible beam.

    // near-black polished marble, slightly more reflective than the
    // floor, distinct from the lighter seat
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x0e0c0a, roughness: 0.14, metalness: 0.16,
    });
    loadPBRSet(loader, 'platform', platformMat, 2, 2, anisotropy, true);

    // recessed circular platform: a sunken floor disc + a rounded riser
    // dropping down to it, rather than a raised dais
    const pitDepth = 0.22, pitRadius = 2.7;
    const riserGeo = buildRecessedRiserGeometry(pitRadius, pitDepth, 0.08, 48);
    riserGeo.setAttribute('uv2', riserGeo.attributes.uv);
    const riser = new THREE.Mesh(riserGeo, platformMat);
    riser.position.set(0, 0, -2.2);
    riser.receiveShadow = true;
    group.add(riser);
    const pitFloorGeo = new THREE.CircleGeometry(pitRadius - 0.08, 48);
    pitFloorGeo.setAttribute('uv2', pitFloorGeo.attributes.uv);
    const pitFloor = new THREE.Mesh(pitFloorGeo, platformMat);
    pitFloor.rotation.x = -Math.PI / 2;
    pitFloor.position.set(0, -pitDepth, -2.2);
    pitFloor.receiveShadow = true;
    group.add(pitFloor);

    // sculpted, carved stone seat — light, porous natural limestone, no
    // glossy finish, deliberately distinct from the platform's
    // near-black polish. Starts as a heavily-subdivided (detail:3)
    // icosahedron for a dense, evenly-distributed vertex mesh to sculpt
    // against, then sculptStoneGeometry breaks its perfect symmetry
    // with deterministic noise + a few concentrated chip divots (see
    // that function's own header) rather than leaving it a smooth
    // mathematical blob
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0xa89880, roughness: 0.88, metalness: 0.01,
    });
    const seatGeo = new THREE.IcosahedronGeometry(1.15, 3);
    sculptStoneGeometry(seatGeo, 2.7, [
      { center: new THREE.Vector3(0.85, 0.35, 0.55), radius: 0.55, depth: 0.16 },
      { center: new THREE.Vector3(-0.65, -0.25, 0.75), radius: 0.42, depth: 0.12 },
      { center: new THREE.Vector3(0.2, 0.65, -0.75), radius: 0.48, depth: 0.14 },
      { center: new THREE.Vector3(-0.4, 0.6, 0.3), radius: 0.32, depth: 0.09 },
    ]);
    seatGeo.setAttribute('uv2', seatGeo.attributes.uv); // aoMap needs a second UV channel
    loadPBRSet(loader, 'seat', seatMat, 1, 1, anisotropy, true);
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.scale.set(1.3, 0.62, 1.05);
    seat.position.set(0.15, 0.5 - pitDepth, -2.4);
    seat.rotation.y = 0.6;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    // soft contact shadow under the seat — a decal, not a real shadow
    // map for a second light (see makeShadowDecalTexture's own header).
    // Every flat decal sharing the floor/pit-floor's own plane below
    // is deliberately spaced several centimetres apart in Y (not the
    // sub-millimetre gaps an earlier pass used) — those were close
    // enough for the depth buffer to flicker between them as the
    // camera moved during scroll, reading as a glitching floor rather
    // than a still, layered surface. depthWrite:false alone doesn't
    // prevent that; real separation does.
    const seatShadowMat = new THREE.MeshBasicMaterial({
      map: makeShadowDecalTexture(0.5), transparent: true, depthWrite: false,
    });
    const seatShadow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), seatShadowMat);
    seatShadow.rotation.x = -Math.PI / 2;
    seatShadow.position.set(0.15, -pitDepth + 0.03, -2.4);
    group.add(seatShadow);

    // faint scratches across the floor, standing in for the years of
    // foot traffic a real polished-stone floor this scale would show
    const scratchesMat = new THREE.MeshBasicMaterial({
      map: makeScratchesTexture(5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scratchesMat.map.repeat.set(5, 5);
    const scratches = new THREE.Mesh(new THREE.CircleGeometry(R, 64), scratchesMat);
    scratches.rotation.x = -Math.PI / 2;
    scratches.position.y = 0.03;
    group.add(scratches);

    // contact dirt around the platform's own rim, the same decal
    // technique at a smaller radius so it lands right at the pit's
    // edge rather than the far wall
    const platformContactMat = new THREE.MeshBasicMaterial({
      map: makeEdgeVignetteTexture(0.4, 29), transparent: true, depthWrite: false,
    });
    const platformContact = new THREE.Mesh(new THREE.CircleGeometry(pitRadius + 0.6, 48), platformContactMat);
    platformContact.rotation.x = -Math.PI / 2;
    platformContact.position.set(0, 0.06, -2.2);
    group.add(platformContact);

    // contact dirt/grime where the wall meets the floor, all the way
    // around — a full floor-sized disc with an edge-darkening decal
    // (see makeEdgeVignetteTexture), standing in for a real AO pass
    // at that seam
    const wallContactMat = new THREE.MeshBasicMaterial({
      map: makeEdgeVignetteTexture(0.4, 11), transparent: true, depthWrite: false,
    });
    const wallContact = new THREE.Mesh(new THREE.CircleGeometry(R, 64), wallContactMat);
    wallContact.rotation.x = -Math.PI / 2;
    wallContact.position.y = 0.09;
    group.add(wallContact);

    // hidden LED strip at the base of the wall — thin warm-white, not
    // orange — a continuous emissive ring, unlit (MeshBasicMaterial,
    // no lighting cost) so it reads as a light source rather than a
    // lit surface
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xfff0da });
    const led = new THREE.Mesh(new THREE.TorusGeometry(R - 0.05, 0.025, 8, 128), ledMat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.05;
    group.add(led);

    // rough natural stone, uneven texture — its own material,
    // deliberately distinct from the platform's polished marble, for
    // the stepping-stone path from the entrance all the way to the
    // platform's own edge. Each stone is a flat CircleGeometry cap
    // (plain, non-pinched radial UV) plus a separate rounded-rim band
    // (see buildStoneRimGeometry's own header for why those are two
    // meshes instead of one Lathe revolve) sharing one material, built
    // once here and reused across every stone position below.
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x6b6157, roughness: 0.92, metalness: 0.02 });
    loadPBRSet(loader, 'stepping-stones', stepMat, 1, 1, anisotropy, true);
    const stoneRadius = 0.55, stoneThickness = 0.16, stoneBevel = 0.05;
    const stoneCapGeo = new THREE.CircleGeometry(stoneRadius - stoneBevel, 24);
    stoneCapGeo.setAttribute('uv2', stoneCapGeo.attributes.uv);
    const stoneRimGeo = buildStoneRimGeometry(stoneRadius, stoneThickness, stoneBevel, 24);
    stoneRimGeo.setAttribute('uv2', stoneRimGeo.attributes.uv);
    const stonePath = [
      { x: 0.0, z: 8.4 }, { x: 0.5, z: 7.3 }, { x: -0.35, z: 6.2 },
      { x: 0.4, z: 5.1 }, { x: -0.3, z: 4.0 }, { x: 0.35, z: 2.9 },
      { x: -0.2, z: 1.9 }, { x: 0.15, z: 0.9 },
    ];
    stonePath.forEach((p) => {
      const stoneCap = new THREE.Mesh(stoneCapGeo, stepMat);
      stoneCap.rotation.x = -Math.PI / 2;
      stoneCap.position.y = stoneThickness / 2;
      stoneCap.receiveShadow = true;
      const stoneRim = new THREE.Mesh(stoneRimGeo, stepMat);
      stoneRim.receiveShadow = true;
      stoneRim.castShadow = true;
      const stone = new THREE.Group();
      stone.add(stoneCap, stoneRim);
      stone.position.set(p.x, 0.08, p.z);
      group.add(stone);
    });

    // dark charcoal concrete, matte finish — its own material for the
    // doorway's interior reveal, distinct from the wall's plaster
    const doorwayMat = new THREE.MeshStandardMaterial({ color: 0x2b2822, roughness: 0.92, metalness: 0.02 });
    loadPBRSet(loader, 'doorway', doorwayMat, 1, 1, anisotropy, true);

    // three doorway alcoves: two side (left/right), one center back —
    // each a real carved-through opening (see buildDoorwayPatchGeometry).
    // wallMat is passed through too — the patch's own visible frame
    // face (facing the room) uses the wall's own plaster material via
    // ExtrudeGeometry's material groups, so the opening reads as a
    // continuous wall with a hole carved into it, only switching to
    // the darker concrete once you're actually inside the reveal
    const doorwayThetas = [-ROOM.doorTheta, ROOM.doorTheta, 0];
    doorwayThetas.forEach((theta) => this._buildDoorway(group, theta, doorwayMat, wallMat));
  }

  _buildDoorway(group, theta, doorwayMat, wallMat){
    const R = ROOM.radius;
    // slightly inside the wall's own nominal radius so this patch's
    // outer face fully occludes the (still-present, unmodified) wall
    // ribbon behind it rather than fighting it for the same depth
    const p = wallPoint(theta, R - 0.08);
    const angle = Math.atan2(p.x, -p.z); // face inward, matches wallPoint's own convention

    // the patch itself is built already-curved in room space (see
    // buildDoorwayPatchGeometry's own header) and added directly to
    // the room group, not this doorway's own local group below — a
    // flat patch sitting in a rotated local space still reads as a
    // flat slab proud of the curved wall around it, which is exactly
    // the "looks like a pillar sticking out" problem this replaces
    const patchGeo = buildDoorwayPatchGeometry(theta, R - 0.08);
    patchGeo.setAttribute('uv2', patchGeo.attributes.uv);
    // ExtrudeGeometry-with-a-hole's default material groups: index 0
    // is the extruded "sides" (both the hole's inner tunnel walls AND
    // the outer perimeter, which is hidden behind the main wall), and
    // index 1 is the front/back caps (the visible flat frame facing
    // the room) -- confirmed directly against the actual render, not
    // assumed from the minified source
    const patch = new THREE.Mesh(patchGeo, [doorwayMat, wallMat]);
    patch.castShadow = true;
    patch.receiveShadow = true;
    group.add(patch);

    // everything else in the reveal (void plane, LED strips, rim
    // light, vase) is small/deep enough relative to the wall's own
    // radius that a flat local space for them is visually fine — only
    // the wide flat frame patch above needed real curving
    const doorGroup = new THREE.Group();
    doorGroup.position.set(p.x, 0, p.z);
    doorGroup.rotation.y = angle;
    group.add(doorGroup);

    // dark plane at the back of the carved recess, beyond which the
    // fog/darkness reads as "leads somewhere", pushed back to match
    // the reveal's own increased depth
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.5), voidMat);
    voidPlane.position.set(0, 1.9, 0.97);
    doorGroup.add(voidPlane);

    // hidden LED strip recessed into the door reveal, warm-white —
    // sitting inside the opening's own real depth
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xfff0da });
    [-1.05, 1.05].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.4, 0.05), rimMat);
      strip.position.set(x, 1.9, 0.45);
      doorGroup.add(strip);
    });

    const rimLight = new THREE.PointLight(0xffe9c8, 3, 5, 2);
    rimLight.position.set(0, 2.1, 0.65);
    doorGroup.add(rimLight);

    // the centre doorway only gets the vase+branch centrepiece sitting
    // at the back of its own reveal, matching the reference photo —
    // the two side doorways stay empty
    if(theta === 0) this._buildVase(doorGroup);
  }

  _buildVase(doorGroup){
    // a warm, dimly-lit backdrop just in front of the reveal's own
    // near-black void plane, and a dedicated soft light on the vase
    // itself — without these it sat as a flat dark silhouette against
    // pure black, unlike the reference photo's own clearly-lit urn
    const backdropMat = new THREE.MeshStandardMaterial({ color: 0x2b2216, roughness: 0.95, metalness: 0 });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.3), backdropMat);
    backdrop.position.set(0, 1.9, 0.93);
    doorGroup.add(backdrop);

    const vaseLight = new THREE.PointLight(0xffe6c0, 2.2, 3.5, 2);
    vaseLight.position.set(0.15, 1.1, 0.55);
    doorGroup.add(vaseLight);

    const vaseMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.5, metalness: 0.3 });
    const vase = new THREE.Mesh(buildVaseGeometry(), vaseMat);
    vase.position.set(0, 0, 0.82);
    vase.castShadow = true;
    vase.receiveShadow = true;
    doorGroup.add(vase);

    // a handful of thin angled branches with small bud clusters at
    // their tips — deterministic angles, not random, so the silhouette
    // is stable across reloads
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.8, metalness: 0 });
    const budMat = new THREE.MeshStandardMaterial({ color: 0x565034, roughness: 0.75, metalness: 0 });
    const branches = [
      { len: 0.62, tilt: 0.12, yaw: 0.3 }, { len: 0.5, tilt: 0.22, yaw: -0.5 },
      { len: 0.7, tilt: 0.05, yaw: 1.4 }, { len: 0.45, tilt: 0.3, yaw: -1.7 },
      { len: 0.58, tilt: 0.15, yaw: 2.6 }, { len: 0.4, tilt: 0.35, yaw: -2.9 },
    ];
    branches.forEach((b, i) => {
      const branch = new THREE.Group();
      branch.position.set(0, 0.58, 0.82);
      branch.rotation.y = b.yaw;
      branch.rotation.z = b.tilt;
      doorGroup.add(branch);

      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, b.len, 6), branchMat);
      stem.position.y = b.len / 2;
      stem.rotation.z = -0.08;
      branch.add(stem);

      const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + (i % 3) * 0.012, 0), budMat);
      bud.position.y = b.len;
      branch.add(bud);
    });
  }

  _buildLights(){
    // soft ivory daylight from the oculus + several soft, non-shadow-
    // casting point lights standing in for bounced light (floor-ward,
    // doorway-ward) so the room reads as softly, indirectly lit rather
    // than lit by one dominant spotlight — real bounce lighting would
    // need baked lightmaps or a voxel-GI pass this project has no
    // pipeline for (see this file's header). Ground colour lifted off
    // near-black so contact shadows read as soft and deep rather than
    // crushed to pure black.
    const hemi = new THREE.HemisphereLight(0xfff4e2, 0x3d3120, 0.95);
    this.scene.add(hemi);

    const spot = new THREE.SpotLight(0xfff6e8, 8.5, 27, 0.5, 0.68, 1.05);
    spot.position.set(0, ROOM.height + ROOM.domeRise - 0.3, -1.4);
    spot.target.position.set(0, 0, -2.0);
    spot.castShadow = true;
    const shadowSize = this.isMobile ? CONFIG.shadowSizeMobile : CONFIG.shadowSize * 2;
    spot.shadow.mapSize.set(shadowSize, shadowSize);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 16;
    spot.shadow.bias = -0.0012;
    spot.shadow.radius = 3.5; // softer PCF penumbra than the default hard-edged kernel
    this.scene.add(spot, spot.target);

    // a second, much wider and softer light also at the oculus —
    // distinct from the spotlight's own tight focused cone, this reads
    // as diffuse skylight spilling through the whole opening rather
    // than a single beam, the way real daylight through a real oculus
    // would fill the room broadly, not just where the beam lands
    const skylight = new THREE.PointLight(0xf3ecdb, 3.2, 26, 1.4);
    skylight.position.set(0, ROOM.height + ROOM.domeRise - 0.6, -1.4);
    this.scene.add(skylight);

    // soft warm bounce off the floor, filling the underside of the
    // dome the way real light reflected up off a pale floor would —
    // warm cream, not orange
    const floorBounce = new THREE.PointLight(0xf5e6cc, 1.3, 15, 2);
    floorBounce.position.set(0, 0.6, 2.5);
    this.scene.add(floorBounce);

    // dedicated dome fill — a real light aimed up into the dome's own
    // underside, since HemisphereLight alone lights a downward-facing
    // interior surface with mostly its (darker) ground term rather
    // than its sky term, which otherwise left the dome reading nearly
    // black regardless of the dome material's own base colour
    const domeFill = new THREE.PointLight(0xf7e8cc, 2.2, 22, 1.5);
    domeFill.position.set(0, ROOM.height * 0.7, 1.5);
    this.scene.add(domeFill);

    // soft fill toward the entrance side, away from the spotlight's
    // own throw, so that half of the room doesn't read as flat-dark
    const entranceFill = new THREE.PointLight(0xfff8ee, 1.3, 17, 2);
    entranceFill.position.set(0, 2.6, 6.5);
    this.scene.add(entranceFill);

    // soft fill low near the platform/seat, reads as light bounced off
    // the recessed pit's own pale stone back up onto the seat
    const seatFill = new THREE.PointLight(0xfff2dc, 1.05, 8, 2);
    seatFill.position.set(0.3, 0.3, -1.6);
    this.scene.add(seatFill);
  }

  // -----------------------------------------------------------------
  // camera path
  // -----------------------------------------------------------------
  _buildKeyframes(){
    // one keyframe per step — position/lookAt tuned by eye against the
    // room's own geometry, not derived formulaically beyond doorway
    // theta (see wallPoint) for the two side-doorway shots
    const left = wallPoint(-ROOM.doorTheta, ROOM.radius);
    const right = wallPoint(ROOM.doorTheta, ROOM.radius);

    this.keyframes = [
      { // Discover — wide establishing view from the threshold
        pos: new THREE.Vector3(0, 2.75, 8.6),
        look: new THREE.Vector3(0, 1.85, -2.2),
      },
      { // Design — angled toward the left doorway
        pos: new THREE.Vector3(-2.1, 2.25, 3.6),
        look: new THREE.Vector3(left.x * 0.62, 1.85, left.z * 0.62),
      },
      { // Develop — mirrored, toward the right doorway
        pos: new THREE.Vector3(2.1, 2.25, 3.6),
        look: new THREE.Vector3(right.x * 0.62, 1.85, right.z * 0.62),
      },
      { // Launch — arriving at the platform, facing the back doorway
        pos: new THREE.Vector3(0, 1.95, -0.4),
        look: new THREE.Vector3(0, 1.55, -8.5),
      },
    ];
    this.curve = new THREE.CatmullRomCurve3(this.keyframes.map(k => k.pos), false, 'catmullrom', 0.5);
  }

  _cameraForProgress(p){
    const u = this._stageEase(p);
    const pos = this.curve.getPointAt(Math.max(0, Math.min(1, u)));

    const idxF = u * (this.keyframes.length - 1);
    const idx = Math.min(this.keyframes.length - 2, Math.floor(idxF));
    const localT = idxF - idx;
    const look = this.keyframes[idx].look.clone().lerp(this.keyframes[idx + 1].look, localT);

    return { pos, look };
  }

  _stageEase(p){
    const bands = this.keyframes.length - 1;
    const bandF = Math.max(0, Math.min(bands, p * bands));
    const band = Math.min(bands - 1, Math.floor(bandF));
    const localT = bandF - band;
    const eased = localT * localT * (3 - 2 * localT); // smoothstep
    return (band + eased) / bands;
  }

  // -----------------------------------------------------------------
  // sizing / lifecycle
  // -----------------------------------------------------------------
  _resize(){
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const cap = this.isMobile ? CONFIG.dprCapMobile : CONFIG.dprCap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _renderStatic(){
    const { pos, look } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.renderer.render(this.scene, this.camera);
    this._updateSteps(0);
  }

  _bindEvents(){
    let lastResizeW = window.innerWidth, lastResizeH = window.innerHeight;
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      if(Math.abs(w - lastResizeW) <= 10 && Math.abs(h - lastResizeH) <= 10) return;
      lastResizeW = w; lastResizeH = h;
      this.isMobile = w < 860;
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(() => { this._resize(); this._measure(); this._update(); }, 200);
    };
    window.addEventListener('resize', this._onResize);

    if(!this.isCoarsePointer && !this.prefersReducedMotion){
      this._onMouseMove = (e) => {
        this.mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
        this._wake();
      };
      window.addEventListener('mousemove', this._onMouseMove, { passive: true });
    }

    this._measure();
    let ticking = false;
    window.addEventListener('scroll', () => {
      if(ticking) return;
      ticking = true;
      requestAnimationFrame(() => { this._update(); ticking = false; });
    }, { passive: true });

    if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._measure(); this._update(); });
    window.addEventListener('load', () => { this._measure(); this._update(); });
    requestAnimationFrame(() => { this._measure(); this._update(); });
  }

  _measure(){
    this.sectionTop = this.section.offsetTop;
    this.sectionHeight = this.section.offsetHeight;
    this.viewportH = window.innerHeight;
  }

  _update(){
    const scrollable = Math.max(1, this.sectionHeight - this.viewportH);
    const raw = (window.scrollY - this.sectionTop) / scrollable;

    if(raw < 0){
      if(this._state.pinnedLow) return;
      this._state.pinnedLow = true;
      this._state.pinnedHigh = false;
    } else if(raw > 1){
      if(this._state.pinnedHigh) return;
      this._state.pinnedHigh = true;
      this._state.pinnedLow = false;
    } else {
      this._state.pinnedLow = false;
      this._state.pinnedHigh = false;
    }

    const progress = Math.max(0, Math.min(1, raw));
    this._state.progress = progress;
    this._wake();
  }

  _wake(){
    if(!this._state.rafId){
      this._state.rafId = requestAnimationFrame(this._frame.bind(this));
    }
  }

  _frame(){
    this._state.rafId = null;

    if(!this.prefersReducedMotion){
      this.mouse.x += (this.mouseTarget.x - this.mouse.x) * 0.06;
      this.mouse.y += (this.mouseTarget.y - this.mouse.y) * 0.06;

      const { pos, look } = this._cameraForProgress(this._state.progress);
      this.camera.position.copy(pos);
      const parallaxX = this.mouse.x * CONFIG.parallaxMax;
      const parallaxY = -this.mouse.y * CONFIG.parallaxMax * 0.6;
      this.camera.lookAt(look.x + parallaxX, look.y + parallaxY, look.z);
    } else {
      const { pos, look } = this._cameraForProgress(0);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
    }

    this.renderer.render(this.scene, this.camera);
    this._updateSteps(this._state.progress);
  }

  _updateSteps(progress){
    const stage = Math.min(this.stepEls.length - 1, Math.floor(progress * this.stepEls.length));
    if(stage === this._state.activeStage) return;
    this._state.activeStage = stage;
    this.stepEls.forEach((el, i) => el.classList.toggle('is-active', i === stage));
    this.dotEls.forEach((el, i) => el.classList.toggle('is-active', i === stage));
  }
}

(function(){
  const section = document.getElementById('processRoom');
  const container = section ? section.querySelector('.process-room-sticky') : null;
  const canvas = document.getElementById('processRoomCanvas');
  const stepsWrap = document.getElementById('processRoomSteps');
  if(!section || !container || !canvas || !stepsWrap) return;
  const stepEls = Array.from(stepsWrap.querySelectorAll('.process-room-step'));
  const dotEls = Array.from(section.querySelectorAll('.process-room-dot'));

  window.Papi = window.Papi || {};
  window.Papi.processRoom = new ProcessRoom(section, container, canvas, stepEls, dotEls);
})();
