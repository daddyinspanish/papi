/* ===================================================================
   Papi — Scroll Progress
   Awwwards personality pass — a thin, persistent bar reflecting total
   page-scroll progress, reinforcing the "journey" framing the hero and
   How It's Built sections already establish, all the way to the
   footer. Sets a single CSS custom property on the fill element
   (--scroll-progress), read by css/style.css's transform:scaleX() —
   same rAF-throttled scroll-listener convention already used by
   js/scroll-dolly.js, and the same width-only resize guard used
   site-wide (an iOS/in-app-browser chrome-collapse resize changes
   innerHeight, not innerWidth, and shouldn't trigger a recompute).
=================================================================== */
(function(){
  const fill = document.getElementById('scrollProgressFill');
  if(!fill) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  function update(){
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    fill.style.setProperty('--scroll-progress', progress.toFixed(4));
  }

  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });

  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    requestUpdate();
  });

  update();
})();
