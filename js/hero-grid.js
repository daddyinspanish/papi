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
    horizonFrac: 0.16,
    // per direct report, "on mobile the grid... is not connecting to
    // the very top, it looks like the grid cuts half of the screen" —
    // horizonFrac is a FRACTION of the canvas's own height, so the same
    // 0.16 that reads as a small, unnoticeable gap on a short/wide
    // desktop window becomes a much taller, more obvious empty band at
    // the top of a tall, narrow phone screen (16% of 812px is a lot
    // more dead space than 16% of 674px). Mobile gets a much smaller
    // fraction so the grid itself starts close to the true top edge.
    horizonFracMobile: 0.04,
    mobileWidth: 640,
    nearYFrac: 1.04, // the nearest row lands just past the bottom edge
    // per direct request, "make sure the grid covers the left and right
    // sides of the desktop view, not just the center" — calibrating the
    // grid's width against the NEAREST row (old behavior) only touches
    // the full canvas width right at the very bottom edge; everything
    // above it funnels inward fast, reading as a narrow center column.
    // Calibrating against a row further out instead (this fraction of
    // the way from zNear to zFar) makes THAT row span edge-to-edge, so
    // the grid still fills the sides well into the middle of the view —
    // nearer rows simply overflow past the canvas edges, harmlessly
    // clipped.
    edgeFitZFrac: 0.32,
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
  let FOCAL = 0, zNear = 0, zFar = 0, gridHalfWidth = 0, camHeight = 0, horizonY = 0, amplitude = 0;
  const rowZ = new Array(CONFIG.rows + 1);
  const colX = new Array(CONFIG.cols + 1);
  const alphaCache = new Array(CONFIG.rows + 1);

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

    const isMobile = window.innerWidth < CONFIG.mobileWidth;
    FOCAL = H * 0.9;
    zNear = FOCAL * CONFIG.nearRatio;
    zFar = zNear * CONFIG.farMultiple;
    horizonY = H * (isMobile ? CONFIG.horizonFracMobile : CONFIG.horizonFrac);
    amplitude = H * CONFIG.amplitudeFrac;

    // the nearest row's flat (height 0) point should land at nearYFrac*H;
    // solving screenY = horizonY + camHeight * (FOCAL/zNear) for camHeight
    const scaleNear = FOCAL / zNear;
    camHeight = (H * CONFIG.nearYFrac - horizonY) / scaleNear;
    // see edgeFitZFrac's own comment above — width is fit to a row partway
    // out, not the nearest row, so the grid still fills the sides well
    // past the very bottom edge
    const zEdgeFit = zNear + CONFIG.edgeFitZFrac * (zFar - zNear);
    const scaleEdgeFit = FOCAL / zEdgeFit;
    gridHalfWidth = (W / 2) / scaleEdgeFit;

    for(let i = 0; i <= CONFIG.rows; i++){
      const t = i / CONFIG.rows;
      rowZ[i] = zNear + t * (zFar - zNear);
      alphaCache[i] = CONFIG.alphaNear + (CONFIG.alphaFar - CONFIG.alphaNear) * t;
    }
    for(let j = 0; j <= CONFIG.cols; j++){
      colX[j] = (j / CONFIG.cols - 0.5) * 2 * gridHalfWidth;
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

  const heroSection = canvas.closest('.process-hero');
  if(!prefersReducedMotion && heroSection){
    const updatePointer = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      // find the row whose flat screenY is closest to the pointer, then
      // invert that row's known perspective scale to recover world x
      let bestI = 0, bestDist = Infinity;
      for(let i = 0; i <= CONFIG.rows; i++){
        const scale = FOCAL / rowZ[i];
        const sy = horizonY + camHeight * scale;
        const d = Math.abs(sy - py);
        if(d < bestDist){ bestDist = d; bestI = i; }
      }
      const scale = FOCAL / rowZ[bestI];
      const worldX = (px - W / 2) / scale;
      pointerNX = Math.max(-1, Math.min(1, worldX / gridHalfWidth));
      pointerNZ = bestI / CONFIG.rows;
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

    // faint ambient ripple texture only — kept deliberately subtle so
    // the ball itself stays the clear, dominant feature. sin(nz*pi) is
    // 0 at both nz=0 and nz=1 and peaks at nz=0.5, fading the ripple
    // out at the near/far edges for the same compressed-horizon reason
    // as the ball's own z falloff above.
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
      const z = rowZ[i];
      const scale = FOCAL / z;
      const nz = i / CONFIG.rows;
      const row = new Array(CONFIG.cols + 1);
      for(let j = 0; j <= CONFIG.cols; j++){
        const nx = colX[j] / gridHalfWidth;
        const h = heightAt(nx, nz, t);
        row[j] = [
          W / 2 + colX[j] * scale,
          horizonY + (camHeight - h) * scale,
        ];
      }
      pts[i] = row;
    }

    // depth lines (constant z, varying x) — drawn far-to-near so nearer,
    // bolder lines paint over the tail ends of farther ones
    for(let i = CONFIG.rows; i >= 0; i--){
      const row = pts[i];
      ctx.strokeStyle = `rgba(${LINE_RGB},${alphaCache[i].toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(row[0][0], row[0][1]);
      for(let j = 1; j <= CONFIG.cols; j++) ctx.lineTo(row[j][0], row[j][1]);
      ctx.stroke();
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
  }

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
        targetX = Math.sin(t * 0.12) * 0.5;
        targetZ = 0.42 + Math.cos(t * 0.09) * 0.18;
      }
      ballX += (targetX - ballX) * 0.08;
      ballZ += (targetZ - ballZ) * 0.08;
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
