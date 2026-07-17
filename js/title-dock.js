/* ===================================================================
   Papi — scroll-driven title docking
   On load the title shows; shortly after, the CTA fades/rises in and
   the subtitle rolls into place beneath it like a block dropping in.
   The CTA also has a subtle magnetic pull toward the cursor when it's
   nearby. Scrolling isn't gated on anything here — the background
   field (particles.js) runs its own orbiting/breathing loop
   independent of scroll, so as the visitor scrolls the whole hero
   block just lifts and fades away immediately while a small "Creating
   style for businesses" label crossfades in
   below the Papi mark, top right, and stays there for the rest of
   the scroll. That label (and the brand mark) flips to a
   dark-on-light look while the white showcase section is behind it,
   then back to light-on-dark once past it into the next dark
   section.
=================================================================== */
(function(){
  const heroCopy = document.getElementById('heroCopy');
  const eyebrow  = document.getElementById('heroEyebrow');
  const title    = document.getElementById('heroTitle');
  const sub      = document.getElementById('heroSub');
  const review   = document.getElementById('heroReview');
  const social   = document.getElementById('heroSocial');
  const titleDock= document.getElementById('titleDock');
  const siteHeader = document.getElementById('siteHeader');
  if(!heroCopy || !titleDock) return;

  // eyebrow/title's own CSS (.eyebrow, .hero-title) carries a
  // transition:opacity .3s ease rule meant for a one-off fade-in — but
  // neither element's OWN opacity ever actually fades in that way (only
  // their individual per-letter .char spans do, handled separately by
  // title.js); fadeFrame below sets these two elements' opacity every
  // single frame from page load onward, so that leftover CSS transition
  // just perpetually chases a constantly-moving target, lagging the
  // real (already fully-eased) value by a good fraction of 300ms. sub/
  // review/social clear this same transition once their own entrance
  // finishes, further down.
  if(eyebrow) eyebrow.style.transition = 'none';
  if(title) title.style.transition = 'none';

  const SCROLL_RANGE_RATIO = 0.95; // fraction of viewport height for the full transition
  const FADE_START    = 0.42; // everything starts fading out
  const FADE_END       = 0.82; // everything fully gone
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

  function smoothstep(edge0, edge1, x){
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // ---- subtitle: rolls into place shortly after the title, once ----
  let subEntranceDone = false;
  if(sub){
    sub.style.transition = 'none';
    sub.style.opacity = '0';
    sub.style.transform = 'translateY(-46px) rotate(-14deg) scale(.82)';
  }
  function revealSubtitle(){
    if(!sub) return;
    requestAnimationFrame(()=>{
      sub.style.transition = 'opacity .6s ease, transform .85s cubic-bezier(.34,1.56,.64,1)';
      sub.style.opacity = '1';
      sub.style.transform = 'translateY(0) rotate(0deg) scale(1)';
    });
    setTimeout(()=>{
      subEntranceDone = true;
      // hand off cleanly to fadeFrame's own continuous, already-eased
      // per-frame opacity updates below — leaving the entrance's own
      // transition active here would have it perpetually chasing that
      // constantly-moving target instead
      sub.style.transition = 'none';
      // lets title.js know it's safe to measure the subtitle's
      // characters and start their own scroll/cursor ripple — doing
      // that before the block-roll entrance settles would measure the
      // wrong (mid-animation) positions
      window.dispatchEvent(new Event('papi:subtitlerevealed'));
    }, 950);
  }


  // ---- review badge: fades/rises in last, a beat after the subtitle,
  // then tracks the same fadeOut as the rest of hero-copy in update()
  // below once its own entrance is done ----
  let reviewEntranceDone = false;
  if(review){
    review.style.transition = 'none';
    review.style.opacity = '0';
    review.style.transform = 'translateY(18px)';
  }
  function revealReview(){
    if(!review) return;
    requestAnimationFrame(()=>{
      review.style.transition = 'opacity .6s ease, transform .6s var(--ease-out)';
      review.style.opacity = '1';
      review.style.transform = 'translateY(0)';
    });
    setTimeout(()=>{
      reviewEntranceDone = true;
      // opacity dropped here (fadeFrame below drives it continuously,
      // already eased — see the eyebrow/title note above); the other
      // two are unrelated to scroll-fade (a hover state on the badge
      // itself), so they keep their own transition
      review.style.transition = 'border-color .3s var(--ease-out), background .3s var(--ease-out)';
    }, 650);
  }

  // ---- social icon row: fades/rises in right away (it's the topmost
  // element, doesn't need to wait on anything else settling first),
  // then tracks the same fadeOut as the rest of hero-copy in update()
  // below once its own entrance is done. The liquid-drop pop-in itself
  // (see .hero-social.is-visible in style.css) lives entirely in CSS,
  // triggered by the is-visible class added below — it animates each
  // icon's own svg/::before, never this container's opacity, so it
  // can't conflict with the fade this function (and later update())
  // drives here. ----
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
      // fadeFrame below drives this continuously from here on — see
      // the eyebrow/title note above for why keeping a CSS transition
      // active on top of that would just add a perpetual lag
      social.style.transition = 'none';
    }, 900);
  }

  window.Papi = window.Papi || {};
  window.Papi.revealSubtitle = revealSubtitle;
  window.Papi.revealReview = revealReview;
  window.Papi.revealSocial = revealSocial;

  // magnetic pull — the CTA and each social icon lean slightly toward
  // a nearby cursor. Generalized into a small per-element state object
  // (own position/target/lerp) rather than duplicating the same
  // handful of variables per element, so the CTA and all three icons
  // can each react independently in the same loop.
  let mouseX = -9999, mouseY = -9999;
  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function createMagnet(el, radius, strength, entranceDoneRef){
    return { el, radius, strength, entranceDoneRef, x:0, y:0, targetX:0, targetY:0 };
  }
  const magnets = [];
  if(social){
    // small radius/higher pull, proportionate to how small these
    // icons are, so the effect still reads at that scale instead of
    // feeling barely-there
    Array.from(social.querySelectorAll('.hero-social-link')).forEach(link=>{
      magnets.push(createMagnet(link, 42, 0.42, ()=>socialEntranceDone));
    });
  }

  function magnetFrame(){
    // this used to call heroElForMagnet.getBoundingClientRect() every
    // single frame, forever, for the entire rest of the page's life —
    // a forced synchronous layout read that never stopped, even long
    // after the hero (and the CTA inside it) had scrolled out of view.
    // heroHeight (measured once at load and on resize by measureZones
    // below, the same cached value update() uses for onHero) gives the
    // same answer via plain arithmetic against window.scrollY instead,
    // with no forced layout at all.
    const heroVisible = window.scrollY < heroHeight;
    if(heroVisible){
      magnets.forEach(m=>{
        if(!m.entranceDoneRef()) return;
        const rect = m.el.getBoundingClientRect();
        const cx = rect.left + rect.width/2;
        const cy = rect.top + rect.height/2;
        const dx = mouseX - cx, dy = mouseY - cy;
        const dist = Math.hypot(dx, dy);
        if(dist < m.radius){
          const pull = 1 - dist / m.radius;
          m.targetX = dx * pull * m.strength;
          m.targetY = dy * pull * m.strength;
        } else {
          m.targetX = 0;
          m.targetY = 0;
        }
        m.x += (m.targetX - m.x) * 0.2;
        m.y += (m.targetY - m.y) * 0.2;
        m.el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      });
    }
    requestAnimationFrame(magnetFrame);
  }
  // deferred to the next frame (rather than called directly here) so
  // that heroHeight below — declared further down this same script,
  // but assigned before any rAF callback can actually fire — is never
  // read while still in its temporal dead zone
  requestAnimationFrame(magnetFrame);

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

  // continuous rAF loop (same pattern as magnetFrame above) rather than
  // only reacting to 'scroll' events like update() below — title.js
  // eases its shared progress value toward its target over several
  // frames (deliberately, so a sudden scroll jump glides rather than
  // snaps), and that easing keeps running every frame via title.js's
  // own rAF loop even after the visitor stops scrolling. Computing
  // opacity only inside update() (scroll-event-triggered) meant it
  // froze at whatever value it last saw the instant scrolling stopped,
  // while the letters kept drifting toward their real target for
  // another beat — the title would sit fully visible over a stale,
  // still-scattered layout (or the reverse: correctly repositioned
  // letters at a stale, wrong opacity) until the next scroll event
  // happened to fire. Running this every frame, independent of scroll
  // events, keeps opacity and letter position in exact lockstep
  // regardless of whether the visitor is actively scrolling right now.
  function fadeFrame(){
    const fadeOut = (window.Papi && window.Papi.getHeroFadeProgress)
      ? window.Papi.getHeroFadeProgress()
      : smoothstep(FADE_START, FADE_END, Math.max(0, Math.min(1, window.scrollY / (viewportH * SCROLL_RANGE_RATIO))));

    if(eyebrow) eyebrow.style.opacity = String(1 - fadeOut);
    if(title) title.style.opacity = String(1 - fadeOut);
    if(sub && subEntranceDone) sub.style.opacity = String(1 - fadeOut);
    if(review && reviewEntranceDone) review.style.opacity = String(1 - fadeOut);
    if(social && socialEntranceDone) social.style.opacity = String(1 - fadeOut);

    heroCopy.style.transform = `translateY(${-fadeOut * 34}px)`;
    heroCopy.style.pointerEvents = fadeOut > 0.6 ? 'none' : 'auto';

    requestAnimationFrame(fadeFrame);
  }
  requestAnimationFrame(fadeFrame);

  function update(){
    const dist = viewportH * SCROLL_RANGE_RATIO;
    const progress = Math.max(0, Math.min(1, window.scrollY / dist));

    // hero-slime.js fades the hero's own background from white to black
    // as the liquid mass forms into cubes (see uCubeCloseScale/the
    // background-colour block in its loop(), and getCubeFormT here) —
    // reading its live cubeFormT rather than approximating "is the cube
    // phase active" separately from scroll position keeps this in exact
    // lockstep with whatever that background is actually doing
    const cubePhaseActive = window.Papi && window.Papi.getCubeFormT
      ? window.Papi.getCubeFormT() > 0.03
      : false;

    // the brand mark/docked label only need to flip to dark-on-light
    // while over one of this site's white zones — the hero's own
    // sweeping gold/black field (gold-on-gold was going invisible
    // there) when it's NOT in its own cube-phase black background, and
    // the contrast section, also white. Every other section (including
    // the hero during the cube phase) has a dark background, where the
    // static gold/cream colors already read fine on their own.
    const onHero = window.scrollY < heroHeight && !cubePhaseActive;
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
    // also hidden for the duration of the hero's own cube phase — the
    // docked "Built with purpose, not just design" line is the only
    // thing titleDock ever shows while still inside the hero (the
    // rotating section word below only ever has a word once scrolled
    // into one of the LATER sections), and it read as clutter over the
    // black glowing-cube look
    titleDock.classList.toggle('is-visible', progress > DOCK_THRESHOLD && !hideDockForMobileZone && !cubePhaseActive);
    if(siteHeader) siteHeader.classList.toggle('is-hidden', hideDockForMobileZone);

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
