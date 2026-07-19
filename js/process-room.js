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
   - Roughness/albedo variation on the plaster surfaces comes from a
     small canvas-generated blotch texture (generated once at
     construction, tiled via the wall's own UVs) rather than an
     authored texture map this project doesn't have.
   - The floor's "subtle reflection" is MeshPhysicalMaterial + a
     static canvas-gradient equirect envMap, not a live planar-
     reflection render pass (a real second scene render every frame,
     and worse on mobile) — a fixed soft sheen reads as "polished"
     without that cost.
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

// a flat-top disc with a rounded rim bevel top and bottom — reused for
// the stepping stones and the seat's own base, so every hard 90deg
// puck edge in the room becomes a soft one
function buildBeveledDisc(radius, thickness, bevel, segments){
  const b = Math.min(bevel, thickness / 2 - 0.001, radius * 0.4);
  const half = thickness / 2;
  const pts = [new THREE.Vector2(0, half)];
  const steps = 6;
  for(let i = 0; i <= steps; i++){
    const phi = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + b * Math.sin(phi), half - b * (1 - Math.cos(phi))));
  }
  for(let i = steps; i >= 0; i--){
    const phi = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + b * Math.sin(phi), -half + b * (1 - Math.cos(phi))));
  }
  pts.push(new THREE.Vector2(0, -half));
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

// a solid wall-plaster patch with a real through-hole for the doorway
// opening — ExtrudeGeometry computes the hole's inner tunnel walls and
// (with bevelEnabled) its rounded rim automatically, which is far more
// reliable than hand-rolling a tube mesh's per-vertex normals
function buildDoorwayPatchGeometry(){
  const shape = new THREE.Shape();
  tracePath(shape, 3.6, 5.6, 0.5);
  const hole = new THREE.Path();
  tracePath(hole, 2.3, 3.6, 0.42);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.6, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, steps: 1,
  });
}

