# RT60-Web

A Progressive Web App (PWA) for quick on-site reverberation time (RT60)
measurements on iPhone via Safari. Built for use as a triage tool by an
acoustic engineer — not a substitute for a Type 1 sound level meter.

## Status

Step 1 of the build sequence: Vite + React + TypeScript scaffold with the
three-view structure (Home, Measure, Settings). Audio capture, DSP, and
results display land in later steps. See `RT60-WEB-BRIEF.md` for the full
build plan.

## Project structure

```
src/
  main.tsx              app entry point
  App.tsx               router and shared layout
  App.css               app-level styles (mobile-first, dark theme)
  index.css             global resets and base typography
  views/
    Home.tsx            list of past measurements + "New measurement"
    Measurement.tsx     metadata form, recording flow, results
    Settings.tsx        decay duration, INR thresholds, band selection
```

## Run locally

```sh
npm install
npm run dev
```

Then open the printed `http://localhost:...` URL in a browser. Note: iOS
Safari requires HTTPS for microphone access, so on-device audio capture
testing must happen against the deployed GitHub Pages URL, not the dev
server. See `SETUP.md` (added in step 10) for full setup instructions.

## Build

```sh
npm run build
```

Outputs a static site to `dist/` ready to be served by GitHub Pages.

## Deployment

Configured in step 2: GitHub Actions workflow auto-deploys to GitHub
Pages on every push to `main`.
