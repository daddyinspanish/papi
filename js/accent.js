/* ===================================================================
   Papi — shared palette
   The brand is black and gold — full stop. particles.js sweeps
   between just these two as one solid background color at a time and
   writes the live --accent CSS variable, so the headline gradient and
   CTA hover stay in sync with whatever the field currently shows.
   (This used to be a ten-color jewel-tone set; narrowed to the brand
   pair so nothing off-brand ever shows up in the hero field.)
=================================================================== */
(function(){
  // BUG FIX: per report, "after a few refreshes the website loads
  // black" — recurring even in a fresh private tab, so not stale cache
  // (already ruled that out separately). Root cause found by testing
  // the ACTUAL real-world scenario: scroll deep into the page, THEN hit
  // reload — not a fresh navigation, which is all prior testing here
  // had covered. Safari (and Instagram's in-app browser) can restore
  // that scrolled position mid-load. index.html's own first inline
  // <script> already fights this once, early, plus again on
  // DOMContentLoaded — but DOMContentLoaded fires only AFTER every
  // deferred script (this file first, then scroll-dolly.js, then the
  // scroll-journey-*.js files that create GSAP ScrollTriggers) has
  // already run. If the browser's restore lands in that window, the
  // page-load-time pin math in scroll-journey-hero.js gets built against
  // a non-zero scrollY — its start:'bottom bottom' measurement, and any
  // transform scroll-dolly.js already applied to #processRoom from that
  // same stale scrollY, are both wrong from that point on, and nothing
  // downstream fully un-corrupts it. This file runs FIRST of all
  // deferred scripts, so reasserting scrollY:0 right here closes the gap
  // immediately before any of that scroll-dependent measurement runs,
  // rather than hoping DOMContentLoaded's own reassertion (which fires
  // too late, after the damage is already done) wins the race.
  if(window.scrollY !== 0) window.scrollTo(0, 0);

  const palette = [
    [255,200,40], // gold
    [ 10,  9,  8], // near-black
  ];

  window.Papi = window.Papi || {};
  window.Papi.palette = palette;

  // ---------------------------------------------------------------
  // shared scroll lock — used by the cube section's focused-face view
  // (the showcase fan card's expanded view keeps its own simpler
  // html-only lock — it re-parents onto <body> for its own
  // position:fixed centering, which would itself get hijacked if body
  // became position:fixed too, so it can't share this).
  //
  // Plain overflow:hidden on html/body isn't reliably enough to block
  // iOS Safari's own touch-driven momentum scrolling — a stray touch
  // could still drag the page slightly during a "locked" animation,
  // and the snap-back once the lock released was what showed up as a
  // pause/freeze. The standard position:fixed-on-body trick fixes that,
  // but here it would just move the problem: .site-header/.title-dock
  // are themselves position:fixed, and any position:fixed element's
  // containing block becomes the nearest position:fixed ANCESTOR — so
  // making body position:fixed would hijack their positioning too,
  // offsetting them by the scroll amount for the duration of the lock.
  // Directly intercepting the scroll gesture itself (touch drag and
  // wheel) sidesteps that entirely — nothing about layout or
  // positioning changes, the input just doesn't move the page.
  //
  // Reference-counted so two features locking at once (however
  // unlikely) can't have one's unlock release the other's lock early.
  // ---------------------------------------------------------------
  let lockCount = 0;
  function preventScrollInput(e){ e.preventDefault(); }
  function lockScroll(){
    if(lockCount === 0){
      document.documentElement.classList.add('scroll-lock');
      document.addEventListener('touchmove', preventScrollInput, { passive:false });
      document.addEventListener('wheel', preventScrollInput, { passive:false });
    }
    lockCount++;
  }
  function unlockScroll(){
    // guards against a redundant call after already fully unlocked
    // (e.g. a safety-timeout fallback firing after the real unlock
    // already happened)
    if(lockCount === 0) return;
    lockCount--;
    if(lockCount === 0){
      document.documentElement.classList.remove('scroll-lock');
      document.removeEventListener('touchmove', preventScrollInput);
      document.removeEventListener('wheel', preventScrollInput);
    }
  }
  window.Papi.lockScroll = lockScroll;
  window.Papi.unlockScroll = unlockScroll;

  // ---------------------------------------------------------------
  // shared, page-wide ScrollTrigger.refresh() coalescing.
  //
  // BUG FIX: per report, "refresh the page, it sometimes goes black
  // until the 3rd or 4th refresh." Reproduced directly: on a reload
  // (fonts/assets already cached, so everything below resolves fast
  // and close together), three independent, uncoordinated call sites
  // — this file's own callers below, index.html's 4s last-resort
  // fallback, and js/init.js's font-ready handler — could each call
  // window.ScrollTrigger.refresh() at nearly the same moment. GSAP
  // isn't safely re-entrant against a second refresh() firing while
  // the first hasn't finished settling the DOM it just measured, and
  // confirmed via direct inspection: a black-screen reload measured
  // document.body.scrollHeight at exactly 2x the correct value —
  // corrupted/doubled pin-spacer placeholders, not a rendering glitch.
  //
  // A previous fix already coalesced this within
  // js/scroll-journey-process.js's own two internal timers (a load+
  // 600ms one-shot and a debounced ResizeObserver) — but that guard
  // was local to that one file, so it had no way to know about (or
  // wait for) a refresh already in flight from either of the other two
  // call sites. Promoting the exact same coalescing logic to a single
  // shared instance here, used by all three call sites, closes that
  // gap: at most one refresh() is ever in flight at a time, page-wide,
  // regardless of which of the three timers asked for it.
  // ---------------------------------------------------------------
  let refreshInFlight = false;
  let refreshQueued = false;
  function safeScrollRefresh(){
    if(!window.ScrollTrigger) return;
    if(refreshInFlight){ refreshQueued = true; return; }
    refreshInFlight = true;
    window.ScrollTrigger.refresh();
    let settled = false;
    const settle = () => {
      if(settled) return;
      settled = true;
      refreshInFlight = false;
      if(refreshQueued){ refreshQueued = false; safeScrollRefresh(); }
    };
    requestAnimationFrame(settle);
    setTimeout(settle, 50);
  }
  window.Papi.safeScrollRefresh = safeScrollRefresh;

  // NOTE: an earlier pass added a second, parallel off-screen-pause
  // mechanism right here (a .js-anim-live IntersectionObserver for
  // .process-hero-copy/.process-stage/.quote-section's background-
  // position "shine" animations). Per a later full-site heat audit,
  // js/anim-idle.js already covers .process-hero-copy and .quote-
  // section (plus its .quote-heading/.quote-heading-shine/.quote-form-
  // title/.quote-submit descendants) via its own generic .is-anim-idle
  // mechanism — that duplicate has been removed. The one real gap that
  // pass DID legitimately catch (.process-stage's 4 simultaneous
  // .process-reveal-title shines, which js/anim-idle.js's own GROUPS
  // list missed entirely) has been migrated there instead, so there's
  // exactly one canonical off-screen-animation-pause mechanism site-
  // wide rather than two overlapping ones.
})();
