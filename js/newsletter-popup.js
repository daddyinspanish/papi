/* ===================================================================
   Papi — newsletter popup
   Shown once, the first time the visitor scrolls past the before/after
   section — not tied to a fixed timer or an IntersectionObserver alone
   (an observer can miss a fast scroll/flick that jumps straight past
   the threshold without the browser ever rendering the in-between
   frame; see the same class of bug already fixed in
   comparison-chart.js). A plain scroll-position check against the
   section's own bounding rect catches that reliably instead.

   Persisted via localStorage so a visitor who's already seen it (closed
   it, or already subscribed) never gets it again on a later visit —
   the friendlier default for a discount popup versus re-nagging every
   session.
=================================================================== */
(function(){
  const popup = document.getElementById('newsletterPopup');
  const backdrop = document.getElementById('newsletterBackdrop');
  const closeBtn = document.getElementById('newsletterClose');
  const form = document.getElementById('newsletterForm');
  const successEl = document.getElementById('newsletterSuccess');
  const contrastSection = document.getElementById('contrastSection');
  if(!popup || !contrastSection) return;

  const STORAGE_KEY = 'papi_newsletter_seen';
  let shown = false;

  function open(){
    if(shown) return;
    shown = true;
    popup.classList.add('is-visible');
    popup.setAttribute('aria-hidden', 'false');
    window.Papi && window.Papi.lockScroll && window.Papi.lockScroll();
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e){ /* private-mode storage can throw — losing the "seen" flag just means it might show again, not a functional break */ }
  }
  function close(){
    if(!shown) return;
    popup.classList.remove('is-visible');
    popup.setAttribute('aria-hidden', 'true');
    window.Papi && window.Papi.unlockScroll && window.Papi.unlockScroll();
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
      // should surface once the before/after story has actually been
      // seen, not the moment it first comes into view)
      if(contrastSection.getBoundingClientRect().bottom <= 0) open();
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
  if(backdrop) backdrop.addEventListener('click', close);
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && popup.classList.contains('is-visible')) close();
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
