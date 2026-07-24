/* ===================================================================
   Papi — Scroll Journey: See It Live -> How It's Built
   Per direct request: as the live-demo section ends, keep the browser
   frame pinned, scale it down, and crossfade only its internal content
   (chrome + iframe) — not the whole section — so it reads as "the
   completed website becoming the process used to build it."

   Deliberately NOT a pixel-matched morph onto the actual Discover panel
   element: that panel lives in a different, sequential section
   (#ourProcessSection) that isn't on screen yet at this point in the
   scroll — its own pin (js/scroll-journey-process.js) hasn't started,
   so its real on-screen position/size don't exist yet to measure
   against, and two simultaneously-pinned sections would fight for
   screen space (explicitly avoided per the technical requirements).
   Instead this fades the browser frame away as it shrinks; the Discover
   panel picks the beat back up with its own matching entrance the
   moment scroll-journey-process.js's pin begins, right after this one
   ends — a clean, sequential dissolve/reform rather than a fragile
   cross-section FLIP.

   BUG FIX: per report, "the ghost fade only works on the first live
   demo, it should work with all no matter what demo someone might be
   in" — this used to query only the FIRST .live-demo-card (the
   swipeable stack has 3), so if a visitor swiped to the 2nd or 3rd
   demo before scrolling down here, that visible card never dissolved
   at all while an off-screen one silently animated instead. Fixed by
   targeting EVERY card's browser/frame-wrap at once — GSAP tweens an
   array of elements identically, and since only the centered card is
   ever actually visible in the swipeable stack, animating all of them
   the same way looks identical to animating just the active one,
   without needing to detect or track which index is active at all.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const liveDemoSection = document.getElementById('liveDemoSection');
  const allBrowsers = Array.from(document.querySelectorAll('.live-demo-card .live-demo-browser'));
  const allFrameWraps = allBrowsers
    .map((browser) => browser.querySelector('.live-demo-frame-wrap'))
    .filter(Boolean);
  if(!liveDemoSection || !allBrowsers.length || !allFrameWraps.length) return;

  gsap.registerPlugin(ScrollTrigger);

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  const mm = gsap.matchMedia();

  mm.add({
    isDesktop: '(min-width: 641px)',
    isMobile: '(max-width: 640px)',
  }, (context) => {
    const isDesktop = context.conditions.isDesktop;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: liveDemoSection,
        pin: true,
        start: 'bottom bottom',
        end: isDesktop ? '+=100%' : '+=60%',
        scrub: 1,
      },
    });

    // the frame shrinks across the whole scrub range
    tl.to(allBrowsers, {
      scale: isDesktop ? 0.7 : 0.85,
      duration: 1,
      ease: 'none',
    }, 0);

    // crossfade ONLY the internal content (browser chrome + iframe) —
    // never a filter/blur on the iframe itself, opacity only
    tl.to(allFrameWraps, {
      opacity: 0,
      duration: 0.5,
      ease: 'none',
    }, 0.15);

    // the emptied frame itself dissolves away in the tail of the range,
    // handing off to the Discover panel's own entrance on the other
    // side of the cut
    tl.to(allBrowsers, {
      opacity: 0,
      duration: 0.4,
      ease: 'none',
    }, 0.6);
  });
})();
