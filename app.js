import {
  DEFAULTS, clamp, rmsOf, relativeLevelFromRms,
  smoothLevel, nextZone, suggestThresholds
} from './noise-logic.mjs';

const STORAGE_KEY = 'classroom-noise-monitor-settings-v1';
const CALIBRATION_DURATION_MS = 5000;
const TICK_MS = 100;

const elements = {
  startStop: document.getElementById('startStopButton'),
  fullscreen: document.getElementById('fullscreenButton'),
  micStatus: document.getElementById('micStatus'),
  statusCard: document.getElementById('statusCard'),
  statusTitle: document.getElementById('statusTitle'),
  statusMessage: document.getElementById('statusMessage'),
  statusIcon: document.getElementById('statusIcon'),
  needle: document.getElementById('needle'),
  gaugeTrack: document.getElementById('gaugeTrack'),
  greenArc: document.getElementById('greenArc'),
  yellowArc: document.getElementById('yellowArc'),
  redArc: document.getElementById('redArc'),
  ticks: document.getElementById('ticks'),
  yellowSlider: document.getElementById('yellowSlider'),
  redSlider: document.getElementById('redSlider'),
  hysteresisSlider: document.getElementById('hysteresisSlider'),
  yellowValue: document.getElementById('yellowValue'),
  redValue: document.getElementById('redValue'),
  hysteresisValue: document.getElementById('hysteresisValue'),
  calibrate: document.getElementById('calibrateButton'),
  calibrationFeedback: document.getElementById('calibrationFeedback'),
  reset: document.getElementById('resetButton'),
  settings: document.getElementById('settingsPanel')
};

let settings = loadSettings();
let stream = null;
let context = null;
let analyser = null;
let samples = null;
let timer = null;
let starting = false;
let smoothed = 0;
let lastTickTime = 0;
let zone = 'green';
let redEnteredAt = null;
let displayedStatus = '';
let calibration = null;

function loadSettings() {
  const initial = {
    yellow: DEFAULTS.yellow,
    red: DEFAULTS.red,
    hysteresis: DEFAULTS.hysteresis
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return initial;
    const yellow = Number(saved.yellow);
    const red = Number(saved.red);
    const hysteresis = Number(saved.hysteresis);
    if (!Number.isFinite(yellow) || !Number.isFinite(red) || !Number.isFinite(hysteresis)) return initial;
    if (yellow < 10 || yellow > 80 || red < 25 || red > 98 || red - yellow < 12) return initial;
    return { yellow, red, hysteresis: clamp(hysteresis, 0, 10) };
  } catch (_) {
    return initial; // Storage can be blocked by school browser policy.
  }
}

function persistSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) { /* no storage permission */ }
}

function polarPoint(angle, radius) {
  const theta = angle * Math.PI / 180;
  return { x: 400 - radius * Math.cos(theta), y: 365 - radius * Math.sin(theta) };
}

function arcPath(startAngle, endAngle, radius = 278) {
  if (endAngle <= startAngle) return '';
  const a = polarPoint(startAngle, radius);
  const b = polarPoint(endAngle, radius);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return 'M ' + a.x.toFixed(3) + ' ' + a.y.toFixed(3) + ' A ' + radius + ' ' + radius +
    ' 0 ' + largeArc + ' 1 ' + b.x.toFixed(3) + ' ' + b.y.toFixed(3);
}

function drawGauge() {
  const y = settings.yellow * 1.8;
  const r = settings.red * 1.8;
  const gap = 1.0;
  elements.gaugeTrack.setAttribute('d', arcPath(0, 180));
  elements.greenArc.setAttribute('d', arcPath(0, y - gap));
  elements.yellowArc.setAttribute('d', arcPath(y + gap, r - gap));
  elements.redArc.setAttribute('d', arcPath(r + gap, 180));
}

function drawTicks() {
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i <= 12; i++) {
    const angle = i * 15;
    const p1 = polarPoint(angle, i % 3 === 0 ? 232 : 238);
    const p2 = polarPoint(angle, 248);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', p1.x.toFixed(2));
    line.setAttribute('y1', p1.y.toFixed(2));
    line.setAttribute('x2', p2.x.toFixed(2));
    line.setAttribute('y2', p2.y.toFixed(2));
    if (i % 3 === 0) line.classList.add('major');
    elements.ticks.appendChild(line);
  }
}

function syncSettings() {
  elements.yellowSlider.value = String(settings.yellow);
  elements.redSlider.value = String(settings.red);
  elements.hysteresisSlider.value = String(settings.hysteresis);
  elements.yellowValue.value = String(settings.yellow);
  elements.redValue.value = String(settings.red);
  elements.hysteresisValue.value = String(settings.hysteresis);
  drawGauge();
}

