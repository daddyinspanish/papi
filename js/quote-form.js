/* ===================================================================
   Papi — quote form
   The copy and the form itself fade/rise in independently (form
   slightly delayed via its own CSS transition-delay) the first time
   the section scrolls into view — same one-shot IntersectionObserver
   reveal pattern used for the showcase and cube eyebrows.

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
  const form = document.getElementById('quoteForm');
  if(!section) return;

  [copy, formWrap].forEach(el=>{
    if(!el || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          el.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold:0.2 });
    observer.observe(el);
  });

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
