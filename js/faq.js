/* ===================================================================
   Papi — FAQ accordion
   One open at a time — opening a question closes whichever one was
   already open, rather than letting the list grow tall with several
   answers open at once. Height is measured and animated directly
   (rather than a CSS max-height guess) so it works regardless of how
   long any given answer's copy is.
=================================================================== */
(function(){
  const section = document.getElementById('faqSection');
  const list = document.getElementById('faqList');
  if(!list) return;

  const items = Array.from(list.querySelectorAll('.faq-item'));

  function smoothstep(edge0, edge1, x){
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  // a small overshoot-then-settle curve (scale/position push slightly
  // past their resting value before easing back) — what actually reads
  // as a "bounce" rather than a plain fade/rise
  function easeOutBack(x){
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // each question bounces into place as the section scrolls into view,
  // staggered left-to-right down the list rather than all landing at
  // once — tied directly to scroll position (same convention as the
  // showcase/testimonials entrances) so it reverses cleanly on scroll-up
  function updateEntrance(){
    if(!section || prefersReducedMotion) return;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const raw = (vh - rect.top) / (vh * 0.8);
    const p = Math.max(0, Math.min(1, raw));
    const n = items.length;
    items.forEach((item, i)=>{
      const start = n > 1 ? (i / n) * 0.5 : 0;
      const wp = smoothstep(start, start + 0.5, p);
      const eased = easeOutBack(wp);
      item.style.opacity = wp.toFixed(3);
      item.style.transform = `translateY(${((1 - eased) * 28).toFixed(1)}px) scale(${(0.94 + 0.06 * eased).toFixed(3)})`;
    });
  }
  if(prefersReducedMotion){
    items.forEach(item=>{ item.style.opacity = '1'; });
  } else {
    let entranceTicking = false;
    window.addEventListener('scroll', ()=>{
      if(entranceTicking) return;
      entranceTicking = true;
      requestAnimationFrame(()=>{ updateEntrance(); entranceTicking = false; });
    }, { passive:true });
    updateEntrance();
  }

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

  // width-only guard — matches the same pattern used elsewhere on the
  // site: an iOS address-bar-collapse resize (fired on the first
  // scroll of a session) changes innerHeight, not innerWidth, and
  // shouldn't be treated as a real layout change
  let lastResizeWFaq = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    if(w === lastResizeWFaq) return;
    lastResizeWFaq = w;
    items.forEach(item=>{
      if(!item.classList.contains('is-open')) return;
      const answer = item.querySelector('.faq-answer');
      if(answer.style.height === 'auto') return;
      answer.style.height = `${answer.scrollHeight}px`;
    });
  });
})();
