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

   Distance/depth is still cued with exponential fog (THREE.FogExp2)
   plus a CSS blur on the two inactive step labels' own DOM text, same
   "the falloff/blur lives in a cheap static layer" approach as
   js/process-fog.js's own header explains for its ambient vapor — that
   part predates and still complements the real BokehPass below, rather
   than being replaced by it.

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
   - AO/contact shadows started as soft canvas-gradient decals (a dark
     ring where the wall meets the floor, a soft blob under the stone
     seat) — those decals are still there, layered underneath the real
     SSAOPass added below for the finer contact shadows a screen-space
     pass catches that a handful of fixed decals never could (stone
     chips, stepping-pad bevels, the doorway reveal corners).

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

   Rendering-quality pass — real post-processing, not just a direct
   renderer.render() call. This project has no bundler/npm, so the
   handful of Three.js example modules this needs (postprocessing core,
   SSAOPass, UnrealBloomPass, BokehPass, RGBELoader) are vendored
   unmodified into js/vendor/examples/jsm/, matching this project's
   r160 core build exactly — see index.html's <script type="importmap">
   for how their own bare "three" imports resolve without a bundler.
   - _buildEnvironment loads a real HDRI (Poly Haven, CC0 — an overcast
     sky, standing in for daylight through the oculus) via RGBELoader +
     PMREMGenerator, assigned to scene.environment — a global fallback
     envMap every material already picks up automatically, so no
     material definition needed to change to get real image-based
     reflections/ambient light.
   - _buildPostProcessing assembles the composer chain: SSAO (desktop
     only — contact shadows in the stone chips/bevels/reveal corners a
     few fixed decals can't reach), selective bloom (LED strips only —
     the standard two-composer "swap everything else to black, blur,
     composite back" technique, not a scene-wide threshold bloom that
     would just as happily catch the platform's own gloss), a combined
     vignette/filmic-contrast/colour-grade ShaderPass, a velocity-driven
     BokehPass (desktop only — aperture/maxblur ramp up from zero based
     on camera speed each frame, in _renderFrame, so the blur is only
     ever present while actually moving between stages), then OutputPass
     last (ACES/sRGB conversion has to happen there once anything sits
     in a composer chain — every pass before it works in linear HDR).
   - Screen-space reflections were deliberately left out: Three.js's own
     SSRPass is expensive and fragile against curved/organic geometry
     like this room's wobbly walls and sculpted seat, for a look the
     floor's existing envMap + clearcoat already gets most of the way
     to. Real HDRI reflections via scene.environment (above) cover the
     rest without the extra render pass.
   - SSAO/bloom/Bokeh are all gated to desktop (`!this.isMobile`) — each
     is a real extra full-scene render every frame, the same budget
     line CONFIG.dprCapMobile/shadowSizeMobile already draws elsewhere
     in this file. Mobile still gets the composer, HDRI, and colour
     grade — just not the three heaviest passes.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { RGBELoader } from './vendor/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from './vendor/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from './vendor/examples/jsm/postprocessing/BokehPass.js';

const ROOM = {
  radius: 9,
  height: 6.4,
  oculusRadius: 2.3,
  oculusThroatHeight: 0.6, // real depth above the lip — see the throat mesh in _buildRoom
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

// the LED strips (base ring + doorway reveals) live on this layer in
// addition to the default layer 0, so the selective-bloom composer in
// _buildPostProcessing can isolate just them for blooming
const BLOOM_LAYER = 1;

// the depth-of-field subject — roughly the platform/seat, since that's
// the room's own visual centre at every stage; see the velocity-driven
// BokehPass wiring in _renderFrame
const DOF_FOCUS_POINT = new THREE.Vector3(0, 1.2, -2.2);

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

// bakes a directional brightness gradient into a ring/cylinder's own
// per-vertex colour, brightest at brightAngle and darkest at the
// opposite side — used on the oculus lip/throat for the reference
// photo's "crescent" look. A real point light was tried there first,
// but its falloff against the throat's own always-lit-bright lip
// ring read as barely any asymmetry at all; vertex colour gives that
// same look directly and predictably rather than depending on a
// light position tuned by eye against an unreliable render
function applyCrescentVertexColors(geometry, brightAngle, floorBrightness, axes){
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for(let i = 0; i < pos.count; i++){
    const x = pos.getX(i);
    // RingGeometry lies flat in its own local XY plane (its "radius"
    // axis pair) before this mesh's own rotation.x=90deg turns it
    // horizontal; CylinderGeometry is already upright with X/Z as its
    // radial plane — each needs its own pair of axes read here
    const other = axes === 'xy' ? pos.getY(i) : pos.getZ(i);
    let diff = Math.atan2(x, other) - brightAngle;
    while(diff > Math.PI) diff -= Math.PI * 2;
    while(diff < -Math.PI) diff += Math.PI * 2;
    const t = 1 - Math.abs(diff) / Math.PI; // 1 at brightAngle, 0 at the opposite side
    const b = floorBrightness + (1 - floorBrightness) * Math.pow(Math.max(0, t), 1.6);
    colors[i * 3] = b; colors[i * 3 + 1] = b; colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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

// a flat, rounded-rectangle stepping-pad — plain ExtrudeGeometry (not
// a Lathe revolve, so no risk of the UV-pinch/vortex look an earlier
// circular-puck version had). rotateX(-90deg) maps the extrude's own
// local Z (its 0..thickness depth) onto local Y, so the result already
// rests with its bottom at y=0 and top at y=thickness — placed at
// position.y=0, it sits flush on the floor with no further offset
function tracePadShape(shape, width, depth, cornerRadius){
  const hw = width / 2, hd = depth / 2, r = cornerRadius;
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
}
function buildPadGeometry(width, depth, thickness, cornerRadius, bevelSize){
  const shape = new THREE.Shape();
  tracePadShape(shape, width, depth, cornerRadius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: bevelSize, bevelSize, bevelSegments: 3, steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
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

// draws left-to-right with manual per-glyph spacing (canvas 2D has no
// letter-spacing property in every browser this needs to run in) —
// used for the wall signage's tracked-out small-caps title, matching
// the site's own .process-room-num/.process-room-step h3 look
function drawTrackedText(ctx, text, cx, y, spacing){
  ctx.save();
  ctx.textAlign = 'left';
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + spacing;
  });
  ctx.restore();
}

// the 4 process-step placards mounted on the room's own wall segments
// (see _buildStepSignage) — cream/gold on transparent, with a soft
// warm backlight glow baked in, echoing the room's existing LED-strip
// glow language rather than reading as a flat printed card
function makeStepSignTexture(number, title, lines){
  const w = 620, h = 820;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  // a soft warm-umber panel — the same family as the doorway backdrop/
  // void plane tones rather than a stark black card — so the sign
  // reads as an integrated placard against the room's own palette
  ctx.fillStyle = 'rgba(37,29,20,0.55)';
  ctx.beginPath();
  ctx.roundRect(30, 30, w - 60, h - 60, 26);
  ctx.fill();

  const glow = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, h * 0.55);
  glow.addColorStop(0, 'rgba(255,222,175,0.14)');
  glow.addColorStop(1, 'rgba(255,222,175,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(228,205,154,0.85)';
  ctx.font = '600 60px Fraunces, serif';
  ctx.fillText(number, w / 2, 150);

  ctx.fillStyle = 'rgba(243,237,226,0.95)';
  ctx.font = '500 38px Fraunces, serif';
  drawTrackedText(ctx, title.toUpperCase(), w / 2, 240, 7);

  ctx.font = '300 27px Inter, sans-serif';
  ctx.fillStyle = 'rgba(243,237,226,0.6)';
  lines.forEach((line, i) => ctx.fillText(line, w / 2, 305 + i * 40));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// one entry per camera keyframe/stage — see _buildStepSignage for how
// each becomes a placard positioned along that stage's own camera path
const STEP_SIGNS = [
  { number: '01', title: 'Discover', lines: ['We learn about your brand, goals,', 'and audience.'] },
  { number: '02', title: 'Design', lines: ['Strategic, modern designs that', 'make an impact.'] },
  { number: '03', title: 'Develop', lines: ['Fast, responsive, and built with', 'clean code.'] },
  { number: '04', title: 'Launch', lines: ['Tested, refined, and ready to', 'perform from day one.'] },
];

class ProcessRoom {
  constructor(section, container, canvas){
    this.section = section;
    this.container = container;
    this.canvas = canvas;
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
    // "physically correct lighting": the old physicallyCorrectLights
    // toggle, and its r155+ replacement renderer.useLegacyLights, are
    // both deprecated no-ops on this Three.js build — physically-based
    // light falloff is just how lighting works now, unconditionally,
    // nothing left to actually enable
    this.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x100d0a, 0.05);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 40);
    this.mouse = { x: 0, y: 0 };
    this.mouseTarget = { x: 0, y: 0 };

    this._buildRoom();
    this._buildLights();
    this._buildKeyframes();
    this._buildStepSignage();
    this._buildEnvironment();
    this._buildPostProcessing();

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
    this.roomGroup = group;

    // every material's maps load async and attach the instant each one
    // finishes, independent of the others — on a cold cache that meant
    // walls/floor/platform/etc each popped from flat colour to fully
    // textured at a different moment, and since a render only happens
    // on the next scroll/mouse tick, several of those pops could land
    // in the same rapid burst of frames while scrolling in, reading as
    // the room "strobing". A shared LoadingManager lets the canvas stay
    // hidden (see the .is-ready CSS transition) until every texture for
    // every material has arrived, so it only ever appears fully dressed.
    const manager = new THREE.LoadingManager();
    manager.onLoad = () => {
      this.canvas.classList.add('is-ready');
      this._frame();
    };
    const loader = new THREE.TextureLoader(manager);
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
    // rise), not the wall's height — a per-vertex crescent gradient
    // (see applyCrescentVertexColors) rather than a flat unlit colour,
    // for the reference photo's bright-one-side/shadowed-other-side
    // look
    const oculusBrightAngle = Math.atan2(1.2, -1.4); // matches oculusGraze's own direction in _buildLights
    const lipGeo = new THREE.RingGeometry(ROOM.oculusRadius - 0.06, ROOM.oculusRadius, 64);
    applyCrescentVertexColors(lipGeo, oculusBrightAngle, 0.35, 'xy');
    const lipMat = new THREE.MeshBasicMaterial({ color: 0xfdf3dc, vertexColors: true });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = H + ROOM.domeRise - 0.02;
    group.add(lip);

    // a real light well standing up from the lip — before this the
    // hole was a paper-thin ring with no surface behind it, giving the
    // crescent gradient above no real depth to read against
    const throatGeo = new THREE.CylinderGeometry(ROOM.oculusRadius - 0.02, ROOM.oculusRadius + 0.35, ROOM.oculusThroatHeight, 64, 1, true);
    applyCrescentVertexColors(throatGeo, oculusBrightAngle, 0.2, 'xz');
    const throatMat = new THREE.MeshStandardMaterial({
      color: 0xe7dbc0, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
    });
    const throat = new THREE.Mesh(throatGeo, throatMat);
    throat.position.y = H + ROOM.domeRise - 0.02 + ROOM.oculusThroatHeight / 2;
    throat.receiveShadow = true;
    group.add(throat);

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
    led.layers.enable(BLOOM_LAYER); // bloom-only render also picks this up — see _buildPostProcessing
    group.add(led);

    // smooth, dark stone pavers — same family as the platform's polish
    // but its own material (a much larger repeat spreads the source
    // photo's own crack detail out into a subtle, sanded-looking
    // variation instead of a densely-repeated jagged rock pattern),
    // for two separate stepping paths: the long one from the entrance
    // up to the platform's near edge, and a short one from the vase
    // alcove behind the platform up to its far edge — matching the
    // reference photo's two converging paths rather than just one.
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.45, metalness: 0.06 });
    loadPBRSet(loader, 'stepping-stones', stepMat, 0.35, 0.5, anisotropy, true);
    stepMat.normalScale = new THREE.Vector2(0.35, 0.35);
    const padGeo = buildPadGeometry(0.85, 1.05, 0.14, 0.16, 0.03);
    padGeo.setAttribute('uv2', padGeo.attributes.uv);
    const placePad = (x, z) => {
      const pad = new THREE.Mesh(padGeo, stepMat);
      pad.position.set(x, 0, z);
      pad.receiveShadow = true;
      pad.castShadow = true;
      group.add(pad);
    };
    // front path: entrance toward the platform's near edge (~z 0.5)
    [
      { x: 0.0, z: 7.9 }, { x: 0.35, z: 6.6 }, { x: -0.3, z: 5.3 },
      { x: 0.3, z: 4.0 }, { x: -0.25, z: 2.7 }, { x: 0.15, z: 1.4 },
    ].forEach((p) => placePad(p.x, p.z));
    // back path: vase alcove (~z -8) toward the platform's far edge (~z -4.9)
    [
      { x: 0.1, z: -7.2 }, { x: -0.2, z: -6.0 }, { x: 0.15, z: -4.8 },
    ].forEach((p) => placePad(p.x, p.z));

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

  // one floating placard per stage, replacing the old bottom-of-screen
  // DOM step copy — rather than mounting these on the wall (the side
  // doorways already reach almost to the edge of the Discover-stage
  // frame, leaving no visible wall outside them to anchor to), each
  // sign sits along its own stage's camera-to-look line, so it's
  // already roughly centred in frame the moment that stage arrives,
  // and _updateSteps below fades/scales it in and out as the camera
  // nears then leaves that point in the path — needs this.keyframes,
  // so this runs after _buildKeyframes, not from inside _buildRoom
  _buildStepSignage(){
    this._signs = STEP_SIGNS.map((step, i) => {
      const kf = this.keyframes[i];
      const anchor = kf.pos.clone().lerp(kf.look, 0.55);

      const tex = makeStepSignTexture(step.number, step.title, step.lines);
      const aspect = tex.image.height / tex.image.width;
      // narrower on mobile's tighter/taller aspect so the description
      // text doesn't run past the edge of the frame
      const width = this.isMobile ? 1.5 : 2.3;
      const geo = new THREE.PlaneGeometry(width, width * aspect);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(anchor);
      const dir = kf.pos.clone().sub(anchor);
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      this.roomGroup.add(mesh);
      return { mesh, mat };
    });

    // canvas text drawn before the 'Fraunces'/'Inter' webfonts finish
    // loading bakes in the fallback font permanently (unlike DOM text,
    // a canvas texture never reflows on its own) — redraw once fonts
    // are actually ready, in case that race is lost
    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(() => {
        this._signs.forEach(({ mat }, i) => {
          const step = STEP_SIGNS[i];
          mat.map = makeStepSignTexture(step.number, step.title, step.lines);
          mat.needsUpdate = true;
        });
        this._frame();
      });
    }
  }

  // real image-based lighting/reflections from an actual overcast sky
  // (Poly Haven, CC0 — img/hdri/overcast_skylight.hdr, downloaded once,
  // nothing fetches from polyhaven.com at runtime), not the static
  // gradient texture used elsewhere in this file. Assigned to
  // scene.environment — a global fallback envMap every material in the
  // room already picks up automatically — rather than any individual
  // material's own .envMap, so no material definition has to change
  _buildEnvironment(){
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('img/hdri/overcast_skylight.hdr', (hdrTex) => {
      this.scene.environment = pmrem.fromEquirectangular(hdrTex).texture;
      hdrTex.dispose();
      pmrem.dispose();
      this._frame();
    });
  }

  // baseline composer — just the normal beauty render plus the output
  // pass that now does the tone-mapping/colour-space conversion
  // (previously the renderer did that conversion itself on a direct
  // renderer.render() call; once anything sits in a composer chain,
  // that conversion has to happen in an explicit OutputPass instead,
  // as the LAST pass, or colours come out already-clipped for every
  // pass before it). SSAO/bloom/colour-grade/DoF passes get inserted
  // between these two as each is wired in.
  _buildPostProcessing(){
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;

    // selective bloom (LED strips only) — desktop only: it costs a full
    // extra scene traversal + render + multi-pass blur every frame, the
    // same "heavy effect, real GPU cost" bar SSAO below is gated on.
    // The standard Three.js selective-bloom pattern: everything NOT on
    // BLOOM_LAYER gets its material swapped for flat black for one
    // render into its own composer (so only the LEDs contribute), then
    // that blurred result is additively composited back onto the
    // normal beauty render — rather than a single scene-wide threshold
    // bloom, which would just as happily bloom the platform's own
    // gloss highlights or the oculus lip as the LEDs themselves.
    if(!this.isMobile){
      this.bloomLayer = new THREE.Layers();
      this.bloomLayer.set(BLOOM_LAYER);
      this._bloomDarkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      this._bloomMaterialCache = new Map();

      this.bloomComposer = new EffectComposer(this.renderer);
      this.bloomComposer.renderToScreen = false;
      this.bloomComposer.setSize(w, h);
      this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.65, 0.4, 0.1);
      bloomPass.threshold = 0.1;
      bloomPass.strength = 1.15;
      bloomPass.radius = 0.5;
      this.bloomComposer.addPass(bloomPass);
    }

    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // contact shadows in crevices (stone chips, wall/floor seams, the
    // stepping-pad bevels) — a real screen-space AO pass rather than
    // the canvas-decal approximation the header above describes, now
    // that there's render budget for it. kernelRadius/min/maxDistance
    // are tuned down hard from SSAOPass's own defaults (built around
    // room-scale metres): this room's own detail sits at roughly
    // 0.05–1 unit scale, and the library defaults (kernelRadius 8,
    // maxDistance 0.1) either wash the whole room in one flat AO tone
    // or miss the detail entirely at this scale. Desktop-only — a full
    // second depth/normal scene pass every frame is real GPU cost this
    // file's own mobile budget (CONFIG.dprCapMobile, halved shadow
    // maps) has avoided everywhere else.
    if(!this.isMobile){
      const ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
      ssaoPass.kernelRadius = 0.4;
      ssaoPass.minDistance = 0.0008;
      ssaoPass.maxDistance = 0.15;
      ssaoPass.output = SSAOPass.OUTPUT.Default;
      this.ssaoPass = ssaoPass;
      this.composer.addPass(ssaoPass);
    }

    if(this.bloomComposer){
      const bloomCompositePass = new ShaderPass({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main(){
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
          }
        `,
      }, 'baseTexture');
      this.composer.addPass(bloomCompositePass);
    }

    // subtle depth of field, but only while the camera is actually
    // moving — see _renderFrame, which ramps aperture/maxblur up from
    // zero based on camera speed each frame rather than leaving a
    // constant blur on screen. Desktop only: BokehPass renders its own
    // full extra depth pass every frame, the same cost bar SSAO/bloom
    // above are already gated on. Focus follows DOF_FOCUS_POINT (the
    // platform) rather than a fixed distance, since the camera's own
    // distance from it changes a lot across the four stages.
    if(!this.isMobile){
      this.bokehPass = new BokehPass(this.scene, this.camera, {
        focus: this.camera.position.distanceTo(DOF_FOCUS_POINT),
        aperture: 0,
        maxblur: 0,
      });
      this.composer.addPass(this.bokehPass);
    }

    // one combined grade pass rather than three separate ones (vignette
    // + filmic contrast + colour grade are all just per-pixel colour
    // math on the same single input texture — three ShaderPasses would
    // mean three extra full-screen texture reads/writes for no benefit
    // over folding them into one fragment shader). Ordered before
    // OutputPass so this operates on the same linear working colour
    // space as the rest of the composer chain, with ACES/sRGB only
    // applied once, right at the very end.
    this.composer.addPass(new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        vignetteStrength: { value: 0.35 },
        contrastStrength: { value: 0.35 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float vignetteStrength;
        uniform float contrastStrength;
        varying vec2 vUv;
        void main(){
          vec4 texel = texture2D(tDiffuse, vUv);
          vec3 c = texel.rgb;

          // filmic S-curve: gentle lift in shadows, gentle roll-off in
          // highlights, rather than a linear multiply that just clips.
          // This runs on linear HDR values before OutputPass's own
          // ACES/sRGB step, so bright emissive surfaces (the LED
          // strips, the oculus lip) can legitimately be >1.0 here —
          // the curve itself is only well-behaved on [0,1], so it's
          // computed on a clamped copy and blended back against the
          // real (possibly HDR) colour rather than applied directly,
          // which previously inverted per-channel above ~1.5 and read
          // as a rainbow-banded halo around the brightest surfaces
          vec3 clamped = clamp(c, 0.0, 1.0);
          vec3 graded = clamped * clamped * (3.0 - 2.0 * clamped);
          c = mix(c, graded, contrastStrength);

          // slight warm-highlight / cool-shadow split tone, matching
          // the reference photo's warm practicals against a cooler
          // overcast ambient rather than one flat white balance
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 shadowTint = vec3(0.965, 0.975, 1.01);
          vec3 highlightTint = vec3(1.035, 1.005, 0.95);
          c *= mix(shadowTint, highlightTint, smoothstep(0.12, 0.7, lum));

          // soft radial vignette
          vec2 centered = vUv - 0.5;
          float vig = 1.0 - dot(centered, centered) * vignetteStrength;
          c *= vig;

          gl_FragColor = vec4(c, texel.a);
        }
      `,
    }));

    this.composer.addPass(new OutputPass());
  }

  // the two halves of the selective-bloom trick: swap every mesh not
  // on BLOOM_LAYER (i.e. everything except the LED strips) to flat
  // black right before the bloom-only render, then put its real
  // material back right after — so that render sees only the LEDs
  _darkenNonBloomed(){
    this.scene.traverse((obj) => {
      if(obj.isMesh && this.bloomLayer.test(obj.layers) === false){
        this._bloomMaterialCache.set(obj.uuid, obj.material);
        obj.material = this._bloomDarkMaterial;
      }
    });
  }
  _restoreMaterial(){
    this.scene.traverse((obj) => {
      if(this._bloomMaterialCache.has(obj.uuid)){
        obj.material = this._bloomMaterialCache.get(obj.uuid);
        this._bloomMaterialCache.delete(obj.uuid);
      }
    });
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
    // the reveal's own increased depth — warm umber-black, not a flat
    // near-pure-black, so it recedes into shadow without reading as a
    // stark cutout against the wall's own warm plaster
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x120d08 });
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.5), voidMat);
    voidPlane.position.set(0, 1.9, 0.97);
    doorGroup.add(voidPlane);

    // hidden LED strip recessed into the door reveal, warm-white —
    // sitting inside the opening's own real depth
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xfff0da });
    [-1.05, 1.05].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.4, 0.05), rimMat);
      strip.position.set(x, 1.9, 0.45);
      strip.layers.enable(BLOOM_LAYER);
      doorGroup.add(strip);
    });

    // reduced from an earlier 3 — the oculus (spot/skylight below) is
    // meant to read as the room's primary light source, with this and
    // vaseLight as subtle fill only, not a competing light of their own
    const rimLight = new THREE.PointLight(0xffe9c8, 1.3, 5, 2);
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

    // reduced from an earlier 2.2 — subtle fill on the vase, not a
    // second light source competing with the oculus (see rimLight above)
    const vaseLight = new THREE.PointLight(0xffe6c0, 1.2, 3.5, 2);
    vaseLight.position.set(0.15, 1.1, 0.55);
    doorGroup.add(vaseLight);

    // a low plinth under the vase — previously it sat straight on the
    // floor, unlike the reference photo's own small raised base
    const pedestalHeight = 0.16;
    const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x241d15, roughness: 0.7, metalness: 0.05 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, pedestalHeight, 28), pedestalMat);
    pedestal.position.set(0, pedestalHeight / 2, 0.82);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    doorGroup.add(pedestal);

    const vaseMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.5, metalness: 0.3 });
    const vase = new THREE.Mesh(buildVaseGeometry(), vaseMat);
    vase.position.set(0, pedestalHeight, 0.82);
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
      branch.position.set(0, 0.58 + pedestalHeight, 0.82);
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
    // would fill the room broadly, not just where the beam lands.
    // Raised from an earlier 3.2 so it (plus spot above) reads clearly
    // as the room's primary light, with the LED strips as fill only.
    const skylight = new THREE.PointLight(0xf3ecdb, 4.2, 26, 1.4);
    skylight.position.set(0, ROOM.height + ROOM.domeRise - 0.6, -1.4);
    this.scene.add(skylight);

    // offset to one side of the oculus throat (see the throat mesh in
    // _buildRoom) so it grazes one inner face brightly and leaves the
    // opposite face in its own shadow — the reference photo's crescent-
    // lit look, which a light sitting dead-centre above the hole can't
    // produce no matter how the throat itself is shaped
    const oculusGraze = new THREE.PointLight(0xfff4e0, 18, 5, 1.5);
    oculusGraze.position.set(1.2, ROOM.height + ROOM.domeRise + ROOM.oculusThroatHeight - 0.1, -1.4);
    this.scene.add(oculusGraze);

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
      { // Discover — wide establishing view from the threshold, pulled
        // back and raised from the room's original eye-level framing so
        // the full floor-to-ceiling height (including the oculus/dome)
        // sits in frame, matching the reference photo's own wide,
        // slightly-elevated architectural establishing shot rather than
        // a walking-eye-level view that never showed the ceiling at all
        pos: new THREE.Vector3(0, 4.6, 13),
        look: new THREE.Vector3(0, 4.2, -2.2),
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
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if(this.composer){
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
    if(this.bloomComposer){
      this.bloomComposer.setPixelRatio(dpr);
      this.bloomComposer.setSize(w, h);
    }
    if(this.bokehPass){
      this.bokehPass.uniforms.aspect.value = this.camera.aspect;
    }
  }

  _renderStatic(){
    const { pos, look } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._renderFrame();
    this._updateSteps(0);
  }

  // the actual draw call every frame funnels through — swapped from a
  // bare renderer.render() to the composer once real post-processing
  // (SSAO/bloom/colour-grade/DoF) needed a multi-pass pipeline; kept as
  // its own method so both _renderStatic and _frame call one thing
  _renderFrame(){
    if(!this.composer){
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if(this.bokehPass){
      // camera speed this frame, in world units — smoothed rather than
      // read raw so it ramps in/out instead of popping the instant
      // movement starts/stops. this._lastCamPos/_camSpeed persist
      // across frames on the instance, not reset each call.
      if(!this._lastCamPos) this._lastCamPos = this.camera.position.clone();
      const moved = this.camera.position.distanceTo(this._lastCamPos);
      this._lastCamPos.copy(this.camera.position);
      this._camSpeed = this._camSpeed === undefined ? 0 : this._camSpeed;
      this._camSpeed += (moved * 30 - this._camSpeed) * 0.25;
      const movingAmount = Math.min(1, this._camSpeed);
      this.bokehPass.uniforms['aperture'].value = movingAmount * 0.0012;
      this.bokehPass.uniforms['maxblur'].value = movingAmount * 0.006;
      this.bokehPass.uniforms['focus'].value = this.camera.position.distanceTo(DOF_FOCUS_POINT);
    }
    if(this.bloomComposer){
      this._darkenNonBloomed();
      this.bloomComposer.render();
      this._restoreMaterial();
    }
    this.composer.render();
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

    // must run before render() now that it drives real scene state
    // (sign opacity/scale) rather than just DOM class toggles — doing
    // it after left every sign's reveal one frame behind
    this._updateSteps(this._state.progress);
    this._renderFrame();
  }

  _updateSteps(progress){
    const count = this._signs ? this._signs.length : STEP_SIGNS.length;
    this._state.activeStage = Math.min(count - 1, Math.floor(progress * count));
    if(!this._signs) return;

    // continuous per-frame reveal, not a discrete on/off switch — each
    // sign fades/grows in as its own stage's dwell range is entered and
    // fades back out leaving it, so it reads as "coming out" toward the
    // camera as the room arrives there rather than just appearing
    this._signs.forEach(({ mesh, mat }, i) => {
      const localT = progress * count - i;
      let amt = 0;
      if(localT > -0.15 && localT < 1.15){
        const t = Math.max(0, Math.min(1, localT));
        if(t < 0.25) amt = t / 0.25;
        else if(t > 0.75) amt = (1 - t) / 0.25;
        else amt = 1;
      }
      mat.opacity = amt * 0.95;
      mesh.scale.setScalar(0.88 + 0.12 * amt);
    });
  }
}

(function(){
  const section = document.getElementById('processRoom');
  const container = section ? section.querySelector('.process-room-sticky') : null;
  const canvas = document.getElementById('processRoomCanvas');
  if(!section || !container || !canvas) return;

  window.Papi = window.Papi || {};
  window.Papi.processRoom = new ProcessRoom(section, container, canvas);
})();
