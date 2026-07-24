/* ===================================================================
   Papi — Scroll Reveal
   Per direct request: "make the entire website feel more immersive, by
   adding more creative animation to every section so it feels like an
   immersive flow." A small, reusable IntersectionObserver-driven fade
   +rise entrance for any element marked [data-reveal] — applied across
   the section headings/eyebrows/subs that didn't already have their
   own scroll-driven motion (Live Demo's own scroll-position opacity
   and the Comparison chart's own draw-in are untouched; this fills in
   everywhere else so no section just snaps into view unanimated).
   One-shot: once an element has revealed, it's unobserved and stays
   revealed — scrolling back up shouldn't hide content already seen,
   and it avoids re-triggering the transition on every scroll pass.
=================================================================== */
(function(){
  const els = Array.from(document.querySelectorAll('[data-reveal]'));
  if(!els.length) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion || !('IntersectionObserver' in window)){
    els.forEach(el => el.classList.add('is-revealed'));
    return;
  }

  // data-reveal-delay="120" (ms) staggers a group of elements within
  // the same section — set once up front via inline style rather than
  // a CSS attribute selector, since the delay value itself is dynamic
  els.forEach(el => {
    const delay = el.dataset.revealDelay;
    if(delay) el.style.transitionDelay = `${delay}ms`;
  });

  // per direct follow-up feedback ("animations feel too stacked, make
  // sure they are smooth not jumpy") — was threshold:0.15/rootMargin
  // -8%, meaning an element only started revealing once already 15%
  // into the actual visible viewport, so the fade+rise played out
  // while it was being watched, mid-scroll. threshold:0 + a positive
  // bottom rootMargin fires as soon as the element is still BELOW the
  // fold (inside that extended zone), so by the time it's actually
  // scrolled into view the transition has already finished settling.
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      io.unobserve(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px 15% 0px' });

  els.forEach(el => io.observe(el));
})();
