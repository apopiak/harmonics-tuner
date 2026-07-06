# Design Notes — `voice.html`

Rationale and internals for the voice harmonics analyzer and its mode
classifier. This is the "why" behind the code; per-constant "what" lives in
comments at the top of the `<script>` block. Scope is `voice.html` only —
`huaca.html` is covered in [`DESIGN.md`](DESIGN.md).

## Problem

Analyze one person's vocal sound as a harmonic stack, and classify *what they
are doing*: whistling, speech, singing, throat singing — **including
combinations of whistling with the others**, since whistling while singing is
physically possible and produces two independent pitch sources at once.

That last requirement shapes the whole architecture: whistle detection cannot
be an `else` branch of voice detection. It must be an **independent detector
and tracker running alongside the voice tracker**, so that combined modes fall
out naturally instead of needing special cases.

## Signal chain

Same base as `huaca.html` (raw mic, `fftSize = 32768`, parabolic
interpolation), plus a **second `AnalyserNode`** (`fftSize = 2048`,
`smoothingTimeConstant = 0`) on the same source. The big FFT gives ~1.5 Hz bins
for harmonic precision; the small one gives an un-smeared RMS envelope. Two
analysers on one source cost essentially nothing.

## Why a second analyser: the 0.7 s window smear

At 32768 samples / 48 kHz, each spectrum frame *observes ~0.68 s of the past*.
Three consequences that repeatedly bit during development:

- **Syllabic gaps are spectrally invisible.** A 180 ms silence inside a 680 ms
  window barely dents the spectrum, so voiced/unvoiced transitions — the main
  speech cue — cannot be read from the big FFT. The fast analyser's RMS
  envelope sees them directly.
- **Vibrato is attenuated below detectability.** A 5–6 Hz, ±40¢ oscillation
  completes ~4 cycles inside the window; the measured peak sits near the mean,
  so the extracted pitch track shows only a fraction of the true extent. The
  vibrato detector therefore fires rarely and is treated as a *bonus* cue for
  singing — the plateau cue carries the load.
- **The smoothed pitch track lags glides.** See "raw vs smoothed f0" below.

## Why classification is temporal

A single FFT frame of a spoken vowel and a sung vowel are nearly identical —
both are full harmonic stacks. Every discriminator between speech and singing
is a statement about *time*:

- **Plateau fraction** — how much voiced time sits parked on a pitch. Singing
  lives on plateaus (notes); speech glides continuously.
- **Voicing-gap rate** — speech toggles voiced/unvoiced at syllable rate
  (~2+ gaps/s of 40–500 ms); sustained singing is continuously voiced.
- **Vibrato** — regular 3.3–8.3 Hz pitch modulation is near-proof of singing
  (when the window smear lets it through).
- **Overtone / subharmonic fractions** — throat-singing evidence integrated
  over time instead of trusting single frames.

So the pipeline is two-stage: per-frame spectral features feed a **rolling
~2 s window** (`WIN_MS`), and the window features are classified with **500 ms
hysteresis** (`CLASS_HOLD_MS`) so the label doesn't flicker.

### The plateau-metric trap

The obvious plateau test — "is this frame's pitch close to the median of its
neighbours?" — is wrong: each frame is the *center of its own window*, so a
smooth glide always sits at its own local median and a 500 ¢/s sweep measures
as ~100 % plateau. The test must measure **movement**: the pitch *range*
within ±`PLATEAU_LOCAL_MS` must stay under 2×`PLATEAU_CENTS`.

## Whistle detection

A whistle is nearly sinusoidal, so per frame it is: a peak in
`WHISTLE_MIN`–`WHISTLE_MAX` (500–3500 Hz) that is

1. **locally prominent** — ≥ `WHISTLE_PROM_DB` above the median of its ±150 Hz
   neighbourhood;
2. **pure** — its own 2nd harmonic ≥ `WHISTLE_PURITY_DB` down (unless a voice
   harmonic legitimately sits there);
3. **loud in context** — within `WHISTLE_REL_DB` of the loudest peak (smeared
   voice-harmonic residue is never this strong);
4. **not a voice harmonic** — see below.

### Whistle vs. throat-singing overtone — the genuine ambiguity

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

### Raw vs. smoothed f0 for the exclusion

The tracked voice pitch is a median over ~10 frames. During a glide it lags
the instantaneous f0 by tens of cents — and the harmonic exclusion computed
from the *lagged* track misses the *currently measured* harmonics by the same
cents, letting them leak through as false whistles. The exclusion must test
against the **raw frame f0**, falling back to the smoothed track only when the
frame has none.

## Fundamental scoring — the negative-dB bug

The original `findFundamental` added `match.mag * 0.35` per supporting
harmonic. FFT magnitudes are **negative dB**, so every harmonic found made the
candidate score *worse*, and the fundamental with the fewest harmonics won
(e.g. 660 Hz chosen over an obvious 220 Hz stack). This single bug was the
main reason sung fundamentals went undetected. Scores must be computed in
**dB above the floor**: `max(0, mag - ABS_FLOOR_DB)`. General rule for this
codebase: never sum raw dB values as additive evidence.

## Kargyraa and `MIN_FREQ`

Kargyraa works by period-doubling: the evidence is energy at **f0/2** (and odd
half-multiples). For a typical ~110 Hz drone that is 55 Hz — below the old
80 Hz analysis floor, making kargyraa *undetectable by construction*.
`MIN_FREQ` is 50 Hz so subharmonics are visible, while `FUND_MIN` stays at
80 Hz so hum and rumble can't become fundamentals. (50/60 Hz mains hum can in
principle fake a subharmonic; the ≥ −14 dB-rel-H1 requirement makes that
unlikely at sane mic levels.)

## Tuning guide (symptom → knob)

All constants are at the top of the `<script>` block.

| Symptom | Adjust |
| --- | --- |
| Real whistle not detected | Lower `WHISTLE_PROM_DB` or `WHISTLE_REL_DB`; check it isn't parked on ≤H12 of the sung note |
| Voice harmonics flagged as whistles | Raise `WHISTLE_PROM_DB` / `WHISTLE_REL_DB`, widen `WHISTLE_AVOID_CENTS` |
| Speech labelled singing | Lower gap threshold in `instantModeId` (1.6/s) or raise `PLATEAU_CENTS` window strictness (lower it) |
| Singing labelled speech (expressive/melismatic) | Raise the gap-rate threshold, lower the plateau threshold (0.55) |
| Throat singing not recognised | Relax the isolated-harmonic gate in `frameVoiceSignature` (`dbRel > -8`, `prominence > 10`) or the window fractions (0.3/0.35) |
| Label flickers between modes | Raise `CLASS_HOLD_MS` |
| Label reacts too slowly | Lower `CLASS_HOLD_MS` or `WIN_MS` |
| Whistle track breaks up on fast glides | Raise `WHISTLE_MATCH_CENTS` |

## Testing

Real mouths are unrepeatable, so there is a deterministic harness:
`test/voice-scenarios.js` stubs `getUserMedia` with a synthesized
oscillator graph in headless Chromium and asserts the displayed mode for eight
scenarios (harmonic stack, pure sine, both at once, gliding+gated speech,
vibrato, drone with boosted H9, drone with f0/2, whistle over speech). See the
header of that file for how to run it. The synth scenarios are cleaner than
real input — treat them as regression tests for the logic, not as proof the
thresholds suit every voice.