// a small canvas-generated blotch pattern used as a roughness map on
// the plaster surfaces — generated at a low resolution and left to the
// GPU's own linear texture filtering to soften into broad, irregular
// patches (real plaster/concrete has exactly this kind of soft sheen
// variation, not fine-grained noise) rather than an authored roughness
// map this project has no pipeline to produce
function makePlasterRoughnessTexture(){
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for(let i = 0; i < img.data.length; i += 4){
    const v = 150 + Math.random() * 90; // mid-to-high roughness, patchy
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

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
  grad.addColorStop(0, '#fff3df');
  grad.addColorStop(0.3, '#6b5f4e');
  grad.addColorStop(0.65, '#2c2620');
  grad.addColorStop(1, '#0d0a08');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
function makeEdgeVignetteTexture(peakAlpha){
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.72, `rgba(0,0,0,${peakAlpha * 0.35})`);
  grad.addColorStop(1, `rgba(0,0,0,${peakAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
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
    renderer.toneMappingExposure = 1.05;
    this.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0d0a08, 0.052);

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

    const plasterRoughMap = makePlasterRoughnessTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x4a4136, roughness: 0.95, roughnessMap: plasterRoughMap, metalness: 0.02,
    });
    const wallGeo = buildWallGeometry(R, H, -ROOM.wallTheta, ROOM.wallTheta, ROOM.wallSegments);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.receiveShadow = true;
    group.add(wall);

    // polished floor — MeshPhysicalMaterial + a fixed gradient envMap
    // for a soft, subtle sheen (see this file's header for why that's
    // a static texture rather than a live planar-reflection pass)
    const floorMat = new THREE.MeshPhysicalMaterial({
      color: 0x171310, roughness: 0.22, metalness: 0.1,
      clearcoat: 0.35, clearcoatRoughness: 0.3,
      envMap: makeFloorEnvTexture(), envMapIntensity: 0.55,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // a real dome, not a flat ring — see buildDomeGeometry's own header
    const domeGeo = buildDomeGeometry(R, H, ROOM.oculusRadius, ROOM.domeRise, 14, 96);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x2c2620, roughness: 0.95, roughnessMap: plasterRoughMap, metalness: 0, side: THREE.DoubleSide,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.receiveShadow = true;
    group.add(dome);

    // glowing lip where the dome meets the oculus opening, at the
    // dome's own apex height (wallTop + rise), not the wall's height
    const lipMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
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

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.28, metalness: 0.12 });

    // recessed circular platform: a sunken floor disc + a rounded riser
    // dropping down to it, rather than a raised dais
    const pitDepth = 0.22, pitRadius = 2.7;
    const riser = new THREE.Mesh(buildRecessedRiserGeometry(pitRadius, pitDepth, 0.08, 48), stoneMat);
    riser.position.set(0, 0, -2.2);
    riser.receiveShadow = true;
    group.add(riser);
    const pitFloor = new THREE.Mesh(new THREE.CircleGeometry(pitRadius - 0.08, 48), stoneMat);
    pitFloor.rotation.x = -Math.PI / 2;
    pitFloor.position.set(0, -pitDepth, -2.2);
    pitFloor.receiveShadow = true;
    group.add(pitFloor);

    // smooth sculptural stone seat — detail:3 (a heavily-subdivided
    // icosahedron) reads as an eased, smoothed organic form rather
    // than the low-poly faceted boulder this replaces
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x5c5148, roughness: 0.75, metalness: 0.04 });
    const seat = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 3), seatMat);
    seat.scale.set(1.3, 0.62, 1.05);
    seat.position.set(0.15, 0.5 - pitDepth, -2.4);
    seat.rotation.y = 0.6;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    // soft contact shadow under the seat — a decal, not a real shadow
    // map for a second light (see makeShadowDecalTexture's own header)
    const seatShadowMat = new THREE.MeshBasicMaterial({
      map: makeShadowDecalTexture(0.5), transparent: true, depthWrite: false,
    });
    const seatShadow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), seatShadowMat);
    seatShadow.rotation.x = -Math.PI / 2;
    seatShadow.position.set(0.15, -pitDepth + 0.01, -2.4);
    group.add(seatShadow);

    // soft contact shadow where the wall meets the floor, all the way
    // around — a full floor-sized disc with an edge-darkening decal
    // (see makeEdgeVignetteTexture), standing in for a real AO pass
    // at that seam
    const wallContactMat = new THREE.MeshBasicMaterial({
      map: makeEdgeVignetteTexture(0.4), transparent: true, depthWrite: false,
    });
    const wallContact = new THREE.Mesh(new THREE.CircleGeometry(R, 64), wallContactMat);
    wallContact.rotation.x = -Math.PI / 2;
    wallContact.position.y = 0.012;
    group.add(wallContact);

    // hidden LED strip at the base of the wall — a thin continuous
    // emissive ring, unlit (MeshBasicMaterial, no lighting cost) so it
    // reads as a light source rather than a lit surface
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffb37a });
    const led = new THREE.Mesh(new THREE.TorusGeometry(R - 0.05, 0.025, 8, 128), ledMat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.05;
    group.add(led);

    // stepping-stone path from the entrance toward the platform — now
    // a beveled disc (rounded rim) instead of a hard-edged cylinder
    const stonePath = [
      { x: 0.0, z: 7.4 }, { x: 0.55, z: 6.1 }, { x: -0.4, z: 4.8 },
      { x: 0.35, z: 3.5 }, { x: -0.15, z: 2.3 },
    ];
    stonePath.forEach((p) => {
      const stone = new THREE.Mesh(buildBeveledDisc(0.55, 0.16, 0.05, 20), stoneMat);
      stone.position.set(p.x, 0.08, p.z);
      stone.receiveShadow = true;
      stone.castShadow = true;
      group.add(stone);
    });

    // three doorway alcoves: two side (left/right), one center back —
    // each a real carved-through opening (see buildDoorwayPatchGeometry)
    const doorwayThetas = [-ROOM.doorTheta, ROOM.doorTheta, 0];
    doorwayThetas.forEach((theta) => this._buildDoorway(group, theta, wallMat));
  }

  _buildDoorway(group, theta, wallMat){
    const R = ROOM.radius;
    // slightly inside the wall's own nominal radius so this patch's
    // outer face fully occludes the (still-present, unmodified) wall
    // ribbon behind it rather than fighting it for the same depth
    const p = wallPoint(theta, R - 0.08);
    const angle = Math.atan2(p.x, -p.z); // face inward, matches wallPoint's own convention

    const doorGroup = new THREE.Group();
    doorGroup.position.set(p.x, 0, p.z);
    doorGroup.rotation.y = angle;
    group.add(doorGroup);

    const patch = new THREE.Mesh(buildDoorwayPatchGeometry(), wallMat);
    patch.castShadow = true;
    patch.receiveShadow = true;
    doorGroup.add(patch);

    // dark plane at the back of the carved recess, beyond which the
    // fog/darkness reads as "leads somewhere", same trick as before
    // but now sitting behind a real carved opening instead of flush
    // against the wall's own face
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.5), voidMat);
    voidPlane.position.set(0, 1.9, 0.72);
    doorGroup.add(voidPlane);

    // hidden LED strip recessed into the door reveal — now sitting
    // inside the opening's real depth rather than floating flush
    // against a flat plane
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffb37a });
    [-1.05, 1.05].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.4, 0.05), rimMat);
      strip.position.set(x, 1.9, 0.3);
      doorGroup.add(strip);
    });

    const rimLight = new THREE.PointLight(0xffb37a, 3, 5, 2);
    rimLight.position.set(0, 2.1, 0.5);
    doorGroup.add(rimLight);
  }

  _buildLights(){
    // brighter ambient fill than before + several soft, non-shadow-
    // casting point lights standing in for bounced light (floor-ward,
    // doorway-ward) so the room reads as softly, indirectly lit rather
    // than lit by one dominant spotlight — real bounce lighting would
    // need baked lightmaps or a voxel-GI pass this project has no
    // pipeline for (see this file's header)
    const hemi = new THREE.HemisphereLight(0xfff2df, 0x1c150f, 0.62);
    this.scene.add(hemi);

    const spot = new THREE.SpotLight(0xfff2df, 5.5, 22, 0.68, 0.75, 1.2);
    spot.position.set(0, ROOM.height + ROOM.domeRise - 0.3, -1.4);
    spot.target.position.set(0, 0, -2.0);
    spot.castShadow = true;
    const shadowSize = this.isMobile ? CONFIG.shadowSizeMobile : CONFIG.shadowSize;
    spot.shadow.mapSize.set(shadowSize, shadowSize);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 16;
    spot.shadow.bias = -0.0015;
    this.scene.add(spot, spot.target);

    // soft warm bounce off the floor, filling the underside of the
    // dome the way real light reflected up off a pale floor would
    const floorBounce = new THREE.PointLight(0xffdfb0, 1.1, 14, 2);
    floorBounce.position.set(0, 0.6, 2.5);
    this.scene.add(floorBounce);

    // soft fill toward the entrance side, away from the spotlight's
    // own throw, so that half of the room doesn't read as flat-dark
    const entranceFill = new THREE.PointLight(0xfff6ea, 1.1, 16, 2);
    entranceFill.position.set(0, 2.6, 6.5);
    this.scene.add(entranceFill);

    // soft fill low near the platform/seat, reads as light bounced off
    // the recessed pit's own pale stone back up onto the seat
    const seatFill = new THREE.PointLight(0xffe6c2, 0.9, 8, 2);
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
