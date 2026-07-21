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
import { Sky } from './vendor/examples/jsm/objects/Sky.js';
import { mergeVertices } from './vendor/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from './vendor/examples/jsm/postprocessing/BokehPass.js';

// REALISM PASS (per direct request — "everything still feels flat, not a
// Minecraft scene"): a real, CC0-photographed wood PBR set (Poly Haven's
// "Wood Floor Deck", img/textures/wood-deck/) replacing the wood-toned
// surfaces' previous flat MeshStandardMaterial.color + a fake sine-wave
// "grain" drawn in a shader. No amount of procedural noise reads as
// convincingly real as an actual photograph of wood grain/pores/knots —
// this is the single highest-leverage fix available without re-authoring
// geometry. NOTE: deliberately NOT using texture.clone() here — TextureLoader
// is async, so cloning a texture before its image has actually loaded
// copies an empty image, which WebGL then samples as solid black (this
// was hit and fixed directly: the first version of this rendered every
// wood surface near-black). A fresh loader per call avoids that; the
// browser's own HTTP cache dedupes the repeat network fetches for free
function loadWoodPBR(repeat){
  // DIAGNOSIS (per direct request — the first pick, "Wood Floor Deck," a
  // dark stained/weathered decking texture, rendered near-black under
  // this scene's deliberately dim single-sun lighting (envMapIntensity
  // 0.08, no fill light) — a ~0.2 average-luminance diffuse map times an
  // 8%-intensity bounce plus the applyRealism AO/wear stack crushes
  // straight to black. Swapped for "Laminate Floor 02," a genuinely light
  // honey-oak tone, which survives being multiplied down by this same
  // dim lighting instead of disappearing into it
  // PALETTE PASS (per direct request: "change the brown wood to a more
  // beige wood") — REVERTED the canvas-saturate-filter approach tried
  // first: it rendered "very dark" once actually checked live (this
  // scene's already-thin lighting margin, same class of issue as the
  // black-wood bug documented above, apparently punishes any extra
  // processing on this texture). Back to the plain, already-proven
  // TextureLoader diffuse; the beige shift now comes entirely from
  // stepMat/stoneMat's own .color tint below instead
  const map = new THREE.TextureLoader().load('img/textures/wood-light/diffuse.jpg');
  const normalMap = new THREE.TextureLoader().load('img/textures/wood-light/normal.jpg');
  const roughnessMap = new THREE.TextureLoader().load('img/textures/wood-light/roughness.jpg');
  map.colorSpace = THREE.SRGBColorSpace;
  [map, normalMap, roughnessMap].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  });
  return { map, normalMap, roughnessMap };
}

// BUG FIX (per direct request: "Add material to the rock so it actually
// look like a rock" — the procedural applyRealism wear/AO alone, with no
// underlying photographed surface, was reading as a plain tinted grey
// ball, not stone): a real CC0-photographed boulder PBR set (Poly Haven's
// "Rock 08", img/textures/rock/) mapped onto the icosahedron's own default
// spherical UVs. Same anti-clone-bug caution as loadWoodPBR above. repeat
// is low (2) because this is a single small object filling its own UV
// space once around, not a tiled surface like a wall/floor
function loadRockPBR(repeat){
  const map = new THREE.TextureLoader().load('img/textures/rock/diffuse.jpg');
  const normalMap = new THREE.TextureLoader().load('img/textures/rock/normal.jpg');
  const roughnessMap = new THREE.TextureLoader().load('img/textures/rock/roughness.jpg');
  const aoMap = new THREE.TextureLoader().load('img/textures/rock/ao.jpg');
  map.colorSpace = THREE.SRGBColorSpace;
  [map, normalMap, roughnessMap, aoMap].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  });
  return { map, normalMap, roughnessMap, aoMap };
}

// REALISM PASS (per direct request: "is there any material we can add,
// to make the walls more real, like texture on it"): a real CC0-
// photographed plaster PBR set (Poly Haven's "Plaster Grey 04",
// img/textures/wall-plaster/) — same technique and same anti-clone-bug
// caution as loadWoodPBR above. repeatX/repeatY are separate params
// (unlike the wood helper's single `repeat`) because this room's walls
// genuinely differ in real-world span — the back wall is ~14 units
// wide, the two side walls run ~60 — so each needs its own tile density
// to read as the same real plaster scale rather than stretched or
// tiny. Every caller gets its OWN fresh textures (no sharing/cloning),
// so each wall can set its own repeat independently
function loadWallPBR(material, repeatX, repeatY){
  // BUG FIX (per direct request: a screenshot of the far-left wall, seen
  // nearly edge-on from the establishing "Welcome" camera angle, showing
  // regular "lines"): investigated directly at length — ruled out shadow
  // acne (a real, separate issue also found and fixed at this same wall,
  // see nearWall's own receiveShadow comment), ruled out the analytic
  // bump/roughness noise in applyRealism (still showed with those zeroed
  // out), and ruled out the source photos themselves (both diffuse and
  // normal confirmed grain-free). What actually isolated it: swapping
  // this material's map/roughnessMap for FRESH THREE.Texture instances,
  // already fully loaded BEFORE ever being assigned to the material,
  // made the lines vanish outright — meaning the problem was never the
  // image or the repeat/anisotropy settings, only assigning an EMPTY,
  // still-loading texture straight into the material at construction
  // time (the old return-an-object-to-spread-in pattern always did
  // this). This now takes the material directly and only ever assigns
  // material.map/normalMap/roughnessMap once each texture's own image
  // has actually finished loading, matching the pattern that tested
  // clean — every wall using this now goes through a brief, one-time
  // plain-colour flash while its texture loads rather than ever
  // compiling/rendering against an incomplete one
  new THREE.TextureLoader().load('img/textures/wall-plaster/diffuse.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 16;
    material.map = t;
    material.needsUpdate = true;
  });
  new THREE.TextureLoader().load('img/textures/wall-plaster/normal.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 16;
    material.normalMap = t;
    material.needsUpdate = true;
  });
  new THREE.TextureLoader().load('img/textures/wall-plaster/roughness.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 16;
    material.roughnessMap = t;
    material.needsUpdate = true;
  });
}

// REALISM PASS (per direct request: "add this texture to the chair
// platforms/floor"): originally Poly Haven's "Rock Wall 15", swapped
// again per direct follow-up request (its own layered-strata pattern
// read too much like wood grain at a glance) for "Checkered Pavement
// Tiles" instead, img/textures/pavement-tiles/. Same deferred-
// assignment technique as loadWallPBR above (see its own comment for
// why — assigning a still-loading texture straight into a material at
// construction time is what actually caused that wall-banding bug, not
// the image or repeat settings)
function loadPavementPBR(material, repeat){
  new THREE.TextureLoader().load('img/textures/pavement-tiles/diffuse.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 16;
    material.map = t;
    material.needsUpdate = true;
  });
  new THREE.TextureLoader().load('img/textures/pavement-tiles/normal.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 16;
    material.normalMap = t;
    material.needsUpdate = true;
  });
  new THREE.TextureLoader().load('img/textures/pavement-tiles/roughness.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 16;
    material.roughnessMap = t;
    material.needsUpdate = true;
  });
}

// REALISM PASS (per direct request: "add any material to the chairs so
// they look more real"): a shared normal map (loaded once, reused by
// every chair — 34 of them, so a per-chair texture load would be
// wasteful) gives each painted seat/backrest a subtle real surface
// variation to catch light unevenly, instead of a perfectly smooth flat
// colour. Cached at module scope the same way as the wood normal map
let _chairNormalMap = null;
function getChairNormalMap(){
  if(!_chairNormalMap){
    _chairNormalMap = new THREE.TextureLoader().load('img/textures/wood-light/normal.jpg');
    _chairNormalMap.wrapS = _chairNormalMap.wrapT = THREE.RepeatWrapping;
    _chairNormalMap.repeat.set(1.6, 1.6);
  }
  return _chairNormalMap;
}

// BUG FIX (per direct request: "make sure that with all sizes of
// display, the image doesn't get stretched or shrunk"): the camera's
// vertical FOV was a flat, never-changing 45° regardless of the
// container's own aspect ratio — only camera.aspect itself updated on
// resize (see _resize). A PerspectiveCamera with a fixed vertical FOV
// never geometrically distorts/stretches anything (aspect alone can't
// do that), but it DOES change how much the composition's own
// horizontal extent (the arch, the chair pile, the stairs either side)
// fills the frame: a narrow phone-portrait viewport gets a much
// narrower horizontal FOV at the same 45° vertical, so the same
// composition reads as cropped-in/zoomed; a wide desktop or ultrawide
// window gets a much wider horizontal FOV, so the exact same
// composition reads as tiny/shrunk with empty space either side —
// which is exactly what read as "stretched or shrunk" across screen
// sizes even though nothing was ever literally stretched.
// fovForAspect keeps the room's own HORIZONTAL framing roughly
// constant across aspect ratios instead (the standard "Hor+" scaling
// technique) — CAMERA_BASE_FOV/CAMERA_BASE_ASPECT describe the
// reference frame (45° vertical at a 16:9 desktop aspect, close to
// what this whole room's own camera keyframes were actually composed
// against) and every other aspect solves for the vertical FOV that
// preserves that SAME horizontal field of view. Clamped to
// [CAMERA_MIN_FOV, CAMERA_MAX_FOV] rather than left unbounded — an
// unclamped solve blows up past ~110° on a real phone's own portrait
// aspect (~0.46), and a vertical FOV that extreme introduces its own
// heavy fisheye-style distortion at the edges of frame, trading one
// framing problem for a worse one
const CAMERA_BASE_FOV = 45;
const CAMERA_BASE_ASPECT = 16 / 9;
const CAMERA_MIN_FOV = 32;
const CAMERA_MAX_FOV = 62;
function fovForAspect(aspect){
  const baseHalfTan = Math.tan(THREE.MathUtils.degToRad(CAMERA_BASE_FOV / 2));
  const horizontalHalfTan = baseHalfTan * CAMERA_BASE_ASPECT;
  const verticalHalfTan = horizontalHalfTan / aspect;
  const fov = THREE.MathUtils.radToDeg(Math.atan(verticalHalfTan)) * 2;
  return THREE.MathUtils.clamp(fov, CAMERA_MIN_FOV, CAMERA_MAX_FOV);
}

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
  // COMPOSITION PASS (per direct request: "speed up the scroll
  // movement"): cut 4.5→3.2 — less physical scroll distance is required
  // to travel across the exact same 5-stop journey/dolly/hold, which is
  // what actually reads as "faster" (scrub ties progress directly to
  // scroll position; the only way to speed up the room's own reaction
  // to a given scroll gesture is to shrink how much scroll distance
  // that same 0..1 progress range spans)
  scrollMultiplier: 3.2,
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
// COMPOSITION PASS (per direct request: "move the ball further away from
// the stairs, from the chairs" then "move the ball way more back so
// there is room, I do not want everything together"): pushed further
// toward camera/front in two passes (2.0→4.3→6.5) — the chair pile and
// spiral stairs both now sit shallower too (z≈-2.3/-1.8, see their own
// position comments), so this keeps real separation from both rather
// than reading as three props crowded into the same middle distance
// BUG FIX (per direct request: "the water is making the rock look like
// its split in have" [sic]): y was exactly 0 — dead centre on the water
// plane — which put the rock's own equator (its single widest, roundest
// silhouette line) exactly at the waterline, the worst possible place
// for a hard air/water shading transition to land. Raised to 0.45 so a
// real, natural-looking cap sits below the surface (a rock resting in
// shallow water, mostly emerged) instead of a perfect equatorial slice
const SPHERE_POS = { x: 0, y: 0.45, z: 6.5 };

// the one colour the sky dome's own horizon band and the endless
// ocean's own distance-haze blend (see _buildEnvironment/_buildScene)
// are both built from, so the two actually meet at a consistent line
// rather than two independently-tuned effects that happen to be close
const HORIZON_HAZE_COLOR = 0xdccba8;

// the sun direction/colour the sky dome, cloud layer, and water's own
// specular glint all render against — frozen at a fixed snapshot on
// purpose. keyLight itself (see _buildEnvironment) is free to move for
// real shadow-casting/architectural-lighting purposes without dragging
// the visible sky, clouds, or the water's own locked-down optical model
// along with it — those three were previously wired to read
// keyLight.position/color live, which would have silently changed all
// of them the moment keyLight was repositioned. This is the one
// deliberate exception to "the sun everything reads from is keyLight"
// — the environment and water are both explicitly frozen, so they now
// read a fixed snapshot instead.
// GOLDEN-SUNSET PASS (per direct request): re-snapshotted at keyLight's
// CURRENT real bearing (normalize(keyLight.position - keyLight.target),
// ≈9.6° elevation) instead of its original ~34°. Diagnosis: after the
// architectural-lighting passes lowered keyLight for long dramatic
// shadows, this constant was never updated to match — the room was
// being lit like true late-afternoon sun while the visible sky/water
// glint still rendered as if the sun sat far higher (~34°, closer to
// mid-morning). That mismatch between the room's own real light
// direction and what the sky/water visually show is exactly the kind
// of thing that reads as "not quite real" even when every individual
// surface is well-rendered — a single coherent light source is one of
// the strongest cues for believability. Re-locking it to the actual
// current keyLight bearing (still a deliberate snapshot, still won't
// silently move if keyLight is retuned again later) closes that gap.
// Colour deepened slightly too (0xffd9a3→0xffc27a) for a richer,
// more saturated sunset gold rather than a pale peach
const LOCKED_SUN_DIR = new THREE.Vector3(-13.5, 2.3, 1.4).normalize();
const LOCKED_SUN_COLOR = 0xffc27a;

// shared GLSL — the wave spectrum's own directional/wavelength/amplitude
// data, factored out so both the vertex-displaced macro waves (below)
// and the fragment-only chop field (further down) draw from named
// per-component values instead of two unrelated hand-picked sine sets.
// Function-based (not a real array indexed by a loop variable) on
// purpose — some mobile GPU GLSL compilers still handle dynamically-
// indexed local arrays poorly, and an if-chain over a small compile-time
// constant count compiles to the same thing either way
const GERSTNER_PARAMS_GLSL = `
  const float GERSTNER_G = 2.2;
  vec2 macroDir(int i){
    if(i == 0) return normalize(vec2(1.0, 0.35));
    return normalize(vec2(-0.55, 1.0));
  }
  // longer and taller (was 26/17 units, 0.07/0.05 amplitude) per direct
  // request for "rolling, choppy swells, not a storm" — longer
  // wavelength is what actually reads as "rolling" (a real dispersion-
  // relation side effect too: c = sqrt(g/k) means longer waves move
  // faster but their PERIOD grows even more, since period = wavelength/
  // speed — these now complete a full cycle roughly every 9-11s instead
  // of 7-9s, a slower, more stately roll).
  // WATER-REFERENCE PASS (per direct request): amplitude pulled back
  // (0.11/0.08→0.05/0.035, roughly half) — the reference's own water is
  // calm/glassy, not rolling swell, and amplitude is the direct physical
  // "how tall" dial. Wavelength/direction/speed all untouched, so the
  // water still genuinely moves at the same stately pace as before —
  // this only makes each roll shallower, not slower or removed entirely
  //
  // CALM-MIRROR REFERENCE PASS (per direct request, new flooded-room
  // reference photo): cut again (0.05/0.035→0.028/0.02) — that photo's
  // own water is close to a dead-flat mirror, sharp enough to reflect the
  // architecture with almost no distortion. Wavelength/direction/speed
  // still untouched
  //
  // DEBUG FIX (per direct request: water "looks flat," "no visual
  // difference in height"): raised back up (0.028/0.02→0.075/0.055) —
  // this had gone TOO far toward flat; real height variation is what
  // actually reads as "real water with dimension" rather than "a flat
  // plane with a pattern painted on it." Landing above even the original
  // "calm/glassy" pass's own values on purpose: this room's water now
  // also needs to visibly break up its own reflection (see the mirror UV
  // distortion's own matching debug-fix comment) to stop large flat
  // areas reflecting one single bright point at once — genuine height
  // variation is the most honest way to get that, not just a shader trick
  float macroWavelength(int i){ return i == 0 ? 42.0 : 28.0; }
  float macroAmplitude(int i){ return i == 0 ? 0.075 : 0.055; }
  // raised (0.58/0.5→0.85/0.75) per direct request to "increase crest
  // compression so the water develops cleaner ridges instead of smooth
  // rounded bumps" — this is Gerstner's own steepness term (Q), which
  // pulls points horizontally toward the crest; it's neither an
  // amplitude nor a frequency, so it's the one wave-shape dial still in
  // scope.
  // WATER-REFERENCE PASS (per direct request): pulled back again
  // (0.85/0.75→0.4/0.35) alongside the amplitude drop above — a calm
  // glassy surface has rounded, gentle crests, not compressed sharp
  // ridges; this is the other half of undoing the earlier "choppy"
  // request now that the goal is the reference's own calmer water.
  // Self-intersection risk (Q×k×A) drops even further at this lower
  // amplitude, so this stays just as safe as before
  //
  // CALM-MIRROR REFERENCE PASS (per direct request): cut again
  // (0.4/0.35→0.22/0.2) alongside the amplitude drop above
  //
  // DEBUG FIX (per direct request): raised back up (0.22/0.2→0.42/0.36)
  // alongside the amplitude increase above — same reasoning, this is the
  // other half of "how tall/defined" a Gerstner wave reads as
  float macroSteepness(int i){ return i == 0 ? 0.42 : 0.36; }

  vec2 chopDir(int i){
    if(i == 0) return normalize(vec2(0.8, -0.7));
    if(i == 1) return normalize(vec2(-0.9, -0.4));
    return normalize(vec2(0.25, 0.95));
  }
  float chopWavelength(int i){
    if(i == 0) return 9.0;
    if(i == 1) return 6.0;
    return 4.2;
  }
  // these read as larger than the macro amplitudes above, which looks
  // backwards for real wave height (chop is normally the SMALLER end of
  // a spectrum) — but chop is never real displaced geometry (see
  // CHOP_GLSL's own comment), only a per-fragment shading-normal slope
  // input, so what actually matters is the resulting GRADIENT strength,
  // not a literal height. Tuned directly against that: on this short a
  // wavelength, a small, physically-modest height only produces a very
  // shallow slope (gradient ≈ height × 2π/wavelength), too faint to
  // read as real chop once blended into the shading normal.
  // WATER-REFERENCE PASS (per direct request): pulled back by roughly
  // half (0.19/0.13/0.085→0.09/0.06/0.04), the fine-scale counterpart to
  // the macro amplitude/steepness drop above — this is specifically the
  // layer that carried the earlier "choppy" request, so undoing that
  // request means this is the most direct dial for it. Not zeroed out
  // entirely: some fine gradient detail keeps the surface reading as
  // real moving water rather than a perfectly smooth mirror, which the
  // reference's own water still is, just glassy-calm rather than choppy
  //
  // CALM-MIRROR REFERENCE PASS (per direct request): cut again, roughly
  // half again (0.09/0.06/0.04→0.05/0.035/0.025) — the new flooded-room
  // reference's water is sharp enough to mirror the room's own
  // architecture almost distortion-free; what makes that water visually
  // rich isn't chop, it's the caustic dapple (see causticPattern's own
  // matching contrast pass) and the sharpened reflection sampling below
  float chopAmplitude(int i){
    if(i == 0) return 0.05;
    if(i == 1) return 0.035;
    return 0.025;
  }
`;

// real Gerstner waves — a directional, physically-parameterized
// replacement for the old Y-only sine displacement. Sine-only
// displacement is vertically symmetric (a "bumpy grid"); real ocean
// waves pull points HORIZONTALLY toward the crest as well, which is
// what actually produces the sharp-crest/broad-trough asymmetry that
// reads as real water rather than a sine grid. Speed is derived from
// the real deep-water dispersion relation (c = sqrt(g/k)) — longer
// waves genuinely travel faster, the same relationship real ocean swell
// follows, not an independently hand-picked speed per component. Only 2
// components (not the full 5-wave spectrum — see CHOP_GLSL below for
// the rest): resolving anything shorter than about 15-20 units as real
// geometry would need a vertex budget this single 3200-unit plane can't
// reasonably carry, so the shorter end of the spectrum is fragment-only
// detail instead, same split the room's own micro/macro material detail
// already uses elsewhere in this file
const GERSTNER_MACRO_GLSL = `
  ${GERSTNER_PARAMS_GLSL}
  vec3 gerstnerDisplace(vec2 xz, float t, out vec3 outNormal){
    vec3 disp = vec3(0.0);
    float nx = 0.0, nz = 0.0, ny = 1.0;
    for(int i = 0; i < 2; i++){
      vec2 d = macroDir(i);
      float k = 6.2831853 / macroWavelength(i);
      float speed = sqrt(GERSTNER_G / k);
      float q = macroSteepness(i);
      float a = macroAmplitude(i);
      float phase = k * dot(d, xz) - speed * k * t;
      float c = cos(phase);
      float s = sin(phase);
      disp.x += q * a * d.x * c;
      disp.z += q * a * d.y * c;
      disp.y += a * s;
      nx -= d.x * k * a * c;
      nz -= d.y * k * a * c;
      ny -= q * k * a * s;
    }
    outNormal = normalize(vec3(nx, ny, nz));
    return disp;
  }
`;

// the shorter end of the same spectrum (see GERSTNER_MACRO_GLSL's own
// comment for why it's split this way) — gradient only, no horizontal
// displacement and no height term (nothing here ever needs the raw
// height, only the slope of it), since this never becomes real
// geometry: it perturbs the water's own shading normal per-fragment
// (like a normal map would) AND warps the caustic pattern projected
// onto nearby architecture, so both respond to the exact same fine wave
// detail instead of two independently-animated effects that happen to
// look similar
const CHOP_GLSL = `
  ${GERSTNER_PARAMS_GLSL}
  vec2 chopGradient(vec2 xz, float t){
    vec2 g = vec2(0.0);
    for(int i = 0; i < 3; i++){
      vec2 d = chopDir(i);
      float k = 6.2831853 / chopWavelength(i);
      float speed = sqrt(GERSTNER_G / k);
      float c = cos(k * dot(d, xz) - speed * k * t) * chopAmplitude(i) * k;
      g += d * c;
    }
    return g;
  }
`;

// shared GLSL — a cheap fake-caustics pattern (two rotated, animated
// moiré sine grids multiplied together and thresholded) used both by the
// water shader itself (see _buildScene) and by applyRealism's own
// onBeforeCompile injection into nearby PBR materials, so the same light
// pattern reads consistently on the water's own surface and on whatever
// it's projecting onto (walls, stairs, the platform) rather than two
// unrelated effects that happen to both be called "caustics." Warped by
// the real CHOP_GLSL gradient above (the fine end of the spectrum, not
// the slow macro swell — real caustics dance with fine surface
// disturbance, not the slow broad undulation) so the caustics stay
// genuinely "driven by" the waves rather than just visually similar to
// them, and brighten where that surface's slope is changing fastest (a
// cheap stand-in for real focusing/lensing)
const CAUSTIC_GLSL = `
  ${CHOP_GLSL}
  // CALM-MIRROR REFERENCE PASS (per direct request, matching the flooded-
  // room reference photo): contrast sharpened (pow 3.0→4.5) — that
  // reference's own defining quality is bold, crisply-separated bright/
  // dark caustic dapple covering large stretches of both the water and
  // the walls, not a soft even wash. A steeper power curve is what turns
  // this same pattern's mid-tones dark while keeping its peaks bright,
  // which is what actually produces "crisp dapple" rather than "diffuse
  // glow" — same underlying lattice, sharper separation
  //
  // HEXAGON-CELL REFERENCE PASS (per direct request): the two-sine
  // moiré grid above is REPLACED entirely — under animation it reads as
  // a field of isolated twinkling points ("disco floor"), never the
  // connected, soft-edged cellular patches the reference photo shows.
  // Real underwater/pool-floor caustics come from a field of overlapping
  // wave-lenses focusing light into a NETWORK of light — the classic,
  // correct way to fake that is Voronoi/Worley cell noise, which
  // naturally tessellates into rounded, near-hexagonal cells rather than
  // a grid of independent dots. F1/F2 below are the distance to the
  // nearest and second-nearest feature point in a jittered grid; F2-F1
  // is small right at a cell BOUNDARY and large at a cell's own centre,
  // so thresholding it draws the bright connective net of light between
  // cells (where real focused light actually concentrates) instead of a
  // bright dot at each cell's centre
  vec2 caustic_hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }
  float causticPattern(vec2 p, float t){
    vec2 warp = chopGradient(p, t) * 3.0;
    vec2 pw = p + warp;
    vec2 ip = floor(pw);
    vec2 fp = fract(pw);
    float f1 = 8.0, f2 = 8.0;
    for(int y = -1; y <= 1; y++){
      for(int x = -1; x <= 1; x++){
        vec2 neighbor = vec2(float(x), float(y));
        vec2 cellId = ip + neighbor;
        vec2 pt = caustic_hash2(cellId);
        // each cell's own feature point drifts in a slow, gently
        // elliptical path (not just back-and-forth) so the whole cell
        // network genuinely animates rather than just fading in place —
        // real wave-lens focal points wander continuously, they don't
        // pulse on a fixed axis. Phase offset per-cell (dot(cellId,..))
        // keeps neighbouring cells from drifting in visible unison
        float phase = t * 0.18 + dot(cellId, vec2(12.9898, 78.233));
        pt += 0.28 * vec2(cos(phase + pt.x * 6.2832), sin(phase * 1.3 + pt.y * 6.2832));
        float d = length(neighbor + pt - fp);
        if(d < f1){ f2 = f1; f1 = d; }
        else if(d < f2){ f2 = d; }
      }
    }
    float edge = f2 - f1;
    float pattern = 1.0 - smoothstep(0.02, 0.4, edge);
    float focus = clamp(length(chopGradient(p, t)) * 6.0, 0.0, 1.0);
    return pattern * mix(0.75, 1.25, focus);
  }

  // REFLECTED-SUNLIGHT BANDS (per direct request) — a deliberately
  // SEPARATE phenomenon from causticPattern above, not a variant of it:
  // real sun-glint reflected off a moving water surface reads as broad,
  // soft, slow-drifting bands of light climbing nearby walls, distinct
  // from the fine dancing threads of real caustics (light focused
  // THROUGH the water). A static wall's own material has no live
  // per-pixel sample of the real water surface's normal to reflect
  // through, so this reconstructs the same underlying motion instead —
  // it reuses chopGradient (the identical wave-warp field driving both
  // the real water shader and causticPattern above) so it moves in the
  // same rhythm as the real water, sampled at a much LARGER spatial
  // scale, with a tighter smoothstep than the original single-octave
  // version (per follow-up request: the first pass was too faint to
  // read against the room's warmer post-HDRI-swap lighting) — a second,
  // slower cross-grain octave is blended in at lower weight so the bands
  // break up unevenly rather than looking like one uniform stripe
  // pattern, while staying softer than causticPattern's tight pow()-
  // sharpened focus lines. That's what keeps this reading as broad
  // moving bands rather than another, busier caustic pattern
  float waterReflectBand(vec2 p, float t){
    vec2 warp = chopGradient(p * 0.12, t * 0.5) * 3.0;
    float wave = sin((p.x * 0.32 + p.y * 0.1 + t * 0.16) * 6.2832 + warp.x * 2.5);
    float wave2 = sin((p.x * 0.21 - p.y * 0.07 + t * 0.11) * 6.2832 - warp.y * 2.0);
    float band = smoothstep(0.05, 0.65, wave) * 0.7 + smoothstep(0.1, 0.6, wave2) * 0.3;
    return clamp(band, 0.0, 1.0);
  }
`;

