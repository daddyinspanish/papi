/* ===================================================================
   Papi — Hero Wireframe Wave Grid
   Per direct request, replacing the old falling-numbers matrix rain
   (js/hero-matrix.js, now deleted) with a continuously-undulating 3D
   wireframe terrain grid — a perspective floor of lines receding to a
   horizon, with an organic rolling-hill wave animating across it, in
   the site's own emerald brand color so it contrasts against the
   white/cream hero rather than a literal copy of the reference image's
   black-and-blue palette.

   Pure 2D-canvas perspective projection (no WebGL) — same approach as
   classic pseudo-3D "outrun" ground-grid effects: a flat grid of
   (x, z) points gets a per-point height from a few combined sine waves
   (so it reads as a moving, hilly surface rather than a flat plane),
   then each (x, y, z) world point is projected to 2D screen space with
   a simple perspective divide (scale = focal / depth). Rows/columns are
   drawn as connected polylines, not dots, so it reads as a continuous
   wireframe surface like the reference.

   Kept deliberately parametric (zNear/zFar/FOCAL/camera height derived
   from the canvas's own size in resize(), not hardcoded pixel values)
   so the framing — near row touching the bottom edge, horizon near the
   top — holds up across any viewport aspect ratio, the same reasoning
   js/hero-matrix.js used for its own resize().

   UPDATED per direct follow-up request, "make the grid form more of a
   ball point that is moving as the cursor moves around it" — the
   dominant feature is now a single rounded bump that tracks the cursor
   (see heightAt()'s own comment below), not an autonomous drifting
   hill the cursor could only nudge.
=================================================================== */
(function(){
  const canvas = document.getElementById('processHeroGrid');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;

  const CONFIG = {
    // fewer columns on phones: the same 100 squeezed into ~375px are only a
    // few px apart, which reads as a dense, busy moire instead of a mesh
    cols: window.innerWidth < 640 ? 66 : 100,
    rows: 54,
    // ratios, not pixels — resize() turns these into real distances
    // based on the canvas's own height so the field of view holds up
    // at any viewport size
    nearRatio: 0.42,
    farMultiple: 5,
    // BUG FIX: per direct report, "the top of the grid should connect to
    // the top edge of the website" — this used to be 0.16 on desktop
    // (mobile was already fixed to 0 after an earlier, identical report:
    // "on mobile the grid... is not connecting to the very top"). Same
    // fix now applies everywhere: 0 puts the horizon exactly at the top
    // edge, so the grid's own vanishing point sits right at y=0 with
    // nothing above it, regardless of viewport size.
    horizonFrac: 0,
    mobileWidth: 640,
    // the nearest row's flat baseline sits well PAST the bottom edge:
    // per direct request the landscape now shapes the bottom of the grid
    // too, and terrain only ever lifts the surface upward, so the extra
    // margin is what keeps a hill near the viewer from pulling the
    // grid's lower edge up into frame and exposing an empty strip
    nearYFrac: 1.38,
    // the grid's width at the near row, as a fraction of the full
    // viewport width. BUG FIX: per follow-up report, "there are gaps on
    // the left and right side... its suppose to cover the right and
    // left sides always" — a previous pass narrowed this (0.34) to fix
    // an unrelated complaint about the TOP looking like a sharp pyramid
    // point, but that over-corrected into a narrow "road" floating in
    // the middle of the hero instead of a full-bleed grid. 1 (full
    // width) restores edge-to-edge coverage at the bottom, matching the
    // original reference image, while widthFracAt() below still handles
    // the (separate, already-fixed) pointy-top problem.
    roadWidthFrac: 1,
    // BUG FIX: per report, "it looks like its just a pyramid... its
    // supposed to look like a road" — width used to be derived from the
    // SAME physical perspective scale as the row's vertical position
    // (colX[j]*scale). That scale is driven by farMultiple/canvas-height
    // math built for closing the vertical gap, not for how a road should
    // look, and it narrows far more aggressively on a tall, narrow phone
    // screen than on a short, wide desktop window — looked fine on one,
    // spiky on the other. widthFracAt() below is a width envelope
    // designed directly in terms of nz (0=near, 1=far), decoupled from
    // the physical scale entirely, so the SHAPE of the narrowing is
    // identical regardless of aspect ratio — only roadWidthFrac's
    // absolute size (above) changes with viewport width.
    roadNarrowPower: 1.5,
    // per direct request, "widen the top part of the grid so it doesn't look
    // like a thin part": the far end used to taper to 22% of the viewport
    // width. It now stays ~full width, so the landscape reaches both edges
    // all the way up instead of narrowing into a strip at the top.
    roadMinWidthFrac: 1.05,
    // per direct request ("extend the grid from the bottom, to always be
    // connected to the left and right edges of screen... so it does not
    // look like something is missing on the bottom left and right"): the
    // grid used to be exactly viewport-wide only at its (off-screen)
    // nearest row and narrowed from there, so the lower corners of the
    // screen showed empty wedges once the rows rose above the bottom
    // edge. The near end is now ~2x the viewport width, so the surface
    // runs past both screen edges through the whole lower part of the
    // hero and only narrows toward the horizon.
    roadNearWidthFrac: 2,
    // wave amplitude as a fraction of canvas height
    amplitudeFrac: 0.1,
    // per direct request ("more 3D like if its more of a landscape"):
    // height of the rolling terrain itself, as a fraction of canvas
    // height — separate from amplitudeFrac above, which now only drives
    // the cursor-ball bump and the faint ambient ripple
    terrainFrac: 0.27,
    lineWidth: 1,
    // alpha fades from near (bold, legible) to far (faint, atmospheric)
    alphaNear: 0.5,
    alphaFar: 0.06,
  };

  // brand emerald — matches --gold-deep in css/style.css, chosen so the
  // grid reads as a deliberate brand accent against the pale hero
  // rather than the reference image's literal neon blue
  const LINE_RGB = '4,120,87';

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let FOCAL = 0, zNear = 0, zFar = 0, camHeight = 0, horizonY = 0, amplitude = 0, terrainAmp = 0;
  const rowZ = new Array(CONFIG.rows + 1);
  const alphaCache = new Array(CONFIG.rows + 1);

  // closes the top gap only (see its own BUG FIX comment in renderFrame
  // below) — now ONLY responsible for vertical position, since width is
  // fully decoupled via widthFracAt() below. Tapering all the way to a
  // literal 0 is correct and desired here: Y should land exactly on
  // horizonY, and doing so no longer drags the road's width down with
  // it the way it did before this was split apart.
  const TAPER_START = 0.88;
  function scaleForRow(i){
    const nz = i / CONFIG.rows;
    let scale = FOCAL / rowZ[i];
    if(nz > TAPER_START){
      const tt = (nz - TAPER_START) / (1 - TAPER_START);
      const smooth = tt * tt * (3 - 2 * tt);
      scale *= (1 - smooth);
    }
    return scale;
  }

  // see roadNarrowPower/roadMinWidthFrac's own comment in CONFIG above —
  // a hand-designed easing curve from full width (nz=0) down to
  // roadMinWidthFrac (nz=1), independent of aspect ratio
  function widthFracAt(nz){
    const t = Math.pow(Math.min(Math.max(nz, 0), 1), CONFIG.roadNarrowPower);
    return CONFIG.roadMinWidthFrac + (CONFIG.roadNearWidthFrac - CONFIG.roadMinWidthFrac) * (1 - t);
  }

  // ===================================================================
  // BRIDGE MORPH — per direct request: "as someone scrolls the grid goes
  // from the wave and transforms into one of those connected dot lines
  // in the second section." js/scroll-journey-hero.js drives
  // bridgeProgress (0-1) from the tail of its own pin-scrub via
  // window.PapiHeroGrid.setBridgeProgress(). A morph front sweeps from
  // the horizon down to the viewer: rows it has passed lose their solid
  // grid lines and become a constellation — most vertices drop out, the
  // survivors drift off the lattice into irregular positions, and only a
  // few short links between neighbours remain, with the exact node
  // radius/color/link style of js/live-demo-network.js's plexus just
  // below this section, so the handoff reads as one continuous network.
  // The vertices keep riding the terrain/ball heights while they morph,
  // so it is the same living wave that dissolves into dots, not a
  // cross-fade to something else. Pure function of the scrubbed value, so
  // scrolling back up reverses it cleanly.
  // ===================================================================
  let bridgeProgress = 0;   // what is actually drawn (eased toward the target each frame)
  let bridgeTarget = 0;     // what the scroll position is asking for
  const BRIDGE_BAND = 0.16; // half-width of the morph front, as a fraction of the grid depth
  // front position (in nz) at which a row is exactly half-morphed;
  // chosen so bridgeProgress 0 leaves every row untouched (even the
  // horizon) and bridgeProgress 1 leaves every row fully morphed
  function morphFront(){
    return 1 + BRIDGE_BAND - bridgeProgress * (1 + 2 * BRIDGE_BAND);
  }
  function smooth01(x){
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * (3 - 2 * x);
  }
  // brightens the rows currently inside the front, so the sweep itself
  // reads as a travelling wave crest
  function bridgeHighlight(nz, front){
    if(bridgeProgress <= 0 || bridgeProgress >= 1) return 0;
    return Math.max(0, 1 - Math.abs(nz - front) / BRIDGE_BAND);
  }

  function resize(){
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    // capped lower on phones — a full-bleed canvas at 3x is a lot of
    // pixels to repaint every frame for 1px lines that look the same
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < CONFIG.mobileWidth ? 1.5 : 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w;
    H = h;

    FOCAL = H * 0.9;
    zNear = FOCAL * CONFIG.nearRatio;
    zFar = zNear * CONFIG.farMultiple;
    horizonY = H * CONFIG.horizonFrac;
    amplitude = H * CONFIG.amplitudeFrac;
    terrainAmp = H * CONFIG.terrainFrac;

    // the nearest row's flat (height 0) point should land at nearYFrac*H;
    // solving screenY = horizonY + camHeight * (FOCAL/zNear) for camHeight
    const scaleNear = FOCAL / zNear;
    camHeight = (H * CONFIG.nearYFrac - horizonY) / scaleNear;

    for(let i = 0; i <= CONFIG.rows; i++){
      const t = i / CONFIG.rows;
      rowZ[i] = zNear + t * (zFar - zNear);
      alphaCache[i] = CONFIG.alphaNear + (CONFIG.alphaFar - CONFIG.alphaNear) * t;
    }
  }

  // ===================================================================
  // pointer tracking — nx/nz below are the cursor's approximate
  // position in the SAME normalized grid space heightAt() works in,
  // found by inverting the projection for the nearest row (see
  // pointermove) rather than a full analytic unproject. The ball itself
  // (heightAt's ballX/ballZ) chases this every frame in the render loop
  // below, rather than snapping straight to it.
  // ===================================================================
  let pointerActive = false;
  let pointerNX = 0, pointerNZ = 0.4;

  // per direct request, "I want the grid to have the ball point effect
  // move on its own, only for mobile" — touch devices have no ambient
  // hover, so a visitor who never drags a finger across the hero would
  // otherwise see the ball sit wherever it last settled; binding is
  // skipped entirely on mobile so the ball ALWAYS runs the idle-drift
  // path in the render loop below, continuously, rather than waiting on
  // touch input that may never come.
  const isMobileDevice = window.innerWidth < CONFIG.mobileWidth;
  const TIME_SCALE = isMobileDevice ? 0.58 : 0.78;
  const heroSection = canvas.closest('.process-hero');
  if(!prefersReducedMotion && heroSection && !isMobileDevice){
    const updatePointer = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      // find the row whose flat screenY is closest to the pointer, then
      // invert that row's known perspective scale to recover world x
      let bestI = 0, bestDist = Infinity;
      for(let i = 0; i <= CONFIG.rows; i++){
        const scale = scaleForRow(i);
        const sy = horizonY + camHeight * scale;
        const d = Math.abs(sy - py);
        if(d < bestDist){ bestDist = d; bestI = i; }
      }
      const nzBest = bestI / CONFIG.rows;
      // mirrors renderFrame()'s own screenHalfWidth formula — see
      // widthFracAt()'s comment for why width is no longer derived from
      // scaleForRow() at all
      // screen-normalized x (-1..1 across the viewport), NOT grid-space:
      // the grid is now wider than the screen, but the ball and terrain
      // are sized in screen units so they look the same as before
      pointerNX = Math.max(-1, Math.min(1, (px - W / 2) / (W / 2)));
      pointerNZ = nzBest;
      pointerActive = true;
    };
    heroSection.addEventListener('pointermove', (e) => updatePointer(e.clientX, e.clientY), { passive: true });
    heroSection.addEventListener('pointerleave', () => { pointerActive = false; }, { passive: true });
    heroSection.addEventListener('pointerup', () => { pointerActive = false; }, { passive: true });
    heroSection.addEventListener('pointercancel', () => { pointerActive = false; }, { passive: true });
  }

  // per direct request, "make the grid form more of a ball point that
  // is moving as the cursor moves around it" — the dominant feature is
  // now a single, tightly-rounded bump that CHASES the cursor (ballX/
  // ballZ below, smoothed toward the pointer's position every frame)
  // rather than an autonomous hill the cursor could only nudge. With no
  // pointer present (touch devices, or before the first mouse move) it
  // settles into a slow idle drift instead of sitting dead-center, so
  // the hero still reads as "alive" with nothing to chase it.
  let ballX = 0.12, ballZ = 0.42, ballVX = 0, ballVZ = 0;
  // random-waypoint idle wander state — see its own BUG FIX comment in
  // loop() below
  let idleTargetX = 0.12, idleTargetZ = 0.42, idleNextPickAt = 0;

  // nx: -1..1 across the grid's width. nz: 0..1 from near to far.
  //
  // per direct request, "I would like the grid to look more 3D like if
  // its more of a landscape look" — terrain() is a real rolling
  // landscape rather than a flat floor with one bump: a valley down the
  // middle with walls rising toward both sides, ridged hills that grow
  // taller the further away they are (distant mountains), and a slow
  // drift so it never sits frozen. Hidden-line removal in renderFrame()
  // then lets near ridges hide the ones behind them, which is what makes
  // it read as solid ground instead of a transparent net.
  // per direct request, "make the grid in the beginning also be
  // rotating, so that way the landscape is always random": the ridge
  // field is sampled through a slowly ROTATING + drifting coordinate
  // frame (and a per-visit random starting angle/phase), so hills turn,
  // slide and re-form continuously and no two moments (or visits) match.
  // The valley/wall composition below stays fixed to the screen so the
  // hero never loses its overall shape or its legible middle.
  const seedA = Math.random() * 6.283, seedB = Math.random() * 6.283;
  let tCos = 1, tSin = 0, tDrift = 0, tFlow = 0;
  // per direct request, "make the grid more flexible, more smoother, and
  // moving a lot more": the old ridge (1 - |sin|) had sharp creases along
  // every crest, which read as stiff folded paper. The field is now built
  // from long smooth waves whose coordinates are themselves bent by two
  // slow flowing sine fields (a domain warp), so crests curve and slide
  // like ribbons of cloth instead of running as straight creases, and the
  // crest itself is rounded (sqrt(a*a + eps) instead of |a|). tFlow drives
  // the flow several times faster than the old drift so the landscape is
  // visibly always in motion.
  function terrain(nx, nz){
    const cz = (nz - 0.5) * 2;
    const ru = nx * tCos - cz * tSin;
    const rv = nx * tSin + cz * tCos + tDrift;
    const env = 0.55 + 0.95 * Math.pow(nz, 1.1);
    // side walls rise less right next to the viewer, so the bottom
    // corners can't be hauled up out of frame
    const walls = 0.3 + 1.15 * nx * nx * (0.35 + 0.65 * nz);
    const wu = ru + 0.42 * Math.sin(rv * 2.1 + tFlow * 0.55 + seedB);
    const wv = rv + 0.42 * Math.sin(ru * 1.7 - tFlow * 0.45 + seedA);
    const a = Math.sin(wu * 2.6 + wv * 1.9 + seedA + tFlow * 0.5);
    const b = Math.sin(wu * 1.3 - wv * 3.4 + seedB - tFlow * 0.38);
    const c = Math.sin(wu * 5.2 + wv * 4.1 + tFlow * 0.85);
    // rounded crest, remapped to 0..1 like the old ridge so the overall
    // height budget (and the grid's bottom margin) is unchanged
    const ridge = (1.0583 - Math.sqrt(a * a + 0.12)) / 0.7123;
    return (ridge * 0.9 + b * 0.32 + c * 0.1) * env * walls;
  }

  // how much the ball is moving right now (0..1) — drives the ripple
  // rings below so the surface only "rings" when the cursor actually
  // stirs it (see loop(): the ball is an underdamped spring)
  let ballEnergy = 0;
  function heightAt(nx, nz, t){
    const dx = nx - ballX;
    const dz = nz - ballZ;
    // tight, roughly-equal falloff in both axes — a round "ball" rather
    // than the elongated ridge a wide x/narrow z falloff would produce.
    const ball = Math.exp(-(dx * dx) / 0.2 - (dz * dz) / 0.065);
    const zTaper = Math.sin(Math.min(Math.max(nz, 0), 1) * Math.PI);
    // flowing swell: long waves travelling toward the viewer, the same
    // direction ribbons run in the reference
    const ripple = (
      Math.sin(nx * 2.4 + nz * 3.4 - t * 1.05) * 0.5 +
      Math.sin(nx * 1.1 - nz * 4.6 - t * 0.8) * 0.4
    ) * zTaper * 0.34;
    // concentric rings spreading from the ball, fading with distance
    const d2 = dx * dx + dz * dz * 2.56;
    const ring = Math.sin(Math.sqrt(d2) * 11 - t * 3.4) * Math.exp(-d2 * 2.4) * (0.1 + 0.5 * ballEnergy);
    return (ball * 1.25 + ripple + ring) * amplitude + terrain(nx, nz) * terrainAmp;
  }

  // ---- per-vertex scratch buffers (allocated once, reused every frame)
  const C1 = CONFIG.cols + 1;
  const VN = (CONFIG.rows + 1) * C1;
  const vx = new Float32Array(VN), vy = new Float32Array(VN);
  const px = new Float32Array(VN), py = new Float32Array(VN);
  const vm = new Float32Array(VN);
  const rowSx = new Float32Array(CONFIG.rows + 1);
  const hA = new Float32Array(VN), hB = new Float32Array(VN), hC = new Float32Array(VN), hD = new Float32Array(VN);
  (function seedHashes(){
    let s = 0x9e3779b9;
    const rnd = () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for(let k = 0; k < VN; k++){ hA[k] = rnd(); hB[k] = rnd(); hC[k] = rnd(); hD[k] = rnd(); }
  })();

  const PAPER = '#f8f6f2'; // matches .process-hero's own flat background
  const KEEP_AT_FULL_MORPH = 0.17; // fraction of vertices that survive as constellation nodes
  const LINK_STENCIL = [[0, 1], [1, 0], [1, 1], [1, -1], [0, 2], [2, 0]]; // [rows toward far, cols]

  // BUG FIX, per direct report "the animation is not smooth": the morph
  // used to issue one stroke() (with its own freshly-built color string)
  // PER line segment — thousands per frame while rows were mid-morph —
  // plus a shadowBlur glow, and ran capped at 36fps. Segments are now
  // grouped into a fixed set of alpha levels and each level is drawn as
  // ONE path / ONE stroke, so the cost stays flat no matter how many
  // segments are on screen.
  const AL = 32;
  const makeBuckets = () => Array.from({ length: AL + 1 }, () => []);
  const stripBuckets = makeBuckets();
  const linkBuckets = makeBuckets();
  const dotBuckets = makeBuckets();
  const qa = (a) => Math.round((a > 1 ? 1 : a) * AL);
  function flushSegs(buckets){
    for(let q = 1; q <= AL; q++){
      const arr = buckets[q];
      if(!arr.length) continue;
      ctx.strokeStyle = `rgba(${LINE_RGB},${(q / AL).toFixed(3)})`;
      ctx.beginPath();
      for(let k = 0; k < arr.length; k += 4){
        ctx.moveTo(arr[k], arr[k + 1]);
        ctx.lineTo(arr[k + 2], arr[k + 3]);
      }
      ctx.stroke();
      arr.length = 0;
    }
  }
  function flushDots(buckets){
    for(let q = 1; q <= AL; q++){
      const arr = buckets[q];
      if(!arr.length) continue;
      ctx.fillStyle = `rgba(${LINE_RGB},${(q / AL).toFixed(3)})`;
      ctx.beginPath();
      for(let k = 0; k < arr.length; k += 3){
        ctx.moveTo(arr[k] + arr[k + 2], arr[k + 1]);
        ctx.arc(arr[k], arr[k + 1], arr[k + 2], 0, Math.PI * 2);
      }
      ctx.fill();
      arr.length = 0;
    }
  }

  function renderFrame(t){
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = CONFIG.lineWidth;
    const rows = CONFIG.rows, cols = CONFIG.cols;

    // rotating/drifting terrain frame for this frame (see terrain())
    // per direct request ("a bit slower, on mobile it's too distracting"):
    // the landscape's own clock runs a notch slower, a bit more so on phones
    const ts = t * TIME_SCALE;
    const ang = seedA + ts * 0.07;
    tCos = Math.cos(ang);
    tSin = Math.sin(ang);
    tDrift = ts * 0.09;
    tFlow = ts;

    const morphing = bridgeProgress > 0.0005;
    const front = morphFront();
    const span = 2 * BRIDGE_BAND;

    // ---- project every vertex once (world -> screen), plus morph amount
    for(let i = 0; i <= rows; i++){
      // scaleForRow() tapers Y to land exactly on horizonY so the grid
      // reaches the top edge; width comes from widthFracAt()
      // independently — see both functions' own comments
      const nz = i / rows;
      const scale = scaleForRow(i);
      const halfW = (W / 2) * CONFIG.roadWidthFrac * widthFracAt(nz);
      rowSx[i] = (2 * halfW) / cols;
      const wf = halfW / (W / 2);
      for(let j = 0; j <= cols; j++){
        const k = i * C1 + j;
        const nx = (j / cols - 0.5) * 2;
        vx[k] = W / 2 + nx * halfW;
        // ball + terrain are evaluated in screen-normalized x so widening
        // the grid past the viewport doesn't stretch the landscape
        vy[k] = horizonY + (camHeight - heightAt(nx * wf, nz, ts)) * scale;
        // per-vertex jitter on the front's position makes it an organic,
        // ragged edge rather than a ruler-straight line across the grid
        vm[k] = morphing ? smooth01((nz - (front - BRIDGE_BAND)) / span + (hA[k] - 0.5) * 0.5) : 0;
      }
    }
    // ---- where each vertex sits once morphed off the lattice
    if(morphing){
      for(let i = 0; i <= rows; i++){
        const sx = rowSx[i];
        for(let j = 0; j <= cols; j++){
          const k = i * C1 + j;
          const m = vm[k];
          if(m <= 0){ px[k] = vx[k]; py[k] = vy[k]; continue; }
          const sy = i > 0 ? Math.abs(vy[k] - vy[k - C1]) : sx * 2;
          const reach = Math.min(Math.max(sy, sx * 0.6), sx * 3) * 0.85;
          px[k] = vx[k] + ((hB[k] - 0.5) * 2 * sx * 0.85 + Math.sin(t * 0.5 + hC[k] * 6.283) * 1.6) * m;
          py[k] = vy[k] + ((hC[k] - 0.5) * 2 * reach + Math.cos(t * 0.45 + hB[k] * 6.283) * 1.6) * m;
        }
      }
    }

    // ---- solid-looking terrain: far -> near, each strip first paints
    // over whatever it hides (hidden-line removal), then draws its own
    // grid lines. Lines fade out as their vertices morph into nodes.
    for(let i = rows; i >= 0; i--){
      const base = i * C1;
      const nb = (i - 1) * C1;

      if(i >= 1){
        let stripMin = 1;
        for(let j = 0; j <= cols; j++){
          const m = vm[base + j], m2 = vm[nb + j];
          if(m < stripMin) stripMin = m;
          if(m2 < stripMin) stripMin = m2;
        }
        if(stripMin < 0.985){
          ctx.beginPath();
          ctx.moveTo(vx[base], vy[base]);
          for(let j = 1; j <= cols; j++) ctx.lineTo(vx[base + j], vy[base + j]);
          for(let j = cols; j >= 0; j--) ctx.lineTo(vx[nb + j], vy[nb + j]);
          ctx.closePath();
          ctx.fillStyle = PAPER;
          ctx.fill();
        }
      }

      // depth line (this row); rows inside the morph front are brightened
      // so the sweep reads as a travelling crest
      const glow = morphing ? bridgeHighlight(i / rows, front) : 0;
      const aRow = alphaCache[i] + glow * 0.45;
      for(let j = 0; j < cols; j++){
        const a = aRow * (1 - (vm[base + j] + vm[base + j + 1]) * 0.5);
        const q = qa(a);
        if(!(q >= 1)) continue; // also skips NaN (e.g. mid-resize)
        const arr = stripBuckets[q];
        arr.push(vx[base + j], vy[base + j], vx[base + j + 1], vy[base + j + 1]);
      }
      // cross lines between this row and the next one nearer the viewer
      if(i >= 1){
        const aCol = alphaCache[i] * 0.7;
        for(let j = 0; j <= cols; j++){
          const a = aCol * (1 - (vm[nb + j] + vm[base + j]) * 0.5);
          const q = qa(a);
          if(!(q >= 1)) continue; // also skips NaN (e.g. mid-resize)
          stripBuckets[q].push(vx[nb + j], vy[nb + j], vx[base + j], vy[base + j]);
        }
      }
      flushSegs(stripBuckets);
    }

    if(!morphing) return;

    // ---- constellation layer: surviving nodes + short links, drawn
    // after (on top of) the terrain, same style as live-demo-network.js
    const keep = (k) => hD[k] < 1 - (1 - KEEP_AT_FULL_MORPH) * vm[k];
    for(let i = 0; i <= rows; i++){
      const sx = rowSx[i];
      const linkMax = sx * 3.6 + 8;
      const r = 0.9 + 0.6 * (1 - i / rows);
      for(let j = 0; j <= cols; j++){
        const k = i * C1 + j;
        if(vm[k] < 0.02 || !keep(k)) continue;
        const qd = qa(0.85 * vm[k]);
        if(qd >= 1) dotBuckets[qd].push(px[k], py[k], r);
        for(let s = 0; s < LINK_STENCIL.length; s++){
          const ni = i + LINK_STENCIL[s][0], nj = j + LINK_STENCIL[s][1];
          if(ni > rows || nj < 0 || nj > cols) continue;
          const n = ni * C1 + nj;
          if(vm[n] < 0.02 || !keep(n)) continue;
          const dx = px[k] - px[n], dy = py[k] - py[n];
          const d = Math.sqrt(dx * dx + dy * dy);
          if(d > linkMax) continue;
          const q = qa((1 - d / linkMax) * 0.5 * Math.min(vm[k], vm[n]));
          if(!(q >= 1)) continue; // also skips NaN (e.g. mid-resize)
          linkBuckets[q].push(px[k], py[k], px[n], py[n]);
        }
      }
    }
    flushSegs(linkBuckets);
    flushDots(dotBuckets);
  }

  // public hook for js/scroll-journey-hero.js — see the BRIDGE WAVE
  // comment above bridgeHighlight() for the full story
  window.PapiHeroGrid = {
    setBridgeProgress(p){
      bridgeTarget = Math.max(0, Math.min(1, p));
      // the drawn value eases toward this each frame (see loop()) so
      // scroll steps never show up as visible jumps; with no loop
      // running (reduced motion) there's nothing to ease, so apply it
      if(prefersReducedMotion) bridgeProgress = bridgeTarget;
      // no raf loop runs under reduced motion, so force a repaint here —
      // otherwise a later setBridgeProgress call would silently never
      // reach the canvas
      if(prefersReducedMotion) renderFrame(0);
    },
  };

  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => {
      clearTimeout(window.__papiHeroGridResizeT);
      window.__papiHeroGridResizeT = setTimeout(resize, 150);
    });
    ro.observe(canvas);
  } else {
    let lastResizeW = window.innerWidth;
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      if(Math.abs(w - lastResizeW) <= 10) return;
      lastResizeW = w;
      clearTimeout(window.__papiHeroGridResizeT);
      window.__papiHeroGridResizeT = setTimeout(resize, 150);
    });
  }

  function watchDpr(){
    if(!window.matchMedia) return;
    const d = window.devicePixelRatio || 1;
    const mq = window.matchMedia(`(resolution: ${d}dppx)`);
    const onChange = () => { resize(); watchDpr(); };
    if(mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
    else if(mq.addListener) mq.addListener(onChange);
  }

  resize();
  watchDpr();

  if(prefersReducedMotion){
    renderFrame(0);
    return;
  }

  let isHeroVisible = true;
  let rafId = null;
  let startTs = null;
  let lastTs = 0;
  // per direct report, "the animation is not smooth": this used to be
  // hard-capped at 36fps (24 on phones), so even a perfectly drawn frame
  // stream looked steppy. Now it runs at the display's own rate and only
  // backs off to ~30fps if frames are measurably expensive (slow device
  // or heavy morph), recovering again once they get cheap.
  let minInterval = window.innerWidth < 640 ? 1000 / 40 : 0;
  let costAvg = 8;
  let lastRenderTs = 0;

  function loop(ts){
    if(startTs === null) startTs = ts;
    if(ts - lastRenderTs >= minInterval - 1){
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 1 / 60;
      lastTs = ts;
      lastRenderTs = ts;
      const t = (ts - startTs) / 1000;
      // chase the cursor when it's present; otherwise wander to a fresh
      // random point every ~0.5-1.3s so there's always something to
      // find (touch devices never send a pointer)
      let targetX, targetZ;
      if(pointerActive){
        targetX = pointerNX;
        targetZ = Math.max(0.12, Math.min(0.85, pointerNZ));
      } else {
        if(t >= idleNextPickAt){
          idleTargetX = (Math.random() * 2 - 1) * 0.9;
          idleTargetZ = 0.14 + Math.random() * 0.7;
          // touch devices only ever run this idle path, so it stays gentle there
          idleNextPickAt = t + (isMobileDevice ? 1.2 : 0.7) + Math.random() * (isMobileDevice ? 1.6 : 1.0);
        }
        targetX = idleTargetX;
        targetZ = idleTargetZ;
      }
      // the ball is an UNDERDAMPED spring (damping ratio ~0.55): it
      // overshoots and settles instead of easing in a straight line,
      // which is what makes the surface feel elastic. Sub-stepped so the
      // feel doesn't change with the frame rate.
      // softer, more damped spring while nothing is steering it
      const SPRING_K = pointerActive ? 34 : 22, SPRING_C = pointerActive ? 6.4 : 5.6;
      let rem = dt;
      while(rem > 1e-6){
        const h = Math.min(rem, 1 / 120);
        ballVX += ((targetX - ballX) * SPRING_K - ballVX * SPRING_C) * h;
        ballVZ += ((targetZ - ballZ) * SPRING_K - ballVZ * SPRING_C) * h;
        ballX += ballVX * h;
        ballZ += ballVZ * h;
        rem -= h;
      }
      const speed = Math.sqrt(ballVX * ballVX + ballVZ * ballVZ);
      ballEnergy += (Math.min(1, speed * 0.45) - ballEnergy) * (1 - Math.exp(-3 * dt));
      // ease the scroll-driven morph so wheel/touch steps blend together
      const diff = bridgeTarget - bridgeProgress;
      bridgeProgress = Math.abs(diff) < 0.0004 ? bridgeTarget : bridgeProgress + diff * (1 - Math.exp(-8 * dt));

      const t0 = performance.now();
      renderFrame(t);
      costAvg += (performance.now() - t0 - costAvg) * 0.08;
      if(costAvg > 13 && minInterval < 30) minInterval = 1000 / 30;
      else if(costAvg < 6 && minInterval === 1000 / 30) minInterval = window.innerWidth < 640 ? 1000 / 40 : 0;
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){ if(rafId === null) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; } }
  function syncLoop(){ if(isHeroVisible && !document.hidden) startLoop(); else stopLoop(); }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isHeroVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0 });
    io.observe(canvas);
  }
  document.addEventListener('visibilitychange', syncLoop);
  startLoop();
})();
