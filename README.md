# Huaca Tuner

Standalone browser tools for listening to sustained tones through the microphone and visualizing their pitch content.

The repo currently contains two single-file HTML apps:

- `huaca-tuner.html` tracks up to three chamber tones for a huaca or similar polyphonic wind instrument. It folds obvious harmonics back into their likely fundamentals, shows a live spectrum, labels chamber candidates, and keeps a short pitch history.
- `voice-harmonics-tuner.html` analyzes a sung or spoken tone as a harmonic stack. It detects the fundamental, maps partials onto the harmonic series, shows inharmonic and subharmonic peaks, and gives rough vocal-colour heuristics.

Both tools run entirely in the browser with the Web Audio API. There is no build step, package install, backend, or data storage.

## Running Locally

Microphone access requires a secure browser context. The easiest local option is to serve the repo over `localhost`:

```sh
python3 -m http.server 8000
```

Then open one of:

- `http://localhost:8000/huaca-tuner.html`
- `http://localhost:8000/voice-harmonics-tuner.html`

Press `Start mic`, grant microphone access, and play or sing a steady tone.

## Controls

- `A =` switches the tuning reference between common concert pitch values.
- `sensitivity` changes how far above the measured noise floor a peak must be before it counts.
- `stability` trades responsiveness for steadier note tracking.

Quiet rooms, sustained tones, and a consistent microphone position give the clearest results.

## Notes

The analyzers use browser FFT data and lightweight heuristics. They are useful for exploration and tuning feedback, but the labels are best guesses rather than formal acoustic measurements.
