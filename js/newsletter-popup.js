/* ===================================================================
   Papi — newsletter popup
   Shown once, the first time the visitor scrolls past the live-demo
   section (was the before/after comparison section, before that was
   removed entirely per direct request — live-demo is now the first
   real section after the hero, so it's the same "seen enough to be
   engaged" landmark the before/after section used to be) — not tied
   to a fixed timer or an IntersectionObserver alone (an observer can
   miss a fast scroll/flick that jumps straight past the threshold
   without the browser ever rendering the in-between frame; see the
   same class of bug already fixed in comparison-chart.js). A plain
   scroll-position check against the section's own bounding rect
   catches that reliably instead.

   Persisted via localStorage so a visitor who's already seen it (closed
   it, or already subscribed) never gets it again on a later visit —
   the friendlier default for a discount popup versus re-nagging every
   session.

   REDESIGNED per direct request: "I do not want the pop up to just
   pop up and cover the screen... something immersive, doesnt take the
   entire page, sleek, small." No more full-page backdrop element or
   scroll lock — this is a small corner card now (see its own CSS
   comment), so the visitor can keep scrolling/interacting with the
   rest of the page while it's up. Click-outside-to-close replaces the
   old backdrop-click handler, since there's no backdrop element left
   to click on.
=================================================================== */
(function(){
  const popup = document.getElementById('newsletterPopup');
  const card = document.querySelector('.newsletter-popup-card');
  const closeBtn = document.getElementById('newsletterClose');
  const form = document.getElementById('newsletterForm');
  const successEl = document.getElementById('newsletterSuccess');
  const triggerSection = document.getElementById('liveDemoSection');
  if(!popup || !triggerSection) return;

  const STORAGE_KEY = 'papi_newsletter_seen';
  let shown = false;

  function open(){
    if(shown) return;
    shown = true;
    popup.classList.add('is-visible');
    popup.setAttribute('aria-hidden', 'false');
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e){ /* private-mode storage can throw — losing the "seen" flag just means it might show again, not a functional break */ }
  }
  function close(){
    if(!shown) return;
    popup.classList.remove('is-visible');
    popup.setAttribute('aria-hidden', 'true');
  }

  let alreadySeen = false;
  try { alreadySeen = localStorage.getItem(STORAGE_KEY) === '1'; } catch(e){ /* treat as not-seen if storage is blocked */ }
  if(alreadySeen){
    shown = true; // pre-mark so checkTrigger below never opens it
  } else {
    let ticking = false;
    function checkTrigger(){
      ticking = false;
      if(shown) return;
      // fully scrolled past the section (not just "reached" — this
      // should surface once the live demos have actually been seen,
      // not the moment they first come into view)
      if(triggerSection.getBoundingClientRect().bottom <= 0) open();
    }
    function onScroll(){
      if(ticking) return;
      ticking = true;
      requestAnimationFrame(checkTrigger);
    }
    window.addEventListener('scroll', onScroll, { passive:true });
    checkTrigger();
  }

  if(closeBtn) closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && popup.classList.contains('is-visible')) close();
  });
  // click-outside-to-close — the popup no longer has a backdrop element
  // to catch this the old way, since it's a small corner card that
  // doesn't block the rest of the page
  document.addEventListener('click', (e)=>{
    if(!popup.classList.contains('is-visible')) return;
    if(card && card.contains(e.target)) return;
    close();
  });

  // same fetch-with-native-fallback submit pattern as quote-form.js
  if(form){
    form.addEventListener('submit', (e)=>{
      if(!form.reportValidity()) { e.preventDefault(); return; }
      if(form.classList.contains('is-sending') || form.classList.contains('is-sent')){
        e.preventDefault();
        return;
      }
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
          if(successEl) successEl.textContent = "Thanks for subscribing — we'll be in touch with your discount code soon.";
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

  // the industry <select> already gets its floating-label .has-value
  // toggle for free — quote-form.js's own setup wires up every
  // .quote-field--select select in the document, not just its own
})();
