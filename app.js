'use strict';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const state = {
  photoDataUrl: null,
  contactName: 'Mom',
  delayMs: 60_000,        // 1 minute default
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
  let silentOsc      = null;   // keeps audio context alive during wait
  let ringtoneTimer  = null;
  let ringing        = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Play one marimba-style note
  // iPhone "Marimba/Opening" ringtone approximation
  function note(freq, t, vol = 0.38) {
    const c = getCtx();

    // Fundamental (sine) + 4th harmonic (marimba character)
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

  // iPhone Marimba melody (E5-E5-E5 / B4-B4-B4 / A4-C5-E5)
  const NOTES = [
    [659.25, 0.00],  // E5
    [659.25, 0.21],  // E5
    [659.25, 0.42],  // E5
    [493.88, 0.70],  // B4
    [493.88, 0.91],  // B4
    [493.88, 1.12],  // B4
    [440.00, 1.40],  // A4
    [523.25, 1.62],  // C5
    [659.25, 1.88],  // E5  (held)
  ];
  const PATTERN_LEN = 3.6; // seconds per loop

  function playPattern() {
    if (!ringing) return;
    const now = getCtx().currentTime;
    NOTES.forEach(([freq, offset]) => note(freq, now + offset));
    ringtoneTimer = setTimeout(playPattern, PATTERN_LEN * 1000);
  }

  // Nearly-silent oscillator keeps audio context alive on iOS
  // so the ringtone can fire without a fresh user gesture
  function startSilent() {
    const c   = getCtx();
    silentOsc = c.createOscillator();
    const g   = c.createGain();
    g.gain.value = 0.00001;
    silentOsc.connect(g);
    g.connect(c.destination);
    silentOsc.start();
  }

  function stopSilent() {
    if (silentOsc) { try { silentOsc.stop(); } catch (_) {} silentOsc = null; }
  }

  return {
    // Call once from the first user gesture (ARM tap)
    unlock() { getCtx(); },

    startWait() {
      this.unlock();
      startSilent();
    },

    startRingtone() {
      stopSilent();
      ringing = true;
      playPattern();
    },

    stopRingtone() {
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
  const setupImg = document.getElementById('setup-photo-img');
  const setupPh  = document.getElementById('setup-photo-placeholder');
  const callImg  = document.getElementById('call-photo-img');
  const callPh   = document.getElementById('call-photo-ph');
  const callBg   = document.getElementById('call-bg');

  if (state.photoDataUrl) {
    setupImg.src = state.photoDataUrl;
    setupImg.style.display = 'block';
    setupPh.style.display  = 'none';

    callImg.src = state.photoDataUrl;
    callImg.style.display = 'block';
    callPh.style.display  = 'none';

    callBg.style.backgroundImage = `url(${state.photoDataUrl})`;
  } else {
    setupImg.style.display = 'none';
    setupPh.style.display  = 'flex';
    callImg.style.display  = 'none';
    callPh.style.display   = 'flex';
    callBg.style.backgroundImage = 'none';
  }
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
  document.getElementById('active-dur').textContent = '0:00';
  showScreen('screen-active');

  callDurTimer = setInterval(() => {
    callDurSec++;
    const m = Math.floor(callDurSec / 60);
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
