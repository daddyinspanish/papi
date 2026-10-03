/* ===================================================================
   Papi — flowing contour background for the "How It's Built" section
   Per direct request: take the look of a field of smooth, flowing
   ribbon lines (stacked waves that bunch together and spread apart as
   they drift) and build it out of connected dots, the same dot-and-link
   language as js/live-demo-network.js and the hero grid's morph.

   How it works: a lattice of dots laid out in horizontal LINES. Every
   dot is displaced by one smooth flow field (a few low-frequency sines
   whose phase is itself bent by two slower sines — a domain warp),
   mostly vertically. Because the displacement varies with y as well as
   x, neighbouring lines squeeze together in some places and fan out in
   others — that bunching is what draws the contour-ribbon look. Dots on
   a line are joined to their neighbours; where two lines are squeezed
   close, short cross-links appear between them and the dots grow
   brighter, so the dense bands read as a connected web while the wide
   bands stay as quiet single lines.

   Plain 2D canvas with batched strokes (alpha levels x 2 colours, one
   path per bucket), paused off-screen / in a hidden tab, frame-paced
   like the other background canvases on this site.
=================================================================== */
(function(){
  const canvas = document.getElementById('processFlow');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  const section = canvas.closest('.our-process-section');
  if(!section) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.innerWidth < 640;

  const COLORS = ['4,120,87', '16,185,129']; // brand emerald, bright accent line
  const ALPHA_LEVELS = 14;
  const AMP = 80;              // px of vertical flow displacement
  const AMP_X = 12;            // px of sideways drift of the dots
  const FLOW_SPEED = 1;        // overall speed multiplier

  let W = 0, H = 0, dpr = 1;
  let rows = 0, cols = 0, lineGap = 34, dotGap = 30;
  let bx, by;                  // base lattice
  let X, Y, C;                 // displaced position + squeeze per dot
  const segBuckets = Array.from({ length: COLORS.length * (ALPHA_LEVELS + 1) }, () => []);
  const dotBuckets = Array.from({ length: COLORS.length * (ALPHA_LEVELS + 1) }, () => []);

  function build(){
    lineGap = isPhone() ? 32 : 36;
    dotGap = isPhone() ? 30 : 32;
    rows = Math.ceil(H / lineGap) + 6;
    cols = Math.ceil(W / dotGap) + 3;
    const n = rows * cols;
    bx = new Float32Array(n); by = new Float32Array(n);
    X = new Float32Array(n); Y = new Float32Array(n); C = new Float32Array(n);
    for(let i = 0; i < rows; i++){
      for(let j = 0; j < cols; j++){
        const k = i * cols + j;
        bx[k] = (j - 1) * dotGap;
        by[k] = (i - 3) * lineGap;
      }
    }
  }

  function resize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(!w || !h) return;
    // lines this thin and faint look identical at 1x-1.5x
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    build();
    if(prefersReducedMotion) draw(0);
  }

  // one smooth phase field drives both axes
  function phase(x, y, t){
    const u = x * 0.0046, v = y * 0.0036;
    const w1 = Math.sin(u * 1.1 + v * 0.8 + t * 0.33);
    const w2 = Math.sin(v * 1.7 - u * 0.6 - t * 0.26 + 1.3);
    return u * 1.4 + v * 0.9 + 1.6 * w1 + 1.1 * w2 + t * 0.42;
  }

  const q = (a) => Math.max(0, Math.min(ALPHA_LEVELS, Math.round(a * ALPHA_LEVELS)));

  function draw(t){
    ctx.clearRect(0, 0, W, H);
    const n = rows * cols;
    for(let k = 0; k < n; k++){
      const ph = phase(bx[k], by[k], t);
      Y[k] = by[k] + AMP * Math.sin(ph);
      X[k] = bx[k] + AMP_X * Math.sin(ph * 0.8 + 2.0);
    }
    // how squeezed each dot's line is against the line above it
    for(let i = 0; i < rows; i++){
      for(let j = 0; j < cols; j++){
        const k = i * cols + j;
        const ref = i > 0 ? k - cols : k + cols;
        const gap = Math.abs(Y[k] - Y[ref]);
        const sq = 1 - gap / lineGap;           // >0 squeezed, <0 spread out
        C[k] = sq <= 0 ? 0 : Math.min(1, sq / 0.7);
      }
    }

    for(let i = 0; i < rows; i++){
      const col = (i % 5 === 0) ? 1 : 0;
      const base = col * (ALPHA_LEVELS + 1);
      for(let j = 0; j < cols; j++){
        const k = i * cols + j;
        const x0 = X[k], y0 = Y[k];
        if(x0 < -20 || x0 > W + 20) continue;
        if(y0 < -AMP - 20 || y0 > H + AMP + 20) continue;
        const c = C[k];
        // line to the next dot on this line
        if(j + 1 < cols){
          const k2 = k + 1;
          const a = 0.15 + 0.34 * Math.max(c, C[k2]) + (col ? 0.07 : 0);
          segBuckets[base + q(a)].push(x0, y0, X[k2], Y[k2]);
        }
        // cross-links to the line below, only where the two are squeezed together
        if(i + 1 < rows){
          const kb = k + cols;
          const cc = Math.min(c, C[kb]);
          if(cc > 0.18){
            segBuckets[base + q(cc * 0.42)].push(x0, y0, X[kb], Y[kb]);
            if(j + 1 < cols && cc > 0.5) segBuckets[base + q(cc * 0.28)].push(x0, y0, X[kb + 1], Y[kb + 1]);
          }
        }
        dotBuckets[base + q(0.3 + 0.55 * c)].push(x0, y0, 1.05 + 0.65 * c);
      }
    }

    ctx.lineWidth = 1;
    for(let b = 0; b < segBuckets.length; b++){
      const arr = segBuckets[b];
      if(!arr.length) continue;
      const colorIdx = (b / (ALPHA_LEVELS + 1)) | 0;
      const lvl = b % (ALPHA_LEVELS + 1);
      if(lvl >= 1){
        ctx.strokeStyle = `rgba(${COLORS[colorIdx]},${(lvl / ALPHA_LEVELS * 0.85).toFixed(3)})`;
        ctx.beginPath();
        for(let k = 0; k < arr.length; k += 4){
          ctx.moveTo(arr[k], arr[k + 1]);
          ctx.lineTo(arr[k + 2], arr[k + 3]);
        }
        ctx.stroke();
      }
      arr.length = 0;
    }
    for(let b = 0; b < dotBuckets.length; b++){
      const arr = dotBuckets[b];
      if(!arr.length) continue;
      const colorIdx = (b / (ALPHA_LEVELS + 1)) | 0;
      const lvl = b % (ALPHA_LEVELS + 1);
      if(lvl >= 1){
        ctx.fillStyle = `rgba(${COLORS[colorIdx]},${(lvl / ALPHA_LEVELS * 0.9).toFixed(3)})`;
        ctx.beginPath();
        for(let k = 0; k < arr.length; k += 3){
          ctx.moveTo(arr[k] + arr[k + 2], arr[k + 1]);
          ctx.arc(arr[k], arr[k + 1], arr[k + 2], 0, Math.PI * 2);
        }
        ctx.fill();
      }
      arr.length = 0;
    }
  }

  // same resize guard as the other background canvases: only a real size
  // change rebuilds the lattice (mobile address-bar reflows don't)
  let lastW = 0, lastH = 0;
  function handleResize(){
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || window.innerHeight;
    if(Math.abs(w - lastW) <= 10 && Math.abs(h - lastH) <= 24) return;
    lastW = w; lastH = h;
    resize();
  }
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(() => {
      clearTimeout(window.__papiProcessFlowResizeT);
      window.__papiProcessFlowResizeT = setTimeout(handleResize, 150);
    });
    ro.observe(section);
  } else {
    window.addEventListener('resize', () => {
      clearTimeout(window.__papiProcessFlowResizeT);
      window.__papiProcessFlowResizeT = setTimeout(handleResize, 150);
    });
  }
  handleResize();

  if(prefersReducedMotion){
    draw(4);
    return;
  }

  let isVisible = false;
  let rafId = null;
  let startTs = null;
  let lastRenderTs = 0;
  const INTERVAL = 1000 / (isPhone() ? 30 : 45);

  function loop(ts){
    if(startTs === null) startTs = ts;
    if(ts - lastRenderTs >= INTERVAL - 1){
      lastRenderTs = ts;
      draw(((ts - startTs) / 1000) * FLOW_SPEED);
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){ if(rafId === null) rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; } }
  function syncLoop(){ if(isVisible && !document.hidden) startLoop(); else stopLoop(); }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0, rootMargin: '120px 0px' });
    io.observe(section);
  } else {
    isVisible = true;
  }
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();
})();
