/* ===================================================================
   Papi — Scroll Dolly
   Per direct request: "Animate the camera moving forward in 3D while
   scrolling. The movement should feel like a cinematic dolly shot with
   smooth easing. From section to section." A lightweight, reusable
   scroll-linked depth effect: each major section sits fractionally
   smaller while it's still below or above the viewport's center, and
   eases up to its natural size right as it reaches center — so
   scrolling through the page reads like a camera dollying forward past
   a sequence of frames, not a flat 2D scroll. Reversible both ways
   (tied directly to scroll position, same convention as live-demo.js's
   own updateEntrance), not a one-shot.

   This was originally a real CSS 3D effect — `perspective` on <body>
   plus `translateZ` per section. Per a follow-up bug report ("the form
   section is coming on top of the FAQ" on mobile), that broke: CSS
   `perspective` projects from its OWN box's center (50% 50%), and
   body's box is the full document height, not the viewport — so a
   section far down a tall page gets visually dragged toward the
   document's vertical midpoint by translateZ, independent of scroll
   position, which is exactly what pulled the quote section up on top
   of FAQ. Plain `scale()` + `translateY()` are anchored to each
   element's own box instead, so there's no shared vanishing point for
   sections to fight over — same forward-motion feel, no cross-section
   coupling.

   Pure compositor-only work (only ever sets `transform`, computed from
   each section's own layout-only offsetTop/offsetHeight) — cheap even
   on mobile, and deliberately NOT read from getBoundingClientRect,
   which would reflect this same transform already applied and create a
   feedback loop against itself frame to frame.
=================================================================== */
(function(){
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  // extraY: per direct request, the Live Demo -> Our Process handoff
  // specifically should feel like "camera descend" rather than the
  // plain forward dolly every other section gets — this section starts
  // shifted up above its own resting spot and eases DOWN into place as
  // it arrives, on top of the shared depth/scale effect below.
  const SECTIONS = [
    { id: 'processRoom' },
    { id: 'liveDemoSection' },
    { id: 'ourProcessSection', extraY: -70 },
    { id: 'tradesSection' },
    { id: 'comparisonSection' },
    { id: 'testimonialsSection' },
    { id: 'faqSection' },
    { id: 'quoteSection' },
  ].map(cfg => Object.assign({}, cfg, { el: document.getElementById(cfg.id) }))
   .filter(cfg => cfg.el);

  if(!SECTIONS.length) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  let vh = window.innerHeight;

  function update(){
    const viewportCenter = window.scrollY + vh / 2;
    SECTIONS.forEach(({ el, extraY })=>{
      const mid = el.offsetTop + el.offsetHeight / 2;
      const dist = Math.abs(viewportCenter - mid) / (vh * 0.9);
      // 1 right at viewport center (fully "arrived" — neutral, sharp),
      // falling off toward 0 the further a section is from center in
      // either direction (still approaching, or already receding)
      const closeness = 1 - smoothstep(0, 1, Math.min(dist, 1));
      const scale = 0.92 + closeness * 0.08;
      const y = extraY ? (1 - closeness) * extraY : 0;
      el.style.transform = `translateY(${y.toFixed(1)}px) scale(${scale.toFixed(4)})`;
    });
  }

  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });

  // width-only guard — matches the same pattern used elsewhere on the
  // site: an iOS/in-app-browser chrome-collapse resize changes
  // innerHeight, not innerWidth, and shouldn't be treated as a real
  // layout change
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    vh = window.innerHeight;
    requestUpdate();
  });

  update();
})();
