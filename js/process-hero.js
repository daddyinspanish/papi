/* ===================================================================
   Papi — Process Hero + Our Process timeline
   Two independent jobs:
   1. Smooth-scrolling for both hero CTAs, replacing the browser's
      own instant anchor-jump with a real scrollIntoView so it reads
      as a natural, eased scroll rather than a snap.
   2. Building the "How It's Built" vertical timeline from STEPS below
      (single source of truth for the step copy/icons).

   This file used to also drive a click-to-open modal reveal panel,
   then (per a later direct request for a GSAP ScrollTrigger cinematic
   journey) a pinned, scroll-driven 3D depth-travel carousel built by
   js/scroll-journey-process.js. Per a further direct request, modeled
   on dentalscale.com's "How It Works" section, that's replaced again
   with a plain vertical timeline — numbered steps down a connecting
   line, alternating left/right, revealing on scroll like every other
   section on the page (js/scroll-reveal.js's existing [data-reveal]
   mechanism) instead of a bespoke pin/carousel. See this file's own
   git history if the swipeable/pinned version is ever needed again.
=================================================================== */
(function(){
  const hero = document.querySelector('.process-hero');
  const timeline = document.getElementById('processTimeline');
  if(!hero && !timeline) return;

  // per direct request: "make sure the steps do not come out as
  // double digits" — single digit (1/2/3/4), not the old zero-padded
  // 01/02/03/04. `tags` is a short, plain-language list of what that
  // phase actually covers — same spirit as dentalscale.com's own
  // per-step tag line, not a literal copy of their wording.
  const STEPS = [
    {
      index: '1',
      title: 'Discover',
      text: 'We start by learning your business inside and out — your goals, your customers, what’s working and what isn’t.',
      tags: 'Research · Goals · Competitors',
    },
    {
      index: '2',
      title: 'Steps',
      text: 'A clear, honest roadmap from first sketch to final launch, so you always know exactly what happens next.',
      tags: 'Roadmap · Milestones · Timeline',
    },
    {
      index: '3',
      title: 'Structure',
      text: 'Real, considered architecture beneath every page — built to hold up as your business grows, not just look good on day one.',
      tags: 'Content model · Navigation · SEO foundations',
    },
    {
      index: '4',
      title: 'Delivery',
      text: 'A finished site that’s fast, easy to manage, and ready to start bringing in business from day one.',
      tags: 'Launch · Handoff · Training',
    },
  ];

  if(timeline){
    const frag = document.createDocumentFragment();
    STEPS.forEach((step, i)=>{
      const el = document.createElement('div');
      el.className = 'process-timeline-step';
      el.setAttribute('data-reveal', '');
      el.innerHTML = `
        <div class="process-timeline-number">${step.index}</div>
        <div class="process-timeline-card">
          <p class="process-timeline-step-label">Step ${step.index}</p>
          <h3 class="process-timeline-title">${step.title}</h3>
          <p class="process-timeline-text">${step.text}</p>
          <p class="process-timeline-tags">${step.tags}</p>
        </div>`;
      frag.appendChild(el);
    });
    timeline.appendChild(frag);
  }

  // ===================================================================
  // smooth-scrolling hero CTAs (per direct request: "when we scroll
  // on the start a project can we slowly scroll... and not just snap
  // them", "when we click show our work are you able to stick scroll
  // into the live demo section, just like ... scrolling ... naturally")
  // — a plain <a href="#section"> jumps instantly with no sitewide
  // smooth-scroll CSS enabled, so this animates it manually instead.
  //
  // BUG FIX, found while verifying the new timeline above still works
  // end to end: a plain target.scrollIntoView({behavior:'smooth'})
  // here silently did nothing at all — confirmed directly (patched
  // Element.prototype.scrollIntoView to log calls: it WAS being
  // called, yet scrollY never moved from its starting position, for
  // as long as observed). Root cause: the hero is GSAP-pinned
  // (js/scroll-journey-hero.js), and a browser-native smooth-scroll
  // animates scrollY gradually over several frames — ScrollTrigger's
  // own per-frame recalculation fights that gradual change for as long
  // as the hero's pin is still the "active" one, effectively holding
  // scrollY in place. A plain instant window.scrollTo (no animation,
  // resolves in a single frame) reliably worked in the same repro,
  // confirming it's specifically the multi-frame animation that loses
  // the fight, not scrolling out of the pin at all. Routing the
  // animation through GSAP's own ticker instead (tweening a plain
  // proxy value, writing scrollY on every tick) sidesteps the conflict
  // the same way (deleted) js/scroll-journey-process.js's own
  // fastScrollTo() already proved out for an analogous GSAP-vs-native-
  // scroll conflict.
  // ===================================================================
  function bindSmoothScroll(selector){
    if(!hero) return;
    const link = hero.querySelector(selector);
    if(!link) return;
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      const target = targetId && document.querySelector(targetId);
      if(!target) return; // fall back to the plain anchor jump
      e.preventDefault();
      if(window.gsap){
        const startY = window.scrollY;
        const endY = target.getBoundingClientRect().top + window.scrollY;
        const proxy = { y: startY };
        gsap.to(proxy, {
          y: endY,
          duration: 1,
          ease: 'power2.inOut',
          onUpdate: () => window.scrollTo(0, proxy.y),
        });
      } else {
        // GSAP not loaded yet somehow (shouldn't happen — by the time a
        // visitor can click this, every deferred script has long since
        // run) — still scrolls, just without the pin-safe tweening above
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  bindSmoothScroll('.process-hero-cta');
  bindSmoothScroll('.process-hero-start');
})();
