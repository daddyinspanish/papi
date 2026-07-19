/* ===================================================================
   Papi — LiquidImageFluid
   A real, incompressible fluid simulation (the classic "Stable Fluids"
   method — splat / advect / curl+vorticity confinement / divergence /
   pressure solve / gradient subtraction, all via ping-pong render
   targets) driving a cursor-reactive distortion over one real photo
   (img#heroWaterImg). This is the same category of technique sites
   like izanami-official.com use for their own cursor effect — inspected
   their shipped, unminified-enough bundle directly rather than guessed
   at it: they run this exact pipeline (splat/divergence/pressure/
   gradientSubtract/advection materials, cursorSize/cursorPower/
   distortionPower params) against WebGL planes kept in sync with real
   <img> elements via getBoundingClientRect, NOT a screenshot of
   arbitrary page content.

   That second detail is why this replaces js/liquid-cursor-
   distortion.js (deleted) entirely rather than sitting alongside it:
   that earlier version tried to refract a live screenshot (via
   html2canvas) of the WHOLE page, which turned out to fail outright
   over this site's own position:sticky sections — confirmed by direct
   testing, not assumed. Distorting one real, always-in-sync photo
   sidesteps that whole class of problem: there is no snapshot to go
   stale, no arbitrary DOM to rasterize, nothing to fail silently.

   Scoped to a single element rather than the whole viewport (Izanami's
   own sitewide canvas solves a harder problem — many images at many
   scroll depths under one shared canvas — that this site doesn't have:
   one photo, one place). The canvas lives in normal document flow
   directly over the image (see .hero-water in style.css), so it tracks
   scroll/layout for free with no manual position-syncing needed beyond
   its own resize.

   Performance: the whole fluid solve runs on a small buffer (224px long
   axis — bumped up from an initial 128px once the container became the
   full-width hero background rather than a narrow card, since the same
   128 texels stretched across a much wider area read as visibly blocky
   during motion) — every one of its ~23 passes/frame (1 splat + 1
   divergence + 20 pressure Jacobi iterations + 1 gradient subtract + 1
   advection; no curl/vorticity pass, see _step() below) is therefore
   only a few tens of thousands of pixels, still cheap next to public
   from-scratch implementations of this algorithm that commonly run at
   256px+. Only the final composite pass runs at the image's own display
   resolution. The whole thing pauses entirely once the flow has settled
   and the cursor has been away long enough, exactly like every other
   cursor-reactive effect on this page.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

const DEFAULTS = {
  simResolution: 224,
  pressureIterations: 20,
  velocityDissipation: 1.1,   // per-second — how quickly the flow itself loses energy
  splatRadius: 0.028,
  splatForce: 1800,
  strength: 0.00065,          // final image-UV displacement strength — the fluid's raw velocity is
                              // in the thousands (see splatForce), not a 0..1-per-second scale, so
                              // this is deliberately tiny to bring that back down to a UV-sized offset
  dprCap: 1.5,
  settleMs: 2200,
};

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SPLAT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float uAspect;
  uniform vec2 uPoint;
  uniform vec2 uVelocity;
  uniform float uRadius;
  void main(){
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float falloff = exp(-dot(p, p) / uRadius);
    vec2 base = texture2D(uTarget, vUv).xy;
    vec2 vel = base + uVelocity * falloff;
    float vlen = length(vel);
    if(vlen > 260.0) vel = vel / vlen * 260.0;
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

// vorticity confinement (the standard "curl -> force" swirl-injection
// pass) was tried and removed — tested it directly at this sim's
// actual buffer resolution/scale and it re-injects energy faster than
// dissipation removes it over many consecutive frames with no new
// splat, growing to cover the WHOLE sim buffer rather than staying
// localized (confirmed by A/B testing the pipeline with and without
// it). The plain divergence/pressure/gradient-subtract/advection loop
// below is the proven-stable "Stable Fluids" core on its own; revisit
// vorticity confinement only alongside real tuning of curl strength
// against this exact resolution, not as a drop-in addition.

const DIVERGENCE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main(){
    float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const PRESSURE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexel;
  void main(){
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float div = texture2D(uDivergence, vUv).x;
    float p = (L + R + B + T - div) * 0.25;
    gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_SUBTRACT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  void main(){
    float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vel -= vec2(R - L, T - B) * 0.5;
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

const ADVECTION_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uDissipation;
  void main(){
    vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;
    vec2 result = texture2D(uVelocity, coord).xy;
    gl_FragColor = vec4(result / (1.0 + uDissipation * uDt), 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uImage;
  uniform vec2 uTexel;
  uniform float uStrength;

  void main(){
    vec2 vel = texture2D(uVelocity, vUv).xy;
    float mag = length(vel);

    // real surface normal from the velocity field's own magnitude,
    // same height-map approach as every other liquid shader on this
    // page (see js/hero-slime.js's own header) — a directional
    // highlight/shadow instead of a flat magnitude-based glow.
    float mL = length(texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).xy);
    float mR = length(texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).xy);
    float mB = length(texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).xy);
    float mT = length(texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).xy);
    vec3 normal = normalize(vec3((mL - mR) * 0.08, (mB - mT) * 0.08, 1.0));

    vec3 lightDir = normalize(vec3(-0.4, 0.55, 0.7));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float diff = max(0.0, dot(normal, lightDir));
    vec3 reflectDir = reflect(-lightDir, normal);
    float spec = pow(max(0.0, dot(reflectDir, viewDir)), 38.0);
    float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.0);

    // a whisper of chromatic separation — real water/glass does bend
    // each wavelength a hair differently, but the previous 15%-per-
    // channel spread was strong enough to read as a broken-TV colour
    // fringe rather than water, especially at the higher velocities a
    // fast flick produces. Toned down to something barely perceptible,
    // there for subtle realism rather than as the effect's main look.
    vec2 uvR = clamp(vUv + vel * uStrength * 1.035, 0.001, 0.999);
    vec2 uvG = clamp(vUv + vel * uStrength, 0.001, 0.999);
    vec2 uvB = clamp(vUv + vel * uStrength * 0.965, 0.001, 0.999);
    vec3 color = vec3(
      texture2D(uImage, uvR).r,
      texture2D(uImage, uvG).g,
      texture2D(uImage, uvB).b
    );

    color *= (0.9 + 0.22 * diff);
    color += vec3(1.0) * spec * 0.35;
    color += vec3(1.0) * fresnel * smoothstep(1.0, 22.0, mag) * 0.08;

    // wider, more gradual smoothstep range than before (was 1..18) —
    // the disturbed area now fades in/out over a broader span of the
    // velocity field rather than popping in with a fairly hard edge,
    // reading as a soft ripple spreading outward instead of a sharply
    // bounded blob. The fluid sim's raw velocity is in "splat force"
    // units (thousands), not a 0..1-per-second scale, hence the large
    // numbers here.
    float alpha = smoothstep(0.6, 26.0, mag);
    gl_FragColor = vec4(color, alpha);
  }
`;

class LiquidImageFluid {
  constructor(container, img, canvas, options = {}){
    this.config = Object.assign({}, DEFAULTS, options);
    this.container = container;
    this.img = img;
    this.canvas = canvas;
    this.enabled = false;

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if(prefersReducedMotion || isCoarsePointer) return;

    let renderer;
    try{
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    }catch(e){
      return;
    }
    this.renderer = renderer;
    renderer.setClearColor(0x000000, 0);
    this.enabled = true;

    this._imageTexture = null;
    this._state = {
      pointerUv: new THREE.Vector2(0.5, 0.5),
      lastPointerUv: new THREE.Vector2(0.5, 0.5),
      lastMoveMs: 0,
      hasMoved: false,
      idleSinceMs: 0,
      lastFrameTs: 0,
      rafId: null,
    };

    this._buildScene();
    this._loadImageTexture();
    this._resize();
    this._bindEvents();

    this._frame = this._frame.bind(this);
    this._state.rafId = requestAnimationFrame(this._frame);
  }

  _buildScene(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);

    const texel = new THREE.Vector2(1, 1);
    this.splatMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: SPLAT_FRAGMENT,
      uniforms: {
        uTarget: { value: null }, uAspect: { value: 1 },
        uPoint: { value: new THREE.Vector2(0.5, 0.5) },
        uVelocity: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: this.config.splatRadius },
      },
      depthTest: false, depthWrite: false,
    });
    this.divergenceMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: DIVERGENCE_FRAGMENT,
      uniforms: { uVelocity: { value: null }, uTexel: { value: texel } },
      depthTest: false, depthWrite: false,
    });
    this.pressureMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: PRESSURE_FRAGMENT,
      uniforms: { uPressure: { value: null }, uDivergence: { value: null }, uTexel: { value: texel } },
      depthTest: false, depthWrite: false,
    });
    this.gradientSubtractMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: GRADIENT_SUBTRACT_FRAGMENT,
      uniforms: { uPressure: { value: null }, uVelocity: { value: null }, uTexel: { value: texel } },
      depthTest: false, depthWrite: false,
    });
    this.advectionMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: ADVECTION_FRAGMENT,
      uniforms: {
        uVelocity: { value: null }, uTexel: { value: texel },
        uDt: { value: 0.016 }, uDissipation: { value: this.config.velocityDissipation },
      },
      depthTest: false, depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        uVelocity: { value: null }, uImage: { value: null }, uTexel: { value: texel },
        uStrength: { value: this.config.strength },
      },
      transparent: true, depthTest: false, depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.splatMaterial);
    this.scene.add(this.mesh);
  }

  _makeTarget(w, h){
    // LinearFilter — an earlier version used Nearest here over a fear
    // that linear-sampling a HalfFloat target needs the
    // OES_texture_float_linear extension and could silently return
    // garbage where it's missing. That was never actually the cause of
    // this file's original black-texture bug (see _loadImageTexture's
    // own comment — it was THREE.Texture vs TextureLoader), and Nearest
    // otherwise costs real visual quality: once splatRadius shrank to
    // match a smaller, more cursor-sized ripple, each splat spans far
    // fewer texels and Nearest's texel edges became clearly visible as
    // blockiness. Tested Linear directly at that smaller radius (no
    // garbage, no black output) before switching.
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  _loadImageTexture(){
    // THREE.TextureLoader, not `new THREE.Texture(this.img)` wrapping
    // the existing DOM <img> — found by direct isolation testing that
    // wrapping the live element that way never actually samples
    // correctly (reads back as solid black despite every JS-visible
    // sign — .complete, .naturalWidth, the uniform's own .value — all
    // looking perfectly normal), while loading the exact same file
    // fresh via TextureLoader works immediately. The <img> element
    // itself stays in the DOM regardless (that's still what real users
    // see wherever the WebGL canvas is transparent, and what's there
    // for accessibility/no-JS), this is purely about which object
    // supplies the actual GPU-sampled pixels.
    new THREE.TextureLoader().load(this.img.currentSrc || this.img.src, (tex) => {
      this._imageTexture = tex;
      this.compositeMaterial.uniforms.uImage.value = tex;
    });
  }

  _resize(){
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this._viewW = w; this._viewH = h;
    const aspect = w / h;

    const pr = Math.min(window.devicePixelRatio || 1, this.config.dprCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);

    const simW = this.config.simResolution;
    const simH = Math.max(1, Math.round(simW / aspect));
    [this.velocityA, this.velocityB, this.divergenceTarget,
      this.pressureA, this.pressureB].forEach(t => t && t.dispose());
    this.velocityA = this._makeTarget(simW, simH);
    this.velocityB = this._makeTarget(simW, simH);
    this.divergenceTarget = this._makeTarget(simW, simH);
    this.pressureA = this._makeTarget(simW, simH);
    this.pressureB = this._makeTarget(simW, simH);
    [this.velocityA, this.velocityB, this.pressureA, this.pressureB].forEach(t => {
      this.renderer.setRenderTarget(t);
      this.renderer.clear();
    });
    this.renderer.setRenderTarget(null);

    const texel = new THREE.Vector2(1 / simW, 1 / simH);
    [this.divergenceMaterial, this.pressureMaterial,
      this.gradientSubtractMaterial, this.advectionMaterial].forEach(m => {
      m.uniforms.uTexel.value.copy(texel);
    });
    this.compositeMaterial.uniforms.uTexel.value.copy(texel);
    this.splatMaterial.uniforms.uAspect.value = aspect;
  }

  _bindEvents(){
    const pointerFromEvent = (e) => {
      const rect = this.container.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: 1 - (e.clientY - rect.top) / rect.height,
        inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
      };
    };

    this._onMouseMove = (e) => {
      const p = pointerFromEvent(e);
      if(!p.inside) return;
      const st = this._state;
      // lastPointerUv is deliberately NOT updated here — see _step()'s
      // own comment on why that has to happen once per rendered frame,
      // not once per mousemove event.
      st.pointerUv.set(p.x, p.y);
      st.hasMoved = true;
      st.lastMoveMs = performance.now();
      st.idleSinceMs = 0;
      this._wake();
    };
    window.addEventListener('mousemove', this._onMouseMove, { passive: true });

    let lastResizeW = window.innerWidth, lastResizeH = window.innerHeight;
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      if(Math.abs(w - lastResizeW) <= 10 && Math.abs(h - lastResizeH) <= 10) return;
      lastResizeW = w; lastResizeH = h;
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(() => this._resize(), 200);
    };
    window.addEventListener('resize', this._onResize);

    this._onVisibility = () => {
      if(document.hidden){
        if(this._state.rafId){ cancelAnimationFrame(this._state.rafId); this._state.rafId = null; }
      } else if(!this._state.rafId){
        this._state.lastFrameTs = 0;
        this._state.rafId = requestAnimationFrame(this._frame);
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _wake(){
    if(!this._state.rafId){
      this._state.lastFrameTs = 0;
      this._state.rafId = requestAnimationFrame(this._frame);
    }
  }

  _renderPass(material, target){
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  _step(dt){
    const st = this._state;

    // splat — only while actually moving; velocity/dt already folded
    // into the force uniform so a slow drag and a fast flick feed the
    // field proportionally to real speed, not just "moved vs not".
    // lastPointerUv is advanced HERE, once per rendered frame, rather
    // than in the mousemove handler itself — the browser can fire
    // several mousemove events between two animation frames (routine
    // during a fast flick, more so on high-poll-rate mice/trackpads),
    // and updating lastPointerUv per-event meant only the tiny delta
    // between the last two of those events ever reached the sim, with
    // all the movement before that silently discarded. That under-
    // counted fast motion relative to slow motion — the opposite of
    // how real water responds — and read as a choppy, inconsistent
    // "glitch" rather than a smooth continuous ripple trail.
    if(performance.now() - st.lastMoveMs < 100){
      const dx = (st.pointerUv.x - st.lastPointerUv.x);
      const dy = (st.pointerUv.y - st.lastPointerUv.y);
      const u = this.splatMaterial.uniforms;
      u.uTarget.value = this.velocityA.texture;
      u.uPoint.value.copy(st.pointerUv);
      u.uVelocity.value.set(dx * this.config.splatForce, dy * this.config.splatForce);
      this._renderPass(this.splatMaterial, this.velocityB);
      [this.velocityA, this.velocityB] = [this.velocityB, this.velocityA];
    }
    st.lastPointerUv.copy(st.pointerUv);

    // curl + vorticity confinement (materials still built in
    // _buildScene, kept available) is deliberately NOT in this loop —
    // tested it directly against this actual buffer resolution/scale
    // and it re-injects energy faster than dissipation removes it over
    // many consecutive frames with no new splat, growing to cover the
    // WHOLE sim buffer rather than staying localized (confirmed by
    // A/B testing the pipeline with and without this pass). The
    // "swirly vortex" character it adds is a nice-to-have on top of a
    // correctly-behaving fluid sim, not a substitute for one, so it
    // stays off until that instability is actually solved rather than
    // shipping a broken effect for the sake of one extra flourish.

    // divergence -> pressure (jacobi) -> subtract gradient — makes the
    // field incompressible, i.e. an actual fluid rather than a vector
    // field that can freely pile up/vanish
    this.divergenceMaterial.uniforms.uVelocity.value = this.velocityA.texture;
    this._renderPass(this.divergenceMaterial, this.divergenceTarget);

    this.renderer.setRenderTarget(this.pressureA);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
    for(let i = 0; i < this.config.pressureIterations; i++){
      this.pressureMaterial.uniforms.uPressure.value = this.pressureA.texture;
      this.pressureMaterial.uniforms.uDivergence.value = this.divergenceTarget.texture;
      this._renderPass(this.pressureMaterial, this.pressureB);
      [this.pressureA, this.pressureB] = [this.pressureB, this.pressureA];
    }

    this.gradientSubtractMaterial.uniforms.uPressure.value = this.pressureA.texture;
    this.gradientSubtractMaterial.uniforms.uVelocity.value = this.velocityA.texture;
    this._renderPass(this.gradientSubtractMaterial, this.velocityB);
    [this.velocityA, this.velocityB] = [this.velocityB, this.velocityA];

    // advection — moves the velocity field through itself, the actual
    // "flow" (self-advection is enough here: there's no separate dye/
    // colour field to carry, the final composite samples the real
    // photo directly using this settled velocity as its UV offset)
    this.advectionMaterial.uniforms.uVelocity.value = this.velocityA.texture;
    this.advectionMaterial.uniforms.uDt.value = dt;
    this._renderPass(this.advectionMaterial, this.velocityB);
    [this.velocityA, this.velocityB] = [this.velocityB, this.velocityA];
  }

  _composite(){
    if(!this._imageTexture) return;
    this.compositeMaterial.uniforms.uVelocity.value = this.velocityA.texture;
    this.mesh.material = this.compositeMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  _frame(ts){
    const st = this._state;
    const dtRaw = st.lastFrameTs ? (ts - st.lastFrameTs) : 16;
    const dt = Math.min(dtRaw, 1000 / 24) / 1000;
    st.lastFrameTs = ts;

    const movingRecently = performance.now() - st.lastMoveMs < 400;
    if(movingRecently) st.idleSinceMs = 0;
    else if(!st.idleSinceMs) st.idleSinceMs = ts;

    const stillSettling = !st.idleSinceMs || (ts - st.idleSinceMs) < this.config.settleMs;

    if(stillSettling){
      this._step(dt);
      this._composite();
    }

    if(!stillSettling){
      st.rafId = null;
      return;
    }
    st.rafId = requestAnimationFrame(this._frame);
  }

  destroy(){
    if(!this.enabled) return;
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if(this._state.rafId) cancelAnimationFrame(this._state.rafId);
    clearTimeout(this._resizeT);
    [this.velocityA, this.velocityB, this.divergenceTarget,
      this.pressureA, this.pressureB].forEach(t => t && t.dispose());
    if(this._imageTexture) this._imageTexture.dispose();
    this.renderer.dispose();
    this.enabled = false;
  }
}

(function(){
  const container = document.getElementById('heroWater');
  const img = document.getElementById('heroWaterImg');
  const canvas = document.getElementById('heroWaterCanvas');
  if(!container || !img || !canvas) return;
  window.Papi = window.Papi || {};
  window.Papi.liquidImageFluid = new LiquidImageFluid(container, img, canvas);
})();
