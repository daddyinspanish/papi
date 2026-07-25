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

   BUG FIX: per report, "in safari... sometime the page after does not
   load" — this file used to assume (see this file's own original
   comment above) that #hero's own reveal always finishes well before
   anyone reads two lines of text and clicks a button. That's usually
   true but not guaranteed: js/init.js is the LAST of ~15 synchronous
   scripts, and can't even start its own fonts-ready/900ms clock until
   every earlier one has finished loading AND executing — on a slow
   connection/device (or just a fast click), a visitor could dismiss
   this loader before #hero had ever been marked .is-visible, revealing
   a genuinely blank page underneath. Not a rendering bug — a race
   between "user clicked" and "page is actually ready to show." dismiss()
   below now waits for that class before it's allowed to fade the loader
   out, with a 4.2s cap (matching index.html's own belt-and-suspenders
   fallback timing) so a visitor is never stranded if something else
   goes wrong.

   BUG FIX: per report, "leave the page on my tabs, on mobile, then i
   refresh the page turns black after the loading" — this site has hit
   this exact class of bug before (see index.html's own "leave the tab
   open a few minutes, then refresh — black screen" comment/fix): a
   long-backgrounded mobile tab's own refresh can trigger the browser's
   "resume where you left off" scroll restoration (a separate mechanism
   from the History API restoration already disabled up there), and it
   can land asynchronously, sometimes quite late. Before this loader
   existed, the window for that mistiming was short — the page became
   interactive almost immediately after load. Now a visitor can sit on
   this loader for several seconds before clicking, giving that late
   restoration far more room to land AFTER everything (GSAP's pin
   measurement included) already assumed scrollY:0 — so the pin math
   ends up built against a scroll position that no longer matches
   reality once it fires, and the pinned hero renders blank. Nobody can
   scroll behind this full-viewport loader anyway, so there's no
   legitimate reason for scrollY to ever move while it's still up —
   holdScrollAtTop() below re-asserts 0 for as long as that's true,
   closing the window entirely regardless of how late the browser's own
   restoration fires.
=================================================================== */
(function(){
  const loader = document.getElementById('papiLoader');
  if(!loader) return;

  let dismissed = false;
  // deliberately separate from `dismissed` — this stays active for the
  // loader's ENTIRE remaining lifetime (through the hero-wait poll and
  // the fade-out), not just until a button is clicked, since a late
  // scroll-restoration could still land at any point up until GSAP
  // actually re-measures in reveal() below
  let scrollGuardActive = true;

  function holdScrollAtTop(){
    if(!scrollGuardActive) return;
    if(window.scrollY !== 0) window.scrollTo(0, 0);
  }
  window.addEventListener('scroll', holdScrollAtTop, { passive: true });

  function dismiss(){
    if(dismissed) return;
    dismissed = true;
    loader.classList.add('is-entering');

    // BUG FIX: looked up once at the top of this IIFE originally, but
    // this script tag sits BEFORE <main id="hero"> in the document —
    // it runs while the parser hasn't reached that markup yet, so
    // document.getElementById('hero') returned null at that point and
    // stayed null forever (never re-queried). The wait-for-hero logic
    // below silently never engaged as a result — reveal() always ran
    // immediately, same as before this fix existed, which is why the
    // Safari report kept recurring even after that "fix" shipped.
    // Looking it up here instead, at actual click time (long after the
    // full page has parsed), gets the real element.
    const hero = document.getElementById('hero');

    function reveal(){
      loader.classList.add('is-dismissed');
      setTimeout(() => {
        loader.setAttribute('aria-hidden', 'true');
        loader.style.display = 'none';
        // one last correction right before GSAP re-measures, in case a
        // restoration landed during the hero-wait poll above
        if(window.scrollY !== 0) window.scrollTo(0, 0);
        // BUG FIX: per follow-up report, "on safari... enter without
        // sound... enters but shows nothing" — this site's own bug
        // history (see the many BUG FIX comments in js/scroll-journey-
        // process.js) shows WebKit repeatedly needing an explicit
        // ScrollTrigger.refresh() to correctly (re)paint the three
        // pinned sections after a layout/visibility change, rather than
        // trusting it to redraw what's newly exposed on its own — same
        // fix, applied here right as the thing that was covering all
        // three pins for the entire initial load finally goes away.
        if(window.ScrollTrigger) window.ScrollTrigger.refresh();

        // ROOT CAUSE FIX: per report, "i have the website tab open and
        // then i refresh... it enters, but the website is black." The
        // actual mechanism: js/scroll-journey-hero.js pins the hero with
        // start:'bottom bottom' — since the hero is exactly one viewport
        // tall, that resolves to ~scrollY 0, so its own scrubbed
        // timeline's progress is driven almost directly by raw scrollY,
        // over a SHORT total range (only 170%/300% of one viewport). That
        // timeline fades .process-hero-copy to opacity:0 and zooms
        // #processHeroMatrix as progress nears 1 — completely correct
        // behavior for "the visitor scrolled past the hero." The bug:
        // mobile browsers commonly restore a previous scroll position on
        // a plain refresh (this doesn't require a long-backgrounded tab —
        // any refresh after having scrolled down at all can do it), and
        // if GSAP reads that restored scrollY as progress before
        // holdScrollAtTop() above gets a chance to correct it back to 0,
        // it computes progress at/near 1 against that tiny range — hero
        // text fully faded, canvas fully zoomed-in — even though nobody
        // has actually scrolled past the hero yet. Not a paint failure:
        // working code given a momentarily wrong scroll input. scrollTo/
        // refresh above should already correct this via GSAP's own
        // re-measurement, but forcing these two elements back to their
        // untouched CSS defaults here too removes any dependency on
        // exactly how/when GSAP chooses to re-render after refresh().
        const heroCopy = document.querySelector('.process-hero-copy');
        const heroMatrix = document.getElementById('processHeroMatrix');
        if(heroCopy){ heroCopy.style.opacity = ''; heroCopy.style.transform = ''; }
        if(heroMatrix){ heroMatrix.style.transform = ''; }

        // only now hand control back — real scrolling starts here
        scrollGuardActive = false;
        window.removeEventListener('scroll', holdScrollAtTop);
      }, 750);
    }

    if(!hero || hero.classList.contains('is-visible')){
      reveal();
      return;
    }
    let waited = 0;
    const POLL_MS = 40, MAX_WAIT_MS = 4200;
    const iv = setInterval(() => {
      waited += POLL_MS;
      if(hero.classList.contains('is-visible') || waited >= MAX_WAIT_MS){
        clearInterval(iv);
        reveal();
      }
    }, POLL_MS);
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
