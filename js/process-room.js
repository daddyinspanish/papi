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

   Camera: a real 4-stop journey now (per direct request) — one stop
   per process step, each framing the object that step is tied to (see
   _buildKeyframes) — eased between stops with smoothstep rather than
   snapping, plus the same mouse-parallax lerp used elsewhere on this
   site. Originally a single continuous push between two points, kept
   deliberately simple so one lighting setup only had to look right
   from roughly one angle; four stops asks more of the lighting, but
   the same HDRI-only setup still holds up reasonably well across all
   four since none of them stray far from the room's own centre.

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
  // total scroll distance for the whole Section 1 experience, as a
  // multiple of the viewport height — GSAP ScrollTrigger (see
  // _bindScrollTrigger) pins .process-room-sticky and reserves exactly
  // this much scroll room itself at pin time, always measured off the
  // REAL current viewport, so there's no separate CSS height to keep in
  // sync with it (the old --stable-vh/sticky-release-timing class of
  // bugs this used to have is gone along with that whole mechanism).
  // Raised from 4.4 to fit the dissolve phase (see dollyEnd below) IN
  // the same pin as the journey+dolly, rather than handing off to a
  // second, unpinned trigger the way this used to work — matching
  // unseen.co's own technique (confirmed by inspecting their site
  // directly) of one persistent, never-moving canvas that dissolves to
  // reveal the next page underneath it, rather than a canvas that
  // itself scrolls away. journeyEnd/dollyEnd are rescaled so the
  // journey+dolly's own real scroll DISTANCE stays exactly what it was
  // at 4.4 — only the dissolve's own 1.0-viewport-height budget is new
  scrollMultiplier: 5.4,
  // fraction of the pin's own scrub spent on the 5-stop camera journey
  // (wide shot + 4 process steps) before the forward-dolly hold takes
  // over (see _cameraForProgress's own dollyT)
  journeyEnd: 0.603,
  // fraction where the forward dolly finishes and the dissolve itself
  // begins — camera holds still from here on (already parked at
  // revealCameraPos/Look via dollyT reaching 1); everything from here
  // to progress 1.0 is _frame's own differential material fade
  // (structure slow, props fast — see each mesh's own userData.fadeGroup)
  // plus the Section 2 ghost preview fading in underneath (see
  // _buildSection2Ghost)
  dollyEnd: 0.815,
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
    // the fade/scale target for the reveal phase — NOT this.container
    // itself, which GSAP ScrollTrigger pins directly (see
    // _bindScrollTrigger); see this element's own comment in index.html
    this.visual = container.querySelector('.process-room-visual');
    this.grainEl = container.querySelector('.process-room-grain');
    this.canvas = canvas;
    this.enabled = false;

    this.prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.isCoarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this.isMobile = window.innerWidth < 860;

    let renderer;
    try{
      // alpha:true — needed for the Section 1 → Section 2 dissolve (see
      // _bindScrollTrigger/_frame's own dissolve block): the canvas's
      // own backing framebuffer has no alpha channel at all without
      // this, so no amount of fading a material's opacity or nulling
      // scene.background could ever make it read as transparent — the
      // browser just paints whatever the RGB channels computed to,
      // opaque, regardless. Harmless outside the dissolve: nothing else
      // in this scene is ever transparent, so clearAlpha stays 1 and
      // the canvas looks identical to before everywhere else
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
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

    // the process-step popup text (see _updateProcessStep) and the
    // neon-sign quick nav (visible only during stage 0 — see the same
    // method) — queried once here rather than every frame; missing
    // gracefully no-ops everywhere either is read below
    this.stepEl = document.getElementById('processStep');
    this.stepNumberEl = document.getElementById('processStepNumber');
    this.stepLabelEl = document.getElementById('processStepLabel');
    this.neonMenuEl = document.getElementById('processNeonMenu');
    this._lastStageIndex = -1;

    this._buildScene();
    this._buildChairPile();
    this._buildSpiralStairs();
    this._buildRocket();
    this._buildKeyframes();
    this._buildEnvironment();
    this._buildPostProcessing();

    // displayProgress trails progress (the raw scroll ratio) with its
    // own slow lerp in _frame() — the camera moves through the room on
    // this eased value rather than snapping straight to wherever the
    // scrollbar currently is, per direct feedback that the room's
    // motion felt too quick/abrupt
    this._state = { progress: 0, displayProgress: 0, rafId: null };
    // whether the GSAP pin (see _bindScrollTrigger) has genuinely
    // released — see _applyDissolve's own comment for exactly why this
    // exists and what bug it fixes
    this._pinReleased = false;

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
      // transparent:true (opacity stays 1 normally, so this looks
      // identical to before at rest) — needed so the Section 1 →
      // Section 2 dissolve (see _bindScrollTrigger/_frame) can actually
      // fade this material's opacity; "structure" (walls, floor,
      // platform) is the SLOW-fading group in that dissolve, meant to
      // linger and ghost through longer than props like the sphere/
      // chairs/rocket, the same way unseen.co's own architecture
      // outlasts the rest of their scene during their own transition
      transparent: true,
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
    backWall.userData.fadeGroup = 'structure';
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
        sideWall.userData.fadeGroup = 'structure';
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
        sideWall.userData.fadeGroup = 'structure';
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
        // Reflector's own default shader hard-codes alpha to 1.0 — fine
        // normally (the floor is never meant to be see-through during
        // regular viewing), but the Section 1 → Section 2 dissolve (see
        // _bindScrollTrigger/_frame's own differential fade) needs the
        // floor — "structure", same slow-fade group as the walls — to
        // actually go transparent along with everything else. This is
        // OUR OWN shader (not a vendored file), so wiring in a real
        // opacity uniform is a plain, contained addition
        opacity: { value: 1.0 },
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
        uniform float opacity;
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

          gl_FragColor = vec4(col, opacity);

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
    floor.material.transparent = true;
    floor.userData.fadeGroup = 'structure';
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
    sphere.userData.fadeGroup = 'props';
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
    // "props" — the fast-fading group in the Section 1 → Section 2
    // dissolve (see _bindScrollTrigger/_frame), stamped onto every mesh
    // in this group at once rather than tagged one-by-one
    group.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
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
    // layer 1 is what actually feeds the selective-bloom pass (see
    // _buildPostProcessing's own _bloomLayer/_darkenNonBloomed) — never
    // called here despite the bloom pass's own build-time comment
    // describing these lenses as "the only thing bright enough to
    // trigger it," a real gap only found while wiring the same bloom
    // layer onto the crystal for its own new emissive glow
    red.layers.enable(1);
    yellow.layers.enable(1);
    green.layers.enable(1);
    group.add(red, yellow, green);

    group.position.set(x, y, z);
    group.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
    this.roomGroup.add(group);
    this.trafficLightMats = { red: redMat, yellow: yellowMat, green: greenMat };
  }

  // red for the first third of the scroll range, yellow through the
  // middle, green for the last third, each fading in/out (not a hard
  // cut) so there's a brief moment where two lenses are both lit,
  // easing between colours the way this whole scene eases everything
  // else — called every frame from _frame(), same as _updateProcessStep
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

  // the step-number/label popup, synced to the same `seg` (0..3
  // continuous) the camera's own _cameraForProgress interpolates over
  // — "nearest" is whichever of the 4 stages seg is currently closest
  // to, and opacity falls off the further seg drifts from that whole
  // number, reaching zero exactly at the midpoint to the next stage.
  // That's deliberate: the text content only ever gets swapped at the
  // one moment its own opacity is already at its lowest (see below),
  // so the "pop" reads as one label fading out and the next popping
  // back in, never a visible jump-cut mid-fade
  _updateProcessStep(seg){
    if(!this.stepEl || !this.stages) return;
    const last = this.stages.length - 1;
    const nearest = Math.max(0, Math.min(last, Math.round(seg)));
    if(nearest !== this._lastStageIndex){
      this._lastStageIndex = nearest;
      const stage = this.stages[nearest];
      // stage 0's own label is null — it's the wide establishing shot,
      // not a numbered process step, so it gets a welcome line instead
      // of "00"/a step name, reusing the exact same two elements (and
      // the same crossfade below) rather than a separate DOM structure
      if(stage.label === null){
        if(this.stepNumberEl) this.stepNumberEl.textContent = 'Welcome';
        if(this.stepLabelEl) this.stepLabelEl.textContent = 'Scroll to proceed';
      } else {
        if(this.stepNumberEl) this.stepNumberEl.textContent = String(nearest).padStart(2, '0');
        if(this.stepLabelEl) this.stepLabelEl.textContent = stage.label;
      }
    }
    const dist = Math.abs(seg - nearest);
    // fully opaque within a small window right at the stage itself,
    // smoothstep-fading to 0 by dist===0.5 (the exact midpoint to the
    // neighbouring stage, where the text swap above happens)
    const fadeStart = 0.12, fadeEnd = 0.5;
    const raw = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
    const opacity = 1 - raw * raw * (3 - 2 * raw);
    this.stepEl.style.opacity = opacity.toFixed(3);
    this.stepEl.style.transform = `translateX(-50%) translateY(${((1 - opacity) * 12).toFixed(1)}px)`;

    // the neon menu shares stage 0's own fade, but only ever fades OUT
    // as seg leaves 0 — it has no "neighbouring stage" of its own to
    // fade back in for, unlike the step text above, so this uses seg
    // itself (distance from the wide shot specifically) rather than
    // `dist` (distance from whichever stage is nearest right now)
    if(this.neonMenuEl){
      const menuRaw = Math.max(0, Math.min(1, (seg - fadeStart) / (fadeEnd - fadeStart)));
      const menuOpacity = 1 - menuRaw * menuRaw * (3 - 2 * menuRaw);
      this.neonMenuEl.style.opacity = menuOpacity.toFixed(3);
      this.neonMenuEl.style.pointerEvents = menuOpacity > 0.5 ? 'auto' : 'none';
    }
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
    platform.userData.fadeGroup = 'structure';
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
      chair.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
      this.roomGroup.add(chair);
    });
  }

  // a floating crystal, suspended in the arch doorway (see its own
  // material comment below for why it's a crystal now rather than the
  // rough-stone PBR surface this used to be). The geometry itself is a
  // plain IcosahedronGeometry with each vertex pushed out/in by a small
  // deterministic amount along its own normal — enough to break the
  // perfect-icosahedron facets into an irregular, gem-cut-like lump
  // without needing sculpted geometry; that same faceting is what a
  // transmissive material actually wants to catch distinct highlights
  // on (see the material comment). Bobs and slowly tumbles in _frame()
  // so "floating" actually reads as floating, not just suspended
  _buildRocket(){
    // a rocket ship now, not a crystal — per direct request. Floats in
    // place in the arch doorway (no throw-at-camera behaviour at all
    // any more; that whole mechanic is gone, see _bindScrollTrigger's
    // own reveal phase for how Section 1 → Section 2 works instead), a
    // simple classic silhouette built from primitives: a tapered hull,
    // a nose cone, three fins, and a two-layer additive-blended flame
    // at the base standing in for thruster exhaust.
    const rocket = new THREE.Group();

    // body/nose/fins share one material — a plain painted-metal hull,
    // not a glowing/transmissive one, so the neon stripe and flame
    // below actually read as the light-emitting parts against it
    const hullMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef2f7,
      metalness: 0.55,
      roughness: 0.32,
      envMapIntensity: 1.2,
    });
    this.rocketHullMat = hullMat;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 20), hullMat);
    body.castShadow = true;
    body.receiveShadow = true;
    rocket.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 20), hullMat);
    nose.position.y = 0.6; // body top (0.4) + half the nose's own height (0.2)
    nose.castShadow = true;
    rocket.add(nose);

    // neon accent ring — the same blue-glass identity family the
    // crystal it replaces used to carry, so the rocket still reads as
    // part of this world rather than a generic model dropped in.
    // layers.enable(1) is what actually feeds the selective-bloom pass
    // (see _buildPostProcessing) — plain colour/emissive alone doesn't
    // bloom on its own, same gap already fixed for the traffic light's
    // own lenses
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x2f9dff,
      emissive: 0x2f9dff,
      emissiveIntensity: 1.4,
      metalness: 0,
      roughness: 0.4,
    });
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 20), stripeMat);
    stripe.position.y = -0.05;
    stripe.layers.enable(1);
    rocket.add(stripe);

    // fins — three flattened wedges at the base, spaced 120° apart,
    // flared outward
    const finGeo = new THREE.BoxGeometry(0.03, 0.32, 0.26);
    for(let i = 0; i < 3; i++){
      const fin = new THREE.Mesh(finGeo, hullMat);
      const angle = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(angle) * 0.22, -0.32, Math.sin(angle) * 0.22);
      fin.rotation.y = -angle;
      fin.rotation.z = 0.35;
      fin.castShadow = true;
      rocket.add(fin);
    }

    // flame — two stacked, apex-down cones (a broader warm-orange outer
    // layer, a smaller hot yellow-white core), additive-blended and
    // depthWrite:false so they read as glowing light overlapping the
    // hull rather than a flat-shaded solid object. openEnded (true) on
    // both drops the flat circular cap a closed cone would otherwise
    // render at the wide end, which would read as a solid disc rather
    // than an open flare. Scale/opacity flicker is animated per-frame
    // in _frame() (see this.rocketFlameOuter/Inner)
    const flameOuterMat = new THREE.MeshBasicMaterial({
      color: 0xff7a1a,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 16, 1, true), flameOuterMat);
    flameOuter.rotation.x = Math.PI; // flip so the wide base sits at the hull, apex trailing down/away
    flameOuter.position.y = -0.4 - 0.25;
    flameOuter.layers.enable(1);
    rocket.add(flameOuter);

    const flameInnerMat = new THREE.MeshBasicMaterial({
      color: 0xffe27a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 16, 1, true), flameInnerMat);
    flameInner.rotation.x = Math.PI;
    flameInner.position.y = -0.4 - 0.16;
    flameInner.layers.enable(1);
    rocket.add(flameInner);

    // floating centred in the arch doorway itself — archWidth/archHeight
    // are 3.6/5.4 (see _buildScene), so y=2.7 is the opening's own true
    // vertical centre; z sits inside the back wall's own thickness (the
    // wall's front face is at -roomDepth/2, its back face wallThickness
    // further at -roomDepth/2-wallThickness) rather than flush with
    // either face, so it reads as genuinely suspended inside the
    // doorway rather than resting on either side of it
    rocket.position.set(0, 2.7, -5.7);
    rocket.rotation.y = 0.5;
    rocket.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
    this.roomGroup.add(rocket);
    this.rocket = rocket;
    this.rocketFlameOuter = flameOuter;
    this.rocketFlameInner = flameInner;
    this._rocketBaseY = rocket.position.y;
    this._rocketTime = 0;
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
  // floorMat, sphereMat, rocketHullMat, platformMat, poleMat) controls how
  // much of its true colour the HDRI's own bounce reveals
  _buildEnvironment(){
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('img/hdri/overcast_skylight.hdr', (hdrTex) => {
      const envMap = pmrem.fromEquirectangular(hdrTex).texture;
      this.scene.environment = envMap;
      // scene.background left null on purpose (was a plain THREE.Color
      // here) — a non-null background paints directly over every "empty"
      // pixel (nothing else drawn there), completely overriding the
      // renderer's own clear colour/alpha for them regardless of what
      // either is set to. The Section 1 → Section 2 dissolve (see
      // _applyDissolve) needs those pixels to actually go transparent as
      // it progresses, which only renderer.setClearAlpha can do — so the
      // SAME visual (that deep-space colour, visible through the arch)
      // now comes from renderer.setClearColor/setClearAlpha instead,
      // which _applyDissolve can vary over time and a plain Color never
      // could
      this.renderer.setClearColor(0x05060b, 1);
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
            // rgb only — the bloom pass's own render target is the
            // DARKENED scene (every non-bloom mesh swapped to solid
            // opaque black, see _darkenNonBloomed), so its alpha is 1.0
            // across nearly the whole frame regardless of what the real
            // scene is doing. Adding the FULL vec4 (base += bloomTexture)
            // was quietly adding that stray alpha into the final output
            // too — invisible as long as the renderer was always fully
            // opaque anyway, but a real bug once the Section 1 → 2
            // dissolve (js/process-room.js's own _bindScrollTrigger)
            // needs the alpha channel to actually mean something: it
            // would have clamped most of the frame back to opaque no
            // matter how transparent the real materials/background had
            // faded to, everywhere bloom was contributing
            ${this.bloomEnabled ? 'base.rgb += texture2D(bloomTexture, vUv).rgb;' : ''}
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
  // camera — a real 4-stop journey through the room now, per direct
  // request, one stop per process step, each framing the object that
  // step is tied to: the sphere (Discover), the spiral stairs (Plan),
  // the chair pile (Structure), the floating rock (Delivery). Replaces
  // the previous single continuous push between two points — this is
  // 4 waypoints with smoothstep easing between each consecutive pair,
  // which is what actually produces the "settle at each stop" feel:
  // smoothstep's own derivative goes to zero at both ends of a
  // segment, so the camera visibly slows into and out of every
  // waypoint rather than cruising past it at constant speed. See
  // _updateProcessStep for how the step text syncs to this same path.
  // -----------------------------------------------------------------
  _buildKeyframes(){
    this.stages = [
      { // 0 — the establishing shot: pulled back wide enough to read
        // the whole room in one frame (sphere, both back corners, the
        // arch) rather than opening already tight on the sphere, per
        // direct request. label:null marks this one as the "Welcome"
        // intro rather than a numbered process step — see
        // _updateProcessStep for how that's handled
        pos: new THREE.Vector3(0, 2.6, 11.5),
        look: new THREE.Vector3(0, 1.8, -1.0),
        label: null,
      },
      { // 1 — Discover: the glass sphere, dead centre in the water
        pos: new THREE.Vector3(0, 1.3, 4.8),
        look: new THREE.Vector3(0, 1.25, SPHERE_POS.z + 0.2),
        label: 'Discover',
      },
      { // 2 — Plan: the spiral stairs, back-right corner
        pos: new THREE.Vector3(2.6, 2.1, 1.4),
        look: new THREE.Vector3(4.0, 2.2, -4.4),
        label: 'Plan',
      },
      { // 3 — Structure: the tossed chair pile, back-left corner
        pos: new THREE.Vector3(-2.4, 2.1, 1.4),
        look: new THREE.Vector3(-3.8, 1.6, -4.2),
        label: 'Structure',
      },
      { // 4 — Delivery: the floating rocket, suspended dead-centre in
        // the arch doorway — camera comes back to centre for this one
        // (unlike the off-axis Plan/Structure stops) so the room's own
        // symmetry frames it, the same way stage 1 frames the sphere
        pos: new THREE.Vector3(0, 2.0, 2.2),
        look: new THREE.Vector3(0, 2.6, -5.6),
        label: 'Delivery',
      },
    ];
    // where the camera dollies to during the forward-dolly hold (see
    // _cameraForProgress's own dollyT) — a modest further push forward
    // from stage 4's own pos (z 2.2 → 1.0, a gentle rise 2.0 → 2.2),
    // same look target, kept comfortably short of the platform/stepping-
    // stones nearer mid-room so it never dollies through geometry. The
    // camera holds still here (dollyT stays at 1) through the whole
    // dissolve that follows — the room fading out from around it is what
    // carries the rest of the "moving into Section 2" read from here
    this.revealCameraPos = new THREE.Vector3(0, 2.2, 1.0);
    this.revealCameraLook = new THREE.Vector3(0, 2.6, -5.6);
  }

  _cameraForProgress(p){
    const stages = this.stages;
    const last = stages.length - 1;
    const clampedP = THREE.MathUtils.clamp(p, 0, 1);
    // the 5-stop journey itself only ever plays out across
    // [0, CONFIG.journeyEnd] of the pin's own scrub — journeyP remaps
    // that sub-range back to a plain 0..1 so the rest of this function
    // doesn't need to know journeyEnd exists at all. Clamping to 1
    // (rather than letting it run past) is what actually holds the
    // journey at stage 4's own framing once dollyT (below) takes over
    const journeyP = Math.min(clampedP, CONFIG.journeyEnd) / CONFIG.journeyEnd;
    const seg = journeyP * last;
    const i = Math.min(last - 1, Math.floor(seg));
    const localT = seg - i;
    const t = localT * localT * (3 - 2 * localT); // smoothstep
    const a = stages[i], b = stages[i + 1];
    let pos = a.pos.clone().lerp(b.pos, t);
    let look = a.look.clone().lerp(b.look, t);
    // dollyT (0→1, journeyEnd → dollyEnd) — camera continues dollying
    // from stage 4's own framing toward revealCameraPos/Look
    const dollyT = clampedP <= CONFIG.journeyEnd
      ? 0
      : Math.min(1, (clampedP - CONFIG.journeyEnd) / (CONFIG.dollyEnd - CONFIG.journeyEnd));
    if(dollyT > 0){
      const de = dollyT * dollyT * (3 - 2 * dollyT); // smoothstep
      pos = pos.lerp(this.revealCameraPos, de);
      look = look.lerp(this.revealCameraLook, de);
    }
    // dissolveT (0→1, dollyEnd → 1) — the camera itself holds still
    // through this whole range (dollyT is already pinned at 1); see
    // _frame's own dissolve block for what this actually drives
    // (material opacity, renderer clear alpha, the grain overlay, the
    // Section 2 ghost preview)
    const dissolveT = clampedP <= CONFIG.dollyEnd
      ? 0
      : Math.min(1, (clampedP - CONFIG.dollyEnd) / (1 - CONFIG.dollyEnd));
    return { pos, look, seg, dissolveT };
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
    const { pos, look, seg } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._renderFrame();
    this._updateTrafficLight(0);
    this._updateProcessStep(seg);
    this.canvas.classList.add('is-ready');
    // .process-room-visual's own var(--paper) background (see style.css)
    // exists purely to cover the gap before this very first render — a
    // real flash-of-unstyled-canvas risk since the canvas itself starts
    // at opacity:0 until this same .is-ready class fades it in. Once
    // that's happened it's never needed again for the rest of this
    // room's life, dissolve included — and during the dissolve it's
    // actively harmful: an opaque background sitting behind the canvas,
    // inside the same box, paints over EVERYTHING regardless of z-index,
    // hiding the Section 2 ghost preview that's supposed to show through
    // as the canvas itself fades to transparent (confirmed directly: the
    // dissolve was fading to solid opaque cream/black instead of ever
    // revealing anything underneath, no matter how transparent the
    // WebGL rendering itself genuinely was — readPixels on the canvas
    // confirmed real (0,0,0,0) output, so the renderer was never the
    // problem). Removed once, here, for good
    if(this.visual) this.visual.style.background = 'none';
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
      // just the renderer/canvas's own pixel size here — the pin/scrub
      // geometry itself (how much scroll room Section 1 needs) is
      // ScrollTrigger's job, and it already listens for resize and
      // recalculates its own pin boundaries on its own
      this._resizeT = setTimeout(() => { this._resize(); }, 200);
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

    this._bindScrollTrigger();

    // used to be handled sitewide by html{scroll-behavior:smooth} — that
    // CSS property is gone now (see its own removal comment in
    // style.css: it fights GSAP ScrollTrigger's own scroll handling,
    // reading as the pinned scene visibly lagging/drifting behind the
    // real scroll position while scrubbing). scrollIntoView's own
    // behavior:'smooth' option gives the same eased jump for these 3
    // links specifically, as a one-off animation rather than a standing
    // page-wide property, so it doesn't have that same conflict
    if(this.neonMenuEl){
      this.neonMenuEl.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (e) => {
          const target = document.querySelector(link.getAttribute('href'));
          if(!target) return;
          e.preventDefault();
          target.scrollIntoView({ behavior: this.prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
        });
      });
    }

    // fonts finishing (or the window 'load' event) can change layout
    // enough to shift where Section 1 actually starts/how tall Section
    // 2 sits below it — ScrollTrigger.refresh() recalculates the pin's
    // own start/end against current layout, same reason _measure() used
    // to get re-run at these same points under the old scroll-math system
    const refresh = () => { if(window.ScrollTrigger) window.ScrollTrigger.refresh(); };
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);

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

  // GSAP ScrollTrigger owns Section 1's whole scroll-driven experience —
  // ONE pin, covering the room tour, the forward-dolly hold, AND the
  // dissolve into Section 2, all in the same continuous scrub. This
  // used to be split across two triggers (a pinned one for the tour,
  // then a second, unpinned one tracking the natural scroll-away for
  // the fade) specifically to dodge a real bug: fading .process-room-
  // visual's opacity to 0 *while still pinned* just revealed the page's
  // own plain background, not Section 2 — a pinned element is
  // position:fixed, sitting on top of the viewport itself, and nothing
  // else shares that space with it while it's pinned.
  //
  // Going back to a single, fully-pinned dissolve on purpose this time,
  // per direct request to match unseen.co's own technique (confirmed by
  // inspecting their site directly): their canvas never moves — it's
  // pinned for the whole experience, and their NEXT page's content is
  // already sitting in the exact same viewport space underneath it,
  // revealed as the canvas's own rendered content dissolves away. Two
  // things make that same trick work here without the old bug:
  //
  //  1. Real WebGL transparency, not a DOM opacity fade. The renderer
  //     now has alpha:true (see the constructor), and _frame's own
  //     dissolve block fades actual mesh materials — "structure" (walls,
  //     floor, platform, tagged via userData.fadeGroup) slowly, "props"
  //     (sphere, chairs, stairs, rocket, traffic light) fast — plus
  //     renderer.setClearAlpha for the empty space around them. The
  //     canvas itself stays fully opaque as a DOM element throughout;
  //     what's "underneath" only ever shows through genuine per-pixel
  //     transparency in what's actually rendered.
  //  2. _buildSection2Ghost's own fixed-position CLONE of #liveDemoSection
  //     is what's actually sitting underneath to be revealed — the REAL
  //     #liveDemoSection is untouched and never repositioned (so nothing
  //     else on the page shifts/jumps), it's still exactly where normal
  //     document flow puts it, still off-screen below until the pin
  //     genuinely releases. The ghost is a separate, non-interactive,
  //     always-position:fixed preview that only ever fades in during the
  //     dissolve and is hidden entirely the instant the real pin
  //     releases (see this trigger's own onLeave/onEnterBack below) — by
  //     then the REAL section has scrolled into that exact same spot
  //     naturally, so the handoff is seamless.
  //
  // Skipped entirely under reduced motion, same as the mouse-parallax
  // listener above — a pinned/scrubbed scene is itself a motion effect,
  // and the room already just holds its first resting frame for these
  // visitors (see _frame's own reduced-motion branch), so there's
  // nothing here worth pinning/scrubbing scroll for either
  // a non-interactive, always position:fixed CLONE of the real
  // #liveDemoSection, used as the "what's underneath" preview during the
  // dissolve (see _bindScrollTrigger's own comment for why this exists
  // rather than repositioning the real section). Built once, appended to
  // <body>, opacity/display driven entirely from _frame's own dissolve
  // block + this trigger's onLeave/onEnterBack — the REAL section is
  // never touched, so nothing about the rest of the page's layout or
  // scroll length changes because this exists
  _buildSection2Ghost(){
    const real = document.getElementById('liveDemoSection');
    if(!real) return;
    const ghost = real.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    // iframes reload their own src from scratch on cloneNode (a real
    // browser behaviour, not a bug here) — stripped outright rather than
    // paying for a second network request, to sites this project doesn't
    // control, every time this brief, non-interactive preview appears
    ghost.querySelectorAll('iframe').forEach((el) => el.removeAttribute('src'));
    // .live-demo-inner starts at opacity:0 in CSS — its own real
    // scroll-driven entrance fade (js/live-demo.js's updateEntrance)
    // only ever finds/updates the FIRST .live-demo-inner in the
    // document, i.e. the real section's own, never this clone's copy of
    // it. Left alone, the ghost's actual content stays invisible at
    // opacity:0 forever regardless of the ghost wrapper's own opacity —
    // confirmed directly as the dissolve fading to solid black instead
    // of ever revealing the preview underneath. Forced to 1 here since
    // the ghost doesn't participate in that scroll-driven reveal at all
    // — it's either fully shown or fully hidden via the outer wrapper
    const ghostInner = ghost.querySelector('.live-demo-inner');
    if(ghostInner){
      ghostInner.style.opacity = '1';
      ghostInner.style.transform = 'none';
    }
    ghost.classList.add('process-room-section2-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.display = 'none';
    document.body.appendChild(ghost);
    this.section2Ghost = ghost;
  }

  _bindScrollTrigger(){
    if(this.prefersReducedMotion || !window.gsap || !window.ScrollTrigger) return;
    this._buildSection2Ghost();
    window.gsap.registerPlugin(window.ScrollTrigger);
    this._scrollTrigger = window.ScrollTrigger.create({
      trigger: this.section,
      start: 'top top',
      end: () => '+=' + Math.round(window.innerHeight * CONFIG.scrollMultiplier),
      pin: this.container,
      anticipatePin: 1,
      scrub: true,
      onUpdate: (self) => {
        this._state.progress = self.progress;
        this._wake();
      },
      // the ghost preview (see _buildSection2Ghost) is only ever
      // meaningful while genuinely pinned — hide it outright the instant
      // the pin releases (scrolling on past) so it can't linger as a
      // permanent fixed overlay sitting on top of the rest of the page,
      // and restore it if the visitor scrolls back up into the pin's
      // own range from below. this._pinReleased is what actually makes
      // that stick — see _applyDissolve's own comment for why setting
      // display:none here alone isn't enough
      onLeave: () => {
        this._pinReleased = true;
        if(this.section2Ghost) this.section2Ghost.style.display = 'none';
      },
      onEnterBack: () => {
        this._pinReleased = false;
        if(this.section2Ghost) this.section2Ghost.style.display = '';
      },
    });
    // synced immediately — otherwise the room sits at progress 0 until
    // the very first scroll/refresh event actually fires
    this._state.progress = this._scrollTrigger.progress;
    this._wake();
  }

  _wake(){
    if(!this._state.rafId){
      this._state.rafId = requestAnimationFrame(this._frame.bind(this));
    }
  }

  // the Section 1 → Section 2 dissolve itself — called every frame from
  // _frame() with dissolveT (0..1, see _cameraForProgress). Early-exits
  // once there's nothing left to do (dissolveT at rest AND it was
  // already at rest last frame too) so this costs nothing for the vast
  // majority of the experience; runs exactly one extra time on the way
  // BACK to 0 (scrolling back up out of the dissolve) to reset
  // everything cleanly rather than leaving it stuck mid-fade.
  //
  // Also bails immediately whenever this._pinReleased is true — this is
  // the fix for a real bug reported directly ("lag when the next section
  // appears" / "scroll doesn't work right after"): once the real
  // ScrollTrigger pin releases, GSAP stops sending onUpdate events, so
  // this._dissolveT stays frozen at whatever it last was (1, fully
  // dissolved) — but the render loop itself keeps running for another
  // ~300px past the section (see the IntersectionObserver's own
  // rootMargin, for idle animations like the rocket's bob/flicker).
  // Every one of those extra frames used to call this function again
  // with that same stale dissolveT===1, and its own ghost-opacity logic
  // below would set the ghost back to display:'' — undoing the pin's
  // own onLeave handler (which sets display:'none' exactly once, right
  // when the pin releases) on the very next frame. The visitor would
  // scroll past the room straight into a full-viewport, frozen,
  // non-interactive ghost preview sitting on top of the real Section 2
  // for that whole stretch, which reads exactly like "the scroll isn't
  // working" even though it genuinely is — nothing was visibly updating
  // because a stale, disconnected overlay was stuck covering it
  _applyDissolve(dissolveT){
    if(this._pinReleased) return;
    const wasDissolving = this._wasDissolving || false;
    if(dissolveT <= 0 && !wasDissolving) return;
    this._wasDissolving = dissolveT > 0;

    // "structure" (walls, floor, platform — this room's own architecture,
    // the closest equivalent here to unseen.co's own arches) fades
    // slowly, over the dissolve's second half, so it lingers and ghosts
    // through the longest. "props" (sphere, chairs, stairs, rocket,
    // traffic light) fade fast, over the first half, gone well before
    // the structure even starts to go
    const structureFade = 1 - THREE.MathUtils.smoothstep(dissolveT, 0.4, 1.0);
    const propsFade = 1 - THREE.MathUtils.smoothstep(dissolveT, 0.0, 0.55);
    this.roomGroup.traverse((obj) => {
      if(!obj.isMesh || !obj.material || !obj.userData.fadeGroup) return;
      const fade = obj.userData.fadeGroup === 'structure' ? structureFade : propsFade;
      // the floor (Reflector, a raw ShaderMaterial running OUR OWN
      // waterShader — see its own opacity-uniform comment in _buildScene)
      // doesn't read the standard Material.opacity property at all; only
      // its own explicit uniforms.opacity does anything. Every other
      // material tagged with a fadeGroup is a normal MeshStandardMaterial/
      // MeshPhysicalMaterial/MeshBasicMaterial, which DOES respect
      // .opacity directly — confirmed directly that setting only
      // .opacity left the floor fully opaque throughout the whole
      // dissolve regardless of what fade value was computed for it
      if(obj.material.uniforms && obj.material.uniforms.opacity){
        obj.material.uniforms.opacity.value = fade;
        obj.material.transparent = true;
        return;
      }
      if(!obj.material.transparent) obj.material.transparent = true;
      obj.material.opacity = fade;
    });

    // the "empty" space — through the arch, wherever nothing is drawn —
    // on the same slow curve as the rest of the structure. scene.
    // background is permanently null (see _buildEnvironment) specifically
    // so this actually has something to control
    if(this.renderer) this.renderer.setClearAlpha(structureFade);

    // film-grain dissolve (see .process-room-grain's own comment in
    // style.css) — a parabola peaking at dissolveT 0.5 rather than
    // following the room's own fade curve: it should read as part of the
    // ACT of dissolving, visible only while the crossfade is actually
    // happening, silent at both ends
    if(this.grainEl){
      this.grainEl.style.opacity = String(4 * dissolveT * (1 - dissolveT) * 0.5);
    }

    // the Section 2 ghost preview (see _buildSection2Ghost) — fades IN
    // as the room fades out, tracking dissolveT directly (no easing of
    // its own needed; it's arriving as the room leaves, not moving
    // anywhere itself)
    if(this.section2Ghost){
      if(dissolveT > 0){
        this.section2Ghost.style.display = '';
        this.section2Ghost.style.opacity = String(dissolveT);
      } else {
        this.section2Ghost.style.display = 'none';
        this.section2Ghost.style.opacity = '0';
      }
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

      const { pos, look, seg, dissolveT } = this._cameraForProgress(this._state.displayProgress);
      this._updateProcessStep(seg);
      this._dissolveT = dissolveT;
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
      const { pos, look, seg } = this._cameraForProgress(0);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      this._updateProcessStep(seg);
      // reduced motion holds the room at its very first resting frame
      // (progress locked to 0 above) — the dolly/dissolve is itself a
      // motion effect, so it stays off here the same way every other
      // animation in this file already does under this preference (see
      // _bindScrollTrigger, which never even creates the pin for these
      // visitors in the first place)
      this._dissolveT = 0;
    }
    if(this.sphere) this.sphere.rotation.y += 0.0018;
    if(this.rocket){
      // floats in place always — no throw, no scroll-position dependence
      // at all, per direct request ("actually floating in place")
      this._rocketTime = (this._rocketTime || 0) + 0.016;
      this.rocket.position.y = this._rocketBaseY + Math.sin(this._rocketTime * 0.6) * 0.08;
      this.rocket.rotation.y += 0.0016;
      this.rocket.rotation.z = Math.sin(this._rocketTime * 0.5) * 0.05;
      // flame flicker — two sine blends at different rates/phases so the
      // outer/inner cones don't pulse in lockstep, which is what
      // actually reads as "fire" rather than a uniform pulsing glow
      if(this.rocketFlameOuter){
        const flicker = 0.85 + Math.sin(this._rocketTime * 9.0) * 0.1 + Math.sin(this._rocketTime * 23.0) * 0.05;
        this.rocketFlameOuter.scale.set(1, flicker, 1);
        this.rocketFlameOuter.material.opacity = 0.55 * flicker;
      }
      if(this.rocketFlameInner){
        const flicker = 0.85 + Math.sin(this._rocketTime * 13.0 + 1.7) * 0.12 + Math.sin(this._rocketTime * 31.0) * 0.05;
        this.rocketFlameInner.scale.set(1, flicker, 1);
        this.rocketFlameInner.material.opacity = 0.75 * flicker;
      }
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

    // called LAST, deliberately — after every other per-object update
    // above (the rocket's own idle bob/flicker chief among them, which
    // unconditionally overwrites its flame materials' own .opacity every
    // frame for the flicker effect). Applying the dissolve fade before
    // that let the flicker silently stomp right back over it — confirmed
    // directly as the flame staying at full brightness through the whole
    // dissolve, the one thing on screen that never faded. Running this
    // last means the dissolve always has final say over every material's
    // opacity, whatever any other per-frame animation set moments earlier
    this._applyDissolve(this._dissolveT || 0);

    // skipped once genuinely released (see _applyDissolve's own comment)
    // — camera is frozen, every material is faded to 0, the ghost is
    // hidden, so there's nothing left that a render could show
    // differently. The render loop itself still keeps running for the
    // IntersectionObserver's own ~300px bleed (idle animations like the
    // rocket's bob/flicker still update their own position/rotation
    // underneath, harmlessly, in case the visitor scrolls back up), but
    // actually compositing that into a full render — RenderPass, the
    // separate bloom pass, the DoF pass, the colour-grade pass, OutputPass,
    // all of it — for a frame that's invisible either way was real,
    // pointless GPU cost sitting right at the exact moment the visitor
    // is trying to scroll through into Section 2, which is exactly where
    // it would read as "lag"
    if(!this._pinReleased) this._renderFrame();

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
  let room;
  try {
    room = new ProcessRoom(section, container, canvas);
  } catch(e) {
    window.__processRoomError = e;
    console.error('ProcessRoom init failed:', e);
    throw e;
  }
  window.Papi.processRoom = room;
})();
