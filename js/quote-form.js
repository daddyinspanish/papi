/* ===================================================================
   Papi — quote form
   The copy and the form rise/fade in tied directly to scroll position
   as the section enters the viewport (the form trailing slightly
   behind the copy) — not a fixed-duration animation triggered once by
   an IntersectionObserver. That one-shot approach could finish
   playing before or after the visitor's own scroll speed caught up to
   it, which read as the form just "slapping" into place with no
   sense of motion; tying it straight to scroll means it's always
   exactly as revealed as how far they've scrolled, at any speed, and
   it reverses cleanly if they scroll back up.

   Submissions post to Formspree (see the form's action= in index.html)
   via fetch, so the button can show its own sending/sent state instead
   of a full page navigation. If a visitor has JS disabled, or the
   fetch fails outright, the <form action=... method="POST"> attributes
   still make it work as a plain HTML form submit (Formspree redirects
   back afterward) — that's why e.preventDefault() only happens once
   the fetch path actually starts.
=================================================================== */
(function(){
  const section = document.getElementById('quoteSection');
  const copy = document.querySelector('.quote-copy');
  const formWrap = document.querySelector('.quote-form-wrap');
  const closingBrand = document.getElementById('closingBrand');
  const form = document.getElementById('quoteForm');
  if(!section) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  let revealPinnedLow = false, revealPinnedHigh = false;
  function updateReveal(){
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 when the section's top edge is at the bottom of the viewport,
    // 1 once it's scrolled up to a bit above mid-screen
    const raw = (vh - rect.top) / (vh * 0.65);

    // skip the redundant recompute once fully settled at either end —
    // this section sits last on the page, so "not yet reached" covers
    // the entire rest of the visit up to this point; re-running this on
    // every single scroll event the whole time, everywhere else on the
    // page, was pure waste once the values here can't change any further
    if(raw < 0){
      if(revealPinnedLow) return;
      revealPinnedLow = true;
    } else {
      revealPinnedLow = false;
    }
    if(raw > 1){
      if(revealPinnedHigh) return;
      revealPinnedHigh = true;
    } else {
      revealPinnedHigh = false;
    }

    const p = Math.max(0, Math.min(1, raw));

    const copyP = smoothstep(0, 0.7, p);
    const formP = smoothstep(0.25, 1, p); // trails the copy a beat behind

    if(copy){
      copy.style.opacity = copyP.toFixed(3);
      copy.style.transform = `translateY(${((1 - copyP) * 26).toFixed(1)}px)`;
    }
    if(formWrap){
      formWrap.style.opacity = formP.toFixed(3);
      formWrap.style.transform = `translateY(${((1 - formP) * 26).toFixed(1)}px)`;
    }
    const brandP = smoothstep(0.15, 0.85, p);
    if(closingBrand){
      closingBrand.style.opacity = brandP.toFixed(3);
      closingBrand.style.transform = `translateY(${((1 - brandP) * 16).toFixed(1)}px)`;
    }
  }

  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ updateReveal(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });
  // width-only guard — on iOS Safari, scrolling for the first time in a
  // session collapses the address bar, firing a 'resize' that changes
  // innerHeight but not innerWidth. Without this, that one resize would
  // trigger a recompute here too, right at the exact moment of the
  // first scroll, on top of whatever else reacts to that same event.
  let lastResizeWQuote = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeWQuote) <= 10) return;
    lastResizeWQuote = w;
    requestUpdate();
  });
  updateReveal();

  // neither a <select> nor a date input has a :placeholder-shown state
  // to float its label off of (that's built for text inputs), so their
  // floated state is driven by this .has-value class instead — toggled
  // on change, and checked once up front in case a browser restores a
  // previous value on reload
  document.querySelectorAll('.quote-field--select select, .quote-field--date input').forEach(field=>{
    const sync = ()=> field.classList.toggle('has-value', field.value !== '');
    field.addEventListener('change', sync);
    sync();
  });

  // can't pick a call-back date that's already passed — set once the
  // page loads rather than hard-coding it into the HTML
  const dateField = document.getElementById('cDate');
  if(dateField){
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateField.min = `${yyyy}-${mm}-${dd}`;
  }

  // wires a form up to submit via fetch (so the button can show its
  // own sending/sent state instead of a full page navigation) with a
  // native submit as the fallback if fetch throws — shared by both the
  // quote request and call-back request forms below
  function wireForm(form, successEl, successText){
    if(!form) return;
    form.addEventListener('submit', (e)=>{
      if(!form.reportValidity()) { e.preventDefault(); return; }
      if(form.classList.contains('is-sending') || form.classList.contains('is-sent')){
        e.preventDefault();
        return;
      }

      // from here on we're taking over the submit ourselves — if fetch
      // throws (network down, blocked, etc.) we fall back to letting the
      // form submit natively to its action= URL instead of hard-failing
      e.preventDefault();
      form.classList.remove('is-error');
      form.classList.add('is-sending');

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' },
      }).then(res=>{
        form.classList.remove('is-sending');
        if(res.ok){
          form.classList.add('is-sent');
          if(successEl) successEl.textContent = successText;
        } else {
          form.classList.add('is-error');
          if(successEl) successEl.textContent = 'Something went wrong — please try again.';
        }
      }).catch(()=>{
        form.classList.remove('is-sending');
        form.classList.add('is-error');
        if(successEl) successEl.textContent = 'Something went wrong — please try again.';
      });
    });
  }

  wireForm(form, document.getElementById('quoteSuccess'), 'Thanks — we’ll be in touch soon.');
  wireForm(document.getElementById('callForm'), document.getElementById('callSuccess'), 'Thanks — we’ll call you soon.');

  // ---- the two panels (quote request / call-back request) swipe like
  // the testimonials row — tabs above are the click/keyboard equivalent
  // and mirror whichever panel scroll has landed on ----
  const formStack = document.getElementById('quoteFormStack');
  const formTabs = Array.from(document.querySelectorAll('.quote-form-tab'));
  if(formStack && formTabs.length){
    const panels = Array.from(formStack.children);
    // always recomputed fresh rather than trusted from a stored
    // variable — syncStackHeight used to read a separately-tracked
    // `activePanel` that updateActiveTab only updates on its own
    // rAF-throttled schedule. The two could fall out of step (rAF and
    // the scroll-position math don't run in lockstep), so
    // syncStackHeight would occasionally set the height for whichever
    // panel *used to* be active rather than the one actually on
    // screen — a real, wrong height, not just a mid-animation one,
    // which is exactly what kept exposing the section's own gold
    // background at the bottom of the form on some swipes (and on tab
    // clicks, which scroll the same stack). Computing the closest panel
    // fresh every time removes the possibility of that mismatch outright.
    function getClosestPanelIndex(){
      const stackRect = formStack.getBoundingClientRect();
      const center = stackRect.left + stackRect.width / 2;
      let closest = 0, closestDist = Infinity;
      panels.forEach((panel, i)=>{
        const r = panel.getBoundingClientRect();
        const dist = Math.abs((r.left + r.width / 2) - center);
        if(dist < closestDist){ closestDist = dist; closest = i; }
      });
      return closest;
    }
    // the stack's height is fixed to whichever panel is *tallest*,
    // measured once (plus on resize/font-load) — it no longer resizes
    // to match whichever panel is currently active. That per-panel
    // resizing was the root of two separate problems: swapping to a
    // shorter panel shrank the whole form section in the page's normal
    // flow, which shifted everything below it (the closing Papi
    // signature) up and down on every single swipe; and any brief
    // mismatch between the resize and which panel visually settled
    // was what kept exposing a gap at the form's own rounded corners.
    // A fixed height trades a small empty gap under the shorter
    // call-back panel for the form — and the page around it — never
    // moving on its own again. The +1px is a small buffer against
    // scrollHeight's own integer rounding landing a hair short of the
    // real, sub-pixel content height.
    function syncStackHeight(){
      const tallest = Math.max(...panels.map(p => p.scrollHeight));
      formStack.style.height = `${tallest + 1}px`;
    }
    function goToPanel(i){
      const panel = panels[i];
      if(panel) panel.scrollIntoView({ behavior:'smooth', inline:'start', block:'nearest' });
    }
    formTabs.forEach((tab, i)=>{
      tab.addEventListener('click', ()=> goToPanel(i));
    });
    let activePanel = 0;
    // only swaps which tab is highlighted — the height itself is fixed
    // now, so this is purely cosmetic and safe to run live on every
    // scroll frame while a swipe is still in motion
    function updateActiveTab(){
      const closest = getClosestPanelIndex();
      if(closest === activePanel) return;
      activePanel = closest;
      formTabs.forEach((tab, i)=>{
        const active = i === activePanel;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    let tabTicking = false;
    formStack.addEventListener('scroll', ()=>{
      if(tabTicking) return;
      tabTicking = true;
      requestAnimationFrame(()=>{ updateActiveTab(); tabTicking = false; });
    }, { passive:true });
    // same width-only guard reasoning as the outer resize listener
    // above (its own tracking variable — sharing one across both
    // listeners would race, since whichever fires first updates it
    // before the second one reads it) — an iOS address-bar-collapse
    // resize shouldn't re-measure panel heights either
    let lastResizeWStack = window.innerWidth;
    window.addEventListener('resize', ()=>{
      const w = window.innerWidth;
      // >10px tolerance — see the --stable-vh comment in index.html's <head>
      if(Math.abs(w - lastResizeWStack) <= 10) return;
      lastResizeWStack = w;
      syncStackHeight();
    });
    // measured more than once (same reasoning as contrast.js's
    // sizeStage) — a single rAF right at script load can still land
    // before the webfonts (Fraunces/Inter, loaded via a `display:swap`
    // Google Fonts link) have swapped in, locking this height in off
    // the fallback font's shorter metrics. That's what showed up as an
    // empty gap where the form should be while scrolling in from the
    // FAQ section above it: the section's true height (fonts settled)
    // is taller than what got measured and locked in, so the extra
    // real content is sitting below where the page had already laid
    // everything else out. Re-measuring once fonts are actually ready
    // (and again on window 'load', in case images elsewhere on the
    // page are still shifting layout at that point) corrects it.
    requestAnimationFrame(syncStackHeight);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(syncStackHeight);
    window.addEventListener('load', syncStackHeight);
  }
})();
