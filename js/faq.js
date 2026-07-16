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
