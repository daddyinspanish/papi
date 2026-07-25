/* ===================================================================
   Papi — Process Hero + Our Process interactions
   Two independent jobs (used to be three — see js/scroll-journey-
   process.js for what replaced the old job #1 below):
   1. Smooth-scrolling for both hero CTAs, replacing the browser's
      own instant anchor-jump with a real scrollIntoView so it reads
      as a natural, eased scroll rather than a snap.
   2. Pausing the hotspot dots' pulse once #ourProcessSection scrolls
      out of view.

   The old job #1 here used to be a click-to-open modal reveal panel
   (one shared overlay, radial-gradient-anchored at whichever hotspot
   was clicked, with a hero-title dissolve/glitch tied to its open/
   close state). Per direct request for a GSAP ScrollTrigger cinematic
   journey through the 4 steps, that's fully replaced by
   js/scroll-journey-process.js's own pinned, scroll-driven depth-travel
   panels — hotspot clicks now scroll to that step's position in the
   pinned sequence instead of opening a modal, and the hotspot dots'
   is-active/is-emphasized/is-loaded states and #processTrackFill are
   now driven continuously by scroll progress there instead of by click
   count here. STEPS below is still this file's own responsibility
   (single source of truth for the step copy/icons) — exposed on
   window so the new file can build its panels from the same data
   without duplicating any copy.
=================================================================== */
(function(){
  const hero = document.querySelector('.process-hero');
  const stepsSection = document.querySelector('.our-process-section');
  if(!hero && !stepsSection) return;

  // per direct request: "make sure the steps do not come out as
  // double digits" — single digit (1/2/3/4), not the old zero-padded
  // 01/02/03/04. Per a later direct request ("add icons to the
  // steps, to show more life") each step also carries its own inline-
  // SVG inner markup (no outer <svg> tag).
  const STEPS = {
    discover: {
      index: '1',
      title: 'Discover',
      text: 'We start by learning your business inside and out — your goals, your customers, what’s working and what isn’t.',
      icon: '<circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20"/>',
    },
    steps: {
      index: '2',
      title: 'Steps',
      text: 'A clear, honest roadmap from first sketch to final launch, so you always know exactly what happens next.',
      icon: '<path d="M4 20v-4h4v-4h4v-4h4v-4h4"/>',
    },
    structure: {
      index: '3',
      title: 'Structure',
      text: 'Real, considered architecture beneath every page — built to hold up as your business grows, not just look good on day one.',
      icon: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.2"/>',
    },
    delivery: {
      index: '4',
      title: 'Delivery',
      text: 'A finished site that’s fast, easy to manage, and ready to start bringing in business from day one.',
      icon: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    },
  };

  // js/scroll-journey-process.js builds its 4 depth-travel panels from
  // this exact same data (single source of truth, no copy duplicated
  // in HTML) — the DOM order of the hotspot buttons below is the
  // canonical step order.
  window.PapiSteps = STEPS;
  window.PapiStepOrder = ['discover', 'steps', 'structure', 'delivery'];

  // ===================================================================
  // 1. smooth-scrolling hero CTAs (per direct request: "when we scroll
  // on the start a project can we slowly scroll... and not just snap
  // them", "when we click show our work are you able to stick scroll
  // into the live demo section, just like ... scrolling ... naturally")
  // — a plain <a href="#section"> jumps instantly with no sitewide
  // smooth-scroll CSS enabled (see this site's own established
  // convention of doing this per-link via scrollIntoView rather than a
  // global scroll-behavior, e.g. the old process-room's own neon quick
  // nav); this matches that same pattern for both hero CTAs
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
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  bindSmoothScroll('.process-hero-cta');
  bindSmoothScroll('.process-hero-start');

  // ===================================================================
  // 2. pause the hotspot dots' pulse once #ourProcessSection scrolls
  // out of view
  // ===================================================================
  // per direct request: "make the dots stop pulsing when the viewer is
  // in section 2, and when they get back to section 1 they start
  // glowing again" — style.css's own processHotspotPulse keyframe runs
  // "infinite" with nothing to ever stop it, so it kept animating
  // (box-shadow, which forces a repaint each cycle) for the rest of the
  // session even once this section was long scrolled past. Toggling
  // one class here — driven by real intersection, not a viewport-size
  // media query — is what makes this apply identically on desktop and
  // mobile. Now observes stepsSection (where the dots actually live)
  // instead of the hero.
  if(stepsSection && 'IntersectionObserver' in window){
    const stepsVisibilityIO = new IntersectionObserver((entries) => {
      stepsSection.classList.toggle('is-scrolled-away', !entries[0].isIntersecting);
    }, { threshold: 0 });
    stepsVisibilityIO.observe(stepsSection);
  }
})();
