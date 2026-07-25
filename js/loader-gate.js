/* ===================================================================
   Papi — full-site loader / sound-consent gate
   Per direct request: a loader reading "Papi" / "Premium Websites"
   with an explicit "Enter" (with sound) vs "Enter without sound"
   choice, shown on every load. #hero itself keeps revealing on its
   own original schedule (js/init.js — fonts-ready or 900ms, with
   index.html's own 4s fallback as a last resort) completely
   independent of this gate; that reveal always finishes well before a
   visitor reads two lines of text and clicks a button, so dismissing
   this overlay never has to wait on anything else.

   Ordering note vs js/sound.js's own returning-visitor auto-resume:
   sound.js attaches a one-time `pointerdown`/`keydown` listener on
   `document` that silently re-enables sound for a visitor who had it
   on last visit, the moment they interact anywhere on the page. That
   listener can fire from the SAME click as one of these two buttons
   (pointerdown always fires before click). It's harmless either way —
   whichever of enable()/disable() runs in this file's own click
   handler below always runs last (click fires after pointerdown) and
   is what actually decides the outcome.

   Deliberately NOT using html.scroll-lock (overflow:hidden on <html>)
   to block scroll behind this overlay, even though that class already
   exists (see accent.js) — per css/style.css's own documented WebKit
   bug (search "position:fixed breaking"), *any* explicit overflow on
   the root <html> element makes position:fixed descendants render in
   normal document flow instead of pinning to the viewport. GSAP
   ScrollTrigger pins the hero via position:fixed from page load, so
   locking scroll here broke exactly that combination — confirmed as
   the cause of a real report: "on instagram... enter without sound...
   enters but does not show anything." The loader is already a
   position:fixed, full-viewport, top-stacked overlay, so it fully
   blocks both visibility of and interaction with anything under it
   without needing a scroll lock at all.
=================================================================== */
(function(){
  const loader = document.getElementById('papiLoader');
  if(!loader) return;

  function dismiss(){
    loader.classList.add('is-dismissed');
    setTimeout(() => {
      loader.setAttribute('aria-hidden', 'true');
      loader.style.display = 'none';
      // BUG FIX: per follow-up report, "on safari... enter without
      // sound... enters but shows nothing" — the html.scroll-lock cause
      // behind the earlier Instagram version of this same symptom is
      // already removed (see this file's own header comment), but this
      // loader was still a full-viewport, top-stacked overlay covering
      // the page for the whole initial load. This site's own bug
      // history (see the many BUG FIX comments in js/scroll-journey-
      // process.js) shows WebKit repeatedly needing an explicit
      // ScrollTrigger.refresh() to correctly (re)paint the three pinned
      // sections after a layout/visibility change, rather than trusting
      // it to redraw what's newly exposed on its own — same fix,
      // applied here right as the thing that was covering all three
      // pins for the entire initial load finally goes away.
      if(window.ScrollTrigger) window.ScrollTrigger.refresh();
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
