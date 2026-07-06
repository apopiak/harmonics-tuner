# CLAUDE.md

Two standalone, single-file browser tools using the Web Audio API. **No build
step, no dependencies, no backend, no data storage** — edit the HTML directly.

- `huaca.html` — 3-chamber polyphonic pitch tracker (default A = 432). Internals
  and rationale in [`DESIGN.md`](DESIGN.md).
- `voice.html` — voice harmonics analyzer.

## Testing changes

- The microphone needs a **secure context**. `file://` will **not** expose the
  mic in Chrome. Serve over localhost:
  `python3 -m http.server 8000`, then open `http://localhost:8000/huaca.html`.
- There may be no JS runtime on PATH to parse-check; verify in the browser or the
  preview panel.

## Gotchas

- **FFT resolution = 1 / window-length**, capped by `AnalyserNode`'s max
  `fftSize` (32768 → ~1.5 Hz at 48 kHz). Restricting the analyzed frequency band
  does **not** improve resolution; the only lever is a lower-rate `AudioContext`,
  which trades away time responsiveness. Peaks already get sub-bin precision via
  parabolic interpolation. (Full reasoning in `DESIGN.md`.)
- Tunable constants live at the top of the `<script>` block in each file.
