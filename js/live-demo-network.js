/* ===================================================================
   Papi — Live Demo network background
   Per direct request, "I would like the background to have more of a
   background go from white to a more filled green... where there are
   lines connecting to dots... so it can have more of a web feel" — a
   classic plexus/constellation canvas: a field of slowly-drifting
   points, connected by lines whenever two of them are close enough,
   fading with distance. Pairs with #liveDemoSection's own CSS
   background gradient (white at the top, brand emerald by the bottom)
   — node/line color is interpolated vertically too (dark emerald near
   the top, pale mint near the bottom) so the network stays visible
   against whichever part of that gradient it's drawn over.

   Plain 2D canvas, same resize/DPR/pause-off-screen conventions as
   every other background canvas on this site (js/hero-grid.js).
=================================================================== */
(function(){
  const canvas = document.getElementById('liveDemoNetwork');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  const section = canvas.closest('.live-demo-section');
  if(!section) return;

  const CONFIG = {
    // particles per 1000x1000px of canvas area, capped below — keeps
    // density sane across very tall/short or narrow/wide sections.
    // Raised per direct request, "make the moving connect lines with
    // dots more close together, like if they were connected throughout
    // the background" — denser field + a touch shorter link distance
    // reads as one continuous mesh rather than scattered pairs.
    densityPer1e6: 140,
    minCount: 40,
    maxCount: 220,
    linkDistance: 135,
    speed: 0.12,
    nodeRadius: 1.4,
  };

  const DARK_RGB = [4, 120, 87];   // matches --gold-deep, for the white/light top
  // per direct follow-up request, "make the background color of the
  // connecting dots a bit more darker" — this used to fade all the way
  // to a pale, near-white mint toward the bottom; darkened to a deep
  // green instead so the whole network reads as deliberately dark
  // rather than washing out against the section's own saturated-green
  // backdrop down there.
  const LIGHT_RGB = [10, 70, 52];

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let points = [];
  const ALPHA_LEVELS = 12;
  const COLOR_BANDS = 4;
  const linkBuckets = Array.from({ length: (ALPHA_LEVELS * 2 + 1) * COLOR_BANDS }, () => []);

  function lerp(a, b, t){ return a + (b - a) * t; }
  function colorAt(ny){
    const t = Math.max(0, Math.min(1, ny));
    const r = lerp(DARK_RGB[0], LIGHT_RGB[0], t);
    const g = lerp(DARK_RGB[1], LIGHT_RGB[1], t);
    const b = lerp(DARK_RGB[2], LIGHT_RGB[2], t);
    return [r, g, b];
  }

  function buildPoints(){
    const area = W * H;
    const count = Math.max(CONFIG.minCount, Math.min(CONFIG.maxCount, Math.round((area / 1e6) * CONFIG.densityPer1e6)));
    points = new Array(count).fill(0).map(() => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() * 2 - 1) * CONFIG.speed,
      vy: (Math.random() * 2 - 1) * CONFIG.speed,
    }));
  }

  function resize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w;
    H = h;
    buildPoints();
  }

  function renderFrame(steps){
    ctx.clearRect(0, 0, W, H);

    points.forEach((p) => {
      p.x += p.vx * steps;
      p.y += p.vy * steps;
      // wrap at the edges rather than bounce — keeps the field reading
      // as a continuous, undirected drift instead of visibly "bumping"
      if(p.x < -10) p.x = W + 10; else if(p.x > W + 10) p.x = -10;
      if(p.y < -10) p.y = H + 10; else if(p.y > H + 10) p.y = -10;
    });

    // links are grouped into a fixed set of (alpha level x vertical
    // color band) buckets and each bucket is drawn as ONE path/stroke,
    // instead of one stroke (with its own color string) per pair — that
    // per-pair cost was a real part of why scrolling from the hero into
    // this section felt choppy, since both canvases animate at once there
    const linkDist2 = CONFIG.linkDistance * CONFIG.linkDistance;
    for(let i = 0; i < points.length; i++){
      const a = points[i];
      for(let j = i + 1; j < points.length; j++){
        const b = points[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if(d2 > linkDist2) continue;
        const d = Math.sqrt(d2);
        const alpha = (1 - d / CONFIG.linkDistance) * 0.5;
        if(alpha < 0.01) continue;
        const aq = Math.max(1, Math.round(alpha * 2 * ALPHA_LEVELS));
        let band = (((a.y + b.y) / 2) / H * COLOR_BANDS) | 0;
        band = band < 0 ? 0 : band >= COLOR_BANDS ? COLOR_BANDS - 1 : band;
        linkBuckets[aq * COLOR_BANDS + band].push(a.x, a.y, b.x, b.y);
      }
    }
    for(let q = 0; q < linkBuckets.length; q++){
      const arr = linkBuckets[q];
      if(!arr.length) continue;
      const aq = (q / COLOR_BANDS) | 0, band = q % COLOR_BANDS;
      const [r, g, bl] = colorAt((band + 0.5) / COLOR_BANDS);
      ctx.strokeStyle = `rgba(${r.toFixed(0)},${g.toFixed(0)},${bl.toFixed(0)},${(aq / (2 * ALPHA_LEVELS)).toFixed(3)})`;
      ctx.beginPath();
      for(let k = 0; k < arr.length; k += 4){
        ctx.moveTo(arr[k], arr[k + 1]);
        ctx.lineTo(arr[k + 2], arr[k + 3]);
      }
      ctx.stroke();
      arr.length = 0;
    }

    points.forEach((p) => {
      const [r, g, b] = colorAt(p.y / H);
      ctx.fillStyle = `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},0.85)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONFIG.nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // BUG FIX: per direct report, "when I leave section 2 and the live
  // demo disappears the connected dot lines seem to change order" —
  // ResizeObserver fired resize() -> buildPoints() on ANY size change at
  // all, including the sub-pixel/few-px reflows a mobile browser's own
  // address bar causes just from scrolling (no real resize happened).
  // buildPoints() throws every point away and re-randomizes the whole
  // field from scratch, so scrolling straight past this section could
  // make the dots instantly jump to a brand new layout. The legacy
  // window-resize fallback just below already guarded against exactly
  // this with a 10px threshold; the primary ResizeObserver path (what
  // every modern browser actually uses) never had the same guard. Both
  // paths now share one threshold check, so only a genuine size change
  // rebuilds the field.
  let lastResizeW = 0, lastResizeH = 0;
  function handleResize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(Math.abs(w - lastResizeW) <= 10 && Math.abs(h - lastResizeH) <= 10) return;
    lastResizeW = w;
    lastResizeH = h;
    resize();
  }

  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => {
      clearTimeout(window.__papiLiveDemoNetResizeT);
      window.__papiLiveDemoNetResizeT = setTimeout(handleResize, 150);
    });
    ro.observe(section);
  } else {
    window.addEventListener('resize', () => {
      clearTimeout(window.__papiLiveDemoNetResizeT);
      window.__papiLiveDemoNetResizeT = setTimeout(handleResize, 150);
    });
  }

  handleResize();

  if(prefersReducedMotion){
    renderFrame(0);
    return;
  }

  let isVisible = true;
  let rafId = null;
  const REFERENCE_FRAME_MS = 1000 / 60;
  const MAX_STEPS = 4;
  const RENDER_INTERVAL = 1000 / (window.innerWidth < 640 ? 24 : 36);
  let lastRenderTs = 0;

  function loop(ts){
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      const dt = lastRenderTs ? ts - lastRenderTs : REFERENCE_FRAME_MS;
      lastRenderTs = ts;
      const steps = Math.min(dt / REFERENCE_FRAME_MS, MAX_STEPS);
      renderFrame(steps);
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){ if(rafId === null) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; } }
  // js/scroll-journey-livedemo.js pauses this once the next section has
  // slid up over the demo (the network is hidden behind it by then)
  let externallyPaused = false;
  function syncLoop(){ if(isVisible && !document.hidden && !externallyPaused) startLoop(); else stopLoop(); }
  window.PapiLiveDemoNet = {
    setPaused(v){
      v = !!v;
      if(v === externallyPaused) return;
      externallyPaused = v;
      syncLoop();
    },
  };

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0 });
    io.observe(canvas);
  }
  document.addEventListener('visibilitychange', syncLoop);
  startLoop();
})();
