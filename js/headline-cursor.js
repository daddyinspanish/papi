/* ===================================================================
   Papi — hero headline cursor-reactive characters
   Splits the hero headline into per-word spans (so the existing
   staggered rise-in entrance still lands on load) and, inside each
   word, per-character spans that gently get pushed away from a nearby
   cursor and spring back — the same push+spring+damping shape used
   elsewhere on this page for cursor-reactive motion, just applied to
   plain text instead of the liquid.
=================================================================== */
(function(){
  const headline = document.getElementById('heroHeadline');
  if(!headline) return;

  // {el, homeX, homeY, x, y, vx, vy} — homeX/Y are the character's own
  // natural (undisturbed) position, measured once layout has settled
  // (see computeHomes below); x/y/vx/vy are the push-physics state
  // added on top of that as a transform.
  const charStates = [];

  function buildSpans(){
    const nodes = Array.from(headline.childNodes);
    headline.innerHTML = '';
    let wordIndex = 0;
    function appendWord(word, isEm){
      const wordSpan = document.createElement('span');
      wordSpan.className = 'hero-headline-word';
      // staggered entrance delay, same shape as the old nth-child rule
      // but driven from here so it never has to be kept in sync with
      // however many words the headline copy happens to contain
      wordSpan.style.animationDelay = `${(0.05 + wordIndex*0.09).toFixed(2)}s`;
      wordIndex++;
      const chars = Array.from(word);
      chars.forEach((ch, i)=>{
        const charSpan = document.createElement('span');
        charSpan.className = 'hero-headline-char' + (isEm ? ' is-em' : '');
        charSpan.textContent = ch;
        if(isEm){
          // same per-letter gradient-window trick as the old .flow-letter
          // treatment — each char slices one gradient spanning the whole
          // emphasized word, so splitting into spans still reads as one
          // continuous sweep rather than separate mini-gradients
          charSpan.style.backgroundSize = `${chars.length * 100}% 100%`;
          charSpan.style.backgroundPositionX = chars.length > 1 ? `${(i/(chars.length-1))*100}%` : '0%';
        }
        wordSpan.appendChild(charSpan);
        charStates.push({ el: charSpan, homeX: 0, homeY: 0, x: 0, y: 0, vx: 0, vy: 0 });
      });
      headline.appendChild(wordSpan);
    }
    nodes.forEach(node=>{
      if(node.nodeType === Node.TEXT_NODE){
        // split on whitespace, keeping the whitespace itself as plain
        // text between word spans so normal line-wrapping still
        // happens exactly where a real space is, not inside a word
        const parts = node.textContent.split(/(\s+)/);
        parts.forEach(part=>{
          if(part === '') return;
          if(/^\s+$/.test(part)) headline.appendChild(document.createTextNode(part));
          else appendWord(part, false);
        });
      } else if(node.nodeName === 'EM'){
        appendWord(node.textContent, true);
      }
    });
  }
  buildSpans();

  function computeHomes(){
    charStates.forEach(st=>{
      const r = st.el.getBoundingClientRect();
      st.homeX = r.left + r.width/2;
      st.homeY = r.top + r.height/2;
    });
  }
  requestAnimationFrame(computeHomes);
  // same late-reflow safety net used throughout this codebase — a web
  // font swap or something above the headline shifting layout can move
  // the characters without ever firing a 'resize' event
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(computeHomes);
  window.addEventListener('load', computeHomes);
  let lastResizeW = window.innerWidth;
  window.addEventListener('resize', ()=>{
    const w = window.innerWidth;
    // >10px tolerance — see the --stable-vh comment in index.html's <head>
    if(Math.abs(w - lastResizeW) <= 10) return;
    lastResizeW = w;
    clearTimeout(window.__papiHeadlineResizeT);
    window.__papiHeadlineResizeT = setTimeout(computeHomes, 150);
  });

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  // kept small — this is body-copy-adjacent display text, not a
  // decorative element, so the touch needs to read as a subtle
  // response to the cursor passing near, not a distracting shove
  const PUSH_RADIUS = 64;
  const PUSH = 0.55;
  const SPRING = 0.06;
  const DAMPING = 0.80;
  let mouseX = -9999, mouseY = -9999;
  window.addEventListener('mousemove', (e)=>{
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function frame(){
    charStates.forEach(st=>{
      const dx = (st.homeX + st.x) - mouseX;
      const dy = (st.homeY + st.y) - mouseY;
      const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
      if(d < PUSH_RADIUS){
        const force = (1 - d/PUSH_RADIUS) * PUSH;
        const ang = Math.atan2(dy, dx);
        st.vx += Math.cos(ang) * force;
        st.vy += Math.sin(ang) * force;
      }
      st.vx += (0 - st.x) * SPRING;
      st.vy += (0 - st.y) * SPRING;
      st.vx *= DAMPING;
      st.vy *= DAMPING;
      st.x += st.vx;
      st.y += st.vy;
      st.el.style.transform = `translate(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px)`;
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
