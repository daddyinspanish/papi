/* ===================================================================
   Papi — full-site loader / sound-consent gate
   Per direct request: a loader reading "Papi" / "Premium Websites"
   with an explicit "Enter" (with sound) vs "Enter without sound"
   choice, shown on every load. #hero itself keeps revealing on its
   own original schedule (js/init.js — fonts-ready or 900ms, with
   index.html's own 4s fallback as a last resort) completely
   independent of this gate; that reveal always finishes well before a
   visitor reads two lines of text and clicks a button, so dismissing
   this overlay never has to wait on anything else.

   Ordering note vs js/sound.js's own returning-visitor auto-resume:
   sound.js attaches a one-time `pointerdown`/`keydown` listener on
   `document` that silently re-enables sound for a visitor who had it
   on last visit, the moment they interact anywhere on the page. That
   listener can fire from the SAME click as one of these two buttons
   (pointerdown always fires before click). It's harmless either way —
   whichever of enable()/disable() runs in this file's own click
   handler below always runs last (click fires after pointerdown) and
   is what actually decides the outcome.
=================================================================== */
(function(){
  const loader = document.getElementById('papiLoader');
  if(!loader) return;

  document.documentElement.classList.add('scroll-lock');

  function buildDigits(containerId){
    const el = document.getElementById(containerId);
    const track = el && el.querySelector('.process-stage-digits-track');
    if(!track) return;
    let text = '';
    for(let i = 0; i < 18; i++) text += (1000 + Math.floor(Math.random() * 9000)) + ' ';
    track.textContent = text + ' ' + text;
  }
  buildDigits('papiLoaderDigitsA');
  buildDigits('papiLoaderDigitsB');

  function dismiss(){
    loader.classList.add('is-dismissed');
    document.documentElement.classList.remove('scroll-lock');
    setTimeout(() => {
      loader.setAttribute('aria-hidden', 'true');
      loader.style.display = 'none';
    }, 750);
  }

  const enterBtn = document.getElementById('papiLoaderEnter');
  const silentBtn = document.getElementById('papiLoaderEnterSilent');

  if(enterBtn) enterBtn.addEventListener('click', () => {
    if(window.Papi && window.Papi.sound) window.Papi.sound.enable();
    dismiss();
  });
  if(silentBtn) silentBtn.addEventListener('click', () => {
    if(window.Papi && window.Papi.sound) window.Papi.sound.disable();
    dismiss();
  });
})();
