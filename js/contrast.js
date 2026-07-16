/* ===================================================================
   Papi — Contrast section: same fake business, two websites.
   Wipes the immersive "after" version across the flat "before" one
   (a --wipe CSS custom property driving a clip-path in style.css) as
   the visitor scrolls through this section's sticky range — a pure
   function of scroll position, so scrolling back up wipes it back
   cleanly with no separate reverse logic needed.
=================================================================== */
(function(){
  const section = document.getElementById('contrastSection');
  const stage = document.getElementById('contrastStage');
  if(!section || !stage) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function smoothstep(e0, e1, x){
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  const beforeLabel = document.querySelector('.contrast-label--before');
  const afterTitle = document.querySelector('.mock-logo--after');
  const caption = document.querySelector('.contrast-caption');

  // the "after" mock's stat counters (Jobs Completed / Average Rating)
  // count up once, the first time the wipe has revealed enough of the
  // hero to actually see them — not a scroll-driven value like the
  // wipe itself, just a one-shot entrance, so it doesn't re-trigger
  // every time the visitor scrolls back and forth across the threshold
  const counters = Array.from(document.querySelectorAll('.mock-counter'));
  let countersStarted = false;
  function startCounters(){
    if(countersStarted || prefersReducedMotion) return;
    countersStarted = true;
    counters.forEach(el=>{
      const target = Number(el.dataset.target || '0');
      const decimals = Number(el.dataset.decimal || '0');
      const divisor = Math.pow(10, decimals);
      const duration = 1100;
      const start = performance.now();
      function tick(now){
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = (target * eased) / divisor;
        el.textContent = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
        if(t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  let sectionTop = 0, sectionHeight = 0, viewportH = 0;
  function measure(){
    viewportH = window.innerHeight;
    sectionTop = section.offsetTop;
    sectionHeight = section.offsetHeight;
  }
  requestAnimationFrame(measure);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);

  // width-only guard — iOS Safari's address bar collapsing on first
  // scroll fires a resize that changes innerHeight but not innerWidth;
  // re-measuring on that would be pointless work reacting to nothing
  // that actually changed
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeW) return;
    lastResizeW = w;
    clearTimeout(window.__papiContrastResizeT);
    window.__papiContrastResizeT = setTimeout(measure, 150);
  });

  function update(){
    const scrollable = Math.max(1, sectionHeight - viewportH);
    const progress = Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollable));

    // 100% at the top of the section (fully hidden) down to 0% (fully
    // revealed) — style.css's clip-path reads this directly
    const wipePct = (1 - progress) * 100;
    stage.style.setProperty('--wipe', wipePct.toFixed(2) + '%');

    // "Outdated Website" fades out over the same range the after mock's
    // own title fades in, over — a crossfade rather than two labels
    // just independently appearing/disappearing whenever the wipe
    // geometry happens to uncover them
    if(beforeLabel) beforeLabel.style.opacity = String(1 - smoothstep(0.55, 0.95, progress));
    if(afterTitle) afterTitle.style.opacity = String(smoothstep(0.55, 0.95, progress));
    if(caption) caption.style.opacity = String(1 - smoothstep(0, 0.06, progress));

    if(progress > 0.3) startCounters();
  }

  // batch to one update per animation frame — raw 'scroll' events can
  // fire faster than the screen repaints during a fast scroll
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }, { passive:true });

  if(prefersReducedMotion){
    stage.style.setProperty('--wipe', '0%');
    if(beforeLabel) beforeLabel.style.opacity = '0';
    if(afterTitle) afterTitle.style.opacity = '1';
    if(caption) caption.style.opacity = '0';
    counters.forEach(el=>{
      const target = Number(el.dataset.target || '0');
      const decimals = Number(el.dataset.decimal || '0');
      const value = target / Math.pow(10, decimals);
      el.textContent = decimals > 0 ? value.toFixed(decimals) : value.toString();
    });
  } else {
    update();
  }
})();
