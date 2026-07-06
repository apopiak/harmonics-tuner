# Huaca Tuner

Standalone browser tools for listening to sustained tones through the microphone and visualizing their pitch content.

The repo currently contains two single-file HTML apps:

- `huaca.html` tracks up to three chamber tones for a huaca or similar polyphonic wind instrument. It folds obvious harmonics back into their likely fundamentals, shows a live spectrum, labels chamber candidates, and keeps a short pitch history.
- `voice.html` analyzes vocal sound as a harmonic stack. It detects the fundamental, maps partials onto the harmonic series, shows inharmonic and subharmonic peaks, tracks whistles as an independent pure-tone source, and classifies the input over a rolling window as whistling, speech, singing, throat singing (overtone or kargyraa style), or a whistle + voice combination.

Both tools run entirely in the browser with the Web Audio API. There is no build step, package install, backend, or data storage.

## Running Locally

Microphone access requires a secure browser context. The easiest local option is to serve the repo over `localhost`:

```sh
python3 -m http.server 8000
```

Then open one of:

- `http://localhost:8000/huaca.html`
- `http://localhost:8000/voice.html`

Press `Start mic`, grant microphone access, and play or sing a steady tone.

## Controls

- `A =` switches the tuning reference between common concert pitch values.
- `sensitivity` changes how far above the measured noise floor a peak must be before it counts.
- `stability` trades responsiveness for steadier note tracking.

Quiet rooms, sustained tones, and a consistent microphone position give the clearest results.

## Notes

The analyzers use browser FFT data and lightweight heuristics. They are useful for exploration and tuning feedback, but the labels are best guesses rather than formal acoustic measurements.

For how the tools work internally — detection pipelines, design trade-offs, and symptom-to-setting tuning guides — see [`DESIGN.md`](DESIGN.md) for `huaca.html` and [`DESIGN-voice.md`](DESIGN-voice.md) for `voice.html`.

`voice.html`'s mode classifier has a microphone-free regression test that synthesizes each vocal mode in headless Chromium: see `test/voice-scenarios.js` (requires a dev-only `npm install playwright-core`; the tools themselves have no dependencies).
