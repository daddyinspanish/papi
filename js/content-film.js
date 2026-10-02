/* ===================================================================
   Papi — Content & Film (portfolio videos)
   A service section for content strategy + video production. VIDEOS
   below holds Papi's real portfolio clips; if it ever has fewer than 3
   entries, the remaining slots render clearly-labeled "coming soon"
   placeholders instead of real players.

   HOW A VIDEO CARD WORKS
   - Front: poster + play button. Tap to play (one clip at a time; a clip
     pauses when scrolled out of view). Nothing downloads until play
     (preload="none"), so a page view only costs the small posters.
   - When a clip finishes, a "Tap here to learn more" button appears.
     Tapping it flips the card over to its back, which shows the clip's
     `description` — the place to talk about the expertise behind each
     video. "Back to video" flips it back.

   HOW TO ADD / EDIT A VIDEO
   1. Put the compressed file under videos/content/ and a poster image
      under img/content/ (720px-wide H.264 MP4 with faststart + a WebP
      poster keeps it light — see git history for the ffmpeg settings).
   2. Add/edit one entry in VIDEOS below:
        {
          title: 'Caption shown under the video',
          src: 'videos/content/name.mp4?v=1',
          poster: 'img/content/name.webp?v=2',
          ratio: '9 / 16',            // or '1 / 1' for a square clip
          description: 'Text for the back of the card. Separate paragraphs with a blank line (\n\n).',
        }
   3. Replacing a file with the same name? Bump its ?v= number — the
      media is cached for a year (see vercel.json), so a new ?v= is what
      makes browsers fetch the new version.
=================================================================== */
(function(){
  const grid = document.getElementById('contentFilmGrid');
  if(!grid) return;

  // All clips are re-encoded for the web (720px H.264, faststart, ~2-6MB
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
      src: 'videos/content/dent-all-dr-z.mp4?v=1',
      poster: 'img/content/dent-all-dr-z.webp?v=2',
      ratio: '1 / 1',
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

  // placeholder categories — shown only if VIDEOS ever has fewer than 3
  // entries. Not real client work; labeled clearly as such.
  const PLACEHOLDER_SLOTS = [
    { label: 'Patient Testimonials', text: 'Real patients, on camera, explaining why they chose your practice.' },
    { label: 'Treatment Explainers', text: 'Short, clear videos that make procedures feel less intimidating before someone ever calls.' },
    { label: 'Behind the Scenes', text: 'Your team, your office, your equipment — the footage that builds trust before the first visit.' },
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
            <video class="content-film-video" src="${esc(video.src)}" data-poster="${esc(video.poster)}" playsinline preload="none" aria-label="${esc(video.title)}"></video>
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
      // one at a time — also stops a second clip downloading in parallel
      players.forEach((p) => { if(p !== el) p.pause(); });
      card.classList.remove('is-ended');
      el.controls = true;
      card.classList.add('is-playing');
      el.play().catch(showPoster);
    };
    const setFlipped = (flipped) => {
      card.classList.toggle('is-flipped', flipped);
      // only the visible face is reachable by keyboard / screen readers
      front.toggleAttribute('inert', flipped);
      back.toggleAttribute('inert', !flipped);
      back.setAttribute('aria-hidden', flipped ? 'false' : 'true');
      if(flipped) backBtn.focus({ preventScroll: true });
      else (el.currentTime > 0 && card.classList.contains('is-ended') ? moreBtn : playBtn).focus({ preventScroll: true });
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
      // flipping back resets the front to its poster, ready to play again
      el.currentTime = 0;
      showPoster();
      setFlipped(false);
    });

    players.push(el);
    return card;
  }

  function buildPlaceholderCard(slot){
    const card = document.createElement('div');
    card.className = 'content-film-card content-film-card--placeholder';
    card.innerHTML = `
      <div class="content-film-placeholder-frame" aria-hidden="true">
        <span class="content-film-placeholder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor" stroke="none"/></svg>
        </span>
        <span class="content-film-placeholder-tag">Coming soon</span>
      </div>
      <p class="content-film-card-title">${slot.label}</p>
      <p class="content-film-card-text">${slot.text}</p>`;
    return card;
  }

  // every real video gets a card; placeholders only top it up to 3
  const frag = document.createDocumentFragment();
  const total = Math.max(3, VIDEOS.length);
  for(let i = 0; i < total; i++){
    if(VIDEOS[i]) frag.appendChild(buildVideoCard(VIDEOS[i]));
    else frag.appendChild(buildPlaceholderCard(PLACEHOLDER_SLOTS[i % PLACEHOLDER_SLOTS.length]));
  }
  grid.appendChild(frag);

  // pause a clip the moment it's scrolled mostly out of view — same
  // convention as js/live-demo.js's embeds, so nothing keeps
  // playing/streaming behind the visitor's back
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if(!en.isIntersecting && !en.target.paused) en.target.pause(); });
    }, { threshold: 0.2 });
    players.forEach((p) => io.observe(p));
  }

  // Posters are now full-quality (1080px, ~50-165KB each) so they stay
  // sharp on large/retina cards — a video element downloads its poster
  // immediately even with preload="none", so they're only attached once
  // a card is within ~half a screen of the viewport, keeping the rest of
  // the page's initial load unchanged.
  const attachPoster = (v) => { if(v.dataset.poster){ v.poster = v.dataset.poster; delete v.dataset.poster; } };
  if('IntersectionObserver' in window){
    const posterIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if(en.isIntersecting){ attachPoster(en.target); posterIO.unobserve(en.target); } });
    }, { rootMargin: '600px 0px' });
    players.forEach((p) => posterIO.observe(p));
  } else {
    players.forEach(attachPoster);
  }
})();
