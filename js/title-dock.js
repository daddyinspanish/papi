/* ===================================================================
   Papi — persistent-nav scroll state + hero social icon reveal
   Two independent jobs: the social icon row's one-time entrance, and
   driving the persistent nav's (#siteHeader) own scroll-dependent
   state — a dark-on-light text flip while it's still transparent and
   over the hero (the site's one light/white zone now that the
   before/after contrast section has been removed entirely), and a
   solid background once it's been scrolled past the hero (see
   .is-solid in style.css) so it sits cleanly on top of later
   sections' own pinned content instead of needing to duck out of the
   way of it.

   This file used to also drive a "Papi" word floating and tracking
   itself inside the hero's own liquid mass (per-letter physics riding
   hero-slime.js's control points) — removed on request, along with the
   #heroFlowWord markup itself. hero-slime.js's liquid mass still
   renders and wanders on its own; it just has nothing riding inside it
   anymore.
=================================================================== */
(function(){
  const social   = document.getElementById('heroSocial');
  const siteHeader = document.getElementById('siteHeader');

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

  window.Papi = window.Papi || {};
  window.Papi.revealSocial = revealSocial;

  const heroEl = document.getElementById('hero');

  // the persistent nav (see .site-header in style.css) needs two
  // scroll-driven things: a dark-on-light flip for its own text while
  // it's still transparent and over the hero, and a solid background
  // once it's left the hero entirely — see .is-solid, which is what
  // actually keeps it from colliding with later sections' own pinned
  // content. Only depends on scroll position and the hero's own
  // height, measured once (not on every scroll event — offsetHeight
  // forces a synchronous layout read) and re-measured on resize/
  // fonts-ready, same convention as the rest of this file.
  let heroHeight = 0;
  function measureZones(){
    heroHeight = heroEl ? heroEl.offsetHeight : 0;
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

  function update(){
    // the nav's own text only needs to flip to dark-on-light while
    // it's BOTH still transparent AND over the hero (a plain white
    // background, always) — the only light zone left on the page.
    // Every other section has a dark background, where the static
    // blue/cream text already reads fine on its own. (See
    // .site-header:not(.is-solid) in style.css for the other half of
    // that scoping.)
    const onHero = window.scrollY < heroHeight;
    document.body.classList.toggle('on-light-section', onHero);
    // solid background as soon as the hero's been scrolled past — see
    // the comment above this function for why (keeps the nav sitting
    // cleanly on top of later sections' own pinned content instead of
    // needing to duck out of the way of it, the way the old small
    // corner brand mark used to).
    if(siteHeader) siteHeader.classList.toggle('is-solid', !onHero);
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