// injected once into every "grounded" PBR material near the water
// (walls, platform, stair treads, stepping stones, the traffic-light
// housing, the rocket, chairs) via onBeforeCompile — the practical,
// real-time-friendly stand-in for four separate asks at once: caustics
// projected onto nearby surfaces, contact/corner AO (screen-space SSAO
// was tried and removed earlier this session for a real temporal-
// flicker regression — see _buildPostProcessing's own comment — this is
// a per-pixel WORLD-POSITION-driven fake instead, which has no such
// flicker since it's not screen-space and doesn't recompute from
// scratch every frame from a noisy sample kernel), fine roughness/
// albedo noise for "imperfections, scratches, wear," and a distance-
// based desaturation depth cue alongside scene.fog. Every material gets
// its own uCausticsTime uniform (see this.realismMaterials, updated in
// _frame()) — material.customProgramCacheKey is required here because
// three.js's default program-cache key doesn't account for
// onBeforeCompile edits at all, so without it materials with different
// opts could silently share one compiled program
function applyRealism(material, opts){
  const o = Object.assign({
    albedoWear: 0.04,
    roughWear: 0.12,
    waterY: 0.1,
    causticHeight: 2.0,
    causticStrength: 0.09,
    // BUG FIX (per direct request: "the shapes on the water actually
    // show on the walls... reflectiveness we can add" — investigated
    // directly): causticPattern/waterReflectBand both sampled
    // vRealismWorldPos.xz everywhere, which is exactly right for a
    // roughly-horizontal surface (the platform, stair treads) but wrong
    // for a VERTICAL wall — a wall's world Z (the back wall) or world X
    // (the side walls) barely changes across its own visible face, so
    // the "2D" hexagon pattern was actually collapsing to a near-1D
    // slice, stretched into vertical streaks rather than real hexagon
    // dapple. causticPlane picks which two world-position axes the
    // pattern actually reads, per material's own real orientation —
    // 'xy' for the back wall, 'zy' for the side walls (both include y,
    // height, so the pattern varies going UP the wall, not just along
    // it), left at the original 'xz' default for horizontal surfaces
    causticPlane: 'xz',
    // REFLECTED-SUNLIGHT BANDS (per direct request) — see waterReflectBand's
    // own comment in CAUSTIC_GLSL for what this is and why it's a
    // separate phenomenon from the caustic terms above. 0 by default
    // (fully inert) and only opted into on wall/architecture materials
    // below, each with its OWN height falloff (reflectBandHeight) kept
    // independent from causticHeight — "much larger and softer" than
    // caustics means it needs room to reach further up a wall than the
    // caustic pattern does on that same material, not just a stronger
    // version of the same falloff curve
    reflectBandStrength: 0,
    reflectBandHeight: 2.5,
    // PREMIUM LIGHTING PASS (per direct request) — both defaults raised
    // together, shared across every material that doesn't override them:
    // aoStrength (0.16→0.21) deepens the contact grounding at every
    // water-line/corner junction in the room, the cheap analytic stand-in
    // this scene uses in place of real SSAO (see _buildPostProcessing's
    // own comment on why screen-space AO was tried and removed — it
    // flickered under camera motion; this height-based term has no such
    // temporal noise since it's a pure function of world position, not a
    // per-frame sample). desatStrength (0.1→0.15) and desatDistance
    // (16→13) both strengthen the room's existing distance-based
    // desaturation — real atmospheric-perspective depth cueing (colour
    // and contrast fading with distance), not fog: nothing gets hazier
    // or lower-contrast NEAR the camera, only progressively further away,
    // which is what gives an interior real front-to-back "push" without
    // ever reading as a literal mist filling the room
    aoHeight: 1.3,
    aoStrength: 0.21,
    desatStrength: 0.15,
    desatDistance: 13,
    // fine, high-frequency second noise octave layered on top of the
    // original coarse one — "micro-pores," not the same-scale blotches;
    // this is what actually keeps a close-up surface from reading as
    // perfectly smooth even where the coarse octave is near-flat
    microScale: 34,
    microStrength: 0.035,
    // a Fresnel-driven rim brightening — real hard edges on a real
    // object always catch a thin line of extra light (worn paint,
    // rounded machining, dust settling on the high point), which is
    // what reads as a "bevel" even though the geometry itself is still
    // perfectly sharp; approximating that per-pixel is far cheaper than
    // re-authoring every mesh with real bevelled geometry.
    // FINAL LIGHTING POLISH (per direct request): nudged 0.05→0.06 as a
    // shared default — a small, room-wide amount of extra dimensional
    // "pop" at every silhouette edge, which is what actually reads as
    // depth/form separation rather than a flatter cardboard-cutout look,
    // without touching overall brightness or contrast anywhere a rim
    // isn't present
    edgeStrength: 0.06,
    // subtle normal perturbation — see this function's own onBeforeCompile
    // for exactly how; deliberately small. The goal is only to give
    // specular highlights and grazing-angle light something to catch
    // unevenly across a surface (real physically-plausible micro-
    // shadowing), not to make any bump visibly readable as geometry
    bumpStrength: 0.022,
    // FINAL LIGHTING POLISH (per direct request) — see this function's
    // own onBeforeCompile for exactly how; 0 by default (fully inert,
    // zero visual/computational difference) and only opted into on the
    // room's large architectural surfaces (walls/platform/stairs/
    // stones), not props. This is what actually produces "smoother
    // light gradients across walls and surfaces": a flat wall lit by a
    // single directional light has a perfectly CONSTANT N·L everywhere
    // on its own face (no gradient at all is physically possible from
    // that alone), so every gradient a flat wall shows here otherwise
    // comes only from real cast shadows or the proximity lights'
    // falloff. This adds one more cheap, deliberately fake layer on top:
    // a gentle per-pixel warm/cool tint keyed to world X position
    // (keyLight enters from screen-left/-X), independent of any real
    // light calculation
    gradientWash: 0,
  }, opts);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticsTime = { value: 0 };
    material.userData.realismShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRealismWorldPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRealismWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRealismWorldPos;
        uniform float uCausticsTime;
        ${CAUSTIC_GLSL}
        float realismHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123); }
        float realismNoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = realismHash(i), b = realismHash(i + vec2(1.0, 0.0));
          float c = realismHash(i + vec2(0.0, 1.0)), d = realismHash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // subtle bump — none of these procedural meshes have a real
          // normal-map texture (or reliable UVs to sample one from), so
          // this perturbs the shading normal analytically instead: a
          // finite-difference gradient of the SAME noise field driving
          // the roughness/albedo micro-noise above (a pore that reads
          // slightly darker also isn't perfectly flat), pushed through a
          // world-up-derived tangent frame. That frame degenerates right
          // at normal ≈ world-up, which is exactly why the perturbation
          // strength stays tiny — any wobble from that is imperceptible
          // at this scale, and it only ever needs to affect how a
          // specular highlight/grazing light catches unevenly, not read
          // as an actual bump
          // BUG FIX (per direct request: "the faces facing us from the
          // left window look like there are lines... horizontal" —
          // investigated directly): this hardcoded .xz same as the old
          // caustic bug above it (see causticPlane's own comment) — on a
          // side wall, world X barely changes across the face, so this
          // noise field was degenerating the same way, just here it fed
          // the BUMP normal perturbation instead of the caustic pattern,
          // producing a wrong-axis streaky normal under this room's own
          // raking window light. o.causticPlane is the same per-material
          // "which two world axes this surface actually varies across"
          // picked for the caustic fix, reused here for consistency
          vec2 bumpUv = vRealismWorldPos.${o.causticPlane} * ${o.microScale.toFixed(1)};
          float bumpEps = 0.35;
          float h0 = realismNoise(bumpUv);
          float hx = realismNoise(bumpUv + vec2(bumpEps, 0.0));
          float hz = realismNoise(bumpUv + vec2(0.0, bumpEps));
          vec3 bumpUp = abs(normal.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 bumpTangent = normalize(cross(normal, bumpUp));
          vec3 bumpBitangent = normalize(cross(normal, bumpTangent));
          float dHdx = (hx - h0) / bumpEps;
          float dHdz = (hz - h0) / bumpEps;
          // BUG FIX (per direct request — a screenshot of the far-left
          // wall showing fine "lines," confirmed by direct diagnostic:
          // raycasting the exact pixel found real MeshStandardMaterial
          // geometry there with correct anisotropic filtering already
          // maxed out (16, the GPU's own ceiling) and a perfectly clean,
          // grain-free diffuse photo — ruling out both texture tiling
          // AND texture-filtering as the cause): this bump perturbation
          // is pure per-pixel analytic math, not a sampled texture, so
          // texture anisotropy/mipmapping can't filter it at all — at a
          // steep grazing angle this far from camera, this noise field's
          // own frequency (microScale=34) changes many times per screen
          // pixel with nothing to smooth it, which is exactly what
          // aliases into visible banding. A real texture mipmap would
          // fade its own fine detail out at distance automatically; this
          // analytic stand-in has no such built-in falloff, so one is
          // added by hand — fully strength within ~8 units of camera
          // (where the bump is actually meant to read), fully faded out
          // by ~20 (where it was only ever aliasing, never adding real
          // visible detail anyway)
          float bumpDist = distance(cameraPosition, vRealismWorldPos);
          float bumpFade = 1.0 - smoothstep(8.0, 20.0, bumpDist);
          normal = normalize(normal - (dHdx * bumpTangent + dHdz * bumpBitangent) * ${o.bumpStrength.toFixed(4)} * bumpFade);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float wearN = realismNoise(vRealismWorldPos.${o.causticPlane} * 6.0 + vRealismWorldPos.y * 3.0);
          float microN = realismNoise(vRealismWorldPos.${o.causticPlane} * ${o.microScale.toFixed(1)} + vRealismWorldPos.y * ${(o.microScale * 0.6).toFixed(1)});
          diffuseColor.rgb *= 1.0 - wearN * ${o.albedoWear.toFixed(3)} - microN * ${o.microStrength.toFixed(3)};
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float roughN = realismNoise(vRealismWorldPos.${o.causticPlane} * 9.0 - vRealismWorldPos.y * 4.0);
          float roughMicro = realismNoise(vRealismWorldPos.${o.causticPlane} * ${(o.microScale * 1.4).toFixed(1)} - vRealismWorldPos.y * ${(o.microScale * 0.8).toFixed(1)});
          roughnessFactor = clamp(roughnessFactor + (roughN - 0.5) * ${o.roughWear.toFixed(3)} + (roughMicro - 0.5) * ${(o.microStrength * 1.6).toFixed(3)}, 0.05, 1.0);
        }`)
      .replace('#include <output_fragment>', `
        {
          float heightAboveWater = vRealismWorldPos.y - ${o.waterY.toFixed(3)};
          float causticFade = 1.0 - smoothstep(0.0, ${o.causticHeight.toFixed(2)}, max(heightAboveWater, 0.0));
          float caustic = causticPattern(vRealismWorldPos.${o.causticPlane} * 0.55, uCausticsTime);
          // REFERENCE-MATCH PASS (per direct request/reference comparison):
          // retinted warm gold (was a cool green-white, vec3(0.85,0.95,0.82))
          // — the reference's own dapple pattern climbing the walls reads
          // unmistakably warm/sunlit, never cool-toned. Kept distinct from
          // reflectBand's own deeper saturated amber below (this is a
          // paler, softer gold) so the two still read as two different
          // phenomena, just no longer on opposite ends of the colour wheel
          outgoingLight += caustic * causticFade * ${o.causticStrength.toFixed(3)} * vec3(1.1, 1.0, 0.78);
          // REFLECTED-SUNLIGHT BANDS — deliberately kept separate from
          // the caustic block above: its own height falloff variable
          // (reflectBandHeight, independent of causticHeight), its own
          // broader/softer spatial function (waterReflectBand, not
          // causticPattern), and its own warm sun-tint colour (not the
          // caustic's cooler green-white) so the two read as two
          // different physical phenomena rather than one term twice
          // SUN-CONTRAST PASS (per direct request): tint pushed more
          // saturated/golden (1.0,0.8,0.5 → 1.15,0.72,0.32, R pushed
          // past 1.0 on purpose) — the old tone sat almost exactly on
          // top of this room's other warm fill sources (the opening/
          // bounce point lights, the wall's own gradientWash), so even
          // where visible it read as "more of the same ambient" instead
          // of a distinct glint. A hotter, more saturated gold reads as
          // its own light source rather than blending in, and the >1.0
          // R channel gives it a genuine "glowing highlight" quality
          // once ACES compresses it, rather than just a flat tint
          float reflectFade = 1.0 - smoothstep(0.0, ${o.reflectBandHeight.toFixed(2)}, max(heightAboveWater, 0.0));
          float reflectBand = waterReflectBand(vRealismWorldPos.${o.causticPlane} * 0.4, uCausticsTime);
          outgoingLight += reflectBand * reflectFade * ${o.reflectBandStrength.toFixed(3)} * vec3(1.15, 0.72, 0.32);
          float aoFade = 1.0 - smoothstep(0.0, ${o.aoHeight.toFixed(2)}, max(heightAboveWater, 0.0));
          outgoingLight *= 1.0 - aoFade * ${o.aoStrength.toFixed(3)};
          // Fresnel rim — see edgeStrength's own comment. normal/
          // vViewPosition are both already in view space by this point
          // in the standard fragment template, so a plain dot product
          // is enough, no extra transforms needed
          float rim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 4.5);
          outgoingLight += vec3(1.0, 0.98, 0.94) * rim * ${o.edgeStrength.toFixed(3)};
          // gradient wash — see gradientWash's own comment above. sunSide
          // is 1 near the sunlit/-X wall, 0 near the far/+X side, with a
          // wide smoothstep (well past the room's own ±7 bounds) so it
          // never fully saturates right at either wall face — the point
          // is a gentle whole-surface gradient, not a hard-edged split.
          // Multiplicative against a near-1.0 tint (0.96-1.02 range) so
          // at gradientWash=0 this line is a no-op (mix collapses to
          // vec3(1.0)) and even at full strength it stays a tint, never
          // a real brightness swing
          float sunSide = 1.0 - smoothstep(-9.0, 9.0, vRealismWorldPos.x);
          vec3 washTint = mix(vec3(0.965, 0.985, 1.02), vec3(1.02, 1.0, 0.96), sunSide);
          outgoingLight *= mix(vec3(1.0), washTint, ${o.gradientWash.toFixed(3)});
          float camDist = distance(cameraPosition, vRealismWorldPos);
          float desat = clamp(camDist / ${o.desatDistance.toFixed(2)}, 0.0, 1.0) * ${o.desatStrength.toFixed(3)};
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          // ART-DIRECTION POLISH (per direct request): this used to mix
          // toward pure neutral vec3(lum) — technically correct
          // desaturation, but a real warm-lit interior's own aerial
          // perspective doesn't fade to neutral grey, it fades toward
          // the room's own ambient/sky tone. A faint warm-light lift on
          // the desaturated target (not the real colour, just what it
          // fades TOWARD) is what keeps distant surfaces feeling lit by
          // the same warm sun rather than sliding toward a cool/flat
          // grey — still zero effect at desat=0, and still no fog: nothing
          // brightens or hazes, only what far surfaces desaturate into
          vec3 hazeTone = vec3(lum) * vec3(1.035, 1.015, 0.97);
          outgoingLight = mix(outgoingLight, hazeTone, desat);
        }
        #include <output_fragment>`);
  };
  material.customProgramCacheKey = () => 'realism-' + JSON.stringify(o);
  return material;
}

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

// a small rounded, bevelled panel — the seat and backrest below are
// both built from this same helper (an ExtrudeGeometry from a rounded-
// rectangle Shape, with a REAL bevelled edge via bevelEnabled, not a
// faked shader rim) rather than a raw unbevelled box. Centred on its
// own local origin on all three axes (geo.center()) so callers can
// treat its extrude axis (local Z, the panel's own "thickness") as
// whichever world axis they need it to be, just by rotating the mesh
function buildRoundedPanelGeometry(width, height, thickness, cornerRadius, bevelSize){
  const hw = width / 2, hh = height / 2, r = Math.min(cornerRadius, hw, hh);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize: bevelSize,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.center();
  return geo;
}

// a small, stylized chair — still built from the same simple-primitive
// spirit as everything else in this room (not a sculpted/detailed
// model), but with real proportions instead of raw unbevelled boxes: a
// bevelled seat panel, a bevelled backrest that's genuinely curved (a
// shallow parabolic bow across its own width, with vertex normals
// recomputed afterward so lighting actually responds to the curve —
// not a flat plane) and reclined a few degrees the way a real chair
// back both cradles a body and leans back rather than standing bolt
// upright, and tapered round legs (narrower at the floor than at the
// seat, the way real turned/machined legs almost always are) rather
// than a uniform-radius cylinder. Overall footprint/height kept close
// to the old box version on purpose — the whole pile's own hand-placed
// positions/rotations (see _buildChairPile) were tuned against those
// proportions, and this is a geometry-only pass. Returns a Group so a
// whole chair can be positioned/rotated as one unit, same as before
// rand (optional) — the caller's own seeded PRNG (see _buildChairPile),
// threaded through so each chair gets a small, reproducible hue/
// lightness/roughness jitter on top of its base swatch. Per direct
// request ("slight color and material variation so they don't look
// duplicated") — the pile already uses several distinct hex colours,
// but this makes every single chair its own material instance instead
// of visibly reusing one of a handful of exact swatches
function buildChairGroup(color, rand){
  const group = new THREE.Group();
  const c = new THREE.Color(color);
  if(rand){
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    hsl.h = (hsl.h + (rand() - 0.5) * 0.03 + 1) % 1;
    hsl.s = THREE.MathUtils.clamp(hsl.s + (rand() - 0.5) * 0.12, 0, 1);
    hsl.l = THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.08, 0.03, 0.97);
    c.setHSL(hsl.h, hsl.s, hsl.l);
  }
  // REALISM PASS (per direct request): MeshPhysicalMaterial with a
  // real clearcoat — a painted/lacquered chair always has that thin,
  // slightly separate glossy top layer over the base colour, which is
  // exactly what reads as "real paint" instead of a flat matte plastic
  // swatch. normalMap adds real (if subtle) surface variation on top
  const mat = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: rand ? 0.58 + rand() * 0.22 : 0.65,
    metalness: 0.08,
    clearcoat: 0.4,
    clearcoatRoughness: 0.28,
    normalMap: getChairNormalMap(),
    normalScale: new THREE.Vector2(0.25, 0.25),
  });
  group.userData.chairMaterial = mat;
  const seatH = 0.46;

  // seat — rotated flat so the panel's own extrude/thickness axis
  // (local Z) becomes the seat's vertical (thin) dimension, the same
  // -PI/2-about-X convention already used elsewhere in this file for
  // laying a shape flat (see the water Reflector's own floor.rotation.x)
  const seatGeo = buildRoundedPanelGeometry(0.48, 0.48, 0.055, 0.05, 0.008);
  const seat = new THREE.Mesh(seatGeo, mat);
  seat.rotation.x = -Math.PI / 2;
  seat.position.y = seatH;
  group.add(seat);

  // backrest — same bevelled-panel base, bowed and reclined (see this
  // function's own comment above)
  const backWidth = 0.46, backHeight = 0.5;
  const backGeo = buildRoundedPanelGeometry(backWidth, backHeight, 0.045, 0.06, 0.007);
  {
    const pos = backGeo.attributes.position;
    const hw = backWidth / 2;
    const curveDepth = 0.028;
    for(let i = 0; i < pos.count; i++){
      const t = THREE.MathUtils.clamp(pos.getX(i) / hw, -1, 1);
      pos.setZ(i, pos.getZ(i) + curveDepth * (1 - t * t));
    }
    pos.needsUpdate = true;
    backGeo.computeVertexNormals();
  }
  const back = new THREE.Mesh(backGeo, mat);
  back.rotation.x = -0.12;
  back.position.set(0, seatH + backHeight / 2, -0.215);
  group.add(back);

  [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.017, seatH, 10), mat);
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

