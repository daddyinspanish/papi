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

   BUG FIX: per report, "on desktop its still happening" — the fix
   above only ever CORRECTS scrollY back to 0 reactively, on the
   'scroll' event, after it's already moved. That's enough for a
   one-time restoration jump, but not for a visitor who simply scrolls
   their mouse wheel/trackpad while reading this loader (completely
   ordinary behavior, and the likely actual desktop cause) — a
   continuous wheel gesture fires many scroll deltas in a row, and each
   one moves real scrollY an instant before the correction lands,
   feeding js/scroll-journey-hero.js's own per-frame scroll read a
   nonzero value again and again. Given that pin's whole range is only
   170%/300% of one viewport (see the earlier BUG FIX above), even an
   ordinary few notches of scrolling is enough to visibly fade/zoom the
   hero. Reactive correction can't reliably win that fight. preventDoc-
   Scroll() below stops it at the source instead: while the loader is
   still up, wheel/touchmove input is prevented from ever moving
   scrollY in the first place, on both this document and — the same
   original blank-screen bug can equally be triggered by a wheel/touch
   gesture over the loader's own DOM node specifically, since it has no
   scroll container of its own to absorb the input. Arrow/Space/Page
   keys are blocked the same way, for a keyboard user doing the same
   thing. Nobody should be able to scroll behind a full-viewport loader
   anyway, so none of this removes any real capability.
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

  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
  function preventDocScroll(e){
    if(!scrollGuardActive) return;
    if(e.type === 'keydown'){
      if(!SCROLL_KEYS.has(e.key)) return;
      // don't swallow Space/Enter meant to keyboard-activate the
      // loader's own focused button
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
    loader.classList.add('is-entering');

    // BUG FIX: per report, "when you search up the tab on safari or are
    // doing a new load for a fresh tab... it enters but the hero is
    // never loaded" — this file used to look up #hero ONCE (either at
    // module-load time originally, or at click time after an earlier
    // fix), then either reveal immediately if that lookup was null, or
    // poll that SAME cached reference. Both miss the same real case: on
    // a genuinely fresh load, the browser paints/renders progressively
    // as it parses — the loader sits very early in the document and can
    // become visible and clickable before the parser has even reached
    // <main id="hero"> further down. A visitor who clicks fast enough
    // (or whose connection is slow enough that parsing is still
    // ongoing) can trigger this at a moment document.getElementById
    // ('hero') genuinely returns null — not "doesn't exist," just "not
    // parsed yet." Treating null as "nothing to wait for" and revealing
    // immediately reproduces the exact same blank-page race this was
    // supposed to close. heroReady() below re-queries fresh on every
    // poll tick instead of trusting one cached lookup, so it keeps
    // waiting until the element actually exists AND is visible, however
    // long parsing takes (bounded by MAX_WAIT_MS below either way).
    function heroReady(){
      const hero = document.getElementById('hero');
      return !!hero && hero.classList.contains('is-visible');
    }

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
        window.removeEventListener('wheel', preventDocScroll);
        window.removeEventListener('touchmove', preventDocScroll);
        window.removeEventListener('keydown', preventDocScroll);
      }, 750);
    }

    if(heroReady()){
      reveal();
      return;
    }
    let waited = 0;
    // was 4200 — only 200ms past index.html's own 4000ms belt-and-
    // suspenders fallback, not a comfortable margin once real timer
    // jitter under load is accounted for. 6000 gives that fallback
    // (or, far more often, js/init.js's own much earlier fonts-ready/
    // 900ms reveal) real room to land first.
    const POLL_MS = 40, MAX_WAIT_MS = 6000;
    const iv = setInterval(() => {
      waited += POLL_MS;
      if(heroReady() || waited >= MAX_WAIT_MS){
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
