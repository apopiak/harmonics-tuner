# Design Notes

Rationale and internals for both tools. This is the "why" behind the code;
per-constant "what" lives in comments at the top of each file's `<script>`
block.

- [Shared foundation](#shared-foundation) — signal chain and the FFT
  constraints both tools live under.
- [`huaca.html`](#huacahtml--3-chamber-polyphonic-tracker) — the polyphonic
  chamber tracker.
- [`voice.html`](#voicehtml--harmonics-analyzer--mode-classifier) — the voice
  analyzer and its whistling / speech / singing / throat-singing classifier.

## Shared foundation

### Signal chain

- `getUserMedia` with echo-cancellation / noise-suppression / auto-gain **off**
  (they would distort the spectrum).
- `AnalyserNode`, `fftSize = 32768` (the max), light smoothing.
- `binWidth = sampleRate / fftSize` ≈ 1.46 Hz at 48 kHz.
- **Parabolic interpolation** on each peak recovers sub-bin position → a few
  cents of accuracy despite the coarse-looking bins.

### Frequency resolution — the hard constraint

Resolution = **1 / T**, where T is the observation window length in seconds. It
depends only on *how long you listen*, never on the frequency span. Two
consequences that shaped both tools:

- Restricting analysis to a narrow band buys **no** resolution. (An idea we
  explicitly evaluated and rejected.)
- `AnalyserNode` caps `fftSize` at 32768, so T ≤ 0.68 s at 48 kHz → ~1.46 Hz
  bins. The only way to finer bins is a **lower-sample-rate `AudioContext`**
  (longer T at the cap), but that lengthens the window proportionally and makes
  the display sluggish and smeared during pitch changes. Rejected: it fights
  live responsiveness, and parabolic interpolation already gives the precision.

### The flip side: the 0.7 s window smear

Fine frequency resolution is bought with coarse *time* resolution — each
32768-sample frame observes ~0.68 s of the past. Consequences (these bit
repeatedly while building the voice classifier):

- **Syllabic gaps are spectrally invisible.** A 180 ms silence inside a 680 ms
  window barely dents the spectrum, so voiced/unvoiced transitions — the main
  speech cue — cannot be read from the big FFT.
- **Vibrato is attenuated below detectability.** A 5–6 Hz, ±40¢ oscillation
  completes ~4 cycles inside the window; the measured peak sits near the mean,
  so the extracted pitch track shows only a fraction of the true extent.
- **Measured pitch lags glides.**

Anything time-sensitive must come from a second small analyser or from
pitch-track history — never from big-FFT frame-to-frame differences.

## `huaca.html` — 3-chamber polyphonic tracker

### Problem

A huaca is a three-chambered vessel flute: one breath sounds up to three tones
at once (occasionally collapsing to two when two same-size chambers play in
unison). Standard tuners are monophonic and fail on this. The goal here is
**exploration/understanding** of the tones the instrument actually produces,
with enough stability to glance at while playing. The instrument is tuned to
**A = 432 Hz** (togglable to 440).

### Why FFT peak-picking, not autocorrelation

Monophonic pitch detectors (autocorrelation, YIN) collapse on polyphony. Vessel
flutes are Helmholtz resonators, so their tones are **near-sinusoidal with weak
overtones** — which makes simultaneous tones separate cleanly as distinct
spectral peaks. Peak-picking on the FFT is therefore both simpler and more
robust here than any monophonic method.

### Detection pipeline (per animation frame)

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

### Visualizations

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

### Tuning guide (symptom → knob)

| Symptom | Adjust |
| --- | --- |
| Quiet note not registering | Watch the dashed cutoff line; lower `sensitivity` until the peak crosses it |
| A real octave-up chamber swallowed as an overtone | Lower `HARMONIC_CENTS` (35 → ~15) |
| A quieter chamber dropped entirely | Raise `PEAK_DROP_DB` |
| Voices flicker / feel sluggish | `stability` slider (drives `ATTACK` / `RELEASE`) |
| Keyboard/noise triggers false analysis | Lower `TONAL_MAX_FLATNESS` (~0.35); if breathy tones get rejected, raise (~0.55) |
| Want longer/shorter history | `HIST_MS` |
| Quiet content clipped low on the spectrum | Raise the visible floor `DB_MIN` (e.g. −100 → −90) |

## `voice.html` — harmonics analyzer & mode classifier

### Problem

Analyze one person's vocal sound as a harmonic stack, and classify *what they
are doing*: whistling, speech, singing, throat singing — **including
combinations of whistling with the others**, since whistling while singing is
physically possible and produces two independent pitch sources at once.

That last requirement shapes the whole architecture: whistle detection cannot
be an `else` branch of voice detection. It must be an **independent detector
and tracker running alongside the voice tracker**, so that combined modes fall
out naturally instead of needing special cases.

### The second analyser

On top of the shared signal chain, `voice.html` adds a **second
`AnalyserNode`** (`fftSize = 2048`, `smoothingTimeConstant = 0`) on the same
source. The big FFT gives ~1.5 Hz bins for harmonic precision; the small one
gives an un-smeared RMS envelope — the workaround for the window smear
described in the shared section, and the only reliable source of syllable-gap
information. Two analysers on one source cost essentially nothing.

### Why classification is temporal

A single FFT frame of a spoken vowel and a sung vowel are nearly identical —
both are full harmonic stacks. Every discriminator between speech and singing
is a statement about *time*:

- **Plateau fraction** — how much voiced time sits parked on a pitch. Singing
  lives on plateaus (notes); speech glides continuously.
- **Voicing-gap rate** — speech toggles voiced/unvoiced at syllable rate
  (~2+ gaps/s of 40–500 ms); sustained singing is continuously voiced.
- **Vibrato** — regular 3.3–8.3 Hz pitch modulation is near-proof of singing
  (when the window smear lets it through; it usually fires only partially, so
  the plateau cue carries the load and vibrato is a *bonus* cue).
- **Overtone / subharmonic fractions** — throat-singing evidence integrated
  over time instead of trusting single frames.

So the pipeline is two-stage: per-frame spectral features feed a **rolling
~2 s window** (`WIN_MS`), and the window features are classified with **500 ms
hysteresis** (`CLASS_HOLD_MS`) so the label doesn't flicker.

#### The plateau-metric trap

The obvious plateau test — "is this frame's pitch close to the median of its
neighbours?" — is wrong: each frame is the *center of its own window*, so a
smooth glide always sits at its own local median and a 500 ¢/s sweep measures
as ~100 % plateau. The test must measure **movement**: the pitch *range*
within ±`PLATEAU_LOCAL_MS` must stay under 2×`PLATEAU_CENTS`.

### Whistle detection

A whistle is nearly sinusoidal, so per frame it is: a peak in
`WHISTLE_MIN`–`WHISTLE_MAX` (500–3500 Hz) that is

1. **locally prominent** — ≥ `WHISTLE_PROM_DB` above the median of its ±150 Hz
   neighbourhood;
2. **pure** — its own 2nd harmonic ≥ `WHISTLE_PURITY_DB` down (unless a voice
   harmonic legitimately sits there);
3. **loud in context** — within `WHISTLE_REL_DB` of the loudest peak (smeared
   voice-harmonic residue is never this strong);
4. **not a voice harmonic** — see below.

#### Whistle vs. throat-singing overtone — the genuine ambiguity

An overtone singer's reinforced partial *is* a loud, isolated, pure high tone.
The frame-level discriminator is that it sits **exactly on an integer multiple
of the drone**, while a whistle is a free pitch. Hence: any candidate within
`WHISTLE_AVOID_CENTS` (45¢) of `n·f0` is rejected as a harmonic.

But this only works while harmonic exclusion zones don't tile the axis: the
spacing between adjacent harmonics is `1200·log2((n+1)/n)` ¢ — about 94¢ at
n=18 — so above ~H12 the ±45¢ zones overlap and *every* frequency is "near a
harmonic", which would veto every whistle over a low voice. Exclusion
therefore stops at `WHISTLE_EXCL_MAX_N` (H12), matching the H5–H13 range where
sygyt melodies actually live (the sygyt detector is capped to H13 for
symmetry). Consequences to accept:

- A whistle deliberately locked onto ≤H12 of the sung note reads as overtone
  singing. Physically defensible — at that point the two are the same signal.
- A hypothetical overtone reinforced above H13 would read as whistle+voice.

#### Raw vs. smoothed f0 for the exclusion

The tracked voice pitch is a median over ~10 frames. During a glide it lags
the instantaneous f0 by tens of cents — and the harmonic exclusion computed
from the *lagged* track misses the *currently measured* harmonics by the same
cents, letting them leak through as false whistles. The exclusion must test
against the **raw frame f0**, falling back to the smoothed track only when the
frame has none.

### Fundamental scoring — the negative-dB bug

The original `findFundamental` added `match.mag * 0.35` per supporting
harmonic. FFT magnitudes are **negative dB**, so every harmonic found made the
candidate score *worse*, and the fundamental with the fewest harmonics won
(e.g. 660 Hz chosen over an obvious 220 Hz stack). This single bug was the
main reason sung fundamentals went undetected. Scores must be computed in
**dB above the floor**: `max(0, mag - ABS_FLOOR_DB)`. General rule for this
codebase: never sum raw dB values as additive evidence.

### Kargyraa and `MIN_FREQ`

Kargyraa works by period-doubling: the evidence is energy at **f0/2** (and odd
half-multiples). For a typical ~110 Hz drone that is 55 Hz — below the old
80 Hz analysis floor, making kargyraa *undetectable by construction*.
`MIN_FREQ` is 50 Hz so subharmonics are visible, while `FUND_MIN` stays at
80 Hz so hum and rumble can't become fundamentals. (50/60 Hz mains hum can in
principle fake a subharmonic; the ≥ −14 dB-rel-H1 requirement makes that
unlikely at sane mic levels.)

### Tuning guide (symptom → knob)

| Symptom | Adjust |
| --- | --- |
| Real whistle not detected | Lower `WHISTLE_PROM_DB` or `WHISTLE_REL_DB`; check it isn't parked on ≤H12 of the sung note |
| Voice harmonics flagged as whistles | Raise `WHISTLE_PROM_DB` / `WHISTLE_REL_DB`, widen `WHISTLE_AVOID_CENTS` |
| Speech labelled singing | Lower gap threshold in `instantModeId` (1.6/s) or tighten `PLATEAU_CENTS` |
| Singing labelled speech (expressive/melismatic) | Raise the gap-rate threshold, lower the plateau threshold (0.55) |
| Throat singing not recognised | Relax the isolated-harmonic gate in `frameVoiceSignature` (`dbRel > -8`, `prominence > 10`) or the window fractions (0.3/0.35) |
| Label flickers between modes | Raise `CLASS_HOLD_MS` |
| Label reacts too slowly | Lower `CLASS_HOLD_MS` or `WIN_MS` |
| Whistle track breaks up on fast glides | Raise `WHISTLE_MATCH_CENTS` |

### Testing the classifier

Real mouths are unrepeatable, so there is a deterministic harness:
`test/voice-scenarios.js` stubs `getUserMedia` with a synthesized
oscillator graph in headless Chromium and asserts the displayed mode for eight
scenarios (harmonic stack, pure sine, both at once, gliding+gated speech,
vibrato, drone with boosted H9, drone with f0/2, whistle over speech). See the
header of that file for how to run it. The synth scenarios are cleaner than
real input — treat them as regression tests for the logic, not as proof the
thresholds suit every voice.

## Testing basics (both tools)

- Microphone needs a **secure context** — serve over `localhost`
  (`python3 -m http.server 8000`); a bare `file://` open won't expose the mic in
  Chrome.
- No build step, no dependencies, no backend. Edit the HTML directly. (The
  classifier regression test above uses a dev-only `playwright-core` install;
  the tools themselves stay dependency-free.)
