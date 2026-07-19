/* ===================================================================
   Papi — ProcessRoom (v1 foundation, rebuilt from scratch)
   A simple, mostly-static 3D alcove (Three.js) behind the 4 Papi
   process steps (Discover/Design/Develop/Launch), replacing an earlier
   rotunda-with-oculus room that was lit by 8 separate hand-placed
   point lights. That approach never converged on "soft, evenly lit,
   photoreal" no matter how much any single light was tuned, because a
   handful of point lights viewed from 4 very different close-up
   camera positions can't produce that look — the room the camera was
   in front of was always going to look bright somewhere and dark
   somewhere else. Real reference for the feeling being chased here:
   unseen.co's own hero (confirmed to be live WebGL, not a video, by
   inspecting it directly) — one strong, correctly-exposed environment
   map doing almost all the lighting, viewed from a camera that barely
   moves.

   This rewrite is deliberately small — a back wall with one arched
   opening, a reflective floor, one glass hero object on a pedestal —
   not because the final section should stay this simple, but because
   getting the *foundation* (lighting + mood) right on a simple scene
   first, then adding detail in later passes, is the whole point of
   this pass. See /Users/carlossamayoa/.claude/plans/
   delightful-skipping-sunset.md for the full plan this implements.

   Lighting model: scene.environment (+ scene.background, so the arch
   opening itself shows real sky rather than void) from one HDRI
   (Poly Haven, CC0 — img/hdri/bright_sky.hdr, downloaded once, nothing
   fetches from polyhaven.com at runtime) does almost all the actual
   lighting. The one DirectionalLight below exists only because an
   environment map alone can't cast a real-time dynamic shadow — it
   stands in for "the sun this sky belongs to," not a separate light
   source of its own.

   Camera: fixed wide framing, a small continuous push/tilt over the
   whole scroll range (not 4 discrete stops), plus the same mouse-
   parallax lerp used elsewhere on this site. One lighting setup only
   ever has to look right from roughly one angle this way, which is
   what actually makes "soft and even" achievable at all.

   Post-processing: reuses the EffectComposer pipeline already vendored
   this session (js/vendor/examples/jsm/postprocessing/) — RenderPass →
   SSAO → a combined vignette/filmic-contrast/colour-grade ShaderPass →
   OutputPass. Bloom and depth-of-field are deliberately left out of
   this v1 (nothing needs bloom yet with no emissive LED strips in this
   version of the room) — straightforward to add back once the
   foundation itself is confirmed right.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { RGBELoader } from './vendor/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';

const CONFIG = {
  dprCap: 1.5,
  dprCapMobile: 1.15,
  shadowSize: 1536,
  shadowSizeMobile: 768,
  // unseen.co's own cursor interaction (checked directly: hovering each
  // corner visibly swings the whole room, mirrored left/right) is a
  // real camera ROTATION driven by cursor position, not a position
  // shift — these are camera.rotateY/rotateX angles (radians), applied
  // on top of the base lookAt orientation each frame, not a lookAt-
  // target offset like the old parallaxMax/parallaxPosMax pair this replaces
  rotationYawMax: 0.46,
  rotationPitchMax: 0.18,
  parallaxPosMax: 0.3,
};

// the sphere's resting spot — out in the open water rather than tucked
// against the back wall — shared by the sphere's own position, the
// floor's ripple-shader centre, the key light's target, and the camera
// look targets, so everything stays pointed at the same spot. y=0 sits
// the sphere's centre exactly at the water plane — genuinely half
// submerged, not hovering just above the surface — since the opaque
// floor mesh naturally occludes the lower half via normal depth
// testing, no extra clipping trick needed
const SPHERE_POS = { x: 0, y: 0, z: 2.0 };

// one entry per process step — same copy the old room used
const STEPS = [
  { number: '01', title: 'Discover', lines: ['We learn about your brand, goals,', 'and audience.'] },
  { number: '02', title: 'Design', lines: ['Strategic, modern designs that', 'make an impact.'] },
  { number: '03', title: 'Develop', lines: ['Fast, responsive, and built with', 'clean code.'] },
  { number: '04', title: 'Launch', lines: ['Tested, refined, and ready to', 'perform from day one.'] },
];

// traces a rounded-top rectangle into a Shape/Path — cornerRadius equal
// to half the width gives a full arched top rather than a subtly
// rounded corner, which is all that's needed for the wall opening below
function traceArch(path, width, height, cornerRadius){
  const hw = width / 2;
  path.moveTo(-hw, 0);
  path.lineTo(-hw, height - cornerRadius);
  path.quadraticCurveTo(-hw, height, -hw + cornerRadius, height);
  path.lineTo(hw - cornerRadius, height);
  path.quadraticCurveTo(hw, height, hw, height - cornerRadius);
  path.lineTo(hw, 0);
  path.lineTo(-hw, 0);
}

// a wide, thin plane whose TOP edge is displaced into an irregular
// ridge line (a few sine octaves) while the bottom edge stays flat —
// a cheap distant-hill silhouette. Real geometry, not a flat texture,
// so it actually parallaxes as the camera moves and picks up the
// scene's own fog/environment lighting, unlike the flat HDRI background
// sphere the window openings showed before this pass — that's the
// "depth" the openings were missing
function buildHillRidgeGeometry(width, baseHeight, bumpiness, segments, seed, freqScale = 1){
  const geo = new THREE.PlaneGeometry(width, baseHeight, segments, 1);
  const pos = geo.attributes.position;
  for(let i = 0; i < pos.count; i++){
    const x = pos.getX(i);
    const y = pos.getY(i);
    if(y > 0){
      const u = x / width + seed;
      const f = freqScale;
      const ridge = Math.sin(u * 6.0 * f) * 0.5 + Math.sin(u * 13.0 * f + 1.7) * 0.3 + Math.sin(u * 27.0 * f + 4.1) * 0.2;
      pos.setY(i, baseHeight * 0.5 + ridge * bumpiness);
    } else {
      pos.setY(i, -baseHeight * 0.5 - bumpiness);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// shortest signed distance from (x,y) to the boundary of an axis-
// aligned rectangle (cx±halfW, yMin..yMax) — positive outside, negative
// inside. Used below as a cheap stand-in for true distance-to-the-
// arch's-curved-boundary (the rounded top only affects a small area
// right at the corners, not worth a full SDF for)
function distToRectEdge(x, y, cx, halfW, yMin, yMax){
  const lx = x - cx;
  const dx = Math.max(Math.abs(lx) - halfW, 0);
  const dyOut = Math.max(Math.max(y - yMax, 0), Math.max(yMin - y, 0));
  if(dx > 0 || dyOut > 0) return Math.sqrt(dx * dx + dyOut * dyOut);
  const insideDx = halfW - Math.abs(lx);
  const insideDy = Math.min(y - yMin, yMax - y);
  return -Math.min(insideDx, insideDy);
}

// bakes a static per-vertex darkening near a mesh's own contact point
// with the floor (groundLocalY, in the geometry's own local space —
// each mesh's local "floor height" differs depending on how its
// geometry is centred/positioned, so this isn't always 0), fading back
// to full brightness by fadeHeight above it. This is a real, if simple,
// baked ambient-occlusion/contact-shadow: darker right where two
// surfaces meet, exactly where a live AO pass would darken too, but
// computed once up front rather than every frame — no screen-space
// sampling, so no per-frame noise to flicker as the camera moves (the
// reason real-time SSAO got pulled from this scene entirely earlier).
// `openings` (optional) adds a second darkening band right at the edge
// of one or more rectangular holes (the arch/slit) — real reveal depth
// deserves a stronger contact shadow than the flat wall gets, and this
// is what actually darkens right where the wall meets the opening,
// rather than only near the floor. Requires the material to set
// vertexColors:true
function applyGroundAO(geometry, groundLocalY, fadeHeight, strength, openings, edgeBand, edgeStrength){
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for(let i = 0; i < pos.count; i++){
    const x = pos.getX(i), y = pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - groundLocalY) / fadeHeight));
    let shade = 1 - strength * (1 - t);
    if(openings){
      let minDist = Infinity;
      for(const o of openings){
        const d = Math.abs(distToRectEdge(x, y, o.cx, o.halfW, o.yMin, o.yMax));
        if(d < minDist) minDist = d;
      }
      const tEdge = Math.min(1, minDist / edgeBand);
      shade *= 1 - edgeStrength * (1 - tEdge);
    }
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// a small, stylized chair — box seat, box backrest, four cylinder legs —
// built from the same simple-primitive vocabulary as everything else in
// this room (pedestal, hills, sphere), not a detailed model. Returns a
// Group so a whole chair can be positioned/rotated as one unit
function buildChairGroup(color){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 });
  const seatH = 0.46;

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.48), mat);
  seat.position.y = seatH;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.52, 0.05), mat);
  back.position.set(0, seatH + 0.26, -0.215);
  group.add(back);

  [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, seatH, 8), mat);
    leg.position.set(lx, seatH / 2, lz);
    group.add(leg);
  });

  group.traverse((o) => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// bakes a tileable ripple normal map from a few integer-frequency sine
// octaves (analytic derivative, not a finite-difference sample) — every
// term completes a whole number of periods across the tile so it wraps
// seamlessly under RepeatWrapping, no seams at the edges. Scrolling this
// map's offset over time (see _frame) is the standard cheap "flowing
// water" trick: no per-frame CPU redraw, just an animated UV read
function buildRippleNormalMap(size){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const TWO_PI = Math.PI * 2;
  const octaves = [
    { fu: 3, fv: 2, amp: 0.5 },
    { fu: 5, fv: -4, amp: 0.3 },
    { fu: -2, fv: 7, amp: 0.2 },
  ];
  const slope = 0.16; // baked-in bump strength; material.normalScale trims it further
  for(let y = 0; y < size; y++){
    const v = y / size;
    for(let x = 0; x < size; x++){
      const u = x / size;
      let du = 0, dv = 0;
      for(const { fu, fv, amp } of octaves){
        const c = Math.cos(TWO_PI * (fu * u + fv * v)) * amp * slope;
        du += c * fu;
        dv += c * fv;
      }
      let nx = -du, ny = -dv, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      img.data[idx] = (nx * 0.5 + 0.5) * 255;
      img.data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  return tex;
}

// a mostly-flat normal map with a handful of noisy patches baked in at
// fixed spots — not a uniform texture over the whole surface. Most of
// the map stays a perfectly neutral normal (128,128,255 — "point
// straight out, no bump"), and only inside a few soft-edged circular
// patches does fine plaster-like noise appear, fading back to neutral
// at each patch's own edge. Applied once across a wall's full UV range,
// this reads as a few weathered/textured patches on an otherwise clean
// plaster wall, matching real plaster far better than an evenly
// repeated texture would
function buildWallPatchNormalMap(size){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const patches = [
    { cx: 0.22, cy: 0.32, r: 0.16 },
    { cx: 0.7, cy: 0.58, r: 0.14 },
    { cx: 0.48, cy: 0.8, r: 0.11 },
    { cx: 0.85, cy: 0.2, r: 0.1 },
  ];
  for(let y = 0; y < size; y++){
    const v = y / size;
    for(let x = 0; x < size; x++){
      const u = x / size;
      let strength = 0;
      for(const p of patches){
        const d = Math.hypot(u - p.cx, v - p.cy) / p.r;
        if(d < 1) strength = Math.max(strength, 1 - d);
      }
      const idx = (y * size + x) * 4;
      if(strength > 0){
        const nx = (Math.sin(u * 90) + Math.sin(v * 77 + u * 40)) * 0.5;
        const ny = (Math.sin(v * 85) + Math.sin(u * 63 + v * 50)) * 0.5;
        img.data[idx] = 128 + nx * 60 * strength;
        img.data[idx + 1] = 128 + ny * 60 * strength;
      } else {
        img.data[idx] = 128;
        img.data[idx + 1] = 128;
      }
      img.data[idx + 2] = 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// unseen.co's own walls (checked directly) aren't evenly lit — a soft,
// irregular dappled shadow breaks up the plaster, like sunlight through
// unseen foliage or drifting cloud cover. This bakes that as the wall's
// actual diffuse/colour map (assigned to material.map below): mostly a
// flat near-white so it doesn't change the base colour, with a handful
// of soft dark blobs at fixed spots that multiply into whatever the
// material's own `color` is. A cheap, fully static stand-in for real
// dappled light — no projected texture or moving shadow caster needed.
// Neutral black (not a tinted brown) at low opacity — real ambient
// occlusion is always greyscale; colouring it shifts the surface's hue
// instead of just darkening it, which read as the wall's whole colour
// being "off" rather than shadowed. Kept low-opacity and layered per
// standard vertex/texture-AO practice (soft, built-up passes, not one
// strong pass) rather than the much stronger first attempt
function buildDappledShadowMap(size){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const blobs = [
    { x: 0.12, y: 0.18, r: 0.22, d: 0.07 },
    { x: 0.52, y: 0.08, r: 0.16, d: 0.06 },
    { x: 0.33, y: 0.42, r: 0.28, d: 0.08 },
    { x: 0.78, y: 0.3, r: 0.2, d: 0.06 },
    { x: 0.62, y: 0.65, r: 0.24, d: 0.07 },
    { x: 0.18, y: 0.72, r: 0.19, d: 0.06 },
    { x: 0.88, y: 0.82, r: 0.16, d: 0.05 },
    { x: 0.42, y: 0.9, r: 0.15, d: 0.05 },
  ];
  blobs.forEach(({ x, y, r, d }) => {
    const cx = x * size, cy = y * size, rad = r * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(0,0,0,${d})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
    renderer.toneMappingExposure = 1.1;
    this.enabled = true;

    this.scene = new THREE.Scene();
    // faint, far-reaching fog only — depth cue, not a mood-setting haze
    // by itself, but warmed toward brand gold rather than neutral tan so
    // it reinforces the room's colour identity at a distance too
    this.scene.fog = new THREE.FogExp2(0xe6cf9e, 0.012);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
    this.mouse = { x: 0, y: 0 };
    this.mouseTarget = { x: 0, y: 0 };

    this._buildScene();
    this._buildLandscape();
    this._buildLeftHillside();
    this._buildChairPile();
    this._buildSpiralStairs();
    this._buildLights();
    this._buildKeyframes();
    this._buildEnvironment();
    this._buildPostProcessing();

    this._state = { progress: 0, pinnedLow: false, pinnedHigh: false, activeStage: -1, rafId: null };

    this._resize();
    this._bindEvents();
    this._renderStatic();
  }

  // -----------------------------------------------------------------
  // scene
  // -----------------------------------------------------------------
  _buildScene(){
    const group = new THREE.Group();
    this.scene.add(group);
    this.roomGroup = group;

    // tall, but a real, finite height — not stretched so far off-frame
    // that the top edge never reads. The walls are meant to visibly
    // *end*, with real sky (scene.background) showing above them, not
    // just avoid a ceiling line by outrunning the camera indefinitely
    const roomWidth = 14, roomHeight = 6.5, roomDepth = 11;
    const archWidth = 3.6, archHeight = 5.4;

    // warm cream plaster — Papi's own palette (css --cream/--gold-soft),
    // not a literal copy of any reference's colour, matching the rest
    // of this site's warm neutral/gold tone. The patch normal map adds
    // a handful of weathered-looking spots rather than texturing the
    // whole wall uniformly — real plaster reads as mostly smooth with
    // occasional imperfections, not an evenly repeated texture
    // vertexColors:true lets each wall mesh bake its own static ground-
    // contact darkening (see applyGroundAO below) into this one shared
    // material, even though the back wall and side walls are different
    // geometries with different local "floor" heights
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xece0c4, roughness: 0.92, metalness: 0.02, vertexColors: true,
      normalMap: buildWallPatchNormalMap(512), normalScale: new THREE.Vector2(0.7, 0.7),
      // the diffuse/colour map — a soft dappled-light pattern (see
      // buildDappledShadowMap) rather than a flat colour, so the wall
      // reads as unevenly lit like unseen.co's own plaster does
      map: buildDappledShadowMap(512),
    });

    // back wall with the main arched opening plus a second, smaller
    // clerestory-style slit to its right. This second sky-slit —
    // narrower, taller, not reaching the floor, set higher on the wall —
    // is the "layered openings" detail unseen.co's own reference
    // composition uses (their smaller window sits beside the main arch
    // at a different height). Tried this first on the side walls at
    // their true (near-edge-on) angle, but at this camera's ~45° FOV
    // the side walls are only ever a razor-thin sliver in frame — not
    // enough room for a readable window — so it lives on the back wall
    // instead, where it's actually visible across the whole scroll range.
    // The wall itself is now a real ExtrudeGeometry, not a flat
    // Shape+hole: extruding a shape with holes automatically builds the
    // connecting side faces around BOTH the outer boundary and each
    // hole, giving the arch and slit real carved-looking reveals (the
    // 3D edge unseen.co's own openings have) rather than a paper-thin cutout
    const wallThickness = 0.55;
    const backShape = new THREE.Shape();
    backShape.moveTo(-roomWidth / 2, 0);
    backShape.lineTo(roomWidth / 2, 0);
    backShape.lineTo(roomWidth / 2, roomHeight);
    backShape.lineTo(-roomWidth / 2, roomHeight);
    backShape.closePath();
    const archHole = new THREE.Path();
    traceArch(archHole, archWidth, archHeight, archWidth / 2);
    backShape.holes.push(archHole);
    const slitW = 0.9, slitH = 2.6, slitBottom = 3.0, slitCenterX = 3.3;
    const slitHole = new THREE.Path();
    slitHole.moveTo(slitCenterX - slitW / 2, slitBottom);
    slitHole.lineTo(slitCenterX + slitW / 2, slitBottom);
    slitHole.lineTo(slitCenterX + slitW / 2, slitBottom + slitH);
    slitHole.lineTo(slitCenterX - slitW / 2, slitBottom + slitH);
    slitHole.closePath();
    backShape.holes.push(slitHole);
    // a third opening, mirrored onto the LEFT side — unlike the arch
    // and right slit (both open air), this one actually gets a glass
    // pane (see glassMat/glassPane below): see-through, but visibly
    // there, rather than just another hole
    const glassW = 0.9, glassH = 2.6, glassBottom = 3.0, glassCenterX = -3.3;
    const glassHolePath = new THREE.Path();
    glassHolePath.moveTo(glassCenterX - glassW / 2, glassBottom);
    glassHolePath.lineTo(glassCenterX + glassW / 2, glassBottom);
    glassHolePath.lineTo(glassCenterX + glassW / 2, glassBottom + glassH);
    glassHolePath.lineTo(glassCenterX - glassW / 2, glassBottom + glassH);
    glassHolePath.closePath();
    backShape.holes.push(glassHolePath);
    const backGeo = new THREE.ExtrudeGeometry(backShape, {
      depth: wallThickness, bevelEnabled: false, curveSegments: 32, steps: 1,
    });
    // baked ground-contact AO — the back wall's shape was built from
    // y=0 upward, so its own local floor height IS 0 — plus a second,
    // slightly stronger darkening band right at each opening's edge: a
    // real reveal deserves a touch more contact shadow than the flat
    // wall gets. Real AO is subtle (soft, low-strength, built up in
    // layers, per how it's actually done in game/vertex-colour art) —
    // both strengths dialled back hard from the first pass, which read
    // as a flat, too-strong darkening rather than a soft occlusion cue
    applyGroundAO(backGeo, 0, 1.4, 0.14, [
      { cx: 0, halfW: archWidth / 2, yMin: 0, yMax: archHeight },
      { cx: slitCenterX, halfW: slitW / 2, yMin: slitBottom, yMax: slitBottom + slitH },
      { cx: glassCenterX, halfW: glassW / 2, yMin: glassBottom, yMax: glassBottom + glassH },
    ], 0.5, 0.22);
    const backWall = new THREE.Mesh(backGeo, wallMat);
    // the shape's own z=0 plane becomes the FAR face once extruded;
    // shifting back by the full thickness keeps the NEAR face (the one
    // the camera actually sees, and where the reveals open toward the
    // room) exactly where the flat wall used to sit, so nothing else
    // in the room needs to move
    backWall.position.set(0, 0, -roomDepth / 2 - wallThickness);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    group.add(backWall);

    // the actual glass pane filling that third opening — real
    // transmission (see-through, like the sphere's own material) rather
    // than a solid or fully mirrored surface, so the hillside behind it
    // (see _buildLeftHillside) stays clearly visible, just glazed
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf3f6f2, roughness: 0.05, metalness: 0, transmission: 0.94,
      thickness: 0.15, ior: 1.5, envMapIntensity: 1.1,
    });
    const glassPane = new THREE.Mesh(
      new THREE.BoxGeometry(glassW * 0.94, glassH * 0.94, 0.04),
      glassMat
    );
    glassPane.position.set(
      glassCenterX, glassBottom + glassH / 2,
      -roomDepth / 2 - wallThickness / 2
    );
    group.add(glassPane);

    // two side walls, angled slightly inward — enough to read as a
    // real alcove/niche rather than a flat backdrop
    [-1, 1].forEach((side) => {
      // extra height segments purely so applyGroundAO has vertices to
      // interpolate between near the floor — a bare 1-segment plane
      // only has two rows of vertices (top and bottom edge), which
      // would spread the "near-floor" darkening across the ENTIRE wall
      // height instead of staying confined near the ground
      const sideGeo = new THREE.PlaneGeometry(roomDepth, roomHeight, 1, 28);
      // this geometry is centred (local y spans ±roomHeight/2), and the
      // mesh sits at position.y = roomHeight/2, so local y=-roomHeight/2
      // is what maps to the actual floor (world y=0) — unlike the back
      // wall's own geometry, which was already built floor-up from 0
      applyGroundAO(sideGeo, -roomHeight / 2, 1.4, 0.14);
      const sideWall = new THREE.Mesh(sideGeo, wallMat);
      sideWall.position.set(side * roomWidth / 2, roomHeight / 2, 0);
      sideWall.rotation.y = -side * (Math.PI / 2 - 0.18);
      sideWall.receiveShadow = true;
      group.add(sideWall);
    });

    // floor — real (if simple) water rather than a dry mirror-finish
    // material: a procedurally-baked ripple normal map (see
    // buildRippleNormalMap above) perturbs the reflection, scrolled
    // slowly in _frame() for a gentle flowing-water read. The base
    // colour is a deep, near-black warm umber rather than a bright
    // gold-brown — real water's *own* colour is almost always dark
    // (it's mostly transparent/reflective), so a bright flat colour
    // read as solid metal. Keeping the colour dark and leaning on a
    // strong envMapIntensity lets the reflected sky/gold walls/hills
    // supply almost all the visible colour, the same way unseen.co's
    // floor doubles their scene rather than being a flat painted plane
    const rippleMap = buildRippleNormalMap(256);
    this.floorNormalMap = rippleMap;
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x241a10, roughness: 0.1, metalness: 0.05, envMapIntensity: 1.9,
      normalMap: rippleMap, normalScale: new THREE.Vector2(0.18, 0.18),
    });
    // onBeforeCompile patches concentric rings expanding outward from
    // the sphere's own xz position into the compiled shader — real
    // reactive ripples, not just the ambient scrolling ripple map above
    // (which is a uniform texture with no sense of *where* the sphere
    // is). Injected as a brightness modulation right at the end of the
    // fragment shader (after lighting is already resolved) rather than
    // perturbing the lit normal, so it doesn't require getting the
    // view-space/world-space transform of the perturbation exactly
    // right — a bright/dark banded ring reads clearly as "water moving"
    // regardless. smoothstep(...) fades the ring out at dist≈0 so there's
    // no seam directly under the sphere, which sits over it anyway
    floorMat.onBeforeCompile = (shader) => {
      shader.uniforms.uRippleCenter = { value: new THREE.Vector2(SPHERE_POS.x, SPHERE_POS.z) };
      shader.uniforms.uTime = { value: 0 };
      this.floorRippleUniforms = shader.uniforms;
      shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
      );
      shader.fragmentShader = 'varying vec3 vWorldPos;\nuniform vec2 uRippleCenter;\nuniform float uTime;\n' + shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        {
          // faster decay (0.3 → 0.65) so the rings fade out within a
          // couple of wavelengths of the ball instead of sweeping
          // visibly across the whole floor, and a much lower amplitude
          // (0.14 → 0.045) — a subtle hint that the water is reacting,
          // not a bold, clearly-circular ripple pattern
          float dist = length(vWorldPos.xz - uRippleCenter);
          float ring = sin(dist * 5.5 - uTime * 2.0) * exp(-dist * 0.65) * smoothstep(0.0, 0.7, dist);
          gl_FragColor.rgb += ring * 0.045 * vec3(1.05, 1.0, 0.85);
        }
        #include <dithering_fragment>`
      );
    };
    floorMat.customProgramCacheKey = () => 'processRoomFloorRipple';
    this.floorMat = floorMat;
    // the side walls angle slightly inward toward the BACK (see below),
    // which means they angle slightly outward toward the camera —
    // wider than roomWidth at their own front edge. A floor sized to
    // exactly roomWidth lined up with the walls at the back but fell
    // short of them at the front, leaving a visible gap of "nothing"
    // between the water's edge and the actual (further out) wall —
    // read as the water cutting off early. Sized generously wider than
    // the room itself so it always reaches past the walls regardless
    // of the angle, with plenty of margin to spare
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth * 1.3, roomDepth * 1.6), floorMat);
    floor.rotation.x = -Math.PI / 2;
    // the floor plane extends past the back wall's near face (it needs
    // to keep going to be visible through the arch/slit openings), which
    // put it exactly coplanar with the wall's own extruded sill/threshold
    // face at y=0 right at the doorway — two surfaces occupying the same
    // depth read as a flickering seam once the camera started moving
    // this much. Raised a bit further above that danger line than the
    // bare minimum (0.1 rather than staying right at -0.02) to raise
    // the water level itself, not just dodge the z-fighting
    floor.position.set(0, 0.1, roomDepth * 0.05);
    floor.receiveShadow = true;
    group.add(floor);

    // hero object — a glass/iridescent sphere (MeshPhysicalMaterial's
    // transmission/iridescence, built into Three.js core, no extra
    // vendoring) as a v1 nod to Papi's own established liquid-glass
    // material (js/hero-slime.js) without porting that raw WebGL shader
    // into a Three.js scene — a closer match is a natural later addition.
    // Half-submerged in the water rather than resting on a plinth, which
    // is why the dark pedestal that used to sit under it is gone
    // attenuationColor/-Distance (real MeshPhysicalMaterial properties
    // for transmissive materials) tint the light passing *through* the
    // glass gold — the physically-correct way to brand a transmissive
    // hero object, rather than fighting it with a tinted base colour.
    // Iridescence is dialled back from the neutral v1 pass so the gold
    // reads as the dominant colour, with just a hint of oil-slick shift
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0xfaf1de,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.92,
      thickness: 1.2,
      ior: 1.35,
      attenuationColor: 0xd9b872,
      attenuationDistance: 1.4,
      iridescence: 0.4,
      iridescenceIOR: 1.28,
      envMapIntensity: 1.2,
    });
    this.sphereMat = sphereMat;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.85, 64, 64), sphereMat);
    // centred exactly at the water plane — genuinely half submerged,
    // not hovering above it — and the ripple shader below is centred on
    // this same point, so the water actually reads as pushing rings out
    // from where the ball sits in it
    sphere.position.set(SPHERE_POS.x, SPHERE_POS.y, SPHERE_POS.z);
    sphere.castShadow = true;
    group.add(sphere);
    this.sphere = sphere;
  }

  // real geometry beyond the back wall's openings — visible only
  // through the arch/slits (the opaque wall naturally occludes it
  // everywhere else, no masking needed). Pared back to unseen.co's own
  // hill style after their first version read as "too much": unseen's
  // own distant hills (checked directly) are gentle, soft-edged rolling
  // shapes in a close, muted colour family — not a jagged, sharply
  // colour-banded mountain range. Down to two soft layers from five,
  // bumpiness cut way down, and the two colours kept close in hue
  // (a soft warm-to-slightly-paler shift, not a full warm→cool swing)
  _buildLandscape(){
    const layers = [
      { z: -9, width: 32, height: 3.2, bumpiness: 1.1, color: 0xceb488, seed: 0.4, freq: 0.5 },
      { z: -14, width: 40, height: 4.0, bumpiness: 1.5, color: 0xe0d2ae, seed: 2.0, freq: 0.38 },
    ];
    const landscape = new THREE.Group();
    layers.forEach(({ z, width, height, bumpiness, color, seed, freq }) => {
      const geo = buildHillRidgeGeometry(width, height, bumpiness, 48, seed, freq);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0 });
      const hill = new THREE.Mesh(geo, mat);
      hill.position.set(0, 0.4, z);
      landscape.add(hill);
    });
    this.roomGroup.add(landscape);
  }

  // the new glass window sits on the LEFT of the back wall — behind it,
  // one gentle hillside (down from two, same "too much" pass as the
  // main landscape), offset along the same diagonal the left side wall
  // itself recedes on rather than sitting flat-on like the main
  // landscape. The left wall's own rotation carries it inward as it
  // goes back (world x = -roomWidth/2 - 0.1825*worldZ, derived from its
  // own rotation.y = +(π/2-0.18)) — continuing that exact line outward
  // past the room is what makes this hillside read as sharing the same
  // angle/direction as the wall, rather than just placed arbitrarily
  _buildLeftHillside(){
    const hillside = new THREE.Group();
    // the left window sits fairly high on the wall (y 3.0-5.6, same as
    // the right slit), so this still needs to be tall/positioned to
    // reach into that band — but softened (low bumpiness) to match
    // unseen.co's own gentler hill style rather than a jagged peak
    const z = -10, width = 30, height = 6.5, bumpiness = 1.2, y = 1.3, color = 0xd7c19a, seed = 1.6, freq = 0.42;
    const geo = buildHillRidgeGeometry(width, height, bumpiness, 40, seed, freq);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0 });
    const hill = new THREE.Mesh(geo, mat);
    const x = -7 - 0.1825 * z;
    hill.position.set(x, y, z);
    hillside.add(hill);
    this.roomGroup.add(hillside);
  }

  // a small spiral staircase in the room's right-back corner, near the
  // second (right) slit window — simple stacked/rotated box treads
  // winding up around a central post, the same low-poly primitive
  // vocabulary as the chairs/pedestal rather than a modelled staircase
  _buildSpiralStairs(){
    const group = new THREE.Group();
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xd6cab0, roughness: 0.8, metalness: 0.04, vertexColors: true });
    const steps = 16;
    const riseStep = 0.24;
    const innerR = 0.28, outerR = 1.3;
    const totalAngle = Math.PI * 2 * 1.4;
    for(let i = 0; i < steps; i++){
      const angle = (i / steps) * totalAngle;
      const y = i * riseStep;
      const treadGeo = new THREE.BoxGeometry(outerR - innerR, 0.1, 0.6, 1, 1, 1);
      // darken each tread's underside slightly — a cheap stand-in for
      // the contact shadow a real cantilevered stair would cast on the
      // step below it
      applyGroundAO(treadGeo, -0.05, 0.1, 0.18);
      const tread = new THREE.Mesh(treadGeo, stepMat);
      const midR = (innerR + outerR) / 2;
      tread.position.set(Math.cos(angle) * midR, y, Math.sin(angle) * midR);
      tread.rotation.y = -angle;
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);
    }
    const postH = steps * riseStep + 0.4;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(innerR * 0.65, innerR * 0.65, postH, 16),
      stepMat
    );
    post.position.set(0, postH / 2, 0);
    post.castShadow = true;
    group.add(post);
    // right-back corner, close to the slit window (slitCenterX=3.3) —
    // pulled back toward the back wall for the same reason the chair
    // platform sits deep rather than truly close to camera: at this
    // camera's tightest zoom, only a narrow frustum stays in frame, and
    // depth is what buys the lateral room to reach into the corner
    group.position.set(4.0, 0, -5.0);
    this.roomGroup.add(group);

    // a traffic light sits right on top of the post — its own colour
    // cycles red → yellow → green as the visitor scrolls through the 4
    // process steps (see _updateTrafficLight, driven from _frame)
    this._buildTrafficLight(4.0, postH, -5.0);
  }

  // three emissive lenses in a dark housing — red/yellow/green, in that
  // order top-to-bottom like a real traffic light. Built with emissive
  // colour + a low base emissiveIntensity (not zero — even the "off"
  // lenses keep a faint glow, since a real signal lens never reads as
  // fully dead-black) that _updateTrafficLight brightens per-lens as
  // the scroll progress passes through each colour's own zone
  _buildTrafficLight(x, y, z){
    const group = new THREE.Group();
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.55, metalness: 0.25 });
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.24), housingMat);
    housing.position.y = 0.475;
    housing.castShadow = true;
    group.add(housing);

    const lensGeo = new THREE.CircleGeometry(0.095, 24);
    const redMat = new THREE.MeshStandardMaterial({ color: 0x551515, emissive: 0xff2b2b, emissiveIntensity: 0.15, roughness: 0.4 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0x554415, emissive: 0xffcc33, emissiveIntensity: 0.15, roughness: 0.4 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x155520, emissive: 0x33ff66, emissiveIntensity: 0.15, roughness: 0.4 });

    const red = new THREE.Mesh(lensGeo, redMat);
    red.position.set(0, 0.79, 0.125);
    const yellow = new THREE.Mesh(lensGeo, yellowMat);
    yellow.position.set(0, 0.475, 0.125);
    const green = new THREE.Mesh(lensGeo, greenMat);
    green.position.set(0, 0.16, 0.125);
    group.add(red, yellow, green);

    group.position.set(x, y, z);
    this.roomGroup.add(group);
    this.trafficLightMats = { red: redMat, yellow: yellowMat, green: greenMat };
  }

  // red for the first third of the scroll range, yellow through the
  // middle, green for the last third, each fading in/out (not a hard
  // cut) so there's a brief moment where two lenses are both lit,
  // easing between colours the way this whole scene eases everything
  // else — called every frame from _frame(), same as _updateSteps
  _updateTrafficLight(progress){
    if(!this.trafficLightMats) return;
    const bump = (p, center, width) => Math.max(0, 1 - Math.abs(p - center) / width);
    const redA = bump(progress, 0.12, 0.22);
    const yellowA = bump(progress, 0.5, 0.22);
    const greenA = bump(progress, 0.88, 0.22);
    this.trafficLightMats.red.emissiveIntensity = 0.15 + redA * 2.6;
    this.trafficLightMats.yellow.emissiveIntensity = 0.15 + yellowA * 2.6;
    this.trafficLightMats.green.emissiveIntensity = 0.15 + greenA * 2.6;
  }

  // a square plinth in the front-left corner with a whole tossed-
  // together pile of chairs on top, each at its own odd angle — a bit
  // of scattered, lived-in detail against the room's otherwise pared-
  // back geometry, the same way unseen.co's own scenes scatter a rock
  // or a stray prop rather than leaving every surface empty
  _buildChairPile(){
    const platformW = 2.8, platformH = 0.36, platformD = 2.8;
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb2, roughness: 0.85, metalness: 0.03, vertexColors: true });
    const platformGeo = new THREE.BoxGeometry(platformW, platformH, platformD, 1, 10, 1);
    // BoxGeometry is centred, so local y=-platformH/2 is its own base —
    // the same baked ground-contact darkening as the walls, right where
    // the platform actually meets the floor
    applyGroundAO(platformGeo, -platformH / 2, platformH * 0.9, 0.2);
    const platform = new THREE.Mesh(platformGeo, platformMat);
    // near the camera's tightest (scroll-end) framing, this ~45° FOV
    // only keeps roughly the centre third of the floor in frame — an
    // object placed at a truly close-to-camera "corner" gets clipped
    // out well before the scroll finishes. Pushed further left AND
    // further back (deeper toward the back wall) than the first pass —
    // depth buys the extra lateral room needed to reach further into
    // the corner without exiting the frustum at the tightest zoom
    const px = -3.8, pz = -4.8;
    platform.position.set(px, platformH / 2, pz);
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.roomGroup.add(platform);

    // six chairs, each with its own colour, offset, and full XYZ
    // rotation — some seat-up, some tipped on a side or upside down —
    // so the pile reads as tossed together rather than neatly arranged
    const chairs = [
      { color: 0x2a251f, pos: [-0.55, 0.00, 0.35], rot: [0, 0.4, 0] },
      { color: 0xac8a52, pos: [0.35, 0.02, -0.4], rot: [0, -0.8, 1.4] },
      { color: 0x6b5636, pos: [0.55, 0.32, 0.25], rot: [1.3, 0.9, 0.2] },
      { color: 0x1c1916, pos: [-0.3, 0.46, -0.15], rot: [0.3, -1.6, 2.6] },
      { color: 0xd8b978, pos: [0.05, 0.7, 0.5], rot: [2.9, 0.5, -0.6] },
      { color: 0x4a3c26, pos: [-0.65, 0.6, -0.5], rot: [1.9, -0.3, 1.1] },
    ];
    chairs.forEach(({ color, pos, rot }) => {
      const chair = buildChairGroup(color);
      chair.position.set(px + pos[0], platformH + pos[1], pz + pos[2]);
      chair.rotation.set(rot[0], rot[1], rot[2]);
      this.roomGroup.add(chair);
    });
  }

  // real image-based lighting from an actual sky (Poly Haven, CC0),
  // assigned to both scene.environment (every material's own ambient/
  // reflection source) and scene.background (visible through the
  // arch, where nothing else is rendered)
  _buildEnvironment(){
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('img/hdri/bright_sky.hdr', (hdrTex) => {
      const envMap = pmrem.fromEquirectangular(hdrTex).texture;
      this.scene.environment = envMap;
      this.scene.background = envMap;
      hdrTex.dispose();
      pmrem.dispose();
      this._frame();
    });
  }

  _buildLights(){
    // stands in for "the sun this sky belongs to" — an environment map
    // alone can't cast a real-time dynamic shadow, so this is the only
    // discrete light in the scene, a soft, wide, gently-angled source
    // rather than a tight spot, tuned once rather than escalated
    const key = new THREE.DirectionalLight(0xffdca8, 2.4);
    key.position.set(3, 9, 5);
    key.target.position.set(SPHERE_POS.x, 0.5, SPHERE_POS.z);
    key.castShadow = true;
    const shadowSize = this.isMobile ? CONFIG.shadowSizeMobile : CONFIG.shadowSize;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.radius = 3;
    key.shadow.bias = -0.0008;
    // normalBias (offsetting the shadow sample along the surface normal,
    // not just toward the light) is what actually stops shadow acne on a
    // curved surface like the sphere from shimmering as the camera moves
    // — bias alone was tuned for the flat floor/walls and wasn't enough
    // once the camera started moving this much
    key.shadow.normalBias = 0.025;
    this.scene.add(key, key.target);

    // the key light + baked AO alone only account for one direction —
    // a surface facing away from the key light (the underside of the
    // stair treads, the walls' own inward-angled faces, the platform's
    // shaded side) had no sky contribution at all beyond scene.environment's
    // reflections. A HemisphereLight is the standard fix: real ambient
    // light from the sky hits every surface regardless of its facing,
    // tinted by direction — skyColor from directly above (matching the
    // HDRI's own pale tone), groundColor from below (matching the warm
    // gold the floor/walls bounce back up), blended in between by each
    // surface's own normal. This is what actually makes the shading
    // read as coming from "the sky all around," not just one sun angle
    const hemi = new THREE.HemisphereLight(0xd7dde0, 0xb8976a, 0.65);
    this.scene.add(hemi);
  }

  // -----------------------------------------------------------------
  // post-processing
  // -----------------------------------------------------------------
  _buildPostProcessing(){
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // SSAO removed entirely — tuning its minDistance/kernelRadius twice
    // didn't stop the shimmer under the sphere as the camera moved.
    // Screen-space AO recomputes from scratch every frame with no
    // temporal accumulation, so any noise in its sampling pattern reads
    // as a flicker the instant the view moves — inherent to the
    // technique, not something tunable away. The real dynamic shadow
    // (with normalBias) plus the reflective water already ground the
    // sphere without it.

    // one combined vignette + filmic-contrast + colour-grade pass — this
    // is the actual "brand identity" wash: unseen.co's own immersive
    // feeling comes from one strong colour mood laid over otherwise
    // neutral geometry (their dusty pink), so here shadows lean toward
    // ink and highlights lean toward gold (css --ink/--gold), pushed
    // more assertively than the original neutral v1 grade. The contrast
    // curve is computed on a *clamped* copy and blended against the real
    // value rather than applied directly — applying it to unclamped HDR
    // linear colour (legit >1.0 here, before OutputPass's own
    // tonemapping) inverts per-channel above ~1.5 and reads as a
    // rainbow-banded halo around bright surfaces, a real bug hit and
    // fixed in the old room.
    this.composer.addPass(new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        vignetteStrength: { value: 0.3 },
        contrastStrength: { value: 0.26 },
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
          vec3 clamped = clamp(c, 0.0, 1.0);
          vec3 graded = clamped * clamped * (3.0 - 2.0 * clamped);
          c = mix(c, graded, contrastStrength);
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 shadowTint = vec3(0.92, 0.88, 0.86);
          vec3 highlightTint = vec3(1.1, 1.0, 0.8);
          c *= mix(shadowTint, highlightTint, smoothstep(0.12, 0.78, lum));
          vec2 centered = vUv - 0.5;
          float vig = 1.0 - dot(centered, centered) * vignetteStrength;
          c *= vig;
          gl_FragColor = vec4(c, texel.a);
        }
      `,
    }));

    this.composer.addPass(new OutputPass());
  }

  // -----------------------------------------------------------------
  // camera — fixed wide framing, one continuous push/tilt over the
  // whole scroll range rather than 4 discrete stage stops. Widened
  // considerably from the original v1 pass (a 3-unit dolly, 0.25-unit
  // height drop) so the scroll-driven movement actually reads as
  // motion rather than a subtle drift
  // -----------------------------------------------------------------
  _buildKeyframes(){
    this.camStart = new THREE.Vector3(0, 2.1, 10.8);
    this.camEnd = new THREE.Vector3(0, 1.3, 4.8);
    this.lookStart = new THREE.Vector3(0, 1.7, SPHERE_POS.z - 0.1);
    this.lookEnd = new THREE.Vector3(0, 1.25, SPHERE_POS.z + 0.2);
  }

  _cameraForProgress(p){
    const t = p * p * (3 - 2 * p); // smoothstep
    const pos = this.camStart.clone().lerp(this.camEnd, t);
    const look = this.lookStart.clone().lerp(this.lookEnd, t);
    return { pos, look };
  }

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
  }

  _renderStatic(){
    const { pos, look } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._renderFrame();
    this._updateSteps(0);
    this._updateTrafficLight(0);
    this.canvas.classList.add('is-ready');
  }

  _renderFrame(){
    if(this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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

    // the water ripple and sphere rotation used to only advance when
    // _frame() got woken by a scroll or mousemove event, so the water
    // visibly froze the moment the visitor stopped interacting. An
    // IntersectionObserver keeps a real self-scheduling animation loop
    // (see the end of _frame()) running continuously while the section
    // is actually on screen, and stops it once scrolled away so this
    // doesn't keep costing GPU time off-screen
    this._inView = false;
    if('IntersectionObserver' in window){
      this._io = new IntersectionObserver((entries) => {
        this._inView = entries[0].isIntersecting;
        if(this._inView) this._wake();
      }, { rootMargin: '300px 0px' });
      this._io.observe(this.section);
    } else {
      this._inView = true;
      this._wake();
    }
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

    this._state.progress = Math.max(0, Math.min(1, raw));
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
      // a small position shift for depth-parallax, plus — the actual
      // unseen.co effect, confirmed by hovering their own corners
      // directly — a real camera ROTATION on top, not another lookAt
      // re-aim. lookAt first establishes the base orientation toward
      // `look`, then rotateY/rotateX turn the camera further from
      // there, exactly the way turning your head to follow the cursor
      // would, which is why it reads as the room swinging around you
      // rather than a subtle drift
      this.camera.position.set(
        pos.x + this.mouse.x * CONFIG.parallaxPosMax,
        pos.y - this.mouse.y * CONFIG.parallaxPosMax * 0.5,
        pos.z
      );
      this.camera.lookAt(look);
      this.camera.rotateY(-this.mouse.x * CONFIG.rotationYawMax);
      this.camera.rotateX(this.mouse.y * CONFIG.rotationPitchMax);
    } else {
      const { pos, look } = this._cameraForProgress(0);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
    }

    if(this.sphere) this.sphere.rotation.y += 0.0018;
    if(this.floorNormalMap){
      this.floorNormalMap.offset.x += 0.00035;
      this.floorNormalMap.offset.y += 0.00022;
    }
    if(this.floorRippleUniforms) this.floorRippleUniforms.uTime.value += 0.016;

    this._updateSteps(this._state.progress);
    this._updateTrafficLight(this._state.progress);
    this._renderFrame();

    // keep the water/sphere animating on their own every frame while
    // the section is on screen, instead of only advancing in response
    // to a scroll or mousemove event
    if(this._inView && !this.prefersReducedMotion){
      this._state.rafId = requestAnimationFrame(this._frame.bind(this));
    }
  }

  _updateSteps(progress){
    const count = this.stepEls ? this.stepEls.length : STEPS.length;
    const stage = Math.min(count - 1, Math.floor(progress * count));
    if(stage === this._state.activeStage) return;
    this._state.activeStage = stage;
    if(!this.stepEls) return;
    this.stepEls.forEach((el, i) => el.classList.toggle('is-active', i === stage));
    this.dotEls.forEach((el, i) => el.classList.toggle('is-active', i === stage));
  }
}

(function(){
  const section = document.getElementById('processRoom');
  const container = section ? section.querySelector('.process-room-sticky') : null;
  const canvas = document.getElementById('processRoomCanvas');
  const stepsWrap = document.getElementById('processRoomSteps');
  if(!section || !container || !canvas) return;

  window.Papi = window.Papi || {};
  const room = new ProcessRoom(section, container, canvas);
  if(stepsWrap){
    room.stepEls = Array.from(stepsWrap.querySelectorAll('.process-room-step'));
    room.dotEls = Array.from(section.querySelectorAll('.process-room-dot'));
  }
  window.Papi.processRoom = room;
})();