function changeThreshold(which, value) {
  const next = clamp(Math.round(Number(value)), 0, 100);
  if (which === 'yellow') {
    settings.yellow = clamp(next, 10, 80);
    settings.red = Math.max(settings.red, settings.yellow + 12);
  } else if (which === 'red') {
    settings.red = clamp(next, 25, 98);
    settings.yellow = Math.min(settings.yellow, settings.red - 12);
  } else {
    settings.hysteresis = clamp(next, 0, 10);
  }
  persistSettings();
  syncSettings();
}

function showStatus(key, title, message, icon) {
  const identity = key + '|' + title + '|' + message;
  if (displayedStatus === identity) return;
  displayedStatus = identity;
  elements.statusCard.className = 'status-card status-card--' + key;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
  elements.statusIcon.textContent = icon;
}

function setMicrophoneUi(enabled) {
  elements.micStatus.className = 'mic-chip ' + (enabled ? 'mic-chip--on' : 'mic-chip--off');
  elements.micStatus.textContent = enabled ? '● המיקרופון פעיל' : '● המיקרופון כבוי';
  elements.startStop.textContent = enabled ? '■ עצירת מדידה' : '▶ התחלת מדידה';
}

function resetDisplay() {
  smoothed = 0;
  zone = 'green';
  redEnteredAt = null;
  elements.needle.style.transform = 'rotate(0deg)';
  showStatus('idle', 'מוכנים להתחיל?', 'לוחצים על ״התחלת מדידה״ כדי להציג את רמת הרעש.', '◉');
}

function friendlyMicrophoneError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'הגישה למיקרופון נחסמה. יש לאשר שימוש במיקרופון בהגדרות האתר או לפנות לאחראי המחשוב.';
    case 'NotFoundError':
      return 'לא נמצא מיקרופון זמין במחשב. בדקו חיבור והגדרות שמע.';
    case 'NotReadableError':
      return 'לא ניתן לפתוח את המיקרופון. ייתכן שהוא בשימוש של תוכנה אחרת.';
    default:
      return 'לא הצלחנו להפעיל את המיקרופון. נסו לרענן את הדף או לבדוק את הרשאות הדפדפן.';
  }
}

async function startMonitoring() {
  if (starting || stream) return Boolean(stream);
  if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
    showStatus('red', 'הדפדפן אינו תומך', 'דרוש דפדפן עדכני עם גישת מיקרופון דרך HTTPS.', '✕');
    return false;
  }
  starting = true;
  elements.startStop.disabled = true;
  elements.calibrate.disabled = true;
  showStatus('idle', 'מבקשים גישה למיקרופון…', 'יש לאשר את הבקשה בחלון הדפדפן.', '◉');
  try {
    // Browsers may ignore these ideals; they should not block microphone access.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false } },
      video: false
    });
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextConstructor();
    const source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // Intentionally NOT connected to speakers.
    samples = new Float32Array(analyser.fftSize);
    await context.resume();
    const activeStream = stream;
    stream.getAudioTracks().forEach(track => {
      track.addEventListener('ended', () => {
        if (stream === activeStream) {
          stopMonitoring();
          showStatus('red', 'המיקרופון נותק', 'בדקו את חיבור המיקרופון והפעילו שוב את המדידה.', '✕');
        }
      });
    });
    lastTickTime = performance.now();
    zone = 'green';
    redEnteredAt = null;
    setMicrophoneUi(true);
    showStatus('green', 'מצוין! ממשיכים כך', 'כולנו עוזרים לשמור על סביבת לימוד נעימה.', '✓');
    timer = window.setInterval(tick, TICK_MS);
    return true;
  } catch (error) {
    stopMonitoring();
    showStatus('red', 'לא הצלחנו להתחיל מדידה', friendlyMicrophoneError(error), '✕');
    return false;
  } finally {
    starting = false;
    elements.startStop.disabled = false;
    elements.calibrate.disabled = false;
  }
}

function stopMonitoring() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (calibration !== null) {
    calibration = null;
    elements.calibrationFeedback.textContent = 'הכיול בוטל.';
  }
  elements.calibrate.disabled = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  if (context) void context.close().catch(() => {});
  context = null;
  analyser = null;
  samples = null;
  setMicrophoneUi(false);
  resetDisplay();
}

