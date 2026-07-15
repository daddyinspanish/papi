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
  const palette = [
    [255,200,40], // gold
    [ 10,  9,  8], // near-black
  ];

  window.Papi = window.Papi || {};
  window.Papi.palette = palette;

  // ---------------------------------------------------------------
  // shared scroll lock — used by the hero's field-grow and the cube
  // section's focused-face view (the showcase fan card's expanded view
  // keeps its own simpler html-only lock — it re-parents onto <body>
  // for its own position:fixed centering, which would itself get
  // hijacked if body became position:fixed too, so it can't share this).
  //
  // Plain overflow:hidden on html/body isn't reliably enough to block
  // iOS Safari's own touch-driven momentum scrolling — a stray touch
  // could still drag the page slightly during a "locked" animation,
  // and the snap-back once the lock released was what showed up as a
  // pause/freeze right when scrolling from the hero into the next
  // section. The standard position:fixed-on-body trick fixes that,
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
})();
