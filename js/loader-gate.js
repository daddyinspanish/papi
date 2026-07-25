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
/* BUG FIX — window.Papi.safeScrollRefresh: per the recurring "page goes
   black after clicking Enter" reports, directly reproduced via a live
   MutationObserver + monkey-patched ScrollTrigger.refresh: this file's
   own dismiss(), js/scroll-journey-process.js's load+600ms one-shot,
   and its own debounced <body> ResizeObserver, all call
   ScrollTrigger.refresh() completely independently of one another. Two
   of those calls landing close together occasionally leaves GSAP
   unable to correctly recreate every pin's .pin-spacer — confirmed
   directly: all three pin-spacers vanished, #hero (which has no
   explicit height of its own) collapsed to 0px, and #liveDemoSection
   slid up to cover it completely at scrollY:0, which is exactly the
   black/empty screen being reported. It doesn't matter precisely why
   GSAP mishandles two concurrent refreshes — removing the concurrency
   entirely removes the whole class of race. Every refresh() call site
   on this page now routes through this shared, self-coalescing
   wrapper instead of calling ScrollTrigger.refresh() directly: only one
   real refresh is ever in flight at a time, and any request that comes
   in while one is running gets folded into a single follow-up call
   right after, instead of firing concurrently. Defined here (the
   earliest-loading script on the page) purely as a plain function —
   GSAP itself doesn't need to exist yet, only by the time this is
   actually CALLED, which every real call site already satisfies. */
window.Papi = window.Papi || {};
if(!window.Papi.safeScrollRefresh){
  let refreshInFlight = false;
  let refreshQueued = false;
  window.Papi.safeScrollRefresh = function(){
    if(!window.ScrollTrigger) return;
    if(refreshInFlight){ refreshQueued = true; return; }
    refreshInFlight = true;
    window.ScrollTrigger.refresh();
    // BUG FIX: found via a direct, repeatable before/after test — forcing
    // scrollY deep into a pin's range (which correctly glitches the
    // hero's title/CTA per their own scroll-driven dissolve effect),
    // then resetting scrollY to 0 and calling refresh() alone, left the
    // title/CTA PERMANENTLY stuck mid-glitch ("BuildingWebsitesthatMatt3r",
    // "Viewourwo67") even though scrollY read back as correctly 0.
    // refresh() recalculates each trigger's start/end boundaries but does
    // NOT reliably force its cached progress (and therefore any scrub
    // timeline or onUpdate callback driven by it — the hero's character-
    // glitch effect, the Live Demo browser scale/fade, the "How It's
    // Built" panel transforms) to resync against the CURRENT scroll
    // position if GSAP doesn't independently detect a change. Only
    // ScrollTrigger.update() forced that resync in testing. Calling it
    // here, right after refresh(), means every real call site (this
    // file's own dismiss, scroll-journey-process.js's load timer and
    // ResizeObserver, index.html's 4s fallback) now also corrects any
    // scroll-driven visual effect that drifted out of sync, not just the
    // pin-spacer geometry refresh() already fixes.
    window.ScrollTrigger.update();
    // BUG FIX: found while verifying the update() fix above — the reset
    // below used to run ONLY inside requestAnimationFrame. Confirmed
    // directly (isolated the exact same refresh()+update() calls, run
    // inline vs through this stored function): calling this function a
    // SECOND time, after an earlier real call (e.g. dismiss()'s own,
    // 750ms prior) had already fired, silently did nothing — no error,
    // no console warning, refreshInFlight just never came back false.
    // rAF ties this reset to the browser's own next real paint; if a
    // paint is ever skipped or delayed for any reason (a backgrounded
    // tab, aggressive power-saving throttling, or simply nothing else
    // on the page currently forcing a new frame), refreshInFlight can
    // stay stuck true for the rest of the page's life — and every
    // future call from anywhere (scroll-journey-process.js's own
    // ResizeObserver and load-timer, index.html's 4s fallback) would
    // then silently queue and never actually run, which is worse than
    // not having this coalescing at all. A short setTimeout backstop
    // guarantees the reset happens regardless of whether a paint ever
    // ties to it — whichever of the two fires first wins, and the
    // `settled` guard stops the other from double-resetting.
    let settled = false;
    const settle = () => {
      if(settled) return;
      settled = true;
      refreshInFlight = false;
      if(refreshQueued){
        refreshQueued = false;
        window.Papi.safeScrollRefresh();
      }
    };
    requestAnimationFrame(settle);
    setTimeout(settle, 50);
  };
}

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
  // anyway.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
  function preventDocScroll(e){
    if(!scrollGuardActive) return;
    if(e.type === 'keydown'){
      if(!SCROLL_KEYS.has(e.key)) return;
      // BUG FIX: this used to skip prevention entirely whenever a
      // BUTTON/A/INPUT had focus, reasoning that Space/Enter needed to
      // reach the button to activate it. But a mouse click already
      // leaves the clicked button focused, and Space's DEFAULT action
      // on a focused button is a real page-down scroll (separate from
      // the click it also triggers) — so a visitor who clicks Enter/
      // Enter without sound and then habitually taps Space (common:
      // hands already there) could let a real, large scroll jump
      // through at the exact moment dismiss() is running, feeding
      // scroll-journey-hero.js's pin a wrong value right as it
      // resolves — the same class of bug window.Papi.safeScrollRefresh
      // above now also corrects for, but better closed at the source.
      // Only Space has this problem (Enter has no default scroll
      // action on a button); the two loader buttons are the only
      // focusable elements in here, so this can name them directly
      // instead of a generic tag check. preventDefault() blocks the
      // native scroll; firing the click ourselves keeps the button
      // working exactly as before, without depending on browser-
      // specific timing between this keydown and the native keyup-
      // activation it would otherwise race.
      if((e.key === ' ' || e.key === 'Spacebar') && (e.target === enterBtn || e.target === silentBtn)){
        e.preventDefault();
        e.target.click();
        return;
      }
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
    // lets anything deferred until "the visitor actually chose to enter"
    // (see js/hero-matrix.js) start right now, not after the 750ms
    // reveal delay below — no reason to make it wait on the fade too
    document.dispatchEvent(new CustomEvent('papi:enter'));

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
      window.Papi.safeScrollRefresh();

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
