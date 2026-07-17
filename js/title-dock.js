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
  const cta      = document.getElementById('heroCta');
  const review   = document.getElementById('heroReview');
  const titleDock= document.getElementById('titleDock');
  const siteHeader = document.getElementById('siteHeader');
  if(!heroCopy || !titleDock) return;

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
      // lets title.js know it's safe to measure the subtitle's
      // characters and start their own scroll/cursor ripple — doing
      // that before the block-roll entrance settles would measure the
      // wrong (mid-animation) positions
      window.dispatchEvent(new Event('papi:subtitlerevealed'));
    }, 950);
  }

  // ---- cta: fades/rises in shortly after the title, then becomes
  // magnetically interactive with the cursor ----
  let ctaEntranceDone = false;
  if(cta){
    cta.style.transition = 'none';
    cta.style.opacity = '0';
    cta.style.transform = 'translateY(18px)';
  }
  function revealCta(){
    if(!cta) return;
    requestAnimationFrame(()=>{
      cta.style.transition = 'opacity .6s ease, transform .6s var(--ease-out)';
      cta.style.opacity = '1';
      cta.style.transform = 'translateY(0)';
    });
    setTimeout(()=>{
      ctaEntranceDone = true;
      cta.style.transition = 'box-shadow .3s var(--ease-out), opacity .3s ease';
    }, 650);
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
      review.style.transition = 'opacity .3s ease, border-color .3s var(--ease-out), background .3s var(--ease-out)';
    }, 650);
  }

  window.Papi = window.Papi || {};
  window.Papi.revealSubtitle = revealSubtitle;
  window.Papi.revealCta = revealCta;
  window.Papi.revealReview = revealReview;

  // magnetic pull — the button leans slightly toward a nearby cursor
  let mouseX = -9999, mouseY = -9999;
  let ctaX = 0, ctaY = 0, ctaTargetX = 0, ctaTargetY = 0;
  const MAG_RADIUS = 95;

  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

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
    if(cta && ctaEntranceDone && heroVisible){
      const rect = cta.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      const dx = mouseX - cx, dy = mouseY - cy;
      const dist = Math.hypot(dx, dy);
      if(dist < MAG_RADIUS){
        const pull = 1 - dist / MAG_RADIUS;
        ctaTargetX = dx * pull * 0.32;
        ctaTargetY = dy * pull * 0.32;
      } else {
        ctaTargetX = 0;
        ctaTargetY = 0;
      }
      ctaX += (ctaTargetX - ctaX) * 0.2;
      ctaY += (ctaTargetY - ctaY) * 0.2;
      cta.style.transform = `translate(${ctaX.toFixed(1)}px, ${ctaY.toFixed(1)}px)`;
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

  function update(){
    const dist = viewportH * SCROLL_RANGE_RATIO;
    const progress = Math.max(0, Math.min(1, window.scrollY / dist));

    const fadeOut = smoothstep(FADE_START, FADE_END, progress);

    if(eyebrow) eyebrow.style.opacity = String(1 - fadeOut);
    if(title) title.style.opacity = String(1 - fadeOut);
    if(cta && ctaEntranceDone) cta.style.opacity = String(1 - fadeOut);
    if(sub && subEntranceDone) sub.style.opacity = String(1 - fadeOut);
    if(review && reviewEntranceDone) review.style.opacity = String(1 - fadeOut);

    heroCopy.style.transform = `translateY(${-fadeOut * 34}px)`;
    heroCopy.style.pointerEvents = fadeOut > 0.6 ? 'none' : 'auto';

    // the brand mark/docked label only need to flip to dark-on-light
    // while over one of this site's white zones — the hero's own
    // sweeping gold/black field (gold-on-gold was going invisible
    // there), and now the contrast section, also white. Every other
    // section has a fixed dark background, where the static gold/
    // cream colors already read fine on their own.
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

  // jumps straight to the trades showcase
  if(cta){
    cta.addEventListener('click', (e)=>{
      const showcase = document.getElementById('showcase');
      if(!showcase) return;
      e.preventDefault();
      showcase.scrollIntoView({ behavior:'smooth' });
    });
  }
})();
