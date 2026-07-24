/* ===================================================================
   Papi — Scroll Journey: Hero -> See It Live (portal)
   Per direct request for a GSAP ScrollTrigger cinematic transition:
   near the end of the hero, pin the section and scale the hero's own
   visual outward until it fills the viewport like a portal, fading the
   hero text only near the end (not a whole-section crossfade).

   REMOVED per direct follow-up report, after three separate rounds of
   bugs from it (showing on page load, staying stuck after the pin
   released, and finally "causing the next section to have the ghost
   animation" as the visitor arrived there): the "ghost" browser-frame
   reveal that used to sit here, clipping open through a rounded-rect
   mask. That piece required a whole standalone DOM element (a cloned
   .live-demo-browser-bar, built specifically because the real
   .live-demo-browser lives in a different, still off-screen section
   and can't safely be reparented or position:fixed'd — see this
   project's own git history for the full account) with its own
   opacity/clip-path/transform choreography, and every fix to one
   timing edge case kept surfacing another. Given the same class of bug
   kept recurring, the right call was to simplify rather than keep
   patching: this transition is now just the portal zoom + text fade,
   with no separate reveal element at all. The pin releases straight
   into #liveDemoSection's own already-existing entrance (a plain
   scroll-linked opacity/translateY fade already built into
   js/live-demo.js, present long before any of this GSAP work) — one
   less moving part, and structurally incapable of this bug class since
   there's no cross-section object left to go stale or double-render.

   The hero has no separate 3D "hero object" — just #processHeroMatrix
   (the falling-digits canvas background) behind the title/CTA/social-
   icon text. Scaling that canvas itself as the portal (rather than
   adding a new element) is the chosen approach — thematically it reads
   as diving into the falling code, and needs no new DOM.

   #processRoom's own plain scroll-dolly (js/scroll-dolly.js) keeps
   playing right up until this pin engages ("keep the existing camera
   dolly", per direct request) — window.PapiDolly.lock/unlock hands
   that element's transform ownership back and forth so the two never
   write to it in the same frame.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const processRoom = document.getElementById('processRoom');
  const matrixCanvas = document.getElementById('processHeroMatrix');
  const heroCopy = document.querySelector('.process-hero-copy');
  if(!processRoom || !matrixCanvas || !heroCopy) return;

  gsap.registerPlugin(ScrollTrigger);

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  const mm = gsap.matchMedia();

  mm.add({
    isDesktop: '(min-width: 641px)',
    isMobile: '(max-width: 640px)',
  }, (context) => {
    const isDesktop = context.conditions.isDesktop;

    // the hero (#processRoom) is exactly one viewport tall with
    // nothing extra to scroll through first, so ScrollTrigger's
    // start:'bottom bottom' resolves to ~scrollY 0 — the pin engages
    // essentially at page load. A long total scroll distance, with
    // every visible change pushed deep into its tail, is what actually
    // gives the visitor real "just read the hero" scroll runway before
    // the portal starts, let alone completes.
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: processRoom,
        pin: true,
        start: 'bottom bottom',
        end: isDesktop ? '+=300%' : '+=170%',
        scrub: 1,
        onEnter: () => window.PapiDolly && window.PapiDolly.lock('processRoom'),
        onEnterBack: () => window.PapiDolly && window.PapiDolly.lock('processRoom'),
        onLeaveBack: () => window.PapiDolly && window.PapiDolly.unlock('processRoom'),
      },
    });

    // portal: the matrix-rain canvas scale-up doesn't start until 40%
    // into the pin, and finishes at 75% — a real dead zone first, then
    // a gradual dolly-in (transform+opacity only, per the 60fps
    // requirement)
    tl.to(matrixCanvas, {
      scale: isDesktop ? 2.6 : 1.6,
      transformOrigin: '50% 50%',
      duration: 0.35,
      ease: 'none',
    }, 0.4);

    // hero text fades ONLY in the last 22% — not a whole-section
    // crossfade, per direct request. Stays faded once the pin releases
    // (a scrubbed tween holds its end value past progress 1) — the
    // hero isn't meant to reappear once the visitor has moved on.
    tl.to(heroCopy, {
      opacity: 0,
      duration: 0.22,
      ease: 'none',
    }, 0.78);

    // gsap.matchMedia auto-reverts everything created in this context
    // (the timeline + its ScrollTrigger) when the breakpoint changes —
    // no manual cleanup needed beyond that.
  });
})();
