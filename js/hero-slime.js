/* ===================================================================
   Papi — HeroSlime
   A living, deformable mass of gold slime for the hero background,
   rendered as a single WebGL fragment shader (via Three.js) rather
   than separate shapes: a handful of "control points" are combined
   into one continuous scalar field using polynomial smooth-min
   blending (the standard metaball technique), so wherever two points
   drift close together they visibly merge into one mass instead of
   overlapping as two separate silhouettes, and pull apart into two
   again cleanly as they separate.

   Each control point runs its own small physics simulation: it drifts
   toward a wander target that itself wanders continuously (driven by
   per-point offset noise, so no two points ever move in sync and the
   whole thing never visibly loops), accelerating toward that target,
   losing energy to viscosity/damping, and getting a push/pull from the
   cursor when it's nearby. None of that tries to look "bouncy" — high
   viscosity and damping (see CONFIG below) are what make it read as
   heavy and sticky rather than springy.

   The shader adds two more layers on top of the raw merged silhouette:
   procedural noise deforms the surface (so edges and internal shading
   ripple organically instead of staying perfectly smooth), and each
   point's own current velocity stretches its contribution to the field
   along its direction of travel — the same "squash and stretch"
   principle traditional animation uses for anything heavy and fluid,
   here computed directly rather than being a separate keyframed effect.

   Beyond the primary points that make up the mass in the hero, there
   are extra "fragment" points that stay invisibly hidden inside that
   same mass (each shadowing one primary point's position) for as long
   as the visitor is still in the hero. As the mass falls into the
   Contrast section below, those fragment points peel away toward
   their own independent wander targets while the whole mass shrinks —
   together that reads as the single blob breaking apart into many
   small, varied-size droplets scattering around the section, rather
   than one smaller blob. Scrolling back up runs the same, fully
   reversible scroll-position math backwards, re-merging them into the
   one normal mass by the time the hero is back on screen. See "fragT"
   throughout this file for the details.

   The hero itself is now a tall (400vh), pinned scroll section (see
   .hero-sticky in style.css) purely to give the mass room to run
   through its own choreography before any of the above even starts:
   free wander → the primary points coalesce into 4 small liquid cubes,
   clustered tight together at the centre (still nudge-able by the
   cursor, springing back once it moves away — the same mouse-force
   physics every point already has) → once fully formed, that tight
   cluster tumbles in true 3D (rotated around two different axes at
   once via project3D(), with a perspective divide and a matching
   per-point size cue, not just a flat in-plane spin) as the visitor
   keeps scrolling → they disperse back into the normal free-wandering
   mass → then the existing fall-into-Contrast sequence picks up right
   where it always did. Search "heroProgress" and "cubeFormT" for the
   details — the fragment points need no awareness of any of this at
   all, since they just keep shadowing wherever their primary partner
   currently is (unchanged), so they automatically ride along hidden
   inside whatever shape the primaries take, cubes included.

   IMPORTANT, and worth being direct about: this renders through a
   requestAnimationFrame loop, same as every JS-driven animation this
   hero background has gone through before. iOS Safari deliberately
   pauses JS execution — rAF included — for as long as a finger is
   actively dragging the screen; nothing about moving to WebGL changes
   that, and no shader can keep rendering if the JS thread it's called
   from isn't running. What's different this time is the reason for
   choosing this approach isn't "will this survive a scroll gesture" —
   it's the specific slime/metaball look this was asked for, which
   isn't achievable with compositor-only CSS. The render loop below is
   still gated as tightly as reasonably possible (paused off-screen,
   skipped under prefers-reduced-motion, reduced quality on narrow
   viewports) to keep any such pause as brief and cheap as possible,
   but it is not, and cannot be, a fix for that underlying iOS behavior.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

(function(){
  const canvas = document.getElementById('heroSlime');
  if(!canvas) return;
  const heroEl = document.getElementById('hero');
  // #hero is now the tall (400vh) outer scroll container; the canvas
  // itself needs to live in the pinned inner wrapper so its inset:0
  // sizing matches the actual one-viewport-tall visible box, not the
  // whole 400vh outer section
  const heroStickyEl = heroEl ? heroEl.querySelector('.hero-sticky') : null;
  const contrastSectionEl = document.getElementById('contrastSection');
  const contrastStickyEl = contrastSectionEl ? contrastSectionEl.querySelector('.contrast-sticky') : null;

  // ===================================================================
  // CONFIG — the knobs asked for, gathered in one place. Everything
  // below reads from this object; nothing else in the file needs to
  // change to retune the feel.
  // ===================================================================
  const CONFIG = {
    numControlPoints: 8,     // how many metaballs make up the mass — more reads as a bigger, busier organism.
                              // 8 divides evenly into the 4 liquid cubes of the hero choreography below
    cubeSpacing: 0.24,       // half-distance (in each of x/y) from the cluster's own centre to a cube
                              // slot — sized so the 4 cubes sit close together near the middle of the
                              // hero with real, visible gaps between them (matching the reference
                              // logo), not touching/fused into one blob. Verified in sandbox across
                              // the full CUBE_TILT_*_MAX range with the isCubeExtra/fragment shrink
                              // below in place — without that shrink, two invisible near-duplicate
                              // metaballs stacked on every visible cube were quietly inflating each
                              // one's effective radius through the smin fold and closing the gap
    // the shader's own field() scales every point's X position by the
    // viewport's aspect ratio (see the comment on that in field()) so a
    // point at normalized x=0.5 always lands at screen-centre regardless
    // of aspect — but that same scaling also means a FIXED box size (see
    // cubeBoxScaleMobile below) reads far larger on a narrow phone
    // (aspect ~0.46) than on a wide desktop window, since the identical
    // half-size maps to a much bigger fraction of the (narrower) screen
    // width — on an unscaled box this was nearly a third of the screen
    // width per cube, which is what actually made them read as "too
    // close"/crowded, not the gap between their centres. Kept close to
    // cubeSpacing itself (rather than widened further) because the real
    // fix is shrinking the box (below); values picked by simulating
    // project3D()'s worst-case screen extent across the entire rotate
    // phase (CUBE_TILT_*_MAX, CUBE_PERSPECTIVE) so cubes never swing
    // past the viewport edge mid-tumble, not just at rest.
    cubeSpacingMobile: 0.22,
    // the cube's own box halfSize is defined directly in that same
    // aspect-scaled space (see uCubeBoxScale/field() below), so the
    // identical box size reads proportionally much larger on a narrow
    // phone — this is the main lever for making mobile cubes read as
    // distinctly separated rather than nearly touching. Also picked via
    // the same worst-case-rotation simulation as cubeSpacingMobile above.
    cubeBoxScaleMobile: 0.5,
    // extra points that only ever reveal themselves once the mass has
    // fallen into the Contrast section — see the fragmentation system
    // below (search "fragment") for how these stay invisibly merged
    // into the primary mass the rest of the time
    numFragmentPoints: 8,
    fragmentSizeScale: 0.4,     // how much smaller every point gets once fully fragmented (fragT===1)
    fragmentTensionScale: 0.4,  // matching shrink for the smooth-min blend radius, so the merge/split
                                // threshold scales down with the new smaller size instead of staying
                                // oversized relative to it (which would just look like one smaller blob
                                // instead of many separate little ones)
    fragmentSpeedBoost: 1.3,   // fragment points drift a bit livelier than the calmer primary mass once
                                // scattered — the point of this whole effect is to read as more eye-
                                // catching once it lands in Contrast, not just structurally different
    slimeSize: 0.105,        // base radius of each control point, in aspect-corrected 0..1 space
    movementSpeed: 0.24,     // how quickly points travel toward their (slowly wandering) targets
    viscosity: 0.88,         // resistance to *changing* velocity — higher = heavier, slower to redirect
    damping: 0.94,           // raw velocity decay every frame — higher = keeps drifting longer before settling
    elasticity: 0.18,        // how strongly a point accelerates toward its current wander target
    cubeElasticity: 0.30,    // a snappier elasticity used only once a point is locked into cube
                              // formation (blended in by cubeFormT), so it tracks the cluster's own
                              // moving (tumbling) target instead of lagging behind it — no longer
                              // relied on to *prevent* cubes touching (that's now handled structurally,
                              // see isCubeExtra/cubeSpacing), so this is a much gentler nudge than
                              // before (was 0.55) — enough to stay locked without reading stiff/dead
    cubeViscosity: 0.72,     // matching, gentler drop in viscosity for the same reason (was 0.55) —
                              // still a bit livelier than the free-wander default, but keeps real
                              // liquid weight instead of feeling snapped-into-place
    surfaceTension: 0.10,    // smooth-min blend radius between points — higher = merges/rounds off more readily
    noiseStrength: 0.16,     // how much procedural noise deforms the surface and shading
    mouseForce: 0.26,        // strength of the cursor push/pull
    mouseRadius: 0.38,       // how close the cursor needs to be (aspect-corrected 0..1 space) to affect a
                              // point — raised from 0.30 so the cursor still reaches the cubes furthest
                              // from wherever it typically rests (the hero copy sits centre-top, so the
                              // bottom two cubes were rarely close enough to feel interactive at all)
    mergeDistance: 1.35,     // multiplies surfaceTension for points explicitly flagged as a "linked pair" (see WANDER_LINKS)
    opacity: 0.92,           // overall opacity ceiling — actual per-pixel transparency is driven
                             // by the glass material's own fresnel-based bodyAlpha below, not this alone
    highlightIntensity: 0.4,
    edgeSoftness: 0.004,     // a crisp boundary rather than a soft, blurred-looking fade
    mobileQuality: 0.55,     // resolution + point-count scale under MOBILE_WIDTH
    mobileWidth: 640,
    stretchAmount: 5.5,      // how much a point elongates along its velocity direction
    compressAmount: 1.8,     // how much it compresses perpendicular to that direction while moving
    // real transparent glass, not a flat gold fill: the shader refracts
    // a view ray through the surface and samples a baked, non-repeating
    // texture (pale near the top, richer amber lower down) through that
    // bent direction, then tints the result with these two colors
    colorMid:    [0.90, 0.68, 0.28],
    colorBright: [1.00, 0.92, 0.68],
    maxDt: 1000/24,          // caps the simulation step so a long paused-JS gap (see file header) resumes
                             // with a normal-sized step instead of one huge one — same lesson learned the
                             // hard way earlier rebuilding this hero background: an uncapped dt fed into a
                             // physics integrator produces a single-frame explosion, not a smooth catch-up
  };

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < CONFIG.mobileWidth;
  const primaryCount = isMobile ? Math.max(4, Math.round(CONFIG.numControlPoints * 0.7)) : CONFIG.numControlPoints;
  const fragmentCount = isMobile ? Math.max(4, Math.round(CONFIG.numFragmentPoints * 0.7)) : CONFIG.numFragmentPoints;
  const pointCount = primaryCount + fragmentCount;
  const qualityScale = isMobile ? CONFIG.mobileQuality : 1;
  // see the comments on cubeSpacingMobile/cubeBoxScaleMobile above —
  // both compensate for the shader's own aspect-scaling reading much
  // tighter on a narrow phone than on a wide desktop window
  const cubeSpacingActual = isMobile ? CONFIG.cubeSpacingMobile : CONFIG.cubeSpacing;
  const cubeBoxScale = isMobile ? CONFIG.cubeBoxScaleMobile : 1.0;

  // ===================================================================
  // shaders
  // ===================================================================
  const VERTEX = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const FRAGMENT = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec4 uPoints[${pointCount}]; // xy = position (0..1), zw = velocity
    // per-point size multiplier — 1.0 for the primary points that make
    // up the mass in the hero; the extra "fragment" points (see the JS
    // fragmentation system) carry their own randomized multiplier so
    // the scattered droplets in Contrast read as varied little pieces
    // rather than identical dots
    uniform float uPointSize[${pointCount}];
    // the cube cluster's shared 3D tumble — every cube rotates in
    // unison by this same angle (see rotateYX()/project3D() in JS)
    uniform float uCubeAngleY;
    uniform float uCubeAngleX;
    // static per-device scale on the cube's own box half-size/corner —
    // see cubeBoxScaleMobile in JS: the box is defined directly in the
    // same aspect-scaled space field() already works in, so an
    // unscaled box reads proportionally larger on a narrow phone than
    // on a wide desktop window; this corrects for that, set once at
    // load and never animated
    uniform float uCubeBoxScale;
    uniform float uSlimeSize;
    uniform float uSurfaceTension;
    // 0 = the normal round liquid metaballs used everywhere else in this
    // file, 1 = each point's contribution instead reads as a soft,
    // rounded-corner cube — see boxDist() and the JS-side cube
    // choreography (search "cubeFormT") for how/when this actually rises
    uniform float uCubeT;
    uniform float uNoiseStrength;
    uniform float uOpacity;
    uniform float uHighlightIntensity;
    uniform float uEdgeSoftness;
    uniform float uStretchAmount;
    uniform float uCompressAmount;
    uniform vec3 uColorMid;
    uniform vec3 uColorBright;
    uniform sampler2D uEnvMap;

    float hash(vec2 p){
      p = fract(p*vec2(123.34, 456.21));
      p += dot(p, p+45.32);
      return fract(p.x*p.y);
    }
    float valueNoise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i+vec2(1.0,0.0));
      float c = hash(i+vec2(0.0,1.0));
      float d = hash(i+vec2(1.0,1.0));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    float fbm(vec2 p){
      float v = 0.0;
      float amp = 0.5;
      for(int i=0;i<3;i++){
        v += amp * valueNoise(p);
        p *= 2.02;
        amp *= 0.5;
      }
      return v;
    }
    float smin(float a, float b, float k){
      float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
      return mix(b, a, h) - k*h*(1.0-h);
    }
    // rounded-box SDF (p relative to the box's own centre) — corner is
    // how much of halfSize gets rounded off, kept fairly generous below
    // so this still reads as "liquid that has organised itself into a
    // cube" rather than a razor-sharp geometric primitive
    float boxDist(vec2 p, float halfSize, float corner){
      vec2 d = abs(p) - (halfSize - corner);
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - corner;
    }
    // the true 3D version — evaluated at a single z=0 depth slice (no
    // raymarch loop needed): an SDF is valid at any 3D point, so asking
    // "how far is (fragX, fragY, 0) from this rotated box's surface"
    // already gives the box's real silhouette at this orientation —
    // different faces piercing the z=0 plane at different angles as it
    // spins, exactly like a real die's outline changes shape as it
    // tumbles, not just a flat square whose centre happens to move.
    float sdRoundBox3D(vec3 p, vec3 b, float r){
      vec3 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
    }
    // forward rotation: Y-axis first, then X-axis — the same convention
    // project3D() uses in JS for the shared cluster tumble
    vec3 rotateYX(vec3 p, float angleY, float angleX){
      float cy = cos(angleY), sy = sin(angleY);
      vec3 p1 = vec3(p.x*cy + p.z*sy, p.y, -p.x*sy + p.z*cy);
      float cx = cos(angleX), sx = sin(angleX);
      return vec3(p1.x, p1.y*cx - p1.z*sx, p1.y*sx + p1.z*cx);
    }
    // the inverse (a rotation's inverse is its transpose) — brings a
    // view-space query point back into the cube's own unrotated local
    // frame, which is what the box SDF above needs to be evaluated in
    vec3 rotateYXInverse(vec3 p, float angleY, float angleX){
      float cx = cos(-angleX), sx = sin(-angleX);
      vec3 p1 = vec3(p.x, p.y*cx - p.z*sx, p.y*sx + p.z*cx);
      float cy = cos(-angleY), sy = sin(-angleY);
      return vec3(p1.x*cy + p1.z*sy, p1.y, -p1.x*sy + p1.z*cy);
    }
    // proper analytic ray-box intersection (the "slab method"), in the
    // box's own local frame — this is what actually finds which face is
    // facing the camera. Merely sampling the SDF at a single fixed depth
    // (the box's own z=0 mid-plane, which is what the silhouette test
    // above uses, correctly, for a plain inside/outside distance) is
    // NOT the same as knowing which face a camera ray would hit: the
    // z=0 mid-plane cuts straight through the box's *interior*, not its
    // visible surface, so picking "whichever axis is least-negative
    // there" is unstable near the centre and doesn't track rotation at
    // all — exactly why an unrotated cube was showing a false pinwheel
    // of fake facets. Solving for where the actual camera ray (travelling
    // along -Z) first crosses the box's surface, then reading off which
    // axis-aligned slab that crossing landed on, is the correct and
    // stable way to get a real per-face flat normal.
    bool intersectBoxLocal(vec3 ro, vec3 rd, vec3 b, out vec3 hitNormal, out float edgeGlow){
      vec3 invRd = 1.0 / rd;
      vec3 t1 = (-b - ro) * invRd;
      vec3 t2 = (b - ro) * invRd;
      vec3 tMin = min(t1, t2);
      vec3 tMax = max(t1, t2);
      float tNear = max(max(tMin.x, tMin.y), tMin.z);
      float tFar = min(min(tMax.x, tMax.y), tMax.z);
      if(tNear > tFar || tFar < 0.0) return false;
      vec3 hitPoint = ro + rd*tNear;
      vec3 d = abs(hitPoint) - b;
      vec3 s = sign(hitPoint);
      if(d.x >= d.y && d.x >= d.z) hitNormal = vec3(s.x, 0.0, 0.0);
      else if(d.y >= d.z) hitNormal = vec3(0.0, s.y, 0.0);
      else hitNormal = vec3(0.0, 0.0, s.z);

      // how close this exact surface point is to a genuine EDGE where
      // two faces meet, not just which single face is dominant — the
      // "runner-up" axis (the second-largest of the three d values)
      // approaches 0 right at a real crease between faces, the same
      // way all three approach 0 together at a true corner. This is
      // what lets a crease get its own liquid/glass highlight as the
      // cube turns, instead of reading as a flat, dry line between two
      // differently-lit faces.
      float mn = min(d.x, min(d.y, d.z));
      float mx = max(d.x, max(d.y, d.z));
      float mid = d.x + d.y + d.z - mn - mx;
      // mid itself never exceeds 0 (mx is always exactly 0, right on the
      // hit face) — it sits at 0 right at a crease and falls to -b.x deep
      // in a face's middle, so the "near edge" band is [-edgeWidth, 0],
      // not [0, edgeWidth]
      float edgeWidth = b.x * 0.25;
      edgeGlow = smoothstep(-edgeWidth, 0.0, mid);
      return true;
    }
    // a real (locally-generated, non-repeating) image to refract — a
    // baked raster texture, not a live formula. A procedural repeating
    // pattern (sin() bands, the first attempt at this) reads as a
    // spiral/pinwheel "optical illusion" once bent through a curved
    // surface, the same way a barber pole looks warped through a lens —
    // technically proves refraction is happening, but reads as a
    // circus effect rather than glass. An irregular image has no
    // repeating structure to spiral, so bending it just looks like
    // looking *through* something.
    vec3 envSample(vec2 dir){
      vec2 uv = clamp(dir*0.5 + 0.5, 0.0, 1.0);
      return texture2D(uEnvMap, uv).rgb;
    }

    // aspect passed in explicitly rather than each call recomputing it —
    // more importantly, this is what fixes control points only ever
    // showing up in a narrow strip on portrait/narrow screens: the
    // fragment coordinate below is aspect-corrected (p.x scaled by
    // aspect) but the control points themselves, coming straight from
    // JS in plain 0..1 space, were being compared against that scaled
    // coordinate un-scaled — on a portrait phone (aspect ~0.46), the
    // visible fragment x-range becomes roughly 0..0.46, while points
    // still lived around x=0.3..0.7, so most of the mass sat outside
    // that range entirely and only ever showed up hugging one edge.
    // Scaling the point position by the same aspect factor puts both
    // in the same coordinate space, so a point at normalized (0.5, 0.5)
    // always lands at the visual centre regardless of aspect ratio.
    float field(vec2 p, float aspect){
      float f = 1.0e5;
      for(int i=0;i<${pointCount};i++){
        vec4 pt = uPoints[i];
        vec2 ptPos = vec2(pt.x*aspect, pt.y);
        vec2 d = p - ptPos;
        vec2 vel = pt.zw;
        float speed = length(vel);
        if(speed > 0.0005){
          vec2 dir = vel/speed;
          float along = dot(d, dir);
          vec2 perp = d - dir*along;
          float stretch = 1.0 + speed*uStretchAmount;
          float compress = 1.0 + speed*uCompressAmount;
          d = dir*(along/stretch) + perp*compress;
        }
        float r = uSlimeSize*uPointSize[i];
        // blended rather than switched, so the transition between round
        // liquid and cube liquid itself looks like a fluid morph (this
        // runs every frame while uCubeT is mid-transition, not just at
        // the 0/1 endpoints). This silhouette deliberately stays a
        // plain, unrotated 2D box rather than the true rotated 3D one
        // (see the comment by uCubeAngleY above and intersectBoxLocal
        // below): rotating a real 3D box here, per point, per one of
        // the 5 field() evaluations main() makes per fragment (this one
        // plus 4 for the normal's finite-difference gradient), was 16
        // points x 5 calls x ~8 trig calls each — real, measured jank
        // once cubes were actually on screen. The shading below still
        // does the true rotated-3D-box math, just once per fragment for
        // whichever single point is nearest, which is what actually
        // sells "this is rotating" — a soft liquid edge that stays a
        // simple rounded square while the lit faces underneath visibly
        // turn reads convincingly enough, for a small fraction of the cost.
        float circleDist = length(d) - r;
        // corner kept close to halfSize (was 0.42, a fairly sharp 31%-
        // rounded corner) so this reads as a soft, liquid rounded cube —
        // a bar of soap, not a die with a light chamfer
        float boxD = boxDist(d, r*1.35*uCubeBoxScale, r*0.60*uCubeBoxScale);
        // eased rather than a direct 1:1 mix against uCubeT — the box's
        // corners/silhouette only start actually showing in the very
        // last stretch of the coalesce, once the points have
        // essentially arrived at their slot and stopped visibly moving.
        // Blending the box shape in from uCubeT=0 (the old behaviour)
        // meant a faint box outline — and the flat-face shading blend
        // below, which reuses this same easing — was already visible
        // while the primaries were still obviously travelling into
        // place, which read as boxy edges bleeding through liquid
        // that's still in motion rather than a clean liquid-to-cube
        // morph. 0.85 (not just "late", e.g. 0.55) specifically because
        // the invisible "extra"/fragment duplicate sharing this same
        // slot (see isCubeExtra/sizeMul*(1-cubeFormT) in stepPoints)
        // only shrinks down to a small sliver by then — any earlier and
        // its own still-sizeable box corner smin's against the real
        // point's box at a different scale, which reads as a small
        // hard-edged notch/tab cut into the blob rather than a clean
        // shape. See the matching boxBlend in main() below.
        float boxBlend = smoothstep(0.85, 1.0, uCubeT);
        float dist = mix(circleDist, boxD, boxBlend);
        f = smin(f, dist, uSurfaceTension);
      }
      return f;
    }

    // which single point actually dominates the merged field at this
    // fragment — used only to pick whose rotation/face-normal to shade
    // with in cube mode. A simple per-point circle-distance proxy
    // (cheaper than re-deriving an index out of the smin fold above) is
    // close enough: by the time cubes are separated (real gaps, not
    // touching) the nearest point by this measure is always the same
    // one that dominates the real merged surface there anyway.
    int findNearestPoint(vec2 p, float aspect, out vec2 outD){
      float best = 1.0e5;
      int bestIdx = 0;
      vec2 bestD = vec2(0.0);
      for(int i=0;i<${pointCount};i++){
        vec4 pt = uPoints[i];
        vec2 ptPos = vec2(pt.x*aspect, pt.y);
        vec2 dd = p - ptPos;
        float dist = length(dd) - uSlimeSize*uPointSize[i];
        if(dist < best){ best = dist; bestIdx = i; bestD = dd; }
      }
      outD = bestD;
      return bestIdx;
    }

    void main(){
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(vUv.x*aspect, vUv.y);

      float n = fbm(p*3.2 + uTime*0.045) - 0.5;
      float raw = field(p, aspect);
      float f = raw - n*uNoiseStrength*0.14;

      float edge = 1.0 - smoothstep(0.0, uEdgeSoftness, f);
      if(edge <= 0.003) discard;

      // an SDF's own gradient is shaped like a *cone* — constant tilt
      // angle, radiating outward at a fixed slope from a singular
      // point at each blob's peak — not a rounded *dome* (flat at the
      // peak, curving smoothly toward the rim). Using it directly as a
      // fake normal (the previous attempt) is exactly why refraction
      // kept showing a radiating sunburst/pinwheel pattern centred on
      // each blob no matter how the colour or contrast was tuned: a
      // cone refracts light into spokes, a dome doesn't. Fixed by
      // keeping only the gradient's *direction* (still correct even
      // under merging, since it points toward the nearest surface
      // feature) and rebuilding a properly rounded dome profile for
      // its magnitude from the same smooth depth metric used for
      // colour below — flat (no tilt) at each peak, growing toward
      // fully horizontal right at the true rim.
      float eps = 0.006;
      float fx = field(p+vec2(eps,0.0), aspect) - field(p-vec2(eps,0.0), aspect);
      float fy = field(p+vec2(0.0,eps), aspect) - field(p-vec2(0.0,eps), aspect);
      float gLen = length(vec2(fx, fy));
      vec2 gDir = gLen > 0.00001 ? vec2(fx, fy)/gLen : vec2(1.0, 0.0);

      // 0 at the true boundary (rim), 1 well inside (each blob's peak)
      // — also reused below, unchanged, for colour absorption
      float pathT = clamp(-f / (uSlimeSize*0.55), 0.0, 1.0);
      // raising this to a power > 1 keeps the two boundary conditions
      // identical (still exactly 0 at the peak, still exactly 1 right
      // at the rim) but compresses everything in between toward 0 —
      // the difference between a full round dome (exponent 1, the
      // liquid look everywhere else in this file) and a flat-faced
      // cube with only its true edges rounded off (a higher exponent):
      // a real cube's face doesn't gradually bulge from its centre
      // outward, it stays flat until the actual edge. Blended in by
      // uCubeT so ordinary liquid blobs elsewhere keep the round dome.
      float domeHoriz = pow(clamp(1.0 - pathT, 0.0, 1.0), mix(1.0, 3.2, uCubeT));
      float domeVert = sqrt(max(0.0, 1.0 - domeHoriz*domeHoriz));
      vec3 normal = normalize(vec3(-gDir*domeHoriz, domeVert + 0.02));

      // in cube mode, blend toward a genuinely faceted 3D normal from
      // whichever single point actually dominates this fragment — flat
      // per face with a hard crease at the true edge is what makes a
      // rotated box read as 6 real faces (a visible edge/outline as it
      // turns) rather than one smoothly curving liquid surface that
      // merely changes size. Found via a real ray-box intersection (see
      // intersectBoxLocal above), not just sampling the SDF at a fixed
      // depth — different faces genuinely rotate into and out of view
      // as uCubeAngleY/X change. Every cube shares the same angle (they
      // rotate in unison), so this is one shared rotation, not a
      // per-point lookup.
      //
      // Kept in a SEPARATE variable rather than overwriting normal
      // itself: normal still feeds fresnel below completely undiluted,
      // which is what keeps the bright glass rim/outline around each
      // cube's silhouette exactly as strong as every other liquid shape
      // in this file. Blending the flat face normal into normal
      // directly (the first attempt) diluted that same rim, since a
      // flat, camera-facing normal has fresnel ~0 almost everywhere on
      // a face — reading as flat matte plastic with no outline.
      // shadingNormal below is what actually varies per face (feeding
      // diffuse/specular/refraction), which is what sells "distinct 3D
      // faces" without touching the rim at all.
      vec3 shadingNormal = normal;
      // how strongly this fragment sits on a genuine edge/crease
      // between two cube faces (0 in the middle of a face, rising to 1
      // right at a seam) — see intersectBoxLocal's edgeGlow output.
      // Folded into the same rim/highlight the outer silhouette
      // already gets (search "rimGlow" below), so every visible seam
      // reads with the same wet, glassy brightness as the outer edge,
      // not a flat, dry line between two differently-lit faces.
      float cubeEdgeGlow = 0.0;
      if(uCubeT > 0.001){
        vec2 nearestD;
        int nearestIdx = findNearestPoint(p, aspect, nearestD);
        float nearestR = uSlimeSize * uPointSize[nearestIdx];
        // camera ray toward this fragment, travelling along -Z, rotated
        // into the box's own local frame (rotating a direction vector
        // uses the same transform as a position, just with no translation)
        vec3 rayOriginLocal = rotateYXInverse(vec3(nearestD, 2.0), uCubeAngleY, uCubeAngleX);
        vec3 rayDirLocal = rotateYXInverse(vec3(0.0, 0.0, -1.0), uCubeAngleY, uCubeAngleX);
        vec3 hitNormalLocal;
        float edgeGlow;
        if(intersectBoxLocal(rayOriginLocal, rayDirLocal, vec3(nearestR*1.35*uCubeBoxScale), hitNormalLocal, edgeGlow)){
          vec3 faceNormal = rotateYX(hitNormalLocal, uCubeAngleY, uCubeAngleX);
          // same easing as boxBlend in field() above — the flat-face
          // shading (and its edge glow) only phases in once the
          // silhouette itself has actually started resolving into a
          // box, so a still-travelling/wandering point never shows a
          // faceted look while it plainly reads as a round liquid blob
          float boxBlend = smoothstep(0.85, 1.0, uCubeT);
          shadingNormal = normalize(mix(normal, faceNormal, boxBlend * 0.85));
          cubeEdgeGlow = edgeGlow * boxBlend;
        }
      }

      // fine liquid-surface grain — much lighter than before. At 1.4
      // this noise perturbation dominated wherever the base normal's
      // own xy components shrank toward zero (near each blob's own
      // local peak), because a tiny noise vector added to a near-zero
      // vector still points in a full range of directions — that's
      // exactly what produced the radiating pinched-crease look (like
      // a tufted cushion) instead of a single clean highlight. A much
      // smaller weight keeps this as subtle grain rather than a
      // direction-dominating artifact.
      vec2 noiseP = p*7.0 + uTime*0.05;
      float ng  = fbm(noiseP);
      float ng1 = fbm(noiseP+vec2(eps*4.0,0.0));
      float ng2 = fbm(noiseP+vec2(0.0,eps*4.0));
      vec3 bumpNormal = normalize(shadingNormal + vec3((ng1-ng),(ng2-ng),0.0) * 0.3);

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.7));

      float diff = max(0.0, dot(bumpNormal, lightDir));
      vec3 reflectDir = reflect(-lightDir, bumpNormal);
      // a real glass sparkle is small, tight, and bright — not the
      // broad soft dimple a low exponent produces
      float spec = pow(max(0.0, dot(reflectDir, viewDir)), 220.0);
      // a second, much broader/softer highlight on top of the tight
      // sparkle — real glass and liquid surfaces show both a pinpoint
      // hotspot *and* a wider glossy sheen around it; a single tight
      // exponent alone reads as hard plastic rather than glossy liquid
      float sheen = pow(max(0.0, dot(reflectDir, viewDir)), 12.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.2);
      // the same bright, wet-glass rim the outer silhouette gets from
      // fresnel, extended to every internal seam between cube faces
      // too (cubeEdgeGlow, computed above) — without this, those
      // creases only ever showed a flat colour/shading discontinuity
      // as the cube turned, since fresnel alone only ever lights up
      // the outermost edge of the merged 2D silhouette
      float rimGlow = max(fresnel, cubeEdgeGlow);

      // bend a view ray through the true sphere surface (Snell's law via
      // GLSL's built-in refract()) and sample the high-contrast
      // procedural "world" above through that bent direction — with a
      // normal that actually curves across the whole face (not just the
      // rim), this now visibly distorts rather than reading as a flat
      // colour fill.
      //
      // real glass doesn't bend every wavelength by the same amount —
      // that's why a prism splits white light. Refracting each colour
      // channel at a slightly different index of refraction (a tiny
      // red/blue fringe at the edges) is one of the strongest "this is
      // actually glass, not a tinted shape" cues, and costs only two
      // extra texture samples.
      vec3 refractDirG = refract(-viewDir, bumpNormal, 1.0/1.55);
      if(dot(refractDirG, refractDirG) < 0.0001) refractDirG = -viewDir;
      vec3 refractDirR = refract(-viewDir, bumpNormal, 1.0/1.51);
      if(dot(refractDirR, refractDirR) < 0.0001) refractDirR = -viewDir;
      vec3 refractDirB = refract(-viewDir, bumpNormal, 1.0/1.59);
      if(dot(refractDirB, refractDirB) < 0.0001) refractDirB = -viewDir;
      float bendScale = 2.1;
      vec3 envColor = vec3(
        envSample(refractDirR.xy * bendScale).r,
        envSample(refractDirG.xy * bendScale).g,
        envSample(refractDirB.xy * bendScale).b
      );

      // Beer's-law-style absorption: light that travels further through
      // the glass (deep toward a point's own centre) picks up more of
      // the glass's own colour; near a rim, where the geometric path is
      // short, it stays close to clear — the same reason real glass
      // edges look thin and pale while the body reads richly coloured
      float absorb = pow(pathT, 0.7);
      vec3 tint = mix(vec3(1.0), mix(uColorMid, uColorBright, 0.4), absorb);
      vec3 color = envColor * tint;

      color += vec3(1.0, 0.98, 0.94) * spec * (1.6 + uHighlightIntensity);
      color += vec3(1.0, 0.95, 0.82) * sheen * 0.22;
      color = mix(color, vec3(1.0, 0.97, 0.9), rimGlow * 0.72);
      // real contrast — a shallow 0.85..1.0 range (the first attempt)
      // reads as flat, soft plastic; glass needs a genuine dark side to
      // read as reflective/refractive rather than uniformly lit paint
      color *= 0.42 + 0.58*diff;

      // several of the steps above (the fresnel-white mix, the specular
      // add) each individually wash a little toward white — stacked
      // together they left a slightly pink/neutral cast, so simply
      // boosting saturation amplified *that* cast into peach/salmon
      // rather than gold. Remapping onto a fixed gold ramp keyed by
      // luminance guarantees the hue itself is always a little gold,
      // rather than just amplifying whatever hue happened to survive
      // the steps above — but blended in lightly now (was 0.88, an
      // almost-total override that made this read as opaque liquid
      // metal rather than tinted glass/water; most of the actual lit/
      // refracted detail underneath is what gives glass and water their
      // clarity, so keeping far more of it through is what makes this
      // read as see-through material with a gold tint, not solid gold)
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 goldRef = mix(vec3(0.45, 0.26, 0.05), vec3(1.0, 0.68, 0.18), lum);
      color = mix(color, goldRef, 0.56);

      // real page content (the hero title/subtitle/CTA) sits behind
      // this canvas — alpha blending toward a white page dilutes even a
      // fully-saturated colour toward pale at low alpha, no matter how
      // rich the computed colour itself is. Lowered further (was
      // 0.36..0.97) so the body itself reads as genuinely see-through
      // water/glass rather than a translucent solid — the fresnel edge
      // still climbs to nearly opaque at a grazing angle, exactly the
      // way a real glass or water surface brightens and turns opaque-
      // looking right at its own silhouette edge while staying clear
      // through the middle.
      float bodyAlpha = mix(0.32, 0.95, rimGlow);

      gl_FragColor = vec4(color, edge*uOpacity*bodyAlpha);
    }
  `;

  // ===================================================================
  // control-point physics
  // ===================================================================
  // per-point noise offsets — large, decorrelated seeds so no two
  // points ever sample the same phase of the wander noise, which is
  // what keeps the whole mass from ever looking like it's repeating.
  //
  // indices >= primaryCount are "fragment" points: each is assigned a
  // primary point to shadow (see stepPoints below) — while fragT is 0
  // (hero zone) it sits exactly on that partner's position, at full
  // size, contributing nothing visually distinct from the merged mass
  // it's hiding inside of. As fragT rises toward 1 (falling into
  // Contrast), its target blends away from the partner and toward its
  // own independent wander target instead, and the global size/tension
  // shrink (see loop()) lets it actually separate out and read as its
  // own small droplet rather than staying glued to the partner by a
  // now-oversized blend radius.
  const points = [];
  for(let i=0;i<pointCount;i++){
    const isFragment = i >= primaryCount;
    const partner = isFragment ? (i % primaryCount) : -1;
    const startX = isFragment ? points[partner].x : 0.5 + (Math.random()-0.5)*0.3;
    const startY = isFragment ? points[partner].y : 0.5 + (Math.random()-0.5)*0.3;
    // which of the 4 cube slots this point aims for once the hero's
    // coalesce phase kicks in (meaningless for fragment points — they
    // never look at this, they just keep shadowing their primary
    // partner's position, cube or not) — only primary points needed
    // any change at all for the cube choreography. A plain 2x2 grid of
    // signs (-1/-1, 1/-1, -1/1, 1/1) rather than a diagonal layout, so
    // the cluster reads as a flat 2x2 block face-on before any rotation
    // starts, matching the reference look this was asked to match.
    const cubeIndex = i % 4;
    const cubeSignX = (cubeIndex & 1) ? 1 : -1;
    const cubeSignY = (cubeIndex & 2) ? 1 : -1;
    points.push({
      x: startX,
      y: startY,
      vx: 0, vy: 0,
      seedX: Math.random()*1000,
      seedY: Math.random()*1000,
      isFragment,
      partner,
      // fixed per-point size variety for fragments (1.0 for primaries,
      // unaffected) — what makes the scattered droplets read as varied
      // little pieces instead of identical dots once shrunk
      sizeMul: isFragment ? (0.45 + Math.random()*0.4) : 1.0,
      // primaries 0-3 are each slot's one true representative; any
      // further primaries sharing that same slot (4-7, etc., when
      // primaryCount > 4) are just as redundant there as the fragments
      // are — two metaballs stacked near the same spot don't merely
      // double up harmlessly, running both through the same smin fold
      // measurably inflates that spot's effective radius, which was
      // quietly closing the real gap between adjacent cubes. See the
      // matching shrink in renderOnce().
      isCubeExtra: !isFragment && i >= 4,
      cubeSignX,
      cubeSignY,
      // last-computed depth (see project3D) while tumbling — read back
      // in renderOnce() for the per-point size-by-depth cue; harmless/
      // unused whenever cubeFormT is 0
      cubeDepth: 0,
    });
  }

  // small self-contained value-noise (same shape as the shader's, kept
  // separate/duplicated deliberately rather than shared — this one runs
  // in plain JS for the wander targets, the shader's own copy runs on
  // the GPU; nothing needs to keep them numerically identical, they
  // just both need to be "smooth, non-repeating noise")
  function hash2(x, y){
    const s = Math.sin(x*127.1 + y*311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise2(x, y){
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi), b = hash2(xi+1, yi), c = hash2(xi, yi+1), d = hash2(xi+1, yi+1);
    const ux = xf*xf*(3-2*xf), uy = yf*yf*(3-2*yf);
    return a + (b-a)*ux + (c-a)*uy*(1-ux) + (d-b)*ux*uy;
  }

  const mouse = { x: -1, y: -1, active: false };
  let lastMoveTime = 0;
  const MOUSE_IDLE_MS = 1200;

  // cached once per rendered frame (see loop() below), not read fresh
  // via canvas.getBoundingClientRect() on every single mousemove/
  // touchmove event — touchmove in particular can fire dozens of times
  // a second during an ordinary touch-scroll gesture (scrolling on a
  // touch device *is* a touchmove gesture), which meant every scroll on
  // iPhone was forcing an extra synchronous layout read on top of
  // everything else already reacting to that same scroll. A frame or
  // two of staleness on a rect used only for a soft cursor-push effect
  // is imperceptible.
  let canvasRect = { left: 0, top: 0, width: 1, height: 1 };
  function toLocalNorm(clientX, clientY){
    return [(clientX - canvasRect.left) / canvasRect.width, (clientY - canvasRect.top) / canvasRect.height];
  }
  window.addEventListener('mousemove', (e)=>{
    if(zone === 'gone') return;
    const [x,y] = toLocalNorm(e.clientX, e.clientY);
    mouse.x = x; mouse.y = y; mouse.active = true;
    lastMoveTime = performance.now();
  });
  window.addEventListener('mouseleave', ()=>{ mouse.active = false; });
  window.addEventListener('touchmove', (e)=>{
    if(zone === 'gone') return;
    const t = e.touches && e.touches[0];
    if(!t) return;
    const [x,y] = toLocalNorm(t.clientX, t.clientY);
    mouse.x = x; mouse.y = y; mouse.active = true;
    lastMoveTime = performance.now();
  }, { passive:true });

  const WANDER_RANGE = 0.46; // how far from center (0.5,0.5) a target can wander — normalized units,
                              // scaled the same way as the point positions themselves (see the aspect
                              // fix in the shader's field()), so this roams proportionally regardless
                              // of whether the viewport is portrait or landscape. Raised from 0.30 so the
                              // mass actually roams across the whole hero section instead of staying
                              // clustered near the centre.
  const WANDER_SPEED = 0.00028; // how fast the noise field driving targets itself evolves

  // how strongly a rotated-away point shrinks/shifts vs a rotated-toward
  // point grows/shifts — see project3D() below
  const CUBE_PERSPECTIVE = 1.6;
  // matching size pop for a point currently rotated toward the viewer
  // (see the depth-based uPointSize update in renderOnce())
  const CUBE_DEPTH_SIZE = 1.0;

  // takes a cube slot's flat (offX, offY, z=0) resting offset from the
  // cluster's own centre and tumbles it in genuine 3D — rotated first
  // around the vertical (Y) axis, then around the horizontal (X) axis
  // (two different, bounded angles — see CUBE_TILT_*_MAX below — so
  // this reads as a die tumbling/wobbling rather than a flat in-plane
  // spin) — then projects the result back to 2D with a perspective
  // divide, so points rotated toward the viewer swing further from
  // centre and read larger, and points rotated away shrink back toward
  // centre and read smaller. "depth" is handed back so the caller can
  // apply that same size cue to the point's own metaball radius.
  function project3D(offX, offY, angleY, angleX){
    const x = offX, y = offY, z = 0; // starts perfectly flat, face-on
    const cy = Math.cos(angleY), sy = Math.sin(angleY);
    const x1 = x*cy + z*sy;
    const z1 = -x*sy + z*cy;
    const cx = Math.cos(angleX), sx = Math.sin(angleX);
    const y1 = y*cx - z1*sx;
    const z2 = y*sx + z1*cx;
    const persp = 1 / (1 - z2*CUBE_PERSPECTIVE);
    return { x: 0.5 + x1*persp, y: 0.5 + y1*persp, depth: z2 };
  }

  function stepPoints(dtMs, elapsedMs, fragT, cubeFormT, angleY, angleX){
    if(mouse.active && performance.now() - lastMoveTime > MOUSE_IDLE_MS) mouse.active = false;
    const dtScale = dtMs / 16.6667; // normalizes physics to "per ~60fps frame" units, using the capped dt

    for(let i=0;i<points.length;i++){
      const p = points[i];
      const nx = noise2(p.seedX + elapsedMs*WANDER_SPEED, 0) * 2 - 1;
      const ny = noise2(p.seedY + elapsedMs*WANDER_SPEED, 100) * 2 - 1;
      let targetX = 0.5 + nx*WANDER_RANGE;
      let targetY = 0.5 + ny*WANDER_RANGE;

      // fragment points blend away from shadowing their partner and
      // toward this own independent target as fragT rises — at fragT=0
      // this collapses to exactly the partner's current position (no
      // separate target of its own), at fragT=1 it's identical to a
      // normal primary point's own wander
      if(p.isFragment){
        const partner = points[p.partner];
        targetX = partner.x + (targetX - partner.x) * fragT;
        targetY = partner.y + (targetY - partner.y) * fragT;
      } else if(cubeFormT > 0){
        // primary points blend their free-wander target toward this
        // point's own resting slot in the 4-cube cluster as cubeFormT
        // rises — that slot itself tumbles in 3D by (angleY, angleX),
        // so once fully formed (cubeFormT pinned at 1) this is the only
        // thing moving the point at all, giving a precisely
        // scroll-scrubbed rotation rather than a free wander that
        // merely happens to sit near a cube shape. Every point sharing a
        // slot aims at the exact same spacing (no per-point jitter) —
        // the "extra" primary sharing this slot is invisible (see
        // isCubeExtra in renderOnce) whenever cubeFormT>0, so there's no
        // risk of two visible points exactly overlapping, and a uniform
        // spacing keeps the real gap between adjacent cubes predictable
        // rather than varying per point.
        const slot = project3D(p.cubeSignX*cubeSpacingActual, p.cubeSignY*cubeSpacingActual, angleY, angleX);
        targetX = targetX + (slot.x - targetX) * cubeFormT;
        targetY = targetY + (slot.y - targetY) * cubeFormT;
        p.cubeDepth = slot.depth;
      }

      // the free-wander elasticity/viscosity (soft, heavy, deliberately
      // laggy — that's what reads as thick liquid) is exactly what let
      // points overshoot past their target and briefly touch a
      // neighbouring cube when the cluster's own target position keeps
      // moving (the rotate phase re-aims every rendered frame). Once a
      // point is actually locked into cube formation, it needs to track
      // that moving target tightly instead — blended in by cubeFormT so
      // the coalesce phase itself still eases in smoothly rather than
      // snapping.
      const pointElasticity = p.isFragment ? CONFIG.elasticity
        : CONFIG.elasticity + (CONFIG.cubeElasticity - CONFIG.elasticity) * cubeFormT;
      const pointViscosity = p.isFragment ? CONFIG.viscosity
        : CONFIG.viscosity + (CONFIG.cubeViscosity - CONFIG.viscosity) * cubeFormT;

      let ax = (targetX - p.x) * pointElasticity;
      let ay = (targetY - p.y) * pointElasticity;

      if(mouse.active){
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx*dx + dy*dy) + 0.0001;
        if(dist < CONFIG.mouseRadius){
          const force = (1 - dist / CONFIG.mouseRadius) * CONFIG.mouseForce;
          ax += (dx/dist) * force;
          ay += (dy/dist) * force;
        }
      }

      // viscosity resists how much new acceleration can change velocity
      // (thick fluid), damping decays existing velocity independently
      // (energy loss) — two distinct knobs for two distinct feelings
      p.vx += ax * (1 - pointViscosity) * dtScale;
      p.vy += ay * (1 - pointViscosity) * dtScale;
      p.vx *= CONFIG.damping;
      p.vy *= CONFIG.damping;

      // fragments move a bit livelier than the calm primary mass once
      // actually scattered (fragT>0) — ramped by fragT itself so they
      // ease into that energy rather than snapping to it
      const speedMul = p.isFragment ? (1 + fragT*(CONFIG.fragmentSpeedBoost-1)) : 1;
      p.x += p.vx * CONFIG.movementSpeed * speedMul * dtScale;
      p.y += p.vy * CONFIG.movementSpeed * speedMul * dtScale;
    }
  }

  // ===================================================================
  // a real (baked, non-repeating) image for the glass to refract —
  // rendered once to an offscreen canvas rather than sampled live from
  // a formula. A live periodic pattern (sin() bands, the first attempt)
  // spirals into a circus/pinwheel look once bent through a curved
  // surface; an irregular raster image, like a real photo, has nothing
  // repeating in it to spiral, so bending it just reads as looking
  // *through* something. Soft blurred blobs at varied, randomized
  // scales/positions stand in for out-of-focus background detail.
  // ===================================================================
  function makeEnvTexture(){
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');

    // vivid gold throughout — no brown/desaturated stops. A muddy dark
    // stop here (the first attempt used a flat brown low end) reads as
    // dirt rather than shine no matter how the rest of the shader is
    // tuned, since this is the actual colour being refracted/tinted.
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#fffaf0');
    base.addColorStop(0.55, '#ffcf5c');
    base.addColorStop(1, '#c67d1e');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const blobColors = ['#fffbe8', '#ffe6a8', '#ffcf5c', '#f0aa3c', '#d68a2a'];
    let seed = 42;
    function rand(){
      seed = (seed*1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }
    for(let i=0;i<22;i++){
      const r = size*(0.08 + rand()*0.22);
      const x = rand()*size, y = rand()*size;
      ctx.filter = `blur(${Math.round(size*0.012 + rand()*size*0.02)}px)`;
      ctx.globalAlpha = 0.4 + rand()*0.4;
      ctx.fillStyle = blobColors[i % blobColors.length];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r*(0.6+rand()*0.6), rand()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }
  const envTexture = makeEnvTexture();

  // ===================================================================
  // three.js setup
  // ===================================================================
  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1,1) },
    uTime: { value: 0 },
    uPoints: { value: new Array(pointCount).fill(0).map(()=> new THREE.Vector4(0,0,0,0)) },
    // per-point size multiplier — starts as each point's own sizeMul
    // (1.0 for primaries, randomized for fragments) and is rewritten
    // every frame in renderOnce() for primaries currently tumbling as
    // part of the cube cluster (see CUBE_DEPTH_SIZE), same as uPoints
    uPointSize: { value: points.map(p => p.sizeMul) },
    // the cube cluster's shared tumble angle — every cube rotates in
    // unison, rewritten every frame in loop() alongside uCubeT
    uCubeAngleY: { value: 0 },
    uCubeAngleX: { value: 0 },
    // static per-device box scale (desktop 1.0, mobile cubeBoxScaleMobile)
    // — see cubeBoxScaleMobile in CONFIG
    uCubeBoxScale: { value: cubeBoxScale },
    uSlimeSize: { value: CONFIG.slimeSize },
    uSurfaceTension: { value: CONFIG.surfaceTension },
    uCubeT: { value: 0 },
    uNoiseStrength: { value: CONFIG.noiseStrength },
    uOpacity: { value: CONFIG.opacity },
    uHighlightIntensity: { value: CONFIG.highlightIntensity },
    uEdgeSoftness: { value: CONFIG.edgeSoftness },
    uStretchAmount: { value: CONFIG.stretchAmount },
    uCompressAmount: { value: CONFIG.compressAmount },
    uColorMid: { value: new THREE.Vector3(...CONFIG.colorMid) },
    uColorBright: { value: new THREE.Vector3(...CONFIG.colorBright) },
    uEnvMap: { value: envTexture },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  // how many pixels the hero's own tall (400vh) section can actually be
  // scrolled through before its sticky inner unpins — cached rather than
  // measured fresh every animation frame (offsetHeight forces a layout
  // read), refreshed on load and on the same width-tolerant resize as
  // everything else in this file
  let heroScrollableHeight = 1;
  function measureHeroScrollable(){
    if(!heroEl) return;
    const h = heroEl.offsetHeight - window.innerHeight;
    if(h > 0) heroScrollableHeight = h;
  }

  let W = 1, H = 1;
  function resize(){
    // both clientWidth and window.innerWidth can legitimately read 0 for
    // a brief moment (a tab not yet laid out, briefly backgrounded,
    // etc.) — feeding that straight to uResolution turns the shader's
    // very first line (aspect = x/y) into 0/0 = NaN, which silently
    // discards every fragment. Skip the update rather than ever handing
    // the shader a NaN to propagate; W/H just keep their last valid size.
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    // #hero and .contrast-sticky are both full-viewport (100svh)
    // containers the canvas fills via inset:0, so re-parenting it
    // between them at the hero/contrast boundary below almost always
    // measures the exact same size here. renderer.setSize() reallocates
    // the WebGL drawing buffer/render targets even when the size hasn't
    // actually changed, which is real, synchronous GPU work landing
    // right in the middle of that same scroll frame — a stutter that
    // read as a "glitch hiccup" right as the visitor first scrolled
    // past the hero, more noticeable in Instagram's in-app browser
    // (less compositing headroom than a full native browser tab).
    // Skipping the no-op case removes that cost entirely; a real size
    // change (an actual rotation/resize) still goes through normally.
    if(w === W && h === H) return;
    W = w;
    H = h;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) * qualityScale;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(W, H, false);
    uniforms.uResolution.value.set(W, H);
  }

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiSlimeResizeT);
    window.__papiSlimeResizeT = setTimeout(()=>{ resize(); measureHeroScrollable(); }, 150);
  });

  let revealed = false;
  let lastTs = null;
  let rafId = null;

  function renderOnce(elapsedMs, cubeFormT){
    uniforms.uTime.value = elapsedMs / 1000;
    for(let i=0;i<points.length;i++){
      const p = points[i];
      const v = uniforms.uPoints.value[i];
      v.set(p.x, p.y, p.vx * CONFIG.movementSpeed, p.vy * CONFIG.movementSpeed);
      let sizeMul = p.sizeMul;
      if(p.isFragment || p.isCubeExtra){
        // every fragment sits EXACTLY on its primary partner's position
        // for as long as fragT is 0 — which is the entire cube phase,
        // start to finish (fragT and cubeFormT are never both nonzero
        // at once) — and any "extra" primary sharing a cube slot with
        // another primary is in the same boat once cubeFormT rises.
        // Two near-identical metaballs stacked on the same spot don't
        // just double up harmlessly: running them both through the same
        // smin fold measurably inflates that spot's effective radius
        // (smin(x,x,k) computes to x - k/4, not x), which was quietly
        // shrinking the real gap between adjacent cubes below what the
        // target positions alone would suggest. Since both are 100%
        // redundant here anyway, shrinking them to nothing while cubes
        // are formed removes that inflation with zero visible change,
        // and they fade back to full size the moment cubeFormT eases
        // back toward 0.
        sizeMul = p.sizeMul * (1 - cubeFormT);
      } else if(cubeFormT > 0){
        // a point currently tumbled toward the viewer reads slightly
        // larger, one tumbled away slightly smaller — the same "closer
        // looks bigger" cue real 3D rotation has, faded in/out by
        // cubeFormT itself so it never pops in ahead of the cube shape
        sizeMul = p.sizeMul * (1 + p.cubeDepth * CUBE_DEPTH_SIZE * cubeFormT);
      }
      uniforms.uPointSize.value[i] = sizeMul;
    }
    renderer.render(scene, camera);
  }

  // the mass doesn't just belong to the hero — it follows the visitor
  // into the contrast section too, reparented (the same "move the real
  // node, don't duplicate the effect" trick showcase.js already uses
  // for its expanded card/quote) into that section's own sticky so it
  // keeps wandering there, at full opacity, for the whole time that
  // section is pinned. Reparenting alone made it *teleport* in though —
  // the instant it became a plain inset:0 child of the (always-pinned-
  // at-the-top) sticky, whatever was still off-screen above the old
  // hero box was suddenly sitting in full view, since the new
  // container's own on-screen position doesn't match where the old one
  // had scrolled to. Fixed by compensating with a translateY that
  // starts exactly cancelling that jump (so the very first frame in
  // the new container looks identical to the last frame in the old
  // one) and eases to zero over FALL_DIST — reading as gravity pulling
  // the mass down into place rather than a cut. It's a pure function of
  // how far past the hero/contrast boundary the scroll position is, so
  // scrolling back up runs the exact same motion in reverse, right back
  // through the same boundary, with no separate rise-up logic needed.
  // It only fades near the very end of the section, in the last
  // EXIT_FADE_RATIO of one viewport height, as the sticky is about to
  // let go into showcase. Reparenting is still what keeps this cheap:
  // it's the one canvas, one WebGL context, one simulation throughout —
  // never two instances running at once.
  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // ===================================================================
  // hero cube choreography — the tall (400vh) hero exists purely to
  // give this room to run: free wander → the primary points coalesce
  // into a tight, centred 2x2 cluster of 4 liquid cubes → once formed,
  // that cluster tumbles in true 3D (see project3D above) as the
  // visitor keeps scrolling, tracking scroll directly rather than a
  // timer → they disperse back into the normal free-wandering mass →
  // then the existing fall-into-Contrast/fragment sequence above picks
  // up right where it always did. Boundaries are fractions of
  // heroProgress (0 at the very top of the hero's own scroll range, 1
  // once fully scrolled through it — see loop() below).
  // ===================================================================
  const CUBE_PHASE = {
    wanderEnd: 0.12,    // pure free wander, matches the look before this existed
    formEnd: 0.38,      // coalesce into the tight 4-cube cluster complete
    rotateEnd: 0.74,    // 3D tumble complete
    disperseEnd: 0.92,  // back to free liquid — the remaining stretch up to heroProgress===1
                        // is plain free wander again, so the handoff into Contrast's own
                        // fall/fragment sequence has nothing cube-related left to unwind
  };
  // a full end-to-end 360° spin of a genuinely FLAT 2x2 grid necessarily
  // swings edge-on at some point along the way (the same reason a flat
  // sheet of paper turned side-on to you looks like a thin line) — at
  // that angle the 4 cubes' projected x (or y) spacing shrinks toward
  // zero and they visually collapse into one mass, exactly the "1
  // massive cube" look that was asked NOT to happen. Rather than a full
  // spin, the tilt on each axis is bounded (see CUBE_TILT_*_MAX below)
  // so it always stops well short of edge-on — a real 3D tumble/wobble
  // that keeps all 4 cubes visibly separate throughout, not a full
  // rotisserie turn. Verified analytically (see the sandbox tuning
  // notes) that the worst-case gap between adjacent cube centres across
  // this whole tilt range never drops below about 0.12 — comfortably
  // more than the boxes' own combined half-widths.
  const CUBE_TILT_Y_MAX = 0.45;      // radians, ~26° — vertical-axis tilt ceiling
  const CUBE_TILT_X_MAX = 0.32;      // radians, ~18° — horizontal-axis tilt ceiling (kept lower
                                      // since this axis also cross-feeds into the Y-tilted spacing)
  const CUBE_ROTATE_CYCLES_Y = 1.25; // how many full sine wobbles across the rotate phase
  const CUBE_ROTATE_CYCLES_X = 1.75; // a different, non-matching cycle count than Y so the combined
                                      // motion reads as an irregular tumble rather than a synced rock
  function computeChoreography(heroProgress){
    if(heroProgress <= CUBE_PHASE.wanderEnd){
      return { cubeFormT: 0, angleY: 0, angleX: 0 };
    }
    if(heroProgress <= CUBE_PHASE.formEnd){
      return { cubeFormT: smoothstep(CUBE_PHASE.wanderEnd, CUBE_PHASE.formEnd, heroProgress), angleY: 0, angleX: 0 };
    }
    if(heroProgress <= CUBE_PHASE.rotateEnd){
      // a direct function of scroll position (not time), so this is
      // precisely scroll-scrubbed and cleanly reversible on scroll-up
      const t = (heroProgress - CUBE_PHASE.formEnd) / (CUBE_PHASE.rotateEnd - CUBE_PHASE.formEnd);
      return {
        cubeFormT: 1,
        angleY: Math.sin(t * Math.PI * 2 * CUBE_ROTATE_CYCLES_Y) * CUBE_TILT_Y_MAX,
        angleX: Math.sin(t * Math.PI * 2 * CUBE_ROTATE_CYCLES_X) * CUBE_TILT_X_MAX,
      };
    }
    if(heroProgress <= CUBE_PHASE.disperseEnd){
      const t = smoothstep(CUBE_PHASE.rotateEnd, CUBE_PHASE.disperseEnd, heroProgress);
      return {
        cubeFormT: 1 - t,
        angleY: Math.sin(Math.PI * 2 * CUBE_ROTATE_CYCLES_Y) * CUBE_TILT_Y_MAX,
        angleX: Math.sin(Math.PI * 2 * CUBE_ROTATE_CYCLES_X) * CUBE_TILT_X_MAX,
      };
    }
    return { cubeFormT: 0, angleY: 0, angleX: 0 };
  }

  const FALL_RATIO = 0.7;
  const EXIT_FADE_RATIO = 0.28;
  let zone = 'hero'; // 'hero' | 'contrast' | 'gone'

  // capped at 60 rather than left fully uncapped — the hero is meant to
  // be the smoothest thing on the page, so this stays at 60 even though
  // it's the single biggest sustained GPU contributor (still saves real
  // work on 120Hz ProMotion iPhones, without the visible slow-down a
  // lower cap gave this motion when tried).
  const RENDER_FPS = 60;
  const RENDER_INTERVAL = 1000 / RENDER_FPS;
  let lastRenderTs = 0;

  function loop(ts){
    if(!revealed){ rafId = requestAnimationFrame(loop); return; }

    const heroRect = heroEl ? heroEl.getBoundingClientRect() : null;
    const inHero = heroRect ? heroRect.bottom > 0 : false;

    // 0 at the very top of the hero's own scroll range, 1 once fully
    // scrolled through it — reuses heroRect.top (already measured just
    // above) rather than a second scrollY/offsetTop read: #hero sits at
    // the very top of the document, so -heroRect.top is exactly how far
    // scrolled past its own top edge already
    const heroProgress = (inHero && heroRect) ? Math.max(0, Math.min(1, -heroRect.top / heroScrollableHeight)) : 0;
    const { cubeFormT, angleY, angleX } = computeChoreography(heroProgress);
    uniforms.uCubeT.value = cubeFormT;
    uniforms.uCubeAngleY.value = angleY;
    uniforms.uCubeAngleX.value = angleX;

    let inContrast = false;
    let exitOpacity = 1;
    let fallOffset = 0;
    // 0 = merged into the one normal-size mass (hero), 1 = fully
    // fragmented into many small independent droplets (fully fallen
    // into Contrast) — reuses the same fall-in progress as fallOffset
    // above so the mass fragments *as* it falls, not on a separate
    // timeline, and re-merges on the way back up through the same
    // reversible scroll-position math
    let fragT = 0;
    if(!inHero && contrastStickyEl){
      const cRect = contrastSectionEl.getBoundingClientRect();
      if(cRect.bottom > 0){
        inContrast = true;

        const pastPx = -heroRect.bottom; // how far we've scrolled beyond hero's own bottom edge
        const fallDist = window.innerHeight * FALL_RATIO;
        const fallT = smoothstep(0, fallDist, pastPx);
        const canvasH = canvas.clientHeight || window.innerHeight;
        fallOffset = -canvasH * (1 - fallT);
        fragT = fallT;

        const exitPx = window.innerHeight * EXIT_FADE_RATIO;
        if(cRect.bottom < exitPx) exitOpacity = Math.max(0, cRect.bottom / exitPx);
      }
    }

    const nextZone = inHero ? 'hero' : (inContrast ? 'contrast' : 'gone');
    if(nextZone !== zone){
      if(nextZone === 'contrast' && contrastStickyEl){
        contrastStickyEl.insertBefore(canvas, contrastStickyEl.firstChild);
        canvas.classList.add('is-roaming');
      } else if(nextZone === 'hero' && heroStickyEl){
        heroStickyEl.insertBefore(canvas, heroStickyEl.firstChild);
        canvas.classList.remove('is-roaming');
        canvas.style.transform = ''; // hero phase needs no JS transform at all — plain inset:0 already matches its normal position within the pinned .hero-sticky wrapper
      }
      // 'gone': leave it parked wherever it last was — paused and
      // faded to nothing, so its parent no longer matters until the
      // visitor scrolls back up into one of the other two zones
      zone = nextZone;
      resize();
    }

    if(zone === 'contrast'){
      canvas.style.opacity = String(exitOpacity);
      canvas.style.transform = `translateY(${fallOffset.toFixed(1)}px)`;
    } else if(zone === 'hero' && canvas.style.opacity){
      canvas.style.opacity = ''; // hand control back to the .is-visible class's own transition
    }

    if(zone === 'gone'){ rafId = requestAnimationFrame(loop); return; }

    if(ts - lastRenderTs < RENDER_INTERVAL){
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastRenderTs = ts;
    // refreshed here (once per rendered frame, already capped above)
    // rather than on every raw mousemove/touchmove event — see the
    // note by canvasRect's declaration
    canvasRect = canvas.getBoundingClientRect();

    const dt = lastTs === null ? 16.6667 : Math.min(ts - lastTs, CONFIG.maxDt);
    lastTs = ts;
    if(elapsedStart === null) elapsedStart = ts;
    const elapsed = ts - elapsedStart;

    // global shrink toward the fragmented scale as fragT rises — applies
    // to every point (primaries included, each still scaled by its own
    // uPointSize on top of this), which is what actually lets the mass
    // separate into visibly distinct small droplets rather than just
    // becoming one smaller blob
    uniforms.uSlimeSize.value = CONFIG.slimeSize * (1 - fragT*(1 - CONFIG.fragmentSizeScale));
    uniforms.uSurfaceTension.value = CONFIG.surfaceTension * (1 - fragT*(1 - CONFIG.fragmentTensionScale));

    stepPoints(dt, elapsed, fragT, cubeFormT, angleY, angleX);
    renderOnce(elapsed, cubeFormT);

    rafId = requestAnimationFrame(loop);
  }
  let elapsedStart = null;

  resize();
  measureHeroScrollable();

  if(prefersReducedMotion){
    // a single static frame — settle the points near center once, no
    // ongoing simulation and no render loop at all
    stepPoints(16.6667, 0, 0, 0, 0, 0);
    renderOnce(0, 0);
  } else {
    rafId = requestAnimationFrame(loop);
  }

  window.Papi = window.Papi || {};
  window.Papi.resizeField = resize;
  window.Papi.revealField = function(){
    if(revealed) return;
    revealed = true;
    requestAnimationFrame(()=>{ canvas.classList.add('is-visible'); });
  };
})();
