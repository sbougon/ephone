'use strict';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const state = {
  photoDataUrl: null,
  contactName: 'Mom',
  delayMs: 30_000,        // 30 second default
};

let armTimer       = null;   // setTimeout for the delay
let callDurTimer   = null;   // setInterval for active-call counter
let callDurSec     = 0;
let lockClockTimer = null;   // setInterval to update lock-screen time
let wakeLock       = null;

// ─────────────────────────────────────────────
//  Audio engine
// ─────────────────────────────────────────────
const Audio = (() => {
  let ctx            = null;
  let silentOsc      = null;
  let ringtoneTimer  = null;
  let ringing        = false;

  function getCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { console.error('[Audio] WebAudio not supported'); return null; }
      ctx = new Ctor();
      console.log('[Audio] AudioContext created — state:', ctx.state, '| sampleRate:', ctx.sampleRate);
    }
    if (ctx.state === 'suspended') {
      console.log('[Audio] Context suspended, calling resume()...');
      ctx.resume()
        .then(() => console.log('[Audio] resume() resolved — state now:', ctx.state))
        .catch(e  => console.error('[Audio] resume() failed:', e));
    }
    return ctx;
  }

  // One marimba-style note (fundamental + 4th harmonic)
  function note(freq, t, vol = 0.38) {
    const c = ctx;
    if (!c) return;
    [[freq, vol], [freq * 4, vol * 0.12]].forEach(([f, v]) => {
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(v, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  // iPhone Marimba melody (E5×3 / B4×3 / A4-C5-E5)
  const NOTES = [
    [659.25, 0.00],  // E5
    [659.25, 0.21],  // E5
    [659.25, 0.42],  // E5
    [493.88, 0.70],  // B4
    [493.88, 0.91],  // B4
    [493.88, 1.12],  // B4
    [440.00, 1.40],  // A4
    [523.25, 1.62],  // C5
    [659.25, 1.88],  // E5
  ];
  const PATTERN_LEN = 3.6;

  async function playPattern() {
    if (!ringing) { console.log('[Audio] playPattern: not ringing, stopping'); return; }

    const c = getCtx();
    if (!c) return;

    // Ensure context is running before scheduling notes
    if (c.state !== 'running') {
      console.log('[Audio] playPattern: ctx state is', c.state, '— awaiting resume...');
      try { await c.resume(); } catch (e) { console.error('[Audio] resume error:', e); }
      console.log('[Audio] playPattern: after resume, state =', c.state);
    }

    const now = c.currentTime;
    console.log('[Audio] playPattern: scheduling', NOTES.length, 'notes at t=', now.toFixed(3), '| ctx state:', c.state);
    // Small lookahead buffer so notes are never scheduled in the past
    NOTES.forEach(([freq, offset]) => note(freq, now + 0.05 + offset));

    ringtoneTimer = setTimeout(playPattern, PATTERN_LEN * 1000);
  }

  // Nearly-silent oscillator keeps AudioContext alive on iOS
  function startSilent() {
    const c = getCtx();
    if (!c) return;
    console.log('[Audio] startSilent: starting silent oscillator, ctx state:', c.state);
    silentOsc = c.createOscillator();
    const g   = c.createGain();
    g.gain.value = 0.00001;   // inaudible
    silentOsc.connect(g);
    g.connect(c.destination);
    silentOsc.start();
    console.log('[Audio] startSilent: oscillator started');
  }

  function stopSilent() {
    if (silentOsc) {
      console.log('[Audio] stopSilent');
      try { silentOsc.stop(); } catch (_) {}
      silentOsc = null;
    }
  }

  return {
    unlock() {
      console.log('[Audio] unlock() — creating/resuming AudioContext from user gesture');
      getCtx();
    },

    startWait() {
      console.log('[Audio] startWait()');
      this.unlock();
      startSilent();
    },

    startRingtone() {
      console.log('[Audio] startRingtone() — ctx state:', ctx ? ctx.state : 'no ctx');
      stopSilent();
      ringing = true;
      playPattern();
    },

    stopRingtone() {
      console.log('[Audio] stopRingtone()');
      ringing = false;
      clearTimeout(ringtoneTimer);
      ringtoneTimer = null;
    },

    stopAll() {
      this.stopRingtone();
      stopSilent();
    },
  };
})();

// ─────────────────────────────────────────────
//  Wake Lock
// ─────────────────────────────────────────────
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) {
    // Wake Lock not supported / denied — app still works, screen may dim
  }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// Re-acquire if document becomes visible again
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !wakeLock) {
    const waiting = document.getElementById('screen-waiting').classList.contains('active');
    if (waiting) await requestWakeLock();
  }
});

