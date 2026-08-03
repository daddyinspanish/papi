/* ===================================================================
   Papi — FAQ accordion
   One open at a time — opening a question closes whichever one was
   already open, rather than letting the list grow tall with several
   answers open at once. Height is measured and animated directly
   (rather than a CSS max-height guess) so it works regardless of how
   long any given answer's copy is.
=================================================================== */
(function(){
  const list = document.getElementById('faqList');
  if(!list) return;

  const items = Array.from(list.querySelectorAll('.faq-item'));

  function closeItem(item){
    const answer = item.querySelector('.faq-answer');
    const question = item.querySelector('.faq-question');
    item.classList.remove('is-open');
    question.setAttribute('aria-expanded', 'false');
    answer.style.height = `${answer.scrollHeight}px`;
    // force a reflow before collapsing to 0 — setting height straight
    // from 'auto'-equivalent (scrollHeight) to 0 in the same tick
    // would skip the transition and just snap shut
    void answer.offsetHeight;
    answer.style.height = '0px';
  }

  function openItem(item){
    const answer = item.querySelector('.faq-answer');
    const question = item.querySelector('.faq-question');
    item.classList.add('is-open');
    question.setAttribute('aria-expanded', 'true');
    answer.style.height = `${answer.scrollHeight}px`;

    // Awwwards personality pass — brief glitch-spark on the chevron as
    // it opens (see .faq-chevron.is-glitching in css/style.css).
    // One-shot, removed on its own animationend so it never lingers or
    // re-triggers itself.
    const chevron = item.querySelector('.faq-chevron');
    if(chevron){
      chevron.classList.remove('is-glitching');
      void chevron.offsetWidth; // restart if the same item reopens quickly
      chevron.classList.add('is-glitching');
      // per heat/reliability audit: a fast reopen before the previous
      // animationend fired left the old {once:true} listener stranded
      // (its animation instance got cancelled by the class remove/re-add
      // above, so it never actually fires) — listeners could accumulate
      // on this element across repeated rapid opens. Removing any prior
      // pending one by its stored reference before adding a new one
      // keeps at most one in flight at a time.
      if(chevron._glitchEndHandler) chevron.removeEventListener('animationend', chevron._glitchEndHandler);
      chevron._glitchEndHandler = () => chevron.classList.remove('is-glitching');
      chevron.addEventListener('animationend', chevron._glitchEndHandler, { once: true });
    }
  }

  items.forEach(item=>{
    const question = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    answer.style.height = '0px';
    question.addEventListener('click', ()=>{
      const isOpen = item.classList.contains('is-open');
      items.forEach(other=>{ if(other !== item && other.classList.contains('is-open')) closeItem(other); });
      if(isOpen) closeItem(item); else openItem(item);
    });
    // once the open transition finishes, switch to 'auto' so the
    // answer can still reflow correctly (e.g. text reflowing at a new
    // viewport width) instead of staying locked to the pixel height
    // measured at the moment it opened
    answer.addEventListener('transitionend', (e)=>{
      if(e.propertyName !== 'height') return;
      if(item.classList.contains('is-open')) answer.style.height = 'auto';
    });
  });

  // tapping anywhere outside the FAQ list closes whichever question is
  // open, the same "tap out to dismiss" pattern as the showcase fan
  // cards — lets a visitor back out of a question without having to
  // find and re-tap its own header first
  document.addEventListener('click', (e)=>{
    if(e.target.closest('.faq-item')) return;
    items.forEach(item=>{ if(item.classList.contains('is-open')) closeItem(item); });
  });

  // width-only guard — matches the same pattern used elsewhere on the
  // site: an iOS address-bar-collapse resize (fired on the first
  // scroll of a session) changes innerHeight, not innerWidth, and
  // shouldn't be treated as a real layout change
  let lastResizeWFaq = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeWFaq) <= 10) return;
    lastResizeWFaq = w;
    items.forEach(item=>{
      if(!item.classList.contains('is-open')) return;
      const answer = item.querySelector('.faq-answer');
      if(answer.style.height === 'auto') return;
      answer.style.height = `${answer.scrollHeight}px`;
    });
  });

  // ---------------------------------------------------------------
  // scroll-driven auto-advance — per direct request: "as I scroll one
  // question, it goes to the other." Stays a plain accordion (one open
  // at a time, click still works exactly as above); this layers on top
  // of it, so scrolling through the list opens whichever question is
  // currently nearest the center of the viewport, closing the rest —
  // the visitor never has to click at all to page through the FAQ.
  // rootMargin trims the observed viewport down to a thin horizontal
  // band around its vertical center, so "intersecting" only means
  // "currently the one nearest the middle of the screen," not "visible
  // at all" (which the tall content around it would satisfy for most
  // of a scroll anyway).
  //
  // BUG FIX: per report, "when I scroll through the questions and form
  // on Instagram's in-app browser, the page jumps/snaps." Root cause,
  // confirmed directly: opening an answer changes that item's height in
  // normal document flow, shifting everything below it — including the
  // next question and, right at the section boundary, the quote form.
  // The observer above used to apply that open/close the INSTANT an
  // item crossed into the center band, i.e. while a real touch/momentum
  // scroll was still actively in flight — a layout shift landing mid-
  // gesture fights the OS's own scroll physics, which is exactly what
  // reads as the page "snapping" to a new position on its own (worse in
  // Instagram's WKWebView, which handles this less gracefully than
  // Safari itself). Deferring the actual open/close until scrolling has
  // gone idle for a moment keeps the feature scroll-driven (it still
  // auto-advances as you scroll) without ever reflowing content while a
  // scroll gesture is actively moving the page.
  // ---------------------------------------------------------------
  if('IntersectionObserver' in window){
    let pendingItem = null;
    const focusIO = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        pendingItem = entry.target;
      });
    }, { rootMargin: '-42% 0px -42% 0px', threshold: 0 });
    items.forEach(item => focusIO.observe(item));

    function applyPendingFocus(){
      const item = pendingItem;
      if(!item || item.classList.contains('is-open')) return;
      items.forEach(other=>{ if(other !== item && other.classList.contains('is-open')) closeItem(other); });
      openItem(item);
    }
    let scrollIdleTimer = null;
    window.addEventListener('scroll', ()=>{
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(applyPendingFocus, 140);
    }, { passive:true });
  }
})();
