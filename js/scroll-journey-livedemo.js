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
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const liveDemoSection = document.getElementById('liveDemoSection');
  const firstBrowser = document.querySelector('.live-demo-card .live-demo-browser');
  const frameWrap = firstBrowser ? firstBrowser.querySelector('.live-demo-frame-wrap') : null;
  if(!liveDemoSection || !firstBrowser || !frameWrap) return;

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
    tl.to(firstBrowser, {
      scale: isDesktop ? 0.7 : 0.85,
      duration: 1,
      ease: 'none',
    }, 0);

    // crossfade ONLY the internal content (browser chrome + iframe) —
    // never a filter/blur on the iframe itself, opacity only
    tl.to(frameWrap, {
      opacity: 0,
      duration: 0.5,
      ease: 'none',
    }, 0.15);

    // the emptied frame itself dissolves away in the tail of the range,
    // handing off to the Discover panel's own entrance on the other
    // side of the cut
    tl.to(firstBrowser, {
      opacity: 0,
      duration: 0.4,
      ease: 'none',
    }, 0.6);
  });
})();
