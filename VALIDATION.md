# VALIDATION — RT60 (NVC) vs Type 1 SLM

A protocol for systematically comparing the RT60 app's results against
a calibrated Type 1 sound level meter. Work through this once before
relying on the app for any real assessment, and re-run it whenever
**iOS Safari version, iPhone model, microphone hardware, or app
version** changes.

> **Why this matters.** The brief that drives this app classifies it
> as a triage tool, not a substitute for Type 1 instrumentation. iOS
> Safari is known to silently apply audio processing (AGC, noise
> suppression) we ask it to disable. Validation is how you turn the
> app's output into something you can defend in a report — by knowing
> *where* and *by how much* it disagrees with the reference, and what
> the failure modes look like.

---

## Contents

1. [Test spaces](#1-test-spaces) — three rooms to use for the protocol
2. [Per-position protocol](#2-per-position-protocol) — what to do at each measurement point
3. [Recording the discrepancies](#3-recording-the-discrepancies) — the comparison spreadsheet
4. [Visual decay-curve diagnostics](#4-visual-decay-curve-diagnostics) — what AGC artefacts look like in the EDC and the recorded waveform
5. [Pass / fail criteria](#5-pass--fail-criteria) — when the app is fit for use, when it isn't
6. [Validation report](#6-validation-report) — what to write up after the run

---

## 1. Test spaces

Run the protocol in **three** acoustically distinct environments. Each
exercises a different failure mode of the iPhone microphone + iOS audio
chain.

### Space A — Small reverberant room (RT60 ≈ 0.6–1.2 s)

A bathroom, stairwell, or empty meeting room with hard surfaces. Tests
the **typical mid-range** the app is intended for. AGC artefacts are
subtle here and hardest to spot, so you're looking for fine differences.

- ☐ Choose a space with no HVAC noise or pumps running.
- ☐ Note ambient noise level on the Type 1 (LAeq, 30 s).
- ☐ Mark **3 source/receiver positions** with masking tape or chalk so
      they're identical across tools.

### Space B — Large reverberant hall (RT60 ≈ 2–4 s)

A church, theatre, atrium, or sports hall. Tests **long decays** where
the app's 3 s default decay window may not capture the full T30 range
(set the decay window in **Settings → Decay capture window** to 6–10 s
for this space).

- ☐ Note the ambient floor — large halls often have HVAC tonals that
      can dominate certain bands.
- ☐ Mark 3 positions, including at least one ≥ 4 m from the impulse
      source.

### Space C — Outdoor space or anechoic / heavily damped room (RT60 ≪ 0.3 s)

Garden, car park (no traffic), or a sound-treated studio. Tests the
**low-INR / fast-decay** edge case where T30 generally won't be
reportable and the app should fall back to T20 or EDT-only. Also acts
as a **negative control** — if the app reports an inflated RT60 here,
you've identified an artefact rather than room behaviour.

- ☐ Confirm the space has no specular reflections from nearby walls.
- ☐ Mark 1 position is sufficient (one impulse, repeated).

---

## 2. Per-position protocol

For each marked position in each space:

### 2.1 Setup

- ☐ Tripod-mount the Type 1 SLM at standing-ear height (1.5–1.7 m).
- ☐ Position the iPhone immediately adjacent to the SLM mic, oriented
      so the iPhone's bottom microphone array is closest to the source.
- ☐ Source position: 1.0–2.0 m from the receiver pair, at the same
      height. Same impulse source for both instruments.
- ☐ Both instruments should have the **same view of the room** — don't
      shadow the iPhone with your body.

### 2.2 Settings

In the RT60 app:

- ☐ Set **decay duration** to match the space (Settings → Decay capture
      window). Rule of thumb: at least 1.5× the expected T30.
- ☐ Confirm **trigger threshold** is 25–30 dB above background.
- ☐ Confirm **all 24 bands** are enabled (or at least 125 Hz – 5 kHz).

On the Type 1:

- ☐ Configure the SLM for octave or third-octave RT60 measurement per
      its manufacturer protocol.
- ☐ Use the same impulse source convention.

### 2.3 Take the measurements

For each position, capture **5 impulses with each tool** (in series, not
in parallel — the second tool may pick up the first tool's audio):

1. ☐ With the iPhone in **Save + repeat** mode, take 5 impulses with the
      RT60 app at the marked position. Each gets saved to the Records
      tab automatically with the same site/room/position metadata.
2. ☐ Move to the SLM, take 5 impulses with the same source from the
      same position.
3. ☐ Note any clipping warnings or visibly bad recordings on either
      tool. Discard and retry if necessary.

### 2.4 Per-impulse hygiene

For each iPhone-side impulse, before moving on:

- ☐ Glance at the **Recorded waveform** panel below the RT spectrum.
      The trigger marker should sit cleanly between the pre-trigger
      noise and the impulse peak. The peak should be a clean spike, not
      a flat top (clipping).
- ☐ Glance at the **Overall** decay curve. It should drop from 0 dB
      to the noise plateau in a roughly straight line. A two-slope
      ("kinked") shape, a slow-fast-slow triple-slope, or an upper
      flattening indicates an issue — see [section 4](#4-visual-decay-curve-diagnostics).
- ☐ Look at the **band button row** on the decay-curve panel. **Bright
      red** buttons (clipped or non-linear) and **dark red** invalid
      buttons in the mid-band cluster (250 Hz – 2 kHz) warrant a retake.

If a measurement is bad, tap **Discard** rather than Save.

---

## 3. Recording the discrepancies

After each space's measurements are saved on iPhone:

### 3.1 Export

- ☐ Open the **Records** tab.
- ☐ Tap **Select**, tick all 5 impulses for that site/room/position.
- ☐ Tap **Export** → share to Files → save to a folder named after the
      space (e.g. `Validation - Space A.csv`).
- ☐ Open the bundle CSV in Excel. The top of the file has comparison
      summary tables (RT, EDT, INR) with one column per impulse.

### 3.2 Compute the iPhone average per band

In the bundle CSV:

- ☐ For each band row in the RT comparison summary, compute the
      arithmetic mean of the five impulse columns. Ignore any cell
      that's blank (band was flagged dubious for that impulse).
- ☐ Repeat for the EDT summary.
- ☐ Optionally compute standard deviation and range — large per-impulse
      variance is itself a signal that something's wrong.

### 3.3 Type 1 reference

- ☐ Export per-band T30 / T20 / EDT from the SLM (typically a CSV from
      Brüel & Kjær / NTi / Norsonic / etc.).
- ☐ Average the 5 SLM impulses the same way.

### 3.4 The comparison table

Build a side-by-side table per space:

| Band (Hz) | App T30 (s) | SLM T30 (s) | Δ (s) | Δ (%) | App flag |
|---|---|---|---|---|---|
| 125 | 0.84 | 0.81 | +0.03 | +3.7 | — |
| 160 | 0.86 | 0.79 | +0.07 | +8.9 | — |
| 200 | 0.79 | 0.78 | +0.01 | +1.3 | — |
| ... | | | | | |

Repeat for EDT and T20 where reportable.

> **What to look for at this stage**: a *systematic bias* (app
> consistently 5–10 % high) is correctable. Random scatter (Δ % varies
> wildly band-to-band) suggests the iPhone mic is unsuitable for those
> bands, regardless of any correction.

---

## 4. Visual decay-curve diagnostics

The brief calls out decay-curve visual inspection as the primary line
of defence against silent AGC interference. Use the **Decay curves**
panel and the **Recorded waveform** panel on each measurement.

### 4.1 What a good decay looks like

A textbook EDC for a band with high INR:

```
 0 dB │\
      │  \
−10 dB│    \         ← clean straight slope from 0 dB to noise plateau
      │      \
−20 dB│        \
      │          \
−30 dB│            \
      │              \─ ─ ─ ─ ─ ← noise plateau ~−40 dB
−40 dB│                 \
      │                   \
−50 dB│                     \─ ─ ─ ─ ─ ─ ─ ─ ─ ← (red dashed line)
      └────────────────────────────────────
       0     0.5    1.0    1.5    2.0   t (s)
```

- The decay is a **single straight line** in dB rel peak.
- **R² > 0.95** on the regression overlay.
- The line **flattens at the noise plateau** (red dashed horizontal),
  not before.

### 4.2 What AGC interference looks like

#### a) Upper-decay flattening

```
 0 dB │\
      │ \           ← AGC compresses the impulse peak then releases,
−10 dB│  ─\           making the upper decay flatter than reality
      │     \
−20 dB│      \\
      │        \    ← real slope resumes once AGC is off
−30 dB│         \\
      │           \\
−40 dB│             \\─ ─ ─ ─
      └────────────────────────
```

The first 0 to ~−10 dB drops slowly, then the slope steepens. If you fit
T30 across the −5 to −35 range it averages the two slopes and gives an
**overestimate of RT**. The R² may still pass 0.95 if both slopes are
similar in length, masking the issue.

**What to do**: compare to the band's **EDT** (which uses 0 to −10 only)
— if EDT >> T30/3, the upper portion is suspect. Cross-check with the
SLM.

#### b) "Pumping" (visible in the recorded-waveform panel)

In the **Recorded waveform** panel, look at the noise floor before and
after the impulse:

```
            │     ╱╲                                       │
            │    ╱  ╲                                      │
            │   ╱    ╲                                     │
            │  ╱      ╲                                    │
─pre noise─ │─╱─trigger╲─ slow recovery───── ──post noise─ │
            ▒▒▒▒▒░░░░░  ▒▒▒▒▒▒▒░░░░░░░░░░░░░░░░ ▒▒▒▒▒▒▒▒▒▒│
            (denser noise then thinner — AGC turned the gain UP after
             the impulse, lifting the noise floor; it slowly tapers
             back as AGC calms down)
```

If the noise envelope visibly **swells after the impulse and fades**
back over a second or two, AGC is active. The recorded EDC tail will
correspondingly rise rather than plateau, throwing T30 off.

**What to do**: discard the measurement. AGC is fundamentally
incompatible with Schroeder integration; no post-processing fix is
practical.

#### c) Slow start (impulse "ringing")

```
              ╱╲╱╲
              │  ╲
              │   ╲╲ ← the impulse decays initially through its own
              │     ╲    transient, not the room
─trigger──────┴──────╲
                      ╲
                       ╲
```

Hand claps and clapper boards ring slightly. If the impulse is
sustained (e.g. a poorly closed clapper), the EDT for low/mid bands
inflates because the early decay is dominated by source decay, not room
decay. **EDT >> T30** is a red flag.

**What to do**: switch to a **balloon pop** or **starter pistol** — both
have flatter spectra and shorter source decay.

#### d) Noise floor rises during the decay window

In the EDC, look at the right end of the curve. Ideally the EDC
asymptotes to the noise plateau (red dashed line) and stays there. If
the EDC tail **goes UP** rather than plateauing, an external sound
intruded during the recording (HVAC kicking in, footstep, vehicle
passing). The Schroeder integral is non-decreasing only over signal-
plus-uncorrelated-noise, so a true intrusion can corrupt the slope.

**What to do**: discard the measurement. Take another when the room
settles.

### 4.3 Diagnostic checklist (per measurement)

Run through these on the live results screen for every measurement:

- ☐ **Recorded waveform**: trigger marker sits cleanly between
      pre-noise and the impulse peak. ✓ go on.
- ☐ **Recorded waveform**: peak is a sharp spike, not a flat top. ✓
- ☐ **Recorded waveform**: post-impulse envelope settles back to a
      similar density to the pre-noise within ~1 s. ✓
- ☐ **Overall decay curve**: single straight slope down to plateau, no
      kinks. ✓
- ☐ **Overall decay curve**: tail asymptotes to the red dashed line,
      doesn't rise. ✓
- ☐ **Mid-band buttons** (250 Hz – 2 kHz): all green/amber, no bright
      red. ✓
- ☐ **EDT vs RT**: per band, EDT and T30 are within ~30 % of each
      other. Large divergence = source ringing or room mode dominance,
      both worth noting. ✓
- ☐ **INR**: 35+ dB across the mid-band cluster. ≤ 25 dB suggests the
      space is too quiet OR the impulse was too soft.

---

## 5. Pass / fail criteria

After completing all three spaces:

### Pass — app is fit for triage

- Mean per-band Δ % across **mid bands (250 Hz – 4 kHz)** is **within ±10 %** of the SLM in all three spaces.
- No systematic high or low bias greater than 5 % across spaces.
- Visual diagnostics (section 4.3) clean across at least 4 out of 5 impulses per position.
- Outdoor / control space (Space C) does **not** report inflated RT60 — the app correctly reports `EDT-only` or `invalid` for short-decay spaces.

### Caution — fit for triage with caveats noted

- Mid-band Δ % within **±15 %** but with **a known systematic bias** (e.g. consistently +8 %) — a correction factor can be applied in reports.
- Visual diagnostics show occasional AGC artefacts (≤ 1 in 5 impulses).

### Fail — do not rely on app results

- Mid-band Δ % exceeds **±20 %** in any space.
- Visual diagnostics flag AGC pumping or upper-decay flattening on most impulses.
- Outdoor / control space reports inflated RT60 — indicates iOS is
  injecting reverberation-like artefacts.

If the app fails, the brief considers it a candidate for a Stage 2
native iOS port (where AGC can be disabled at the AVAudioSession level
rather than asked-but-ignored at the WebRTC level).

---

## 6. Validation report

When you've finished, write up a one-page summary including:

- ☐ iPhone model + iOS version
- ☐ Safari version
- ☐ App version (from the deploy git commit hash if you've kept it
      pinned, otherwise "as of <date>")
- ☐ Type 1 SLM model + serial number + last calibration date
- ☐ Three test spaces with their measured ambient and approximate
      reference RT60
- ☐ The comparison table per space (section 3.4)
- ☐ Visual diagnostics summary — fraction of impulses showing AGC
      artefacts
- ☐ Pass / caution / fail conclusion against section 5 criteria
- ☐ If "caution": correction factor and the bands it applies to
- ☐ Re-validation triggers — what changes invalidate this report (iOS
      update, iPhone replacement, app version bump)

Keep this report alongside the project so future you (or someone else)
knows whether the app's results are trustworthy and under what
conditions.
