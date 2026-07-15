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
})();
