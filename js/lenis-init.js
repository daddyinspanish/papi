/* ===================================================================
   Papi — smooth scroll (Lenis)
   Eases wheel/trackpad input into real, native window.scrollTo() calls
   on its own rAF loop — window.scrollY stays a real, correct value at
   all times, it just arrives smoothly instead of jumping. That's why
   every other scroll-reading script on this site (scroll-dolly.js,
   scroll-progress.js, title-dock.js, etc.) needs no changes: they're
   already just reading window.scrollY / getBoundingClientRect(), which
   stay accurate either way.

   Touch is deliberately left untouched (syncTouch:false, Lenis's own
   default, set explicitly here for clarity) — this site's entire
   scroll-bug history is almost all iOS Safari / in-app-browser related,
   so this upgrade is scoped to desktop wheel/trackpad feel only. Mobile
   scrolls exactly as it does today.

   Skipped entirely under prefers-reduced-motion, same convention as
   every GSAP ScrollTrigger pin on this site (see scroll-journey-*.js).
=================================================================== */
(function(){
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;
  if(!window.Lenis || !window.gsap || !window.ScrollTrigger) return;

  var lenis = new Lenis({
    duration: 1.15,
    easing: function(t){ return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
    smoothWheel: true,
    syncTouch: false,
  });

  // keep ScrollTrigger's own scroll measurement in sync every Lenis frame
  lenis.on('scroll', ScrollTrigger.update);

  // drive Lenis off GSAP's own rAF ticker instead of a second, separate
  // one — the required pairing per Lenis+GSAP's documented integration.
  // lagSmoothing(0) stops GSAP's tab-backgrounding catch-up behavior
  // from fighting Lenis's own frame timing on return to the tab.
  gsap.ticker.add(function(time){ lenis.raf(time * 1000); });
  gsap.ticker.lagSmoothing(0);

  // keep Lenis's own scroll-bound cache (dimensions/limit) in sync with
  // GSAP's real, measured document height every time ScrollTrigger
  // refreshes — covers every existing/future refresh call site in this
  // codebase (e.g. scroll-journey-process.js's own load+600ms and
  // body-ResizeObserver-driven refreshes) with no duplicated logic here.
  // Deliberately NOT calling ScrollTrigger.refresh() ourselves at this
  // point — this file runs before the three scroll-journey-*.js files
  // have created any pins yet, and an early forced refresh here was
  // found (via direct testing) to intermittently suppress GSAP's own
  // later automatic refresh once those pins actually exist, leaving
  // pin-spacers uncreated and the whole page's scrollable height stuck
  // at one viewport. Letting GSAP's existing, already-correctly-timed
  // refresh calls be the only ones keeps this in sync without fighting
  // GSAP's own internal scheduling.
  ScrollTrigger.addEventListener('refresh', function(){ lenis.resize(); });

  window.Papi = window.Papi || {};
  window.Papi.lenis = lenis;
})();