function beginCalibration() {
  if (!stream || calibration) return;
  calibration = { startedAt: performance.now(), measurements: [] };
  elements.calibrate.disabled = true;
  elements.calibrationFeedback.textContent = 'מכיילים... המשיכו לדבר בעוצמה רגילה.';
}

function finishCalibration() {
  if (!calibration) return;
  const measured = calibration.measurements;
  calibration = null;
  elements.calibrate.disabled = false;
  try {
    const { yellow, red, baseline } = suggestThresholds(measured);
    settings.yellow = yellow;
    settings.red = red;
    persistSettings();
    syncSettings();
    const caution = baseline > 85 ? ' העוצמה קרובה למקסימום של המיקרופון; נסו להרחיק את המחשב.' : '';
    elements.calibrationFeedback.textContent = 'הכיול הושלם! צהוב: ' + yellow + ', אדום: ' + red + '.' + caution;
  } catch (_) {
    elements.calibrationFeedback.textContent = 'הכיול לא הושלם. נסו שוב למשך 5 שניות.';
  }
}

function tick() {
  if (!analyser || !samples) return;
  analyser.getFloatTimeDomainData(samples);
  const level = relativeLevelFromRms(rmsOf(samples));
  const now = performance.now();
  const elapsedMs = Math.min(Math.max(now - lastTickTime, 0), 1000);
  lastTickTime = now;

  if (calibration) {
    calibration.measurements.push(level);
    const remaining = Math.max(0, Math.ceil((CALIBRATION_DURATION_MS - (now - calibration.startedAt)) / 1000));
    elements.calibrationFeedback.textContent = 'מכיילים... נשארו ' + remaining + ' שניות. המשיכו בעוצמת דיבור תקינה.';
    if (now - calibration.startedAt >= CALIBRATION_DURATION_MS) finishCalibration();
  }

  smoothed = clamp(smoothLevel(smoothed, level, elapsedMs), 0, 100);
  elements.needle.style.transform = 'rotate(' + (smoothed * 1.8).toFixed(2) + 'deg)';
  zone = nextZone(zone, smoothed, settings.yellow, settings.red, settings.hysteresis);

  if (zone === 'red') {
    if (redEnteredAt === null) redEnteredAt = now;
    if (now - redEnteredAt >= DEFAULTS.warningDelayMs) {
      showStatus('red', 'רועש מדי! מנמיכים את הקול', 'בואו נחזור יחד לעוצמת דיבור נעימה.', '!');
    } else {
      showStatus('yellow', 'קצת יותר בשקט', 'הרעש מתחזק. בואו ננסה להנמיך מעט את הקול.', '↘');
    }
  } else {
    redEnteredAt = null;
    if (zone === 'yellow') {
      showStatus('yellow', 'קצת יותר בשקט', 'הרעש מתחזק. בואו ננסה להנמיך מעט את הקול.', '↘');
    } else {
      showStatus('green', 'מצוין! ממשיכים כך', 'כולנו עוזרים לשמור על סביבת לימוד נעימה.', '✓');
    }
  }
}

elements.startStop.addEventListener('click', async () => {
  if (stream) stopMonitoring();
  else await startMonitoring();
});

elements.calibrate.addEventListener('click', async () => {
  if (!stream && !(await startMonitoring())) return;
  beginCalibration();
});

elements.yellowSlider.addEventListener('input', event => changeThreshold('yellow', event.target.value));
elements.redSlider.addEventListener('input', event => changeThreshold('red', event.target.value));
elements.hysteresisSlider.addEventListener('input', event => changeThreshold('hysteresis', event.target.value));

elements.reset.addEventListener('click', () => {
  settings = { yellow: DEFAULTS.yellow, red: DEFAULTS.red, hysteresis: DEFAULTS.hysteresis };
  persistSettings();
  syncSettings();
  elements.calibrationFeedback.textContent = 'ההגדרות אופסו לברירת המחדל.';
});

elements.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      elements.settings.open = false;
      await document.querySelector('.app-shell').requestFullscreen();
    }
  } catch (_) {
    elements.calibrationFeedback.textContent = 'הדפדפן אינו מאפשר מסך מלא במצב זה.';
    elements.settings.open = true;
  }
});

document.addEventListener('fullscreenchange', () => {
  elements.fullscreen.textContent = document.fullscreenElement ? '⛶ יציאה ממסך מלא' : '⛶ מסך מלא';
});

window.addEventListener('pagehide', stopMonitoring);

drawTicks();
syncSettings();
resetDisplay();

// After the first successful online load, the static application can run offline.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // School policies or private browsing may block offline caching.
    });
  });
}