// ─────────────────────────────────────────────
//  Screen transitions
// ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─────────────────────────────────────────────
//  Settings persistence
// ─────────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('ec_photo',   state.photoDataUrl || '');
  localStorage.setItem('ec_name',    state.contactName);
  localStorage.setItem('ec_delayMs', String(state.delayMs));
}

function loadSettings() {
  const photo   = localStorage.getItem('ec_photo');
  const name    = localStorage.getItem('ec_name');
  const delayMs = localStorage.getItem('ec_delayMs');

  if (photo)   state.photoDataUrl = photo;
  if (name)    state.contactName  = name;
  if (delayMs) state.delayMs      = parseInt(delayMs, 10);

  applySettingsToSetupUI();
}

function applySettingsToSetupUI() {
  document.getElementById('contact-name').value = state.contactName;
  const totalSec = Math.floor(state.delayMs / 1000);
  document.getElementById('delay-min').value = Math.floor(totalSec / 60);
  document.getElementById('delay-sec').value = totalSec % 60;
  applyPhoto();
}

function applyPhoto() {
  const photos = [
    { img: 'setup-photo-img',  ph: 'setup-photo-placeholder' },
    { img: 'call-photo-img',   ph: 'call-photo-ph'           },
    { img: 'active-photo-img', ph: 'active-photo-ph'         },
  ];

  photos.forEach(({ img, ph }) => {
    const imgEl = document.getElementById(img);
    const phEl  = document.getElementById(ph);
    if (!imgEl || !phEl) return;
    if (state.photoDataUrl) {
      imgEl.src          = state.photoDataUrl;
      imgEl.style.display = 'block';
      phEl.style.display  = 'none';
    } else {
      imgEl.style.display = 'none';
      phEl.style.display  = 'flex';
    }
  });
}

// ─────────────────────────────────────────────
//  URL ↔ delay sync
//  Supports ?t=30  (seconds)
//  so each home-screen tile can have its own delay
// ─────────────────────────────────────────────
function readDelayInputs() {
  const min = parseInt(document.getElementById('delay-min').value, 10) || 0;
  const sec = parseInt(document.getElementById('delay-sec').value, 10) || 0;
  return min * 60 + sec;
}

function syncUrlFromInputs() {
  const totalSec = readDelayInputs();
  const url = new URL(window.location.href);
  url.searchParams.set('t', totalSec);
  history.replaceState(null, '', url.toString());
}

function applyUrlToInputs() {
  const params = new URLSearchParams(window.location.search);
  const t = parseInt(params.get('t'), 10);
  if (!isNaN(t) && t > 0) {
    document.getElementById('delay-min').value = Math.floor(t / 60);
    document.getElementById('delay-sec').value = t % 60;
    state.delayMs = t * 1000;
  }
  // Write the canonical URL (normalises missing ?t param)
  syncUrlFromInputs();
}

// ─────────────────────────────────────────────
//  Lock-screen clock
// ─────────────────────────────────────────────
function updateLockClock() {
  const now  = new Date();
  const hh   = now.getHours();
  const mm   = String(now.getMinutes()).padStart(2, '0');
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mons = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

  document.getElementById('lock-time').textContent =
    `${hh}:${mm}`;
  document.getElementById('lock-date').textContent =
    `${days[now.getDay()]}, ${mons[now.getMonth()]} ${now.getDate()}`;
}

