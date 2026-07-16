/* ===================================================================
   Papi — customer comparison chart
   A simple grouped column chart (an outdated site vs a Papi-built one)
   across a few common metrics. Bars sit flat until the chart actually
   scrolls into view, then grow to their real height and the stat
   percentages count up from zero — a one-time reveal rather than
   something that replays every time the section passes through the
   viewport, which would read as gimmicky rather than informative.
=================================================================== */
(function(){
  const section = document.getElementById('comparisonSection');
  const chart = document.getElementById('comparisonChart');
  if(!section || !chart) return;

  const stats = Array.from(chart.querySelectorAll('.comparison-bar-stat'));
  let revealed = false;

  function countUp(el){
    const target = parseInt(el.dataset.value, 10) || 0;
    const duration = 1200;
    const start = performance.now();
    function frame(ts){
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `+${Math.round(target * eased)}%`;
      if(t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function reveal(){
    if(revealed) return;
    revealed = true;
    chart.classList.add('is-visible');
    // trails the bar-grow transition slightly rather than counting up
    // immediately alongside it — landing right as the bars finish
    // reads as the number confirming what just grew, not a separate,
    // disconnected animation running in parallel
    stats.forEach(el => setTimeout(()=> countUp(el), 500));
  }

  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry => { if(entry.isIntersecting) reveal(); });
    }, { threshold: 0.35 });
    io.observe(section);
  } else {
    reveal();
  }

  // IntersectionObserver only reports a crossing the browser actually
  // renders a frame for — a fast enough scroll (a hard flick, or just
  // a struggling/thermally-throttled phone rendering fewer frames per
  // second) can jump straight past the 0.35 threshold without ever
  // painting the in-between moment, leaving the observer's callback
  // never fired and this chart stuck at its default (flat bars, 0%
  // stats) state for the rest of the visit — confirmed directly: a
  // single scrollTo() past this section skips the observer entirely.
  // That's exactly what showed up as "the numbers section is blank
  // until scrolling back up into it." This plain scroll fallback checks
  // the section's actual on-screen position directly instead of
  // relying on the observer ever getting a chance to fire, and removes
  // itself once revealed, so it costs nothing for the rest of the visit.
  if(!revealed){
    let ticking = false;
    function checkFallback(){
      ticking = false;
      if(revealed) return;
      // true once the section has been reached OR scrolled past
      // entirely — revealing something already off-screen is harmless
      if(section.getBoundingClientRect().top < window.innerHeight) reveal();
      if(revealed) window.removeEventListener('scroll', onScroll);
    }
    function onScroll(){
      if(ticking) return;
      ticking = true;
      requestAnimationFrame(checkFallback);
    }
    window.addEventListener('scroll', onScroll, { passive:true });
    checkFallback();
  }
})();
