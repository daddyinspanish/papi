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
  // Back down close to the original 4.4 (before either the old scroll-
  // driven dissolve, or this session's own dwell-buffer attempt, ever
  // ate extra scroll distance) — per direct request, the Section 1 →
  // Section 2 transition is click-triggered now (see _bindEnterButton),
  // matching unseen.co's own click/route-driven transition rather than
  // a scroll-scrubbed one. A first attempt at this reserved an extra
  // 0.6 viewport-heights of scrollABLE dwell room after the dolly parks,
  // so the pin wouldn't release before the button could be clicked — but
  // that only made the WINDOW to click wider, it never actually stopped
  // scrolling itself, so a visitor who kept scrolling could still blow
  // straight through the button and release the pin without ever
  // clicking it (confirmed directly). The real fix is a hard JS-level
  // scroll lock (see _updateScrollLock, engaged the instant dollyT
  // reaches 1 — see _frame's own dollyT check) that actually
  // prevents wheel/touch/key scroll from moving the page at all once
  // parked, not just more scroll room to buy time. This 0.1 extra here
  // is only a small safety margin against that lock engaging a frame or
  // two late, not a real dwell budget
  scrollMultiplier: 4.5,
  // fraction of the pin's own scrub spent on the 5-stop camera journey
  // (wide shot + 4 process steps) before the forward-dolly hold takes
  // over (see _cameraForProgress's own dollyT) — rescaled so the
  // journey's own real scroll DISTANCE stays what it's been all along
  // (0.74 × 4.4 ÷ 4.5)
  journeyEnd: 0.7236,
  // fraction where the forward dolly finishes, the camera parks at
  // revealCameraPos/Look, and the scroll lock engages (see _frame's own
  // dollyT check) — same absolute distance as before (0.26 × 4.4 ÷ 4.5
  // past journeyEnd). The "View Our Work" button fades in and becomes
  // clickable over this same instant; the small stretch from here to
  // 1.0 is just the safety margin described above, not meant to be
  // reachable by real scrolling once the lock is engaged
  dollyEnd: 0.9778,
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
    this.enterBtnEl = document.getElementById('processEnterBtn');
    this.backBtnEl = document.getElementById('processBackBtn');
    this.arrivalEl = document.getElementById('processArrival');
    this._lastStageIndex = -1;
    // true only while the click-triggered dissolve tween (see
    // _bindEnterButton) is actually running or has finished — used to
    // keep the button hidden/disabled once clicked, and to stop
    // _updateEnterButton from fading it back in afterward
    this._dissolveStarted = false;

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
    // true once the forward dolly has parked the camera and scroll/
    // camera-movement lock has engaged (see _updateScrollLock) — stays
    // true through the click-triggered dissolve and, later, through the
    // reverse animation too, only ever cleared explicitly at the very
    // end of each of those (_completeDissolveHandoff / _playReverse)
    this._locked = false;
    // once set (see _completeDissolveHandoff), the lowest scrollY a
    // visitor is allowed to reach via real scroll input — see
    // _bindEvents' own wheel/touchmove gate for what actually enforces
    // this. null means the gate isn't active at all (before the first
    // forward trip through the room, and again after _playReverse
    // clears it back to null)
    this._minScrollY = null;

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
        // single digit (1-4), not zero-padded — per direct request
        if(this.stepNumberEl) this.stepNumberEl.textContent = String(nearest);
        if(this.stepLabelEl) this.stepLabelEl.textContent = stage.label;
      }
      // ONLY the Delivery step (stage 4, nearest === last) moves — per
      // direct request, the other three stay exactly where they were.
      // .process-step--raised (style.css) moves it above the rocket,
      // which centred text otherwise sat right on top of
      this.stepEl.classList.toggle('process-step--raised', nearest === last);
    }
    const dist = Math.abs(seg - nearest);
    // fully opaque within a small window right at the stage itself,
    // smoothstep-fading to 0 by dist===0.5 (the exact midpoint to the
    // neighbouring stage, where the text swap above happens)
    const fadeStart = 0.12, fadeEnd = 0.5;
    const raw = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
    const opacity = 1 - raw * raw * (3 - 2 * raw);
    this.stepEl.style.opacity = opacity.toFixed(3);
    // the raised (stage 4) state anchors from its own top edge (see
    // .process-step--raised), so its own fade-in offset is a plain
    // translateY; every other stage still centres via translate(-50%,
    // -50%) same as always, with the offset folded into that same Y
    const offsetPx = ((1 - opacity) * 12).toFixed(1);
    this.stepEl.style.transform = nearest === last
      ? `translateX(-50%) translateY(${offsetPx}px)`
      : `translate(-50%, calc(-50% + ${offsetPx}px))`;

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

    // suppressed for the WHOLE click-triggered Section 1 <-> Section 2
    // transition — a real, confirmed bug: this.stepEl/neonMenuEl are
    // plain DOM overlays, not part of the WebGL scene, so they never
    // dissolve with the room at all. seg sits frozen at whichever stage
    // the camera was parked at (the last stage going forward, stage 0/
    // Welcome coming back), but _frame() calls this function every
    // single frame regardless (same as always) — without this guard,
    // that per-frame recompute kept popping the text straight back to
    // full opacity every tick: "4 / Delivery" sitting crisply over
    // Section 2 for the whole forward wipe, and "Welcome" sitting
    // crisply over the room before it had actually finished rippling
    // back in on the way back. Only ever suppressed while
    // this._dissolveStarted is true — set the instant the forward
    // click happens, only cleared again once the reverse wipe fully
    // completes (see _completeReverseHandoff) — so it covers the
    // forward wipe, the whole Section 2 visit, AND the reverse wipe
    if(this._dissolveStarted){
      this.stepEl.style.opacity = '0';
      if(this.neonMenuEl){
        this.neonMenuEl.style.opacity = '0';
        this.neonMenuEl.style.pointerEvents = 'none';
      }
    }
  }

  // the "View Our Work" click-trigger — fades in only over the last
  // sliver of the forward-dolly hold (dollyT 0.92→1), once the camera is
  // essentially already parked at revealCameraPos/Look, rather than the
  // instant the dolly starts. Never re-shown once the dissolve itself
  // has actually started (_dissolveStarted), even if dollyT is still 1 —
  // otherwise it'd still be sitting there fully visible UNDER the room
  // as it dissolves away, which reads as broken rather than intentional
  _updateEnterButton(dollyT){
    if(!this.enterBtnEl) return;
    // also stays hidden through the whole reverse animation (_playReverse)
    // — dollyT sits at exactly 1 for the first moment of that rewind
    // (progress hasn't started easing back down yet), which without this
    // guard would fade the button straight back in the instant the room
    // reappears, well before the visitor has actually scrolled forward
    // through the journey again themselves
    if(this._dissolveStarted || this._reversing){
      this.enterBtnEl.style.opacity = '0';
      this.enterBtnEl.style.pointerEvents = 'none';
      this.enterBtnEl.tabIndex = -1;
      return;
    }
    const raw = Math.max(0, Math.min(1, (dollyT - 0.92) / (1 - 0.92)));
    const opacity = raw * raw * (3 - 2 * raw);
    this.enterBtnEl.style.opacity = opacity.toFixed(3);
    this.enterBtnEl.style.transform = `translate(-50%, ${(8 - opacity * 8).toFixed(1)}px)`;
    const interactive = opacity > 0.6;
    this.enterBtnEl.style.pointerEvents = interactive ? 'auto' : 'none';
    this.enterBtnEl.tabIndex = interactive ? 0 : -1;
  }

  // engages this._locked the instant the forward dolly finishes parking
  // the camera (dollyT reaches 1) — see _bindEvents' own keydown listener
  // plus window.Papi.lockScroll (js/accent.js) for what actually blocks
  // scroll once this is true, and _frame's own camera-freeze branch for
  // why the camera itself stops moving at the same instant. Deliberately
  // one-directional: this method only ever turns the lock ON. Turning it
  // back OFF is a meaningful state transition of its own (the forward
  // handoff finishing, or the reverse rewind finishing) handled
  // explicitly at each of those call sites instead — if this method also
  // cleared it the instant dollyT dropped back below 1, the reverse
  // rewind's own camera move (which necessarily passes back through
  // dollyT<1 on its way to the wide shot) would silently unlock
  // scrolling partway through that animation, before it's actually done.
  // Also gated on !this._pinReleased — this._state.displayProgress (and
  // so dollyT) just sits at 1 forever once the forward handoff is done
  // (nothing after that point ever moves it back down on its own), so
  // without this guard this method would immediately re-lock the very
  // next frame after _completeDissolveHandoff's own unlock, every single
  // time — confirmed directly as scroll staying stuck locked on the real
  // Section 2 page after a completed dissolve
  _updateScrollLock(dollyT){
    if(dollyT >= 1 && !this._locked && !this._pinReleased){
      this._locked = true;
      if(window.Papi && window.Papi.lockScroll) window.Papi.lockScroll();
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

    // the actual noise-dissolve — the missing piece identified from
    // decompiling unseen.co's own live shader bundle directly: a flat
    // per-material opacity fade reads as a plain crossfade because every
    // pixel fades at the same rate at the same time. This instead
    // thresholds a NOISE FIELD against uProgress per-pixel (see the
    // noise()/edge/q math below, ported close to unseen's own decompiled
    // source), so different pixels "burn away" at different moments
    // depending on where they land in that field — an organic, irregular
    // edge instead of a uniform fade. Directional per direct request
    // (bottom-to-top revealing Section 2, top-to-bottom revealing the
    // room again) rather than unseen's own radial-from-corner sweep —
    // see uDirection below, which just flips which edge of the screen
    // "dist" is measured from; the noise/fluid-warp texture on top of
    // that is what gives the moving edge its ripple/distortion, not a
    // straight line. Runs on the FINAL composited alpha only (RGB
    // untouched) — materials themselves stay fully opaque; this pass
    // alone (reading the ENTIRE composited frame's alpha, geometry and
    // empty space alike) is what reveals/conceals Section 2 underneath.
    // uFluidTexture is _buildFluidSim's own cursor-reactive splat sim —
    // see that method's own comment for why a lightweight splat+decay
    // texture stands in for unseen's real fluid simulation here
    this.dissolvePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uFluidTexture: { value: null },
        uProgress: { value: 0 },
        // 0 = forward (the room dissolves away starting at the BOTTOM of
        // the screen, sweeping up); 1 = reverse (the room re-solidifies
        // starting at the TOP, sweeping down) — see _runWipe
        uDirection: { value: 0 },
        uAspect: { value: w / h },
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
        uniform sampler2D uFluidTexture;
        uniform float uProgress;
        uniform float uDirection;
        uniform float uAspect;
        varying vec2 vUv;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        // two octaves (not one) — a single value-noise layer at any one
        // scale reads as soft, evenly-sized blobs; layering a finer,
        // lower-weight second pass on top breaks that regularity up into
        // the kind of irregular, torn-edge texture unseen.co's own
        // reveal actually has
        float fbm(vec2 p){
          return noise(p) * 0.65 + noise(p * 2.3 + 11.0) * 0.35;
        }

        const float scale = 7.0;
        const float smoothness = 0.09;

        void main(){
          vec4 base = texture2D(tDiffuse, vUv);
          // symmetric guard at the OTHER end too (the reverse tween's
          // own tail, easing back down toward 0) — the same degenerate-
          // smoothstep risk described below applies just as much down
          // here: as uProgress→0, "edge" approaches 1 for virtually
          // every pixel, which pushes q's own edges toward each other
          // from the other side. Treating anything this close to 0 as
          // "not dissolving yet at all" avoids relying on that formula
          // ever being well-behaved in either degenerate limit
          if(uProgress <= 0.01){
            gl_FragColor = base;
            return;
          }
          // a real, confirmed edge case: as uProgress approaches 1.0,
          // "edge" (below) approaches 0 for virtually every pixel — the
          // noise threshold band shifts entirely above the noise field's
          // own range — which collapses the q calculation below into
          // smoothstep(uProgress, uProgress, dist): identical lower/
          // upper edges, which GLSL leaves undefined (some GPUs resolve
          // it to 0, i.e. NOT fully dissolved, rather than the intended
          // 1). Confirmed directly as the cause of the room staying
          // faintly/inconsistently visible even once the dissolve tween
          // had numerically finished. Forcing full transparency directly
          // above this threshold sidesteps the degenerate math entirely
          // rather than trying to rebalance the formula around it
          if(uProgress >= 0.99){
            base.a = 0.0;
            gl_FragColor = base;
            return;
          }
          // the cursor-reactive fluid warp — pushed further than a
          // first pass (0.05) since at that strength it was too subtle
          // to actually read against the noise field itself. Clamped
          // here too (see _stepFluidSim's own velocity clamp for the
          // main fix) — a second, cheap defensive layer against this
          // ever sampling the noise field so far from vUv that it reads
          // as an incoherent floating patch unrelated to the real pixel,
          // regardless of what the accumulator upstream is doing
          vec2 fluid = texture2D(uFluidTexture, vUv).xy;
          float fluidLen = length(fluid);
          if(fluidLen > 1.5) fluid *= 1.5 / fluidLen;
          vec2 uv = vUv + fluid * 0.09;

          float n = fbm(uv * scale);
          // directional sweep (see uDirection's own declaration above):
          // uDirection 0 measures dist from the BOTTOM edge (vUv.y=0),
          // so the bottom is what dissolves away first as uProgress
          // climbs — a bottom-to-top reveal. uDirection 1 flips that to
          // measure from the TOP instead, so the top is what re-solidifies
          // first as uProgress falls back toward 0 — a top-to-bottom
          // reveal. Purely a vertical sweep now (no more radial/aspect
          // term) — the noise field + fluid warp above are what still
          // give the moving edge its organic, rippled distortion rather
          // than a straight horizontal line
          float dist = mix(vUv.y, 1.0 - vUv.y, uDirection);

          float p = mix(-smoothness, 1.0 + smoothness, uProgress);
          float edge = smoothstep(p - smoothness, p + smoothness, n);
          float q = smoothstep(uProgress - edge, uProgress, dist);

          base.a *= 1.0 - q;
          gl_FragColor = base;
        }
      `,
    });
    this.composer.addPass(this.dissolvePass);

    this.composer.addPass(new OutputPass());

    this._buildFluidSim();
  }

  // a lightweight stand-in for unseen.co's own cursor-reactive fluid
  // simulation (their uFluidTexture, confirmed in their decompiled
  // shader bundle) — a full Navier-Stokes solve (advection + pressure
  // projection, several ping-ponged passes every frame) is real
  // complexity this single reveal effect doesn't need. This is a
  // "splat and decay" velocity field instead: every frame, the current
  // pointer's velocity is stamped ("splatted") into a small offscreen
  // texture at the pointer's own position, and the previous frame's
  // whole texture is multiplied down first (uDecay) so old splats fade
  // and drift away rather than accumulating forever. Sampled by
  // dissolvePass above as a per-pixel UV offset, the same way unseen's
  // own fluidPos warps their reveal's texture sampling. Deliberately
  // tiny (128x128) and cheap — one extra full-screen pass a frame — and
  // kept running continuously whenever the room is in view (not just
  // during the dissolve) so the field already has some natural motion
  // history the instant a visitor actually clicks, rather than starting
  // from a dead stop
  _buildFluidSim(){
    const size = 128;
    const rtOptions = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this._fluidRTA = new THREE.WebGLRenderTarget(size, size, rtOptions);
    this._fluidRTB = new THREE.WebGLRenderTarget(size, size, rtOptions);
    this._fluidScene = new THREE.Scene();
    this._fluidCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fluidSplatMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null },
        uMouseUV: { value: new THREE.Vector2(0.5, 0.5) },
        uMouseVel: { value: new THREE.Vector2(0, 0) },
        uAspect: { value: 1 },
        uDecay: { value: 0.98 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tPrev;
        uniform vec2 uMouseUV;
        uniform vec2 uMouseVel;
        uniform float uAspect;
        uniform float uDecay;
        varying vec2 vUv;
        void main(){
          vec2 prev = texture2D(tPrev, vUv).xy * uDecay;
          vec2 d = vUv - uMouseUV;
          d.x *= uAspect;
          float falloff = exp(-dot(d, d) / 0.0025);
          gl_FragColor = vec4(prev + uMouseVel * falloff, 0.0, 1.0);
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._fluidSplatMaterial);
    this._fluidScene.add(quad);
    if(this.dissolvePass) this.dissolvePass.uniforms.uFluidTexture.value = this._fluidRTA.texture;
  }

  // advances the fluid-splat sim by one frame — called every _frame()
  // tick while in view (see _frame's own call site), independent of
  // whether the dissolve is actually running, so it's already "warm"
  // the instant a visitor clicks
  _stepFluidSim(){
    if(!this._fluidRTA || !this.renderer) return;
    const uv = this._fluidMouseUV || { x: 0.5, y: 0.5 };
    const last = this._fluidLastUV || uv;
    let velX = (uv.x - last.x) * 14, velY = (uv.y - last.y) * 14;
    // clamped — a real, confirmed bug: _fluidMouseUV updates on every raw
    // mousemove event, but this sim only steps once per RENDERED frame
    // (capped by CONFIG.renderFPS), so a fast, completely ordinary flick
    // of the mouse/trackpad — e.g. moving toward the "View Our Work"/
    // "Back to top" button, exactly what a real visitor does right
    // before triggering this wipe — can cover a large fraction of the
    // screen between two consecutive steps. With delta up to ~1.0 and no
    // clamp, that produced velocity spikes many times larger than this
    // sim (or the dissolve shader's own fluid warp, which assumes small,
    // ripple-scale offsets) was ever designed for. That oversized value
    // got splatted into the accumulator every time, then read back in
    // the dissolve shader as a per-pixel UV offset (fluid * 0.09) large
    // enough to sample the noise field somewhere essentially unrelated
    // to the actual pixel — an isolated, incoherent "hole" in the
    // dissolve, disconnected from the real wipe edge, at wherever the
    // cursor happened to be. Capping the speed here keeps every splat
    // within the range the shader's own small warp offset was tuned for
    const velLen = Math.sqrt(velX * velX + velY * velY);
    const maxVel = 2.5;
    if(velLen > maxVel){
      const scale = maxVel / velLen;
      velX *= scale;
      velY *= scale;
    }
    const vel = { x: velX, y: velY };
    this._fluidLastUV = { x: uv.x, y: uv.y };

    const mat = this._fluidSplatMaterial;
    mat.uniforms.tPrev.value = this._fluidRTA.texture;
    mat.uniforms.uMouseUV.value.set(uv.x, uv.y);
    mat.uniforms.uMouseVel.value.set(vel.x, vel.y);
    mat.uniforms.uAspect.value = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._fluidRTB);
    this.renderer.render(this._fluidScene, this._fluidCamera);
    this.renderer.setRenderTarget(prevTarget);

    const tmp = this._fluidRTA;
    this._fluidRTA = this._fluidRTB;
    this._fluidRTB = tmp;
    if(this.dissolvePass) this.dissolvePass.uniforms.uFluidTexture.value = this._fluidRTA.texture;
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
    // no scroll-driven reveal any more — the Section 1 → Section 2
    // transition is a click-triggered wipe now (see _bindEnterButton/
    // _runWipe), entirely independent of scroll position
    return { pos, look, seg, dollyT };
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
    if(this.dissolvePass) this.dissolvePass.uniforms.uAspect.value = w / h;
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

    // three distinct things block scroll input here, all checked
    // directly against GSAP's own LIVE, unlagged scroll-trigger progress
    // (this._scrollTrigger.progress) rather than this._locked or
    // this._state.displayProgress — both of those only update once a
    // frame via the render loop's own polling, which can't react fast
    // enough to stop a single large/fast scroll gesture (a hard trackpad
    // flick, or a held-down scroll wheel) from overshooting well past a
    // boundary before that reactive flag ever catches up. Confirmed
    // directly: checking this._locked alone let a fast real scroll blow
    // straight through the entire remaining pin distance and release it
    // without the lock ever actually engaging.
    //   1. forward lock — once real progress reaches CONFIG.dollyEnd
    //      (camera about to park), no further downward scroll at all
    //      until the "View Our Work" button is clicked
    //   2. this._locked — fully locked, both directions (awaiting that
    //      click, or mid-reverse-animation) — this one CAN stay reactive
    //      (see _updateScrollLock/_playReverse), since nothing needs to
    //      react faster than a frame once already fully stopped
    //   3. the one-way gate — once this._minScrollY is set (see
    //      _completeDissolveHandoff), Section 2 can scroll further down
    //      freely but never back up past that point; only the "back to
    //      top" button (_playReverse) can undo it
    const rawProgress = () => this._scrollTrigger ? this._scrollTrigger.progress : 0;
    const blockedDown = () => !this._pinReleased && rawProgress() >= CONFIG.dollyEnd;
    const blockedUp = () => this._minScrollY != null && window.scrollY <= this._minScrollY + 1;

    const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Spacebar', 'Home', 'End']);
    const UP_SCROLL_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
    this._onKeyDownLock = (e) => {
      if(this._locked && SCROLL_KEYS.has(e.key)){ e.preventDefault(); return; }
      if(!UP_SCROLL_KEYS.has(e.key) && blockedDown()){ e.preventDefault(); return; }
      if(UP_SCROLL_KEYS.has(e.key) && blockedUp()) e.preventDefault();
    };
    window.addEventListener('keydown', this._onKeyDownLock);

    this._onWheelLock = (e) => {
      if(e.deltaY > 0 && blockedDown()){ e.preventDefault(); return; }
      if(this._locked){ e.preventDefault(); return; }
      if(e.deltaY < 0 && blockedUp()) e.preventDefault();
    };
    window.addEventListener('wheel', this._onWheelLock, { passive: false });

    let touchStartY = 0;
    this._onTouchStartLock = (e) => { touchStartY = e.touches[0] ? e.touches[0].clientY : 0; };
    this._onTouchMoveLock = (e) => {
      const t = e.touches[0];
      if(!t) return;
      // dragging a finger UP the screen scrolls the page DOWN, and vice
      // versa — the touch equivalent of wheel's own deltaY sign above
      const draggingUp = t.clientY - touchStartY < 0;
      if(draggingUp && blockedDown()){ e.preventDefault(); return; }
      if(this._locked){ e.preventDefault(); return; }
      if(!draggingUp && blockedUp()) e.preventDefault();
    };
    window.addEventListener('touchstart', this._onTouchStartLock, { passive: true });
    window.addEventListener('touchmove', this._onTouchMoveLock, { passive: false });

    // a corrective backstop, on top of the preventDefault-based blocks
    // above — confirmed directly that some scroll input (this browser's
    // own automated-testing scroll gesture, and momentum/compositor-
    // driven scrolling in general is a known real-world case) can still
    // move the page even after a wheel/touchmove handler calls
    // preventDefault, since a fling already handed off to the compositor
    // thread doesn't necessarily respect a main-thread cancellation.
    // Rather than trust preventDefault alone to hold either boundary,
    // this snaps scrollY back the instant it's actually detected past
    // one, via the real 'scroll' event itself (which reports the true,
    // already-applied position, so this catches every path regardless
    // of what caused it — wheel, touch, keyboard, scrollbar drag, or a
    // compositor fling preventDefault didn't stop)
    this._onScrollSnap = () => {
      if(this._minScrollY != null && window.scrollY < this._minScrollY - 1){
        window.scrollTo(0, this._minScrollY);
        return;
      }
      // !this._reversing matters here, not just !this._pinReleased: for
      // the WHOLE reverse animation (_playReverse through
      // _rewindJourney), this._pinReleased is already false (set back
      // that way deliberately, to resume rendering) while the real
      // scrollY still sits wherever it was in Section 2 — without this
      // guard, the instant "back to top" was clicked this would have
      // immediately yanked the real page scroll back toward dollyEndY
      // on its own, well before the reverse animation itself was ready
      // to move it there
      if(!this._pinReleased && !this._reversing && this._scrollTrigger){
        const dollyEndY = this._scrollTrigger.start + CONFIG.dollyEnd * (this._scrollTrigger.end - this._scrollTrigger.start);
        if(window.scrollY > dollyEndY + 1) window.scrollTo(0, Math.round(dollyEndY));
      }
    };
    window.addEventListener('scroll', this._onScrollSnap, { passive: true });

    // touch used to feed the same look-around parallax as desktop's
    // mouse move, driven by finger position — removed per direct
    // request ("scroll lock, no moving around on mobile"): dragging a
    // finger to scroll was also rotating the camera based on that
    // finger's absolute screen position, reading as the room swinging
    // around unpredictably while just trying to scroll. Mobile now
    // only ever moves through the scroll-driven camera path itself;
    // desktop's mouse-driven swing is unaffected
    if(!this.prefersReducedMotion && !this.isCoarsePointer){
      this._lastMouseMoveTs = performance.now();
      this._onMouseMove = (e) => {
        this.mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
        this._lastMouseMoveTs = performance.now();
        // raw (unlerped) pointer position in texture UV space (y-flipped
        // — WebGL textures are bottom-left origin, screen coords are
        // top-left) for the fluid-splat sim (see _stepFluidSim) — kept
        // completely separate from mouseTarget above, which is the
        // heavily-smoothed camera-parallax value; the fluid sim wants
        // the real, immediate pointer position instead
        this._fluidMouseUV = { x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight };
        this._wake();
      };
      window.addEventListener('mousemove', this._onMouseMove, { passive: true });
      // per direct request: the camera used to just sit wherever the
      // cursor last was if a visitor moved their mouse off toward a
      // link/another tab and never moved it again — recentering
      // mouseTarget back to (0,0) here is enough on its own; the normal
      // per-frame mouseLerp in _frame() already eases this.mouse toward
      // whatever mouseTarget currently is every frame, so setting the
      // TARGET back to centre is all that's needed for the camera to
      // smoothly ease itself back on its own, no separate tween. Fires
      // the instant the pointer actually leaves the viewport (rather
      // than waiting for the idle timeout below), which is the more
      // common real case ("leaves the website") this was reported for
      this._onMouseLeaveWindow = () => {
        this.mouseTarget.x = 0;
        this.mouseTarget.y = 0;
      };
      document.documentElement.addEventListener('mouseleave', this._onMouseLeaveWindow);
    }

    this._bindScrollTrigger();
    this._bindEnterButton();
    this._bindBackButton();

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
  // Going back to a single, fully-pinned reveal on purpose this time,
  // per direct request to match unseen.co's own technique (confirmed by
  // inspecting their site directly): their canvas never moves — it's
  // pinned for the whole experience, and their NEXT page's content is
  // already sitting in the exact same viewport space underneath it,
  // revealed as the canvas wipes away. What actually makes that work
  // here, after two earlier approaches (a per-material opacity fade,
  // then a noise-dissolve shader blended against a cloned "ghost"
  // preview of #liveDemoSection) each shipped their own real, confirmed
  // bugs: the ghost clone never had the real section's own loaded
  // iframe content, so it read as a blank/loading placeholder that then
  // hard-swapped to the real, already-loaded page; and reusing dissolveT
  // for BOTH directions meant the ghost logic ran (and showed) during
  // the reverse trip too, when there's no Section 2 to preview at all.
  //
  // The fix is to stop faking "what's underneath" entirely. _runWipe
  // (below _bindEnterButton) drives the SAME noise-dissolve shader pass
  // this file already had (this.dissolvePass, see _buildPostProcessing) —
  // a per-pixel, directional, organically-edged reveal, not a flat fade
  // — while the REAL destination page is already sitting in the exact
  // right scroll position behind this container (the jump happens
  // instantly, hidden, before the wipe starts; see _bindEnterButton/
  // _playReverse). Whatever the dissolve uncovers IS the real thing,
  // already loaded, because there's no clone standing in for it —
  // nothing to ever look different from what it's revealing.
  //
  // Skipped entirely under reduced motion, same as the mouse-parallax
  // listener above — a pinned/scrubbed scene is itself a motion effect,
  // and the room already just holds its first resting frame for these
  // visitors (see _frame's own reduced-motion branch), so there's
  // nothing here worth pinning/scrubbing scroll for either
  _bindScrollTrigger(){
    if(this.prefersReducedMotion || !window.gsap || !window.ScrollTrigger) return;
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
      onLeave: () => {
        this._pinReleased = true;
      },
      // onEnterBack (GSAP re-pinning because the visitor scrolled back
      // UP into this range from below) should never actually fire in
      // practice any more: real scroll can't reach this trigger's own
      // end at all while locked (see _updateScrollLock), and the one
      // place scroll DOES cross it — _completeDissolveHandoff's own
      // programmatic jump — immediately disables this whole trigger in
      // the same breath. Scrolling back into the room is _playReverse's
      // job now (see its own "back to top" button), not plain scrolling;
      // kept here only as a defensive no-op in case some other scroll
      // path this file doesn't yet know about ever reaches it
      onEnterBack: () => { this._pinReleased = false; },
    });
    // synced immediately — otherwise the room sits at progress 0 until
    // the very first scroll/refresh event actually fires
    this._state.progress = this._scrollTrigger.progress;
    this._wake();
  }

  // primes this.dissolvePass's own uniforms for a given point (t, 0..1)
  // through a directional wipe — see _runWipe below for the tween that
  // drives t, and the shader itself (_buildPostProcessing) for how
  // uDirection/uProgress combine with the noise field + fluid warp to
  // turn this into an organically-edged, rippled reveal rather than a
  // straight line. Split out from _runWipe so _playReverse can prime the
  // very first (fully-hidden) frame BEFORE its own synchronous render,
  // rather than rendering one frame too early at the wrong progress
  _setWipeUniforms(direction, t){
    if(this.dissolvePass){
      this.dissolvePass.uniforms.uDirection.value = direction === 'forward' ? 0 : 1;
      this.dissolvePass.uniforms.uProgress.value = direction === 'forward' ? t : (1 - t);
    }
    this._applyWipeGrain(t);
  }

  // drives the directional noise-dissolve wipe (see _setWipeUniforms) —
  // 'forward' reveals whatever's behind the room from the BOTTOM of the
  // screen up (the room itself dissolving away there first), 'reverse'
  // reveals the room again from the TOP down. See _bindEnterButton/
  // _playReverse for what's already sitting behind the container by the
  // time this runs
  _runWipe(direction, onDone){
    let done = false;
    let tween = null;
    const finish = () => {
      if(done) return;
      done = true;
      if(tween) tween.kill();
      this._setWipeUniforms(direction, 1);
      onDone();
    };
    this._setWipeUniforms(direction, 0);
    this._wake();
    if(!window.gsap){
      finish();
      return;
    }
    const state = { t: 0 };
    // linear ('none'), not eased — a real, confirmed issue with
    // power2.inOut here: the shader's dist runs the FULL screen height
    // (bottom edge to top edge), so the wipe needs uProgress to travel
    // nearly its whole 0→1 range just to sweep top-to-bottom once. With
    // an inOut ease decelerating hard at BOTH ends, the recognizable,
    // central content (the "Welcome" text sitting roughly mid-screen)
    // didn't even start dissolving until well past halfway through the
    // tween's own DURATION — read exactly as "it just shows the whole
    // first section" for what felt like most of the transition, then a
    // late rush to finish. A constant rate means the wipe is visibly
    // moving from the very first frame, at every point along its travel
    tween = window.gsap.to(state, {
      t: 1,
      duration: 1.1,
      ease: 'none',
      onUpdate: () => {
        this._setWipeUniforms(direction, state.t);
        this._wake();
        if(state.t >= 0.99) finish();
      },
      onComplete: finish,
    });
  }

  // the click-trigger itself — per direct request, the Section 1 →
  // Section 2 transition happens when the "View Our Work" button is
  // clicked (see _updateEnterButton for when it's actually visible/
  // interactive), not by continuing to scroll, matching unseen.co's own
  // click/route-driven transition.
  _bindEnterButton(){
    if(!this.enterBtnEl) return;
    this.enterBtnEl.addEventListener('click', () => {
      if(this._dissolveStarted) return;
      this._dissolveStarted = true;

      // Freezes GSAP's own pin exactly as it currently looks (fixed,
      // full-viewport) without reverting any of that styling — the same
      // disable(false) technique _playReverse already used on the way
      // back. Done BEFORE the scroll jump below on purpose: scrolling
      // past scrollTrigger.end while the trigger is still enabled would
      // have GSAP notice and start un-pinning the container mid-jump,
      // which is exactly the kind of one-frame flash this is trying to
      // avoid
      if(this._scrollTrigger) this._scrollTrigger.disable(false);
      this.container.classList.add('process-room-sticky--manual-pin');

      // Jumps the REAL page straight to where #liveDemoSection actually
      // starts, all the way past GSAP's own pin-release point (see the
      // older comment history here for why scrollTrigger.end alone isn't
      // enough — .process-room-sticky reserves a further real 100vh in
      // document flow after the pin spacer). This happens NOW, instantly,
      // while the room is still fully opaque and clipped to nothing —
      // the jump itself is invisible. The wipe below then uncovers the
      // REAL section directly, already sitting exactly where it needs to
      // be and already fully loaded, because there's no stand-in for it
      // (see _bindScrollTrigger's own comment for why the old ghost
      // preview is gone)
      const target = Math.ceil(this._scrollTrigger.end + window.innerHeight);
      window.scrollTo({ top: target, left: window.scrollX, behavior: 'auto' });
      // per direct request: Section 2 should never be scrollable back UP
      // into Section 1 at all, only down — see _bindEvents' own wheel/
      // touchmove gate for the actual enforcement
      this._minScrollY = target;

      // same real bug this pre-empted before: js/live-demo.js's own
      // scroll-driven entrance fade is debounced through its own
      // requestAnimationFrame, one tick behind this synchronous jump.
      // Setting it directly here removes that gap; its own scroll
      // listener runs right after anyway and computes the identical
      // fully-revealed values for this scroll position regardless
      const realInner = document.querySelector('#liveDemoSection .live-demo-inner');
      if(realInner){
        realInner.style.opacity = '1';
        realInner.style.transform = 'translateY(0px)';
      }

      this._runWipe('forward', () => this._completeDissolveHandoff());
    });
  }

  _completeDissolveHandoff(){
    // hides the room outright once fully wiped away — nothing left on
    // screen for it to show differently, and it only ever needs to
    // reappear via _playReverse, which restores this itself
    this.container.style.visibility = 'hidden';
    this.container.classList.remove('process-room-sticky--manual-pin');
    this._pinReleased = true;
    this._locked = false;
    if(window.Papi && window.Papi.unlockScroll) window.Papi.unlockScroll();
    // NOT calling ScrollTrigger.refresh() here — tried it, and it's
    // actively harmful: GSAP's refresh() recalculates this (still-
    // registered, just disabled) trigger's own pin geometry and, in
    // doing so, adjusts the real scrollY to match — confirmed directly
    // as a real regression, landing scrollY ~600px short of the jump
    // target above the instant refresh() ran. There's only this one
    // ScrollTrigger instance on the whole page (confirmed directly —
    // ScrollTrigger.getAll().length === 1), so there's nothing else
    // for a refresh to correct anyway
    // reveals the rocket + "back to top" row together (see
    // .process-arrival's own comment in index.html) — the rocket's own
    // "landing" in Section 2 and the only way back into the room both
    // arrive at the same moment. display and the is-visible class (the
    // opacity/transform fade-and-drop-in — see that class in style.css)
    // are set a frame apart on purpose: flipping both in the same tick
    // gives the browser no "before" state to transition from, so the
    // reveal would just snap instead of animating
    if(this.arrivalEl){
      this.arrivalEl.style.display = 'flex';
      requestAnimationFrame(() => this.arrivalEl.classList.add('is-visible'));
    }
    if(this.backBtnEl) this.backBtnEl.tabIndex = 0;
  }

  _bindBackButton(){
    if(!this.backBtnEl) return;
    this.backBtnEl.addEventListener('click', () => this._playReverse());
  }

  // the reverse of the whole forward sequence — per direct request,
  // scrolling back up into the room no longer works at all (see
  // _completeDissolveHandoff's own this._scrollTrigger.disable(false)),
  // so this button is the ONLY way back in, and it plays the real
  // dissolve-in + camera rewind rather than just snapping back
  _playReverse(){
    if(!this.container || this._reversing || !this._pinReleased) return;
    this._reversing = true;
    this._locked = true;
    this._minScrollY = null;
    if(window.Papi && window.Papi.lockScroll) window.Papi.lockScroll();

    if(this.arrivalEl){
      this.arrivalEl.style.display = 'none';
      this.arrivalEl.classList.remove('is-visible');
    }
    if(this.backBtnEl) this.backBtnEl.tabIndex = -1;

    // re-shows the room as a manually fixed overlay, independent of
    // real scroll position (GSAP's own pin is still disabled, and won't
    // naturally cover wherever the visitor actually scrolled down to) —
    // .process-room-sticky--manual-pin (style.css) applies the same
    // position:fixed;inset:0 GSAP's own pin would, just driven by this
    // class instead of GSAP while its trigger is disabled.
    //
    // Per direct request, this no longer plays back through stages
    // 4→3→2→1 on the way out — it jumps straight to the wide "Welcome"
    // shot instead. Snapping progress/displayProgress to 0 HERE, before
    // the container is even visible again, is what makes that jump
    // invisible: dissolveT is still 1 (fully transparent) at this exact
    // moment, so the camera silently lands on the Welcome framing with
    // nothing on screen to show it happening. _reverseDissolve below is
    // the only thing the visitor actually sees — the room fading back
    // in, already sitting at Welcome the whole time.
    this._state.progress = 0;
    this._state.displayProgress = 0;
    this.container.style.visibility = '';
    this.container.classList.add('process-room-sticky--manual-pin');
    this._pinReleased = false;
    // the camera itself is only ever actually moved inside _frame()'s
    // own per-frame computation, on whatever tick _wake() schedules next
    // — snapping progress/displayProgress above doesn't move the real
    // THREE.Camera object by itself. Setting it here too, synchronously,
    // is what makes the render two lines down actually show Welcome
    // instead of wherever the camera was last left (the forward dolly's
    // own reveal position, still looking at the rocket)
    const { pos, look, seg } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._updateProcessStep(seg);
    // primed BEFORE the synchronous render below, not after — this sets
    // this.dissolvePass's own uProgress to fully-dissolved (room
    // invisible) so the freshly-rendered Welcome frame that follows is
    // never actually shown at full opacity even for one frame. Priming
    // first, rendering second is what makes that guarantee hold; doing
    // it in the other order (as a previous version of this did with a
    // CSS clip-path) left a one-frame gap between "render the correct
    // scene" and "hide it again" for whatever should have hidden it to
    // catch up
    this._setWipeUniforms('reverse', 0);
    // a synchronous render right here, rather than only via the rAF
    // _wake() schedules — the canvas's own backing buffer still holds
    // whatever it last drew, from well before this moment; rendering
    // immediately guarantees the very first visible frame already
    // reflects Welcome (fully dissolved per the priming above), not a
    // stale one
    this._renderFrame();
    this._wake();
    this._runWipe('reverse', () => this._completeReverseHandoff());
  }

  // the only thing the visitor actually watches during the whole
  // reverse trip — the room wiping back in top-to-bottom, already
  // parked at the Welcome framing (see _playReverse's own snap above)
  _completeReverseHandoff(){
    this._dissolveStarted = false;
    // drops the manual pin and hands scroll position back to GSAP —
    // scrollY lands at 0 (top of the pin's own range), so its next
    // native scroll-driven update re-establishes the real pin exactly
    // where this manual one leaves off, no visible seam
    this.container.classList.remove('process-room-sticky--manual-pin');
    window.scrollTo({ top: 0, left: window.scrollX, behavior: 'auto' });
    if(this._scrollTrigger) this._scrollTrigger.enable();
    this._reversing = false;
    this._locked = false;
    if(window.Papi && window.Papi.unlockScroll) window.Papi.unlockScroll();
    // NOT calling ScrollTrigger.refresh() here either — see
    // _completeDissolveHandoff's own comment; confirmed the same way,
    // refresh() actively repositions scrollY against this trigger's own
    // recalculated geometry rather than just passively re-measuring it
    this._wake();
  }

  _wake(){
    if(!this._state.rafId){
      this._state.rafId = requestAnimationFrame(this._frame.bind(this));
    }
  }

  // film grain, shown briefly while the wipe itself is in flight — a
  // parabola peaking at the wipe's own midpoint, silent at both ends.
  // Kept as a small nod to the old noise-dissolve's texture now that the
  // reveal itself is a clean directional wipe (see _runWipe); driven
  // from wipeT (0..1) rather than a dissolve amount
  _applyWipeGrain(wipeT){
    if(!this.grainEl) return;
    this.grainEl.style.opacity = String(4 * wipeT * (1 - wipeT) * 0.5);
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
      // covers the OTHER real case ("leaves the website") — a visitor
      // whose cursor just stops moving without ever actually leaving the
      // viewport (tabbing away via keyboard, or just walking away) never
      // fires the mouseleave listener above at all, so the camera would
      // otherwise sit frozen wherever the cursor last was indefinitely.
      // Re-centres the same mouseTarget the mouseleave handler does,
      // just gated on elapsed idle time instead of a leave event
      if(this._lastMouseMoveTs !== undefined && ts - this._lastMouseMoveTs > 3000){
        this.mouseTarget.x = 0;
        this.mouseTarget.y = 0;
      }
      const mouseFactor = 1 - Math.pow(1 - CONFIG.mouseLerp, dt / 16.6667);
      const progressFactor = 1 - Math.pow(1 - CONFIG.progressLerp, dt / 16.6667);
      this.mouse.x += (this.mouseTarget.x - this.mouse.x) * mouseFactor;
      this.mouse.y += (this.mouseTarget.y - this.mouse.y) * mouseFactor;
      this._state.displayProgress += (this._state.progress - this._state.displayProgress) * progressFactor;

      const { pos, look, seg, dollyT } = this._cameraForProgress(this._state.displayProgress);
      this._updateProcessStep(seg);
      this._updateEnterButton(dollyT);
      this._updateScrollLock(dollyT);
      // dollyT reaching 1 means the forward dolly has fully parked the
      // camera at revealCameraPos/Look — per direct request, nothing
      // should move from here (no mouse-parallax drift/rotation either)
      // until the visitor actually clicks the button: a visitor sizing
      // up a static "View Our Work" button while the room underneath it
      // keeps subtly swaying read as broken/distracting, not cinematic.
      // The mouse lerp itself still keeps advancing in the background
      // (see below) even while frozen, purely so there's no sudden catch
      // -up jump the moment this unfreezes again (see _playReverse,
      // which un-parks the camera by easing dollyT back down)
      if(dollyT >= 1){
        this.camera.position.copy(pos);
        this.camera.lookAt(look);
      } else {
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
      }
    } else {
      const { pos, look, seg } = this._cameraForProgress(0);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      this._updateProcessStep(seg);
      // reduced motion holds the room at its very first resting frame
      // (progress locked to 0 above) — the dolly/wipe is itself a
      // motion effect, so it stays off here the same way every other
      // animation in this file already does under this preference (see
      // _bindScrollTrigger, which never even creates the pin for these
      // visitors in the first place)
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

    // kept running continuously (not just during the dissolve) — see
    // _buildFluidSim's own comment for why
    this._stepFluidSim();

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

    // skipped once genuinely released — the container is hidden/clipped
    // to nothing at that point (see _completeDissolveHandoff), so there's
    // nothing left that a render could show differently. The render loop
    // itself still keeps running for the IntersectionObserver's own
    // ~300px bleed (idle animations like the rocket's bob/flicker still
    // update their own position/rotation underneath, harmlessly, in case
    // the visitor scrolls back up), but actually compositing that into a
    // full render — RenderPass, the separate bloom pass, the DoF pass,
    // the colour-grade pass, OutputPass, all of it — for a frame that's
    // invisible either way was real, pointless GPU cost sitting right at
    // the exact moment the visitor is trying to scroll through into
    // Section 2, which is exactly where it would read as "lag"
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
