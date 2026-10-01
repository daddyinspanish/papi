/* ===================================================================
   Papi — pause off-screen CSS animations
   Per report: "my iphone keeps getting hot". This codebase's own JS-
   driven effects already pause themselves off-screen (hero-matrix.js's
   canvas loop, cursor-trail.js, scroll-dolly.js's will-change toggling)
   but the ~15 purely CSS "infinite" keyframe animations sitewide (glow
   pulses, shines, sweeps) had nothing to ever stop them — real,
   sustained compositor/paint work for sections the visitor has long
   since scrolled past. One IntersectionObserver per group toggles
   .is-anim-idle (see css/style.css) on the group's container plus its
   specific animated descendants the moment the container leaves the
   viewport, and removes it the moment it's back.

   Dead/unrendered CSS (no matching elements in the DOM right now, so
   not a runtime cost regardless) is deliberately left out: .hero-
   headline-char, .hero-trusted-track, .process-neon-link. The
   desktop-only cursor-ring glow is also left out — js/cursor.js already
   fully disables that whole feature on touch devices via its own
   (hover:none),(pointer:coarse) check, so it was never a factor on
   iPhone to begin with.

   #ourProcessSection used to need an entry here (its old pinned 3D
   panel carousel had a continuously-running title shine) — removed
   entirely now that section is a plain vertical timeline with no
   infinite CSS animation left to pause (see js/process-hero.js).

   BUG FIX, found while this file still had that entry: `extra` used to
   be resolved to a fixed `els` array ONCE, when this IIFE first ran —
   fine for every other group (their `extra` selectors are all plain
   static markup, already in the DOM by the time any deferred script
   runs), but .process-reveal-title's 4 real copies are built by
   js/scroll-journey-process.js, which runs LATER in script order (see
   index.html) — only the one static default panel existed yet when
   this file's old fixed snapshot was taken, so the other 3 silently
   never got toggled at all, forever. Re-querying `extra` live inside
   the observer callback (which only ever fires later, well after every
   deferred script has finished) fixes this generically, without
   needing to special-case which groups involve dynamically-built
   markup and which don't.
=================================================================== */
(function(){
  if(!('IntersectionObserver' in window)) return;

  const GROUPS = [
    { root: '#hero', extra: ['.process-room-grain', '.process-hero-copy', '.process-hero-title', '.process-hero-cta', '.process-hero-start'] },
    { root: '#liveDemoSection', extra: ['.process-arrival-flame', '.live-demo-gas'] },
    { root: '#testimonialsSection', extra: ['.testimonials-hint-icon'] },
    { root: '#faqSection', extra: [] },
    { root: '#quoteSection', extra: ['.quote-heading', '.quote-heading-shine', '.quote-form-title', '.quote-submit'] },
  ];

  GROUPS.forEach(({ root, extra }) => {
    const container = document.querySelector(root);
    if(!container) return;

    const io = new IntersectionObserver((entries) => {
      const idle = !entries[0].isIntersecting;
      container.classList.toggle('is-anim-idle', idle);
      extra.forEach(sel => container.querySelectorAll(sel).forEach(el => el.classList.toggle('is-anim-idle', idle)));
    }, { threshold: 0 });
    io.observe(container);
  });
})();
