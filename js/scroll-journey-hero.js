/* ===================================================================
   Papi — Scroll Journey: Hero -> See It Live (portal)
   Per direct request for a GSAP ScrollTrigger cinematic transition:
   near the end of the hero, pin the section and scale the hero's own
   visual outward until it fills the viewport like a portal, fade the
   hero text only near the end (not a whole-section crossfade), and
   reveal the live-demo browser through a rounded-rect clipping mask as
   it settles in from a pushed-back, tilted entrance.

   The hero has no separate 3D "hero object" today — just
   #processHeroMatrix (the falling-digits canvas background) behind the
   title/CTA/social-icon text. Scaling that canvas itself as the portal
   (rather than adding a new element) is the chosen approach here —
   thematically it reads as diving into the falling code, and needs no
   new DOM.

   #processRoom's own plain scroll-dolly (js/scroll-dolly.js) keeps
   playing right up until this pin engages ("keep the existing camera
   dolly", per direct request) — window.PapiDolly.lock/unlock hands
   that element's transform ownership back and forth so the two never
   write to it in the same frame.

   IMPORTANT structural note: the real .live-demo-browser lives inside
   #liveDemoSection, a completely different, still off-screen (unpinned)
   section — animating its transform there directly does nothing
   visible while #processRoom is pinned, since it isn't spatially in
   the pinned viewport. The two obvious fixes both break something:
   moving the real element into #processRoom (or position:fixed-ing it)
   would reparent an element containing a live <iframe>, which reloads
   the iframe on reparent in most browsers; and .live-demo-inner (an
   ancestor of the real browser) already carries its own dynamic
   transform from js/live-demo.js's own scroll entrance, which per the
   CSS Transforms spec makes IT the containing block for any
   position:fixed descendant instead of the viewport, so a manually
   fixed real element wouldn't track the viewport correctly either.

   Fix: build a lightweight "ghost" browser-frame — just the cloned
   .live-demo-browser-bar (no iframe, so nothing ever reloads) — as a
   plain child of #processRoom itself. Once GSAP pins #processRoom
   (making it fill the viewport), an ordinary absolutely-positioned
   child of it sits correctly on screen for free, no manual fixed-
   positioning math needed. When the pin releases, #processRoom (and
   the ghost with it) scrolls away exactly as the real, already-loaded
   #liveDemoSection scrolls into that same spot — a natural handoff
   with no coordination code required.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const processRoom = document.getElementById('processRoom');
  const matrixCanvas = document.getElementById('processHeroMatrix');
  const heroCopy = document.querySelector('.process-hero-copy');
  const realBar = document.querySelector('.live-demo-card .live-demo-browser-bar');
  if(!processRoom || !matrixCanvas || !heroCopy || !realBar) return;

  gsap.registerPlugin(ScrollTrigger);

  const ghost = document.createElement('div');
  ghost.className = 'process-portal-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.appendChild(realBar.cloneNode(true));
  const ghostBody = document.createElement('div');
  ghostBody.className = 'process-portal-ghost-body';
  ghost.appendChild(ghostBody);
  processRoom.appendChild(ghost);

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion){
    ghost.remove();
    return;
  }

  const mm = gsap.matchMedia();

  mm.add({
    isDesktop: '(min-width: 641px)',
    isMobile: '(max-width: 640px)',
  }, (context) => {
    const isDesktop = context.conditions.isDesktop;

    // starting state — pushed back, tilted, clipped down to a small
    // centered rect, ready to reveal. transformPerspective is set
    // directly on the ghost itself (not an ancestor) so this doesn't
    // need — or fight with — any perspective set elsewhere on the page.
    // BUG FIX: opacity:0 is essential here, not optional — without it
    // this small, clipped starting state is still a fully-painted dark
    // rounded rectangle sitting permanently in the middle of the hero
    // (centered via inset:0+margin:auto in CSS), visible from the very
    // first frame the page loads, long before the visitor has scrolled
    // anywhere near the portal reveal. Fading it in as PART of the same
    // reveal tween below is what actually keeps it invisible until the
    // moment it's meant to appear.
    gsap.set(ghost, {
      transformPerspective: 1200,
      transformOrigin: '50% 50%',
      z: isDesktop ? -250 : -120,
      scale: isDesktop ? 0.82 : 0.9,
      rotationX: isDesktop ? 8 : 0,
      clipPath: 'inset(38% 38% round 16px)',
      opacity: 0,
    });

    // BUG FIX: per report, "the hero section brings up a live demo
    // rectangle before we even reach the live demo." Root cause: the
    // hero (#processRoom) is exactly one viewport tall with nothing
    // extra to scroll through first, so ScrollTrigger's start:'bottom
    // bottom' resolves to ~scrollY 0 — the pin (and this whole
    // timeline) was engaging essentially at page load, and with only a
    // short +=120%/+=60% total scroll distance, the reveal (which sat
    // at 60%-100% of that short range) was playing out within roughly
    // the first single scroll of the page, long before the visitor had
    // any sense of "arriving" anywhere. The fix isn't to move `start`
    // (there's no later natural point on a 100vh section to move it
    // to) — it's to give the pin a much longer total scroll distance
    // and push every visible change deep into the tail of it, so
    // there's real "just read the hero" scroll runway before the
    // portal ever starts, let alone completes.
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
    // into the (now much longer) pin, and finishes at 75% — a real
    // dead zone first, then a gradual dolly-in, well ahead of the
    // reveal itself (transform+opacity only, per the 60fps requirement)
    tl.to(matrixCanvas, {
      scale: isDesktop ? 2.6 : 1.6,
      transformOrigin: '50% 50%',
      duration: 0.35,
      ease: 'none',
    }, 0.4);

    // hero text fades ONLY in the last 22% — not a whole-section
    // crossfade, per direct request
    tl.to(heroCopy, {
      opacity: 0,
      duration: 0.22,
      ease: 'none',
    }, 0.78);

    // the ghost browser fades in, reveals through the clip-path mask,
    // and settles out of its pushed-back/tilted entrance, same final
    // window as the text fade — both land together right as the pin
    // ends and hands off to the real live-demo section
    tl.to(ghost, {
      opacity: 1,
      clipPath: 'inset(0% 0% round 16px)',
      z: 0,
      scale: 1,
      rotationX: 0,
      duration: 0.22,
      ease: 'none',
    }, 0.78);

    // gsap.matchMedia auto-reverts everything created in this context
    // (the timeline + its ScrollTrigger) when the breakpoint changes —
    // no manual cleanup needed beyond that.
  });
})();
