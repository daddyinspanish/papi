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
   headline-char, .hero-trusted-track, .process-neon-link, .process-
   stage-digits-a/-b. The desktop-only cursor-ring glow is also left
   out — js/cursor.js already fully disables that whole feature on
   touch devices via its own (hover:none),(pointer:coarse) check, so it
   was never a factor on iPhone to begin with. .process-hotspot-dot's
   pulse already has its own pause mechanism (see process-hero.js's
   is-scrolled-away toggle) so it's left out here too.
=================================================================== */
(function(){
  if(!('IntersectionObserver' in window)) return;

  const GROUPS = [
    { root: '#hero', extra: ['.process-room-grain', '.process-hero-copy', '.process-hero-title', '.process-hero-cta'] },
    { root: '#liveDemoSection', extra: ['.process-arrival-flame'] },
    { root: '#testimonialsSection', extra: ['.testimonials-hint-icon'] },
    { root: '#comparisonSection', extra: ['.comparison-title em', '.comparison-line--papi', '.comparison-stat-number'] },
    { root: '#faqSection', extra: [] },
    { root: '#quoteSection', extra: ['.quote-heading', '.quote-heading-shine', '.quote-form-title', '.quote-submit'] },
  ];

  GROUPS.forEach(({ root, extra }) => {
    const container = document.querySelector(root);
    if(!container) return;
    const els = [container];
    extra.forEach(sel => container.querySelectorAll(sel).forEach(el => els.push(el)));

    const io = new IntersectionObserver((entries) => {
      const idle = !entries[0].isIntersecting;
      els.forEach(el => el.classList.toggle('is-anim-idle', idle));
    }, { threshold: 0 });
    io.observe(container);
  });
})();
