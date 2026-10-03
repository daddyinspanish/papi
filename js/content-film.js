/* ===================================================================
   Papi — Content & Film (portfolio videos)
   A 3D "cylinder" of video covers: the front one faces you and the rest
   sit behind it, stepping back and to either side (and wrapping all the
   way round). Swipe / drag / horizontal-scroll / arrow keys / the
   arrows & dots rotate it. Tapping the FRONT video pops it up in a
   large player and starts it; tapping off it (backdrop, ×, or Esc)
   closes the player and the cylinder is as you left it.

   Inside the popped-up player, when a clip finishes a "Tap here to learn
   more" button appears; tapping it flips the player to a description of
   that video (the `description` below), with a "Back to video" button.

   Nothing downloads until a video is actually opened (the covers in the
   cylinder are lazy-loaded images; the video element only exists inside
   the pop-up and uses preload="none" until play).

   HOW TO ADD / EDIT A VIDEO
   1. Put the compressed file under videos/content/ and a poster image
      under img/content/ (720px-wide H.264 MP4 with faststart + a 1080px
      WebP poster keeps it light — see git history for the ffmpeg
      settings; note some phone files are "anamorphic" — check the
      display aspect ratio with ffprobe before scaling).
   2. Add/edit one entry in VIDEOS below:
        {
          title: 'Caption shown with the video',
          src: 'videos/content/name.mp4?v=1',
          poster: 'img/content/name.webp?v=1',
          ratio: '9 / 16',
          description: 'Text for the back of the card. Separate paragraphs with a blank line (\n\n).',
        }
   3. Replacing a file with the same name? Bump its ?v= number — media is
      cached for a year (see vercel.json), so a new ?v= is what makes
      browsers fetch the new version.
=================================================================== */
(function(){
  const mount = document.getElementById('contentFilmGrid');
  if(!mount) return;

  // All clips are re-encoded for the web (720px H.264, faststart, ~2-8MB
  // each vs 40-400MB originals — originals live outside the repo in
  // ~/Desktop/Papi Website Videos). Posters are real frames from each clip.
  //
  // EDIT THE `description` TEXT BELOW — these are plain starting points
  // that only restate what each video is, so there's nothing on the site
  // that isn't true. Replace them with the expertise/story behind each
  // video (results, what you did, who it was for).
  const VIDEOS = [
    {
      title: '4M Dental Implant Center Transformation',
      src: 'videos/content/4m-transformation.mp4?v=1',
      poster: 'img/content/4m-transformation.webp?v=2',
      ratio: '9 / 16',
      description: 'A before-and-after patient transformation filmed for 4M Dental Implant Center.',
    },
    {
      title: 'Dr. Kamran Pakdamanian',
      src: 'videos/content/dr-kamran.mp4?v=1',
      poster: 'img/content/dr-kamran.webp?v=2',
      ratio: '9 / 16',
      description: 'A cinematic video of Dr. Kamran Pakdamanian at work.',
    },
    {
      title: 'Andy Choi, Multi Family Investor',
      src: 'videos/content/andy-choi.mp4?v=1',
      poster: 'img/content/andy-choi.webp?v=2',
      ratio: '9 / 16',
      description: 'A real estate house tour for Andy Choi, a multi family investor.',
    },
    {
      title: 'Dent All By Dr. Z',
      src: 'videos/content/dent-all-dr-z.mp4?v=2',
      poster: 'img/content/dent-all-dr-z.webp?v=3',
      ratio: '9 / 16',
      description: 'A video for Dent All by Dr. Z.',
    },
    {
      title: 'Black Health Connect',
      src: 'videos/content/black-health-connect.mp4?v=1',
      poster: 'img/content/black-health-connect.webp?v=2',
      ratio: '9 / 16',
      description: 'A video for Black Health Connect.',
    },
  ];
  const N = VIDEOS.length;
  if(!N) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     The player card (used inside the pop-up): video + play overlay +
     end-of-clip prompt on the front, description on the back.
  ------------------------------------------------------------------ */
  const players = [];

  function buildVideoCard(video){
    const card = document.createElement('div');
    card.className = 'content-film-card content-film-card--video';
    const paragraphs = String(video.description || '')
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join('');

    card.innerHTML = `
      <div class="content-film-flip">
        <div class="content-film-face content-film-front">
          <div class="content-film-player" style="--cf-ratio:${esc(video.ratio || '9 / 16')}">
            <video class="content-film-video" src="${esc(video.src)}" poster="${esc(video.poster)}" playsinline preload="none" aria-label="${esc(video.title)}"></video>
            <button type="button" class="content-film-play" aria-label="Play video: ${esc(video.title)}">
              <span class="content-film-play-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
              </span>
            </button>
            <div class="content-film-end">
              <button type="button" class="content-film-more">Tap here to learn more</button>
              <button type="button" class="content-film-replay">Replay</button>
            </div>
          </div>
          <p class="content-film-card-title content-film-card-title--caption">${esc(video.title)}</p>
        </div>
        <div class="content-film-face content-film-back" aria-hidden="true" inert>
          <p class="content-film-back-eyebrow">About this video</p>
          <h3 class="content-film-back-title">${esc(video.title)}</h3>
          <div class="content-film-back-text">${paragraphs}</div>
          <button type="button" class="content-film-back-btn">Back to video</button>
        </div>
      </div>`;

    const front = card.querySelector('.content-film-front');
    const back = card.querySelector('.content-film-back');
    const el = card.querySelector('video');
    const playBtn = card.querySelector('.content-film-play');
    const moreBtn = card.querySelector('.content-film-more');
    const replayBtn = card.querySelector('.content-film-replay');
    const backBtn = card.querySelector('.content-film-back-btn');

    const showPoster = () => {
      el.controls = false;
      card.classList.remove('is-playing', 'is-ended');
    };
    const startPlayback = () => {
      players.forEach((p) => { if(p !== el) p.pause(); });
      card.classList.remove('is-ended');
      el.controls = true;
      card.classList.add('is-playing');
      el.play().catch(showPoster);
    };
    const setFlipped = (flipped) => {
      card.classList.toggle('is-flipped', flipped);
      front.toggleAttribute('inert', flipped);
      back.toggleAttribute('inert', !flipped);
      back.setAttribute('aria-hidden', flipped ? 'false' : 'true');
      if(flipped) backBtn.focus({ preventScroll: true });
      else playBtn.focus({ preventScroll: true });
    };

    playBtn.addEventListener('click', startPlayback);
    replayBtn.addEventListener('click', () => { el.currentTime = 0; startPlayback(); });
    el.addEventListener('ended', () => {
      // keep the last frame on screen under the "learn more" prompt
      el.controls = false;
      card.classList.add('is-ended');
    });
    moreBtn.addEventListener('click', () => { el.pause(); setFlipped(true); });
    backBtn.addEventListener('click', () => {
      el.currentTime = 0;
      showPoster();
      setFlipped(false);
    });

    players.push(el);
    card.startPlayback = startPlayback;
    return card;
  }

  /* ------------------------------------------------------------------
     Auto-rotation
     The cylinder turns on its own, one video every AUTO_MS. It stops
     for as long as the pop-up player is open (a video playing, ended, or
     flipped to its description) and starts again RESUME_MS after the
     visitor closes it. It also holds still while the cursor is over the
     stage or after any manual rotate/tap (RESUME_MS after the last
     touch), while the section is off-screen, in a background tab, and
     under prefers-reduced-motion.
  ------------------------------------------------------------------ */
  const AUTO_MS = 2000;
  const RESUME_MS = 4000;
  let autoTimer = 0;
  let modalOpen = false, hovering = false, inView = false;
  const canAuto = () => !reduceMotion && inView && !hovering && !modalOpen && !document.hidden;
  function stopAuto(){ clearTimeout(autoTimer); autoTimer = 0; }
  // (re)start the clock: the next turn happens `delay` ms from now
  function scheduleAuto(delay){
    stopAuto();
    if(!canAuto()) return;
    autoTimer = setTimeout(autoTick, delay);
  }
  function autoTick(){
    autoTimer = 0;
    if(!canAuto()) return;
    setActive(active + 1);
    autoTimer = setTimeout(autoTick, AUTO_MS);
  }
  const userActed = () => scheduleAuto(RESUME_MS);

  /* ------------------------------------------------------------------
     Pop-up player
  ------------------------------------------------------------------ */
  const modal = document.createElement('div');
  modal.className = 'cf-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Video player');
  modal.innerHTML = `
    <button type="button" class="cf-modal-close" aria-label="Close video">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <div class="cf-modal-body"></div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector('.cf-modal-body');
  const closeBtn = modal.querySelector('.cf-modal-close');
  let openTrigger = null;
  let closeTimer = null;

  // the pop-up covers the viewport, so wheel/touch scrolling over it
  // shouldn't scroll the page underneath (the flipped card's own text
  // is the one thing that may genuinely need to scroll)
  const blockScroll = (e) => { if(!e.target.closest('.content-film-back')) e.preventDefault(); };
  modal.addEventListener('wheel', blockScroll, { passive: false });
  modal.addEventListener('touchmove', blockScroll, { passive: false });

  function openModal(video, trigger){
    clearTimeout(closeTimer);
    openTrigger = trigger || null;
    modalBody.innerHTML = '';
    players.length = 0;
    const [rw, rh] = String(video.ratio || '9 / 16').split('/').map((n) => parseFloat(n) || 1);
    modalBody.style.setProperty('--cf-rw', rw);
    modalBody.style.setProperty('--cf-rh', rh);
    const card = buildVideoCard(video);
    modalBody.appendChild(card);
    modalOpen = true;
    stopAuto();
    modal.hidden = false;
    // next frame, so the open transition actually runs
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-open')));
    // opened from a tap on the front video, so autoplay (with sound) is allowed
    card.startPlayback();
    closeBtn.focus({ preventScroll: true });
  }

  function closeModal(){
    if(modal.hidden) return;
    modalOpen = false;
    scheduleAuto(RESUME_MS); // wait a few seconds after they click off it
    players.forEach((p) => p.pause());
    modal.classList.remove('is-open');
    closeTimer = setTimeout(() => {
      modal.hidden = true;
      modalBody.innerHTML = '';
      players.length = 0;
    }, reduceMotion ? 0 : 320);
    if(openTrigger) openTrigger.focus({ preventScroll: true });
  }

  modal.addEventListener('click', (e) => {
    // click "off" the video (anywhere that isn't the card itself) closes it
    if(!e.target.closest('.content-film-card')) closeModal();
  });
  closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeModal(); });

  /* ------------------------------------------------------------------
     The cylinder
  ------------------------------------------------------------------ */
  mount.innerHTML = `
    <div class="cf-stage" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Portfolio videos"></div>
    <div class="cf-controls">
      <button type="button" class="cf-arrow cf-prev" aria-label="Previous video">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <p class="cf-caption" aria-live="polite"></p>
      <button type="button" class="cf-arrow cf-next" aria-label="Next video">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
      </button>
    </div>
    <div class="cf-dots" role="tablist" aria-label="Choose a video"></div>
    <p class="cf-hint">Swipe or drag to rotate · tap the front video to play</p>`;

  const stage = mount.querySelector('.cf-stage');
  const captionEl = mount.querySelector('.cf-caption');
  const dotsEl = mount.querySelector('.cf-dots');
  const cards = VIDEOS.map((video) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-card';
    b.innerHTML = `
      <img src="${esc(video.poster)}" alt="" loading="lazy" decoding="async" draggable="false">
      <span class="cf-card-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg></span>`;
    stage.appendChild(b);
    return b;
  });
  const dots = VIDEOS.map((video, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'cf-dot';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', video.title);
    d.addEventListener('click', () => { setActive(i); userActed(); });
    dotsEl.appendChild(d);
    return d;
  });

  let active = 0;
  const prevOffsets = new Array(N).fill(null);
  // shortest signed distance round the cylinder, so index 0 and N-1 sit
  // next to each other
  const half = Math.floor(N / 2);
  const offsetOf = (i) => ((i - active + N + half) % N) - half;

  function render(){
    cards.forEach((card, i) => {
      const o = offsetOf(i);
      const prev = prevOffsets[i];
      // a card wrapping from one far side to the other would otherwise
      // visibly slide across the whole stage — hop it instead
      const hop = prev !== null && Math.abs(o - prev) > 2;
      if(hop){ card.style.transition = 'none'; }
      card.dataset.o = Math.abs(o) > 2 ? 'far' : String(o);
      card.tabIndex = o === 0 ? 0 : -1;
      card.setAttribute('aria-label', (o === 0 ? 'Play video: ' : 'Show video: ') + VIDEOS[i].title);
      card.setAttribute('aria-current', o === 0 ? 'true' : 'false');
      if(hop){ void card.offsetWidth; card.style.transition = ''; }
      prevOffsets[i] = o;
    });
    dots.forEach((d, i) => { d.classList.toggle('is-active', i === active); d.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    captionEl.textContent = VIDEOS[active].title;
  }
  function setActive(i){ active = ((i % N) + N) % N; render(); }
  const go = (dir) => { setActive(active + dir); userActed(); };

  mount.querySelector('.cf-prev').addEventListener('click', () => go(-1));
  mount.querySelector('.cf-next').addEventListener('click', () => go(1));
  stage.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowLeft'){ e.preventDefault(); go(-1); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); go(1); }
  });

  // horizontal trackpad / shift-wheel scrolling rotates it (vertical
  // wheel stays the page's own scroll — never trapped inside the stage)
  let wheelCool = false;
  stage.addEventListener('wheel', (e) => {
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 12){
      e.preventDefault();
      if(wheelCool) return;
      wheelCool = true;
      setTimeout(() => { wheelCool = false; }, 450);
      go(e.deltaX > 0 ? 1 : -1);
    }
  }, { passive: false });

  // swipe / drag. Pointer capture only starts once it's clearly a drag,
  // so a plain tap still lands as a normal click on the card.
  let startX = 0, startY = 0, dragging = false, moved = false, pid = null;
  stage.addEventListener('pointerdown', (e) => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY; dragging = true; moved = false; pid = e.pointerId;
  });
  stage.addEventListener('pointermove', (e) => {
    if(!dragging || e.pointerId !== pid) return;
    const dx = e.clientX - startX;
    if(!moved && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(e.clientY - startY)){
      moved = true;
      try{ stage.setPointerCapture(pid); }catch(_){}
    }
  });
  const endDrag = (e) => {
    if(!dragging || (e && e.pointerId !== pid)) return;
    dragging = false;
    if(moved && e){
      const dx = e.clientX - startX;
      if(Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      // swallow the click the browser fires right after a drag ends
      setTimeout(() => { moved = false; }, 0);
    }
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  cards.forEach((card, i) => {
    card.addEventListener('click', () => {
      if(moved) return;
      if(offsetOf(i) === 0) openModal(VIDEOS[i], card);
      else { setActive(i); userActed(); }
    });
  });

  // wiring for the auto-rotation (see its block above)
  stage.addEventListener('pointerenter', (e) => {
    if(e.pointerType !== 'mouse') return;
    hovering = true;
    stopAuto();
  });
  stage.addEventListener('pointerleave', (e) => {
    if(e.pointerType !== 'mouse') return;
    hovering = false;
    scheduleAuto(RESUME_MS * 0.6);
  });
  // any press on the stage (touch included) holds the turn for a moment
  stage.addEventListener('pointerdown', () => userActed());
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) stopAuto(); else scheduleAuto(AUTO_MS);
  });
  if('IntersectionObserver' in window){
    new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
      if(inView) scheduleAuto(AUTO_MS); else stopAuto();
    }, { threshold: 0.3 }).observe(mount);
  }

  render();
})();
