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
//  Audio engine  (MP3 via <audio> element)
//
//  iOS trick: loop a 2s silence file during the wait to keep the
//  audio session alive, then swap src to the ringtone when the
//  call triggers — no fresh user gesture needed.
// ─────────────────────────────────────────────
const Audio = (() => {
  const el = document.getElementById('ringtone');

  function playSrc(src) {
    el.src = src;
    el.load();
    el.play()
      .then(() => console.log('[Audio] playing:', src))
      .catch(e  => console.error('[Audio] play failed:', src, e));
  }

  return {
    // Called on ARM (user gesture) — loops silence to keep session alive
    startWait() {
      console.log('[Audio] startWait — looping silence');
      playSrc('silence.mp3');
    },

    // Called when the fake call triggers — swap to ringtone
    startRingtone() {
      console.log('[Audio] startRingtone — switching to ringtone.mp3');
      playSrc('ringtone.mp3');
    },

    stopRingtone() {
      console.log('[Audio] stopRingtone');
      el.pause();
      el.currentTime = 0;
    },

    stopAll() { this.stopRingtone(); },
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
  try {
    localStorage.setItem('ec_photo',   state.photoDataUrl || '');
    localStorage.setItem('ec_name',    state.contactName);
    localStorage.setItem('ec_delayMs', String(state.delayMs));
  } catch (e) {
    console.error('[saveSettings] localStorage failed:', e);
  }
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

// Shared logic that starts the waiting screen + timer.
// Called both from arm() (user gesture → audio unlocks immediately)
// and from autoArm() (no gesture → audio unlocks on first touch).
function startWaiting(withAudio) {
  document.getElementById('call-name').textContent   = state.contactName;
  document.getElementById('active-name').textContent = state.contactName;

  if (withAudio) {
    try { Audio.startWait(); } catch (e) { console.error('[arm] audio threw:', e); }
  } else {
    // No user gesture yet — unlock audio on the very first touch
    console.log('[autoArm] will unlock audio on first touch');
    document.addEventListener('touchend', function unlock() {
      console.log('[autoArm] first touch — unlocking audio');
      try { Audio.startWait(); } catch (e) { console.error('[autoArm] audio threw:', e); }
      document.removeEventListener('touchend', unlock);
    }, { once: true, passive: true });
  }

  updateLockClock();
  lockClockTimer = setInterval(updateLockClock, 10_000);
  showScreen('screen-waiting');
  requestWakeLock();
  armTimer = setTimeout(triggerCall, state.delayMs);
}

// Called from the ARM button — has a user gesture so audio unlocks now
function arm() {
  const nameVal = document.getElementById('contact-name').value.trim() || 'Mom';
  const minVal  = parseInt(document.getElementById('delay-min').value, 10) || 0;
  const secVal  = parseInt(document.getElementById('delay-sec').value, 10) || 0;
  const delayMs = (minVal * 60 + secVal) * 1000;

  state.contactName = nameVal;
  state.delayMs     = delayMs || 1000;  // minimum 1 s
  saveSettings();
  localStorage.setItem('ec_configured', '1');  // skip setup next open

  if (delayMs <= 0) { triggerCall(); return; }
  startWaiting(true);
}

// Called on load when the app was previously configured —
// goes straight to the waiting screen, no setup shown
function autoArm() {
  console.log('[autoArm] skipping setup, delayMs =', state.delayMs);
  startWaiting(false);
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
//  Photo upload  (compressed to ≤ 300×300 JPEG before storing)
// ─────────────────────────────────────────────
function compressPhoto(dataUrl, callback) {
  const MAX = 300;           // max side length in px — plenty for a 92px circle @3x
  const QUALITY = 0.75;      // JPEG quality

  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.round(img.width  * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    const compressed = canvas.toDataURL('image/jpeg', QUALITY);
    console.log('[photo] original ~', Math.round(dataUrl.length / 1024), 'KB →',
                'compressed ~', Math.round(compressed.length / 1024), 'KB');
    callback(compressed);
  };
  img.src = dataUrl;
}

document.getElementById('photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    compressPhoto(ev.target.result, compressed => {
      state.photoDataUrl = compressed;
      applyPhoto();
      try {
        saveSettings();
      } catch (err) {
        console.error('[photo] localStorage save failed:', err);
      }
    });
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
//  In-app debug console
//  Tap the "Emergency Call" title 5× to open/close
// ─────────────────────────────────────────────
;(() => {
  const MAX = 80;
  const logs = [];

  // Intercept all console methods
  ['log', 'warn', 'error', 'info'].forEach(method => {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      orig(...args);
      const prefix = method === 'error' ? '🔴' : method === 'warn' ? '🟡' : '⚪';
      const line   = prefix + ' ' + args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
      }).join(' ');
      logs.push(line);
      if (logs.length > MAX) logs.shift();
      if (panel && panel.style.display !== 'none') renderLogs();
    };
  });

  // Catch unhandled errors too
  window.addEventListener('error', e => {
    console.error('[uncaught]', e.message, e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[unhandled promise]', String(e.reason));
  });

  // Build the panel DOM
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    display: 'none', position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.92)', color: '#0f0', fontFamily: 'monospace',
    fontSize: '11px', overflowY: 'auto', padding: '48px 10px 80px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  Object.assign(closeBtn.style, {
    display: 'none',  /* hidden until panel opens */
    position: 'fixed', top: '12px', right: '12px', zIndex: '10000',
    background: '#333', color: '#fff', border: 'none', borderRadius: '8px',
    padding: '8px 16px', fontSize: '14px', cursor: 'pointer',
  });
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    closeBtn.style.display = 'none';
    clearBtn.style.display = 'none';
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = '🗑 Clear';
  Object.assign(clearBtn.style, {
    display: 'none',  /* hidden until panel opens */
    position: 'fixed', top: '12px', left: '12px', zIndex: '10000',
    background: '#333', color: '#fff', border: 'none', borderRadius: '8px',
    padding: '8px 16px', fontSize: '14px', cursor: 'pointer',
  });
  clearBtn.addEventListener('click', () => { logs.length = 0; renderLogs(); });

  document.body.appendChild(panel);
  document.body.appendChild(closeBtn);
  document.body.appendChild(clearBtn);

  function renderLogs() {
    panel.textContent = logs.length ? logs.join('\n') : '(no logs yet)';
    panel.scrollTop = panel.scrollHeight;
  }

  // 5× tap on title to toggle
  let tapCount = 0, tapTimer = null;
  const title = document.querySelector('.app-title');
  if (title) {
    title.addEventListener('click', () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 600);
      if (tapCount >= 5) {
        tapCount = 0;
        const opening = panel.style.display === 'none';
        panel.style.display    = opening ? 'block' : 'none';
        closeBtn.style.display = opening ? 'block' : 'none';
        clearBtn.style.display = opening ? 'block' : 'none';
        if (opening) renderLogs();
      }
    });
  }
})();

// ─────────────────────────────────────────────
//  Service Worker registration
// ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.error('[SW]', e));
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
loadSettings();
applyUrlToInputs();   // ?t= overrides saved settings for delay
console.log('[init] app ready, delayMs =', state.delayMs,
            '| configured =', !!localStorage.getItem('ec_configured'),
            '| standalone =', window.navigator.standalone);

if (localStorage.getItem('ec_configured')) {
  autoArm();  // skip setup, go straight to waiting screen
}
