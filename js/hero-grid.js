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
    cols: 46,
    rows: 32,
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
    nearYFrac: 1.04, // the nearest row lands just past the bottom edge
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
    roadMinWidthFrac: 0.22,
    // wave amplitude as a fraction of canvas height
    amplitudeFrac: 0.085,
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
  let FOCAL = 0, zNear = 0, zFar = 0, camHeight = 0, horizonY = 0, amplitude = 0;
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
    return 1 - t * (1 - CONFIG.roadMinWidthFrac);
  }

  // ===================================================================
  // BRIDGE WAVE — per direct request: "as I scroll to the next section,
  // the grid makes a wave that flows down to the end of the grid and
  // connects to those dots in the next section." js/scroll-journey-
  // hero.js drives bridgeProgress (0-1) from the tail end of its own
  // existing pin-scrub (the same scroll range that already dissolves the
  // title into the matrix glitch), via window.PapiHeroGrid.setBridge
  // Progress() below. 0 = the plain grid; 1 = a bright crest has swept
  // all the way from the horizon down to the near row, which now renders
  // as a field of small glowing dots — same exact brand color (LINE_RGB)
  // as js/live-demo-network.js's own plexus nodes just below this
  // section — so the handoff into #liveDemoSection reads as one
  // continuous network meeting at the seam, not two unrelated canvases.
  // Driven purely by a scrubbed progress value (no internal timer), same
  // "everything derived from scroll position" convention as every other
  // effect in this file, so scrolling back up reverses it cleanly too.
  // ===================================================================
  let bridgeProgress = 0;
  const BRIDGE_BAND = 0.16; // how many rows (as a fraction of the grid) the bright crest spans
  // BUG FIX, found via direct inspection before this ever shipped: row 0
  // (nz=0) is deliberately parked just PAST the bottom edge (see
  // nearYFrac's own comment above — "the nearest row lands just past the
  // bottom edge"), so it only actually turns visible when the cursor-ball
  // happens to bulge it into frame. A crest/dot handoff anchored there
  // would mostly render off-canvas. Row 1 (nz = 1/rows) is the nearest
  // row that's reliably on-screen at ~94% down the canvas regardless of
  // the ball's position, so the wave's front targets that row instead of
  // a literal 0.
  const NEAR_ROW = 1;
  const NEAR_NZ = NEAR_ROW / CONFIG.rows;
  function bridgeHighlight(nz){
    if(bridgeProgress <= 0) return 0;
    // the crest travels from the horizon (nz=1) down to NEAR_NZ as
    // bridgeProgress goes 0 -> 1
    const front = 1 - bridgeProgress * (1 - NEAR_NZ);
    const d = Math.abs(nz - front) / BRIDGE_BAND;
    return Math.max(0, 1 - d);
  }

  function resize(){
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      const screenHalfWidth = (W / 2) * CONFIG.roadWidthFrac * widthFracAt(nzBest);
      pointerNX = Math.max(-1, Math.min(1, (px - W / 2) / screenHalfWidth));
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
  let ballX = 0.12, ballZ = 0.42;
  // random-waypoint idle wander state — see its own BUG FIX comment in
  // loop() below
  let idleTargetX = 0.12, idleTargetZ = 0.42, idleNextPickAt = 0;

  // nx: -1..1 across the grid's width. nz: 0..1 from near to far.
  function heightAt(nx, nz, t){
    const dx = nx - ballX;
    const dz = nz - ballZ;
    // tight, roughly-equal falloff in both axes — a round "ball" rather
    // than the elongated ridge a wide x/narrow z falloff would produce.
    // z stays slightly tighter than x since rows near the far edge are
    // already heavily compressed toward the horizon by perspective, so
    // even a small residual height there reads as a dramatic-looking
    // spike.
    const ball = Math.exp(-(dx * dx) / 0.16 - (dz * dz) / 0.05);

    // REVERTED per direct follow-up report, "the waves are too much now,
    // its only suppose to make a wave when scrolling into the next
    // section" — a continuous ball-centered radiating wave was tried
    // here, but the wave effect is only meant to happen during the
    // scroll-triggered handoff into #liveDemoSection (see the BRIDGE
    // WAVE block above, driven by bridgeProgress), not as a permanent
    // idle/ambient effect. Back to the original faint ambient ripple
    // texture — kept deliberately subtle so the ball itself stays the
    // clear, dominant feature. sin(nz*pi) is 0 at both nz=0 and nz=1 and
    // peaks at nz=0.5, fading the ripple out at the near/far edges for
    // the same compressed-horizon reason as the ball's own z falloff
    // above.
    const zTaper = Math.sin(Math.min(Math.max(nz, 0), 1) * Math.PI);
    const ripple = (
      Math.sin(nx * 2.4 + nz * 1.6 + t * 0.3) * 0.5 +
      Math.sin(nx * 1.1 - nz * 2.8 - t * 0.24) * 0.4 +
      Math.sin((nx * 0.7 + nz * 1.3) * 3.1 + t * 0.2) * 0.3
    ) * zTaper * 0.22;

    return (ball * 1.1 + ripple) * amplitude;
  }

  function renderFrame(t){
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = CONFIG.lineWidth;

    // precompute every vertex's projected position + height once, then
    // stroke rows and columns from the same cached grid — far cheaper
    // than re-deriving height/projection twice per vertex
    const pts = new Array(CONFIG.rows + 1);
    for(let i = 0; i <= CONFIG.rows; i++){
      // BUG FIX: per report, "the grid... is not connecting to the very
      // top" — persisted even with horizonFrac set to 0, because the
      // perspective divide only ASYMPTOTICALLY approaches the horizon as
      // z grows; with a finite farMultiple the farthest drawn row still
      // lands well short of horizonY (confirmed directly: the residual
      // gap is camHeight*scale_far, which doesn't go to zero just because
      // horizonY does). scaleForRow() (defined above) tapers scale itself
      // to exactly 0 over the last 12% of rows, so Y lands exactly on
      // horizonY regardless of farMultiple — smoothstepped, not a hard
      // cutoff on the last row alone, so it reads as a continuation of
      // the existing convergence rather than a visible kink. Width (X)
      // no longer rides along with this scale at all — see
      // screenHalfWidth/widthFracAt() just below.
      const nz = i / CONFIG.rows;
      const scale = scaleForRow(i);
      // see widthFracAt()'s own comment — the road's width at this row,
      // in actual screen pixels, computed independently of `scale` above
      const screenHalfWidth = (W / 2) * CONFIG.roadWidthFrac * widthFracAt(nz);
      const row = new Array(CONFIG.cols + 1);
      for(let j = 0; j <= CONFIG.cols; j++){
        const nx = (j / CONFIG.cols - 0.5) * 2;
        const h = heightAt(nx, nz, t);
        row[j] = [
          W / 2 + nx * screenHalfWidth,
          horizonY + (camHeight - h) * scale,
        ];
      }
      pts[i] = row;
    }

    // depth lines (constant z, varying x) — drawn far-to-near so nearer,
    // bolder lines paint over the tail ends of farther ones. Rows caught
    // in the bridge wave's crest (see bridgeHighlight() above) get a
    // brightened alpha + soft glow on top of their normal fade, so the
    // wave reads as a bright band sweeping down through the grid.
    for(let i = CONFIG.rows; i >= 0; i--){
      const row = pts[i];
      const glow = bridgeHighlight(i / CONFIG.rows);
      if(glow > 0){
        ctx.shadowColor = `rgba(${LINE_RGB},${glow.toFixed(3)})`;
        ctx.shadowBlur = 10 * glow;
      }
      ctx.strokeStyle = `rgba(${LINE_RGB},${Math.min(1, alphaCache[i] + glow * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(row[0][0], row[0][1]);
      for(let j = 1; j <= CONFIG.cols; j++) ctx.lineTo(row[j][0], row[j][1]);
      ctx.stroke();
      if(glow > 0) ctx.shadowBlur = 0;
    }

    // cross lines (constant x, varying z) — faded with the same
    // near/far alpha curve as the depth lines, sampled at each line's
    // own nearest (bottom-most, i.e. nearest-camera) visible point
    for(let j = 0; j <= CONFIG.cols; j++){
      ctx.strokeStyle = `rgba(${LINE_RGB},${(CONFIG.alphaNear * 0.7).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][j][0], pts[0][j][1]);
      for(let i = 1; i <= CONFIG.rows; i++){
        ctx.strokeStyle = `rgba(${LINE_RGB},${(alphaCache[i] * 0.7).toFixed(3)})`;
        ctx.lineTo(pts[i][j][0], pts[i][j][1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pts[i][j][0], pts[i][j][1]);
      }
    }

    // the actual handoff: as the crest above arrives at NEAR_ROW
    // (bridgeProgress -> 1), that row's own line fades up into a row of
    // small glowing nodes — every other column, matching js/live-demo-
    // network.js's own node radius/spacing/color exactly, not just a
    // thematically-similar effect, so the dots feel like the SAME field
    // continuing into the next section rather than a lookalike
    const nearGlow = bridgeHighlight(NEAR_NZ);
    if(nearGlow > 0.01){
      const nearRow = pts[NEAR_ROW];
      ctx.fillStyle = `rgba(${LINE_RGB},${(nearGlow * 0.9).toFixed(3)})`;
      ctx.shadowColor = `rgba(${LINE_RGB},${(nearGlow * 0.8).toFixed(3)})`;
      ctx.shadowBlur = 8 * nearGlow;
      for(let j = 0; j <= CONFIG.cols; j += 2){
        ctx.beginPath();
        ctx.arc(nearRow[j][0], nearRow[j][1], 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  // public hook for js/scroll-journey-hero.js — see the BRIDGE WAVE
  // comment above bridgeHighlight() for the full story
  window.PapiHeroGrid = {
    setBridgeProgress(p){
      bridgeProgress = Math.max(0, Math.min(1, p));
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
  const RENDER_INTERVAL = 1000 / (window.innerWidth < 640 ? 24 : 36);
  let lastRenderTs = 0;

  function loop(ts){
    if(startTs === null) startTs = ts;
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      lastRenderTs = ts;
      const t = (ts - startTs) / 1000;
      // chase the cursor when it's present; otherwise drift slowly on
      // its own so there's always something to find, not a dead-center
      // ball waiting for a pointer that touch devices never send
      let targetX, targetZ;
      if(pointerActive){
        targetX = pointerNX;
        targetZ = Math.max(0.12, Math.min(0.85, pointerNZ));
      } else {
        // BUG FIX: per direct report, "I would like the ball to also
        // move more randomly around the space faster" — the old idle
        // drift was two plain sine/cosine waves (a full side-to-side
        // cycle took ~52s), so it read as a slow, perfectly predictable
        // ellipse rather than something alive. This instead picks a
        // fresh random point to wander toward every ~0.7-1.8s — the same
        // "chase a target" smoothing already used for the cursor above,
        // just with the target itself jumping around unpredictably
        // instead of sliding along a fixed curve — so the path between
        // points still reads as a smooth, organic arc (no noise
        // function needed), not a jittery teleport.
        if(t >= idleNextPickAt){
          idleTargetX = (Math.random() * 2 - 1) * 0.85;
          idleTargetZ = 0.15 + Math.random() * 0.67;
          idleNextPickAt = t + 0.7 + Math.random() * 1.1;
        }
        targetX = idleTargetX;
        targetZ = idleTargetZ;
      }
      // raised from 0.08 — per the same "faster" request, the ball now
      // closes the gap to wherever it's chasing (cursor or idle target)
      // noticeably quicker each frame
      ballX += (targetX - ballX) * 0.11;
      ballZ += (targetZ - ballZ) * 0.11;
      renderFrame(t);
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
