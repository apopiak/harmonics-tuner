# Design Notes — `huaca.html`

Rationale and internals for the 3-chamber polyphonic tracker. This is the "why"
behind the code; per-constant "what" lives in comments at the top of the
`<script>` block. Scope is `huaca.html` only — `voice.html` is a separate tool.

## Problem

A huaca is a three-chambered vessel flute: one breath sounds up to three tones
at once (occasionally collapsing to two when two same-size chambers play in
unison). Standard tuners are monophonic and fail on this. The goal here is
**exploration/understanding** of the tones the instrument actually produces,
with enough stability to glance at while playing. The instrument is tuned to
**A = 432 Hz** (togglable to 440).

## Why FFT peak-picking, not autocorrelation

Monophonic pitch detectors (autocorrelation, YIN) collapse on polyphony. Vessel
flutes are Helmholtz resonators, so their tones are **near-sinusoidal with weak
overtones** — which makes simultaneous tones separate cleanly as distinct
spectral peaks. Peak-picking on the FFT is therefore both simpler and more
robust here than any monophonic method.

## Signal chain

- `getUserMedia` with echo-cancellation / noise-suppression / auto-gain **off**
  (they would distort the spectrum).
- `AnalyserNode`, `fftSize = 32768` (the max), `smoothingTimeConstant = 0.5`.
- `binWidth = sampleRate / fftSize` ≈ 1.46 Hz at 48 kHz.
- **Parabolic interpolation** on each peak recovers sub-bin position → a few
  cents of accuracy despite the coarse-looking bins.

## Frequency resolution — the hard constraint

Resolution = **1 / T**, where T is the observation window length in seconds. It
depends only on *how long you listen*, never on the frequency span. Two
consequences that shaped the design:

- Restricting analysis to 0–1 kHz buys **no** resolution. (An idea we explicitly
  evaluated and rejected.)
- `AnalyserNode` caps `fftSize` at 32768, so T ≤ 0.68 s at 48 kHz → ~1.46 Hz
  bins. The only way to finer bins is a **lower-sample-rate `AudioContext`**
  (longer T at the cap), but that lengthens the window proportionally and makes
  the display sluggish and smeared during pitch changes. Rejected: it fights the
  live responsiveness, and parabolic interpolation already gives the precision.

## Detection pipeline (per animation frame)

1. **Adaptive threshold.** Noise floor = median dB across the 55–1000 Hz band; a
   peak must rise `sensitivity` dB above it. A *fixed* dB gate is wrong — a clear
   tone spread across a 32768-point FFT peaks around −60…−80 dB per bin, so an
   earlier hard-coded −75 dB gate silently hid real notes.
2. **Input gating.** An absolute floor (`ABS_FLOOR_DB`) plus a **tonality gate**
   (spectral flatness `< TONAL_MAX_FLATNESS`). The flatness gate is what actually
   rejects keyboard taps and other broadband transients — it discriminates by
   *character*, not loudness, so quiet tones still pass.
3. **Clear-peak filter.** Keep peaks within `PEAK_DROP_DB` of the loudest, dedup
   within `DEDUP_CENTS`, cap at `SPEC_MAX_LABELS`. The **same** filtered set
   drives both the spectrum labels and chamber detection, so the two never
   disagree about what's real.
4. **Harmonic folding → fundamentals.** Walking peaks strongest-first, a peak
   within `HARMONIC_CENTS` of an integer multiple (2–6×) of an already-accepted
   stronger fundamental is filed as that fundamental's *overtone*, not a new
   chamber. Worked example: D5 = 2.00× D4 → folded into D4; A4 = 1.5× D4 (not an
   integer ratio) → kept as a separate chamber. Capped at 3.
5. **Unison.** Two same-size chambers in unison produce **one** peak and are
   spectrally inseparable. The tool never fabricates a third voice from a
   harmonic; instead the trailing chamber slot(s) render as "unison".
6. **Stabilization.** Frame-to-frame voice continuity matched within
   `MATCH_CENTS`; per-voice median smoothing (`SMOOTH_N`); attack/release
   hysteresis (`ATTACK` / `RELEASE`, both driven by the `stability` slider) so
   momentary peaks don't flicker voices in and out.

## Visualizations

- **Live spectrum** — 0–1000 Hz, with a dB axis. Labels only the clear peaks. A
  dashed amber **"detect cutoff"** line sits at the live threshold; a peak that
  rises but stays under it is being rejected — the direct diagnostic for "why
  didn't my quiet note register?" (answer: lower `sensitivity`).
- **Overblow field** — the strongest peak above 1 kHz, shown as a separate
  readout so it doesn't stretch the spectrum's x-axis.
- **History strip-chart** — last `HIST_MS` (12 s), log-pitch y-axis. Solid trails
  = chambers; faint red dots = rejected harmonics (visibly pinned at exactly
  2×/3× a chamber, which is the clearest "harmonic vs. separate chamber" tell).
  Trails **persist through silence** as gaps and only scroll off after the
  window, rather than being wiped when tones stop.
- **Background & noise** — spectral flatness + input level, shown even during
  noise (only the pitch analysis is gated off), so the meter still reports.

## Tuning guide (symptom → knob)

All constants are at the top of the `<script>` block.

| Symptom | Adjust |
| --- | --- |
| Quiet note not registering | Watch the dashed cutoff line; lower `sensitivity` until the peak crosses it |
| A real octave-up chamber swallowed as an overtone | Lower `HARMONIC_CENTS` (35 → ~15) |
| A quieter chamber dropped entirely | Raise `PEAK_DROP_DB` |
| Voices flicker / feel sluggish | `stability` slider (drives `ATTACK` / `RELEASE`) |
| Keyboard/noise triggers false analysis | Lower `TONAL_MAX_FLATNESS` (~0.35); if breathy tones get rejected, raise (~0.55) |
| Want longer/shorter history | `HIST_MS` |
| Quiet content clipped low on the spectrum | Raise the visible floor `DB_MIN` (e.g. −100 → −90) |

## Testing

- Microphone needs a **secure context** — serve over `localhost`
  (`python3 -m http.server 8000`); a bare `file://` open won't expose the mic in
  Chrome.
- No build step, no dependencies, no backend. Edit the HTML directly.
