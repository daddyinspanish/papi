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

    FOCAL = H * 0.9;
    zNear = FOCAL * CONFIG.nearRatio;
    zFar = zNear * CONFIG.farMultiple;
    horizonY = H * CONFIG.horizonFrac;
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
  // pointer interaction — the cursor presses a soft bump into the
  // surface, same "ambient but responsive" spirit as the old matrix
  // rain's cursor-repulsion field. nx/nz below are the cursor's
  // approximate position in the SAME normalized grid space heightAt()
  // works in, found by inverting the projection for the nearest row
  // (see pointermove) rather than a full analytic unproject.
  // ===================================================================
  let pointerActive = false;
  let pointerNX = 0, pointerNZ = 0.4;
  let pointerLift = 0; // smoothed 0..1, eases the bump in/out

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

  // nx: -1..1 across the grid's width. nz: 0..1 from near to far.
  //
  // Two layers, not one coupled formula — an earlier version multiplied
  // a symmetric cosine envelope by a few sine terms and it read as a
  // rigid, perfectly-centered pyramid instead of an organic dune: the
  // envelope dominated the silhouette and the sines barely varied it
  // across x. Separating "one broad hill, off-center and drifting" from
  // "a layer of small ambient ripple texture" and adding them (not
  // multiplying) matches the reference image's look much more closely.
  function heightAt(nx, nz, t){
    const hillX = 0.12 + Math.sin(t * 0.05) * 0.22;
    const hillZ = 0.44 + Math.cos(t * 0.04) * 0.1;
    const dx = nx - hillX;
    const dz = nz - hillZ;
    // z falloff is deliberately much tighter than the x falloff: rows
    // near the far edge are already heavily compressed toward the
    // horizon by perspective, so even a small residual height there
    // reads as a dramatic-looking spike. Fading the hill fully to ~0
    // well before nz=1 keeps that compressed band calm.
    const hill = Math.exp(-(dx * dx) / 0.9 - (dz * dz) / 0.045);

    // sin(nz*pi) is 0 at BOTH nz=0 and nz=1 and peaks at nz=0.5 — using
    // it as a multiplier (not an offset added to a flat base) ensures
    // the ripple texture also fades out completely at the near and far
    // edges, for the same compressed-horizon reason as above.
    const zTaper = Math.sin(Math.min(Math.max(nz, 0), 1) * Math.PI);
    const ripple = (
      Math.sin(nx * 2.4 + nz * 1.6 + t * 0.3) * 0.5 +
      Math.sin(nx * 1.1 - nz * 2.8 - t * 0.24) * 0.4 +
      Math.sin((nx * 0.7 + nz * 1.3) * 3.1 + t * 0.2) * 0.3
    ) * zTaper * 0.5;

    let h = hill * 0.9 + ripple;

    if(pointerLift > 0.001){
      const pdx = nx - pointerNX;
      const pdz = nz - pointerNZ;
      const d2 = pdx * pdx + pdz * pdz;
      h += Math.exp(-d2 / 0.05) * 1.1 * pointerLift;
    }
    return h * amplitude;
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
      // ease the pointer bump in/out rather than snapping, so it reads
      // as pressing into a soft surface instead of a hard toggle
      const target = pointerActive ? 1 : 0;
      pointerLift += (target - pointerLift) * 0.12;
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
