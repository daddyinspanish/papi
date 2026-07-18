/* ===================================================================
   Papi — process section ambient fog
   A soft, slow-drifting "water vapor" layer behind the process
   section's sticky stage, there purely for atmosphere further back
   than js/process-flow.js's own liquid stream rather than as another
   glass object of its own — plain canvas 2D, not another WebGL
   context, and no filter:blur at runtime either. The softness comes
   entirely from radial-gradient colour stops fading to fully
   transparent, the same "the falloff IS the blur" idea used for this
   page's own glass material's edges, rather than a genuinely blurred
   canvas, which is one of the more expensive things a browser can be
   asked to do at this size every frame.

   Fades in as the section scrolls into view (tied directly to scroll
   position, not a one-shot IntersectionObserver trigger — same reason
   quote-form.js drives its own reveal this way: a fixed-duration
   animation can finish playing before or after the visitor's own
   scroll speed catches up to it, which reads as content just
   "appearing" rather than actually arriving with the scroll), and its
   own render loop pauses entirely while the section is off-screen.
=================================================================== */
(function(){
  const row = document.querySelector('.process-sticky');
  const section = document.getElementById('heroProcess');
  if(!row || !section) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-process-fog';
  canvas.setAttribute('aria-hidden', 'true');
  row.insertBefore(canvas, row.firstChild);
  const ctx = canvas.getContext('2d');

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t*t*(3 - 2*t);
  }

  // a few huge, near-flat washes underneath everything else, just to
  // keep the very corners from ever reading as pure white — barely
  // visible on their own (peak alpha ~0.05), they're not what makes
  // this read as vapor, the rising wisps below are.
  const BASE_GLOWS = [
    { x: 0.18, y: 0.4, r: 0.62, hue: [251, 243, 226], alpha: 0.05 },
    { x: 0.82, y: 0.55, r: 0.58, hue: [248, 238, 214], alpha: 0.045 },
  ];

  const PALETTE = [
    [253, 246, 234],
    [250, 240, 219],
    [255, 250, 240],
    [246, 233, 205],
    [252, 243, 224],
    [255, 253, 247],
  ];

  // real, individually visible wisps — each one small enough (relative
  // to the row's own height) that its own soft edge is actually inside
  // the visible frame, rather than the previous version's blobs, whose
  // radius so far exceeded the section's height that a viewer only
  // ever saw their flat, fully-opaque centre and never an edge at all
  // (that's what read as "just a colour change" rather than vapor).
  // Each one rises slowly from below and fades out above — like real
  // steam — while swaying side to side on its own lazy sine, with a
  // gentle independent size "breathe" so no two ever move in lockstep.
  const WISP_COUNT = 18;
  const WISPS = [];
  (function seedWisps(){
    let seed = 1337;
    function rand(){
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 100000) / 100000;
    }
    for(let i=0;i<WISP_COUNT;i++){
      WISPS.push({
        homeX: rand(),
        swayAmp: 0.03 + rand()*0.06,
        swayPeriod: 22 + rand()*34,
        swayPhase: rand() * Math.PI * 2,
        startY: rand() * 1.3,
        riseSpeed: 0.0028 + rand()*0.0055, // fraction of row-height per second — a full bottom-to-top rise takes a couple of minutes
        size: 0.10 + rand()*0.15, // fraction of row height
        breathPeriod: 16 + rand()*20,
        breathPhase: rand() * Math.PI * 2,
        alpha: 0.11 + rand()*0.11,
        hue: PALETTE[i % PALETTE.length],
      });
    }
  })();

  let W = 1, H = 1, dpr = 1;
  function resize(){
    const w = row.clientWidth || 1, h = row.clientHeight || 1;
    if(!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if(w === W && h === H) return;
    W = w; H = h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  resize();

  // fills only the blob's own bounding square rather than the whole
  // canvas — with up to 20 of these being drawn every frame, filling
  // the full row width/height each time (the previous version's
  // approach) does a lot of needless overdraw outside where the
  // gradient has any visible effect at all past its own radius.
  function paintSoftCircle(cx, cy, r, red, green, blue, peakAlpha){
    if(peakAlpha <= 0.002 || r <= 0) return;
    const bx = Math.max(0, cx - r), by = Math.max(0, cy - r);
    const bw = Math.min(W, cx + r) - bx, bh = Math.min(H, cy + r) - by;
    if(bw <= 0 || bh <= 0) return;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${(peakAlpha*0.95).toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(${red}, ${green}, ${blue}, ${(peakAlpha*0.6).toFixed(3)})`);
    grad.addColorStop(0.72, `rgba(${red}, ${green}, ${blue}, ${(peakAlpha*0.22).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw, bh);
  }

  function drawFrame(elapsedSec){
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bigSize = Math.max(W, H);
    // wisps are sized off the SMALLER of the two dimensions — on a
    // narrow mobile viewport the row is much taller than it is wide
    // (four cards stacked), and sizing purely off height there made
    // every wisp wider than the viewport itself, right back to the
    // original "no visible edge, just a colour wash" problem this was
    // meant to fix, just rotated 90 degrees. The base ambient glows
    // stay on the larger dimension — those are deliberately meant to
    // be huge washes with no visible edge of their own.
    const wispSize = Math.min(W, H);

    BASE_GLOWS.forEach(b=>{
      const [red, green, blue] = b.hue;
      paintSoftCircle(b.x*W, b.y*H, b.r*bigSize, red, green, blue, b.alpha);
    });

    WISPS.forEach(w=>{
      // rises from below the row (y > 1) up past its top (y < 0),
      // wrapping back around to the bottom — a continuous loop rather
      // than an oscillation, which is what actually reads as "rising"
      // instead of "bobbing in place"
      let yFrac = (w.startY - elapsedSec * w.riseSpeed) % 1.3;
      if(yFrac < 0) yFrac += 1.3;
      const y = yFrac - 0.15;
      const sway = Math.sin(elapsedSec * (2*Math.PI/w.swayPeriod) + w.swayPhase) * w.swayAmp;
      const x = w.homeX + sway;
      const breathe = 1 + Math.sin(elapsedSec * (2*Math.PI/w.breathPeriod) + w.breathPhase) * 0.14;

      // fades in over the bottom 12% of the rise and out over the top
      // 12% — softens the loop's own wrap-around and its entry/exit
      // past the row's own edges into something that reads as the
      // wisp itself thinning out, rather than a hard pop in/out.
      const edgeFade = smoothstep(0, 0.12, y) * smoothstep(0, 0.12, 1 - y);
      if(edgeFade <= 0.002) return;

      const [red, green, blue] = w.hue;
      paintSoftCircle(x*W, y*H, w.size*wispSize*breathe, red, green, blue, w.alpha*edgeFade);
    });
  }
  function updateScrollFade(){
    const rect = row.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 once the row's top is still a full viewport-height below the
    // bottom of the screen, ramping to 1 by the time it's about a
    // third of the way up into view — arrives gently ahead of the
    // actual step cards reaching the same point, rather than snapping
    // in right as they do
    const raw = (vh - rect.top) / (vh * 0.85);
    canvas.style.opacity = smoothstep(0, 1, raw).toFixed(3);
  }

  let running = false, rafId = null, startTs = null;
  function loop(ts){
    if(!running) return;
    if(startTs === null) startTs = ts;
    drawFrame((ts - startTs) / 1000);
    rafId = requestAnimationFrame(loop);
  }
  function start(){
    if(running || prefersReducedMotion) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop(){
    running = false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  if(prefersReducedMotion){
    drawFrame(0);
  } else if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry=> entry.isIntersecting ? start() : stop());
    }, { rootMargin: '200px 0px' });
    io.observe(section);
  } else {
    start();
  }

  updateScrollFade();
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ updateScrollFade(); ticking = false; });
  }, { passive: true });

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiFogResizeT);
    window.__papiFogResizeT = setTimeout(()=>{ resize(); updateScrollFade(); }, 150);
  });
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ resize(); updateScrollFade(); });
  window.addEventListener('load', ()=>{ resize(); updateScrollFade(); });
})();
