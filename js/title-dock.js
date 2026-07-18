/* ===================================================================
   Papi — scroll-driven title docking
   Two separate jobs live in this one file: the hero's own "Papi" word
   entrance (a perpetual idle ripple + cursor-push loop, never fading
   out — see revealFlow/flowLetterFrame) and the social icon row's
   one-time entrance, plus — entirely independent of the hero — the
   small docked label that crossfades in below the brand mark once the
   visitor scrolls past it, showing which later section ("Difference"/
   "Industries"/"Results"/"Live"/"Proof") the viewport is currently
   over. That label (and the brand mark) flips to a dark-on-light look
   while a white section is behind it, then back to light-on-dark once
   past it into the next dark section.
=================================================================== */
(function(){
  const heroFlowWord = document.getElementById('heroFlowWord');
  const social   = document.getElementById('heroSocial');
  const titleDock= document.getElementById('titleDock');
  const siteHeader = document.getElementById('siteHeader');
  if(!titleDock) return;

  const SCROLL_RANGE_RATIO = 0.95; // fraction of viewport height for the docked-label reveal distance
  const DOCK_THRESHOLD = 0.62; // when the corner label appears

  // cached, not read live from window.innerHeight on every scroll
  // update — on iOS Safari, innerHeight grows as the address bar
  // collapses partway through the very scroll gesture that triggers
  // this transition, which made everything paced off "dist" below
  // feel like it lagged or jumped partway through
  let viewportH = window.innerHeight;
  function measureViewport(){ viewportH = window.innerHeight; }
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance, not exact equality — see the --stable-vh
    // comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiDockResizeT);
    window.__papiDockResizeT = setTimeout(measureViewport, 150);
  });

  // ---- social icon row: fades/rises in right away, once, and just
  // stays there — no scroll-tied fade. The liquid-drop pop-in itself
  // (see .hero-social.is-visible in style.css) lives entirely in CSS,
  // triggered by the is-visible class added below — it animates each
  // icon's own svg/::before, never this container's opacity, so it
  // can't conflict with the fade this function drives. ----
  let socialEntranceDone = false;
  if(social){
    social.style.transition = 'none';
    social.style.opacity = '0';
  }
  function revealSocial(){
    if(!social) return;
    requestAnimationFrame(()=>{
      social.style.transition = 'opacity .6s ease';
      social.style.opacity = '1';
      social.classList.add('is-visible');
    });
    setTimeout(()=>{
      socialEntranceDone = true;
      social.style.transition = 'none';
    }, 900);
  }

  // ---- "Papi" — split into per-letter spans, each tracking its own
  // small state object so it can both ripple continuously AND get
  // pushed by a nearby cursor (see flowLetterFrame below) — a plain
  // CSS animation can't do the ripple half of that alongside a JS-
  // driven push offset, since a CSS animation targeting transform
  // always wins over an inline style on the same property, silently
  // discarding whatever the push physics writes there. Computing both
  // in one JS loop and writing a single combined transform per frame
  // avoids that fight entirely. After the one-off fade+rise entrance
  // below, this just keeps rippling/reacting to the cursor forever —
  // "Papi" never fades or gets pulled away. ----
  let flowEntranceDone = false;
  let flowLetterState = []; // {el, homeX, homeY, x, y, vx, vy}
  if(heroFlowWord){
    const flowText = heroFlowWord.textContent;
    const flowChars = Array.from(flowText);
    heroFlowWord.innerHTML = '';
    flowChars.forEach((ch, i)=>{
      const span = document.createElement('span');
      span.className = 'flow-letter';
      span.textContent = ch;
      // see the CSS note on .flow-letter — windows each letter into its
      // own slice of one gradient sized/offset across the whole word,
      // so the split-into-spans letters still read as a single
      // continuous sweep rather than four separate mini-gradients
      span.style.backgroundSize = `${flowChars.length * 100}% 100%`;
      span.style.backgroundPositionX = flowChars.length > 1 ? `${(i / (flowChars.length - 1)) * 100}%` : '0%';
      heroFlowWord.appendChild(span);
      flowLetterState.push({ el: span, homeX: 0, homeY: 0, x: 0, y: 0, vx: 0, vy: 0 });
    });
    heroFlowWord.style.transition = 'none';
    heroFlowWord.style.opacity = '0';
    heroFlowWord.style.transform = 'translateY(14px)';
  }
  function computeFlowHomes(){
    flowLetterState.forEach(st=>{
      const r = st.el.getBoundingClientRect();
      st.homeX = r.left + r.width/2;
      st.homeY = r.top + r.height/2;
    });
  }
  let flowEffectsLive = false;

  // "Papi" doesn't just sit centred over the liquid — it's meant to
  // read as actually being carried by it, staying inside the mass's
  // own current outline rather than drifting near it. window.Papi.
  // getFieldCenter() (hero-slime.js) is the liquid mass's own true
  // centre of gravity in normalized 0..1 space — the SAME space each
  // point's own x/y already lives in, and each point's own on-screen
  // pixel position is just point.x * (canvas width), point.y *
  // (canvas height) (see field() in hero-slime.js's shader — the
  // aspect correction there cancels out for this exact mapping).
  // Multiplying the centred offset by the viewport's own width/height
  // with no extra gain reproduces that same mapping exactly, so "Papi"
  // ends up sitting precisely at the mass's real centre of gravity in
  // real screen pixels — not an exaggerated version of it, which was
  // pushing the word out past the mass's own visual edge in some
  // frames (a >1 gain used to live here for exactly the opposite,
  // wrong reason: making an otherwise-subtle drift more visible).
  //
  // stableViewportH mirrors index.html's own --stable-vh: raw
  // window.innerHeight changes as iOS Safari's address bar collapses,
  // which tends to land in almost the same window as this effect
  // first kicking in, and was reading as a visible "jump" right at
  // that moment. Cached, only re-measured on the same width-only
  // resize tolerance the rest of this file already uses (a height-only
  // change, e.g. a chrome collapse, is exactly what this should ignore).
  function readStableViewportH(){
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stable-vh'));
    return (v && v > 0) ? v * 100 : window.innerHeight;
  }
  let stableViewportH = readStableViewportH();
  const FIELD_FOLLOW_MAX_FRAC = 0.22; // a safety clamp, not the primary shaping constraint —
                                       // true (unamplified) centre-of-gravity tracking rarely
                                       // needs it, but it's cheap insurance against any edge case
  const FIELD_FOLLOW_LERP = 0.05; // eases toward the target slowly, matching the liquid's own
                                   // heavy, viscous character rather than tracking it instantly
  let flowOffsetX = 0, flowOffsetY = 0;
  function fieldFollowTarget(){
    const center = (window.Papi && window.Papi.getFieldCenter) ? window.Papi.getFieldCenter() : { x:0.5, y:0.5 };
    const maxPx = Math.min(window.innerWidth, stableViewportH) * FIELD_FOLLOW_MAX_FRAC;
    return {
      x: Math.max(-maxPx, Math.min(maxPx, (center.x - 0.5) * window.innerWidth)),
      y: Math.max(-maxPx, Math.min(maxPx, (center.y - 0.5) * stableViewportH)),
    };
  }

  function revealFlow(){
    if(!heroFlowWord) return;
    requestAnimationFrame(()=>{
      heroFlowWord.style.transition = 'opacity 1s ease, transform 1.1s cubic-bezier(.16,1,.3,1)';
      heroFlowWord.style.opacity = '1';
      heroFlowWord.style.transform = 'translateY(0)';
    });
    setTimeout(()=>{
      flowEntranceDone = true;
      heroFlowWord.style.transition = 'none';
      // measured only once the rise entrance has fully settled — any
      // earlier and the transform above is still mid-transition, which
      // would bake a wrong (still-rising) home position into every
      // letter's own push-physics rest point
      computeFlowHomes();
      // snapped directly to the current target rather than left at its
      // initial (0,0) to ease in from — by this point the liquid has
      // already been drifting for over a second, so easing in from a
      // stale zero baseline toward an already-nonzero target is exactly
      // what read as a visible jump right as this kicks in.
      const target = fieldFollowTarget();
      flowOffsetX = target.x;
      flowOffsetY = target.y;
      heroFlowWord.style.transform = `translate(${flowOffsetX.toFixed(1)}px, ${flowOffsetY.toFixed(1)}px)`;
      flowEffectsLive = true;
    }, 1150);
  }
  // same >10px-tolerance width-only guard as every other resize
  // handler in this file (see the --stable-vh comment in index.html's
  // <head>) — an iOS toolbar collapse fires 'resize' without the
  // letters' own horizontal position actually changing
  let lastResizeWFlow = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(Math.abs(w - lastResizeWFlow) <= 10) return;
    lastResizeWFlow = w;
    stableViewportH = readStableViewportH();
    clearTimeout(window.__papiFlowResizeT);
    window.__papiFlowResizeT = setTimeout(()=>{ if(flowEffectsLive) computeFlowHomes(); }, 200);
  });

  // ripple (a continuous idle wave through the letters) + cursor push,
  // combined into one transform per letter per frame — see the note
  // above on why this replaced a plain CSS animation.
  const FLOW_PUSH_RADIUS = 85;
  const FLOW_PUSH = 0.34;
  const FLOW_SPRING = 0.05;
  const FLOW_DAMPING = 0.82;
  const FLOW_RIPPLE_SPEED = (2 * Math.PI) / 2.6; // matches the old CSS keyframe's 2.6s period
  const FLOW_RIPPLE_PHASE = 0.39; // per-letter phase offset, matches the old 0.16s-of-2.6s stagger
  const FLOW_RIPPLE_AMP = 9;
  let mouseX = -9999, mouseY = -9999;
  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function flowLetterFrame(){
    if(flowEffectsLive){
      if(heroFlowWord){
        const target = fieldFollowTarget();
        flowOffsetX += (target.x - flowOffsetX) * FIELD_FOLLOW_LERP;
        flowOffsetY += (target.y - flowOffsetY) * FIELD_FOLLOW_LERP;
        heroFlowWord.style.transform = `translate(${flowOffsetX.toFixed(1)}px, ${flowOffsetY.toFixed(1)}px)`;
      }
      const t = performance.now() / 1000;
      flowLetterState.forEach((st, i)=>{
        const dx = (st.homeX + st.x) - mouseX;
        const dy = (st.homeY + st.y) - mouseY;
        const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
        if(d < FLOW_PUSH_RADIUS){
          const force = (1 - d/FLOW_PUSH_RADIUS) * FLOW_PUSH;
          const ang = Math.atan2(dy, dx);
          st.vx += Math.cos(ang) * force;
          st.vy += Math.sin(ang) * force;
        }
        st.vx += (0 - st.x) * FLOW_SPRING;
        st.vy += (0 - st.y) * FLOW_SPRING;
        st.vx *= FLOW_DAMPING;
        st.vy *= FLOW_DAMPING;
        st.x += st.vx;
        st.y += st.vy;

        const ripplePhase = t * FLOW_RIPPLE_SPEED + i * FLOW_RIPPLE_PHASE;
        const rippleY = Math.sin(ripplePhase) * FLOW_RIPPLE_AMP;
        const skew = Math.sin(ripplePhase) * -2;
        st.el.style.transform = `translate(${st.x.toFixed(2)}px, ${(st.y + rippleY).toFixed(2)}px) skewX(${skew.toFixed(2)}deg)`;
      });
    }
    requestAnimationFrame(flowLetterFrame);
  }
  requestAnimationFrame(flowLetterFrame);

  window.Papi = window.Papi || {};
  window.Papi.revealFlow = revealFlow;
  window.Papi.revealSocial = revealSocial;

  const showcaseEl = document.getElementById('showcase');
  const heroEl = document.getElementById('hero');
  const contrastSectionEl = document.getElementById('contrastSection');

  // the docked top-right word swaps per section as the visitor scrolls
  // through the page — one word standing in for what that section is
  // about, rather than a single label that only ever meant "showcase"
  const sectionDock = document.getElementById('sectionDock');
  const sectionWords = [
    { el: contrastSectionEl, word: 'Difference', top: 0, bottom: 0 },
    { el: showcaseEl, word: 'Industries', top: 0, bottom: 0 },
    { el: document.getElementById('comparisonSection'), word: 'Results', top: 0, bottom: 0 },
    { el: document.getElementById('liveDemoSection'), word: 'Live', top: 0, bottom: 0 },
    { el: document.getElementById('testimonialsSection'), word: 'Proof', top: 0, bottom: 0 },
  ];
  let currentDockWord = null;

  // this update() runs on every single 'scroll' event for the entire
  // page, forever — offsetTop/offsetHeight force a synchronous layout
  // read, so reading them here (previously: heroEl once, then each
  // section AGAIN inside the sectionWords loop below, on top of a
  // separate live read for onContrast/onShowcase — the same elements'
  // layout measured twice a frame) meant this one script alone forced
  // several extra reflows on every scroll frame, stacking on top of
  // every other section's own scroll handler doing the same kind of
  // thing. None of these positions change from scrolling — only from
  // resize/content changes — so they're measured once (plus on resize/
  // fonts load, same convention as contrast.js's own sizing) instead.
  let heroHeight = 0;
  function measureZones(){
    heroHeight = heroEl ? heroEl.offsetHeight : 0;
    sectionWords.forEach(s=>{
      if(!s.el) return;
      s.top = s.el.offsetTop;
      s.bottom = s.top + s.el.offsetHeight;
    });
    // update()'s own very first call (bottom of this file) runs
    // synchronously, before this rAF-deferred first measurement has
    // ever landed — heroHeight is still its initial 0 then, which
    // silently made onHero (scrollY < heroHeight) false at the very
    // top of the page until the visitor's first scroll happened to
    // trigger a fresh, correctly-measured update() call. Re-running
    // update() every time zones are (re)measured — including this
    // very first time — closes that gap instead of relying on a
    // scroll event to ever paper over it.
    update();
  }
  requestAnimationFrame(measureZones);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(measureZones);
  window.addEventListener('load', measureZones);
  let lastResizeWZones = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeWZones) <= 10) return;
    lastResizeWZones = w;
    clearTimeout(window.__papiDockZonesResizeT);
    window.__papiDockZonesResizeT = setTimeout(measureZones, 150);
  });
  const contrastZone = sectionWords[0];
  const showcaseZone = sectionWords[1];
  const liveDemoZone = sectionWords[3];

  function update(){
    const dist = viewportH * SCROLL_RANGE_RATIO;
    const progress = Math.max(0, Math.min(1, window.scrollY / dist));

    // the brand mark/docked label only need to flip to dark-on-light
    // while over one of this site's white zones — the hero (a plain
    // white background now, always) and the contrast section, also
    // white. Every other section has a dark background, where the
    // static gold/cream colors already read fine on their own.
    const onHero = window.scrollY < heroHeight;
    const onContrast = contrastSectionEl
      ? window.scrollY >= contrastZone.top && window.scrollY < contrastZone.bottom
      : false;
    document.body.classList.toggle('on-light-section', onHero || onContrast);

    // the showcase section's own background trade icons/fan cards fill
    // enough of the top-right corner on narrow screens that the docked
    // brand mark/word cluster sitting on top reads as clutter — same
    // duck-out-of-the-way treatment already used for the contrast
    // section's mock nav below
    const onShowcase = showcaseEl
      ? window.scrollY >= showcaseZone.top && window.scrollY < showcaseZone.bottom
      : false;

    // same duck-out-of-the-way treatment for the live-demo section on
    // narrow screens — its own browser-chrome-style frame already runs
    // right up against the edges of the viewport there, so the docked
    // brand mark/word cluster sitting on top of it read as clutter
    const onLiveDemo = liveDemoZone.el
      ? window.scrollY >= liveDemoZone.top && window.scrollY < liveDemoZone.bottom
      : false;

    // on narrow screens the whole top-right cluster — brand mark and
    // the tagline/word dock beneath it — sits right on top of the
    // contrast section's own mock nav/CTA (there's no room for both at
    // this width) — duck both out of the way for that stretch only,
    // fading back in once the visitor scrolls past the section
    const hideDockForMobileZone = window.innerWidth <= 640 && (onContrast || onShowcase || onLiveDemo);
    titleDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD && !hideDockForMobileZone);
    // the corner "PAPI" brand mark stays hidden for the whole hero
    // section, on every viewport — the big centre "Papi" word (now
    // floating inside the liquid permanently, see flowLetterFrame
    // below) is meant to be the only "Papi" on screen there. Reuses
    // .site-header's existing is-hidden mechanism/transition (already
    // used for the mobile-only showcase/contrast/live-demo duck-out-
    // of-the-way case above) rather than adding a second one.
    if(siteHeader) siteHeader.classList.toggle('is-hidden', hideDockForMobileZone || onHero);

    // pick whichever section the viewport's centre currently sits in
    if(sectionDock){
      const y = window.scrollY + viewportH * 0.5;
      let word = null;
      for(let i=0;i<sectionWords.length;i++){
        const s = sectionWords[i];
        if(!s.el) continue;
        if(y >= s.top && y < s.bottom){ word = s.word; break; }
      }
      sectionDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD && !!word);
      if(word && word !== currentDockWord){
        const isFirstWord = currentDockWord === null;
        currentDockWord = word;
        if(isFirstWord){
          sectionDock.textContent = word;
        } else {
          // crossfade to the new word instead of snapping straight to
          // it — reuses the element's existing opacity transition
          sectionDock.style.opacity = '0';
          setTimeout(()=>{
            sectionDock.textContent = word;
            sectionDock.style.opacity = '';
          }, 320);
        }
      }
    }
  }

  // batch to one update per animation frame — this reads offsetTop/
  // offsetHeight (forces layout) every call, and raw 'scroll' events
  // can fire faster than the screen repaints during a fast scroll
  let ticking = false;
  window.addEventListener('scroll', ()=>{
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ update(); ticking = false; });
  }, { passive:true });
  update();
})();