// ─────────────────────────────────────────────
//  ARM flow
// ─────────────────────────────────────────────
function arm() {
  // Read current settings from form
  const nameVal  = document.getElementById('contact-name').value.trim() || 'Mom';
  const minVal   = parseInt(document.getElementById('delay-min').value, 10) || 0;
  const secVal   = parseInt(document.getElementById('delay-sec').value, 10) || 0;
  const delayMs  = (minVal * 60 + secVal) * 1000;

  if (delayMs <= 0) {
    triggerCall();   // fire immediately if delay is 0
    return;
  }

  state.contactName = nameVal;
  state.delayMs     = delayMs;
  saveSettings();

  // Update call screen name
  document.getElementById('call-name').textContent  = nameVal;
  document.getElementById('active-name').textContent = nameVal;

  // Unlock audio context with this user gesture
  Audio.startWait();

  // Show lock screen
  updateLockClock();
  lockClockTimer = setInterval(updateLockClock, 10_000);
  showScreen('screen-waiting');

  // Keep screen on
  requestWakeLock();

  // Schedule the call
  armTimer = setTimeout(triggerCall, delayMs);
}

function cancelArm() {
  clearTimeout(armTimer);
  clearInterval(lockClockTimer);
  armTimer = lockClockTimer = null;
  Audio.stopAll();
  releaseWakeLock();
  showScreen('screen-setup');
}

// ─────────────────────────────────────────────
//  Call flow
// ─────────────────────────────────────────────
function triggerCall() {
  clearInterval(lockClockTimer);
  lockClockTimer = null;
  releaseWakeLock();
  showScreen('screen-call');
  Audio.startRingtone();
}

function answerCall() {
  Audio.stopRingtone();
  callDurSec = 0;
  document.getElementById('active-dur').textContent  = '00:00';
  document.getElementById('active-name').textContent = state.contactName;
  showScreen('screen-active');

  callDurTimer = setInterval(() => {
    callDurSec++;
    const m = String(Math.floor(callDurSec / 60)).padStart(2, '0');
    const s = String(callDurSec % 60).padStart(2, '0');
    document.getElementById('active-dur').textContent = `${m}:${s}`;
  }, 1000);
}

function declineCall() {
  Audio.stopAll();
  showScreen('screen-setup');
}

function endCall() {
  clearInterval(callDurTimer);
  callDurTimer = null;
  Audio.stopAll();
  showScreen('screen-setup');
}

// ─────────────────────────────────────────────
//  Swipe-to-answer gesture
// ─────────────────────────────────────────────
;(() => {
  let touchStartY  = null;
  const THRESHOLD  = 80; // px upward needed

  const callScreen = document.getElementById('screen-call');

  callScreen.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  callScreen.addEventListener('touchend', e => {
    if (touchStartY === null) return;
    const dy = touchStartY - e.changedTouches[0].clientY;
    touchStartY = null;
    if (dy > THRESHOLD) answerCall();
  }, { passive: true });
})();

// ─────────────────────────────────────────────
//  Photo upload
// ─────────────────────────────────────────────
document.getElementById('photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    state.photoDataUrl = ev.target.result;
    applyPhoto();
    saveSettings();
  };
  reader.readAsDataURL(file);
});

// ─────────────────────────────────────────────
//  Button wiring
// ─────────────────────────────────────────────
document.getElementById('arm-btn').addEventListener('click',    arm);
document.getElementById('cancel-btn').addEventListener('click', cancelArm);
document.getElementById('accept-btn').addEventListener('click', answerCall);
document.getElementById('decline-btn').addEventListener('click', declineCall);
document.getElementById('end-btn').addEventListener('click',    endCall);

// Keep ?t= in sync whenever delay inputs change
document.getElementById('delay-min').addEventListener('input', syncUrlFromInputs);
document.getElementById('delay-sec').addEventListener('input', syncUrlFromInputs);

// ─────────────────────────────────────────────
//  Service Worker registration
// ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
loadSettings();
applyUrlToInputs();   // ?t= overrides saved settings for delay
