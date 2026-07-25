/* ===================================================================
   Papi — full-site loader / sound-consent gate
   Per direct request: a loader reading "Papi" / "Premium Websites"
   with an explicit "Enter" (with sound) vs "Enter without sound"
   choice, shown on every load.

   Deliberately NOT using html.scroll-lock (overflow:hidden on <html>)
   to block scroll behind this overlay, even though that class already
   exists (see accent.js) — per css/style.css's own documented WebKit
   bug (search "position:fixed breaking"), *any* explicit overflow on
   the root <html> element makes position:fixed descendants render in
   normal document flow instead of pinning to the viewport. GSAP
   ScrollTrigger pins the hero via position:fixed from page load, so
   locking scroll here broke exactly that combination. The loader is
   already a position:fixed, full-viewport, top-stacked overlay, so it
   fully blocks both visibility of and interaction with anything under
   it without needing a scroll lock at all.

   ARCHITECTURE NOTE — after repeated reports of "the page is empty/
   black after clicking Enter" surviving several rounds of targeted
   fixes (Instagram's own overflow bug, a stale #hero lookup, browser
   scroll-restoration racing GSAP's measurement, a visitor's own wheel-
   scroll doing the same thing), the pattern across all of them was the
   same mistake: this file kept trying to WAIT for the "right moment"
   to reveal #hero — coordinating with js/init.js's own independent
   fonts-ready/900ms schedule, or index.html's 4s fallback, or GSAP's
   own re-measurement timing. Every fix narrowed one specific way that
   coordination could go wrong without removing the coordination
   problem itself, and a new variant kept surfacing.
   This version removes that problem instead of chasing its next
   variant: dismissing this loader now reveals #hero DIRECTLY, right
   here, synchronously, the instant a visitor makes their choice —
   there's no "waiting for the right moment" left to get wrong, because
   this moment simply IS defined as the right one. js/init.js's own
   reveal (and index.html's fallback) still run independently and are
   now harmless no-ops if they happen to fire after this already has.
   The scroll-position guards below are kept — they're a separate,
   still-valid concern (making sure GSAP's scroll-linked hero pin reads
   a correct scrollY at the moment it re-measures), not a timing race.
=================================================================== */
(function(){
  const loader = document.getElementById('papiLoader');
  if(!loader) return;

  let dismissed = false;
  // stays active until reveal() finishes re-measuring GSAP against a
  // confirmed scrollY:0 — a scroll-restoration or wheel/touch scroll
  // landing at any point before then could still feed scroll-journey-
  // hero.js's own scroll-linked pin a wrong progress value
  let scrollGuardActive = true;

  function holdScrollAtTop(){
    if(!scrollGuardActive) return;
    if(window.scrollY !== 0) window.scrollTo(0, 0);
  }
  window.addEventListener('scroll', holdScrollAtTop, { passive: true });

  // per report, "on desktop its still happening" — ordinary wheel/
  // trackpad scrolling while reading this loader moves real scrollY
  // faster than the reactive correction above can win, feeding the
  // hero's own short-range scroll-linked pin a wrong value on every
  // tick. Preventing the scroll at the source instead of correcting it
  // after the fact closes that regardless of how continuous the input
  // is. Nobody should be able to scroll behind a full-viewport loader
  // anyway. Space/Enter are excluded when a button has focus, so
  // keyboard-activating "Enter"/"Enter without sound" still works.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
  function preventDocScroll(e){
    if(!scrollGuardActive) return;
    if(e.type === 'keydown'){
      if(!SCROLL_KEYS.has(e.key)) return;
      const tag = e.target && e.target.tagName;
      if(tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
    }
    e.preventDefault();
  }
  window.addEventListener('wheel', preventDocScroll, { passive: false });
  window.addEventListener('touchmove', preventDocScroll, { passive: false });
  window.addEventListener('keydown', preventDocScroll);

  function dismiss(){
    if(dismissed) return;
    dismissed = true;
    loader.classList.add('is-dismissed');

    setTimeout(() => {
      loader.setAttribute('aria-hidden', 'true');
      loader.style.display = 'none';

      // reveal #hero directly — see this file's own ARCHITECTURE NOTE
      // above for why this replaces the previous wait-and-poll approach
      const hero = document.getElementById('hero');
      if(hero && !hero.classList.contains('is-visible')){
        hero.classList.add('is-visible');
        hero.removeAttribute('aria-hidden');
        if(window.Papi && window.Papi.revealSocial) window.Papi.revealSocial();
        if(window.Papi && window.Papi.revealCursor) window.Papi.revealCursor();
      }

      // confirm scrollY is really 0 before GSAP re-measures against it
      if(window.scrollY !== 0) window.scrollTo(0, 0);
      if(window.ScrollTrigger) window.ScrollTrigger.refresh();

      // belt-and-suspenders: force these back to their untouched CSS
      // defaults too, removing any dependency on exactly how/when GSAP
      // re-renders after refresh() — see js/scroll-journey-hero.js's
      // own start:'bottom bottom' pin, whose short range is what made
      // a wrong scrollY visibly fade/zoom these two specifically
      const heroCopy = document.querySelector('.process-hero-copy');
      const heroMatrix = document.getElementById('processHeroMatrix');
      if(heroCopy){ heroCopy.style.opacity = ''; heroCopy.style.transform = ''; }
      if(heroMatrix){ heroMatrix.style.transform = ''; }

      // only now hand control back — real scrolling starts here
      scrollGuardActive = false;
      window.removeEventListener('scroll', holdScrollAtTop);
      window.removeEventListener('wheel', preventDocScroll);
      window.removeEventListener('touchmove', preventDocScroll);
      window.removeEventListener('keydown', preventDocScroll);
    }, 750);
  }

  const enterBtn = document.getElementById('papiLoaderEnter');
  const silentBtn = document.getElementById('papiLoaderEnterSilent');

  if(enterBtn) enterBtn.addEventListener('click', () => {
    if(window.Papi && window.Papi.sound) window.Papi.sound.enable();
    dismiss();
  });
  if(silentBtn) silentBtn.addEventListener('click', () => {
    if(window.Papi && window.Papi.sound) window.Papi.sound.disable();
    dismiss();
  });
})();
