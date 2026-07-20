/* ===================================================================
   Papi — ProcessRoom (v1 foundation, rebuilt from scratch)
   A simple, mostly-static 3D alcove (Three.js) — the site's hero itself,
   no overlaid step copy — replacing an earlier rotunda-with-oculus room
   that was lit by 8 separate hand-placed
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

   Lighting model (current): still no discrete lights (no point/spot/
   directional of any kind) — one real HDRI (see _buildEnvironment)
   lights the whole room purely through scene.environment (IBL/bounce).
   Each material's own envMapIntensity controls how much of its true PBR
   colour that bounce actually reveals (tuned moderate, not maxed —
   enough to read as real material colour, not so much a rough surface
   like the walls shows the HDRI's own prefiltered mip-chain seams as
   banding, a real artifact hit and fixed earlier this session). Overall
   darkness is a single separate dial: renderer.toneMappingExposure,
   pulled down for a dark, cinematic mood. scene.background is a plain
   flat deep-space colour (a procedural galaxy graphic sat here for a
   while — removed per direct request) — kept fully independent of
   scene.environment so it never touches the actual lighting, only
   what's visible behind it.

   Camera: fixed wide framing, a small continuous push/tilt over the
   whole scroll range (not 4 discrete stops), plus the same mouse-
   parallax lerp used elsewhere on this site. One lighting setup only
   ever has to look right from roughly one angle this way, which is
   what actually makes "soft and even" achievable at all.

   Post-processing: reuses the EffectComposer pipeline already vendored
   this session (js/vendor/examples/jsm/postprocessing/) — RenderPass →
   UnrealBloomPass (selective, high-threshold glow — the traffic light
   is the only thing actually bright enough to trigger it now that
   scene.background is a flat colour rather than a bright starfield) →
   BokehPass (subtle depth-of-field, focus locked to the glass sphere) →
   the combined vignette/filmic-contrast/colour-grade ShaderPass →
   OutputPass. Bloom is desktop only — see _renderFrame's own comment
   for why it's skipped entirely on mobile. The arch's own god-ray +
   suppression passes that used to sit here, and this pass's own film
   grain, are both gone — removed per direct request.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';
import { RGBELoader } from './vendor/examples/jsm/loaders/RGBELoader.js';
import { Reflector } from './vendor/examples/jsm/objects/Reflector.js';
import { mergeVertices } from './vendor/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from './vendor/examples/jsm/postprocessing/BokehPass.js';

const CONFIG = {
  // raised back up after direct feedback that the room read as visibly
  // pixelated/blocky while scrolling or moving — that sluggishness the
  // original 1.15/1.0 cut was chasing turned out to actually be the
  // fixed-lerp-factor choppiness bug (see mouseLerp/progressLerp's own
  // comment below, fixed via dt-correction in _frame()), not raw
  // resolution — so there was real headroom being left on the table.
  // dprCapMobile in particular was capping straight to 1.0 (literally
  // CSS-pixel resolution, one rendered pixel per several real device
  // pixels on any retina phone) which is the single biggest source of
  // blockiness on exactly the hardware most of this feedback has come
  // from. Even if this costs a lower actual frame rate on a heavier
  // scene, the dt-corrected motion above stays smooth regardless — it's
  // a fair trade of headroom for sharpness now that choppiness itself
  // no longer depends on hitting a particular fps
  dprCap: 1.5,
  dprCapMobile: 1.5,
  shadowSize: 1536,
  shadowSizeMobile: 768,
  // this scene's own _frame() ran completely uncapped — every native
  // vsync, unthrottled — which on a 120Hz ProMotion iPhone means the
  // ENTIRE pipeline below (bloom's own full second scene render, the
  // DoF depth pre-pass, real-time water reflection, shadow map,
  // 4x MSAA) runs twice as often as on a plain 60Hz display for zero
  // visual benefit (nothing here moves fast enough to need more than
  // 60, let alone 30, updates a second) — far and away the single
  // biggest lever on the reported "phone gets hot" issue. Desktop is
  // capped too (120Hz monitors are common now), just less aggressively.
  // Mobile raised from an original 30 after that read as visibly
  // choppy — 45 is still a real cut from uncapped (up to 120 on
  // ProMotion) while reading as smooth; the dt-corrected lerp above is
  // what actually fixed the choppiness itself, this is just extra margin
  renderFPS: 60,
  renderFPSMobile: 45,
  // unseen.co's own cursor interaction (checked directly: hovering each
  // corner visibly swings the whole room, mirrored left/right) is a
  // real camera ROTATION driven by cursor position, not a position
  // shift — these are camera.rotateY/rotateX angles (radians), applied
  // on top of the base lookAt orientation each frame, not a lookAt-
  // target offset like the old parallaxMax/parallaxPosMax pair this replaces
  // pulled back further still (from 0.46/0.18/0.3) per direct feedback
  // that both the look-around swing and the scroll-driven camera push
  // still read as too quick/large — this is the magnitude half of that;
  // mouseLerp/progressLerp just below are the speed half
  rotationYawMax: 0.26,
  rotationPitchMax: 0.1,
  parallaxPosMax: 0.16,
  // how quickly the cursor-follow and scroll-driven camera catch up to
  // their own targets each frame — lower is slower/smoother. Slowed
  // down twice now: an initial 0.06/instant-snap pass, then 0.03/0.045,
  // now this — same direct feedback each time, that the room's motion
  // felt too quick/abrupt
  mouseLerp: 0.02,
  progressLerp: 0.03,
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

// ExtrudeGeometry's default UV generator (WorldUVGenerator) maps each
// cap-face vertex's UV straight to its RAW local x/y — not remapped
// into 0..1 texture space. For a wall many units wide/tall (these are
// 14-38 units), that means almost the entire surface's u/v falls
// outside [0,1], and with the default ClampToEdgeWrapping every one of
// those vertices samples the texture's outermost edge pixel instead of
// its own dappled position. The wall's own local x=0 (and y=0) is
// exactly where u/v crosses from "real, unclamped sample" to "clamped
// to the edge" — a hard value jump right at that line, running the
// wall's full height, independent of geometry or lighting (confirmed
// directly: nulling the map removes it; so does this normalization,
// with the map left in place). This rewrites UV to a simple planar x/y
// projection normalized to the wall's own bounds, so every vertex
// samples a real, continuous part of the texture — no clamp boundary
// anywhere on the surface
function normalizeWallUV(geometry, minX, width, height){
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  for (let i = 0; i < posAttr.count; i++){
    uvAttr.setXY(i, (posAttr.getX(i) - minX) / width, posAttr.getY(i) / height);
  }
  uvAttr.needsUpdate = true;
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
    // ACES specifically (not Reinhard/linear) because its highlight
    // rolloff is what lets exposure run brighter without highlights
    // blowing out to flat white. Exposure itself pulled back down to
    // keep the overall mood dark/cinematic now that the HDRI environment
    // (see _buildEnvironment) is doing the actual lighting again — this
    // is the one global dial for "how dark," independent of how much any
    // one material's own envMapIntensity reveals its true colour
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
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
    this._buildChairPile();
    this._buildSpiralStairs();
    this._buildFloatingRock();
    this._buildKeyframes();
    this._buildEnvironment();
    this._buildPostProcessing();

    // displayProgress trails progress (the raw scroll ratio) with its
    // own slow lerp in _frame() — the camera moves through the room on
    // this eased value rather than snapping straight to wherever the
    // scrollbar currently is, per direct feedback that the room's
    // motion felt too quick/abrupt
    this._state = { progress: 0, displayProgress: 0, pinnedLow: false, pinnedHigh: false, rafId: null };

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

    // raised well past the earlier 6.5 per direct request — that height
    // put the wall-top/sky-backdrop transition right at the edge of
    // the camera's own vertical FOV (worked out from the camera's actual
    // distance/pitch range: camStart is ~16 units back with a 45° FOV,
    // which alone shows nearly 7 units of vertical extent above camera
    // height, before the mouse/touch look-around's own upward pitch
    // range adds more on top of that), so the ceiling line was reachable
    // with only a little scroll or look-up. This clears that with real
    // margin at every combination of scroll position and look-around
    const roomWidth = 14, roomHeight = 14, roomDepth = 11;
    const archWidth = 3.6, archHeight = 5.4;

    // light sky-blue plaster — a deliberate departure from the old warm
    // cream, per direct request. No normal map here any more — the
    // patch normal map that used to sit here (a few sine-wave bump
    // patches meant to read as weathered plaster) instead read as small
    // dark "blister" circles under this scene's raking light, which is
    // what prompted removing it rather than retuning it again
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xbfdce6, roughness: 0.92, metalness: 0.02,
      // the diffuse/colour map — a soft dappled-light pattern (see
      // buildDappledShadowMap) rather than a flat colour, so the wall
      // reads as unevenly lit like unseen.co's own plaster does
      map: buildDappledShadowMap(512),
      // moderate, not the 1.0 default — a large, rough, undecorated
      // surface like this one sampling a blurry low mip of the HDRI's
      // prefiltered (PMREM) chain is what exposed that chain's own mip
      // seams as visible soft banding earlier this session (confirmed by
      // zeroing this value and watching the bands vanish). Enough here
      // to genuinely tint the wall with the environment's true bounce
      // colour, not so much that the banding comes back
      envMapIntensity: 0.45,
    });

    // back wall with the main arched opening plus a second, smaller
    // clerestory-style slit to its right. This second sky-slit —
    // narrower, taller, not reaching the floor, set higher on the wall —
    // is the "layered openings" detail unseen.co's own reference
    // composition uses (their smaller window sits beside the main arch
    // at a different height).
    // A real extruded thickness — thin enough not to reintroduce the
    // stray-panel bug (that turned out to be the side walls' own
    // coordinate mapping flipping sign between the two, not this wall's
    // reveal face — see the side-wall shape below), thick enough that
    // the arch/slit read as real carved openings with visible depth
    // rather than paper-thin cutouts as the camera scrolls closer
    const wallThickness = 0.45;
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
    // see normalizeWallUV's own comment — this wall's default UV would
    // otherwise clamp-seam at local x=0/y=0. mergeVertices still runs
    // afterward as ordinary geometry cleanup (it also welds the
    // hole-bridge triangulation's coincident position duplicates)
    let backGeo = new THREE.ExtrudeGeometry(backShape, {
      depth: wallThickness, bevelEnabled: false, curveSegments: 32, steps: 1,
    });
    normalizeWallUV(backGeo, -roomWidth / 2, roomWidth, roomHeight);
    backGeo = mergeVertices(backGeo);
    backGeo.computeVertexNormals();
    const backWall = new THREE.Mesh(backGeo, wallMat);
    // the extrude's own front face (local z = wallThickness) is the one
    // that should sit at the room's actual back plane, so the mesh is
    // pushed back by the extra thickness rather than sitting flush at it
    backWall.position.set(0, 0, -roomDepth / 2 - wallThickness);
    backWall.castShadow = true;
    // NOT receiveShadow — the slit window's own reveal, right where its
    // thin extruded side face meets the wall's front face at a hard
    // near-90° corner, is exactly the kind of geometry self-shadowing
    // struggles with: the shadow map's own depth comparison at a sharp
    // seam like that is what read as a flickering black line as the
    // camera's mouse-parallax subtly shifted frame to frame, and it
    // survived even after adding a fill light because that only raises
    // the floor brightness, it doesn't stop the acne itself. This wall
    // doesn't have anything else casting a meaningfully detailed shadow
    // onto it worth keeping that risk for
    group.add(backWall);

    // two side walls, angled slightly inward — enough to read as a
    // real alcove/niche rather than a flat backdrop. Extended toward
    // the camera (well past the widest camera position) so a wide/
    // ultra-wide viewport's larger horizontal field of view never runs
    // past the wall's own front edge into empty space.
    //
    // The BACK edge is the one that actually has to seal against the
    // back wall, and naively matching it to roomDepth/2+wallThickness
    // (the back wall's own depth) left a real gap: because this wall is
    // ROTATED (π/2-0.18, not a flat 90°), its local length axis doesn't
    // map 1:1 onto world depth — walking back along it drifts INWARD in
    // x at the same time (a sin/cos split), so a length chosen to match
    // the back wall's z-depth actually lands short of the back wall's
    // face in world space, floating in front of it with open background
    // visible through the resulting wedge-shaped gap at the corner. The
    // fix is to walk back far enough that this wall's own end is
    // actually embedded inside the back wall's solid slab (past its far
    // face, not just touching its near face) — solving
    // wallDepth*sin(π/2-0.18) for the local length needed to reach past
    // -(roomDepth/2 + wallThickness*2), with a further margin on top so
    // this holds even as the exact angle/thickness get tuned later
    const sideWallBack = (roomDepth / 2 + wallThickness * 2 + 1) / Math.sin(Math.PI / 2 - 0.18);
    const sideWallFront = 30;
    [-1, 1].forEach((side) => {
      if(side === -1){
        // the actual left wall — the one perpendicular to the back
        // wall the visitor faces on arrival — gets two real glass
        // windows side by side (replacing the single smaller one that
        // used to sit on the back wall itself). Built the same
        // Shape+hole+extrude way as the back wall so each opening gets
        // a real carved reveal. Bottom sits right at the wall's own
        // base (y=0, almost exactly the floor's own height) rather than
        // stopping partway up, so the glass genuinely continues down to
        // meet the water instead of leaving a strip of wall showing
        // underneath — a hole below y=0 would fall outside the wall
        // shape's own bounds entirely (it only exists from y=0 up),
        // which silently breaks the extrude triangulation rather than
        // just clipping, so 0 is the real floor for this, not -0.6.
        // Widened considerably (1.9→2.6) and raised (5.0→5.3) per direct
        // request to see more of the outside landscape through them
        const winW = 2.6, winBottom = 0.05, winTop = 5.3;
        const winCenters = [-1.5, 1.5];
        // this wall's rotation.y sign is the mirror of the plain wall's
        // (-side flips between the two), which also mirrors which end
        // of this same local shape lands in front of vs. behind the
        // back wall in world space — so the large "reach toward camera"
        // extent and the small "seal the back corner" extent have to
        // swap ends here to land in the same world-space places they do
        // on the plain wall below. Getting this backwards was exactly
        // the bug: the 30-unit reach was landing at world z ≈ -29 (deep
        // behind the back wall) instead of ≈ +29 (toward the camera),
        // visible as a stray diagonal panel through the archway
        const sideShape = new THREE.Shape();
        sideShape.moveTo(-sideWallFront, 0);
        sideShape.lineTo(sideWallBack, 0);
        sideShape.lineTo(sideWallBack, roomHeight);
        sideShape.lineTo(-sideWallFront, roomHeight);
        sideShape.closePath();
        winCenters.forEach((winCenterX) => {
          const winHole = new THREE.Path();
          winHole.moveTo(winCenterX - winW / 2, winBottom);
          winHole.lineTo(winCenterX + winW / 2, winBottom);
          winHole.lineTo(winCenterX + winW / 2, winTop);
          winHole.lineTo(winCenterX - winW / 2, winTop);
          winHole.closePath();
          sideShape.holes.push(winHole);
        });
        // same UV clamp-seam risk as the back wall (see
        // normalizeWallUV) — this shape spans local x -sideWallFront..
        // sideWallBack, far past [0,1], so it gets normalized the same
        // way
        let sideGeo = new THREE.ExtrudeGeometry(sideShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 32, steps: 1,
        });
        normalizeWallUV(sideGeo, -sideWallFront, sideWallFront + sideWallBack, roomHeight);
        sideGeo = mergeVertices(sideGeo);
        sideGeo.computeVertexNormals();
        const sideWall = new THREE.Mesh(sideGeo, wallMat);
        sideWall.position.set(side * roomWidth / 2, 0, 0);
        sideWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        sideWall.castShadow = true;
        // NOT receiveShadow — this wall's own local shape reaches from
        // sideWallBack to sideWallFront (30 units), far outside a real
        // shadow-casting light's own shadow-camera frustum. Past that
        // bound, the shadow map has no real data for this surface, and
        // the frustum's own edge — which world position it falls
        // across depends on the light's tilt, not a clean axis-aligned
        // line — showed up as a visible diagonal shadow streak straight
        // across the wall on both side walls, independent of any real
        // caster, the one time a discrete shadow-casting light sat in
        // this room (since removed per direct request)
        group.add(sideWall);
      } else {
        // plain wall, no windows — built with the same asymmetric
        // Shape+extrude bounds as the left wall (rather than a
        // symmetric PlaneGeometry) so its back edge lines up exactly
        // with the back wall's own outer face too
        const plainShape = new THREE.Shape();
        plainShape.moveTo(-sideWallBack, 0);
        plainShape.lineTo(sideWallFront, 0);
        plainShape.lineTo(sideWallFront, roomHeight);
        plainShape.lineTo(-sideWallBack, roomHeight);
        plainShape.closePath();
        const sideGeo = new THREE.ExtrudeGeometry(plainShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 1, steps: 1,
        });
        // same UV clamp-seam risk as the other two walls, even without
        // any holes — this shape alone spans local x -sideWallBack..
        // sideWallFront, still far past [0,1] (see normalizeWallUV)
        normalizeWallUV(sideGeo, -sideWallBack, sideWallBack + sideWallFront, roomHeight);
        const sideWall = new THREE.Mesh(sideGeo, wallMat);
        sideWall.position.set(side * roomWidth / 2, 0, 0);
        sideWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        // see the windowed wall's own comment above — same reasoning
        group.add(sideWall);
      }
    });

    // floor — a REAL reflection now (js/vendor/examples/jsm/objects/
    // Reflector.js, vendored this pass), not just PBR env-map sampling
    // standing in for one. Reflector renders the actual scene from a
    // mirrored virtual camera into its own render target every frame —
    // the sphere, the rock, the walls/arch, the sky through the
    // opening all genuinely show in the water, the way real water
    // reflects its surroundings rather than a material guessing at it
    // via a prefiltered environment map. Built on Reflector's own
    // options.shader hook (rather than its flat default mirror shader)
    // so the existing ripple normal-map distortion and the sphere's own
    // reactive ripple ring both carry over unchanged, just layered on
    // top of a genuine reflection instead of a flat dark colour. The
    // cursor's own directional wake that used to sit here — removed
    // entirely per direct request
    const rippleMap = buildRippleNormalMap(256);
    const waterShader = {
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        rippleMap: { value: rippleMap },
        uRippleOffset: { value: new THREE.Vector2(0, 0) },
        uRippleCenter: { value: new THREE.Vector2(SPHERE_POS.x, SPHERE_POS.z) },
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec2 vUv2;
        varying vec3 vWorldPos;
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vUv2 = uv;
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D rippleMap;
        uniform vec3 color;
        uniform vec2 uRippleOffset;
        uniform vec2 uRippleCenter;
        uniform float uTime;
        varying vec4 vUv;
        varying vec2 vUv2;
        varying vec3 vWorldPos;

        void main() {
          // the same procedural ripple normal map as before (see
          // buildRippleNormalMap), sampled by hand here rather than
          // through a material's own normalMap slot, since this is a
          // fully custom shader now. repeat(3,4) matches what that
          // texture tiles for; uRippleOffset (animated in _frame())
          // replaces the old texture.offset animation, which only
          // auto-applied inside a standard material's own shader chunks
          vec2 rippleUV = vUv2 * vec2(3.0, 4.0) + uRippleOffset;
          vec3 n = texture2D(rippleMap, rippleUV).xyz * 2.0 - 1.0;

          // distort the reflection's own projective UV by that normal —
          // the standard wavy-mirror technique (the same one three.js's
          // own Water.js addon uses): offset scaled by vUv.w since
          // texture2DProj expects un-divided homogeneous coordinates
          vec4 uv = vUv;
          uv.xy += n.xy * 0.028 * uv.w;
          vec3 reflection = texture2DProj(tDiffuse, uv).rgb;

          // fresnel — more reflective at grazing angles, more
          // transparent (showing the dark water colour) looking
          // straight down, the way real water actually behaves.
          // cameraPosition is one of three.js's own automatic shader
          // uniforms, nothing to wire up by hand.
          // Capped lower than a real mirror's own 0.85-0.95 range —
          // right at the horizon, where the wall meets the water, the
          // reflected camera's own frustum is at its least reliable
          // (a known limitation of any bounded planar reflection, not
          // fixable by tuning the reflection render itself), and at
          // fresnel's old max of 0.85 that unreliable grazing sample
          // was trusted almost completely, reading as a stray dark
          // seam right along the base of every wall. Blending in more
          // of the water's own base colour there instead hides it
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          float reflectivity = mix(0.35, 0.6, fresnel);
          vec3 col = mix(color, reflection, reflectivity);

          // the fade toward a plain flat colour near the room's own
          // wall footprint that used to sit here (masking a reflection
          // seam at the wall base) is gone per direct request — it read
          // as the water looking genuinely liquid/reflective in the
          // centre but like one flat solid colour near the edges

          // the sphere's own reactive ripple ring — ported unchanged
          // from the previous version. Faster decay so it fades out
          // within a couple of wavelengths instead of sweeping visibly
          // across the whole floor, low amplitude so it's a hint the
          // water is reacting, not a bold, clearly-circular pattern
          float dist = length(vWorldPos.xz - uRippleCenter);
          float ring = sin(dist * 5.5 - uTime * 2.0) * exp(-dist * 0.65) * smoothstep(0.0, 0.7, dist);
          col += ring * 0.045 * vec3(1.05, 1.0, 0.85);

          gl_FragColor = vec4(col, 1.0);

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    };
    // the side walls angle slightly inward toward the BACK (see below),
    // which means they angle slightly outward toward the camera —
    // wider than roomWidth at their own front edge. A floor sized to
    // exactly roomWidth lined up with the walls at the back but fell
    // short of them at the front, leaving a visible gap of "nothing"
    // between the water's edge and the actual (further out) wall —
    // read as the water cutting off early. Sized generously wider than
    // the room itself so it always reaches past the walls regardless
    // of the angle, with plenty of margin to spare. Reflection render-
    // target resolution kept modest (and lower again on mobile) since
    // Reflector renders the whole scene a second time every frame to
    // produce it — real cost, not worth paying for more sharpness than
    // a background water surface actually needs
    const floor = new Reflector(new THREE.PlaneGeometry(roomWidth * 1.3, roomDepth * 1.6), {
      // raised alongside CONFIG.dprCap/dprCapMobile — the water fills
      // roughly half the frame, so a low-res reflection target read as
      // its own distinct source of blockiness, separate from the canvas
      // resolution itself, especially as the reflected geometry moved
      // during scroll/parallax
      textureWidth: this.isMobile ? 512 : 1024,
      textureHeight: this.isMobile ? 341 : 683,
      multisample: this.isMobile ? 0 : 4,
      // lightened from an original 0x241a10 (a much darker, warm-brown
      // value out of step with the room's own cool blue-gray palette)
      // — also softens the dark seam right at the wall/water horizon
      // now that reflectivity there leans more on this base colour
      // (see the fresnel comment above)
      color: 0x333d47,
      shader: waterShader,
    });
    this.floorRippleUniforms = floor.material.uniforms;
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
    this.floorMesh = floor;
    // Reflector's own onBeforeRender re-renders the whole scene from a
    // mirrored camera into its own texture EVERY time the reflector mesh
    // is drawn — including during BokehPass's separate depth-only scene
    // render (scene.overrideMaterial set) and the selective-bloom pass's
    // own darkened-material render (see _buildPostProcessing). Both of
    // those aren't real colour frames, so left unguarded the reflector's
    // texture kept getting overwritten with a grayscale depth image or an
    // all-black bloom-mask image, which is what showed up as broken
    // banding/lines in the water — confirmed by disabling BokehPass and
    // watching the water reflection go clean again. Skipping the
    // reflection re-render during those passes (this._suppressReflection
    // covers the bloom pass, scene.overrideMaterial covers BokehPass's)
    // leaves the texture holding its last real colour frame instead
    // on mobile the reflection is also only refreshed every other frame
    // — this Reflector re-renders the ENTIRE scene a second time from a
    // mirrored camera whenever it does run, easily this room's single
    // most expensive per-frame cost. Water ripples slowly enough that a
    // reflection one frame stale (at 30fps mobile, ~33ms) is invisible,
    // while halving how often that whole second scene render happens
    this._reflectionFrameCount = 0;
    const originalOnBeforeRender = floor.onBeforeRender.bind(floor);
    floor.onBeforeRender = (renderer, scene, camera, ...rest) => {
      if(scene.overrideMaterial || this._suppressReflection) return;
      if(this.isMobile){
        this._reflectionFrameCount++;
        if(this._reflectionFrameCount % 2 !== 0) return;
      }
      originalOnBeforeRender(renderer, scene, camera, ...rest);
    };

    // hero object — a glass/iridescent sphere (MeshPhysicalMaterial's
    // transmission/iridescence, built into Three.js core, no extra
    // vendoring) as a v1 nod to Papi's own established liquid-glass
    // material (js/hero-slime.js) without porting that raw WebGL shader
    // into a Three.js scene — a closer match is a natural later addition.
    // Half-submerged in the water rather than resting on a plinth, which
    // is why the dark pedestal that used to sit under it is gone
    // attenuationColor/-Distance (real MeshPhysicalMaterial properties
    // for transmissive materials) tint the light passing *through* the
    // glass a cool blue, per direct request — the physically-correct way
    // to brand a transmissive hero object, rather than fighting it with a
    // tinted base colour. Iridescence stays subtle so the blue reads as
    // the dominant colour, with just a hint of oil-slick shift.
    // roughness/transmission both pulled back from an original 0.05/0.92
    // — near-zero roughness meant three.js's own automatic transmission
    // pass (any material with transmission>0 samples the ALREADY-DRAWN
    // scene as its "what's behind the glass" source, with no way to
    // exclude specific objects from that capture) rendered the water's
    // own new real-time reflection through the ball perfectly sharp,
    // showing a distracting, legible ghost of the stairs/floor right on
    // its surface. Three.js's transmission blur already scales with
    // roughness by design, so raising it softens that same capture into
    // a soft glassy haze instead of a sharp, distracting pattern — colour
    // and attenuationDistance both strengthened afterward to keep the
    // ball reading as clearly blue now that less of it is crisp
    // transmission carrying the attenuation tint.
    // iridescence removed entirely (was 0.4) per direct feedback that
    // the ball read as changing colour while scrolling — iridescence is
    // a real physically-based effect that shifts colour with viewing
    // angle by design, and this scene's own scroll-driven camera push
    // plus mouse-parallax constantly changes that angle, so any nonzero
    // value here was always going to read as an unwanted colour shift
    // during exactly the interactions the user described. The blue now
    // comes only from attenuationColor/color, which don't shift with
    // viewing angle
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0x8fd0e8,
      roughness: 0.5,
      metalness: 0,
      transmission: 0.7,
      thickness: 1.2,
      ior: 1.35,
      attenuationColor: 0x1f7fbf,
      attenuationDistance: 0.9,
      iridescence: 0,
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

  // a small spiral staircase in the room's right-back corner, near the
  // second (right) slit window — simple stacked/rotated box treads
  // winding up around a central post, the same low-poly primitive
  // vocabulary as the chairs/pedestal rather than a modelled staircase
  _buildSpiralStairs(){
    const group = new THREE.Group();
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xd6cab0, roughness: 0.8, metalness: 0.04, envMapIntensity: 0.5 });
    const steps = 16;
    const riseStep = 0.24;
    const innerR = 0.28, outerR = 1.3;
    const totalAngle = Math.PI * 2 * 1.4;
    for(let i = 0; i < steps; i++){
      const angle = (i / steps) * totalAngle;
      const y = i * riseStep;
      const treadGeo = new THREE.BoxGeometry(outerR - innerR, 0.1, 0.6, 1, 1, 1);
      const tread = new THREE.Mesh(treadGeo, stepMat);
      const midR = (innerR + outerR) / 2;
      tread.position.set(Math.cos(angle) * midR, y, Math.sin(angle) * midR);
      tread.rotation.y = -angle;
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);
    }
    const postH = steps * riseStep + 0.4;
    // its own material (not stepMat) — the traffic light's pole should
    // read as the same colour as the walls, per direct request, without
    // recolouring the stair treads it also happens to double as
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbfdce6, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.45 });
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(innerR * 0.65, innerR * 0.65, postH, 16),
      poleMat
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
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xbfdce6, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.45 });
    const platformGeo = new THREE.BoxGeometry(platformW, platformH, platformD, 1, 10, 1);
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
    // ten more, continuing to climb higher up the same pile — a tiny
    // deterministic pseudo-random walk (not Math.random, so the pile
    // looks the same on every reload) rather than 10 hand-tuned tuples,
    // with the horizontal spread tapering in as the stack gets taller
    // (a real tossed pile narrows toward its own top)
    const moreColors = [0x8a6a1f, 0x3c3226, 0xb89a5e, 0x241f18, 0x6e5a38, 0x2d2a22, 0x9c7f45, 0x1a1712, 0x54452c, 0xc9ad72];
    let seed = 7;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for(let i = 0; i < 10; i++){
      const h = 0.95 + i * 0.34;
      const spread = Math.max(0.15, 0.75 - i * 0.06);
      chairs.push({
        color: moreColors[i],
        pos: [(rand() - 0.5) * spread * 2, h, (rand() - 0.5) * spread * 2],
        rot: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
      });
    }
    chairs.forEach(({ color, pos, rot }) => {
      const chair = buildChairGroup(color);
      chair.position.set(px + pos[0], platformH + pos[1], pz + pos[2]);
      chair.rotation.set(rot[0], rot[1], rot[2]);
      this.roomGroup.add(chair);
    });
  }

  // a floating rock boulder near the hero sphere, offset to its right —
  // real PBR maps (color/normal/ao/roughness), not a flat material: the
  // stepping-stones texture set already downloaded for the old rotunda
  // room (img/textures/stepping-stones) is a genuinely rocky, cracked
  // stone surface, still sitting unused on disk, so it's reused here
  // rather than sourcing anything new. The geometry itself is a plain
  // IcosahedronGeometry with each vertex pushed out/in by a small
  // deterministic amount along its own normal — enough to break the
  // perfect-icosahedron facets into an irregular, rock-like lump without
  // needing sculpted geometry. aoMap requires its own second UV channel
  // in three.js, hence the uv2 copy. Bobs and slowly tumbles in _frame()
  // so "floating" actually reads as floating, not just suspended
  _buildFloatingRock(){
    const geo = new THREE.IcosahedronGeometry(0.55, 2);
    const pos = geo.attributes.position;
    // IcosahedronGeometry is non-indexed — each triangle owns its own 3
    // position entries, so a shared corner between faces exists as
    // several separate buffer entries that all start at the identical
    // coordinate. A per-entry random bump (a plain incrementing PRNG)
    // gave each of those duplicates a DIFFERENT displacement, tearing
    // the mesh open at every shared edge — the "spiky/shattered/black"
    // result seen in testing. Hashing the bump off the vertex's own
    // (x,y,z) instead makes every duplicate at the same original point
    // resolve to the exact same bump, so the surface stays continuous
    const hash3 = (x, y, z) => {
      const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const v = new THREE.Vector3();
    for(let i = 0; i < pos.count; i++){
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = v.clone().normalize();
      const bump = 1 + (hash3(n.x, n.y, n.z) - 0.5) * 0.36;
      v.copy(n.multiplyScalar(v.length() * bump));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array, 2));

    const loader = new THREE.TextureLoader();
    const colorMap = loader.load('img/textures/stepping-stones/color.jpg');
    colorMap.colorSpace = THREE.SRGBColorSpace;
    const normalMap = loader.load('img/textures/stepping-stones/normal.jpg');
    const aoMap = loader.load('img/textures/stepping-stones/ao.jpg');
    const roughnessMap = loader.load('img/textures/stepping-stones/roughness.jpg');
    const rockMat = new THREE.MeshStandardMaterial({
      map: colorMap, normalMap, aoMap, roughnessMap,
      roughness: 1, metalness: 0, envMapIntensity: 0.6,
    });

    const rock = new THREE.Mesh(geo, rockMat);
    // front-right of the sphere (SPHERE_POS.z = 2.0) — closer to the
    // viewer (larger z, since the camera sits at positive z looking
    // toward -z) and only slightly right, per direct request, rather
    // than the first pass's further-right/further-back placement
    rock.position.set(1.5, 1.25, 3.0);
    rock.rotation.set(0.4, 0.8, 0.2);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.roomGroup.add(rock);
    this.floatingRock = rock;
    this._rockBaseY = rock.position.y;
  }

  // no discrete lights at all — the whole room is lit by one real HDRI
  // (Poly Haven, CC0 — img/hdri/overcast_skylight.hdr, downloaded once
  // this session, nothing fetches from polyhaven.com at runtime) via
  // scene.environment only. scene.background is a plain flat colour —
  // the procedural galaxy graphic that used to sit here (a whole
  // separate canvas-texture generator, well over 100 lines) is removed
  // per direct request; what's visible through the arch/slit is now
  // just a solid deep-space colour rather than a drawn spiral/starfield.
  // Kept independent of scene.environment on purpose, same as before,
  // so this plain colour never touches the room's own lighting/
  // reflections, only what's visible behind it. Overall darkness is
  // controlled globally by renderer.toneMappingExposure (see the
  // constructor); each material's own envMapIntensity (wallMat,
  // floorMat, sphereMat, rockMat, platformMat, poleMat) controls how
  // much of its true colour the HDRI's own bounce reveals
  _buildEnvironment(){
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('img/hdri/overcast_skylight.hdr', (hdrTex) => {
      const envMap = pmrem.fromEquirectangular(hdrTex).texture;
      this.scene.environment = envMap;
      this.scene.background = new THREE.Color(0x05060b);
      hdrTex.dispose();
      pmrem.dispose();
      this._frame();
    });
  }

  // -----------------------------------------------------------------
  // post-processing
  // -----------------------------------------------------------------
  _buildPostProcessing(){
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    // EffectComposer's OWN default render target has no multisampling
    // at all — the renderer's own antialias:true only ever applies to
    // the default framebuffer, and every pass here instead renders into
    // this offscreen target first, so every edge in the whole scene was
    // silently aliased regardless of that renderer flag. Barely visible
    // while the camera was still moving (motion hides it), but plainly
    // jagged/"pixelated" the instant it stopped — a real multisampled
    // target (not a blur/sharpen trick) is the actual fix
    const renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      // 4x MSAA quadruples the fill-rate cost of every pass sharing this
      // target on every edge pixel in the scene — real money on a phone
      // GPU. Off entirely on mobile; motion (this room is barely ever
      // fully static there anyway) hides the aliasing it would otherwise
      // catch
      samples: this.isMobile ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
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

    // selective bloom — a genuinely SEPARATE render/composite (the
    // standard three.js "selective bloom" technique), not just a high
    // threshold on the main frame. First attempt used a plain
    // UnrealBloomPass in the main chain with a high threshold, but the
    // traffic light's own emissiveIntensity is deliberately ramped up to
    // ~2.75 while a lens is "lit" (see _updateTrafficLight) — genuinely
    // brighter than the galaxy core — so no threshold could separate
    // "wanted" bloom (the sky) from "unwanted" bloom (a beam shooting
    // off the light) without also killing the sky's own glow. Instead,
    // every mesh in the scene is temporarily swapped to solid black
    // right before this separate bloom-only render (see _darkenNonBloomed
    // / _restoreMaterial, driven from _renderFrame), leaving only
    // scene.background (the galaxy/stars — not a mesh, unaffected by
    // per-object material swaps) visible to the bloom pass. The traffic
    // light, sphere, walls etc. literally cannot contribute to bloom
    // this way, regardless of how bright their own material gets.
    // (A camera.layers-based version of this — flip the camera to a
    // layer nothing is on, so the renderer skips every mesh's draw call
    // outright instead of swapping materials — measured faster, but a
    // speckled-noise artifact appeared across every surface right after
    // switching to it and didn't fully clear even with bloom disabled
    // outright; never conclusively pinned to that change instead of
    // something else changed the same session, but reverting it was
    // what made the artifact go away, so this keeps the material-swap
    // version despite its real per-frame cost)
    // bloom skipped entirely on mobile — see _renderFrame's own comment.
    // Not built at all there (rather than built-but-never-rendered):
    // an unrendered WebGLRenderTarget holds whatever garbage the GPU
    // happened to have in that memory, not guaranteed black, which
    // bloomMixPass would otherwise be silently adding into every frame
    this.bloomEnabled = !this.isMobile;
    let bloomTextureRef = null;
    if(this.bloomEnabled){
      this._bloomLayer = new THREE.Layers();
      this._bloomLayer.set(1);
      this._darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      this._bloomMaterialsCache = new Map();
      const bloomRenderTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      this.bloomComposer = new EffectComposer(this.renderer, bloomRenderTarget);
      this.bloomComposer.renderToScreen = false;
      this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.2, 0.8);
      this.bloomComposer.addPass(this.bloomPass);
      bloomTextureRef = this.bloomComposer.renderTarget2.texture;
    }

    const bloomMixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: bloomTextureRef },
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
          ${this.bloomEnabled ? 'uniform sampler2D bloomTexture;' : ''}
          varying vec2 vUv;
          void main(){
            vec4 base = texture2D(baseTexture, vUv);
            ${this.bloomEnabled ? 'base += texture2D(bloomTexture, vUv);' : ''}
            gl_FragColor = base;
          }
        `,
      }),
      'baseTexture'
    );
    this.composer.addPass(bloomMixPass);

    // the arch's own god-ray + suppression passes that used to sit here
    // — both screen-space effects tracking the arch's live projected
    // position as the camera moved — removed entirely per direct
    // request: the suppression pass in particular darkened a patch of
    // the room following the camera, which read as an unwanted moving
    // shadow rather than a lighting accent
    this._spherePosVec = new THREE.Vector3(SPHERE_POS.x, SPHERE_POS.y, SPHERE_POS.z);

    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: this.camera.position.distanceTo(this._spherePosVec),
      aperture: this.isMobile ? 0.0006 : 0.0009,
      maxblur: 0.0025,
    });
    // BokehPass's own depth pre-pass is a full second geometry render
    // every frame (needs real per-pixel depth, so it can't take the
    // bloom pass's "skip via camera.layers" shortcut) — the single
    // costliest of this session's additions. The DoF blur itself only
    // ever needs to know roughly how far out of focus something is, not
    // crisp per-pixel depth, so rendering that depth pass at a quarter
    // resolution and letting the bokeh shader's own blur upscale it
    // loses nothing visible while cutting real GPU time. EffectComposer
    // normally drives this pass's own setSize() to match the canvas
    // exactly on every resize; wrapping it here keeps that quarter-scale
    // intact instead
    const bokehDepthScale = this.isMobile ? 0.35 : 0.5;
    const originalBokehSetSize = this.bokehPass.setSize.bind(this.bokehPass);
    this.bokehPass.setSize = (width, height) => {
      originalBokehSetSize(Math.max(1, Math.round(width * bokehDepthScale)), Math.max(1, Math.round(height * bokehDepthScale)));
      this.bokehPass.uniforms.aspect.value = width / height;
    };
    this.composer.addPass(this.bokehPass);
    // BokehShader's own composite pass is a fixed 41 texture samples
    // per pixel with no cheaper path (see its own file) — that fixed
    // cost, at full canvas resolution every frame, is real weight for
    // an effect this subtle to begin with. Skipped outright on mobile,
    // where GPUs are weakest and a few-pixel depth-of-field falloff on
    // a small screen is the least likely detail to be missed
    if(this.isMobile) this.bokehPass.enabled = false;

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
    // film grain removed entirely per direct request — this pass now
    // only ever does vignette + contrast/colour-grade
    const gradePass = new ShaderPass({
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
    });
    this.composer.addPass(gradePass);

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
    if(this.bloomComposer){
      this.bloomComposer.setPixelRatio(dpr);
      this.bloomComposer.setSize(w, h);
    }
  }

  _renderStatic(){
    const { pos, look } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._renderFrame();
    this._updateTrafficLight(0);
    this.canvas.classList.add('is-ready');
  }

  // see this.bloomComposer's own construction comment in
  // _buildPostProcessing — every mesh goes solid black for the
  // duration of this one extra render, leaving only scene.background
  // (not a mesh) as a bloom source
  _darkenNonBloomed(obj){
    if(obj.isMesh && this._bloomLayer && !this._bloomLayer.test(obj.layers)){
      this._bloomMaterialsCache.set(obj.uuid, obj.material);
      obj.material = this._darkMaterial;
    }
  }

  _restoreMaterial(obj){
    const mat = this._bloomMaterialsCache && this._bloomMaterialsCache.get(obj.uuid);
    if(mat){
      obj.material = mat;
      this._bloomMaterialsCache.delete(obj.uuid);
    }
  }

  _renderFrame(){
    // bloom is a genuinely SEPARATE full scene render (see
    // _buildPostProcessing's own comment) — skipped entirely on mobile,
    // where it's the single most expensive thing in this whole pipeline
    // for a subtle glow on a couple of small bright points. bloomMixPass
    // still runs (see below) and just adds nothing, since the render
    // target it reads from was never written to this frame
    if(this.bloomComposer && !this.isMobile){
      this._suppressReflection = true;
      this.scene.traverse((obj) => this._darkenNonBloomed(obj));
      this.bloomComposer.render();
      this.scene.traverse((obj) => this._restoreMaterial(obj));
      this._suppressReflection = false;
    }
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

    // touch used to feed the same look-around parallax as desktop's
    // mouse move, driven by finger position — removed per direct
    // request ("scroll lock, no moving around on mobile"): dragging a
    // finger to scroll was also rotating the camera based on that
    // finger's absolute screen position, reading as the room swinging
    // around unpredictably while just trying to scroll. Mobile now
    // only ever moves through the scroll-driven camera path itself;
    // desktop's mouse-driven swing is unaffected
    if(!this.prefersReducedMotion && !this.isCoarsePointer){
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

  _frame(ts = performance.now()){
    // defaulted — this is also called manually with no argument at all
    // (see _buildEnvironment's own callback, to force an immediate
    // render the moment the HDRI finishes loading rather than waiting
    // for the next rAF tick). Without a real number here, ts was
    // `undefined`, `ts - this._lastRenderTs` came out NaN, and NaN
    // poisoned this.mouse.x/y on the very first such call — every
    // frame after that computed the camera's position from a NaN
    // input, which is a genuinely blank/broken render, not just a
    // wrong one (confirmed by reading camera.position back as NaN)
    this._state.rafId = null;

    // FPS cap — see CONFIG.renderFPS's own comment for why this exists.
    // requestAnimationFrame itself still fires at the display's native
    // rate; skipped ticks just re-schedule without doing any of the
    // actual (expensive) work below
    const interval = 1000 / (this.isMobile ? CONFIG.renderFPSMobile : CONFIG.renderFPS);
    if(this._lastRenderTs && ts - this._lastRenderTs < interval){
      if(this._inView && !this.prefersReducedMotion){
        this._state.rafId = requestAnimationFrame(this._frame.bind(this));
      }
      return;
    }
    // dt in ms since the last frame that actually did work — needed to
    // correct the lerp factors below for frame rate. Clamped so a long
    // gap (tab backgrounded, section scrolled out and back) doesn't
    // produce one huge catch-up jump
    const dt = this._lastRenderTs ? Math.min(ts - this._lastRenderTs, 100) : 16.6667;
    this._lastRenderTs = ts;

    if(!this.prefersReducedMotion){
      // CONFIG.mouseLerp/progressLerp are "fraction of the remaining
      // distance to close per frame" — tuned back when this loop ran
      // essentially every vsync (~16.7ms). Once the FPS cap above
      // started actually skipping frames (30fps mobile especially),
      // the SAME fixed fraction applied only half (or a third) as often
      // per second, so the camera took proportionally longer to catch
      // up to the cursor/scroll AND covered more distance in fewer,
      // larger jumps between the frames that did render — that's what
      // actually read as "choppy," not the lower frame rate by itself.
      // Rescaling the factor by elapsed time keeps the real-world
      // catch-up speed (and the smoothness of the steps getting there)
      // the same no matter how often a frame actually renders
      const mouseFactor = 1 - Math.pow(1 - CONFIG.mouseLerp, dt / 16.6667);
      const progressFactor = 1 - Math.pow(1 - CONFIG.progressLerp, dt / 16.6667);
      this.mouse.x += (this.mouseTarget.x - this.mouse.x) * mouseFactor;
      this.mouse.y += (this.mouseTarget.y - this.mouse.y) * mouseFactor;
      this._state.displayProgress += (this._state.progress - this._state.displayProgress) * progressFactor;

      const { pos, look } = this._cameraForProgress(this._state.displayProgress);
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
    if(this.floatingRock){
      this._rockTime = (this._rockTime || 0) + 0.016;
      this.floatingRock.position.y = this._rockBaseY + Math.sin(this._rockTime * 0.6) * 0.08;
      this.floatingRock.rotation.y += 0.0011;
      this.floatingRock.rotation.x += 0.0006;
    }
    if(this.floorRippleUniforms){
      this.floorRippleUniforms.uRippleOffset.value.x += 0.00035;
      this.floorRippleUniforms.uRippleOffset.value.y += 0.00022;
      this.floorRippleUniforms.uTime.value += 0.016;
    }

    // DoF focus, recomputed every frame since it depends on the live
    // (parallax-shifted) camera, not just the scroll progress
    if(this.bokehPass){
      this.bokehPass.uniforms.focus.value = this.camera.position.distanceTo(this._spherePosVec);
    }

    this._updateTrafficLight(this._state.progress);

    // the title used to fade out early in the scroll (see the git
    // history for the old displayProgress-driven opacity ramp this
    // replaced) — removed per direct request: fading the element out
    // was also fading its own text-shadow glow at a different visual
    // rate than the crisp text underneath it (a blurred shadow reads
    // as "faded enough to vanish" well before the sharper glyph fill
    // does at the same opacity value), which left a faint ghost of the
    // glow hanging in the frame after the letters themselves looked
    // gone. The title now simply stays on screen at full opacity for
    // the whole scroll once its own entrance fade-in finishes.

    this._renderFrame();

    // keep the water/sphere animating on their own every frame while
    // the section is on screen, instead of only advancing in response
    // to a scroll or mousemove event
    if(this._inView && !this.prefersReducedMotion){
      this._state.rafId = requestAnimationFrame(this._frame.bind(this));
    }
  }
}

(function(){
  const section = document.getElementById('processRoom');
  const container = section ? section.querySelector('.process-room-sticky') : null;
  const canvas = document.getElementById('processRoomCanvas');
  if(!section || !container || !canvas) return;

  window.Papi = window.Papi || {};
  const room = new ProcessRoom(section, container, canvas);
  window.Papi.processRoom = room;
})();
