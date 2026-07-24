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

   BUG FIX: per report, "the last sections... look like they are out of
   place, there is space between all of them" — the scale-down half of
   this effect (0.92 -> 1.0 as a section approached viewport center) was
   the cause. `scale()` shrinks a box toward its own center WITHOUT
   changing its layout footprint, so any section that wasn't at the
   exact instant of full center-arrival (which is almost always true,
   since only one section is ever centered at a time) pulled its own
   edges inward, revealing a strip of the plain page background between
   it and its neighbor — worse wherever the neighboring sections'
   background colors didn't match (e.g. the FAQ section's flat black
   next to the quote section's animated blue gradient). Removed the
   scale entirely below; only the plain arrival fade/translate a
   section already has on its own content remains.

   Per the GSAP ScrollTrigger cinematic journey built on top of this
   (js/scroll-journey-*.js): #liveDemoSection and #ourProcessSection are
   no longer listed below at all — their whole depth-motion is now
   permanently owned by those pinned GSAP timelines instead, so this
   script never touches them (two scripts writing `transform` to the
   same element the same frame would fight, last-write-wins, and show up
   as visible jitter). #processRoom stays here — its own plain arrival
   dolly still plays right up until js/scroll-journey-hero.js's pin
   engages near the hero's end ("keep the existing camera dolly", per
   direct request) — but that file calls PapiDolly.lock('processRoom')
   for the duration of its own pin so the two never write to the same
   element in the same frame either.
=================================================================== */
(function(){
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // shared lock registry — see the header comment above. Exposed even
  // when reduced-motion is on (this script returns early right after,
  // but a journey file could still call lock/unlock harmlessly).
  const locked = new Set();
  window.PapiDolly = {
    lock(id){ locked.add(id); },
    unlock(id){ locked.delete(id); },
  };

  if(prefersReducedMotion) return;

  // extraY: an optional per-section extra vertical nudge on top of the
  // shared depth/scale effect below (not currently used by any entry,
  // kept as a supported option for a future section that wants its own
  // distinct arrival feel, same as ourProcessSection's old "camera
  // descend" used to).
  const SECTIONS = [
    { id: 'processRoom' },
    { id: 'comparisonSection' },
    { id: 'testimonialsSection' },
    { id: 'faqSection' },
    { id: 'quoteSection' },
  ].map(cfg => Object.assign({}, cfg, { el: document.getElementById(cfg.id) }))
   .filter(cfg => cfg.el);

  if(!SECTIONS.length) return;

  // BUG FIX: per report, "when i refresh it the second time... black
  // screen" — every one of these sections used to carry a PERMANENT
  // will-change:transform in CSS, for the entire page's lifetime,
  // regardless of whether it was anywhere near the viewport. Each one
  // is its own full-viewport-sized GPU compositor layer; holding 5+ of
  // those in memory for the whole session is real, standing GPU
  // memory that a reload doesn't need to pay for until a section is
  // actually about to animate. A generous-margin IntersectionObserver
  // toggles the .js-will-change class only while a section is
  // reasonably close to the viewport, releasing the GPU layer once
  // it's scrolled well away — same effect (no paint hitch on the
  // first real transform change) for a fraction of the standing cost.
  if('IntersectionObserver' in window){
    const wcIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('js-will-change', entry.isIntersecting);
      });
    }, { rootMargin: '50% 0px 50% 0px' });
    SECTIONS.forEach(({ el }) => wcIO.observe(el));
  } else {
    // no IntersectionObserver — fall back to the old always-on
    // behavior rather than never promoting these at all
    SECTIONS.forEach(({ el }) => el.classList.add('js-will-change'));
  }

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  let vh = window.innerHeight;

  function update(){
    const viewportCenter = window.scrollY + vh / 2;
    SECTIONS.forEach(({ id, el, extraY })=>{
      if(locked.has(id)) return;
      if(!extraY){ el.style.transform = ''; return; }
      const mid = el.offsetTop + el.offsetHeight / 2;
      const dist = Math.abs(viewportCenter - mid) / (vh * 0.9);
      // 1 right at viewport center (fully "arrived"), falling off
      // toward 0 the further a section is from center in either
      // direction (still approaching, or already receding) — translate
      // only, no scale (see the BUG FIX note up top for why)
      const closeness = 1 - smoothstep(0, 1, Math.min(dist, 1));
      const y = (1 - closeness) * extraY;
      el.style.transform = `translateY(${y.toFixed(1)}px)`;
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
