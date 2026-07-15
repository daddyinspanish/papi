/* ===================================================================
   Papi — hidden diagnostics HUD
   Invisible and a total no-op unless explicitly turned on with
   ?debug=1 in the URL (remembered via localStorage after that, so it
   survives a reload without needing the query param again — turn it
   back off with ?debug=0). Exists because the scroll freeze this
   instruments only ever shows up on a real iPhone under a real touch
   drag, which no desktop sandbox can reproduce — this captures hard
   numbers (how long a frame gap actually was, and what the
   animation's own key values did across it) directly on the device
   where the bug lives, instead of guessing from a simulation.
=================================================================== */
(function(){
  const params = new URLSearchParams(location.search);
  if(params.has('debug')) localStorage.setItem('papiDebug', params.get('debug') === '1' ? '1' : '0');
  const enabled = localStorage.getItem('papiDebug') === '1';
  if(!enabled){
    window.PapiDebug = { log(){} };
    return;
  }

  const box = document.createElement('div');
  box.id = 'papiDebugHud';
  box.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;'
    + 'background:rgba(0,0,0,.82);color:#3f3;font:11px/1.4 monospace;'
    + 'padding:8px 10px;border-radius:6px;max-width:92vw;max-height:42vh;'
    + 'overflow:auto;white-space:pre-wrap;pointer-events:none;';
  box.textContent = 'Papi debug HUD — waiting for frames…';
  function mount(){ if(document.body) document.body.appendChild(box); }
  if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  const GAP_THRESHOLD = 100; // ms — a gap this long reads as a real Safari JS pause, not ordinary frame jitter
  const MAX_EVENTS = 4;
  const sources = {};
  let framesSinceRender = 0;

  function render(){
    let out = 'Papi debug HUD  (add ?debug=0 to hide)\n';
    Object.keys(sources).forEach(name=>{
      const s = sources[name];
      out += `\n[${name}]  frames:${s.frames}  maxGap:${s.maxDt.toFixed(0)}ms  gaps>${GAP_THRESHOLD}ms:${s.events.length}\n`;
      s.events.slice(-3).forEach(e=>{ out += `  gap ${e.dt.toFixed(0)}ms -> ${e.summary}\n`; });
    });
    box.textContent = out;
  }

  window.PapiDebug = {
    // data must include a numeric `ts` (the rAF timestamp); every other
    // key is just recorded for context on any flagged gap
    log(name, data){
      const s = sources[name] || (sources[name] = { lastTs: null, maxDt: 0, frames: 0, events: [] });
      s.frames++;
      const dt = s.lastTs === null ? 0 : data.ts - s.lastTs;
      s.lastTs = data.ts;
      if(dt > s.maxDt) s.maxDt = dt;
      if(dt > GAP_THRESHOLD){
        const summary = Object.keys(data).filter(k => k !== 'ts')
          .map(k => `${k}=${typeof data[k] === 'number' ? data[k].toFixed(3) : data[k]}`).join(' ');
        s.events.push({ dt, summary });
        if(s.events.length > MAX_EVENTS) s.events.shift();
        render();
        return;
      }
      framesSinceRender++;
      if(framesSinceRender >= 30){ framesSinceRender = 0; render(); }
    }
  };
})();
