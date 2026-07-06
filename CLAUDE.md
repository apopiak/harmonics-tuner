# CLAUDE.md

Two standalone, single-file browser tools using the Web Audio API. **No build
step, no dependencies, no backend, no data storage** — edit the HTML directly.

- `huaca.html` — 3-chamber polyphonic pitch tracker (default A = 432). Internals
  and rationale in [`DESIGN.md`](DESIGN.md).
- `voice.html` — voice harmonics analyzer + mode classifier (whistling / speech /
  singing / throat singing, incl. whistle+voice combos). Internals and rationale
  in [`DESIGN-voice.md`](DESIGN-voice.md).

## Testing changes

- The microphone needs a **secure context**. `file://` will **not** expose the
  mic in Chrome. Serve over localhost:
  `python3 -m http.server 8000`, then open `http://localhost:8000/huaca.html`.
- There may be no JS runtime on PATH to parse-check; verify in the browser or the
  preview panel.
- `voice.html`'s classifier has a mic-free regression test:
  `npm install playwright-core && node test/voice-scenarios.js` (synthesizes
  eight scenarios in headless Chromium via a `getUserMedia` stub; set
  `CHROMIUM_PATH` if no system Chrome). Run it after touching detection or
  classification logic.

## Gotchas

- **FFT resolution = 1 / window-length**, capped by `AnalyserNode`'s max
  `fftSize` (32768 → ~1.5 Hz at 48 kHz). Restricting the analyzed frequency band
  does **not** improve resolution; the only lever is a lower-rate `AudioContext`,
  which trades away time responsiveness. Peaks already get sub-bin precision via
  parabolic interpolation. (Full reasoning in `DESIGN.md`.)
- **The flip side: each 32768-sample frame observes ~0.7 s of the past.** Fast
  temporal structure (syllable gaps, vibrato, glide onsets) is smeared away in
  the big FFT; anything time-sensitive must come from the second small analyser
  or the pitch-track history, never from big-FFT frame-to-frame differences.
- **Never sum raw dB magnitudes as additive evidence** — they're negative, so
  "more support" lowers the score. Score in dB above the floor
  (`mag - ABS_FLOOR_DB`). This exact bug once made `findFundamental` prefer
  candidates with the *fewest* harmonics.
- Smoothed pitch tracks lag glides by tens of cents; comparisons against
  "current harmonics of f0" must use the raw per-frame f0.
- Tunable constants live at the top of the `<script>` block in each file.
