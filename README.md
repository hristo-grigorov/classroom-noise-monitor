# Classroom Noise Monitor / מד הרעש הכיתתי

A free, lightweight, privacy-friendly classroom noise monitor for children aged approximately 10–13. Display a colorful semicircular speedometer on a classroom projector, powered by the **computer's microphone**. The app is in Hebrew, works without installation or accounts, and does not store or upload audio.

## Features

- **Smooth needle:** relative microphone volume (RMS of audio waveform, converted from digital dBFS to a 0–100 *relative* signal level) updated about 10 times per second, with exponential smoothing (~650 ms time constant).
- **Three configurable zones:** green, yellow and red. Arc lengths track the actual yellow/red thresholds.
- **Hysteresis:** transitions **up** at the configured yellow/red thresholds but only **down** below the corresponding threshold minus a stability margin (default 4 points; adjustable 0–10) to avoid flickering near a boundary.
- **Delayed warning:** red warning banner appears only after 2 continuous seconds of red-state noise; the needle still moves in real time.
- **Automatic calibration:** listen for 5 seconds while the class makes **acceptable working noise**, estimate the 75th-percentile level, and suggest thresholds above it. Manual corrections remain available.
- **Start/Stop** with actual microphone track cleanup, fullscreen mode, persistent local settings, responsive design and Hebrew text.
- **Offline after initial load:** a service worker caches static files locally; no runtime API requests, backend, external scripts or fonts.

## Live website

After enabling GitHub Pages for this repository:

**https://hristo-grigorov.github.io/classroom-noise-monitor/**

To enable it: GitHub repository → **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)** → Save. Wait for GitHub to display the deployed Pages URL. The app must be served over HTTPS (or `localhost`) for microphone access and offline caching.

## For teachers

1. Open the site in Chrome, Edge or another recent browser on the classroom computer; project it on the board.
2. Click **התחלת מדידה**, then grant microphone permission. Some school-managed computers block permissions; IT may need to allow microphone access.
3. Open **הגדרות המורה וכיול אוטומטי**. Ask children to work at a **normal, acceptable talking volume** (not silent) and press **כיול אוטומטי**. Continue the activity for 5 seconds.
4. Adjust yellow/red thresholds manually as needed. The *hysteresis/stability gap* slider can be increased if the status flickers near boundaries.
5. Close settings, optionally switch to fullscreen, and use the gentle feedback during appropriate activities. Stop measurement during teacher explanations if desired.

**Tip:** Calibration is a starting estimate, not a perfect objective setting. Recalibrate if the device, microphone position, classroom, or activity changes. In a classroom test, verify that the indicator does not become a game where students intentionally drive the needle into red.

## Privacy & limitations

- Audio stays inside the browser's Web Audio API. It is analyzed in volatile memory for **relative sound intensity only**, with **no recording, storage, speech recognition, transcription or audio upload**.
- No analytics, cookies, trackers or remote dependencies. Only thresholds/stability preferences are stored in `localStorage`. GitHub Pages necessarily serves the initial static files, and the browser might check for updates online.
- This **does not report acoustic sound pressure (dB SPL)**. Microphones, built-in gain control, room acoustics, microphone placement, and school IT restrictions affect readings. Optional audio constraints request disabled AGC, noise suppression and echo cancellation, but browser/device settings might ignore them.
- The teacher's voice and other room sounds also contribute. The meter cannot attribute noise to students or distinguish a loud but appropriate group activity.
- Offline use requires **one successful online visit** with service-worker caching supported and enabled. Test by loading the site online, refreshing once, then disconnecting the network and reloading. Browser policies may block offline cache. Browser microphone permission might need to be granted again even offline.
- Explain microphone use to students and follow school policy. No punitive scoring or audible alarms are built in.

## Tech

Pure HTML, CSS, JavaScript, SVG, native Web Audio API, localStorage and a service worker. No frameworks, dependencies, backend, build step or cloud processing.

### Run locally

A server is required for ES modules and service workers (do not double-click `index.html`):

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

### Automated tests

Using Node.js (built-in test runner, no dependencies):

```bash
node --test tests/*.test.mjs
```

### Deploy updates

Commit the static files to `main`. **When updating app assets, bump `CACHE_NAME` in `sw.js`** to a new version (for example `-v2`) so existing offline clients receive the latest assets. The service worker uses cache-first responses intentionally.

## Project goals

The primary goal is to help students notice classroom sound levels and self-regulate, without unnecessary interruptions or a distracting game-like interface. Evaluate effectiveness with teacher observations before adding badges, statistics or extra features.

## License

MIT. See [LICENSE](./LICENSE).