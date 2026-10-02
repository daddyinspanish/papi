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
    // the fill is a real element (not a pseudo-element) so it has an
    // actual box updateTimelineProgress() below can scale — see its
    // own CSS comment for why this couldn't just be .process-
    // timeline::before directly
    const fill = document.createElement('div');
    fill.className = 'process-timeline-fill';
    fill.setAttribute('aria-hidden', 'true');
    timeline.appendChild(fill);

    // per direct request: step 4 (the last one) gets a shake-then-
    // explode "delivery" animation instead of just scrolling off like
    // steps 1-3 — these are the shards that burst out of its ball; see
    // the .ptn-shard rules in css/style.css for the actual animation
    const SHARD_ANGLES = [0, 60, 120, 180, 240, 300];
    const finalShardsHTML = SHARD_ANGLES
      .map(angle => `<span class="ptn-shard" style="--angle:${angle}deg"></span>`)
      .join('');

    const frag = document.createDocumentFragment();
    STEPS.forEach((step, i)=>{
      const isFinal = i === STEPS.length - 1;
      const el = document.createElement('div');
      el.className = 'process-timeline-step';
      el.setAttribute('data-reveal', '');
      el.innerHTML = `
        <div class="process-timeline-number${isFinal ? ' process-timeline-number--final' : ''}">${step.index}${isFinal ? finalShardsHTML : ''}</div>
        <div class="process-timeline-card">
          <p class="process-timeline-step-label">Step ${step.index}</p>
          <h3 class="process-timeline-title">${step.title}</h3>
          <p class="process-timeline-text">${step.text}</p>
          <p class="process-timeline-tags">${step.tags}</p>
        </div>`;
      frag.appendChild(el);
    });
    timeline.appendChild(frag);

    // ===================================================================
    // per direct request: "the number line... actually animates from 1
    // number to the other as it scrolls, with a neon pulsing line that
    // fills the numbers, and also make the step 1 pop up as the scroll
    // is in 1, then from 2 the step 2 pulses pop up as well until 4" —
    // the fill line's own height (as a share of the whole timeline)
    // tracks a fixed "reading line" partway down the viewport, and each
    // number pops into its active gold state the moment that reading
    // line reaches it, cumulatively (earlier numbers stay active, same
    // convention as every other scroll-tied effect on this site
    // reversing cleanly if the visitor scrolls back up).
    // ===================================================================
    const numberEls = Array.from(timeline.querySelectorAll('.process-timeline-number'));

    // ===================================================================
    // per direct request: "for step 4, an animation like it just filled
    // up and exploded, as a delivery animation... after they read step
    // 4 and try to scroll the ball shakes and it explodes onto what
    // clients say about their website" — the ball itself (see its
    // .is-exploding rules in css/style.css) only shakes/explodes once
    // step 4 has already popped active AND the visitor keeps scrolling
    // past it, same cumulative-progress reversibility as .is-active so
    // scrolling back up before it fully leaves cancels it cleanly. The
    // instant it fires (false -> true transition, not every frame it
    // stays true) a matching glow pulses behind "What business owners
    // say" below, so the burst reads as carrying down into that section
    // rather than just vanishing into nothing.
    // ===================================================================
    const finalNumber = numberEls[numberEls.length - 1];
    const impactGlow = document.querySelector('.testimonials-impact-glow');
    let finalWasExploding = false;
    let impactTimeout = null;
    function triggerDeliveryImpact(){
      if(!impactGlow) return;
      impactGlow.classList.remove('is-impact');
      void impactGlow.offsetWidth; // restart the keyframe if it's retriggered
      impactGlow.classList.add('is-impact');
      if(impactTimeout) clearTimeout(impactTimeout);
      impactTimeout = setTimeout(()=> impactGlow.classList.remove('is-impact'), 900);
    }

    let timelineTicking = false;
    function updateTimelineProgress(){
      const rect = timeline.getBoundingClientRect();
      // a touch below true viewport center — a number popping just
      // before it's fully centered reads as responsive rather than late
      const referenceY = window.innerHeight * 0.6;
      const raw = (referenceY - rect.top) / rect.height;
      const progress = Math.max(0, Math.min(1, raw));
      timeline.style.setProperty('--timeline-progress', progress.toFixed(4));

      // BUG FIX: found via direct inspection — offsetTop is relative to
      // an element's own closest *positioned* ancestor, which here is
      // each number's own .process-timeline-step wrapper (also
      // position:relative, for the grid/z-index above), not the overall
      // .process-timeline container. That silently returned near-
      // identical small values for every number regardless of which
      // step it was in, activating all 4 at once almost immediately.
      // getBoundingClientRect() on both and subtracting sidesteps the
      // offsetParent chain entirely — always correct regardless of how
      // many positioned ancestors sit in between.
      numberEls.forEach((num)=>{
        const numRect = num.getBoundingClientRect();
        const numCenterY = (numRect.top + numRect.height / 2) - rect.top;
        const numProgress = numCenterY / rect.height;
        num.classList.toggle('is-active', progress >= numProgress);
      });

      // "try to scroll" past step 4 = the whole timeline has scrolled
      // mostly above the viewport already (not just read — left behind)
      const isPastTimeline = rect.bottom < window.innerHeight * 0.2;
      const finalIsExploding = !!(finalNumber && finalNumber.classList.contains('is-active') && isPastTimeline);
      if(finalIsExploding && !finalWasExploding) triggerDeliveryImpact();
      finalWasExploding = finalIsExploding;
      if(finalNumber) finalNumber.classList.toggle('is-exploding', finalIsExploding);
    }
    function requestTimelineUpdate(){
      if(timelineTicking) return;
      timelineTicking = true;
      requestAnimationFrame(()=>{ updateTimelineProgress(); timelineTicking = false; });
    }
    window.addEventListener('scroll', requestTimelineUpdate, { passive:true });
    // width-only guard — same iOS-address-bar-collapse reasoning as
    // every other resize listener on this site (see the --stable-vh
    // comment in index.html's <head>)
    let lastResizeWTimeline = window.innerWidth;
    window.addEventListener('resize', ()=>{
      const w = window.innerWidth;
      if(Math.abs(w - lastResizeWTimeline) <= 10) return;
      lastResizeWTimeline = w;
      requestTimelineUpdate();
    });
    updateTimelineProgress();

    // per the site-wide heat audit convention (js/anim-idle.js): the
    // fill's own continuous neon-glow pulse costs nothing once this
    // section is scrolled well past, so it's paused the same way
    // everything else "infinite" on this page is — one Intersection
    // Observer, toggling .is-anim-idle.
    if('IntersectionObserver' in window){
      const timelineIO = new IntersectionObserver((entries)=>{
        fill.classList.toggle('is-anim-idle', !entries[0].isIntersecting);
      }, { threshold: 0 });
      timelineIO.observe(timeline);
    }
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
})();
