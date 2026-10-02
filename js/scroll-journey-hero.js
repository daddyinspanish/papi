/* ===================================================================
   Papi — Scroll Journey: Hero -> See It Live
   Per direct request for a GSAP ScrollTrigger cinematic transition:
   near the end of the hero, pin the section and dissolve the hero's own
   text into a matrix-style character glitch, fading it out only near
   the end (not a whole-section crossfade).

   REMOVED per direct follow-up request, "do not zoom in when we are
   scrolling down to the next section" — this used to also be a
   "portal": the grid canvas and the title both scaled up in lockstep
   across the same window as the glitch, reading as a zoom/dolly-in.
   Only the scale-up is gone; the character-level glitch/dissolve and
   the final opacity fade are unchanged.

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

   The hero has no separate 3D "hero object" — just #processHeroGrid
   (the wireframe wave-grid canvas background, previously a falling-
   digits matrix rain) behind the title/CTA/social-icon text. Scaling
   that canvas itself as the portal (rather than adding a new element)
   is the chosen approach — thematically it reads as diving into the
   grid, and needs no new DOM.

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

   FURTHER BUG FIX (follow-up request): "make sure that the last
   numbers do not scale all the way, instead the numbers just falls
   into the matrix effect." The title-level scale tween above and the
   per-character fall above were compounding: a character dissolving
   late in the stagger was ALSO still riding the parent's own
   ever-growing zoom right as it fell away, so the very last numbers
   visibly ballooned in size instead of just dropping. Each character
   now gets a counter-scale the moment it starts glitching — 1 divided
   by whatever the parent's current zoom factor is — which cancels the
   inherited growth for that one character, so once a letter starts
   dissolving it holds its own natural size and only falls/fades/
   flickers, while untouched letters ahead of it keep scaling up
   normally with the rest of the title (still satisfying "the title
   scales like the matrix" for the intact portion).

   CTA BUTTON GLITCH (follow-up request): "make the button interact
   like it was also built out of numbers — it's too still there when
   the animation is happening." The "View our work" button used to just
   sit untouched through the whole title dissolve + canvas zoom, then
   flatly opacity-fade in the last 22% along with the rest of heroCopy —
   visually static against everything dissolving/zooming around it.
   Its own text now gets the identical per-character glitch/fall/fade
   treatment as the title (same technique, own span set), timed to pick
   up right as the title's own dissolve is finishing and fully resolve
   just before heroCopy's whole-block fade takes over — reads as one
   continuous wave sweeping down through the copy rather than a second,
   disconnected effect.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const processRoom = document.getElementById('processRoom');
  const gridCanvas = document.getElementById('processHeroGrid');
  const heroCopy = document.querySelector('.process-hero-copy');
  if(!processRoom || !gridCanvas || !heroCopy) return;

  gsap.registerPlugin(ScrollTrigger);

  // ---- split the title into individually-swappable characters, once,
  // up front — harmless even under reduced motion (same text, same
  // layout, just wrapped in spans), so this stays a single top-level
  // step rather than being duplicated per matchMedia breakpoint below.
  // Spaces are left as plain text nodes (never glitched into a digit,
  // which would visually read as a stray floating number) ----
  const titleEl = heroCopy.querySelector('.process-hero-title');
  const ctaEl = heroCopy.querySelector('.process-hero-cta');
  const GLITCH_DIGITS = '0123456789';
  let titleChars = [];
  if(titleEl){
    // BUG FIX, found once the title became a single long one-liner (per
    // direct request to drop the old two-line "Real Websites. / Built
    // With Purpose." in favor of one line): a bare space text node
    // between two `display:inline-block` char spans does NOT reliably
    // keep the browser from treating the boundary between two spans
    // WITHIN the same word as its own line-break opportunity too —
    // confirmed directly on a narrow viewport, where "Building Websites
    // for Businesses." wrapped as "...for Businesses." became "...fo" /
    // "r Businesses." (split mid-word, exactly between two character
    // spans, nowhere near an actual space). The old two-line title never
    // surfaced this — each hard-coded line was always short enough to
    // never actually need a second wrap. Each word's own character spans
    // are now nested inside one more `.hero-title-word` (display:
    // inline-block, see its own CSS) wrapper, so that word is one atomic
    // box the line-breaking algorithm can only break BEFORE or AFTER —
    // never inside — while the plain space text nodes between word
    // wrappers (unchanged) still wrap normally between words.
    const lines = titleEl.innerHTML.split(/<br\s*\/?>/i);
    titleEl.innerHTML = lines
      .map((line) => line.split(' ').map((word) => `<span class="hero-title-word">${Array.from(word).map((ch) => `<span class="hero-title-char" data-char="${ch}">${ch}</span>`).join('')}</span>`).join(' '))
      .join('<br>');
    titleChars = Array.from(titleEl.querySelectorAll('.hero-title-char'));
  }
  // same split-into-spans technique as the title above, own class so it
  // can be styled/timed independently — see the CTA BUTTON GLITCH note
  //
  // BUG FIX: per report, the button rendered as "VIEWOURWORK" with the
  // word spaces gone entirely. .process-hero-cta is display:inline-flex
  // (see its own CSS) — the title above sits in normal block flow,
  // where a bare space text node between two inline-block spans lays
  // out exactly like it would between two words. Flexbox uses a
  // different model: per spec, an anonymous flex item containing only
  // whitespace generates no box at all, so the plain ' ' between two
  // <span> flex-item siblings collapses to zero width instead of
  // reading as a space — a real, verified difference, not a guess.
  // &nbsp; isn't "white space" for that CSS-collapsing rule, so it
  // still generates a real (space-width) anonymous flex item and the
  // gap renders normally again.
  let ctaChars = [];
  if(ctaEl){
    ctaEl.innerHTML = Array.from(ctaEl.textContent)
      .map((ch) => (ch === ' ' ? '&nbsp;' : `<span class="hero-cta-char" data-char="${ch}">${ch}</span>`))
      .join('');
    ctaChars = Array.from(ctaEl.querySelectorAll('.hero-cta-char'));
  }

  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  // maps the pin's own 0-1 progress into a local glitch window. Per-
  // character stagger (a sweep, not every letter glitching in lockstep)
  // is driven purely by index — no separate timer loop, matching this
  // site's "everything driven by scroll" convention already used by
  // js/hero-grid.js's own per-frame wave recompute.
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

  // picks up as the title's own dissolve is finishing (GLITCH_END above)
  // and fully resolves just ahead of heroCopy's own opacity fade at 0.78
  // — see the CTA BUTTON GLITCH note up top. No parent scale/counter-
  // scale needed here (unlike the title) since the button itself never
  // gets a zoom tween — just the same fall/fade/flicker per character.
  const CTA_GLITCH_START = 0.5, CTA_GLITCH_END = 0.76;
  const CTA_FALL_DISTANCE_EM = 1.4;
  function updateCtaGlitch(progress){
    if(!ctaChars.length) return;
    const raw = clamp01((progress - CTA_GLITCH_START) / (CTA_GLITCH_END - CTA_GLITCH_START));
    const n = ctaChars.length;
    ctaChars.forEach((span, i) => {
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
        span.style.transform = `translateY(${CTA_FALL_DISTANCE_EM}em)`;
        return;
      }
      span.classList.add('is-glitching');
      span.textContent = Math.random() < t ? GLITCH_DIGITS[(Math.random() * 10) | 0] : span.dataset.char;
      span.style.opacity = String(1 - t * 0.35);
      span.style.transform = `translateY(${(t * t * CTA_FALL_DISTANCE_EM).toFixed(3)}em)`;
    });
  }

  // per direct request: "I would like the edge of our hero section...
  // to connect to the dots and lines that are in the second section...
  // as I scroll to the next section, the grid makes a wave that flows
  // down to the end of the grid and connects to those dots in the next
  // section" — reuses this SAME pin-scrub progress (the one already
  // dissolving the title/CTA above) to drive js/hero-grid.js's own
  // bridge-wave crest, so the grid visually hands off into
  // #liveDemoSection's plexus nodes right as this pin releases, rather
  // than the two sections meeting at a hard, unrelated seam. Starts
  // partway through the title dissolve (so the wave and the glitch read
  // as one continuous effect, not two disconnected ones) and finishes
  // exactly at progress 1, when the pin lets go.
  const BRIDGE_START = 0.45, BRIDGE_END = 1;
  function updateBridgeWave(progress){
    if(!window.PapiHeroGrid) return;
    window.PapiHeroGrid.setBridgeProgress((progress - BRIDGE_START) / (BRIDGE_END - BRIDGE_START));
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
        onUpdate: (self) => {
          updateTitleGlitch(self.progress);
          updateCtaGlitch(self.progress);
          updateBridgeWave(self.progress);
        },
      },
    });

    // REMOVED per direct request, "do not zoom in when we are scrolling
    // down to the next section" — this used to scale both the grid
    // canvas (up to 2.6x/1.6x) and the title in lockstep across the
    // same 0.4-0.75 window as a "portal" dolly-in. The character-level
    // glitch/dissolve below (updateTitleGlitch/updateCtaGlitch) and the
    // final opacity fade just below are untouched — only the scale-up
    // itself is gone, so the transition into #liveDemoSection now reads
    // as a dissolve, not a zoom.

    // hero text fades ONLY in the last 22% — not a whole-section
    // crossfade, per direct request. Stays faded once the pin releases
    // (a scrubbed tween holds its end value past progress 1) — the
    // hero isn't meant to reappear once the visitor has moved on.
    tl.to(heroCopy, {
      opacity: 0,
      duration: 0.22,
      ease: 'sine.inOut',
    }, 0.78);

    // gsap.matchMedia auto-reverts everything created in this context
    // (the timeline + its ScrollTrigger) when the breakpoint changes —
    // no manual cleanup needed beyond that.
  });
})();
