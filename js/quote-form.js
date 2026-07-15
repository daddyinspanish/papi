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
  const titleDock = document.getElementById('titleDock');
  const form = document.getElementById('quoteForm');
  if(!section) return;

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function updateReveal(){
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 when the section's top edge is at the bottom of the viewport,
    // 1 once it's scrolled up to a bit above mid-screen
    const raw = (vh - rect.top) / (vh * 0.65);
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
    // the top-right brand mark/tagline fades out in step with the
    // closing brand fading in — once both are visible at once, the
    // "Built with purpose, not just design" line is just sitting on
    // screen twice. Only overridden while this section is actually in
    // play (brandP > 0); otherwise cleared so title-dock.js's own
    // class-driven visibility keeps working everywhere else on the page.
    if(titleDock){
      titleDock.style.opacity = brandP > 0.001 ? (1 - brandP).toFixed(3) : '';
    }
  }

  let ticking = false;
  function requestUpdate(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ updateReveal(); ticking = false; });
  }
  window.addEventListener('scroll', requestUpdate, { passive:true });
  window.addEventListener('resize', requestUpdate);
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
    // the stack's own height always matches whichever panel is active
    // (see the CSS transition on it) rather than stretching every
    // panel to match the tallest one — the call-back panel has far
    // fewer fields than the quote form, and stretching it left a dead
    // gap at the bottom that read as part of the form being missing
    function syncStackHeight(){
      const panel = panels[activePanel];
      if(panel) formStack.style.height = `${panel.scrollHeight}px`;
    }
    function goToPanel(i){
      const panel = panels[i];
      if(panel) panel.scrollIntoView({ behavior:'smooth', inline:'start', block:'nearest' });
    }
    formTabs.forEach((tab, i)=>{
      tab.addEventListener('click', ()=> goToPanel(i));
    });
    let activePanel = 0;
    // only swaps which tab is highlighted — cheap, safe to do on every
    // scroll frame while the swipe is still in motion
    function updateActiveTab(){
      const stackRect = formStack.getBoundingClientRect();
      const center = stackRect.left + stackRect.width / 2;
      let closest = 0, closestDist = Infinity;
      panels.forEach((panel, i)=>{
        const r = panel.getBoundingClientRect();
        const dist = Math.abs((r.left + r.width / 2) - center);
        if(dist < closestDist){ closestDist = dist; closest = i; }
      });
      if(closest === activePanel) return;
      activePanel = closest;
      formTabs.forEach((tab, i)=>{
        const active = i === activePanel;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    let tabTicking = false;
    // syncStackHeight used to be called straight from updateActiveTab,
    // the instant the closest panel flipped — which happens as soon as
    // a swipe crosses the halfway point, well before the finger lifts
    // or the scroll-snap settles. That kicked off the height CSS
    // transition mid-drag, while the stack was still visibly sliding
    // between two very differently-sized panels: for a moment the box
    // was the wrong height for what was on screen, showing a gap of
    // the section's own background (a gold gradient) instead of form,
    // and reading as a jitter/flash right in the middle of the swipe.
    // Settling the height only once the scroll gesture actually stops
    // (native 'scrollend' where supported, a short debounce as a
    // fallback everywhere else) keeps the resize entirely after the
    // panel has already landed, instead of racing the swipe itself.
    let settleTimer = null;
    function scheduleHeightSync(){
      clearTimeout(settleTimer);
      settleTimer = setTimeout(syncStackHeight, 120);
    }
    formStack.addEventListener('scroll', ()=>{
      if(!tabTicking){
        tabTicking = true;
        requestAnimationFrame(()=>{ updateActiveTab(); tabTicking = false; });
      }
      scheduleHeightSync();
    }, { passive:true });
    if('onscrollend' in window){
      formStack.addEventListener('scrollend', ()=>{
        clearTimeout(settleTimer);
        syncStackHeight();
      });
    }
    window.addEventListener('resize', syncStackHeight);
    // measure once layout has actually settled — measuring in the same
    // tick as creation can catch fonts/images still reflowing, which
    // is what showed up as the panel's height being locked in too short
    requestAnimationFrame(syncStackHeight);
  }
})();
