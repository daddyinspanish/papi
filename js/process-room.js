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
=================================================================== */
import * as THREE from './vendor/three.module.min.js';

const ROOM = {
  radius: 9,
  height: 6.4,
  oculusRadius: 2.3,
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
    const p = wallPoint(theta, radius);
    const nx = -Math.sin(theta), nz = Math.cos(theta); // inward-facing
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

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a4136, roughness: 0.92, metalness: 0.02 });
    const wallGeo = buildWallGeometry(R, H, -ROOM.wallTheta, ROOM.wallTheta, ROOM.wallSegments);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.receiveShadow = true;
    group.add(wall);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.32, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const ceiling = new THREE.Mesh(new THREE.RingGeometry(ROOM.oculusRadius, R, 64), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    ceiling.receiveShadow = true;
    group.add(ceiling);

    // glowing lip where the ceiling meets the oculus opening
    const lipMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const lip = new THREE.Mesh(new THREE.RingGeometry(ROOM.oculusRadius - 0.06, ROOM.oculusRadius, 48), lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = H - 0.02;
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

    // center platform + centerpiece boulder
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.22, metalness: 0.15 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.7, 0.26, 48), platformMat);
    platform.position.set(0, 0.13, -2.2);
    platform.receiveShadow = true;
    group.add(platform);

    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x5c5148, roughness: 0.88, metalness: 0.03 });
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), boulderMat);
    boulder.scale.set(1.25, 0.7, 1.0);
    boulder.position.set(0.5, 0.68, -2.6);
    boulder.rotation.y = 0.6;
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    group.add(boulder);

    // stepping-stone path from the entrance toward the platform
    const stoneMat = platformMat;
    const stonePath = [
      { x: 0.0, z: 7.4 }, { x: 0.55, z: 6.1 }, { x: -0.4, z: 4.8 },
      { x: 0.35, z: 3.5 }, { x: -0.15, z: 2.3 },
    ];
    stonePath.forEach((p, i) => {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.16, 20), stoneMat);
      stone.position.set(p.x, 0.08, p.z);
      stone.receiveShadow = true;
      stone.castShadow = true;
      group.add(stone);
    });

    // three doorway alcoves: two side (left/right), one center back —
    // each a dark recessed opening flanked by thin backlit rim strips.
    // No real hole in the wall geometry behind them (no CSG available)
    // — a darker inset plane placed just inside the wall's own inner
    // surface reads as an opening from the camera's fixed vantage
    // points without one ever needing to actually see "through" it.
    const doorwayThetas = [-ROOM.doorTheta, ROOM.doorTheta, 0];
    doorwayThetas.forEach((theta) => this._buildDoorway(group, theta));
  }

  _buildDoorway(group, theta){
    const R = ROOM.radius;
    const p = wallPoint(theta, R - 0.08);
    const angle = Math.atan2(p.x, -p.z); // face inward, matches wallPoint's own convention

    const doorGroup = new THREE.Group();
    doorGroup.position.set(p.x, 0, p.z);
    doorGroup.rotation.y = angle;
    group.add(doorGroup);

    const voidMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.6), voidMat);
    voidPlane.position.set(0, 1.9, 0.02);
    doorGroup.add(voidPlane);

    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffb37a });
    [-1.2, 1.2].forEach((x) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.7, 0.07), rimMat);
      strip.position.set(x, 1.9, 0.05);
      doorGroup.add(strip);
    });

    const rimLight = new THREE.PointLight(0xffb37a, 4, 5, 2);
    rimLight.position.set(0, 2.1, 0.6);
    doorGroup.add(rimLight);
  }

  _buildLights(){
    const hemi = new THREE.HemisphereLight(0xfff2df, 0x120d09, 0.55);
    this.scene.add(hemi);

    const spot = new THREE.SpotLight(0xfff2df, 9, 22, 0.62, 0.7, 1.3);
    spot.position.set(0, ROOM.height - 0.3, -1.4);
    spot.target.position.set(0, 0, -2.0);
    spot.castShadow = true;
    const shadowSize = this.isMobile ? CONFIG.shadowSizeMobile : CONFIG.shadowSize;
    spot.shadow.mapSize.set(shadowSize, shadowSize);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 14;
    spot.shadow.bias = -0.0015;
    this.scene.add(spot, spot.target);

    const fill = new THREE.PointLight(0xfff6ea, 1.4, 16, 2);
    fill.position.set(0, 2.6, 6);
    this.scene.add(fill);
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
