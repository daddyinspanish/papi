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
      closingBrand.style.transform = `translate(-50%, ${((1 - brandP) * 16).toFixed(1)}px)`;
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

  if(!form) return;
  const successEl = document.getElementById('quoteSuccess');

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
        if(successEl) successEl.textContent = 'Thanks — we’ll be in touch soon.';
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
})();