// a soft, dark, radial-gradient decal — real contact shadow (the tight,
// dark accumulation right where an object actually touches a surface)
// rather than only the existing soft directional shadow, which is
// deliberately broad/blurry (see keyLight's own comment — "real
// sunlight through a window this size isn't a razor-sharp shadow
// edge"). A second discrete light or SSAO would double-serve that same
// job (SSAO was already tried and removed earlier for a real temporal-
// flicker regression — see _buildPostProcessing's own comment); a
// static decal mesh has neither problem and costs nothing extra to
// render every frame
function buildContactShadowTexture(size){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// a soft dark decal dropped flat at a contact point — see
// buildContactShadowTexture's own comment for why this exists alongside
// the real directional shadow rather than instead of it. transparent/
// depthWrite:false/polygonOffset so it sits flush against the surface
// it's grounding an object onto without z-fighting; not lit (a shadow
// decal darkening BY a fixed amount reads correctly regardless of the
// surface's own lighting, the same way a real contact shadow does)
function buildContactShadowDecal(texture, width, depth, opacity){
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: opacity !== undefined ? opacity : 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
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
// anywhere on the surface.
//
// BUG FIX (per direct request: vertical banding specifically on the
// RECESSED surfaces — the left windows' reveals, the central arch's
// reveal, the tall rectangular slit's reveal — root-caused directly):
// the (x,y)-only projection above is correct for the front/back CAP
// faces (their local z is constant across the whole face, so x/y fully
// describes them) but wrong for the reveal/side-wall faces ExtrudeGeometry
// also generates around every hole and the outer perimeter — those
// faces are where z (the wall's own thickness direction) is what
// actually varies, while x and y each stay almost constant along one
// axis of that face. Feeding them a UV formula that ignores z entirely
// collapses their real "into the wall" dimension to a single, zero-width
// texture coordinate — sampling one infinitely-thin slice of the
// texture stretched across a real physical surface, which is exactly
// what aliases into tight, regular vertical stripes. Now branches on
// each vertex's own face normal (already present on the geometry
// straight out of ExtrudeGeometry, before merge/recompute): near-flat
// ±Z normals are a cap face (unchanged x/y projection); anything else is
// a reveal/side face, given a proper 2D projection of its own two REAL
// varying axes (the edge direction plus z/depth) instead
function normalizeWallUV(geometry, minX, width, height){
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  const nrmAttr = geometry.attributes.normal;
  for (let i = 0; i < posAttr.count; i++){
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const nz = nrmAttr ? nrmAttr.getZ(i) : 1;
    if(!nrmAttr || Math.abs(nz) > 0.5){
      // cap face — the original, already-correct planar projection
      uvAttr.setXY(i, (x - minX) / width, y / height);
    } else {
      const nx = nrmAttr.getX(i), ny = nrmAttr.getY(i);
      if(Math.abs(nx) >= Math.abs(ny)){
        // a vertical jamb (left/right edge of a hole, or the wall's own
        // outer vertical edge) — varies along height (y) and depth (z).
        // BUG FIX (per direct request: eliminate vertical banding on the
        // recess/reveal faces): the depth axis used to be normalized by
        // wallThickness (~0.45 units) while the cap face's own repeat
        // (texture.repeat.y, tuned for the whole roomHeight) stayed
        // shared across both — root-caused via a live raycast/camera
        // teleport directly onto a window reveal, screenshotted in
        // isolation: reusing that same repeat over a dimension ~20x
        // smaller than what it was tuned for packed ~20x too many
        // texture tiles into the reveal's actual physical depth, which
        // is what actually read as fine "wood grain" stripes. Depth is
        // physically tiny compared to the wall it's cut into, so it
        // should read as a sliver of ONE tile, not its own repeating
        // range — normalizing it against `height` (the same reference
        // the paired y/height axis already uses) keeps the tile's real-
        // world size consistent with the cap faces instead of rescaling
        // it to fill 0..1 on its own
        uvAttr.setXY(i, y / height, z / height);
      } else {
        // a horizontal sill/lintel (top/bottom edge of a hole, or the
        // wall's own top/bottom edge) — varies along width (x) and
        // depth (z); same fix as above, normalized against `width` to
        // match the paired (x-minX)/width axis
        uvAttr.setXY(i, (x - minX) / width, z / width);
      }
    }
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
    // raised from the old 0.8 — that dark/cinematic mood fought the
    // "premium architectural visualization, unseen.co-bright" look this
    // relight pass targets; ACES's own highlight rolloff is still what
    // keeps this from blowing out now that a real sun + sage ambient are
    // both doing more work than the flat HDRI-only fill used to
    //
    // SUN-CONTRAST PASS (per direct request): trimmed back down
    // (0.98→0.88) alongside keyLight's own intensity bump above —
    // sunlit walls were sitting far enough into ACES's compressive
    // highlight shoulder that additive detail (the water reflect-bands)
    // was getting visually absorbed there. A touch less global exposure
    // gives sunlit surfaces more headroom before that compression kicks
    // in, without needing to touch any single light's own intensity to
    // get it
    //
    // SINGLE-SUN LIGHTING PASS (per direct request): raised back up
    // (0.88→1.15) now that keyLight really is the only thing lighting
    // this room (every fill light removed, every material's own
    // envMapIntensity cut to near-nothing, see this room's own
    // _buildEnvironment/_buildScene comments) — with that much of the
    // room's old light budget gone, the whole scene read too dark/muddy
    // rather than "one bright sun, real shadow elsewhere." ACES's own
    // highlight rolloff means this lifts the darker/mid-tone areas
    // (still catching a little direct or grazing light) proportionally
    // more than surfaces already sitting in the compressive highlight
    // range, which is what actually fixes "muddy," not just "brighter
    // everywhere equally"
    renderer.toneMappingExposure = 1.15;
    this.enabled = true;

    this.scene = new THREE.Scene();
    // faint, far-reaching fog only — depth cue, not a mood-setting haze
    // by itself. Retinted from the old warm-gold toward the room's own
    // sage-green identity (#B7C8BE) per direct request
    this.scene.fog = new THREE.FogExp2(0xb7c8be, 0.009);

    // far raised from 60 to 2400 — the room itself only ever needed 60,
    // but the sky dome (radius 2000, see _buildEnvironment) and the now-
    // endless ocean floor (see _buildScene) both need to sit well inside
    // the camera's own frustum or they'd simply get clipped away
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2400);
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
    // every material applyRealism() (see its own comment) has been
    // wired into — _frame() walks this once a frame to advance each
    // one's own uCausticsTime uniform
    this._realismMaterials = [];
    // shared by every contact-shadow decal (see buildContactShadowDecal)
    // added below — one canvas texture, reused rather than rebuilt per
    // object
    this._contactShadowTex = buildContactShadowTexture(256);

    this._buildScene();
    this._buildChairPile();
    this._buildSpiralStairs();
    this._buildEye();
    this._buildDustParticles();
    this._buildKeyframes();
    this._buildEnvironment();
    this._buildPostProcessing();

    // this EffectComposer pipeline ends in OutputPass (see
    // _buildPostProcessing), which tonemaps the whole composited frame
    // once, correctly. But every material's own shader ALSO carries a
    // `#include <tonemapping_fragment>` (auto-injected into every
    // built-in material, and explicitly written into the custom water/
    // Sky.js shaders) that three.js applies during the very first
    // RenderPass — completely independent of render target. The
    // colour-space conversion chunk right next to it correctly no-ops
    // when rendering to an offscreen target (confirmed by reading the
    // vendored source: it swaps to the linear working colour space
    // whenever renderer.getRenderTarget() !== null), but tonemapping has
    // no equivalent guard, so it genuinely runs TWICE — once per-
    // material here, once more in OutputPass. Applying ACES twice barely
    // shows on the room's own modest, sub-1.0 material outputs, but it
    // crushes anything genuinely HDR (this scene's own Sky.js sky, whose
    // Preetham scattering model intentionally outputs values well over
    // 1.0 near the sun) into a flat, desaturated white — this, not
    // "physically correct horizon haze," is what was actually behind
    // the exterior reading as a flat white background. Every material
    // in the scene gets toneMapped=false here so OutputPass is the ONLY
    // place tonemapping happens, exactly once, for the whole frame
    this.scene.traverse((obj) => {
      if(!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => { mat.toneMapped = false; });
    });

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
    // COMPOSITION PASS (per direct request: "make the windows a lot
    // taller, from every opening"): archHeight raised 5.4→7.2 — plenty
    // of headroom in a 14-unit-tall room
    const archWidth = 3.6, archHeight = 7.2;

    // light sky-blue plaster — a deliberate departure from the old warm
    // cream, per direct request. No normal map here any more — the
    // patch normal map that used to sit here (a few sine-wave bump
    // patches meant to read as weathered plaster) instead read as small
    // dark "blister" circles under this scene's raking light, which is
    // what prompted removing it rather than retuning it again
    const wallMat = new THREE.MeshStandardMaterial({
      // REFERENCE-MATCH PASS (per direct request, comparing directly
      // against the flooded-room reference image): every wall in the
      // reference is the SAME plaster — the apparent "different colour
      // per wall" is entirely a lighting effect (sun beam patches,
      // caustic dapple, soft AO), not different paint. The earlier tan/
      // sage per-wall split (leftWallMat/rightWallMat below) was solving
      // the wrong problem — reverted to one shared colour.
      // PALETTE PASS (per direct request: "the color of the walls should
      // be the same color as the reference image, more light green, so
      // the aesthetic can remain"): retinted from a warm greige to a
      // light sage-green — keeping this room's established green palette
      // (see _buildEnvironment's fog/hemisphere tint) rather than the
      // warmer neutral tried first
      // VERIFY PASS: 0xc9d6c6 (a pale, barely-green tint) got multiplied
      // toward tan/brown once the warm keyLight colour (0xffcb8f) and
      // the warm-gold caustic dapple retint both multiply against it, so
      // it was pushed to a more saturated 0x9fc79a to hold its hue.
      // PALETTE PASS (per direct request: "it needs to be a lot more
      // lighter, think of a like #E0FFFF color"): lightened again,
      // toward that pale cyan-white reference while keeping a hint of
      // the room's own green
      //
      // BUG FIX (per direct request: "the walls have a nice texture to
      // it, but the color made the walls darker" — the real photographed
      // plaster diffuse map (loadWallPBR) is a mid-grey photo, and
      // MeshStandardMaterial multiplies base color × map per channel —
      // 0xdff5ef × a ~0.5-grey texture lands noticeably darker than this
      // color alone ever read before the texture was added. VERIFY PASS:
      // even pure white still rendered visibly brown — root-caused (see
      // keyLight's own comment in _buildEnvironment) to this room's ONE
      // light source being a fairly saturated orange at high intensity,
      // which was fixed there directly (0xffcb8f→0xffe4c8) rather than
      // by fighting it with material colour alone.
      // TEXTURE SWAP (per direct request): the old grey "Plaster Grey 04"
      // photo is gone, replaced with Poly Haven's white_rough_plaster
      // (https://polyhaven.com/a/white_rough_plaster) — a genuinely
      // white/bright source photo rather than a mid-grey one, so this
      // colour has far less darkening to fight against to begin with.
      // With that brighter texture AND the paler keyLight both landed,
      // TEXTURE SWAP (per direct request): replaced again with Poly
      // Haven's Blue Plaster Wall (all three wall materials clone this
      // one, see leftWallMat/rightWallMat below). The old 0xe6fff2 mint
      // tint was chosen to complement the PREVIOUS (warm white) plaster
      // photo — left in place, it multiplies against this new texture's
      // own real blue-grey colour and muddies it toward a murky olive,
      // the same "unmultiplied colour" issue already solved for
      // sphereMat/platformMat's own real textures. White lets the
      // photograph's real colour come through directly instead
      color: 0xffffff, roughness: 0.92, metalness: 0.02,
      // REALISM PASS (per direct request: "is there any material we can
      // add, to make the walls more real, like texture on it") — the
      // procedural dappled-shadow canvas (a fake lighting pattern, not
      // real surface detail) is gone, replaced with a real photographed
      // plaster PBR set (loadWallPBR, called just below once this
      // material exists — see its own comment for why it's applied
      // after construction rather than spread in here). This back wall
      // spans ~14 world units, so repeat is tuned for that; leftWallMat/
      // rightWallMat below load their own textures at a higher repeat
      // (their walls run ~60 units) rather than sharing this instance
      // moderate, not the 1.0 default — a large, rough, undecorated
      // surface like this one sampling a blurry low mip of the HDRI's
      // prefiltered (PMREM) chain is what exposed that chain's own mip
      // seams as visible soft banding earlier this session (confirmed by
      // zeroing this value and watching the bands vanish). Enough here
      // to genuinely tint the wall with the environment's true bounce
      // colour, not so much that the banding comes back
      //
      // SUN-CONTRAST PASS (per direct request): cut again (0.45→0.22) —
      // an HDRI environment map has no concept of "which wall is on the
      // sunlit side"; every wall face samples the same bright dome
      // overhead regardless of which way it's actually facing relative
      // to keyLight. That's exactly why the LEFT wall and the BACK/arch
      // wall (the one directly ahead of camera) were both reading nearly
      // as bright as each other even though only one of them should ever
      // catch real directional sun — this ambient term was doing enough
      // of the total lighting to erase that difference. Halving it lets
      // keyLight's own directional falloff actually read as the
      // dominant signal on these surfaces instead of competing with it
      //
      // SINGLE-SUN LIGHTING PASS (per direct request): cut hard
      // (0.22→0.05) — the diagnostic pass that disabled this entirely
      // confirmed it as the actual root cause of "every wall a different
      // shade" (opposite-facing walls sample opposite halves of the same
      // non-uniform photographed sky).
      // REALISM PASS (per direct request — "not a Minecraft scene,"
      // debugging why everything still looks flat): raised back up
      // partway (0.05→0.12). At 0.05 this wasn't just "a faint texture-
      // life detail" anymore — any surface facing away from keyLight
      // (the far side of the spiral stairs' own pole, deep corners) had
      // NOTHING else lighting it and rendered as literal crushed black,
      // which reads as "unlit game asset," not "real room in shadow" —
      // real shadow always keeps a sliver of bounce light. The walls'
      // own left/right differentiation now comes from a real colour
      // difference (leftWallMat/rightWallMat, see below), not from
      // lighting alone, so this can come back up without re-introducing
      // the original "every wall reads the same" bug
      envMapIntensity: 0.12,
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
    loadWallPBR(wallMat, 5.5, 5.5);
    // BUG FIX (per direct request: "remove all grooves, ridges, and
    // fluted detailing from the wall recesses — completely flat and
    // smooth"): zeroed out entirely. The normal map was the source of
    // the visible ridging on the arch/window recess faces; rather than
    // keep chasing a subtler fix, this removes its contribution outright
    // — normalScale 0 means the normal map still loads (harmless) but
    // never perturbs the shading normal, so every wall surface shades
    // off its own plain geometric normal only, guaranteed flat
    wallMat.normalScale.set(0, 0);
    // causticHeight/causticStrength raised (2.4→3.0, default 0.09→0.16)
    // per direct request to "increase moving caustics across the walls,
    // columns, platform, and stairs" — reaches higher up the wall and
    // reads more strongly, part of making the room feel lit BY the
    // water rather than separately
    //
    // ART-DIRECTION POLISH (per direct request, benchmarked against a
    // reference archviz image): raised once more (3.0→3.8, 0.16→0.22) —
    // the reference's single most defining quality is dappled water-
    // caustic light climbing well up the walls, not staying confined to
    // a narrow band right at the waterline; this is the room's own
    // existing version of that same technique, just given more reach
    // and presence rather than a new effect. albedoWear/roughWear also
    // raised off the shared defaults specifically here (0.04→0.06,
    // 0.12→0.16) — "walls should feel like painted plaster rather than
    // a flat shader": restrained, but the room's single largest, flattest
    // surface is exactly where that read matters most
    // REFLECTED-SUNLIGHT BANDS (per direct request): the primary target
    // — "the walls are not receiving visible reflected sunlight from
    // the water." reflectBandHeight (5.5) deliberately reaches well
    // past this wall's own causticHeight (3.8) — broad reflected-sun
    // bands should climb further up a real wall than the finer caustic
    // dapple does
    // CALM-MIRROR REFERENCE PASS (per direct request): causticHeight/
    // causticStrength both raised again (3.8→5.5, 0.22→0.38) — the new
    // flooded-room reference's own walls show bold, high-contrast caustic
    // dapple reaching almost floor-to-ceiling, not a narrow band; reach
    // now matches reflectBandHeight since both effects should climb
    // roughly as far up this, the room's own tallest/most visible wall
    //
    // BUG FIX (per direct request: "the water looks like its just shapes
    // in jello" — investigated directly): a large share of that "jello"
    // read turned out to be this same bold wall caustic pattern, mirrored
    // back at full strength by the water's own highly reflective surface
    // — the walls and their reflection were both showing the same bold
    // hex lattice at once. causticStrength/reflectBandStrength both cut
    // back down (0.38→0.16, 0.42→0.2) alongside the water shader's own
    // matching cut (see its causticPattern call) so neither the wall nor
    // its reflection carries that pattern at the old, now-excessive
    // strength
    this._realismMaterials.push(applyRealism(wallMat, { aoHeight: 1.9, aoStrength: 0.28, causticHeight: 5.5, causticStrength: 0.16, reflectBandHeight: 5.5, reflectBandStrength: 0.2, albedoWear: 0.06, roughWear: 0.16, gradientWash: 0.55, causticPlane: 'xy' }));

    // WALL-PALETTE REVERSAL (per direct request, comparing against the
    // reference image): the earlier "each wall its own paint colour" pass
    // was solving the wrong problem — every wall in the reference is the
    // SAME plaster; what makes them look different there is a hard sun-
    // beam patch thrown through the window openings onto the opposite
    // wall, warm caustic dapple near the waterline, and soft AO, none of
    // which existed here yet. Reverted to one shared colour (still
    // separate material INSTANCES, not merged back into literally one
    // material — kept that way so left/right can still carry their own
    // independent realism tuning below — just no longer a different base
    // .color)
    const leftWallMat = wallMat.clone();
    // these side walls run ~60 world units (sideWallFront+sideWallBack,
    // see the wall-build block below) vs. the back wall's ~14 — cloning
    // wallMat copies its texture REFERENCES too, which would tile the
    // back wall's own repeat count across a wall 4x longer (badly
    // stretched). Fresh, independently-scaled textures instead
    // BUG FIX (per direct request: "the faces facing us from the left
    // window look like there are lines... horizontal"): repeat cut
    // 22→10 and normalScale cut 0.75→0.35 — the real fix was the
    // causticPlane wiring into applyRealism's wear/micro/bump terms
    // above (they were degenerating to a near-1D noise field on these
    // side walls), but a 22x tile repeat under this room's own strong
    // grazing window light was ALSO exaggerating the plaster photo's own
    // fine grain into a much more regular, "engineered" stripe pattern
    // than a real wall would show — both together is what made it read
    // as an obvious artifact rather than plaster texture
    loadWallPBR(leftWallMat, 10, 5.5);
    leftWallMat.normalScale.set(0, 0);
    this._realismMaterials.push(applyRealism(leftWallMat, { aoHeight: 1.9, aoStrength: 0.28, causticHeight: 5.5, causticStrength: 0.16, reflectBandHeight: 5.5, reflectBandStrength: 0.2, albedoWear: 0.06, roughWear: 0.16, gradientWash: 0.55, causticPlane: 'zy' }));
    const rightWallMat = wallMat.clone();
    loadWallPBR(rightWallMat, 10, 5.5);
    rightWallMat.normalScale.set(0, 0);
    this._realismMaterials.push(applyRealism(rightWallMat, { aoHeight: 1.9, aoStrength: 0.28, causticHeight: 5.5, causticStrength: 0.16, reflectBandHeight: 5.5, reflectBandStrength: 0.2, albedoWear: 0.06, roughWear: 0.16, gradientWash: 0.55, causticPlane: 'zy' }));

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
    // COMPOSITION PASS (per direct request — taller openings everywhere):
    // slitBottom lowered and slitH raised (3.0/2.6 → 1.2/6.4) for a much
    // taller clerestory slit alongside the arch
    const slitW = 0.9, slitH = 6.4, slitBottom = 1.2, slitCenterX = 3.3;
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
    // BUG FIX (per direct request: eliminate vertical banding on the
    // recessed wall surfaces — the central arch and the tall rectangular
    // slit's own reveals — without touching anything else about the
    // room): root-caused directly via live diagnostic (isolated by
    // toggling normalMap on/off with everything else held constant) to
    // three.js's own normal-mapping shader — without real per-vertex
    // tangent data, MeshStandardMaterial falls back to an approximate
    // screen-space-derivative tangent basis, which aliases into regular
    // banding on a large, steeply-angled surface like this one.
    // computeTangents() supplies the real, geometrically-correct tangent
    // vectors this shared-vertex geometry already has everything it
    // needs for (position/normal/uv, already merged above) — confirmed
    // directly to remove the banding completely while leaving the
    // normal map, and everything else about the material/lighting,
    // untouched
    backGeo.computeTangents();
    const backWall = new THREE.Mesh(backGeo, wallMat);
    backWall.userData.fadeGroup = 'structure';
    // the extrude's own front face (local z = wallThickness) is the one
    // that should sit at the room's actual back plane, so the mesh is
    // pushed back by the extra thickness rather than sitting flush at it
    backWall.position.set(0, 0, -roomDepth / 2 - wallThickness);
    backWall.castShadow = true;
    // WALL-SHADOW FIX (per direct request): re-enabled. This mesh sits
    // entirely inside keyLight's own shadow-camera frustum (confirmed
    // directly against its ±20 orthographic bounds — see
    // keyLight.shadow.camera in _buildEnvironment), so there's no
    // frustum-edge excuse for leaving it off the way the oversized side
    // walls need (see their own comment below). The old flickering-acne
    // problem at the slit window's own reveal seam was a bias problem,
    // not a "this wall can't safely receive shadows" problem — fixed at
    // the source via keyLight.shadow.normalBias (see _buildEnvironment),
    // which pushes the shadow-map sample along the surface normal rather
    // than just deeper along the light's own view axis, so a sharp near-
    // 90° interior corner like this reveal no longer straddles the
    // sample point the way a plain depth bias alone left it doing
    backWall.receiveShadow = true;
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
    // WALL-SHADOW FIX (per direct request): the far end of each side
    // wall's own local shape (out toward sideWallFront) exists purely
    // for wide-viewport edge coverage, not as part of the actual room —
    // and it reaches well outside keyLight's own shadow-camera frustum
    // (its ±20 orthographic bounds, see keyLight.shadow.camera in
    // _buildEnvironment). That mismatch is exactly what produced the old
    // diagonal shadow streak the one time receiveShadow was left on for
    // the whole mesh. Rather than keep shadows off the entire wall to
    // dodge that, each side wall is now built as TWO meshes sharing this
    // same wallMat/position/rotation, split right at this local-x
    // boundary so they sit perfectly flush with no seam: a "near"
    // segment (the real room — where the staircase and chair sculpture
    // actually sit — plus real margin) that safely receives shadows, and
    // a "far" segment (the pure viewport padding) that keeps the old
    // cast-only behaviour. 21.5 units was measured directly against
    // keyLight's actual frustum bounds — safe to roughly local x=-21.8
    // on this (left) wall and +19.6 on the plain (right) wall below (the
    // light sits far closer to this wall than the other, hence the
    // different true margins) — with real headroom kept on both. Revisit
    // this number if keyLight's own position/target ever move
    // meaningfully again
    const sideWallReceiveSpan = 21.5;
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
        // COMPOSITION PASS (per direct request — taller openings
        // everywhere): winTop raised 5.3→8.5, winBottom already sits
        // right at the floor
        const winW = 2.6, winBottom = 0.05, winTop = 8.5;
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
        //
        // this wall's own local shape runs -sideWallFront (front, toward
        // camera) .. sideWallBack (back, sealed against the back wall) —
        // splitX sits sideWallReceiveSpan in from that back-sealing
        // corner, safely on the plain part of the wall well clear of
        // both window holes (they sit within local x [-2.8, 2.8],
        // nowhere near this boundary)
        const splitX = sideWallBack - sideWallReceiveSpan;
        const nearShape = new THREE.Shape();
        nearShape.moveTo(splitX, 0);
        nearShape.lineTo(sideWallBack, 0);
        nearShape.lineTo(sideWallBack, roomHeight);
        nearShape.lineTo(splitX, roomHeight);
        nearShape.closePath();
        winCenters.forEach((winCenterX) => {
          const winHole = new THREE.Path();
          winHole.moveTo(winCenterX - winW / 2, winBottom);
          winHole.lineTo(winCenterX + winW / 2, winBottom);
          winHole.lineTo(winCenterX + winW / 2, winTop);
          winHole.lineTo(winCenterX - winW / 2, winTop);
          winHole.closePath();
          nearShape.holes.push(winHole);
        });
        const farShape = new THREE.Shape();
        farShape.moveTo(-sideWallFront, 0);
        farShape.lineTo(splitX, 0);
        farShape.lineTo(splitX, roomHeight);
        farShape.lineTo(-sideWallFront, roomHeight);
        farShape.closePath();
        // same UV clamp-seam risk as the back wall (see
        // normalizeWallUV) — this shape spans local x -sideWallFront..
        // sideWallBack, far past [0,1]. Both pieces are normalized
        // against that SAME full original range (not their own
        // individual bounds), so the dappled-shadow map's UVs stay
        // perfectly continuous right across the split — no visible seam
        // in the material itself
        let nearGeo = new THREE.ExtrudeGeometry(nearShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 32, steps: 1,
        });
        normalizeWallUV(nearGeo, -sideWallFront, sideWallFront + sideWallBack, roomHeight);
        nearGeo = mergeVertices(nearGeo);
        nearGeo.computeVertexNormals();
        // BUG FIX — see backGeo's own matching comment above: this is
        // the left window recesses' own version of the same missing-
        // tangent-data bug
        nearGeo.computeTangents();
        const nearWall = new THREE.Mesh(nearGeo, leftWallMat);
        nearWall.userData.fadeGroup = 'structure';
        nearWall.position.set(side * roomWidth / 2, 0, 0);
        nearWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        nearWall.castShadow = true;
        // the actual fix — this segment sits safely inside keyLight's
        // shadow-camera frustum (see this block's own comment above), so
        // it can finally receive the staircase/chair-sculpture shadows
        // without the old frustum-edge streak.
        // INVESTIGATED (per direct request — a screenshot of this exact
        // segment, seen edge-on from the establishing "Welcome" camera,
        // showing regular "lines"): toggling this off was tried as an
        // early fix (temporarily made the lines vanish) but turned out to
        // be treating a symptom, not the real cause — the actual bug was
        // this geometry's own missing tangent data (see this block's own
        // computeTangents() comment above), fixed there instead. Left at
        // true, restoring the real chair/stair drop shadows this segment
        // is meant to show
        nearWall.receiveShadow = true;
        group.add(nearWall);

        let farGeo = new THREE.ExtrudeGeometry(farShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 32, steps: 1,
        });
        normalizeWallUV(farGeo, -sideWallFront, sideWallFront + sideWallBack, roomHeight);
        farGeo = mergeVertices(farGeo);
        farGeo.computeVertexNormals();
        // BUG FIX — see backGeo's own matching comment above
        farGeo.computeTangents();
        const farWall = new THREE.Mesh(farGeo, leftWallMat);
        farWall.userData.fadeGroup = 'structure';
        farWall.position.set(side * roomWidth / 2, 0, 0);
        farWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        farWall.castShadow = true;
        // NOT receiveShadow — this is exactly the portion that sits
        // outside keyLight's own shadow-camera frustum (see this block's
        // own comment above); past that bound the shadow map has no real
        // data for this surface, which is what read as a diagonal streak
        // the one time this was left on for the whole wall
        group.add(farWall);
      } else {
        // plain wall, no windows — built with the same asymmetric
        // Shape+extrude bounds as the left wall (rather than a
        // symmetric PlaneGeometry) so its back edge lines up exactly
        // with the back wall's own outer face too
        //
        // this wall's own local shape runs -sideWallBack (back, sealed
        // against the back wall) .. sideWallFront (front, toward camera)
        // — the mirror image of the left wall's own range (see that
        // branch's own comment on why the ends swap) — so splitX sits
        // sideWallReceiveSpan out from that same back-sealing corner,
        // just on the opposite side of zero
        const splitX = -sideWallBack + sideWallReceiveSpan;
        const nearShape = new THREE.Shape();
        nearShape.moveTo(-sideWallBack, 0);
        nearShape.lineTo(splitX, 0);
        nearShape.lineTo(splitX, roomHeight);
        nearShape.lineTo(-sideWallBack, roomHeight);
        nearShape.closePath();
        const farShape = new THREE.Shape();
        farShape.moveTo(splitX, 0);
        farShape.lineTo(sideWallFront, 0);
        farShape.lineTo(sideWallFront, roomHeight);
        farShape.lineTo(splitX, roomHeight);
        farShape.closePath();
        // same UV clamp-seam risk as the other two walls, even without
        // any holes — this shape alone spans local x -sideWallBack..
        // sideWallFront, still far past [0,1] (see normalizeWallUV).
        // Both pieces normalized against that same full original range
        // so the split carries no visible UV seam
        const nearGeo = new THREE.ExtrudeGeometry(nearShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 1, steps: 1,
        });
        normalizeWallUV(nearGeo, -sideWallBack, sideWallBack + sideWallFront, roomHeight);
        const nearWall = new THREE.Mesh(nearGeo, rightWallMat);
        nearWall.userData.fadeGroup = 'structure';
        nearWall.position.set(side * roomWidth / 2, 0, 0);
        nearWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        // the actual fix — see the left wall's own matching comment
        // above; this segment sits safely inside keyLight's shadow-
        // camera frustum. (This branch never set castShadow on the whole
        // wall before the split either — left exactly as-is, only
        // receiveShadow is new here)
        nearWall.receiveShadow = true;
        group.add(nearWall);

        const farGeo = new THREE.ExtrudeGeometry(farShape, {
          depth: wallThickness, bevelEnabled: false, curveSegments: 1, steps: 1,
        });
        normalizeWallUV(farGeo, -sideWallBack, sideWallBack + sideWallFront, roomHeight);
        const farWall = new THREE.Mesh(farGeo, rightWallMat);
        farWall.userData.fadeGroup = 'structure';
        farWall.position.set(side * roomWidth / 2, 0, 0);
        farWall.rotation.y = -side * (Math.PI / 2 - 0.18);
        // NOT receiveShadow — see the left wall's own matching comment
        // above
        group.add(farWall);
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
    // shoreline/contact anchors — the same static layout constants the
    // real platform (see _buildChairPile) and stair base (see
    // _buildSpiralStairs) use, duplicated here as plain numbers rather
    // than restructuring build order (this shader is built before either
    // of those methods runs). Keep in sync if either ever moves
    //
    // GEOMETRY-CLIPPING FIX: kept in sync with _buildChairPile's own
    // platform resize (leftEdge -6.9→-5.4, back edge -6.4→-5.2, per that
    // function's own comment on why the old numbers let the real
    // platform mesh clip through both the left and back walls) — this is
    // the water shader's shoreline-foam/ripple rectangle, which has to
    // match the actual mesh footprint or the foam ring shows up floating
    // past the platform's real edge
    // COMPOSITION PASS (per direct request: "move the staircase entirely
    // more closer to where the window is casting light so that right
    // wall can have a stair shadow on it"): moved from (4.0,-5.0) — see
    // group.position in _buildSpiralStairs, kept in sync here
    const STAIR_CONTACT = new THREE.Vector2(2.6, -1.8);
    // COMPOSITION PASS (per direct request — same treatment as the
    // stairs above: "do the same for the chairs and the floor that
    // holds the chair"): z-range shifted shallower so this platform
    // sits in the sunbeam's path too, instead of deep in the room's
    // darkest back corner.
    // Re-widened in Z (-2.7/-0.3 → -3.3/0.3) now that the platform
    // itself is a circle (radius = platformW/2 = 1.8, see
    // _buildChairPile) rather than the old narrower rectangle — this is
    // still just this rectangular approximation's own bounding box, kept
    // in sync with platformCenterZ/platformRadius there
    const PLATFORM_MIN = new THREE.Vector2(-5.4, -3.3);
    const PLATFORM_MAX = new THREE.Vector2(-1.8, 0.3);
    const waterShader = {
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        rippleMap: { value: rippleMap },
        uRippleOffset: { value: new THREE.Vector2(0, 0) },
        uRippleCenter: { value: new THREE.Vector2(SPHERE_POS.x, SPHERE_POS.z) },
        uStairContact: { value: STAIR_CONTACT },
        uPlatformMin: { value: PLATFORM_MIN },
        uPlatformMax: { value: PLATFORM_MAX },
        // a real three-stop coastal gradient, per direct request: deep
        // water reads muted blue-green (uWaterShadow, at the wave's own
        // troughs), mid-depth water reads as clear coastal teal
        // (uWaterBase — retinted from a pale sage shimmer tone into a
        // genuine structural middle tier, not just an accent), and
        // crests/shallow water read pale aqua (uWaterHighlight). See the
        // fragment shader's own crestFactor (driven by the real wave
        // height, not a texture proxy) for how these three combine.
        // uAccentReflect is unrelated — the tint worked into the
        // REFLECTION only, at grazing angles.
        // WATER-REFERENCE PASS (per direct request): both retinted
        // warmer, deep tones left untouched. uWaterHighlight (0xc9ece3,
        // cool mint → 0xdeecc8, pale warm sage-gold) is the crest/
        // shallow tier — the brightest, most sun-exposed part of the
        // water's own body colour, so this is where the reference's
        // golden-hour warmth actually needs to live. uAccentReflect
        // (0xcdd2ea, cool blue-lavender → 0xdcd6d0, warm neutral) was
        // originally tuned on the idea that "real reflected sky reads
        // bluer/cooler" — true for a clear midday sky, but this room's
        // own sky is deliberately warm/golden-hour (LOCKED_SUN_COLOR,
        // Sky.js), so a cool-blue grazing reflection was fighting that
        // rather than matching it; warm-neutral is the physically
        // consistent choice for THIS sky. uWaterBase/uWaterShadow (the
        // deep-water body colour) stay exactly as they were — the
        // reference's own water is still recognizably teal/green in its
        // depths, only its bright/reflective parts read warm
        // DEBUG FIX (per direct request: "I want it to just stay dark
        // blue/green all the time" / water "turning to white"): this was
        // a near-white pale sage-cream (0xdeecc8 — 222,236,200, barely
        // tinted at all) — every place that blends TOWARD this colour
        // (the crest tier below, the caustic tone, the shoreline foam)
        // was therefore blending toward something already almost white,
        // which is a big part of why bright moments read as "turning
        // white" rather than "a lighter shade of the same water."
        // Retinted to a genuine light teal — clearly the SAME colour
        // family as uWaterBase/uWaterShadow below, just the brighter end
        // of it, not a different, paler colour altogether
        uWaterBase: { value: new THREE.Color(0x5aa89c) },
        uWaterHighlight: { value: new THREE.Color(0x8fd6bf) },
        uWaterShadow: { value: new THREE.Color(0x4d6f69) },
        uAccentReflect: { value: new THREE.Color(0xdcd6d0) },
        // the same colour the sky dome's own horizon band uses (see
        // HORIZON_HAZE_COLOR/_buildEnvironment) — this ocean and that
        // sky are meant to read as one continuous world, so the water
        // fades into the SAME colour the sky fades into, right where
        // the two visually meet
        uHazeColor: { value: new THREE.Color(HORIZON_HAZE_COLOR) },
        // gentler than an original 0.0022 — confirmed by direct pixel
        // readback that value hazed the ocean almost fully white by
        // only a few hundred units out, well before the geometric edge,
        // so most of what showed through the archway read as a flat
        // pale wash with no visible water colour/reflection at all.
        // pulled back further (0.00135→0.0007) per direct request to
        // "extend the horizon much farther" — real water colour and
        // reflection now stay visible out past a thousand units before
        // the haze blend takes over, so the ocean reads as reaching much
        // farther before it dissolves into the sky's own horizon band.
        // Still fully (>90%) hazed well inside the enlarged plane's own
        // far corners (see the Reflector's own PlaneGeometry below) and
        // comfortably inside camera.far, so there's still no visible
        // geometric edge — just a longer, more gradual fade into it
        uHazeDensity: { value: 0.0007 },
        // set for real once the key light exists (see _buildEnvironment,
        // right after keyLight is constructed) — placeholder direction/
        // colour here just avoids an undefined uniform before then. This
        // is what lets the water's own specular glint below respond to
        // the ACTUAL sun, not an independently-chosen "looks about right"
        // direction
        uSunDir: { value: new THREE.Vector3(-11, 7.5, 0.6).normalize() },
        uSunColor: { value: new THREE.Color(0xffd9a3) },
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
        uniform float uTime;
        varying vec4 vUv;
        varying vec2 vUv2;
        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vWaveHeight;

        ${GERSTNER_MACRO_GLSL}

        void main() {
          // the reflection's own projective UV is computed from the
          // UNDISPLACED position on purpose — Reflector's textureMatrix
          // was built from a mirrored camera assuming a perfectly flat
          // plane, so bending that same UV lookup by the real wave
          // displacement here would desync it from what the reflection
          // texture actually shows. The wave shape still reads correctly
          // through the reflection UV's own existing ripple-normal
          // distortion (see the fragment shader) without needing the
          // projection itself to know about it
          vUv = textureMatrix * vec4(position, 1.0);
          vUv2 = uv;

          vec3 worldPosFlat = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 waveNormalLocal;
          vec3 disp = gerstnerDisplace(worldPosFlat.xz, uTime, waveNormalLocal);
          vWaveNormal = waveNormalLocal;
          // the real macro wave's own vertical offset — passed straight
          // through (not yet normalised) so the fragment shader can turn
          // it into a genuine crest/trough factor for colour, instead of
          // reusing an unrelated ripple-texture sample as a "depth" proxy
          vWaveHeight = disp.y;

          vec3 displaced = position + disp;
          vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D rippleMap;
        uniform vec2 uRippleOffset;
        uniform vec2 uRippleCenter;
        uniform vec2 uStairContact;
        uniform vec2 uPlatformMin;
        uniform vec2 uPlatformMax;
        uniform vec3 uWaterBase;
        uniform vec3 uWaterHighlight;
        uniform vec3 uWaterShadow;
        uniform vec3 uAccentReflect;
        uniform vec3 uHazeColor;
        uniform float uHazeDensity;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uTime;
        uniform float opacity;
        varying vec4 vUv;
        varying vec2 vUv2;
        varying vec3 vWorldPos;
        varying vec3 vWaveNormal;
        varying float vWaveHeight;

        ${CAUSTIC_GLSL}

        // chopGradient (the fine end of the wave spectrum) comes in
        // already via CAUSTIC_GLSL above (see CHOP_GLSL) — the SAME
        // function the caustic warp uses, rather than a second,
        // independently-tuned copy living only here

        // GGX (Trowbridge-Reitz) normal distribution — the real shape a
        // specular highlight from a rough-ish surface actually has (a
        // narrow peak with a long, soft tail), replacing a plain
        // pow(cosTheta, N) term, which is both too symmetric and has no
        // physical grounding in an actual roughness value
        float ggxD(float NoH, float roughness){
          float a = roughness * roughness;
          float a2 = a * a;
          float d = NoH * NoH * (a2 - 1.0) + 1.0;
          return a2 / (3.14159265 * d * d + 1e-7);
        }

        // Schlick's Fresnel approximation against water's own real F0
        // (≈0.02, from its ~1.33 refractive index) — one physically-
        // grounded curve now drives reflectivity, the specular
        // highlight's own intensity, AND the grazing-angle reflection
        // tint below, instead of three independently hand-tuned curves
        vec3 fresnelSchlick(float cosTheta, vec3 F0){
          return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
        }

        // an analytic stand-in for the sky in a given direction — used
        // ONLY where the mirror reflection below can't be trusted (see
        // that fade's own comment). Per direct request, darkened and
        // matched to the water's OWN palette (uWaterShadow/uWaterBase)
        // rather than an independently pale, bright haze blend — this
        // fallback is meant to read as part of the same ocean/horizon
        // world, not a brighter patch standing out from the water
        // around it, and it's now gated to only the true edge cases
        // (see mirrorConfidence below), so it never needs to carry a
        // large share of the visible surface on its own
        vec3 skyAmbient(vec3 dir){
          vec3 zenith = mix(uWaterShadow, uWaterBase, 0.5);
          vec3 sky = mix(uHazeColor * 0.75, zenith, smoothstep(-0.05, 0.55, dir.y));
          float sunAmt = pow(max(dot(dir, normalize(uSunDir)), 0.0), 9.0);
          sky += uSunColor * sunAmt * 0.5;
          return sky;
        }

        // 2D box SDF (bmin/bmax form) — negative inside, positive outside,
        // magnitude is the real distance to the nearest edge either way.
        // Used to find how close a point on the water is to the chair
        // platform's own rectangular footprint, for the shoreline foam
        float rectDist(vec2 p, vec2 bmin, vec2 bmax){
          vec2 d = max(bmin - p, p - bmax);
          return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
        }

        // HEXAGON-CELL REFERENCE PASS (per direct request: "there is no
        // visual circle" in the reference) — this used to decay slowly
        // enough (see the call site's own old decay constants) that
        // several full sine periods stayed visible out from each contact
        // point, reading as an obvious concentric bullseye/target pattern
        // in the water. The reference's own water sits almost perfectly
        // flat right up to the sphere and stepping stones — real contact
        // disturbance in genuinely calm water fades out within a few
        // centimetres, not metres. decay is now used as a much steeper
        // exponent (see call site) so this reads as a single tight
        // disturbance right at the object, not a repeating ring pattern
        float rippleRing(vec2 worldXZ, vec2 center, float t, float speed, float decay){
          float dist = length(worldXZ - center);
          return sin(dist * 5.5 - t * speed) * exp(-dist * decay) * smoothstep(0.0, 0.7, dist);
        }

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

          // a second, larger/slower sample of the same map stands in for
          // a refraction layer distinct from the surface ripple — real
          // shallow clear water shimmers as light refracts through
          // moving surface ripples onto whatever's beneath it; this
          // perturbs the depth-tone lookup below rather than the mirror
          // reflection itself
          vec2 refractUV = vUv2 * vec2(1.4, 1.8) - uRippleOffset * 0.6;
          vec3 nRefract = texture2D(rippleMap, refractUV).xyz * 2.0 - 1.0;

          // three real scales of surface normal combined into one — the
          // macro wave shape (vWaveNormal, genuine vertex-displaced
          // geometry), the analytic mid-scale chop (chopGradient), and
          // the finest tiled-texture ripple (n, the existing normal map)
          // — so Fresnel, reflection distortion, and the sun glint below
          // all respond to one real multi-scale wave surface instead of
          // a flat plane with a single normal source standing in for all
          // three. cameraPosition is one of three.js's own automatic
          // shader uniforms, nothing to wire up by hand
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec2 chopG = chopGradient(vWorldPos.xz, uTime);
          vec3 waveNormal = normalize(vWaveNormal + vec3(-chopG.x, 0.0, -chopG.y) * 0.4 + vec3(n.x, 0.0, n.y) * 0.22);

          // distort the reflection's own projective UV — the standard
          // wavy-mirror technique (the same one three.js's own Water.js
          // addon uses): offset scaled by vUv.w since texture2DProj
          // expects un-divided homogeneous coordinates. Two scales now,
          // not one: the fine ripple texture (n.xy, as before) PLUS the
          // real combined wave normal (waveNormal.xz — the actual
          // Gerstner macro shape and chop, not just the tiled texture)
          // at a larger offset. Per direct request to "break up
          // reflections by allowing the wave normals to distort them
          // more naturally" — a mirror distorted only by a small tiled
          // texture still reads as fundamentally flat with a light
          // wobble on top; real choppy water visibly bends and breaks
          // its own reflections at the scale of the waves themselves
          //
          // CALM-MIRROR REFERENCE PASS (per direct request, new flooded-
          // room reference): both offsets cut roughly in half (0.028→
          // 0.014, 0.1→0.045) — that reference's water reflects the
          // room's own architecture almost sharply, not visibly bent/
          // broken. Not zeroed out entirely (a perfectly undistorted
          // reflection reads as a static image pasted onto the water
          // rather than a real, if very calm, liquid surface)
          //
          // DEBUG FIX (per direct request: "the entire ocean keeps
          // changing to white"): raised back up partway (0.014→0.02,
          // 0.045→0.065) — cutting this as far as the pass above did was
          // the other half of the actual root cause: with almost no
          // distortion left, a broad, genuinely flat-looking area of
          // water all samples nearly the SAME point in the reflected
          // image, so one bright sky/sun pixel could wash a huge
          // contiguous patch of "ocean" white all at once. This doesn't
          // go all the way back to the old value — the reflection still
          // reads calmer than it used to — just enough that nearby
          // pixels sample genuinely different points of the reflection,
          // which is what breaks a single bright source up into
          // localized glints instead of one uniform flash
          vec4 uv = vUv;
          uv.xy += n.xy * 0.02 * uv.w;
          uv.xy += waveNormal.xz * 0.065 * uv.w;
          vec3 mirrorSample = texture2DProj(tDiffuse, uv).rgb;

          // the reflected camera's own frustum is least reliable right
          // at the horizon — a real limitation of any bounded planar
          // reflection, not something to fix by hand-tuning a colour.
          // projUv is that same reflection's own screen-space position;
          // as it approaches the render target's own edge (where the
          // mirror camera's view runs out, or where texture stretching
          // at a grazing angle gets severe), confidence in the sampled
          // pixel fades to zero and the analytic sky takes over instead
          // — a physically plausible fallback rather than whatever an
          // edge-clamped texture read happens to be. Narrowed (0.07→
          // 0.02) per direct request to limit the fallback to only true
          // edge cases — the wider band was handing a meaningful chunk
          // of ordinary, non-edge water over to the (now-darker, but
          // still independently-computed) analytic sky rather than the
          // real mirrored scene
          vec2 projUv = uv.xy / uv.w;
          float mirrorConfidence = smoothstep(0.0, 0.02, min(min(projUv.x, 1.0 - projUv.x), min(projUv.y, 1.0 - projUv.y)));
          vec3 skyFallback = skyAmbient(reflect(-viewDir, waveNormal));
          vec3 reflection = mix(skyFallback, mirrorSample, mirrorConfidence);

          // Schlick Fresnel against water's real F0 (see fresnelSchlick's
          // own comment) — one physically correct curve now drives
          // reflectivity here instead of a hand-tuned pow(x,4) ramp, and
          // the same curve feeds the specular highlight below
          float NoV = max(dot(waveNormal, viewDir), 0.0);
          vec3 fresnelTerm = fresnelSchlick(NoV, vec3(0.02));
          float fresnel = fresnelTerm.r;
          float camDist = distance(cameraPosition, vWorldPos);
          // computed early (used below by reflectDamp as well as by the
          // horizon-haze blend at the very end of this function) — real
          // exponential distance falloff, unrelated to the wave system
          float haze = clamp(1.0 - exp(-uHazeDensity * uHazeDensity * camDist * camDist), 0.0, 1.0);
          // roughness variation — the ripple normal map's own z (near 1
          // on calm patches, lower on steep ripple slopes) doubles as a
          // cheap per-pixel roughness mask, softening reflectivity right
          // where the surface itself is most disturbed rather than
          // treating the whole plane as one uniform mirror finish
          float microRough = 1.0 - smoothstep(0.75, 0.98, n.z * 0.5 + 0.5);
          // reflectivity uses a REMAPPED fresnel, not the raw physical
          // curve above — physically-correct Fresnel already reaches
          // values like 0.3-0.5 at fairly ordinary, everyday viewing
          // angles, which is accurate but, framed this close to the
          // water, reads as the whole surface going pale/silvery well
          // before the real horizon. Squaring keeps both ends of the
          // curve anchored (still ~0 near straight down, still ~1 at
          // true grazing, so grazing angles stay physically correct)
          // while pulling the MIDDLE of the range down hard — the same
          // kind of artist-facing bias term most real-time water
          // shaders expose on top of a "physically correct" base curve.
          // Per direct request: concentrate strong reflection near the
          // horizon rather than lowering reflectivity everywhere — this
          // reshapes the curve, it doesn't scale it down uniformly (at
          // fresnel=0.9 this is still 0.81, barely touched; at
          // fresnel=0.3, a very ordinary mid-shot angle, it's 0.09, a
          // real structural change)
          float reflectFresnel = fresnel * fresnel;

          // near-field reflectivity stabilization — targeted fix for a
          // confirmed issue: the real (animated) wave normal tilts
          // continuously as Gerstner waves pass through, so reflectFresnel
          // itself swings with them, and close to camera NEITHER midBand
          // nor absorption (both below) has ramped up yet to damp that
          // swing — so every tilt read as a brief "flash" of pale mirror/
          // sky washing over the water's own colour. nearField fades out
          // over the same span midBand fades in (0-20 units), so this
          // handoff is smooth and there's no gap or double-correction.
          // A soft-knee compressor (not a hard clamp, not a flat
          // reduction) — values below the knee (0.5) pass through
          // completely untouched, so normal-incidence patches keep
          // reacting exactly as before; only the TOP of the swing gets
          // pulled in, which is specifically the part that read as a
          // milky flash. Reflections keep moving and breathing — this
          // narrows the peaks, it doesn't flatten or freeze anything
          float nearField = 1.0 - smoothstep(0.0, 20.0, camDist);
          float knee = 0.5;
          float excess = max(reflectFresnel - knee, 0.0);
          float compressedFresnel = knee + excess / (1.0 + excess * 1.8);
          float reflectFresnelStable = mix(reflectFresnel, compressedFresnel, nearField);

          // a SECOND, distance-based damping on top of the angle-based
          // remap above — Fresnel alone still lets bright sky reflection
          // dominate the whole middle distance on a plane this large,
          // not just the true horizon band, since grazing-enough angles
          // start well before the actual horizon. midBand rises across
          // the near-to-mid transition and falls back across the mid-
          // to-far transition, so it's ~0 (no extra damping) right near
          // the camera AND ~0 again out at the true horizon (where real,
          // strong reflections are correct and expected — see the
          // "without removing realistic horizon reflections" request),
          // and only actually reduces reflectivity in the middle band
          // itself. The falling edge is tied to the SAME haze factor
          // the final horizon blend uses (not an independent distance
          // threshold) — haze itself doesn't meaningfully engage until
          // several hundred units out, so an independent falloff ending
          // around 200 units left a real gap: damping released, but haze
          // hadn't taken over yet, so undamped reflectivity got to
          // dominate exactly the band this request is about. Tying the
          // release directly to haze closes that gap — damping only
          // ever lets go exactly where haze is already taking over
          // Per direct request: reduce sky-reflection dominance across
          // the middle/far distance without lowering reflectivity
          // everywhere or touching the physically correct Fresnel curve
          // itself
          float midBand = smoothstep(15.0, 50.0, camDist) * (1.0 - smoothstep(0.05, 0.5, haze));
          float reflectDamp = 1.0 - midBand * 0.6;
          // microRough's own weight is reduced in the near field too —
          // it's driven by the animated ripple texture's z channel, so
          // it was contributing a second, smaller oscillation on top of
          // the Fresnel swing above, right in the same zone. Untouched
          // past the near field (mid/far behavior is unchanged)
          float microRoughWeight = mix(0.3, 0.12, nearField);
          // DEBUG FIX (per direct request: "the entire ocean keeps
          // changing to white"): root cause was the ceiling here (0.94)
          // combined with how flat/undistorted the calm-mirror pass just
          // made this surface — a near-flat plane reflects nearly the
          // SAME direction across a large contiguous area, so whenever
          // that shared direction lined up with the bright sky/sun, a
          // big uniform patch of "ocean" reflected that same bright pixel
          // simultaneously and read as the whole surface flashing white.
          // Capping the ceiling hard (0.94→0.5) means the water's own
          // dark tone below is now GUARANTEED to still make up at least
          // half of every pixel's colour, no matter how bright whatever
          // the mirror happens to be sampling is — this is what actually
          // keeps it "dark blue/green all the time" rather than just
          // dimming an occasional flash after the fact
          // REFERENCE-MATCH PASS (per direct request — "how do we get
          // water to show reflections of the room"): raised again
          // (0.5→0.72). The original 0.94→0.5 cut was fixing a real bug
          // (a then-flat, then-undistorted mirror reflecting one bright
          // sky pixel across a huge contiguous area, reading as the whole
          // ocean flashing white) — but real wave height AND reflection
          // UV distortion were both restored since then specifically to
          // break up large-area sameness (see this shader's own comments
          // above), and the col = min(col, vec3(1.3)) safety clamp near
          // the final output is still in place as a backstop. With both
          // of those, a higher ceiling is safe again, and the reference
          // clearly shows real architecture (wall light patches, window
          // shapes) mirrored in the water, not just sky
          float reflectivity = clamp(reflectFresnelStable, 0.03, 0.72) * (1.0 - microRough * microRoughWeight) * reflectDamp;

          // crest/trough colour — driven by the REAL macro wave height
          // (vWaveHeight, see the vertex shader), not a texture-noise
          // stand-in for "depth," and NOT blended with viewing angle at
          // all (see tone below) — per direct request, Fresnel controls
          // reflection strength only, never the water's own base colour.
          // A real three-stop coastal gradient: deep troughs read muted
          // blue-green (uWaterShadow), mid-depth water reads clear
          // coastal teal (uWaterBase — now a genuine structural middle
          // tier, not just an accent), and crests/shallow water read
          // pale aqua (uWaterHighlight)
          float macroRange = macroAmplitude(0) + macroAmplitude(1);
          float crestFactor = clamp(vWaveHeight / macroRange * 0.5 + 0.5, 0.0, 1.0);
          vec3 waveTone = crestFactor < 0.5
            ? mix(uWaterShadow, uWaterBase, crestFactor * 2.0)
            : mix(uWaterBase, uWaterHighlight, (crestFactor - 0.5) * 2.0);

          // depth variation — the fast ripple map layered on TOP of the
          // real crest/trough gradient above as a small brightness
          // shimmer that preserves hue (±6%, not a hue-flattening mix
          // toward a fixed colour) so the three-stop gradient above
          // stays intact instead of being diluted back toward one flat
          // tone — this is what keeps the surface feeling "alive"
          // rather than just a slow colour ramp
          float depthN = nRefract.x * 0.5 + 0.5;
          vec3 tone = waveTone * (0.94 + depthN * 0.12);

          // a small, gentle near-field absorption FLOOR — distinct from
          // (and much weaker than, max 0.2 vs 0.8) the real far-distance
          // absorption below, which is deliberately near-zero this close
          // to camera and stays that way. Per direct request, NOT the
          // same curve applied at full strength up close — just a soft
          // guarantee that a little stable teal depth is always present
          // in the blend, so even at the compressor's own peak moments
          // (above) the body colour never fully disappears under a
          // reflectivity spike. Untinted uWaterShadow (not the *0.82 used
          // far below) — gentler, per direct request
          tone = mix(tone, uWaterShadow, nearField * 0.2);

          // distance-based absorption — real water reads OPTICALLY
          // DEEPER and more saturated the more of it the eye is looking
          // through, not paler; the existing horizon haze (below, at the
          // very end of this function) does the opposite at long range,
          // fading everything toward a shared pale sky tan, which is
          // correct right at the true horizon but was starting far too
          // early and reading as the ocean washing out to white well
          // before it should. This blends the body tone toward the same
          // deep, muted blue-green already used for the near-field wave
          // troughs (uWaterShadow, darkened further) BEFORE that haze
          // ever engages, so "deep" and "far" read as the same physical
          // idea — the water gets richer with distance, then only right
          // at the true horizon does it finally hand off to the shared
          // sky-matching colour
          float absorption = 1.0 - exp(-camDist * 0.028);
          tone = mix(tone, uWaterShadow * 0.82, absorption * 0.8);
          // the cool accent worked into the reflection only at grazing
          // angles, where a real reflected sky reads bluer than the
          // water's own body colour does looking straight down
          vec3 reflectionTinted = mix(reflection, reflection * uAccentReflect * 1.15, fresnel * 0.35);
          vec3 col = mix(tone, reflectionTinted, reflectivity);

          // underwater light scattering — light entering the water
          // bends and scatters within its own shallow depth before
          // bouncing back out, reading as a soft internal glow. Steady
          // (unlike the caustic pattern below, which moves), strongest
          // in the shallower/less-reflective areas since that's where
          // more of what the eye sees is actually light that scattered
          // inside the water rather than bounced straight off its
          // surface. Uses uWaterBase (the mid-depth tier) rather than a
          // Shadow/Highlight average, and trimmed (0.065→0.05) per
          // direct request to reduce additive stacking so this stays
          // distinct instead of collapsing toward white alongside
          // everything else added below
          float scatter = smoothstep(0.25, 0.85, depthN) * (1.0 - reflectivity);
          col += uWaterBase * scatter * 0.05;

          // real sunlight-water interaction — a proper microfacet (GGX)
          // specular response against the real key light's own
          // direction, not one smooth pow(cosTheta, N) blob. Uses its
          // own normal (specNormal) rather than the shared waveNormal
          // above.
          // WATER-REFERENCE PASS (per direct request, benchmarked against
          // a reference photo): the fine tiled ripple texture's own
          // weight raised (0.1→0.4) — reversing the specific earlier
          // choice to suppress it (see git history/this comment's own
          // prior wording: it used to be kept low on purpose "to keep
          // the glint broken and natural, not sparkly"). The reference's
          // own defining water quality is a wide GRANULAR field of many
          // small twinkling highlights along the sun's path, not one
          // smooth streak — which is exactly what this same regular,
          // tiled, high-frequency normal detail produces once it's
          // actually let through. The chop field's weight (0.7) stays
          // untouched, since that's what keeps the overall PATH shape —
          // this only adds texture back inside that same shape, it
          // doesn't remove the shape itself
          //
          // CALM-MIRROR REFERENCE PASS (per direct request, new flooded-
          // room reference photo): pulled back hard (0.4→0.12→0.05) —
          // that earlier "wide granular twinkling field" was tuned
          // against a DIFFERENT reference photo than this one; THIS
          // reference's own water is a calm, sharp mirror with almost no
          // scattered sparkle. The first cut (→0.12) still read as
          // visible "disco floor" dots per direct follow-up feedback, so
          // this is cut again, hard — barely enough fine texture left to
          // keep the surface reading as liquid rather than a frozen
          // mirror, nowhere near enough to read as individual points
          vec3 specNormal = normalize(vWaveNormal + vec3(-chopG.x, 0.0, -chopG.y) * 0.7 + vec3(n.x, 0.0, n.y) * 0.05);

          // stretched anisotropically along the sun's own horizontal
          // bearing — real "sun road" reflections on water read as a
          // long streak toward the horizon, not a round point, because
          // countless small facets only need to satisfy the mirror
          // condition tightly ACROSS that direction; many different
          // facet tilts along it still catch the light. Compressing the
          // along-bearing component of the surface tilt (× 0.3) before
          // measuring alignment is what elongates the highlight along
          // that same axis. Per direct request: "replace isolated
          // bright highlights with longer, softer reflected sunlight
          // streaks across the water"
          vec2 sunBearing = normalize(uSunDir.xz);
          vec2 acrossBearing = vec2(-sunBearing.y, sunBearing.x);
          float alongTilt = dot(specNormal.xz, sunBearing);
          float acrossTilt = dot(specNormal.xz, acrossBearing);
          vec2 streakXZ = sunBearing * alongTilt * 0.3 + acrossBearing * acrossTilt;
          vec3 streakNormal = normalize(vec3(streakXZ.x, specNormal.y, streakXZ.y));

          vec3 halfDir = normalize(uSunDir + viewDir);
          float NoH = max(dot(streakNormal, halfDir), 0.0);
          // WATER-REFERENCE PASS: roughness floor lowered (0.1→0.06) so
          // a momentarily calm micro-facet can peak sharper — real
          // glitter needs SOME facets to get close to pinpoint, not just
          // "a little tighter." The ceiling (0.26) stays, so rougher
          // patches still scatter wide/dim exactly as before; only the
          // calm end of the range gained real range to sparkle in
          //
          // CALM-MIRROR REFERENCE PASS (per direct request): floor raised
          // again (0.06→0.11→0.18) — same follow-up as specNormal above:
          // the first pass wasn't enough to stop individual facets from
          // reading as separated "disco" points, so fewer of them get to
          // peak sharply at all now
          float roughness = mix(0.18, 0.26, microRough);
          // clamp raised (70→130) alongside the roughness change — taller
          // peaks are what read as individual twinkles rather than a
          // smooth continuous streak. This only affects the rare, small
          // pixels that actually hit near-perfect alignment; it doesn't
          // raise the streak's overall/average brightness
          //
          // CALM-MIRROR REFERENCE PASS (per direct request): pulled back
          // hard (130→65→24) — per direct follow-up feedback the water
          // still looked like a "disco dance floor"; this clamp is the
          // most direct lever on individual peak height, so it takes the
          // biggest additional cut
          float ggx = min(ggxD(NoH, roughness), 24.0);
          // intensity nudged down slightly (0.008→0.007) alongside the
          // clamp increase — taller individual peaks with a slightly
          // lower multiplier keeps the STREAK's average brightness where
          // it was (still "reduce additive stacking"-safe), while the
          // peaks themselves now have real headroom to read as sparkle
          //
          // CALM-MIRROR REFERENCE PASS (per direct request): pulled back
          // down again (0.009→0.005) alongside the much lower clamp above
          // — with roughness/specNormal/clamp all cut together this
          // round, the multiplier no longer needs to compensate for lost
          // peak height; keeping it low too is what actually removes the
          // "dots," not just makes them dimmer
          vec3 glint = ggx * fresnelTerm * uSunColor;
          col += glint * 0.005;

          // caustics dancing on the water's own surface — strongest in
          // the shallower/base-tone areas, faded under the darker
          // reflective centre so it never fights the mirror read there.
          // See CAUSTIC_GLSL's own comment for how this pattern is now
          // warped by the same wave field driving the vertex displacement
          // above, rather than an unrelated moving pattern.
          // WATER-REFERENCE PASS (per direct request): UV scale tightened
          // (0.6→0.85) for a finer, more thread-like lattice — the
          // reference's own water shows crisp interlocking light-focus
          // lines, not broad soft blobs. Strength raised back up (0.11→
          // 0.16, undoing part of the earlier "reduce additive stacking"
          // trim) and the tone itself pushed most of the way toward pure
          // white (mix toward vec3(1.0) rather than stopping at
          // uWaterHighlight) — real caustic lines read crisp and bright,
          // not just highlight-tinted; keeping a little of the water's
          // own highlight colour in the mix (0.55) instead of going full
          // white keeps it feeling like the SAME water rather than an
          // unrelated white overlay
          //
          // CALM-MIRROR REFERENCE PASS (per direct request): strength
          // raised again (0.16→0.28) — with the wave chop calmed down and
          // the specular sparkle toned back for this reference, the bold
          // caustic dapple is now the water's own single biggest visual
          // event, matching the reference photo's own defining quality:
          // large, high-contrast patches of light dancing across the
          // water's surface (causticPattern's own contrast pass makes
          // those patches read crisp rather than smeared)
          //
          // DEBUG FIX (per direct request: water "turning to white"):
          // weighted much more toward uWaterHighlight, barely toward
          // white at all (0.55→0.85) — uWaterHighlight is now itself a
          // genuine light teal (see its own uniform definition above),
          // not a near-white pale colour, so caustic peaks now brighten
          // INTO the water's own colour family instead of bleaching
          // toward a different, paler one
          // BUG FIX (per direct request: "the water looks like its just
          // shapes in jello, i want it to feel real"): this had been
          // pushed, pass after pass, into being the water's own single
          // dominant visual event (strength 0.16→0.28, tone pushed
          // nearly to solid white) to match an earlier reference photo's
          // bold dapple — but a big, high-contrast, slow-moving lattice
          // of solid-looking cells covering the ENTIRE surface is
          // exactly what reads as "flat shapes" rather than liquid, no
          // matter how good the wave/reflection physics underneath it
          // are. Scaled up (0.85→1.6, smaller/finer cells instead of a
          // few big shapes) and pulled way back (0.28→0.09 strength,
          // 0.85→0.4 tone mix so it tints the water's OWN colour instead
          // of bleaching toward flat white) — now a subtle shimmer that
          // sits on top of the real wave/reflection/depth work rather
          // than covering it
          float caustic = causticPattern(vWorldPos.xz * 1.6, uTime);
          vec3 causticTone = mix(vec3(1.0), uWaterHighlight, 0.4);
          col += caustic * causticTone * 0.09 * (1.0 - reflectivity);

          // contact ripples — the sphere (existing) plus the stair base,
          // so the water visibly reacts everywhere something actually
          // sits in it, not just at one fixed point. Trimmed (0.045→
          // 0.035) alongside the other additive terms here
          //
          // HEXAGON-CELL REFERENCE PASS (per direct request: "there is no
          // visual circle" in the reference) — decay raised hard (0.65/
          // 0.55→3.2/2.8) so this fades out within roughly half a unit of
          // each contact point instead of several full rings' worth of
          // distance; strength trimmed too (0.035→0.02). What's left is a
          // small, tight disturbance right at the sphere/stairs, not a
          // repeating concentric target pattern across open water
          float ring = rippleRing(vWorldPos.xz, uRippleCenter, uTime, 2.0, 3.2);
          ring += rippleRing(vWorldPos.xz, uStairContact, uTime, 1.6, 2.8) * 0.7;
          col += ring * 0.02 * vec3(1.05, 1.0, 0.95);

          // the platform is a straight edge, not a single point, so it
          // gets its own ripple term driven directly off the same
          // rectDist used for its foam below — radiating outward from
          // wherever the water actually meets that edge, the same way
          // the sphere/stairs ripples radiate from their own contact
          // point. Trimmed (0.03→0.025) alongside the other additive
          // terms here
          float platRippleDist = max(rectDist(vWorldPos.xz, uPlatformMin, uPlatformMax), 0.0);
          float platRipple = sin(platRippleDist * 6.0 - uTime * 2.2) * exp(-platRippleDist * 1.3);
          col += platRipple * 0.025 * vec3(1.05, 1.0, 0.95);

          // shoreline foam — a soft, gently animated bright band right
          // where the water meets the platform edge and the stair base,
          // so those contact points read as real shoreline interaction
          // rather than geometry just poking through a flat plane
          float stairEdge = length(vWorldPos.xz - uStairContact) - 1.35;
          float stairFoam = 1.0 - smoothstep(0.0, 0.4, abs(stairEdge + sin(uTime * 1.4 + vWorldPos.x) * 0.03));
          float platEdge = rectDist(vWorldPos.xz, uPlatformMin, uPlatformMax);
          float platFoam = 1.0 - smoothstep(0.0, 0.45, abs(platEdge + sin(uTime * 1.2 + vWorldPos.z) * 0.03));
          float foam = clamp(stairFoam + platFoam, 0.0, 1.0);
          col = mix(col, uWaterHighlight * 1.08, foam * 0.35);

          // horizon haze — this is what actually lets the ocean run
          // "endless" (see the Reflector's own 2600-unit plane, sized
          // well past this fade-out distance): the flat plane's own
          // geometric edge is never reached before it's already fully
          // this colour, matching the sky dome's own horizon band, so
          // there's no visible seam, edge, or termination anywhere the
          // water is visible through an opening. (haze itself is
          // computed earlier now — see reflectDamp's own comment above
          // for why — this just applies it)
          col = mix(col, uHazeColor, haze);

          // DEBUG FIX (per direct request: "water turning white at
          // certain points"): this shader adds a real handful of
          // independent bright terms on top of each other — the specular
          // glint, the caustic pattern, both contact ripples, the
          // platform ripple, shoreline foam — each individually modest,
          // but nothing before this point ever stopped them from
          // occasionally landing on top of each other at the same pixel
          // on the same frame (a caustic peak, a glint peak, and a foam
          // band all lining up) and adding past 1.0 into a flat white
          // blowout once ACES's own tonemapping compresses it. This is a
          // safety ceiling, not a stylistic change — it only ever
          // affects those rare stacked-peak pixels; ordinary water is
          // nowhere near this bright and is completely unaffected
          col = min(col, vec3(1.3));

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
    // of the angle, with plenty of margin to spare
    // 3200 units (was 2600) — pushed further per direct request to
    // "extend the horizon much farther." its own far corners (±2263
    // units out) sit safely inside camera.far (2400) while the haze
    // density above (see uHazeDensity) is tuned to already read as
    // ~90%+ hazed well before reaching them, so there's still no visible
    // geometric edge — just a longer, more gradual fade into the horizon
    //
    // subdivided (was a bare 2-triangle plane) so the wave field can
    // actually bend real geometry rather than only painting colour onto
    // a flat surface. The macro Gerstner spectrum's own two wavelengths
    // (26/17 units — see GERSTNER_MACRO_GLSL) are chosen specifically to
    // stay reasonably resolved at this segment density near the room,
    // the only place it's ever visually scrutinized up close; farther
    // out the same haze that already hides the horizon also hides any
    // coarser sampling there. Anything shorter than that is deliberately
    // NOT real geometry (see CHOP_GLSL) — no vertex budget sane for a
    // single 3200-unit plane could resolve it without aliasing.
    // Vertex-shader work this simple is effectively free on any GPU that
    // can run this scene at all — real per-frame cost still comes
    // entirely from the fragment shader and from Reflector's own second
    // scene render for its reflection texture, neither of which this
    // segment count touches
    const floorSegs = this.isMobile ? 90 : 220;
    const floor = new Reflector(new THREE.PlaneGeometry(3200, 3200, floorSegs, floorSegs), {
      // raised alongside CONFIG.dprCap/dprCapMobile — the water fills
      // roughly half the frame, so a low-res reflection target read as
      // its own distinct source of blockiness, separate from the canvas
      // resolution itself, especially as the reflected geometry moved
      // during scroll/parallax. Bumped again on desktop (1024×683→
      // 1280×853) now that the reflection's own grazing-angle reliance
      // is handled by mirrorConfidence's sky-fallback fade (see the
      // fragment shader) rather than by a reflectivity cap — a sharper
      // mirror is worth more now that more of it is actually visible at
      // steep angles. Left untouched on mobile: Reflector already pays
      // its single biggest per-frame cost re-rendering the whole scene
      // into this target, and mobile's budget is tighter to begin with
      textureWidth: this.isMobile ? 512 : 1280,
      textureHeight: this.isMobile ? 341 : 853,
      multisample: this.isMobile ? 0 : 4,
      // lightened from an original 0x241a10 (a much darker, warm-brown
      // value out of step with the room's own cool blue-gray palette)
      // — also softens the dark seam right at the wall/water horizon
      // now that reflectivity there leans more on this base colour
      // (see the fresnel comment above). Nudged from a pure blue-gray
      // (0x333d47) toward green per direct request — green channel
      // raised relative to blue so the water reads with a light green
      // cast rather than the room's own cooler blue-gray
      color: 0x36473d,
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
    // BUG FIX (per direct request: "replace the sphere with a smooth
    // rounded natural river stone made of realistic rock material —
    // organic, heavy, and softly rounded with no sharp or pointed
    // edges"): the glass/transmission material and the old
    // MeshPhysicalMaterial iridescence/attenuation tuning above no
    // longer apply at all — this is now a real stone, not a glass ball.
    // Kept the variable names (sphereMat/sphere/this.sphere) unchanged so
    // every OTHER system already built around this object (the water's
    // own ripple centre, the contact shadow, the slow idle rotation in
    // _frame, the fade-group/shadow wiring below) keeps working exactly
    // as before without needing its own changes
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.015,
      envMapIntensity: 0.9,
    });
    this.sphereMat = sphereMat;
    // BUG FIX (per direct request: "Add material to the rock so it
    // actually look like a rock"): real photographed boulder maps replace
    // the old flat tinted-grey look — color is left white (0xffffff, not
    // the old 0x847c6e) so the photograph's own real stone colour comes
    // through unmultiplied
    Object.assign(sphereMat, loadRockPBR(2));
    // organic, rounded river-stone shape — a high-detail icosahedron
    // (detail 4, thousands of vertices, already near-spherically smooth
    // before any displacement) with each vertex pushed in/out along its
    // own radial direction by a low-frequency, smoothly-varying offset
    // (three overlapping sine waves in world-scale x/y/z, not per-vertex
    // random noise) — low frequency is what keeps the bumps broad and
    // rounded rather than pointed/faceted; real river stones are lopsided
    // and irregular, never perfectly spherical, but every surface on one
    // is still a smooth, continuous curve
    // BUG FIX: IcosahedronGeometry (like three.js's other Polyhedron
    // geometries) builds a non-indexed triangle soup — every triangle
    // gets its own private copy of each corner vertex, none of them
    // actually shared, so a later computeVertexNormals() has nothing to
    // average and degenerates to flat per-face shading (the visible
    // faceted/geodesic look this had at first). mergeVertices welds the
    // coincident corners back into one shared, indexed vertex per unique
    // position BEFORE displacement/normals below, so adjacent faces
    // genuinely share vertices and computeVertexNormals can blend across
    // them into real smooth shading
    let rockGeo = mergeVertices(new THREE.IcosahedronGeometry(0.85, 4));
    {
      const pos = rockGeo.attributes.position;
      const v = new THREE.Vector3();
      for(let i = 0; i < pos.count; i++){
        v.fromBufferAttribute(pos, i);
        const dir = v.clone().normalize();
        const bump = 0.12 * Math.sin(dir.x * 2.3 + 1.0) * Math.cos(dir.y * 1.7 - 0.6)
          + 0.08 * Math.sin(dir.y * 3.1 + dir.z * 2.0)
          + 0.05 * Math.cos(dir.z * 2.6 - dir.x * 1.4 + 2.2);
        v.addScaledVector(dir, bump);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
      rockGeo.computeVertexNormals();
      // real tangent data for the new normal map below — see this same
      // session's earlier wall-banding fix (normalizeWallUV's own
      // comment) for why this matters: without it, MeshStandardMaterial
      // falls back to an approximate screen-space tangent basis that
      // aliases into visible banding on a curved surface like this one
      rockGeo.computeTangents();
      // aoMap samples uv2, not uv, in three.js — this object has no
      // second, non-overlapping UV set (nor does it need one, being a
      // single object rather than a tiled surface), so uv2 just reuses
      // the same spherical UVs already computed above
      rockGeo.setAttribute('uv2', rockGeo.attributes.uv);
    }
    // real stone variegation — the same procedural wear/AO/caustic system
    // every other water-adjacent surface in this room already uses, not
    // a texture (no normal map here at all, deliberately, given today's
    // whole detour into normal-map tangent artifacts elsewhere — this
    // analytic bump doesn't need real tangent data the way a sampled
    // normal map does)
    this._realismMaterials.push(applyRealism(sphereMat, { aoHeight: 0.6, aoStrength: 0.28, causticHeight: 0.9, causticStrength: 0.12, reflectBandHeight: 0.9, reflectBandStrength: 0.1, albedoWear: 0.07, roughWear: 0.14, edgeStrength: 0.05 }));
    const sphere = new THREE.Mesh(rockGeo, sphereMat);
    // centred exactly at the water plane — genuinely half submerged,
    // not hovering above it — and the ripple shader below is centred on
    // this same point, so the water actually reads as pushing rings out
    // from where the ball sits in it
    sphere.position.set(SPHERE_POS.x, SPHERE_POS.y, SPHERE_POS.z);
    sphere.castShadow = true;
    sphere.userData.fadeGroup = 'props';
    group.add(sphere);
    this.sphere = sphere;

    // contact shadow — grounds the sphere into the water itself (see
    // buildContactShadowDecal's own comment), independent of the real
    // directional shadow the sphere already casts
    // ART-DIRECTION POLISH (per direct request): opacity raised
    // (0.4→0.46) — "nothing should appear to float," a touch more
    // grounding at every real contact point
    const sphereShadow = buildContactShadowDecal(this._contactShadowTex, 2.3, 2.3, 0.46);
    sphereShadow.position.set(SPHERE_POS.x, 0.105, SPHERE_POS.z);
    group.add(sphereShadow);
  }

  // a small spiral staircase in the room's right-back corner, near the
  // second (right) slit window — simple stacked/rotated box treads
  // winding up around a central post, the same low-poly primitive
  // vocabulary as the chairs/pedestal rather than a modelled staircase
  _buildSpiralStairs(){
    const group = new THREE.Group();
    // ART-DIRECTION POLISH (per direct request): roughness lowered
    // (0.8→0.64) — "differentiate wood" via reflectance/roughness rather
    // than colour; real varnished/worn wood tread has a soft satin sheen
    // that catches a visible highlight under a raking sun, which a
    // near-fully-matte 0.8 surface just can't produce. Still well short
    // of a glossy/lacquered look — this is worn wood, not polished
    // SINGLE-SUN LIGHTING PASS (per direct request): cut hard (0.5→0.08)
    // alongside wallMat's own matching cut — same reasoning, this is one
    // more architectural surface that was reading HDRI ambient instead
    // of just keyLight's real directional falloff
    // REALISM PASS (per direct request — "make sure the stairs also get
    // the same material as the wood," alongside the general flat/
    // "Minecraft" complaint): swapped the flat colour swatch + fake
    // sine-stripe grain for a real photographed wood PBR set (see
    // loadWoodPBR near the top of this file) — the SAME set stoneMat
    // uses below, so the whole sphere→stones→stairs walkway reads as one
    // continuous material rather than two similar-but-different tans.
    // material.color kept as a light neutral tint (not the old 0xd6cab0
    // swatch) so it multiplies the real diffuse map rather than fighting it
    const stepMat = new THREE.MeshStandardMaterial({
      color: 0xe8dcc0, roughness: 0.64, metalness: 0.04, envMapIntensity: 0.16,
      ...loadWoodPBR(2.2),
    });
    stepMat.normalScale.set(0.7, 0.7);
    this._realismMaterials.push(applyRealism(stepMat, { aoHeight: 1.1, aoStrength: 0.26, causticHeight: 3.5, causticStrength: 0.32, reflectBandHeight: 3.5, reflectBandStrength: 0.24, albedoWear: 0.06, roughWear: 0.16, gradientWash: 0.4 }));
    const steps = 16;
    const riseStep = 0.24;
    const innerR = 0.28, outerR = 1.3;
    const totalAngle = Math.PI * 2 * 1.4;
    // REALISM PASS: a real bevelled tread (buildRoundedPanelGeometry —
    // the same ExtrudeGeometry+bevelEnabled helper the chair seat/
    // backrest already use, see its own comment above) instead of a raw
    // unbevelled BoxGeometry — a sharp 90° tread edge under a raking sun
    // is exactly the kind of hard CAD edge that reads as "blocky" no
    // matter how much surface detail the material itself carries. The
    // helper extrudes along its own local Z (the panel's "thickness");
    // rotateX(-90°) here reassigns that axis to world Y (the tread's
    // real vertical thickness) once, on one shared geometry reused by
    // every tread below, rather than per-mesh
    const treadGeo = buildRoundedPanelGeometry(outerR - innerR, 0.6, 0.1, 0.035, 0.014);
    treadGeo.rotateX(-Math.PI / 2);
    for(let i = 0; i < steps; i++){
      const angle = (i / steps) * totalAngle;
      const y = i * riseStep;
      const tread = new THREE.Mesh(treadGeo, stepMat);
      const midR = (innerR + outerR) / 2;
      tread.position.set(Math.cos(angle) * midR, y, Math.sin(angle) * midR);
      tread.rotation.y = -angle;
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);
    }
    const postH = steps * riseStep + 0.4;
    // a liquid "lava lamp" material for the stair's own centre pole —
    // per direct request. A self-contained ShaderMaterial (same
    // convention already used for the floor's own water shader above
    // and the dissolve pass later in this file) rather than a real
    // refractive glass tube: several soft metaball blobs drift and bob
    // up/down the pole's own height, in real-world units (uRadius/
    // uHeight — the tube's circumference is much smaller than its
    // height, so blending the two axes in raw UV space would squash
    // every blob into a thin horizontal smear), blended into a warm
    // glow colour against a cooler liquid base, lit by a plain
    // diffuse+fresnel approximation using the new key light's own
    // direction (see _buildEnvironment) rather than the full PBR model
    // a generic material would use
    const poleRadius = innerR * 0.65;
    const lavaUniforms = {
      uTime: { value: 0 },
      uRadius: { value: poleRadius },
      uHeight: { value: postH },
      uLightDir: { value: new THREE.Vector3(3.5, 10, 4).normalize() },
    };
    const poleMat = new THREE.ShaderMaterial({
      uniforms: lavaUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main(){
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uRadius;
        uniform float uHeight;
        uniform vec3 uLightDir;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        float hash(float n){ return fract(sin(n) * 43758.5453123); }

        void main(){
          const int N = 6;
          float field = 0.0;
          float circumference = 6.28318 * uRadius;
          for(int i = 0; i < N; i++){
            float fi = float(i);
            float speed = mix(0.08, 0.16, hash(fi));
            float phase = hash(fi + 10.0) * 6.28318;
            // bounces back and forth along the tube's own height rather
            // than rising and instantly wrapping — reads as a real
            // bobbing blob hitting the top/bottom of a sealed tube
            float travel = abs(fract(uTime * speed + hash(fi) * 4.0) * 2.0 - 1.0);
            float by = mix(0.08, 0.92, travel);
            float bx = 0.5 + 0.5 * sin(uTime * 0.25 + phase);
            float du = vUv.x - bx;
            du -= floor(du + 0.5); // wrap around the circumference
            float dv = vUv.y - by;
            float dist = length(vec2(du * circumference, dv * uHeight));
            float r = mix(0.16, 0.26, hash(fi + 20.0));
            field += pow(r / max(dist, 0.001), 4.0);
          }
          float t = smoothstep(0.8, 1.4, field);

          // PALETTE PASS (per direct request: "make the lava lamp not
          // have a purple liquid but more of a clear liquid color, so
          // we can see through it and see the window and stairs behind
          // it"): the dark purple base is gone — liquidColor is now a
          // near-clear pale glass tint, and (see gl_FragColor below)
          // this material is genuinely transparent now, not just a
          // lighter opaque colour. Real alpha blending is what actually
          // lets the window/stairs show through, not the colour alone
          vec3 liquidColor = mix(vec3(0.78, 0.86, 0.87), vec3(0.68, 0.8, 0.82), vUv.y);
          vec3 blobColor = vec3(1.0, 0.42, 0.12);
          vec3 base = mix(liquidColor, blobColor, t);

          vec3 N2 = normalize(vNormalW);
          float diff = max(dot(N2, normalize(uLightDir)), 0.0);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(N2, viewDir), 0.0), 3.0);

          vec3 lit = base * (0.35 + diff * 0.65) + vec3(1.0) * fresnel * 0.35;
          vec3 emissive = blobColor * t * 0.55;
          // clear glass tube: low base alpha (mostly see-through) that
          // rises toward the glowing blobs themselves (t) and at grazing
          // angles (fresnel) — real glass/liquid both read more opaque
          // at their own edges than dead-on through the middle
          float alpha = clamp(0.22 + t * 0.55 + fresnel * 0.25, 0.0, 0.92);
          gl_FragColor = vec4(lit + emissive, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.lavaPoleUniforms = lavaUniforms;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(innerR * 0.65, innerR * 0.65, postH, 16),
      poleMat
    );
    post.position.set(0, postH / 2, 0);
    post.castShadow = true;
    group.add(post);
    // COMPOSITION PASS (per direct request: "move the staircase entirely
    // more closer to where the window is casting light so that right
    // wall can have a stair shadow on it"): moved from the deep back-
    // right corner (4.0,-5.0) to sit much shallower (-1.8) and a touch
    // left (2.6) — keyLight enters through the left wall's windows and
    // travels mostly +X with only a slight -Z drift (see keyLight's own
    // position/target in _buildEnvironment), so a shallower Z puts this
    // structure genuinely in that beam's path between the windows and
    // the right wall, where it can actually cast a real silhouette
    // shadow there instead of sitting in the room's darkest, least-lit
    // corner. STAIR_CONTACT (this file's own water-shader shoreline
    // anchor) and the stepping-stones' own end point (_buildSteppingStones)
    // are kept in sync with this same position
    group.position.set(2.6, 0, -1.8);

    // contact shadow — grounds the stair base into the water itself
    // (see buildContactShadowDecal's own comment). Added as a child of
    // this same group so its local (0,y,0) lands right at the pole's
    // own base once the group's own position offset above applies
    // see the sphere's own matching contact-decal comment in _buildScene
    const stairShadow = buildContactShadowDecal(this._contactShadowTex, 2.9, 2.9, 0.46);
    stairShadow.position.set(0, 0.105, 0);
    group.add(stairShadow);

    // "props" — the fast-fading group in the Section 1 → Section 2
    // dissolve (see _bindScrollTrigger/_frame), stamped onto every mesh
    // in this group at once rather than tagged one-by-one
    group.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
    this.roomGroup.add(group);

    // a traffic light sits right on top of the post — its own colour
    // cycles red → yellow → green as the visitor scrolls through the 4
    // process steps (see _updateTrafficLight, driven from _frame).
    // BUG FIX (per direct request — "the traffic light looks like it's
    // just floating there now"): this is a standalone call with its OWN
    // hardcoded world position, NOT a child of the stair `group` above —
    // it was still using the stairs' OLD position (4.0,-5.0) after the
    // COMPOSITION PASS moved the actual stair group to (2.6,-1.8),
    // leaving the light floating disconnected from its own pole
    this._buildTrafficLight(2.6, postH, -1.8);
  }

  // three emissive lenses in a dark housing — red/yellow/green, in that
  // order top-to-bottom like a real traffic light. Built with emissive
  // colour + a low base emissiveIntensity (not zero — even the "off"
  // lenses keep a faint glow, since a real signal lens never reads as
  // fully dead-black) that _updateTrafficLight brightens per-lens as
  // the scroll progress passes through each colour's own zone
  _buildTrafficLight(x, y, z){
    const group = new THREE.Group();
    // ART-DIRECTION POLISH (per direct request): roughness lowered
    // (0.55→0.42) and metalness raised slightly (0.25→0.32) — "painted
    // metal" should read as distinctly glossier/more reflective than the
    // matte plaster/stone around it via reflectance alone, not colour
    // SINGLE-SUN LIGHTING PASS (per direct request): this had no explicit
    // envMapIntensity before (three.js's own default is 1.0 — the
    // strongest of any material in the room, on a fairly reflective
    // dark-metal surface) — given an explicit low value now, same
    // reasoning as the other architectural materials above
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.42, metalness: 0.32, envMapIntensity: 0.14 });
    // causticStrength raised (0.05→0.09→0.14) alongside the wall/stair/
    // platform materials per direct request to "increase moving
    // caustics across the walls, columns, platform, and stairs" — the
    // closest thing this room has to a freestanding column. causticHeight
    // added (default 2.0→3.6) since the housing itself sits atop the
    // spiral stair's own post, well above the water — without reaching
    // further up, the caustic term would already be zeroed out by the
    // time it reaches this material at all
    this._realismMaterials.push(applyRealism(housingMat, { aoStrength: 0.16, causticHeight: 4.5, causticStrength: 0.24, reflectBandHeight: 4.5, reflectBandStrength: 0.2, desatStrength: 0.08 }));
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.24), housingMat);
    housing.position.y = 0.475;
    housing.castShadow = true;
    // was missing — a real MeshStandardMaterial, so this actually works
    // (unlike the lava-shader pole it sits on, a custom ShaderMaterial
    // with no shadow-map sampling chunks of its own). Per direct
    // request that every object both cast AND receive shadows
    housing.receiveShadow = true;
    group.add(housing);

    // ART-DIRECTION POLISH (per direct request): roughness lowered
    // (0.4→0.26) — a real signal lens is moulded glossy plastic/glass,
    // meaningfully shinier than the painted metal housing right next to
    // it (0.42 above); keeping that gap is what actually sells "plastic
    // lens in a metal body" rather than two similar surfaces in
    // different colours
    const lensGeo = new THREE.CircleGeometry(0.095, 24);
    const redMat = new THREE.MeshStandardMaterial({ color: 0x551515, emissive: 0xff2b2b, emissiveIntensity: 0.15, roughness: 0.26 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0x554415, emissive: 0xffcc33, emissiveIntensity: 0.15, roughness: 0.26 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x155520, emissive: 0x33ff66, emissiveIntensity: 0.15, roughness: 0.26 });

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
      // .process-step--raised (style.css) moves it above the eye,
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
    // stored rather than applied directly — _applyTextTilt (called once
    // per frame, right after this) appends the mouse-driven 3D tilt on
    // top of this same base position/fade-offset transform, so both can
    // coexist in the one final transform string this element actually
    // gets
    this._stepBaseTransform = nearest === last
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

  // gives the "Welcome"/step text and the neon quick-nav a small,
  // physical-object feel — per direct request: perspective + rotateY
  // tied to horizontal mouse position, a touch of translateZ for real
  // depth, its own inertia (eases toward the cursor and settles back to
  // centre rather than tracking 1:1), and a subtle brightness/contrast
  // response as it "turns" — like it's catching/losing a little light
  // as it tilts, not just moving. Called once per frame from _frame(),
  // right after _updateProcessStep sets this._stepBaseTransform (the
  // position/fade-offset transform this tilt gets appended to, not
  // replaces)
  //
  // Lerps toward this.mouseTarget.x — the RAW -1..1 pointer position
  // (already recentres to 0 on idle/mouseleave, see _bindEvents) — with
  // its own dedicated factor, rather than toward this.mouse.x (the
  // ALREADY heavily-smoothed value the camera's own parallax uses,
  // CONFIG.mouseLerp:0.02). Tried chaining a second lerp on top of that
  // one first; the compounded lag made the text take several seconds to
  // visibly react at all, well past "slightly lags behind" into
  // "doesn't seem connected to the cursor." Lerping the raw target
  // directly, at a factor slower than the camera's own but still
  // perceptible within a fraction of a second, is what actually reads
  // as inertia rather than disconnection
  _applyTextTilt(dt){
    if(!this.stepEl && !this.neonMenuEl) return;
    const target = this.mouseTarget ? this.mouseTarget.x : 0;
    const tiltFactor = 1 - Math.pow(1 - 0.08, (dt || 16.6667) / 16.6667);
    this._textTiltX = (this._textTiltX || 0) + (target - (this._textTiltX || 0)) * tiltFactor;
    const tilt = this._textTiltX;
    const rotY = (tilt * -5).toFixed(2);
    const depth = (8 + Math.abs(tilt) * 6).toFixed(1);
    const tiltStr = `perspective(900px) rotateY(${rotY}deg) translateZ(${depth}px)`;
    const brightness = (1 + tilt * 0.035).toFixed(3);
    const contrast = (1 + Math.abs(tilt) * 0.025).toFixed(3);
    const filterStr = `brightness(${brightness}) contrast(${contrast})`;
    if(this.stepEl){
      this.stepEl.style.transform = `${this._stepBaseTransform || ''} ${tiltStr}`;
      this.stepEl.style.filter = filterStr;
    }
    if(this.neonMenuEl){
      this.neonMenuEl.style.transform = `translateX(-50%) ${tiltStr}`;
      this.neonMenuEl.style.filter = filterStr;
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
    const platformH = 0.36;
    // SINGLE-SUN LIGHTING PASS (per direct request): cut hard (0.45→0.08),
    // same reasoning as the other architectural materials above
    // REALISM PASS (per direct request: "add this texture to the chair
    // platforms/floor", later switched to Poly Haven's "Checkered
    // Pavement Tiles" — see loadPavementPBR's own comment): color left
    // white so the real photographed tile colour comes through
    // unmultiplied, same reasoning as sphereMat's own rock texture above
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.16 });
    loadPavementPBR(platformMat, 2.5);
    // causticHeight/causticStrength raised (1.2→1.6, 0.12→0.19) per
    // direct request to "increase moving caustics across the walls,
    // columns, platform, and stairs"
    // ART-DIRECTION POLISH (per direct request): causticStrength/Height
    // raised (0.19→0.25, 1.6→2.0) — "water bounce lighting underneath
    // the platform" is explicitly called for, and the platform sits
    // right at the water's own edge, closer to it than almost anything
    // else in the room, so it should show the strongest, most legible
    // version of this effect
    this._realismMaterials.push(applyRealism(platformMat, { aoHeight: 0.95, aoStrength: 0.26, causticHeight: 3.0, causticStrength: 0.36, reflectBandHeight: 1.8, reflectBandStrength: 0.32, albedoWear: 0.05, roughWear: 0.14, gradientWash: 0.5 }));
    // GEOMETRY-CLIPPING FIX (per direct request): this used to reach all
    // the way to leftEdge=-6.9/zBack=-6.4, sized against the flat
    // "roomWidth/2 = 7" assumption for the left wall. That assumption is
    // wrong for THIS wall specifically — unlike the back wall, the left
    // wall is rotated (Math.PI/2 - 0.18, not a flat 90°, see the side-
    // wall build above), so it's not a plane of constant x at all; it
    // physically converges inward (toward the room's own centre) as it
    // runs back toward the back wall. A flat rectangular platform sized
    // against the wall's FRONT-most x position pokes straight through the
    // wall's own solid mass everywhere further back than that, which is
    // exactly the "platform sticks out of the left wall" bug. Measured
    // directly against the live mesh's own matrixWorld (not re-derived
    // by hand from the rotation angle — this wall's rotation makes that
    // math easy to get subtly wrong) rather than guessed: the wall's real
    // interior face sits at world x ≈ -5.60 at this platform's own back
    // edge (its most-restrictive point) and ≈ -6.03 at its front edge.
    // -5.4 clears the worst of those with a real margin (~0.2) at every
    // point in between, not just at one end.
    //
    // The back edge has the same problem against the BACK wall: -6.4 sat
    // well past its interior face (world z = -5.5, see backWall.position
    // above) — anywhere in this platform's x-range there's no arch
    // opening to pass through (the arch only spans x [-1.8, 1.8], this
    // platform never reaches past -1.8), so that overshoot was poking
    // straight through solid backWall geometry too. -5.2 keeps a real
    // 0.3-unit margin in front of it instead.
    const leftEdge = -5.4;
    const rightEdge = -1.8;
    const platformW = rightEdge - leftEdge;
    const platformCenterX = (leftEdge + rightEdge) / 2;
    // COMPOSITION PASS (per direct request — same treatment as the
    // stairs: "do the same for the chairs and the floor that holds the
    // chair"): shifted shallower (-4.0→-1.5). This wall's interior face
    // actually recedes FURTHER away as z gets shallower (see this
    // function's own clipping-fix comment above — the wall converges
    // inward toward the BACK, not the front), so leftEdge/rightEdge stay
    // safely clear here without needing their own re-derivation. Kept
    // in sync with PLATFORM_MIN/MAX above and chairShadow/px/pz below
    const platformCenterZ = -1.5;

    // COMPOSITION PASS (per direct request: "make the entire floor
    // platform rotate clockwise around its center... keep the chairs
    // fixed to the platform so they move with it... make the chair
    // platform be a circle style platform"): platform, its contact
    // shadow, and every chair are now children of one Group positioned
    // at the platform's own centre — spinning that Group (see _frame's
    // own this.chairPlatformGroup.rotation.y update) rotates all of it
    // rigidly in place around its own centre, never sliding across the
    // room, exactly like a real turntable. Every position below this
    // point is LOCAL to that group now, not a world position — px/pz
    // and the chair shadow's own position both shifted from their old
    // world coordinates to the equivalent local offset from this
    // group's own origin (platformCenterX/Z)
    const chairPlatformGroup = new THREE.Group();
    chairPlatformGroup.position.set(platformCenterX, 0, platformCenterZ);
    this.roomGroup.add(chairPlatformGroup);
    this.chairPlatformGroup = chairPlatformGroup;

    // radius matches the old rectangular platform's own half-width
    // (platformW/2 = 1.8), so the circle reaches exactly as far toward
    // the wall as the box used to, at its most restrictive point
    const platformRadius = platformW / 2;
    const platformGeo = new THREE.CylinderGeometry(platformRadius, platformRadius, platformH, 32);
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.set(0, platformH / 2, 0);
    platform.castShadow = true;
    platform.receiveShadow = true;
    platform.userData.fadeGroup = 'structure';
    chairPlatformGroup.add(platform);

    // contact shadow — grounds the settled chair pile onto the
    // platform itself (see buildContactShadowDecal's own comment)
    // see the sphere's own matching contact-decal comment in _buildScene
    const chairShadow = buildContactShadowDecal(this._contactShadowTex, 2.0, 2.0, 0.5);
    chairShadow.position.set(-0.2, platformH + 0.005, -0.2);
    chairPlatformGroup.add(chairShadow);

    // local offset (from the group's own origin, see this function's
    // own comment above) where the settled chair pile sits on the disc
    const px = -0.2, pz = -0.8;

    // SINGLE-SUN LIGHTING PASS (per direct request): this dedicated
    // accent/kicker light for the chair sculpture removed entirely — the
    // room is meant to read as lit by ONE real light (keyLight, the sun
    // raking in from the left) now, not the sun plus a scattered set of
    // small local point lights each tinting whatever they're near. See
    // _buildEnvironment's own comment for the fuller version of this —
    // every other fill/bounce light in the room was removed at the same
    // time, for the same reason

    // six chairs, each with its own colour, offset, and full XYZ
    // rotation — some seat-up, some tipped on a side or upside down —
    // so the pile reads as tossed together rather than neatly arranged.
    // PALETTE PASS (per direct request: "change the color of the light
    // green chairs to something more dark, but paled mid tone dark"):
    // the earlier bright/light greens (0x9fc98a/0xbcdba0) muted down to
    // a desaturated, darker mid-tone green — still readable as green,
    // no longer a vivid highlight colour in the pile
    // BUG FIX (per direct request: "each chair is inside some of the
    // chairs... every chair close enough, but not morphed into chairs"):
    // a chair's own bounding size (seat+back+legs) is roughly 0.5 wide/
    // deep and close to 1.0 tall (see buildChairGroup), so the old 0.28-
    // 0.34 vertical gaps between consecutive chairs here left almost no
    // real clearance once a chair's random full-XYZ rotation swings its
    // seat/back sideways into its neighbour — reading as fused geometry
    // rather than a pile of distinct chairs stacked/leaned together.
    // Vertical offsets spread further apart below (still touching/
    // leaning, this is still meant to read as a tossed pile, just no
    // longer overlapping enough to merge silhouettes)
    const chairs = [
      { color: 0x2a251f, pos: [-0.55, 0.00, 0.35], rot: [0, 0.4, 0] },
      // BUG FIX (per direct request: "fix the chairs that are bleeding
      // into the platform"): pos.y raised (0.02→0.28) — a 1.4-rad Z roll
      // tips this chair heavily onto its side, and at the old near-zero
      // height its seat's own far edge swung down through the solid
      // platform disc beneath it
      { color: 0x5c7a5e, pos: [0.35, 0.28, -0.4], rot: [0, -0.8, 1.4] },
      { color: 0x6b5636, pos: [0.62, 0.5, 0.3], rot: [1.3, 0.9, 0.2] },
      { color: 0x1c1916, pos: [-0.35, 0.72, -0.2], rot: [0.3, -1.6, 2.6] },
      { color: 0x4d6a52, pos: [0.1, 1.02, 0.55], rot: [2.9, 0.5, -0.6] },
      { color: 0x4a3c26, pos: [-0.7, 1.28, -0.55], rot: [1.9, -0.3, 1.1] },
    ];
    // ten more, continuing to climb higher up the same pile — a tiny
    // deterministic pseudo-random walk (not Math.random, so the pile
    // looks the same on every reload) rather than 10 hand-tuned tuples,
    // with the horizontal spread tapering in as the stack gets taller
    // (a real tossed pile narrows toward its own top). Same muted-dark-
    // green recolour as above — the darker browns/blacks stay untouched,
    // still giving the pile real colour variety
    const moreColors = [0x557a5c, 0x3c3226, 0x51735a, 0x241f18, 0x6e5a38, 0x2d2a22, 0x4a6b52, 0x1a1712, 0x54452c, 0x466354];
    let seed = 7;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for(let i = 0; i < 10; i++){
      // BUG FIX: step raised 0.34→0.44 and start raised 0.95→1.55 (to
      // clear the hand-authored chairs above, now themselves spread up
      // to y=1.28) — same overlap fix as those six, see this array's own
      // comment above
      const h = 1.55 + i * 0.44;
      const spread = Math.max(0.15, 0.75 - i * 0.06);
      chairs.push({
        color: moreColors[i],
        pos: [(rand() - 0.5) * spread * 2, h, (rand() - 0.5) * spread * 2],
        rot: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
      });
    }
    chairs.forEach(({ color, pos, rot }) => {
      const chair = buildChairGroup(color, rand);
      chair.position.set(px + pos[0], platformH + pos[1], pz + pos[2]);
      chair.rotation.set(rot[0], rot[1], rot[2]);
      chair.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
      chairPlatformGroup.add(chair);
      // FINAL LIGHTING POLISH (per direct request): aoStrength/edgeStrength
      // both raised above their shared defaults (0.21/0.05 → 0.3/0.09) for
      // this specific material — tighter contact shadow where one chair
      // overlaps another, plus a slightly stronger Fresnel rim catching
      // each chair's own edges, is what actually separates individual
      // chairs from their neighbours instead of the pile blending into
      // one silhouette. Scoped to the chairs only (not a global default
      // change) since this is a local "make the focal point read more
      // clearly" request, not a room-wide contrast change
      this._realismMaterials.push(applyRealism(chair.userData.chairMaterial, { aoHeight: 0.5, aoStrength: 0.3, edgeStrength: 0.09, causticHeight: 0.9, causticStrength: 0.07 }));
    });

    // 18 more chairs on top of those 16 (per direct request: "instead
    // of the chairs connecting to the wall, keep them going up" — the
    // wallDrift term that used to ease the pile sideways into the
    // wall's own inner face, "coming out of the wall" on purpose, is
    // removed entirely; this column now just keeps climbing straight
    // up on the platform's own footprint, taller than before, rather
    // than resolving into the wall). Each chair still gets a small
    // independent floating bob (see _frame's own this._floatingChairs
    // loop) so this upper portion reads as more alive/precarious than
    // the settled pile below it
    // PALETTE PASS: same muted mid-tone-dark green treatment as the
    // settled pile below, not the old bright greens
    const wallColors = [0x557a5c, 0x638066, 0x4a6b52, 0x557560, 0x4a6a4d, 0x5c7a5e, 0x466354, 0x5a7a5c, 0x4d6b52, 0x577560, 0x517050, 0x5f7d64];
    this._floatingChairs = [];
    let seed2 = 42;
    const rand2 = () => { seed2 = (seed2 * 9301 + 49297) % 233280; return seed2 / 233280; };
    const startH = 1.55 + 10 * 0.44; // continues exactly where the settled pile's own top chair left off
    const climbCount = 18;
    // BUG FIX: step raised 0.32→0.4, same overlap fix as the settled
    // pile above — see that array's own comment
    for(let i = 0; i < climbCount; i++){
      const h = startH + i * 0.4;
      const spread = Math.max(0.12, 0.5 - i * 0.025);
      const chair = buildChairGroup(wallColors[i % wallColors.length], rand2);
      const baseX = px + (rand2() - 0.5) * spread * 2;
      const baseY = platformH + h;
      const baseZ = pz + (rand2() - 0.5) * spread * 2;
      chair.position.set(baseX, baseY, baseZ);
      chair.rotation.set(rand2() * Math.PI * 2, rand2() * Math.PI * 2, rand2() * Math.PI * 2);
      chair.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
      // see the settled pile's own matching comment above
      this._realismMaterials.push(applyRealism(chair.userData.chairMaterial, { aoHeight: 0.4, aoStrength: 0.3, edgeStrength: 0.09, causticHeight: 0.7, causticStrength: 0.05 }));
      chairPlatformGroup.add(chair);
      this._floatingChairs.push({
        mesh: chair,
        baseY,
        phase: rand2() * Math.PI * 2,
        speed: 0.4 + rand2() * 0.3,
        amp: 0.03 + rand2() * 0.03,
      });
    }
  }

  // BUG FIX (per direct request: "I do not think the rocket is doing any
  // work, are we able to remove that rocket and add a real looking human
  // eye that blinks"): the rocket ship (previously a floating crystal
  // before that) is gone — replaced with a stylized eye: a white sclera
  // sphere, a canvas-textured iris/pupil disc (real striations + a
  // catchlight highlight, not a flat colour), and a periodic blink
  // animation (see _frame's own eye block). The blink itself is a
  // deliberate simplification — real eyelids are skin, not sclera-
  // white, but animating true skin-toned lids would mean rebuilding
  // spherical-cap geometry every single blink frame for a very marginal
  // realism gain; scaling the iris disc itself down to a thin sliver
  // (revealing the white sclera around/behind it) reads as a convincing
  // fast blink at this object's actual size in frame, at a fraction of
  // the complexity/risk
  _buildEye(){
    const eye = new THREE.Group();
    const eyeRadius = 0.34;

    // sclera — a real MeshPhysicalMaterial clearcoat for the moist/wet
    // highlight a real eyeball always has, not a flat matte sphere
    const scleraMat = new THREE.MeshPhysicalMaterial({
      color: 0xf1ede2,
      roughness: 0.32,
      metalness: 0.0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.0,
    });
    this._realismMaterials.push(applyRealism(scleraMat, { roughWear: 0.04, albedoWear: 0.02 }));
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 32, 32), scleraMat);
    sclera.castShadow = true;
    sclera.receiveShadow = true;
    eye.add(sclera);

    // iris/pupil — baked once as a canvas texture: a light green radial
    // gradient (per direct request), fine dark striations radiating out
    // from the pupil (a real iris is never a flat solid colour), a
    // near-black pupil, and a small offset white catchlight (what
    // actually makes an eye read as "alive" rather than a painted
    // marble)
    const irisCanvas = document.createElement('canvas');
    irisCanvas.width = irisCanvas.height = 256;
    const ictx = irisCanvas.getContext('2d');
    const cx = 128, cy = 128, irisR = 108, pupilR = 42;
    ictx.fillStyle = '#f1ede2';
    ictx.fillRect(0, 0, 256, 256);
    const irisGrad = ictx.createRadialGradient(cx, cy, pupilR * 0.7, cx, cy, irisR);
    irisGrad.addColorStop(0, '#7fae6f');
    irisGrad.addColorStop(0.55, '#8fc27c');
    irisGrad.addColorStop(1, '#3f6b3a');
    ictx.fillStyle = irisGrad;
    ictx.beginPath(); ictx.arc(cx, cy, irisR, 0, Math.PI * 2); ictx.fill();
    let seed = 11;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    ictx.lineCap = 'round';
    for(let i = 0; i < 72; i++){
      const a = (i / 72) * Math.PI * 2;
      const inner = pupilR * (0.85 + rand() * 0.15);
      const outer = irisR * (0.94 + rand() * 0.06);
      ictx.strokeStyle = `rgba(20,32,14,${0.2 + rand() * 0.25})`;
      ictx.lineWidth = 1 + rand() * 1.8;
      ictx.beginPath();
      ictx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ictx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ictx.stroke();
    }
    ictx.fillStyle = '#0b0805';
    ictx.beginPath(); ictx.arc(cx, cy, pupilR, 0, Math.PI * 2); ictx.fill();
    // BUG FIX (per direct request: "the eye looks very unreal" — see the
    // real cornea dome added below): these baked catchlights used to be
    // the ONLY specular highlight this eye had at all — a highlight
    // painted directly into the texture stays glued to the same spot on
    // the iris no matter how the camera moves or the light falls, which
    // is exactly what reads as a flat painted sticker rather than a wet
    // curved surface. Dimmed well down (0.9→0.35, 0.35→0.15) now that the
    // cornea dome below provides a REAL, camera-reactive specular
    // highlight instead — these just add a little residual iris sheen
    // underneath it
    ictx.fillStyle = 'rgba(255,255,255,0.35)';
    ictx.beginPath(); ictx.arc(cx - pupilR * 0.42, cy - pupilR * 0.42, pupilR * 0.24, 0, Math.PI * 2); ictx.fill();
    ictx.fillStyle = 'rgba(255,255,255,0.15)';
    ictx.beginPath(); ictx.arc(cx + pupilR * 0.5, cy + pupilR * 0.55, pupilR * 0.12, 0, Math.PI * 2); ictx.fill();
    const irisTex = new THREE.CanvasTexture(irisCanvas);
    irisTex.colorSpace = THREE.SRGBColorSpace;
    const irisMat = new THREE.MeshStandardMaterial({ map: irisTex, roughness: 0.22, metalness: 0.0 });
    const irisDisc = new THREE.Mesh(new THREE.CircleGeometry(eyeRadius * 0.62, 48), irisMat);
    // proud of the sclera's own front surface — this is what this.eyeIris
    // scales down to a thin sliver for the blink (see _frame)
    irisDisc.position.z = eyeRadius * 0.97;
    eye.add(irisDisc);
    this.eyeIris = irisDisc;

    // BUG FIX (per direct request: "the eye looks very unreal"): the
    // pupil painted into the canvas above is genuinely near-black
    // (confirmed directly via getImageData: ~11,8,5) but this room's
    // single-strong-directional-light + HDRI environment lighting was
    // still lifting the LIT pupil disc to a pale, washed-out grey no
    // matter how far roughness/envMapIntensity were pushed down on
    // irisMat (confirmed live, isolating the eye from the rest of the
    // scene) — a real pupil has to read as a true velvety black
    // regardless of the room's own lighting, so it gets its own small,
    // unlit MeshBasicMaterial disc, immune to lights/environment/
    // tonemapping entirely, sitting proud of irisDisc at the exact
    // radius of the canvas's own drawn pupil (pupilR=42 of irisR=108,
    // same ratio applied to irisDisc's real-world radius). Parented to
    // irisDisc itself (not the outer eye group) so the blink's
    // this.eyeIris.scale.y squash below carries the pupil along with it
    // for free, same as it always did when the pupil was just part of
    // irisDisc's own texture
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0b0805 });
    const pupilDisc = new THREE.Mesh(new THREE.CircleGeometry(eyeRadius * 0.62 * (42 / 108), 32), pupilMat);
    pupilDisc.position.z = 0.002;
    irisDisc.add(pupilDisc);
    this.eyePupil = pupilDisc;

    // BUG FIX (per direct request: "the eye looks very unreal"): the
    // flat painted iris disc, with no actual curved refractive surface
    // over it, was reading as a printed sticker rather than a real
    // eyeball — a real eye's cornea is a small, distinctly-curved,
    // transmissive dome sitting proud of the iris, and it's what
    // produces a REAL specular highlight that shifts correctly as the
    // camera/light move (unlike a highlight baked into the texture
    // above, which stays glued to one spot no matter what). Built as a
    // small spherical CAP (not a full sphere) cut from a sphere smaller
    // than the eyeball itself — a tighter radius of curvature than the
    // sclera is exactly what gives a cornea its visible bulge — then
    // rotated so that cap faces forward (+z) instead of three.js's
    // default +y pole, and pulled back so its footprint lines up with
    // the iris disc underneath while its apex pokes slightly proud of it
    const corneaR = eyeRadius * 1.47;
    const corneaFootprint = eyeRadius * 0.62; // matches irisDisc's own radius
    const corneaThetaMax = Math.asin(Math.min(1, corneaFootprint / corneaR));
    const corneaGeo = new THREE.SphereGeometry(corneaR, 32, 16, 0, Math.PI * 2, 0, corneaThetaMax);
    // three.js's polar cap starts at the +Y pole (theta measured from
    // +Y); rotating +90° about X carries +Y onto +Z, which is this eye's
    // own forward axis (see irisDisc.position.z above) — the negative
    // rotation was tried first and sends the cap to -Z instead (facing
    // backward into the wall), confirmed directly by a close camera
    // teleport onto the eye showing a collapsed/misplaced blob rather
    // than a forward-facing dome
    corneaGeo.rotateX(Math.PI / 2);
    const corneaMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0.0,
      transmission: 1.0,
      thickness: 0.05,
      ior: 1.376, // real corneal index of refraction
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.3,
      // BUG FIX: `transparent: true` was set here alongside transmission
      // — three.js's transmission effect handles its own compositing
      // internally (sampling a real render of what's behind it) and does
      // NOT want the ordinary alpha-blend path layered on top. With
      // transparent:true and the default opacity of 1, that alpha blend
      // resolved to a flat, fully opaque white disc sitting on top of
      // the iris — confirmed directly via a close camera teleport onto
      // the eye, which showed exactly that (a pale blob masking the
      // pupil) instead of a clear, refractive dome
    });
    const cornea = new THREE.Mesh(corneaGeo, corneaMat);
    const corneaApexZ = irisDisc.position.z + eyeRadius * 0.06;
    cornea.position.z = corneaApexZ - corneaR;
    eye.add(cornea);

    // COMPOSITION PASS (per direct request: "the eye should be more oval
    // shaped"): a real human eye reads as a horizontal almond, not a
    // perfect circle — scaling the whole group (sclera + iris disc
    // together, so the iris stays flush on the sclera's own surface
    // rather than the two diverging) wider than tall achieves that
    // without needing a hand-sculpted lens shape
    eye.scale.set(1.28, 0.86, 1);

    // floating in the arch doorway itself. COMPOSITION PASS (per direct
    // request: "the eyeball should be more up towards where the window
    // arch is"): raised from 2.3 to 4.6 — well above archHeight's own
    // true centre (3.6) and into the upper third of the opening, closer
    // to where the rectangular sides give way to the arch's own rounded
    // cap (the springline sits at 7.2 - archWidth/2 = 5.4, see
    // traceArch), with enough clearance below that springline that the
    // eye (scaled radius up to ~0.34*1.28 ≈ 0.44 on its widest axis)
    // never pokes into the curved part.
    // BUG FIX (per direct request: "the eye looks really fake in the
    // background... move it more closer not outside the arch but inside
    // the interior arch wall towards the top"): z moved from -5.7 to
    // -5.5 — the back wall's own room-facing interior surface sits at
    // world z = -roomDepth/2 - wallThickness + wallThickness = -5.5 (see
    // backWall.position.set below), so -5.7 was sitting IN the wall's
    // thickness but biased toward its outer/sky-facing face, reading as
    // suspended past the doorway in open air rather than embedded in the
    // architecture. -5.5 sits flush with the interior face instead,
    // unambiguously part of the wall/arch structure. y nudged up
    // (4.6→5.0) per the same request's own "towards the top," still
    // comfortably under the 5.4 springline
    eye.position.set(0, 5.0, -5.5);
    eye.traverse((o) => { if(o.isMesh) o.userData.fadeGroup = 'props'; });
    this.roomGroup.add(eye);
    this.eye = eye;
    this._eyeBaseY = eye.position.y;
    this._eyeTime = 0;
    // periodic blink — a short random-ish gap (not a fixed metronome
    // interval, real blinks don't come on a perfect clock) between
    // blinks, each blink itself very quick
    this._eyeNextBlink = 1.5 + Math.random() * 2.5;
    this._eyeBlinking = false;
    this._eyeBlinkT = 0;
  }

  // ATMOSPHERE PASS (per direct request: "add small particles moving
  // around the entire scene, like the unseen.co things that are
  // floating around" — confirmed directly on unseen.co's own hero: a
  // sparse field of tiny, soft, pale motes drifting slowly through the
  // whole frame, not tied to any one surface): a single THREE.Points
  // cloud spanning the room's own real bounds (roomWidth/roomHeight/
  // roomDepth below, not a made-up box), animated entirely on the GPU —
  // each particle's rise speed/sway/size/phase is baked into its own
  // per-vertex attributes ONCE here, and the vertex shader below moves
  // every particle every frame from a single uTime uniform. This is
  // deliberately NOT a per-frame CPU position update (looping over
  // hundreds of vertices in JS every tick, the naive way to animate a
  // point cloud) — this room already has a real perf budget to protect
  // (see CONFIG.dprCap/renderFPS's own comments), and a GPU-driven
  // animation costs the same one JS assignment (uTime.value = ...)
  // every frame regardless of particle count
  _buildDustParticles(){
    const roomWidth = 14, roomHeight = 14, roomDepth = 11;
    // fewer on mobile — same reasoning as every other density/count
    // knob in this file (keyLight.shadow.mapSize, floorSegs, etc.):
    // mobile GPUs are the weakest hardware this scene runs on, and nothing
    // about a background atmosphere effect justifies spending equally on
    // both tiers
    const count = this.isMobile ? 90 : 220;
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const sway = new Float32Array(count);
    const size = new Float32Array(count);
    for(let i = 0; i < count; i++){
      // spread across the room's real interior — x/z pulled in slightly
      // from the true wall bounds (roomWidth/2, roomDepth/2) so motes
      // read as floating IN the space rather than clipping through
      // solid walls at the extreme edge of their own random range
      positions[i * 3 + 0] = (Math.random() * 2 - 1) * (roomWidth / 2 - 0.6);
      positions[i * 3 + 1] = Math.random() * roomHeight;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * (roomDepth / 2 + 2.5);
      phase[i] = Math.random() * Math.PI * 2;
      // real dust motes don't all rise at the same rate — this range
      // (0.035–0.08 world units/sec) is slow enough to read as ambient
      // drift rather than anything that draws the eye on its own
      speed[i] = 0.035 + Math.random() * 0.045;
      sway[i] = 0.15 + Math.random() * 0.35;
      // BUG FIX (per direct request: "particles are a little too
      // small"): a first bump (0.85–2.35) turned out to still read as
      // barely-there once actually checked in the browser — confirmed
      // directly by temporarily forcing every particle's size to a flat
      // 6.0 live in the console, which read as a clearly visible, still
      // crisp (not blobby) field of dots. This range is centred on that
      // same confirmed-good value, with real per-particle variety kept
      // around it rather than a flat uniform size
      size[i] = 4.0 + Math.random() * 4.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, this.isMobile ? CONFIG.dprCapMobile : CONFIG.dprCap) },
      uRoomHeight: { value: roomHeight },
      // warm, near-white — sunlit dust rather than a coloured effect of
      // its own; opacity capped low (see fragment shader) so this reads
      // as a faint atmospheric hint, never a snow/confetti effect
      uColor: { value: new THREE.Color(0xfff3e0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      // additive, but the fragment shader's own opacity ceiling (0.28)
      // keeps this from ever blowing out to a bright sparkle even where
      // several motes happen to overlap on screen
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uRoomHeight;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aSway;
        attribute float aSize;
        varying float vFade;
        void main(){
          // rises forever at its own speed, wrapping back to the floor
          // via mod() rather than resetting with a visible pop — the
          // wrap point is invisible because vFade below fades a particle
          // out just before it (and back in just after) rather than
          // ever showing a hard cut
          float y = mod(position.y + uTime * aSpeed * uRoomHeight, uRoomHeight);
          // gentle horizontal wander, independent phase per axis so
          // particles don't all sway in lockstep
          float x = position.x + sin(uTime * 0.25 + aPhase) * aSway;
          float z = position.z + cos(uTime * 0.2 + aPhase * 1.7) * aSway;
          vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // real point-sprite size attenuation (perspective-correct,
          // not just a flat pixel size) — matches how every other real
          // sized-point effect in three.js scales with camera distance
          // BUG FIX (per direct request: too big/blobby on first look —
          // confirmed directly via screenshot): 120.0 here made every
          // particle read as a soft glowing orb rather than a fine dust
          // speck at this room's own real camera distances (typically
          // 3–15 units) — dropped to 9.0, sized against aSize's own
          // reduced range below for genuinely small points
          gl_PointSize = aSize * uPixelRatio * (13.0 / -mvPosition.z);
          // fades the topmost/bottommost sliver of the wrap range so the
          // mod() reset above is never visible as a hard pop
          float edge = uRoomHeight * 0.06;
          vFade = min(y / edge, (uRoomHeight - y) / edge);
          vFade = clamp(vFade, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vFade;
        void main(){
          // soft round falloff from the point sprite's own centre
          // (gl_PointCoord), not a hard-edged square — this is what
          // actually reads as a soft dust mote instead of a visible dot
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float alpha = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor, alpha * 0.2 * vFade);
        }
      `,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.userData.fadeGroup = 'props';
    this.roomGroup.add(points);
    this.dustPoints = points;
    this.dustUniforms = uniforms;
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
  // floorMat, sphereMat, platformMat, poleMat) controls how
  // much of its true colour the HDRI's own bounce reveals
  _buildEnvironment(){
    // SINGLE-SUN LIGHTING PASS (per direct request): this room went
    // through a long history of layered fill/bounce lights (a hemisphere
    // ambient, a warm point light at each opening, an upward blue-green
    // "water bounce" directional, a warm "architecture re-radiating"
    // point light, a chair-sculpture accent light) — see this file's own
    // git history/prior comments for that whole progression. The direct
    // complaint that ended it: every one of those was a real, positioned
    // Three.js Light with its own colour, so every wall ended up a
    // different tinted shade depending on which fill lights happened to
    // be nearest it, rather than reading as one coherent room lit by one
    // sun. All of them are removed here. keyLight (the actual sun,
    // directly below) is now the ONLY THREE.Light in this scene — every
    // wall's brightness and colour now comes from just two things: how
    // much of keyLight's own direct raking light it catches, and the
    // room's scene.environment HDRI (see _buildScene's own PMREM/
    // RGBELoader block), which is a real photographed sky rather than a
    // fabricated coloured point light, scaled down small per-material via
    // envMapIntensity (wallMat, floorMat, platformMat, etc.) so it reads
    // as a faint, physically-real ambient rather than a second light
    // source competing with the sun

    // the left wall's two window openings sit close to world x=-7,
    // spread across roughly z=+1.5..-1.5 (see _buildScene's winCenters,
    // that wall's own rotation.y) — this light sits well outside that
    // wall shining back in and slightly down, so its own rays visibly
    // rake across the room from screen-left. This real DirectionalLight
    // + its real shadow map (below) is the ONLY thing selling "sunlight
    // enters here" — no fake glow-cone/beam standing in for it
    //
    // ARCHITECTURAL LIGHTING PASS (per direct request): lowered from a
    // ~34°-down midday-ish angle to ~10° — a genuine late-afternoon
    // coastal rake. Shadow LENGTH is a direct geometric consequence of
    // elevation angle (length ≈ height / tan(angle)) — no amount of
    // shadow-quality tuning substitutes for actually lowering the sun,
    // which is why position (not just the shadow settings below)
    // changed here. Target kept exactly where it was so the light's
    // still aimed into the same part of the room; only where it's
    // coming FROM changed. (See LOCKED_SUN_DIR/LOCKED_SUN_COLOR above —
    // the visible sky/clouds/water are deliberately still lit from the
    // OLD ~34° direction, frozen on purpose, so this move only affects
    // real architectural shadows, not the locked environment or water)
    //
    // REFINEMENT PASS (per direct request): a genuine sun rarely lines
    // up perfectly square with a room's own axis — a real coastal late-
    // afternoon light typically has some azimuth skew, not just a low
    // elevation. Adding a real Z component (0.6→1.8) gives this light
    // an actual diagonal rake across the room instead of traveling
    // almost pure-X, which is what "longer, more readable repeating"
    // staircase-tread shadows and clearer separation between individual
    // chairs in the sculpture's own shadow both need — a face-on light
    // tends to stack silhouettes on top of each other; an angled one
    // spreads them out. It's also what actually strengthens the back
    // wall's own light gradient (a room-spanning light with real
    // diagonal component reads its own directionality far more clearly
    // across a flat wall than one travelling parallel to it). Elevation
    // barely moves (~10°→~9.6°, still the same late-afternoon rake)
    //
    // PREMIUM LIGHTING PASS (per direct request): nudged once more
    // (2.3→2.5) — with hemiLight pulled back to a much fainter cool-sky
    // role above and the fill/bounce lights below staying deliberately
    // soft, the sun needed to read as unambiguously the brightest, most
    // saturated thing in the room ("the sun should become the primary
    // light source") rather than just the one with the hardest shadow.
    // Modest on purpose — this is a brighter ACCENT on already-sunlit
    // surfaces, not a global exposure change (renderer.toneMappingExposure
    // stays untouched), so shadow regions don't move at all from this;
    // only the gap between them and direct sun widens
    //
    // SUN-CONTRAST PASS (per direct request): nudged once more
    // (2.5→3.1) now that the point-light fill above has been pulled back
    // specifically so it stops relighting keyLight's own shadow side —
    // with that budget no longer competing, the sun itself can push
    // harder without the room reading as uniformly brighter overall,
    // which is what actually produces the "walls read as being lit by a
    // single sun outside, not evenly lit" look from the reference
    //
    // SINGLE-SUN LIGHTING PASS (per direct request): raised again
    // (3.1→4.2) alongside the exposure bump above — this is now
    // genuinely the ONLY light in the room, so it has to carry the
    // entire visible brightness on its own rather than being one bright
    // accent among several other sources. A stronger sun is what makes
    // the surfaces it actually reaches read as clearly, legibly lit,
    // rather than just slightly-less-dark than everything else
    // BUG FIX (per direct request: "the walls have a nice texture... but
    // the color made the walls darker" — after THREE separate material-
    // level fixes here still didn't change what the wall visibly looked
    // like, a direct diagnostic (forcing wallMat.color to pure red)
    // confirmed the material itself DOES render correctly — a red wall
    // showed up red. The real cause is this light's own saturation: this
    // is the room's ONLY light source (see this function's own "SINGLE-
    // SUN LIGHTING PASS" comment), so literally every lit surface's
    // colour is (surface colour × this light's colour), and 0xffcb8f is
    // a fairly deep, saturated orange — even a pure-white wall multiplied
    // by it reads as tan/brown, which is exactly why raising the wall's
    // OWN colour kept hitting a ceiling. Lightened toward a paler gold
    // (0xffcb8f→0xffe4c8, blending roughly halfway to white) — still
    // unmistakably warm/golden-hour, just no longer saturated enough to
    // turn a light surface visibly brown. Intensity/position/shadow
    // tuning below are all untouched — this only changes hue
    // MOOD PASS (per direct request, after a direct unseen.co comparison:
    // "soften the lighting"): unseen's own hero reads as soft, near-
    // shadowless bounce/GI lighting — no single hard raking sun — while
    // this room's single strong DirectionalLight was tuned in the
    // opposite direction for most of this session (legible, sharply-
    // edged shadows on the chair pile/stair treads). Trading a little of
    // that legibility back for mood: intensity trimmed (4.2→3.6) to
    // lower the peak brightness a hard sun creates, shadow.radius pushed
    // back UP (2.1→5.5, reopening the "FINAL LIGHTING POLISH" tightening
    // above) for genuinely soft shadow edges instead of a crisp cutoff,
    // and fillLight's own floor raised further below so shadowed
    // surfaces sit closer to lit ones instead of falling away sharply
    const keyLight = new THREE.DirectionalLight(0xffe4c8, 3.6);
    keyLight.position.set(-15, 3.3, 1.8);
    keyLight.target.position.set(-1.5, 1.0, 0.4);
    keyLight.castShadow = true;
    // raised on desktop (2048→3072) — the ±20 shadow-camera bounds
    // needed for long shadow throws (below) spread the same map over a
    // wider area, which was quietly costing resolution exactly where
    // "individual chairs recognizable, not blending together" needs it
    // most. Mobile left at 1024 — real cost here scales with the
    // square of map size, and mobile's budget is tighter to begin with
    keyLight.shadow.mapSize.set(this.isMobile ? 1024 : 3072, this.isMobile ? 1024 : 3072);
    keyLight.shadow.camera.near = 1;
    // the light itself sits at almost the same distance from its target
    // as before (~13.8 units vs ~13.7) despite the new Z offset, so far
    // (36) and the ±20 bounds below still comfortably cover the room —
    // confirmed visually after the diagonal shift, no clipping
    keyLight.shadow.camera.far = 36;
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.bias = -0.0023;
    // WALL-SHADOW FIX (per direct request): the back wall's own slit-
    // window reveal — a thin extruded side face meeting the wall's front
    // face at a hard near-90° interior corner — is exactly the geometry
    // a plain depth bias struggles with, which is what previously read
    // as flickering acne there and led to disabling that wall's
    // receiveShadow entirely rather than fixing the actual cause.
    // normalBias offsets the shadow-map lookup along the SURFACE NORMAL
    // (in world units) instead of just deeper along the light's own view
    // axis the way bias above does — at a sharp perpendicular seam like
    // this one, that's what actually separates the two faces' samples
    // instead of letting them bleed into each other. Left the existing
    // bias untouched (still handling ordinary flat-surface acne on the
    // treads/platform/chairs) — this is a genuinely separate, additive
    // fix, not a replacement for it
    //
    // INVESTIGATED (per direct request — a screenshot of the left wall's
    // own near-edge-on segment, seen from the establishing "Welcome"
    // camera, showing regular "lines"): confirmed by direct diagnostic
    // (temporarily toggling that one segment's own receiveShadow off
    // made the lines vanish completely, with both its diffuse and
    // normal-map source photos independently confirmed clean) to be
    // shadow acne on a segment that's close to edge-on to BOTH the light
    // and the camera at once — more extreme than the slit-window reveal
    // this value was tuned for. Tried raising this as high as 0.3 first;
    // it never fully resolved this specific case even there, so rather
    // than keep pushing a value that risks visible light-leak "peter-
    // panning" everywhere ELSE it's already correctly tuned, this stayed
    // at its original value — see nearWall's own receiveShadow for the
    // actual fix, scoped to just the one segment that needed it
    keyLight.shadow.normalBias = 0.045;
    // tightened again (3.0→2.4) — per direct request for the chair
    // sculpture's own overlapping silhouettes and the staircase's own
    // repeating tread shadows to read as legible/distinct rather than
    // one soft blur. Three.js's own shadow radius is a single uniform
    // blur amount with no real awareness of distance from the actual
    // caster (true contact-hardening — sharp right at the contact
    // point, softening further out — needs a fundamentally different
    // shadow-mapping technique, out of scope for a parameter-tuning
    // pass); the existing per-object contact-shadow decals (see
    // buildContactShadowDecal) already carry that "sharp right at the
    // base" read on their own, so this radius only has to handle the
    // longer, real cast-shadow throws, and can afford to run tighter
    // than a single do-everything value would need to
    //
    // FINAL LIGHTING POLISH (per direct request): tightened once more
    // (2.4→2.1) — "strengthen the transition between direct sunlight and
    // indirect light" means the boundary itself needs to read, not just
    // the two sides of it; a softer edge here was quietly blending the
    // last little bit of direct sun into the indirect/bounce-lit area
    // right at the seam, making the handoff feel gradual/washed rather
    // than like two genuinely different lighting regimes meeting. Still
    // real PCF softening, not a hard cutoff — just less of it
    // MOOD PASS (per direct request — see this light's own constructor
    // comment above): pushed back up from 2.1 to 5.5, deliberately
    // reopening the earlier "FINAL LIGHTING POLISH" tightening — a soft,
    // wide PCF blur is exactly what reads as bounce/GI-lit rather than a
    // hard sun, at the direct cost of the crisp individual-chair/tread
    // silhouettes that tightening was originally chasing
    keyLight.shadow.radius = 5.5;
    // REFERENCE-MATCH PASS (reopens the "SINGLE-SUN, zero fill" decision
    // above, per direct request/reference comparison): that earlier
    // reasoning — "everywhere without a direct sun path stays dark,
    // exactly like a real room" — turned out non-physical in practice.
    // A real room lit by one window-side sun is NEVER actually lit by
    // that one light alone: light bounces off the water, off the sunlit
    // half of the walls, off the sky through the openings, and fills
    // every shadowed surface with a soft, colour-neutral floor of
    // brightness. The reference photo confirms this directly — its
    // shadowed walls read as clearly visible plaster, never pure black.
    // A single soft HemisphereLight (not a return to the old multi-
    // point-light rig that caused patchiness — this casts no shadows
    // and has no hotspot, it's a smooth top/bottom gradient) is the
    // minimum fix: keyLight stays the only shadow-casting, only
    // strongly-directional light, this only raises the floor everything
    // else sits on
    // MOOD PASS (per direct request — see keyLight's own comment above):
    // raised again (0.55→0.85) so shadowed surfaces sit noticeably
    // closer in brightness to sunlit ones, the actual mechanism behind
    // unseen.co's own shadowless-looking bounce lighting
    const fillLight = new THREE.HemisphereLight(0xf3e7cf, 0x33473f, 0.85);
    this.scene.add(fillLight);
    this.fillLight = fillLight;

    // keyLight is still the ONLY shadow-casting, directional light — its
    // shadow map (configured above) is what makes the room read as sun-
    // lit rather than uniformly flat: light only reaches an interior
    // surface directly where there's an actual unobstructed path from
    // keyLight's own direction through a real opening in the walls (the
    // left wall's two windows, the main arch, the smaller clerestory
    // slit beside the arch) — everywhere else now falls back to
    // fillLight's soft floor instead of crushing to black
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);
    this.keyLight = keyLight;

    // wires the water's own specular sun-glint (see the Reflector's
    // shader in _buildScene) to LOCKED_SUN_DIR/LOCKED_SUN_COLOR (see
    // that constant's own comment) — NOT to this light's own live
    // position/colour any more. The water's optical model is explicitly
    // frozen; keyLight itself is now free to move for real shadow-
    // casting purposes without dragging the water's glint along with it
    if(this.floorRippleUniforms){
      this.floorRippleUniforms.uSunDir.value.copy(LOCKED_SUN_DIR);
      this.floorRippleUniforms.uSunColor.value.set(LOCKED_SUN_COLOR);
    }

    // SINGLE-SUN LIGHTING PASS (per direct request): the four opening/
    // bounce PointLights and the upward blue-green bounce DirectionalLight
    // that used to live here (leftOpeningLight, archOpeningLight,
    // bounceLight, archBounceLight) are all removed — see this method's
    // own opening comment for why. keyLight above is the only light left

    // the room used to sit in a black void past its own walls (a flat
    // renderer clear colour, nothing actually drawn there) — replaced
    // per direct request with a real, physically-based world: a huge
    // procedural sky dome (this IS the room's scene.environment now too,
    // baked via PMREMGenerator.fromScene — real IBL/GI sourced from the
    // exact same sky the room is visibly sitting under, not a separate
    // static HDRI any more) plus an endless ocean (see _buildScene's own
    // Reflector floor, now sized far past the room itself). Every
    // opening (the two left windows, the back wall's slit, the main
    // arch) shows this same real geometry beyond it rather than a faked
    // per-opening background, because there's nothing left to fake —
    // it's an actual sphere of sky enclosing the whole scene
    // the real three.js Sky (Preetham analytic atmospheric-scattering
    // model, vendored with targeted patches — js/vendor/examples/jsm/
    // objects/Sky.js, see that file's own comments for exactly what and
    // why: skyExposure/uHorizonTint/uHorizonTintStrength, and now a
    // re-added soft sun glow) per direct request, replacing the earlier
    // hand-rolled 3-colour gradient dome. Physically-derived Rayleigh/
    // Mie scattering gives a genuinely correct horizon gradient and sun
    // glow shape instead of an approximated one — its own vertex shader
    // forces gl_Position.z = gl_Position.w, pinning it to the far plane
    // every frame regardless of the box's own literal scale, so normal
    // depth testing against the room's real geometry (and the ocean
    // plane) still occludes it correctly without any special handling
    const sky = new Sky();
    sky.scale.setScalar(450000);
    const skyUniforms = sky.material.uniforms;
    // GOLDEN-SUNSET PASS (per direct request): turbidity raised (4→6.5)
    // and mieCoefficient raised (0.003→0.006) together — turbidity is
    // literally "how much haze/dust is in the air," and more of it is
    // what pushes a Preetham sky from a clean blue toward a warm, hazy
    // gold; mieCoefficient governs how much of that haze scatters as
    // the whitish/warm Mie term specifically (vs. Rayleigh blue), so
    // raising both together is what actually reads as "golden," not
    // just "hazier." mieDirectionalG raised slightly (0.8→0.88) tightens
    // the forward-scattering glow around the sun's own bearing — a real
    // hazy sunset concentrates its warmth close to the sun rather than
    // spreading it evenly across the whole sky
    //
    // SKY-PALETTE PASS (per direct request: zenith should be "a very
    // light light blue," the sun's own corner "a very light beige," not
    // grey) — pulled back hard (6.5→3.2). All of the golden-sunset
    // tuning above was deliberately pushing this sky AWAY from clear-blue
    // and toward hazy/gold; that's the opposite of what's being asked
    // for now, so this walks that back rather than layering a fix on
    // top of it. Lower turbidity is a real clear-air value — less haze
    // scattering the warm Mie term, more of the sky reading as clean
    // Rayleigh blue
    skyUniforms.turbidity.value = 3.2;
    // GREY-SKY DIAGNOSIS FIX (per direct request): rayleigh pulled back
    // (2.5→1.1) — this was still tuned for the OLD, higher, bluer-
    // daytime sun elevation, and left at that strength it keeps a real
    // blue-scattering contribution fighting the new warm turbidity/Mie
    // settings, which is part of what was reading as muddy/grey rather
    // than a clean gold instead of two competing tints
    //
    // SKY-PALETTE PASS (per direct request): raised back up (1.1→2.6) —
    // that earlier cut was specifically to suppress blue in service of a
    // golden-hour look; a genuinely light pale-blue zenith needs real
    // Rayleigh scattering back, not less of it
    skyUniforms.rayleigh.value = 2.6;
    // SKY-PALETTE PASS (per direct request): both pulled back alongside
    // turbidity above (0.006→0.0035, 0.88→0.78) — less haze overall, and
    // a softer (not tightly hot-spotted) glow around the sun so that
    // corner reads as a gentle beige wash rather than a punchy orange
    // concentration
    skyUniforms.mieCoefficient.value = 0.0035;
    skyUniforms.mieDirectionalG.value = 0.78;
    // see Sky.js's own comment on this uniform — turbidity/rayleigh/
    // mieCoefficient only set the Rayleigh-vs-Mie colour RATIO, not the
    // shader's absolute output magnitude (dominated by hardcoded
    // constants baked into the GLSL source); at this room's low, warm
    // sun angle the near-horizon band its own narrow window/arch
    // openings actually reveal sits deep enough into that hardcoded HDR
    // range that ACES tonemapping crushes it toward flat white
    // regardless of those three ratios. This is the real brightness dial.
    // GREY-SKY DIAGNOSIS FIX (per direct request): raised (0.16→0.34) —
    // confirmed the diagnosis directly: at 0.16, the whole sky (including
    // the new golden horizon tint) was being scaled down far enough that
    // ACES tonemapping had too little magnitude left to render it as a
    // distinct warm hue, so it read as flat grey instead of dim gold.
    // Brightness and perceived saturation are coupled under tonemapping
    // — this is the real fix, not a colour-ratio tweak
    //
    // SKY-PALETTE PASS (per direct request): nudged up again (0.34→0.42)
    // — "very light" is itself a brightness statement, not just a colour
    // one; a pale blue that's still sitting too low in the tonemap range
    // reads as grey-blue/dim rather than genuinely light
    skyUniforms.skyExposure.value = 0.42;
    // GOLDEN-SUNSET PASS: horizon tint deepened (0.87,0.8,0.68→
    // 0.95,0.72,0.45, a more saturated orange-gold) and strengthened
    // (0.55→0.75) — this is the colour Sky.js's own patched comment
    // explains stands in for a real photographed horizon's warmth
    // (its physically-neutral-grey horizon term doesn't have any colour
    // of its own to give), and a low sunset sun is exactly when that
    // band should read richest
    //
    // SKY-PALETTE PASS (per direct request: the sun's own corner should
    // read as "very light beige," not a saturated gold): desaturated hard
    // (0.95,0.72,0.45→0.94,0.88,0.76, a genuinely pale cream/beige, not
    // orange) and weakened (0.75→0.45) — this band should tint the
    // nearby sky gently, not paint a strong orange wash over it
    skyUniforms.uHorizonTint.value.set(0.94, 0.88, 0.76);
    skyUniforms.uHorizonTintStrength.value = 0.45;
    // LOCKED_SUN_DIR, NOT keyLight.position — the visible sky/sun and
    // the room's own real shadow-casting light have been deliberately
    // decoupled (see LOCKED_SUN_DIR's own comment) so keyLight can move
    // for architectural shadow purposes without the environment (locked)
    // silently moving with it. Sky's own vertex shader only ever
    // normalizes this for direction (vSunDirection), but vSunfade reads
    // sunPosition.y directly assuming a large-magnitude vector (the
    // official three.js example always uses one on this same ~1e5
    // scale) — scaling the unit direction up keeps that math in the
    // range it was actually designed for
    const sunDir = LOCKED_SUN_DIR.clone();
    skyUniforms.sunPosition.value.copy(sunDir).multiplyScalar(400000);
    this.scene.add(sky);
    this.skyMesh = sky;

    // clouds — Sky.js has no cloud layer of its own, so a separate,
    // purely-transparent dome carries just that on top of it: the same
    // 4-octave fBm noise approach as before, now blended additively over
    // whatever the real atmospheric-scattering sky underneath already
    // looks like rather than mixed into a flat hand-picked gradient
    const cloudGeo = new THREE.SphereGeometry(2000, 32, 16);
    const cloudMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: sunDir },
        uCloudTime: { value: 0 },
        // same colour the sky's own horizon tint and the water's own
        // haze fade into (see HORIZON_HAZE_COLOR) — used below to blend
        // the LOWEST part of the cloud dome into that same colour, so
        // the haze reads as one continuous atmospheric layer wrapping
        // from the water's surface up through the sky rather than the
        // cloud dome having its own separate, unrelated horizon edge
        uCloudHaze: { value: new THREE.Color(HORIZON_HAZE_COLOR) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main(){
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform float uCloudTime;
        uniform vec3 uCloudHaze;
        varying vec3 vWorldPos;

        float cloudHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float cloudNoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          float a = cloudHash(i), b = cloudHash(i + vec2(1.0, 0.0));
          float c = cloudHash(i + vec2(0.0, 1.0)), d = cloudHash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        // 4-octave fBm — soft, drifting, roughly "volumetric-looking"
        // cloud cover out of pure 2D noise (a real raymarched volume is
        // far more than a static dome this size needs to spend on
        // itself every frame); layered amplitude/frequency falloff is
        // what gives it that characteristic fluffy, uneven cloud read
        // rather than one flat noise octave's own regular blob pattern
        float cloudFbm(vec2 p){
          float sum = 0.0, amp = 0.5, freq = 1.0;
          for(int i = 0; i < 4; i++){
            sum += cloudNoise(p * freq) * amp;
            freq *= 2.02;
            amp *= 0.5;
          }
          return sum;
        }

        void main(){
          vec3 dir = normalize(vWorldPos);
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          // projected using the direction's own xz over y (a cheap
          // dome-to-plane projection, fine since clouds only ever need
          // to read correctly in the upper sky, not near the
          // singularity straight up) so they wrap the dome without
          // visible seams
          float cloudAltitude = clamp(dir.y, 0.02, 1.0);
          vec2 cloudUV = dir.xz / cloudAltitude * 0.35 + vec2(uCloudTime * 0.006, uCloudTime * 0.003);
          float cloudDensity = cloudFbm(cloudUV);
          // SKY-PALETTE PASS (per direct request: the sky itself "is not
          // supposed to look gray") — threshold raised (0.52→0.68) so
          // meaningfully less of the noise field crosses into "cloud."
          // The Sky.js Preetham dome underneath this layer was tuned for
          // a clear pale-blue zenith, but at the old, wider threshold
          // this cloud deck covered enough of the sky that its own
          // colour (not the sky's) was what actually read through —
          // fixing the sky shader alone couldn't have worked while this
          // sat on top of it unchanged
          cloudDensity = smoothstep(0.68, 0.9, cloudDensity);
          // fades out completely by the horizon (clouds sitting "in"
          // the sky, not painted onto the haze band) and thins near the
          // sun so its own glow/disc still reads through rather than
          // being flatly painted over
          cloudDensity *= smoothstep(0.02, 0.22, dir.y);
          cloudDensity *= 1.0 - pow(sunDot, 6.0) * 0.6;
          // SKY-PALETTE PASS (per direct request): brightened toward
          // genuine white (0.92,0.9,0.86→0.97,0.97,0.95) — the old warm
          // grey-beige cloud colour was ALSO part of "looks grey"; real
          // clouds under a light blue sky read closer to bright white
          // than to a muted grey-beige
          vec3 cloudColor = mix(vec3(0.97, 0.97, 0.95), vec3(1.0, 0.97, 0.9), sunDot * 0.5);

          // second, higher/thinner cirrus-style layer — a different
          // scale and much slower drift than the main fBm above, kept
          // at low opacity throughout. Real skies rarely show just one
          // uniform cloud deck; a second layer at a different altitude
          // reads as genuine depth/scale in the sky rather than one
          // flat texture, satisfying "layered atmospheric haze" without
          // touching anything outside this dome
          vec2 cirrusUV = dir.xz / cloudAltitude * 0.9 + vec2(uCloudTime * 0.0021, -uCloudTime * 0.0014);
          float cirrus = cloudFbm(cirrusUV + 11.3);
          cirrus = smoothstep(0.58, 0.88, cirrus) * 0.35;
          cirrus *= smoothstep(0.05, 0.4, dir.y);
          vec3 cirrusColor = mix(vec3(0.95, 0.94, 0.9), uCloudHaze, 0.4);
          float density = clamp(cloudDensity * 0.8 + cirrus * (1.0 - cloudDensity), 0.0, 1.0);
          vec3 col = mix(cirrusColor, cloudColor, clamp(cloudDensity * 0.8 / max(density, 0.0001), 0.0, 1.0));

          // low-altitude haze band — blends the very bottom of this
          // dome into the same horizon colour the sky shader and the
          // water shader both fade into, so the whole visible
          // atmosphere (water surface -> horizon -> low sky) reads as
          // one continuous hazy layer instead of the cloud dome ending
          // on its own separate, untinted edge
          float lowHaze = 1.0 - smoothstep(0.02, 0.24, dir.y);
          col = mix(col, uCloudHaze, lowHaze * 0.5);
          density = clamp(density + lowHaze * 0.12, 0.0, 1.0);

          gl_FragColor = vec4(col, density);
        }
      `,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    // static and centred on the world origin, never the camera — at a
    // 2000-unit radius the room's own ~20-unit scale of camera movement
    // is well under 1% of that, no perceptible parallax error from
    // skipping the usual "re-centre on camera every frame" trick
    cloudMesh.matrixAutoUpdate = false;
    cloudMesh.updateMatrix();
    cloudMesh.renderOrder = 1;
    this.scene.add(cloudMesh);
    this.cloudMesh = cloudMesh;

    // scene.environment — real IBL/GI now, not baked from the procedural
    // dome above. A hand-written 3-colour gradient shader was tried
    // there first (PMREMGenerator.fromScene against a throwaway scene
    // containing just the dome), and it genuinely worked, but a flat
    // gradient's own light distribution is exactly what read as
    // "renderer-flat" rather than real: no cloud-shadowed nuance, no
    // photographed sky's natural colour variation, and its brightness
    // had to be hand-multiplied by a tuned uSkyIntensity fudge factor to
    // roughly match what a real HDR-range photo would have supplied
    // anyway. This uses an actual CC0 HDRI instead, purely for lighting:
    // every material's own envMapIntensity samples THIS for its
    // ambient/reflection contribution, completely decoupled from what
    // the sky dome above actually looks like on screen — that dome no
    // longer needs to double as a lighting source, so it's tuned purely
    // for how it should visually read. PATCHED this pass: was Poly
    // Haven's "Blue Lagoon" (cool, unrelated outdoor scene) — swapped
    // for "Small Harbour Sunset" (also Poly Haven CC0, downloaded once,
    // nothing fetches polyhaven.com at runtime) because the grey-sky
    // diagnosis found the mismatch itself was a coherence bug: no matter
    // how golden the visible dome became, every material's own ambient
    // light/reflections were still being lit by a cool, unrelated HDRI.
    // This one is an actual warm/golden-hour coastal scene, so the
    // room's own surfaces now pick up light consistent with the sky.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('img/hdri/small_harbour_sunset_1k.hdr', (hdrTex) => {
      const envMap = pmrem.fromEquirectangular(hdrTex).texture;
      // SINGLE-SUN LIGHTING PASS (per direct request): re-enabled, but
      // every architectural material's own envMapIntensity (wallMat,
      // stepMat, stoneMat, platformMat, housingMat) is now cut to a
      // small fraction of what it was — see each material's own
      // definition. The diagnostic pass with this fully disabled proved
      // this HDRI, not any removed light, was the actual source of
      // "every wall a different shade" (opposite-facing walls sample
      // opposite, very different-looking halves of the same photographed
      // sky). Keeping a small amount alive (rather than zero) is what
      // stops reflective surfaces — the traffic-light housing, the wet
      // stone/platform near the water — from reading as flat and dead;
      // this small a contribution no longer meaningfully competes with
      // keyLight for which one actually reads as "the room's lighting"
      this.scene.environment = envMap;
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
    // PREMIUM LIGHTING PASS (per direct request): contrastStrength nudged
    // (0.26→0.33) for real tonal separation — stronger shadow anchors and
    // brighter sun accents — while staying on this SAME smoothstep S-curve
    // mixed proportionally against the real value rather than a harder
    // curve or a levels-style clip, which is what keeps it from ever
    // crushing blacks to pure 0 or blowing highlights to pure 1 the way a
    // more aggressive contrast technique would. Deliberately short of
    // "dramatic" — this is one more step along a curve already proven
    // safe here, not a different technique
    const gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        vignetteStrength: { value: 0.3 },
        contrastStrength: { value: 0.33 },
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
          // split-tone deepened slightly alongside contrast above — ink
          // leans a touch further into shadow, gold a touch further into
          // highlight — so the added tonal separation still reads as
          // richer colour, not just darker/brighter grey
          //
          // BUG FIX (per direct request: "the walls have a nice texture...
          // but the color made the walls darker" — investigated directly,
          // twice, after wallMat's own base colour had already been
          // pushed all the way to pure white with no visible change): this
          // full-screen highlight tint was A real culprit, not the wall
          // material at all — at 0.81 on the blue channel, ANY bright
          // pixel scene-wide (a sunlit wall very much included) gets a
          // fifth of its blue multiplied away and a 13% red boost on top,
          // which is exactly what was pushing an already-pure-white wall
          // toward tan/brown after the fact, downstream of the material
          // entirely. Blue's own cut nearly halved (0.81→0.9) and red's
          // boost trimmed too (1.13→1.08) — still a warm highlight lean,
          // just no longer strong enough to turn white walls brown.
          // shadowTint softened too (0.9,0.87,0.87→0.97,0.96,0.97) — this
          // room's own keyLight is the ONLY light source (see
          // _buildEnvironment's own "SINGLE-SUN LIGHTING PASS" comment),
          // so any wall corner NOT directly raked by it is lit almost
          // entirely by faint ambient/bounce; that dim result was landing
          // in this shadow bracket and picking up the SAME warm-leaning
          // push, reading as a dark muddy brown rather than a cooler dim
          // plaster shadow
          vec3 shadowTint = vec3(0.97, 0.96, 0.97);
          vec3 highlightTint = vec3(1.08, 1.02, 0.9);
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
      { // 1 — Discover: the glass sphere, dead centre in the water.
        // COMPOSITION PASS: pos.z kept a fixed ~2.8-unit lead ahead of
        // SPHERE_POS.z (now 6.5, after two successive "move it further
        // back" requests) rather than a hardcoded number, so this stays
        // correctly framed if that constant ever moves again
        pos: new THREE.Vector3(0, 1.3, SPHERE_POS.z + 2.8),
        look: new THREE.Vector3(0, 1.25, SPHERE_POS.z + 0.2),
        label: 'Discover',
      },
      { // 2 — Steps: the spiral stairs (COMPOSITION PASS — moved from
        // the deep back-right corner to sit closer to the window light,
        // see group.position in _buildSpiralStairs). Camera pos offset
        // laterally from the new look target (rather than matching its
        // x exactly) to keep a real three-quarter angle instead of a
        // flat dead-on view
        pos: new THREE.Vector3(1.0, 2.0, 2.6),
        look: new THREE.Vector3(2.6, 2.2, -1.8),
        label: 'Steps',
      },
      { // 3 — Structure: the tossed chair pile (COMPOSITION PASS — moved
        // shallower alongside the platform, see px/pz in _buildChairPile).
        // COMPOSITION PASS (per direct request: "pan up to show how tall
        // the chairs reach... flying up to see the very top"): pos/look
        // both raised from ground level (was y 2.1/1.6) up near the
        // climbing pile's own top (startH + climbCount*0.32 above the
        // platform tops out around world y≈10, see _buildChairPile) —
        // x/z left close to their old values on purpose, so the stage
        // 2→3 transition itself reads as a straight vertical rise rather
        // than a lateral move that happens to also go up.
        // Re-raised again after the chair-overlap fix (_buildChairPile's
        // own vertical-spacing increase) pushed the climbing pile's own
        // real top from ~9.8 to ~12.75 world-y
        pos: new THREE.Vector3(-2.4, 9.4, 2.6),
        look: new THREE.Vector3(-3.8, 10.4, -2.1),
        label: 'Structure',
      },
      { // 4 — Delivery: the blinking eye, suspended dead-centre in the
        // arch doorway (this.eye.position is (0, 5.0, -5.5), see
        // _buildEye) — camera comes back to centre for this one (unlike
        // the off-axis Plan/Structure stops) so the room's own symmetry
        // frames it, the same way stage 1 frames the sphere.
        // COMPOSITION PASS (per direct request: "move the camera from
        // all the way at the top of the chairs path, to come down
        // towards the eye"): the "descend" read comes entirely from the
        // 3→4 transition falling from stage 3's new elevated y (7.0/7.8)
        // back down to this stage's own y.
        // COMPOSITION PASS (per direct request: "the eyeball should be
        // more up towards where the window arch is" / "move it... inside
        // the interior arch wall towards the top"): look.y/pos.y nudged
        // up again (+0.4, matching the eye's own 4.6→5.0) and look.z
        // moved with the eye's own z (-5.6→-5.5) so the camera keeps
        // looking at exactly where the eye now sits, without re-deriving
        // the framing from scratch
        pos: new THREE.Vector3(0, 4.4, 2.2),
        look: new THREE.Vector3(0, 5.0, -5.5),
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
    // COMPOSITION PASS: shifted by the same delta as stage 4 above, for
    // the same reason — keeps the reveal-dolly's own framing targeted at
    // the eye's current position
    this.revealCameraPos = new THREE.Vector3(0, 4.6, 1.0);
    this.revealCameraLook = new THREE.Vector3(0, 5.0, -5.5);

    // COMPOSITION PASS (per direct request: "move the camera more
    // back"): every framing above (all 5 stages, plus the reveal-dolly
    // target) pulled back from its own look target by a flat scale
    // factor, recentred on that same look point — one mechanical pass
    // rather than hand-retuning six framings individually. Mutates the
    // Vector3 instances already stored on this.stages/revealCameraPos
    // in place, so every other reference to them (dollyT lerp above,
    // _cameraForProgress below) automatically sees the wider framing
    const PULLBACK_SCALE = 1.32;
    [...this.stages, { pos: this.revealCameraPos, look: this.revealCameraLook }].forEach(({ pos, look }) => {
      const dir = pos.clone().sub(look).multiplyScalar(PULLBACK_SCALE);
      pos.copy(look).add(dir);
    });
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
    // COMPOSITION PASS (per direct request: "speed up the scroll
    // movement so that the room sways from one side to the other with
    // smoothness and speed" — matching unseen.co's own gentle drifting
    // hero motion): a continuous sine sway layered on top of the
    // authored per-stage travel, on both pos AND look together (not
    // just pos alone, which would read as the camera panning to stare
    // at a fixed point rather than the whole view gliding sideways).
    // journeyP (0..1 across the real stage journey only, not the dolly/
    // reveal hold after it) drives the phase so the sway rides the
    // scroll itself, not raw elapsed time — it stays perfectly in sync
    // with scrub either way, and freezes naturally once the journey
    // itself ends rather than continuing to drift during the hold
    //
    // BUG FIX (per direct request: "the camera seems to curve a bit into
    // the first step" / "the camera seems to drift towards the left side
    // when we reach the structure step"): the old 2.2-cycle phase had NO
    // relationship to the 4 segment boundaries, so it happened to be
    // near a rising extremum right as journeyP crossed into stage 1 and
    // near its OTHER extremum right at stage 3 — both stops landing
    // exactly where the sway's own contribution was near its largest, so
    // the authored framing at those two stages was always visibly pulled
    // off-target. Locking the phase to exactly `last` full cycles across
    // the whole journey (last = number of segments) guarantees
    // sin(swayPhase) is exactly 0 at EVERY stage boundary — every stage
    // is always reached at its own true authored pos/look, and the sway
    // only ever shows up mid-transition, between stops, never pinning a
    // stop itself off-centre
    const swayPhase = Math.min(journeyP, 1) * Math.PI * 2 * last;
    const sway = Math.sin(swayPhase) * 0.4;
    pos.x += sway;
    look.x += sway * 0.6;
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
    // see fovForAspect's own comment above — keeps the composition's
    // horizontal framing consistent across screen sizes instead of a
    // flat vertical FOV cropping in tight on narrow viewports and
    // shrinking away to empty space on wide ones
    this.camera.fov = fovForAspect(this.camera.aspect);
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
    this._applyTextTilt();
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
      // BUG FIX (per direct request: "make sure that with all sizes of
      // display, the image doesn't get stretched or shrunk"): the
      // comment this replaced assumed ScrollTrigger "already listens for
      // resize and recalculates its own pin boundaries on its own" —
      // confirmed directly this is NOT actually happening here: after a
      // real resize (and even a manually-dispatched 'resize' Event on
      // window), .process-room-sticky's own GSAP-applied inline
      // width/height stayed frozen at whatever size the pin was FIRST
      // created at, while window.innerWidth/innerHeight had genuinely
      // changed — meaning this.container.clientWidth/clientHeight below
      // (which _resize() reads) was reading stale, pre-resize numbers,
      // so the canvas kept rendering at the OLD viewport's pixel size
      // inside a CSS box now sized for the NEW one. A live console test
      // confirmed calling window.ScrollTrigger.refresh() directly fixes
      // this immediately (the pin's own inline dimensions update to
      // match the live viewport) — so this now calls it explicitly
      // rather than trusting GSAP's own default autoRefreshEvents
      // config to catch every real resize. Must run BEFORE _resize()
      // itself, so the container's own box is already correct by the
      // time _resize() reads its clientWidth/clientHeight
      this._resizeT = setTimeout(() => {
        if(window.ScrollTrigger) window.ScrollTrigger.refresh();
        this._resize();
      }, 200);
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
      // to move it there.
      //
      // !this._dissolveStarted matters just as much on the way there — a
      // real, confirmed race: _bindEnterButton's own click handler jumps
      // scrollY straight to the Section 2 landing spot BEFORE the wipe
      // even starts, but this._pinReleased doesn't flip true until
      // _completeDissolveHandoff runs a full ~1s later, once the wipe
      // finishes. window.scrollTo's own 'scroll' event fires
      // asynchronously, so for that whole ~1s window this listener saw
      // !this._pinReleased still true AND scrollY sitting (correctly,
      // deliberately) past dollyEndY — and snapped it right back down,
      // undoing the jump the visitor never actually saw happen (the room
      // was still covering the screen) but landed on once the wipe
      // finished anyway: confirmed directly as Section 2 settling ~1000px
      // short of where it should be, showing blank page background
      // instead. This._dissolveStarted is true for that entire window
      // (set the instant the button is clicked, only cleared again once
      // the reverse trip fully completes), so excluding it here means
      // this corrective snap only ever fires during genuine, un-scripted
      // scrolling — exactly what it was built for
      if(!this._pinReleased && !this._reversing && !this._dissolveStarted && this._scrollTrigger){
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
      // COMPOSITION PASS (per direct request: "...with smoothness and
      // speed"): a numeric scrub (a real trailing-catch-up lag, in
      // seconds) instead of scrub:true's instant 1:1 tracking — this is
      // what actually reads as fluid/gliding rather than rigidly welded
      // to the scrollbar, matching unseen.co's own smoothed motion
      scrub: 0.5,
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

  // primes the wipe for a given point (t, 0..1) — per direct request,
  // a plain linear (hard-edge) wipe for now via CSS clip-path rather
  // than the noise-dissolve shader (this.dissolvePass stays untouched/
  // inert, uProgress left at 0, so the room renders normally right up
  // to the clip edge) — simpler while more animation directions get
  // figured out together. 'forward' clips away from the BOTTOM edge
  // upward (uncovering whatever's behind starting at the bottom of the
  // screen); 'reverse' un-clips from the TOP edge downward (the visible
  // region is always the top slice, growing down). Split out from
  // _runWipe so _playReverse can prime the very first (fully-clipped)
  // frame BEFORE its own synchronous render, rather than rendering one
  // frame too early at the wrong progress
  _setWipeUniforms(direction, t){
    const clippedFromBottom = direction === 'forward' ? t : (1 - t);
    this.container.style.clipPath = `inset(0 0 ${(clippedFromBottom * 100).toFixed(2)}% 0)`;
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
    this.container.style.clipPath = '';
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
    // own reveal position, still looking at the eye)
    const { pos, look, seg } = this._cameraForProgress(0);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this._updateProcessStep(seg);
    this._applyTextTilt();
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
    // the "Welcome" text/neon menu were forced to opacity:0 the whole
    // time this._dissolveStarted was true (see _updateProcessStep's own
    // guard) — the instant it clears below, the very next _frame() tick
    // would otherwise snap them straight to their natural computed
    // opacity (1, since the camera is already sitting at seg 0) with no
    // transition at all, which read as an abrupt pop-in rather than a
    // fade. A real CSS transition isn't left on permanently (see
    // .process-step's own comment in style.css for why: it would fight
    // the smoothstep-driven opacity this same element gets during
    // ordinary scroll) — added here only, right before the flag that
    // re-enables normal updates, and removed again once this one fade
    // has actually finished
    if(this.stepEl) this.stepEl.style.transition = 'opacity 0.8s ease';
    if(this.neonMenuEl) this.neonMenuEl.style.transition = 'opacity 0.8s ease';
    clearTimeout(this._textFadeTimeout);
    this._textFadeTimeout = setTimeout(() => {
      if(this.stepEl) this.stepEl.style.transition = '';
      if(this.neonMenuEl) this.neonMenuEl.style.transition = '';
    }, 850);
    this._dissolveStarted = false;
    this.container.style.clipPath = '';
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

  // film grain — a persistent baseline (0.12, set in CSS — see its own
  // comment for why this was raised from 0.05) plus a temporary boost
  // while the wipe itself is in flight, a parabola peaking at the
  // wipe's own midpoint and easing back down to that same baseline (not
  // all the way to invisible) once done. Driven from wipeT (0..1)
  // rather than a dissolve amount
  _applyWipeGrain(wipeT){
    if(!this.grainEl) return;
    this.grainEl.style.opacity = String(0.12 + 4 * wipeT * (1 - wipeT) * 0.4);
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
      this._applyTextTilt(dt);
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
      // this.mouse never moves away from 0 under reduced motion (its
      // own mouseLerp block above is skipped entirely), so this just
      // applies the plain base transform with zero tilt — still needed
      // for correctness (see _applyTextTilt's own comment: it's now the
      // only thing that actually assigns .style.transform at all), not
      // for any motion these visitors would see
      this._applyTextTilt();
      // reduced motion holds the room at its very first resting frame
      // (progress locked to 0 above) — the dolly/wipe is itself a
      // motion effect, so it stays off here the same way every other
      // animation in this file already does under this preference (see
      // _bindScrollTrigger, which never even creates the pin for these
      // visitors in the first place)
    }
    if(this.sphere) this.sphere.rotation.y += 0.0018;
    // COMPOSITION PASS (per direct request: "make the entire floor
    // platform rotate clockwise around its center... spin it in place,
    // not sliding across the room"): a plain per-frame rotation on the
    // group itself (see _buildChairPile) — every chair is a child of
    // this same group in LOCAL coordinates, so they all spin rigidly
    // together around the platform's own centre with zero extra code.
    // Negative Y rotation reads as clockwise when viewed from above
    // (this room's camera always looks down at a shallow angle, never
    // from directly underneath), which is the only viewing direction
    // that actually matters here
    if(this.chairPlatformGroup) this.chairPlatformGroup.rotation.y -= 0.0025;
    if(this._floatingChairs && this._floatingChairs.length){
      // a small, independent floating bob for the topmost chairs (see
      // _buildChairPile's own comment) — deliberately not synced to any
      // shared clock/phase, so they read as loosely, individually
      // adrift rather than bobbing in unison
      this._chairTime = (this._chairTime || 0) + 0.016;
      for(const c of this._floatingChairs){
        c.mesh.position.y = c.baseY + Math.sin(this._chairTime * c.speed + c.phase) * c.amp;
      }
    }
    if(this.eye){
      // idle float — a slow, small bob/sway so the eye reads as alive
      // even between blinks, not a frozen prop
      this._eyeTime = (this._eyeTime || 0) + 0.016;
      this.eye.position.y = this._eyeBaseY + Math.sin(this._eyeTime * 0.5) * 0.05;
      this.eye.rotation.y = Math.sin(this._eyeTime * 0.35) * 0.12;
      this.eye.rotation.x = Math.sin(this._eyeTime * 0.27 + 1.1) * 0.05;
      // blink cycle — a state machine rather than a fixed sine, so the
      // blink itself is a quick snap-shut/reopen rather than a smooth
      // oscillation (real blinks are fast, not sinusoidal)
      if(this.eyeIris){
        if(this._eyeBlinking){
          this._eyeBlinkT += 0.016;
          const dur = 0.22;
          const half = dur / 2;
          const t = this._eyeBlinkT;
          const closeAmt = t < half ? t / half : Math.max(0, 1 - (t - half) / half);
          this.eyeIris.scale.y = 1 - closeAmt * 0.94;
          if(t >= dur){
            this._eyeBlinking = false;
            this.eyeIris.scale.y = 1;
            this._eyeNextBlink = 1.5 + Math.random() * 2.5;
          }
        } else {
          this._eyeNextBlink -= 0.016;
          if(this._eyeNextBlink <= 0){
            this._eyeBlinking = true;
            this._eyeBlinkT = 0;
          }
        }
      }
    }
    if(this.floorRippleUniforms){
      this.floorRippleUniforms.uRippleOffset.value.x += 0.00035;
      this.floorRippleUniforms.uRippleOffset.value.y += 0.00022;
      this.floorRippleUniforms.uTime.value += 0.016;
    }
    if(this.lavaPoleUniforms) this.lavaPoleUniforms.uTime.value += 0.016;
    if(this.dustUniforms) this.dustUniforms.uTime.value += 0.016;
    // advances every applyRealism material's own caustic pattern in
    // lockstep with the water's own uTime (both use the same
    // causticPattern function — see CAUSTIC_GLSL's own comment) — the
    // shader only exists once a material has actually compiled at least
    // once, hence the guard
    if(this._realismMaterials && this._realismMaterials.length){
      this._realismTime = (this._realismTime || 0) + 0.016;
      for(const mat of this._realismMaterials){
        if(mat.userData.realismShader) mat.userData.realismShader.uniforms.uCausticsTime.value = this._realismTime;
      }
    }
    // GOLDEN-SUNSET PASS (per direct request): clouds frozen — this used
    // to advance every frame (drifting cloud cover). A held, non-moving
    // sky is what was actually asked for alongside the lower golden sun,
    // so this line is now a deliberate no-op rather than removed
    // outright, in case a future pass wants drifting clouds back
    // (uCloudTime.value += 1)

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
    // ~300px bleed (idle animations like the eye's blink/sway still
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
