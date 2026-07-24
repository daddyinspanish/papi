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
  // BUG FIX: per report, "after i scroll from one live demo onto the
  // next section, the title of the live demo stays there while
  // everything else fades out" — this dissolve only ever touched the
  // browser cards themselves; the eyebrow/title/sub/dots above them
  // were never part of it, so they just sat there fully opaque for the
  // whole pin (including after the cards had already dissolved away),
  // then abruptly vanished the instant the pin released. Fading them
  // out together with the cards makes the whole section dissolve as
  // one cohesive moment instead of leaving stranded text behind.
  const restOfSection = ['.live-demo-eyebrow', '.live-demo-title', '.live-demo-sub', '.live-demo-controls']
    .map((sel) => document.querySelector(sel))
    .filter(Boolean);
  // FURTHER BUG FIX (found during full-site verification pass, same bug
  // class as above but one level deeper): each .live-demo-card renders
  // its own name/industry/"Visit full site" caption (js/live-demo.js)
  // as SIBLINGS of .live-demo-browser, not children of it — so the
  // allBrowsers/allFrameWraps tweens above never touched them either.
  // Without this, the active card's company name+link visibly hung in
  // place after the browser frame itself had already dissolved away.
  const allCaptions = Array.from(document.querySelectorAll('.live-demo-card .live-demo-name, .live-demo-card .live-demo-industry, .live-demo-card .live-demo-visit'));
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

    // eyebrow/title/sub/dots fade out together with the cards, same
    // tail window, so nothing gets left behind on screen
    if(restOfSection.length){
      tl.to(restOfSection, {
        opacity: 0,
        duration: 0.4,
        ease: 'none',
      }, 0.6);
    }

    // each card's own name/industry/visit-link caption, same tail
    // window as the browser it belongs to — see FURTHER BUG FIX note
    // above for why this needed its own tween
    if(allCaptions.length){
      tl.to(allCaptions, {
        opacity: 0,
        duration: 0.4,
        ease: 'none',
      }, 0.6);
    }
  });
})();
