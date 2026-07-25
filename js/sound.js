/* ===================================================================
   Papi — Sound
   Per direct request, citing unseen.co: make the site feel alive with
   sound. Live-checked unseen.co this session — it gates entry behind
   an explicit audio choice, then drops to a small persistent toggle.
   Papi's hero already has a proven wordless opening (matrix rain ->
   glitch-dissolve -> portal), so this deliberately skips the gate:
   sound defaults OFF, with a small persistent toggle instead (see
   #soundToggle in index.html/css). Starting audio only on that
   button's own click also satisfies browser autoplay-blocking with no
   extra gate needed — AudioContext is never constructed until then.

   Every other signature effect on this site (matrix rain, glitch-
   dissolve, liquid shaders) is generated in code, not asset-based;
   sound follows the same convention — synthesized live via Web Audio
   (oscillators + noise + envelopes), not licensed/sourced audio files.

   Public API mirrors js/init.js's existing window.Papi.revealCursor/
   revealSocial convention, so any other script can fire a sound with
   zero knowledge of Web Audio: window.Papi.sound && window.Papi.sound.play('tick').
=================================================================== */
(function(){
  const STORAGE_KEY = 'papiSoundEnabled';
  let ctx = null;
  let master = null;
  let ambientNodes = null;
  let enabled = false;

  function ensureContext(){
    if(ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  // ---- ambient bed: 3 detuned oscillators through a lowpass filter,
  // slow LFO on cutoff + a slow amplitude swell — an evolving, breathing
  // pad rather than a static drone or anything melodic ----
  function startAmbient(){
    if(!ctx || ambientNodes) return;
    const now = ctx.currentTime;
    const bed = ctx.createGain();
    bed.gain.value = 0.05; // felt more than heard
    bed.connect(master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    filter.connect(bed);

    const baseFreqs = [96, 144.5, 192.3]; // a spread of low, slightly detuned partials
    const oscs = baseFreqs.map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 1 / baseFreqs.length;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(now);
      return osc;
    });

    // slow LFO modulating filter cutoff — the "breathing" quality
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06; // ~16s cycle
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);

    ambientNodes = { bed, filter, oscs, lfo };
  }

  function stopAmbient(){
    if(!ambientNodes) return;
    const now = ctx.currentTime;
    ambientNodes.bed.gain.cancelScheduledValues(now);
    ambientNodes.bed.gain.linearRampToValueAtTime(0, now + 0.6);
    const nodes = ambientNodes;
    setTimeout(() => {
      nodes.oscs.forEach((o) => { try{ o.stop(); }catch(e){} });
      try{ nodes.lfo.stop(); }catch(e){}
    }, 700);
    ambientNodes = null;
  }

  // ---- discrete one-shots: short synthesized events, no continuous
  // scroll-tied sound (restraint — same principle the rest of this
  // pass has followed throughout) ----
  function playTick(){
    if(!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playWhoosh(){
    if(!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.8;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.7);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.1, now + 0.25);
    g.gain.linearRampToValueAtTime(0, now + 0.75);

    noise.connect(filter);
    filter.connect(g);
    g.connect(master);
    noise.start(now);
    noise.stop(now + 0.8);
  }

  function playChime(){
    if(!ctx) return;
    const now = ctx.currentTime;
    // short ascending three-note confirm — the one genuine "reward" sound on the site
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const start = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.12, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  const EVENTS = { tick: playTick, whoosh: playWhoosh, chime: playChime };

  function enable(){
    const c = ensureContext();
    if(!c) return;
    if(c.state === 'suspended') c.resume();
    enabled = true;
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.linearRampToValueAtTime(1, c.currentTime + 0.4);
    startAmbient();
    try{ localStorage.setItem(STORAGE_KEY, '1'); }catch(e){}
    document.dispatchEvent(new CustomEvent('papi:sound-change', { detail: { enabled: true } }));
  }

  function disable(){
    enabled = false;
    if(ctx && master){
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    }
    stopAmbient();
    try{ localStorage.setItem(STORAGE_KEY, '0'); }catch(e){}
    document.dispatchEvent(new CustomEvent('papi:sound-change', { detail: { enabled: false } }));
  }

  window.Papi = window.Papi || {};
  window.Papi.sound = {
    enable,
    disable,
    toggle(){ enabled ? disable() : enable(); },
    isEnabled(){ return enabled; },
    play(name){
      if(!enabled || !ctx) return;
      const fn = EVENTS[name];
      if(fn) fn();
    },
  };

  // ---- toggle button: owns its own visual state (.is-on class) and is
  // the one real user gesture that's allowed to start the AudioContext
  // in the first place, per browser autoplay policy ----
  function wireToggle(){
    const btn = document.getElementById('soundToggle');
    if(!btn) return;

    let wasEnabled = false;
    try{ wasEnabled = localStorage.getItem(STORAGE_KEY) === '1'; }catch(e){}

    function reflect(isOn){
      btn.classList.toggle('is-on', isOn);
      btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      btn.setAttribute('aria-label', isOn ? 'Turn sound off' : 'Turn sound on');
    }

    btn.addEventListener('click', () => {
      window.Papi.sound.toggle();
      reflect(window.Papi.sound.isEnabled());
    });

    // a returning visitor who had it on last time sees the toggle
    // already showing "on" (their actual preference), but the
    // AudioContext itself still can't start until a real gesture
    // happens anywhere on the page — the very first click/touch/key
    // resumes it silently so they don't have to find and re-click the
    // toggle specifically to get back what they already chose
    if(wasEnabled){
      reflect(true);
      const resumeOnce = () => {
        if(!window.Papi.sound.isEnabled()) window.Papi.sound.enable();
        document.removeEventListener('pointerdown', resumeOnce);
        document.removeEventListener('keydown', resumeOnce);
      };
      document.addEventListener('pointerdown', resumeOnce, { once:true });
      document.addEventListener('keydown', resumeOnce, { once:true });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireToggle);
  } else {
    wireToggle();
  }
})();
