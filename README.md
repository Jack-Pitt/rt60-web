# RT60 — NVC Acoustic Measurement

A Progressive Web App for quick on-site reverberation time (RT60)
measurements on iPhone, by [NVC](https://www.nvc.com.au).

> **Triage tool, not a Type 1 substitute.** This app gives an acoustic
> engineer a fast first read on a room's reverberation behaviour. It is
> intended to support, not replace, calibrated Type 1 sound level meter
> measurements. See [VALIDATION.md](./VALIDATION.md) for the cross-check
> protocol.

**Live app:** https://jack-pitt.github.io/rt60-web/

## What it does

- Records an impulse response on iPhone via the device microphone.
- Splits the impulse into 24 IEC 61260 base-10 third-octave bands
  (50 Hz – 10 kHz) using 6th-order Butterworth IIR filters designed at
  runtime from the device's actual sample rate.
- Applies Schroeder backward integration to derive each band's energy
  decay curve in dB rel peak.
- Fits T30 / T20 / EDT regressions and reports the appropriate metric
  per band based on the band's INR (impulse-to-noise ratio).
- Flags bands as `clipped`, `non-linear` (R² < 0.95), `low-INR`, or
  `uncertain-freq` (50–100 Hz and 6.3–10 kHz, where iPhone microphone
  response is unreliable).
- Stores measurements locally in IndexedDB (no cloud, no sync).
- Plots an RT-vs-frequency spectrum, per-band decay curves with
  regression overlays + noise plateau line, and the recorded waveform
  with the trigger point marked.
- Compares multiple saved measurements by overlaying their RT spectra.
- Exports a single measurement or a multi-measurement bundle as CSV
  via the iOS share sheet (Files / AirDrop / Mail / etc).

## Status

All ten build steps from the project brief are complete:

| Step | Status |
|---|---|
| Vite + React + TypeScript scaffold | ✓ |
| GitHub Actions deploy to Pages | ✓ |
| Audio capture (AudioWorklet, constraint reporting) | ✓ |
| DSP pipeline + 36 unit tests | ✓ |
| Recording flow + per-band results table | ✓ |
| Decay-curve plotting (selector + full plot + impulse waveform) | ✓ |
| IndexedDB persistence | ✓ |
| CSV export (single + bundle) with iOS share sheet | ✓ |
| PWA manifest + service worker (installable + offline) | ✓ |
| NVC brand styling | ✓ |

## Project structure

```
src/
  main.tsx                   app entry
  App.tsx                    router + layout (history / measure / settings)
  App.css, index.css         design tokens + component styles

  audio/
    AudioCapture.ts          getUserMedia + AudioContext + AudioWorklet
    capture-processor.js     worklet — runs on the audio thread

  dsp/                       (pure functions, unit-tested)
    bands.ts                 IEC 61260 third-octave band definitions
    biquad.ts                6th-order Butterworth bandpass + cascade
    schroeder.ts             backward integration -> dB EDC
    regression.ts            linear least-squares with R²
    noise.ts                 RMS / peak / INR helpers
    analyze.ts               full pipeline; per-band + overall results

  measurement/
    types.ts                 shared types (Metadata, RecordingPhase, ...)
    DraftContext.tsx         in-progress metadata + unsaved analysis
    MeasurementController.ts state machine: countdown -> bg -> armed -> ...

  settings/
    SettingsContext.tsx      app-wide settings (decay duration, INR
                             thresholds, enabled bands, ...) +
                             localStorage persistence

  storage/
    measurements.ts          IndexedDB CRUD via the `idb` wrapper
    export.ts                CSV / CSV-bundle / JSON / share-or-download

  components/
    DecayPlot.tsx            single-band Schroeder decay plot
    DecaySection.tsx         decay-band selector + full plot + meta
    ImpulseWaveform.tsx      time-domain raw-impulse diagnostic
    ResultsTable.tsx         per-band results table (NVC ruled style)
    RTSpectrumPlot.tsx       RT-vs-frequency line plot (single + multi)

  views/
    Home.tsx                 records list + comparison overlay view
    Measurement.tsx          metadata form + recording flow + results
    Settings.tsx             configurable thresholds + bands + flags
```

## Run locally

Requires Node.js (≥ 18) and npm. See [SETUP.md](./SETUP.md) if you don't
have these installed yet.

```sh
npm install
npm run dev          # dev server with HMR (no service worker)
npm run build        # production build into dist/
npm run preview      # serve the production build locally
npm test             # vitest, 36 unit tests
npm run test:watch   # tests in watch mode
```

The dev server runs on `http://localhost:5173` (or the next free port).
**Microphone access requires HTTPS on iPhone**, so real-device testing
must happen against the deployed GitHub Pages URL, not `localhost`.

## Install to iPhone home screen

Once you've loaded the live app on iPhone:

1. Tap the **Share** button (square with up-arrow).
2. Scroll down → **Add to Home Screen**.
3. Confirm the name "RT60" and tap **Add**.

The home-screen icon launches the app fullscreen (no Safari chrome).
After the first launch the entire app is cached for offline use, so it
keeps working even on Airplane Mode.

## Known limitations

- **iPhone microphone response is unreliable** below ~125 Hz and above
  ~5 kHz. Bands at 50–100 Hz and 6.3–10 kHz are flagged `uncertain-freq`
  and shown with a hashed background. Treat them as indicative only.
- **iOS Safari does not honour every audio constraint** (`autoGainControl`,
  `noiseSuppression`). The actual constraint values are reported under
  the "Microphone info" disclosure during a measurement, but iOS may
  silently apply processing we asked it to disable. Cross-check
  against your Type 1 to spot AGC artefacts. See
  [VALIDATION.md](./VALIDATION.md).
- **Single-impulse only** — no automated multi-impulse averaging at a
  position. The brief excluded this; multiple takes can be saved and
  averaged externally in Excel.
- **No cloud sync.** Saved measurements live in this device's IndexedDB
  only. To move data between devices, use the CSV export.
- **Measurement size** — each saved record is ~10 MB (per-band Schroeder
  EDC arrays + raw impulse buffer). Hundreds of measurements is fine on
  modern iPhones; thousands is not.

## Tech stack

- **Vite + React 19 + TypeScript** for the SPA
- **Web Audio API + AudioWorklet** for capture
- **Pure-TypeScript DSP** (no external library — filter design,
  Schroeder integration, and regression all in `src/dsp/`)
- **uPlot** for the time-series plots
- **idb** for IndexedDB
- **vite-plugin-pwa + Workbox** for the manifest and service worker
- **GitHub Actions + Pages** for deployment

## Further reading

- [SETUP.md](./SETUP.md) — first-time setup on macOS, including
  installing Node.js, configuring GitHub, deploying, and adding to
  iPhone home screen.
- [VALIDATION.md](./VALIDATION.md) — protocol for cross-checking
  results against a Type 1 sound level meter, including a checklist
  and visual diagnostics for spotting AGC artefacts in the decay
  curves and recorded waveform.
- [RT60-WEB-BRIEF.md](./RT60-WEB-BRIEF.md) — the original project
  brief.

## Licence

Internal NVC tool. Source visible publicly to enable GitHub Pages on a
free GitHub account; no licence granted for redistribution.
