/* ===================================================================
   Papi — Scroll Journey: How It's Built (400vh pinned depth sequence)
   Per direct request: turn the 4 process steps into one pinned,
   scroll-controlled sequence (~400vh) — each active panel moves to
   { z:0, opacity:1, scale:1, rotationY:0 }, the previous one to
   { xPercent:-55, z:-240, rotationY:12, scale:0.82, opacity:0.3 }, the
   next one to the mirrored { xPercent:55, z:-240, rotationY:-12,
   scale:0.82, opacity:0.3 } — continuous, scrubbed, with momentum
   handed off from step to step rather than a repeated fade-in.

   Builds its 4 .process-panel elements from window.PapiSteps
   (js/process-hero.js's own single source of truth for the step copy/
   icons — set on window there specifically so this file doesn't
   duplicate any content). The hotspot dots stay exactly where they
   already were; this file just takes over what drives their
   is-active/is-loaded state and #processTrackFill (continuously, by
   scroll progress) instead of process-hero.js's old click-count
   version, and repoints their click handler at a scrollTo instead of
   the old modal.

   Implementation note: every panel's position is driven by a single
   continuous function of "distance in steps from the currently active
   one" (r = panelIndex - activeFloat) rather than four separate
   discrete tweens — this is what makes the handoff between steps read
   as one continuous, momentum-carrying motion instead of four
   independent fade-ins.
=================================================================== */
(function(){
  if(!window.gsap || !window.ScrollTrigger) return;

  const section = document.getElementById('ourProcessSection');
  const stage = document.getElementById('processStage');
  const glow = stage ? stage.querySelector('.process-stage-glow') : null;
  const trackFill = document.getElementById('processTrackFill');
  const hotspotLine = document.getElementById('processHotspotLine');
  const hotspots = hotspotLine ? Array.from(hotspotLine.querySelectorAll('.process-hotspot')) : [];
  const STEPS = window.PapiSteps;
  const ORDER = window.PapiStepOrder;
  if(!section || !stage || !STEPS || !ORDER || !ORDER.length) return;

  gsap.registerPlugin(ScrollTrigger);

  // ---- per direct request: "add matrix effect numbers animating left
  // to right and right to left... to add more life" — two rows of
  // digits drifting behind the panels in opposite directions, echoing
  // the hero's own falling-number rain (js/hero-matrix.js) but
  // horizontal here rather than vertical, since this stage is wide and
  // shallow rather than tall. Pure CSS transform loops (no canvas, no
  // rAF) — cheap, and the content is generated once here rather than
  // hardcoded in index.html since this file already owns building
  // everything else inside #processStage.
  (function buildDigitMarquee(){
    const DIGITS = '0123456789';
    function randomDigits(len){
      let out = '';
      for(let i = 0; i < len; i++) out += DIGITS[(Math.random() * DIGITS.length) | 0];
      return out;
    }
    // spaced into groups purely for visual rhythm (matches the hero
    // matrix's own single-column-of-digits look less than it echoes a
    // ticking readout) — content is decorative, not real data
    function randomRow(){
      const groups = [];
      for(let i = 0; i < 18; i++) groups.push(randomDigits(4));
      return groups.join('  ');
    }
    ['process-stage-digits-a', 'process-stage-digits-b'].forEach((cls) => {
      const row = document.createElement('div');
      row.className = 'process-stage-digits ' + cls;
      row.setAttribute('aria-hidden', 'true');
      const track = document.createElement('span');
      track.className = 'process-stage-digits-track';
      const text = randomRow();
      track.textContent = text + '  ' + text; // doubled for a seamless -50% loop
      row.appendChild(track);
      stage.appendChild(row);
    });
  })();

  // ---- build the 4 panels from the shared STEPS data ----
  const panels = ORDER.map((key) => {
    const data = STEPS[key];
    if(!data) return null;
    const panel = document.createElement('div');
    panel.className = 'process-panel';
    panel.dataset.step = key;
    panel.innerHTML =
      '<svg class="process-reveal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + data.icon + '</svg>' +
      '<span class="process-reveal-index">' + data.index + '</span>' +
      '<h3 class="process-reveal-title">' + data.title + '</h3>' +
      '<p class="process-reveal-text">' + data.text + '</p>';
    stage.appendChild(panel);
    return panel;
  }).filter(Boolean);

  const n = panels.length;
  if(!n) return;

  function clamp01(v){ return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  // BUG FIX: per follow-up request ("remove any mechanical or linear
  // movement... use smoother easing with longer acceleration and
  // deceleration") — stateAt() below used t=ar directly, so a panel's
  // blend between active/previous/next moved at constant speed relative
  // to scroll distance from the active step. Easing t through this
  // curve before every lerp() makes each panel decelerate as it settles
  // into "active" and accelerate away from it, instead of moving at a
  // flat rate the whole time — same start/end values, same scrub
  // timing, just a softer curve in between.
  function easeInOutCubic(t){ return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // BUG FIX: at the exact midpoint between two steps (activeFloat === i+0.5),
  // BOTH neighboring panels sit at t=0.5 simultaneously — under the shared
  // easeInOutCubic curve that blended to opacity 0.65 for both at once,
  // while xPercent had only moved them ~27% apart. Two similarly-sized text
  // blocks at 65% opacity, a quarter-width apart, double-expose into
  // unreadable overlapping text. Giving opacity its own steeper curve (via
  // OPACITY_FALLOFF) makes it reach its target well before t=1, so the
  // outgoing panel is already faint and the incoming panel already solid by
  // the time they'd otherwise visually cross — position/rotation/scale keep
  // using the original curve, so the motion itself is unchanged.
  const OPACITY_FALLOFF = 1.7;
  function easeOpacity(t){ return easeInOutCubic(clamp01(t * OPACITY_FALLOFF)); }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion){
    panels.forEach((p) => { p.style.opacity = '1'; });
    if(trackFill) trackFill.style.transform = 'scaleX(1)';
    return;
  }

  // ---- state keyframes, exactly per direct spec ----
  const DESKTOP_STATE = {
    active:   { xPercent: 0,   z: 0,    rotationY: 0,   scale: 1,    opacity: 1   },
    previous: { xPercent: -55, z: -240, rotationY: 12,  scale: 0.82, opacity: 0.3 },
    next:     { xPercent: 55,  z: -240, rotationY: -12, scale: 0.82, opacity: 0.3 },
    hidden:   { xPercent: 0,   z: -400, rotationY: 0,   scale: 0.7,  opacity: 0   },
  };
  // mobile: per direct request, "remove heavy Z-depth and use shorter
  // slide/scale transitions" — no z/rotationY at all, smaller travel.
  // BUG FIX: per follow-up report, "you can barely read things because
  // one step is seen behind the other" — on a narrow mobile screen,
  // panels are wide relative to the viewport, so even a large %
  // shift still leaves real overlap while a panel is mid-transition
  // (this is a continuous scrub, not a set of 4 discrete snaps — most
  // of the scroll range IS "mid-transition"). Combined with the
  // z-index fix above (so the active panel's own opaque background
  // now properly sits in front of, not beside, its neighbors), pushed
  // this further still: previous/next are nearly off-screen (±92%)
  // and faint enough (0.14) to read as a background hint rather than
  // competing, readable text.
  const MOBILE_STATE = {
    active:   { xPercent: 0,   rotationY: 0, scale: 1,    opacity: 1    },
    previous: { xPercent: -92, rotationY: 0, scale: 0.8,  opacity: 0.14 },
    next:     { xPercent: 92,  rotationY: 0, scale: 0.8,  opacity: 0.14 },
    hidden:   { xPercent: 0,   rotationY: 0, scale: 0.72, opacity: 0    },
  };

  // blends smoothly between the named states based on r = signed
  // distance (in step-units) from "currently active": 0 at active,
  // -1 fully previous, +1 fully next, |r|>=2 fully hidden — continuous
  // in between, which is what carries momentum from step to step
  // instead of four separate fade-ins.
  function stateAt(states, r){
    const ar = Math.abs(r);
    let from, to, t;
    if(ar <= 1){
      from = states.active;
      to = r < 0 ? states.previous : states.next;
      t = ar;
    } else {
      from = r < 0 ? states.previous : states.next;
      to = states.hidden;
      t = clamp01(ar - 1);
    }
    const out = {};
    const et = easeInOutCubic(t);
    const etOpacity = easeOpacity(t);
    Object.keys(states.active).forEach((k) => { out[k] = lerp(from[k], to[k], k === 'opacity' ? etOpacity : et); });
    return out;
  }

  const loadedSteps = new Set();
  let liveTrigger = null;

  function markLoaded(activeIndex){
    if(loadedSteps.has(activeIndex)) return;
    loadedSteps.add(activeIndex);
    const h = hotspots[activeIndex];
    if(!h) return;
    h.classList.add('is-loaded');
    const numEl = h.querySelector('.process-hotspot-number');
    if(numEl) numEl.textContent = '✓';
  }

  function render(states, progress){
    const activeFloat = progress * (n - 1);

    panels.forEach((panel, i) => {
      const r = i - activeFloat;
      const s = stateAt(states, r);
      gsap.set(panel, s);
      panel.style.pointerEvents = s.opacity > 0.05 ? 'auto' : 'none';
      // BUG FIX: per report, "you can barely read things because one
      // step is seen behind the other" — every panel shared the same
      // CSS z-index, so they painted in plain DOM order regardless of
      // which one was actually "active," meaning a later panel could
      // visually sit on TOP of the active one's text instead of
      // cleanly behind it. Ranking z-index by closeness to active here
      // guarantees whichever panel is most "in front" conceptually is
      // also literally on top, so its own opaque background properly
      // occludes neighbors instead of both showing through at once.
      panel.style.zIndex = String(Math.round((1 - Math.min(Math.abs(r), 1)) * 10) + 1);
    });

    const activeIndex = Math.max(0, Math.min(n - 1, Math.round(activeFloat)));
    hotspots.forEach((h, i) => {
      const isActive = i === activeIndex;
      h.classList.toggle('is-active', isActive);
      h.classList.toggle('is-emphasized', isActive);
    });
    markLoaded(activeIndex);

    if(trackFill) trackFill.style.transform = 'scaleX(' + progress.toFixed(4) + ')';

    // subtle background-light movement, tied to the same active float —
    // plain radial-gradient position/opacity shift, no filter:blur (see
    // .process-stage-glow's own CSS comment)
    if(glow){
      const glowShift = (activeFloat - (n - 1) / 2) * 18;
      gsap.set(glow, { x: glowShift, opacity: 0.4 + 0.2 * Math.sin(activeFloat * Math.PI) });
    }
  }

  // click-to-jump wiring bound ONCE (not per matchMedia breakpoint —
  // gsap.matchMedia auto-reverts gsap-created animations/ScrollTriggers
  // on breakpoint change, but a plain addEventListener here would just
  // keep stacking duplicate listeners across resizes if bound inside
  // the mm.add() context instead). Reads liveTrigger by closure
  // reference, so it always targets whichever ScrollTrigger is current.
  function jumpToStep(i){
    if(!liveTrigger) return;
    const clamped = Math.max(0, Math.min(n - 1, i));
    const target = liveTrigger.start + (clamped / (n - 1)) * (liveTrigger.end - liveTrigger.start);
    window.scrollTo({ top: target, behavior: 'smooth' });
  }

  hotspots.forEach((hotspot, i) => {
    hotspot.addEventListener('click', () => jumpToStep(i));
  });

  // per direct request: "make the how its built also be swipeable" —
  // a horizontal drag/swipe on the stage jumps to the next/previous
  // step, same scrollTo target math as the hotspot clicks above. This
  // doesn't replace the scroll-scrubbed sequence (still the primary,
  // continuous way through it) — it's an additional input, exactly
  // like the hotspots already are, just gestural instead of a click.
  // Same swipe pattern (pointerdown/up, horizontal-dominant, distance
  // threshold) already used by testimonials.js/live-demo.js's own
  // native-scroll-snap stacks, adapted here since this stage isn't a
  // native scroll container — it's a set of GSAP-positioned panels — so
  // navigation happens via the same programmatic scrollTo as a hotspot
  // click rather than a native scroll-snap settle.
  (function bindSwipe(){
    function stepAndAnnounce(dir){
      if(!liveTrigger) return;
      const activeIndex = Math.round(liveTrigger.progress * (n - 1));
      jumpToStep(activeIndex + dir);
      if(window.Papi && window.Papi.sound) window.Papi.sound.play('tick');
    }

    const SWIPE_THRESHOLD = 44;
    let startX = 0, startY = 0, dragging = false;
    stage.addEventListener('pointerdown', (e) => {
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
    });
    stage.addEventListener('pointerup', (e) => {
      if(!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if(Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      stepAndAnnounce(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { dragging = false; });

    // BUG FIX: per report, "locally, when i try to swipe on the how its
    // built process cards, it doesnt let me swipe" — the pointerdown/up
    // pair above only ever fires for an actual touchscreen drag or a
    // literal mouse click-and-hold-and-release. A trackpad two-finger
    // swipe (the far more common way anyone on a laptop would try this)
    // is a completely different, non-pointer input: the browser reports
    // it as a native 'wheel' event carrying deltaX/deltaY, with no
    // pointerdown/pointerup at all — so the whole gesture was invisible
    // to this handler. Trackpads fire many wheel events per physical
    // swipe (not one), so this debounces to one step per gesture rather
    // than firing repeatedly as the numbers stream in.
    let wheelCooldown = false;
    stage.addEventListener('wheel', (e) => {
      if(wheelCooldown) return;
      if(Math.abs(e.deltaX) < 12 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      wheelCooldown = true;
      stepAndAnnounce(e.deltaX > 0 ? 1 : -1);
      setTimeout(() => { wheelCooldown = false; }, 650);
    }, { passive: false });
  })();

  const mm = gsap.matchMedia();
  mm.add({
    isDesktop: '(min-width: 641px)',
    isMobile: '(max-width: 640px)',
  }, (context) => {
    const states = context.conditions.isDesktop ? DESKTOP_STATE : MOBILE_STATE;
    const end = context.conditions.isDesktop ? '+=400%' : '+=220%';

    const trigger = ScrollTrigger.create({
      trigger: section,
      pin: true,
      start: 'top top',
      end: end,
      scrub: 1,
      onUpdate: (self) => render(states, self.progress),
    });
    liveTrigger = trigger;
    render(states, trigger.progress);
  });

  // BUG FIX: per report, "on mobile when reaching the last section,
  // there is a big black space after that section reaches the very
  // bottom." Mobile Safari's address bar auto-hides shortly after the
  // page settles, growing the real usable viewport — but GSAP's pin
  // spacers (across all three scroll-journey files, which is why this
  // lives here as the last one to load, once everything is already
  // pinned) are sized once, from whatever viewport height was current
  // when each pin was first set up. If that measurement happened while
  // Safari's chrome was still visible, every pin spacer ends up
  // oversized relative to the real, settled viewport, and that excess
  // shows up as dead scroll space after the final section. One
  // ScrollTrigger.refresh() after a real settle delay re-measures
  // every pin against the final viewport — same "wait for it to
  // settle" convention already used for --stable-vh elsewhere on this
  // site, just applied to GSAP's own measurements instead.
  window.addEventListener('load', () => {
    setTimeout(() => ScrollTrigger.refresh(), 600);
  });

  // BUG FIX: per follow-up report, "in desktop after reaching how we
  // build it, there seems to be an empty space in the bottom section."
  // The one-shot refresh above only ever fires once, 600ms after
  // 'load' — fine for the mobile Safari chrome-settle case it was
  // written for, but desktop has no such single settle moment. Any
  // later layout shift that changes the page's total height (a web
  // font swapping in, a live-demo iframe finishing load, a testimonial
  // image landing) after that one refresh already ran leaves every
  // pin-spacer sized against stale measurements, showing up as dead
  // scroll space once you're past the affected section. A
  // ResizeObserver on <body> catches any such height change for the
  // rest of the page's life (not just once) and asks GSAP to
  // re-measure every pin against it, debounced so a burst of shifts
  // (several images landing back to back) only triggers one refresh.
  if('ResizeObserver' in window){
    let resizeT = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => ScrollTrigger.refresh(), 200);
    });
    ro.observe(document.body);
  }
})();
