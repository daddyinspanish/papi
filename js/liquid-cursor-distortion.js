/* ===================================================================
   Papi — LiquidCursorDistortion
   A reusable WebGL "liquid glass" cursor effect: refracts the ACTUAL
   page pixels beneath the cursor through a persistent, velocity-driven
   displacement field, rather than a flat magnifying-glass warp or a
   CSS/SVG filter trick (this project has already been burned by
   backdrop-filter/blur-class effects causing sitewide jank — see the
   fan-card/testimonials-glow removal history — so this deliberately
   stays off that path entirely). Replaces the old js/cursor-ripple.js,
   which approximated "liquid glass echoing the pointer" with plain
   CSS-animated divs; this is the real thing, at real WebGL cost, kept
   in check by everything below.

   The displacement field itself lives in a small ping-pong pair of
   render targets — a tiny fluid-style simulation, not a single texture
   read every frame: each tick decays and slightly diffuses whatever
   was there a moment ago, then stamps a new splat of the cursor's own
   (smoothed, inertia-lagged) velocity on top. That's what gives the
   trail its "still settling" quality rather than an instantly-snapping
   dot, and what makes it fade out gradually once the cursor stops
   rather than cutting off.

   There's no native way for a shader to sample arbitrary live DOM, so
   getting real page pixels into a texture at all goes through
   html2canvas — capturing just the current VIEWPORT (never the whole
   scrollable page — bounded texture size, bounded capture cost), and
   only on load, on resize, and once scrolling actually settles, never
   continuously (a per-frame DOM rasterization would be far too slow
   to be "high-performance" by any definition). This site's own WebGL
   canvases (hero-slime, process-flow, process-fog) and video are
   explicitly excluded from that capture — html2canvas can't reliably
   rasterize live WebGL/video content, so letting it try would bake a
   broken/blank rectangle into the snapshot exactly where this page's
   own liquid effects live. Skipping them just leaves that patch of the
   lens showing plain background instead — a clean, honest gap rather
   than a visibly broken one.

   Two things keep this from ever interfering with scrolling or
   clicking: the overlay canvas is pointer-events:none (nothing here
   can intercept an event, full stop), and the composite shader only
   ever writes a pixel where the displacement buffer's own magnitude is
   non-negligible (see the `discard` below) — everywhere else is fully
   transparent, so the real, live, interactive DOM underneath shows
   through completely untouched beyond a small lens trailing the
   cursor. The canvas also fades itself out for the duration of any
   scroll (a static snapshot mid-scroll would visibly lag the real
   page) and recaptures fresh the moment scrolling settles.

   One real limitation, found by testing directly against the live
   site rather than assuming html2canvas would just work: html2canvas
   cannot reliably capture any of this site's three tall
   scroll-pinned sections (#heroProcess, #contrastSection, #showcase —
   the sitewide "400vh outer + 100vh position:sticky inner" pattern
   used throughout, see js/process-flow.js's own header for why that
   pattern exists). html2canvas's cloning approach doesn't resolve
   position:sticky correctly, so a capture taken while scrolled into
   any of those three renders mostly blank, or shows whatever content
   happened to render before it gave up — confirmed with direct visual
   tests on designedbypapi.com, not a guess. Rather than ship a
   distortion lens that's silently refracting broken/stale content
   through most of the page, STICKY_ZONE_SELECTORS below is checked on
   every scroll: the effect fades out and stops capturing entirely for
   as long as the current scroll position sits inside any of those
   three sections, and resumes normally the moment scroll moves back
   into ordinary (non-sticky) page flow.
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

// the three sitewide tall-outer/sticky-inner sections html2canvas
// can't capture correctly — see the file header above
const STICKY_ZONE_SELECTORS = ['#heroProcess', '#contrastSection', '#showcase'];

const DEFAULTS = {
  simResolution: 256,     // long-axis resolution of the low-res displacement buffer
  decay: 0.955,           // per-frame decay of the persistent trail
  velocityLag: 0.28,      // how quickly the smoothed velocity chases the raw target — the "inertia"
  splatRadius: 0.075,     // aspect-corrected uv radius of each stamp
  splatForce: 1.5,        // how strongly velocity feeds into the buffer
  strength: 0.012,        // refraction displacement strength, in uv units
  dprCap: 1.5,
  settleMs: 1800,         // how long to keep rendering after motion stops, long enough for the
                          // trail to fully decay away given `decay` above (~0.955^100 ≈ 1%)
  maxVelocity: 6,         // caps a single event's computed velocity (uv/sec) — without this, an
                          // outlier event (a coalesced browser event right after page load, or
                          // any other timing artifact producing a tiny dt alongside a real
                          // delta) divides by a near-floor dt and can momentarily produce a huge,
                          // very visible splat completely disconnected from actual cursor speed
  scrollEndMs: 220,
  html2canvasUrl: 'js/vendor/html2canvas.min.js',
};

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SIM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform vec2 uMouseUv;
  uniform vec2 uVelocity;
  uniform float uAspect;
  uniform float uDecay;
  uniform float uRadius;
  uniform float uForce;

  void main(){
    vec2 prevVal = texture2D(uPrev, vUv).xy;
    // cheap 4-tap diffusion so the trail visibly spreads/softens as it
    // decays, rather than just shrinking in place toward a hard dot
    vec2 blurred = prevVal*0.5 + 0.125*(
      texture2D(uPrev, vUv+vec2(uTexel.x,0.0)).xy +
      texture2D(uPrev, vUv-vec2(uTexel.x,0.0)).xy +
      texture2D(uPrev, vUv+vec2(0.0,uTexel.y)).xy +
      texture2D(uPrev, vUv-vec2(0.0,uTexel.y)).xy
    );
    vec2 decayed = blurred * uDecay;

    vec2 diff = vUv - uMouseUv;
    diff.x *= uAspect;
    float falloff = exp(-dot(diff, diff) / (uRadius*uRadius));
    vec2 splat = uVelocity * uForce * falloff;

    gl_FragColor = vec4(decayed + splat, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uDisplacement;
  uniform sampler2D uPageTex;
  uniform float uStrength;
  uniform bool uHasTexture;

  void main(){
    if(!uHasTexture) discard;
    vec2 disp = texture2D(uDisplacement, vUv).xy;
    float mag = length(disp);
    if(mag < 0.0006) discard;
    vec2 uv2 = clamp(vUv + disp * uStrength, 0.0015, 0.9985);
    vec3 color = texture2D(uPageTex, uv2).rgb;
    // a cheap stand-in for a real specular highlight — brightens
    // roughly where the disturbance itself is strongest, the same
    // "the surface catches light where it's actually curved" idea as
    // the rest of this page's liquid shaders, just without a full
    // normal/lighting calc (this runs full-screen every frame, so it
    // stays deliberately cheap).
    float highlight = smoothstep(0.0, 0.05, mag) * 0.16;
    color += highlight;
    float alpha = smoothstep(0.0006, 0.012, mag);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class LiquidCursorDistortion {
  constructor(options = {}){
    this.config = Object.assign({}, DEFAULTS, options);
    this.enabled = false;

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if(prefersReducedMotion || isCoarsePointer) return;

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
      + 'z-index:1900;pointer-events:none;opacity:0;transition:opacity .25s ease;';
    document.body.appendChild(this.canvas);

    let renderer;
    try{
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    }catch(e){
      this.canvas.remove();
      return;
    }
    this.renderer = renderer;
    renderer.setClearColor(0x000000, 0);
    this.enabled = true;

    this._pageTexture = null;
    this._capturing = false;
    this._settled = true;
    this._h2cPromise = null;

    this._state = {
      mouseUv: new THREE.Vector2(0.5, 0.5),
      rawVelocity: new THREE.Vector2(0, 0),
      smoothedVelocity: new THREE.Vector2(0, 0),
      lastMoveMs: 0,
      hasMoved: false,
      scrolling: false,
      lastFrameTs: 0,
      idleSinceMs: 0,
      rafId: null,
    };

    this._buildScene();
    this._resize();
    this._bindEvents();

    this._loadHtml2Canvas().then(()=>{
      const kick = () => this._scheduleCapture(280);
      if(document.readyState === 'complete') kick();
      else window.addEventListener('load', kick, { once: true });
    });

    this._frame = this._frame.bind(this);
    this._state.rafId = requestAnimationFrame(this._frame);
  }

  // ===================================================================
  // scene / materials
  // ===================================================================
  _buildScene(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);

    this.simMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uMouseUv: { value: this._mouseUvPlaceholder = new THREE.Vector2(0.5, 0.5) },
        uVelocity: { value: new THREE.Vector2(0, 0) },
        uAspect: { value: 1 },
        uDecay: { value: this.config.decay },
        uRadius: { value: this.config.splatRadius },
        uForce: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        uDisplacement: { value: null },
        uPageTex: { value: null },
        uStrength: { value: this.config.strength },
        uHasTexture: { value: false },
      },
      transparent: true, depthTest: false, depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.simMaterial);
    this.scene.add(this.mesh);
  }

  _makeTarget(w, h){
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  // ===================================================================
  // sizing
  // ===================================================================
  _resize(){
    const w = window.innerWidth, h = window.innerHeight;
    this._viewW = w; this._viewH = h;
    const aspect = w / h;

    const pr = Math.min(window.devicePixelRatio || 1, this.config.dprCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);

    const simW = this.config.simResolution;
    const simH = Math.max(1, Math.round(simW / aspect));
    if(this.targetA) this.targetA.dispose();
    if(this.targetB) this.targetB.dispose();
    this.targetA = this._makeTarget(simW, simH);
    this.targetB = this._makeTarget(simW, simH);
    // clear both to zero displacement before first use
    this.renderer.setRenderTarget(this.targetA);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);

    this.simMaterial.uniforms.uTexel.value.set(1 / simW, 1 / simH);
    this.simMaterial.uniforms.uAspect.value = aspect;

    this._measureStickyZones();
  }

  // ===================================================================
  // sticky-zone detection — see the file header for why this exists
  // ===================================================================
  _measureStickyZones(){
    this._stickyZones = STICKY_ZONE_SELECTORS.map(sel => document.querySelector(sel))
      .filter(Boolean)
      .map(el => ({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
  }

  _isInStickyZone(scrollY){
    if(!this._stickyZones) return false;
    for(const zone of this._stickyZones){
      if(scrollY >= zone.top && scrollY <= zone.bottom) return true;
    }
    return false;
  }

  // ===================================================================
  // html2canvas — load once, capture the current viewport on demand
  // ===================================================================
  _loadHtml2Canvas(){
    if(window.html2canvas) return Promise.resolve();
    if(this._h2cPromise) return this._h2cPromise;
    this._h2cPromise = new Promise((resolve, reject)=>{
      const script = document.createElement('script');
      script.src = this.config.html2canvasUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return this._h2cPromise;
  }

  _scheduleCapture(delay){
    clearTimeout(this._captureT);
    this._captureT = setTimeout(()=> this._capture(), delay);
  }

  _capture(){
    if(!window.html2canvas || this._capturing) return;
    // see the file header — html2canvas can't reliably capture any of
    // these three sections, so rather than refract broken/stale
    // content, just stay off for as long as scroll sits inside one
    this._suppressedForSticky = this._isInStickyZone(window.scrollY);
    if(this._suppressedForSticky){
      this.canvas.style.opacity = '0';
      return;
    }
    this._capturing = true;
    const w = window.innerWidth, h = window.innerHeight;
    window.html2canvas(document.documentElement, {
      x: window.scrollX,
      y: window.scrollY,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      backgroundColor: '#ffffff',
      logging: false,
      removeContainer: true,
      ignoreElements: (el) => el === this.canvas || el.tagName === 'CANVAS' || el.tagName === 'VIDEO' || el.tagName === 'IFRAME',
    }).then((snapshot)=>{
      this._capturing = false;
      // scroll may have moved into one of the sticky zones while this
      // (async) capture was in flight — check again rather than
      // trusting the check from when the capture started
      this._suppressedForSticky = this._isInStickyZone(window.scrollY);
      if(this._suppressedForSticky){
        this.canvas.style.opacity = '0';
        return;
      }
      if(this._pageTexture) this._pageTexture.dispose();
      this._pageTexture = new THREE.CanvasTexture(snapshot);
      this._pageTexture.minFilter = THREE.LinearFilter;
      this._pageTexture.magFilter = THREE.LinearFilter;
      this.compositeMaterial.uniforms.uPageTex.value = this._pageTexture;
      this.compositeMaterial.uniforms.uHasTexture.value = true;
      if(!this._state.scrolling) this.canvas.style.opacity = '1';
    }).catch(()=>{ this._capturing = false; });
  }

  // ===================================================================
  // events
  // ===================================================================
  _bindEvents(){
    this._onMouseMove = (e) => {
      const st = this._state;
      const x = e.clientX / this._viewW;
      const y = 1 - e.clientY / this._viewH; // flip to GL's bottom-up uv convention
      const now = performance.now();
      if(st.hasMoved){
        const dt = Math.max(0.008, (now - st.lastMoveMs) / 1000);
        st.rawVelocity.set((x - st.mouseUv.x) / dt, (y - st.mouseUv.y) / dt);
        if(st.rawVelocity.length() > this.config.maxVelocity){
          st.rawVelocity.setLength(this.config.maxVelocity);
        }
      }
      st.mouseUv.set(x, y);
      st.hasMoved = true;
      st.lastMoveMs = now;
      st.idleSinceMs = 0;
      this._wake();
    };
    window.addEventListener('mousemove', this._onMouseMove, { passive: true });

    this._onScroll = () => {
      const st = this._state;
      if(!st.scrolling){
        st.scrolling = true;
        this.canvas.style.opacity = '0';
      }
      clearTimeout(this._scrollEndT);
      this._scrollEndT = setTimeout(()=>{
        st.scrolling = false;
        this._scheduleCapture(0);
      }, this.config.scrollEndMs);
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });

    let lastResizeW = window.innerWidth, lastResizeH = window.innerHeight;
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      if(Math.abs(w - lastResizeW) <= 10 && Math.abs(h - lastResizeH) <= 10) return;
      lastResizeW = w; lastResizeH = h;
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(()=>{ this._resize(); this._scheduleCapture(150); }, 200);
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

    // an active mousedown drag (e.g. dragging a slider/carousel) still
    // counts as "the cursor is doing something" — no special handling
    // needed since mousemove already fires throughout a drag.
  }

  _wake(){
    this._settled = false;
    if(!this._state.rafId){
      this._state.lastFrameTs = 0;
      this._state.rafId = requestAnimationFrame(this._frame);
    }
  }

  // ===================================================================
  // render loop
  // ===================================================================
  _runSimPass(){
    const u = this.simMaterial.uniforms;
    u.uPrev.value = this.targetA.texture;
    u.uMouseUv.value.copy(this._state.mouseUv);
    u.uVelocity.value.copy(this._state.smoothedVelocity);
    u.uForce.value = this.config.splatForce * this._dt;

    this.mesh.material = this.simMaterial;
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.render(this.scene, this.camera);

    const tmp = this.targetA;
    this.targetA = this.targetB;
    this.targetB = tmp;
  }

  _runCompositePass(){
    const u = this.compositeMaterial.uniforms;
    u.uDisplacement.value = this.targetA.texture;

    this.mesh.material = this.compositeMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  _frame(ts){
    const st = this._state;
    const dtRaw = st.lastFrameTs ? (ts - st.lastFrameTs) : 16;
    this._dt = Math.min(dtRaw, 1000 / 24) / 1000;
    st.lastFrameTs = ts;

    // velocity decays to zero if no mousemove has landed recently, so a
    // quick flick's splat still tapers off smoothly once the cursor
    // actually stops, rather than the buffer chasing a stale nonzero
    // target forever
    if(performance.now() - st.lastMoveMs > 70) st.rawVelocity.set(0, 0);
    st.smoothedVelocity.lerp(st.rawVelocity, this.config.velocityLag);

    const active = st.smoothedVelocity.lengthSq() > 0.00000016;
    if(active) st.idleSinceMs = 0;
    else if(!st.idleSinceMs) st.idleSinceMs = ts;

    const stillSettling = !st.idleSinceMs || (ts - st.idleSinceMs) < this.config.settleMs;

    if(stillSettling && !st.scrolling && !this._suppressedForSticky){
      this._runSimPass();
      this._runCompositePass();
    }

    if(!stillSettling){
      st.rafId = null; // let the loop actually stop — _wake() restarts it on the next mousemove
      return;
    }

    st.rafId = requestAnimationFrame(this._frame);
  }

  destroy(){
    if(!this.enabled) return;
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if(this._state.rafId) cancelAnimationFrame(this._state.rafId);
    clearTimeout(this._captureT);
    clearTimeout(this._scrollEndT);
    clearTimeout(this._resizeT);
    if(this._pageTexture) this._pageTexture.dispose();
    if(this.targetA) this.targetA.dispose();
    if(this.targetB) this.targetB.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.enabled = false;
  }
}

window.Papi = window.Papi || {};
window.Papi.liquidCursorDistortion = new LiquidCursorDistortion();
