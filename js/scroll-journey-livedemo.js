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

  // ---------------------------------------------------------------
  // PAGE WIPE into the next section, per direct request: "make the next
  // section fold up, more like a page wipe up right as the iframes are
  // zooming and disappearing". While the demo is pinned and zooming out,
  // the section after it (#ourProcessSection) is held STILL at the top of
  // the screen — its own scroll-up is cancelled with a counter-translate —
  // and an edge sweeps from the bottom of the screen to the top, revealing
  // it (a soft mask, not a hard clip). The sweep starts shortly after the
  // zoom-out begins and finishes exactly as the pin releases, at which
  // point the counter-translate is exactly zero, so it hands back to normal
  // scrolling with no jump. Driven by the pin's own scroll progress, so it
  // reverses cleanly scrolling back up.
  // ---------------------------------------------------------------
  const stepsEl = document.getElementById('ourProcessSection');
  let wipeTy = 0;
  let wipeOn = false;
  function clearWipe(){
    if(!stepsEl || !wipeOn) return;
    wipeOn = false;
    wipeTy = 0;
    stepsEl.style.transform = '';
    stepsEl.style.webkitMaskImage = '';
    stepsEl.style.maskImage = '';
    stepsEl.style.pointerEvents = '';
  }
  const WIPE_START = 0.16;  // fraction of the pin where the edge begins to rise
  let wipeLastP = 0;
  function applyWipe(p, again){
    if(!stepsEl) return;
    wipeLastP = p;
    // the section's un-translated top edge, however far down it still is
    const nat = stepsEl.getBoundingClientRect().top - wipeTy;
    if(p <= 0 || nat <= 0){ clearWipe(); return; }
    // the pin switches the demo out of normal flow, which moves this section
    // up; on a big jump straight into the range that happens AFTER the first
    // measurement above, so re-measure once on the next frame
    if(again !== false) requestAnimationFrame(() => applyWipe(wipeLastP, false));
    wipeOn = true;
    wipeTy = -nat;
    const t = Math.max(0, Math.min(1, (p - WIPE_START) / (1 - WIPE_START)));
    const q = t * t * (3 - 2 * t);                 // edge position: 0 = bottom, 1 = top
    const vh = window.innerHeight;
    const soft = Math.min(140, vh * 0.14);          // feathered edge
    const edge = (1 - q) * (vh + soft) - soft;      // y where the mask starts to open
    const mask = `linear-gradient(to bottom, transparent ${edge.toFixed(1)}px, #000 ${(edge + soft).toFixed(1)}px)`;
    stepsEl.style.transform = `translate3d(0, ${wipeTy.toFixed(1)}px, 0)`;
    stepsEl.style.webkitMaskImage = mask;
    stepsEl.style.maskImage = mask;
    stepsEl.style.pointerEvents = 'none';          // invisible/partial: never steal clicks from the demo
  }

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
        // per direct request ("after the iframe zooms out, have the next
        // section come up so it's a smooth transition"): no blank spacer
        // after the pin, so the next section starts rising the moment the
        // zoom-out begins and slides up OVER the shrinking, fading demo
        // (it paints above this one: same z-index, later in the page)
        // instead of the demo emptying out and the page then jumping on
        pinSpacing: false,
        start: 'bottom bottom',
        // same scroll distance on phones now (it was shorter): the wipe has
        // to span exactly one screen of scrolling to land flush at the end
        end: '+=100%',
        scrub: 1,
        onUpdate: (self) => applyWipe(self.progress),
        onLeave: clearWipe,
        onLeaveBack: clearWipe,
      },
    });

    // the frame shrinks across the whole scrub range
    tl.to(allBrowsers, {
      scale: isDesktop ? 0.7 : 0.85,
      duration: 1,
      ease: 'sine.inOut',
    }, 0);

    // crossfade ONLY the internal content (browser chrome + iframe) —
    // never a filter/blur on the iframe itself, opacity only
    tl.to(allFrameWraps, {
      opacity: 0,
      duration: 0.5,
      ease: 'sine.inOut',
    }, 0.15);

    // the emptied frame itself dissolves away in the tail of the range,
    // handing off to the Discover panel's own entrance on the other
    // side of the cut
    tl.to(allBrowsers, {
      opacity: 0,
      duration: 0.4,
      ease: 'sine.inOut',
    }, 0.6);

    // eyebrow/title/sub/dots fade out together with the cards, same
    // tail window, so nothing gets left behind on screen
    if(restOfSection.length){
      tl.to(restOfSection, {
        opacity: 0,
        duration: 0.4,
        ease: 'sine.inOut',
      }, 0.6);
    }

    // each card's own name/industry/visit-link caption, same tail
    // window as the browser it belongs to — see FURTHER BUG FIX note
    // above for why this needed its own tween
    if(allCaptions.length){
      tl.to(allCaptions, {
        opacity: 0,
        duration: 0.4,
        ease: 'sine.inOut',
      }, 0.6);
    }

    // if the breakpoint flips (rotation / resize) drop any wipe in progress
    return () => clearWipe();
  });
})();
