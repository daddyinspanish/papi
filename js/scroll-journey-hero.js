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

   TITLE GLITCH-DISSOLVE — per direct request: "animate 'Building
   Websites that Matter' into something that turns like a glitch
   numbers that are like the matrix as the numbers in the back scale,
   so it can be one immersive flow." The title used to just sit there
   doing nothing until the plain opacity fade at the very end of the
   pin — visually disconnected from the matrix-rain canvas scaling up
   right next to it. Now each character of the title is individually
   swappable (split into spans once, up front) and, as the SAME pin
   scrubs, progressively flickers into a random matrix digit and fades
   away, staggered left-to-right like the rain's own falling columns —
   timed to finish right as the canvas itself scales up, so the title
   reads as dissolving INTO the same rain rather than fading on its
   own, unconnected from it.

   BUG FIX (follow-up request): "instead of the numbers just moving
   towards the right side, make the effect make the characters fall
   like the matrix effect. also make sure the title scales as well
   like the matrix in the background." Two changes: each character now
   gets its own downward translateY (quadratic ease-in, a gravity feel)
   as it glitches out, instead of only flickering/fading in place —
   reads as dropping into the rain below rather than just sliding
   sideways. And the title element itself now scales up in the SAME
   0.4-0.75 window as the matrix canvas's own scale tween just below,
   so the two zoom in lockstep instead of only the background moving.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const processRoom = document.getElementById('processRoom');
  const matrixCanvas = document.getElementById('processHeroMatrix');
  const heroCopy = document.querySelector('.process-hero-copy');
  if(!processRoom || !matrixCanvas || !heroCopy) return;

  gsap.registerPlugin(ScrollTrigger);

  // ---- split the title into individually-swappable characters, once,
  // up front — harmless even under reduced motion (same text, same
  // layout, just wrapped in spans), so this stays a single top-level
  // step rather than being duplicated per matchMedia breakpoint below.
  // Spaces are left as plain text nodes (never glitched into a digit,
  // which would visually read as a stray floating number) ----
  const titleEl = heroCopy.querySelector('.process-hero-title');
  const GLITCH_DIGITS = '0123456789';
  let titleChars = [];
  if(titleEl){
    const lines = titleEl.innerHTML.split(/<br\s*\/?>/i);
    titleEl.innerHTML = lines
      .map((line) => Array.from(line).map((ch) => (ch === ' ' ? ' ' : `<span class="hero-title-char" data-char="${ch}">${ch}</span>`)).join(''))
      .join('<br>');
    titleChars = Array.from(titleEl.querySelectorAll('.hero-title-char'));
  }

  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  // maps the pin's own 0-1 progress into a local glitch window that
  // leads/overlaps the canvas-scale tween just below (0.4-0.75) so the
  // title has fully dissolved right as the canvas's own zoom is really
  // taking off. Per-character stagger (a sweep, not every letter
  // glitching in lockstep) is driven purely by index — no separate
  // timer loop, matching this site's "everything driven by scroll"
  // convention already used by js/hero-matrix.js's own per-frame
  // digit randomization.
  const GLITCH_START = 0.28, GLITCH_END = 0.7;
  const STAGGER_SPAN = 2.5; // how many characters' worth of overlap are "in flight" at once
  // how far a character falls once fully dissolved, in its own font-size
  // units (em) so it scales with the title's own clamp()'d font-size —
  // t*t (quadratic ease-in) reads as gravity picking up speed, not a
  // constant-velocity slide
  const FALL_DISTANCE_EM = 1.8;
  function updateTitleGlitch(progress){
    if(!titleChars.length) return;
    const raw = clamp01((progress - GLITCH_START) / (GLITCH_END - GLITCH_START));
    const n = titleChars.length;
    titleChars.forEach((span, i) => {
      const start = i / n;
      const end = start + STAGGER_SPAN / n;
      const t = clamp01((raw - start) / (end - start));
      if(t <= 0){
        span.textContent = span.dataset.char;
        span.style.opacity = '1';
        span.style.transform = '';
        span.classList.remove('is-glitching');
        return;
      }
      if(t >= 1){
        span.style.opacity = '0';
        span.style.transform = `translateY(${FALL_DISTANCE_EM}em)`;
        return;
      }
      span.classList.add('is-glitching');
      span.textContent = Math.random() < t ? GLITCH_DIGITS[(Math.random() * 10) | 0] : span.dataset.char;
      span.style.opacity = String(1 - t * 0.35);
      span.style.transform = `translateY(${(t * t * FALL_DISTANCE_EM).toFixed(3)}em)`;
    });
  }

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
        onUpdate: (self) => updateTitleGlitch(self.progress),
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

    // per direct follow-up request ("make sure the title scales as
    // well like the matrix in the background") — same 0.4-0.75 window
    // as the canvas tween just above, so the title zooms in lockstep
    // with it rather than only the background moving. A smaller target
    // than the canvas's own 2.6/1.6 (this is foreground text already
    // mid-dissolve via updateTitleGlitch, not a background layer —
    // scaling it as aggressively would fight the falling-away motion
    // instead of reading as one continuous zoom)
    if(titleEl){
      tl.to(titleEl, {
        scale: isDesktop ? 1.8 : 1.4,
        transformOrigin: '50% 50%',
        duration: 0.35,
        ease: 'none',
      }, 0.4);
    }

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
