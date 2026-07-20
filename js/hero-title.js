/* ===================================================================
   Papi — process-room hero title
   Two independent jobs live in this one small file:

   1. Letter-by-letter entrance reveal. Splits each line's text into
      individual <span class="title-letter"> characters, each with its
      own staggered animation-delay (css/style.css's own
      titleLetterLiquidReveal keyframe does the actual wobble/blur
      settle) — a wave visibly passes left-to-right through the text as
      each letter resolves on its own slightly later delay, rather than
      the whole line just fading up as one flat block. Runs regardless
      of reduced-motion (wrapping the text into spans is harmless on its
      own; style.css itself is what skips the actual animation under
      prefers-reduced-motion, leaving the wrapped letters simply static).
      Each WORD gets its own nowrap wrapper around its own letters —
      wrapping every character in its own inline-block with nothing
      grouping them let the browser treat every letter boundary as a
      valid line-break point, not just real word boundaries, which
      split "with" into "wit" + "h" across two lines on a narrow mobile
      viewport. The word wrapper is what a real line-break can happen
      around; individual letters only ever break from each other within
      that same word (i.e. never, since nowrap forbids it there).

   2. A subtle 3D tilt reading the same camera-parallax cursor position
      that already swings the room itself (js/process-room.js's own
      room.mouse.x/y — the room already tracks this for its own camera
      rotateY/rotateX, so the title just reads the same live values
      rather than adding a second mousemove listener). Deliberately
      INVERTED relative to the camera's own parallax (see
      process-room.js's own camera.rotateY(-mouse.x*yaw)/rotateX(mouse.y*
      pitch) and position.x/y nudges, both driven straight off mouse.x/y)
      — per direct request, the title should tilt AWAY from wherever the
      camera itself is panning toward, not with it, so it reads as its
      own separate object catching the light differently rather than
      just another piece of the room swinging in lockstep. Skipped
      entirely under reduced-motion (the tilt is a motion effect, same
      standard this whole site follows elsewhere).
=================================================================== */
(function(){
  const line1 = document.querySelector('.process-room-title-line1');
  const line2 = document.querySelector('.process-room-title-line2');
  let letterCount = 0;
  [line1, line2].forEach((line) => {
    if(!line) return;
    const words = line.textContent.split(' ');
    line.textContent = '';
    const frag = document.createDocumentFragment();
    words.forEach((word, wi) => {
      const wordSpan = document.createElement('span');
      wordSpan.style.display = 'inline-block';
      wordSpan.style.whiteSpace = 'nowrap';
      Array.from(word).forEach((ch) => {
        const letter = document.createElement('span');
        letter.className = 'title-letter';
        letter.textContent = ch;
        letter.style.animationDelay = (0.3 + letterCount * 0.026) + 's';
        letterCount++;
        wordSpan.appendChild(letter);
      });
      frag.appendChild(wordSpan);
      if(wi < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    line.appendChild(frag);
  });
})();

(function(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const tilt = document.getElementById('processRoomTitleTilt');
  if(!tilt) return;

  const MAX_TILT_DEG = 7;
  let rafId = null;

  function frame(){
    rafId = null;
    const room = window.Papi && window.Papi.processRoom;
    if(room && room.mouse){
      // positive ry for positive mouse.x (camera panning right) — per
      // direct request, checked empirically rather than by pure sign
      // math: measured the actual on-screen height of the first vs.
      // last letter at a large test angle for both signs (the nearer,
      // more-foreshortened edge of a true perspective rotateY reads
      // taller than the receding edge), confirmed positive rotateY is
      // what brings the LEFT edge forward/larger — i.e. "tilts left" —
      // while mouse.x is positive, matching "camera moves right, title
      // tilts left, and vice versa." This only reads as true perspective
      // (rather than a flat cosine squish with no directional cue at
      // all) because perspective now lives on .process-room-title, the
      // tilt wrapper's own parent — see that rule's own CSS comment
      const rx = (room.mouse.y * MAX_TILT_DEG).toFixed(2);
      const ry = (room.mouse.x * MAX_TILT_DEG).toFixed(2);
      tilt.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
    } else if(!rafId){
      rafId = requestAnimationFrame(frame);
    }
  });
})();
