/* ===================================================================
   Papi — Hero Matrix Rain
   Per direct request: "a glitch inspired matrix of falling numbers
   characters in the background alongside the liquid, something that
   is constantly happening in the background." A plain 2D-canvas
   falling-digit rain (classic Matrix look, but brand-tinted aqua
   instead of green) sitting BEHIND js/process-hero-slime.js's own
   liquid-glass canvas so both are visible at once. Every column is
   redrawn fresh each frame with a randomized digit per cell (the
   standard "shimmering" matrix-rain trick) rather than persisting
   trails via a semi-transparent fillRect overlay — that overlay
   technique never actually clears (alpha compositing asymptotically
   approaches fully opaque), which would eventually paint over the
   hero's own dark gradient background entirely. clearRect + redraw
   every frame keeps this reliably transparent everywhere but the
   digits themselves, no matter how long it runs.
=================================================================== */
(function(){
  const canvas = document.getElementById('processHeroMatrix');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;

  const CONFIG = {
    fontSize: 16,
    fontSizeMobile: 13,
    mobileWidth: 640,
    speedMin: 0.28,
    speedMax: 0.72,
    streamMin: 6,
    streamMax: 16,
    headAlpha: 0.55,
    // per-row falloff behind the head — smaller value fades out faster
    tailFalloff: 0.80,
    renderFPS: 22,
  };

  const CHARS = '0123456789';
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, fontSize = CONFIG.fontSize, rowH = CONFIG.fontSize, cellW = CONFIG.fontSize * 0.62;
  let columns = [];

  function randRange(min, max){ return min + Math.random() * (max - min); }

  function makeColumn(x){
    return {
      x,
      // negative start staggers each column's first appearance instead
      // of every column beginning in lockstep on the very first frame
      y: -randRange(0, 40),
      speed: randRange(CONFIG.speedMin, CONFIG.speedMax),
      length: Math.floor(randRange(CONFIG.streamMin, CONFIG.streamMax)),
    };
  }

  function buildColumns(){
    const count = Math.ceil(W / cellW) + 1;
    columns = new Array(count).fill(0).map((_, i) => makeColumn(i * cellW));
  }

  function resize(){
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if(!w || !h) return;
    const isMobile = window.innerWidth < CONFIG.mobileWidth;
    fontSize = isMobile ? CONFIG.fontSizeMobile : CONFIG.fontSize;
    rowH = fontSize;
    cellW = fontSize * 0.62;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fontSize}px "Courier New", monospace`;
    ctx.textBaseline = 'top';

    W = w;
    H = h;
    buildColumns();
  }

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return; // see the --stable-vh comment elsewhere on this site
    lastResizeW = w;
    clearTimeout(window.__papiHeroMatrixResizeT);
    window.__papiHeroMatrixResizeT = setTimeout(resize, 150);
  });

  function renderFrame(){
    ctx.clearRect(0, 0, W, H);
    const maxRow = H / rowH;

    columns.forEach(col => {
      for(let j = 0; j < col.length; j++){
        const rowY = col.y - j;
        if(rowY < 0) continue;
        const py = rowY * rowH;
        if(py > H) break;

        const alpha = j === 0
          ? CONFIG.headAlpha
          : CONFIG.headAlpha * Math.pow(CONFIG.tailFalloff, j) * 0.6;
        if(alpha < 0.015) continue;

        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        ctx.fillStyle = j === 0
          ? `rgba(226,246,255,${alpha})`
          : `rgba(122,180,214,${alpha})`;
        ctx.fillText(ch, col.x, py);
      }

      col.y += col.speed;
      if(col.y - col.length > maxRow){
        col.y = -randRange(0, 20);
        col.speed = randRange(CONFIG.speedMin, CONFIG.speedMax);
        col.length = Math.floor(randRange(CONFIG.streamMin, CONFIG.streamMax));
      }
    });
  }

  resize();

  if(prefersReducedMotion){
    // one static frame, no falling motion, matching this site's usual
    // reduced-motion treatment elsewhere
    renderFrame();
    return;
  }

  // BUG FIX (matching the same pattern already used in js/process-hero-
  // slime.js): pause the render loop whenever the hero isn't actually
  // on-screen or the tab itself isn't visible, so this doesn't keep
  // burning CPU/battery for the rest of the session once scrolled past.
  const RENDER_INTERVAL = 1000 / CONFIG.renderFPS;
  let lastRenderTs = 0;
  let rafId = null;
  let isHeroVisible = true;

  function loop(ts){
    if(ts - lastRenderTs >= RENDER_INTERVAL){
      lastRenderTs = ts;
      renderFrame();
    }
    rafId = requestAnimationFrame(loop);
  }
  function startLoop(){
    if(rafId !== null) return;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop(){
    if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
  }
  function syncLoop(){
    if(isHeroVisible && !document.hidden) startLoop(); else stopLoop();
  }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      isHeroVisible = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0 });
    io.observe(canvas);
  }
  document.addEventListener('visibilitychange', syncLoop);
  // starts unconditionally rather than routing through syncLoop() —
  // some environments report document.hidden === true even on initial
  // load before any real visibilitychange has fired, which would
  // otherwise leave this canvas blank forever until some other event
  // happened to call syncLoop(). Real backgrounding still pauses it
  // correctly via the visibilitychange listener above.
  startLoop();
})();
