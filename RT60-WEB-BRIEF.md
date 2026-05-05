# Claude Code Project Brief — RT60 Measurement Web App

## Project: RT60-Web — Reverberation Time Measurement PWA

### Purpose
A Progressive Web App (PWA) for personal use by an acoustic engineer to perform quick reverberation time measurements on-site using an iPhone. Not a precision instrument — a triage tool for spaces where a Type 1 meter isn't warranted. Will be validated against a Type 1 by the user.

### Target user
Acoustic engineer with deep domain knowledge but no software development experience. The user is running this on iPhone via Safari. Build assuming the user will need step-by-step setup instructions at the end. The user has an Apple Silicon MacBook Pro and an existing GitHub account.

### Core measurement workflow
1. User opens app, enters basic project metadata: site name, room name, position number, optional notes.
2. User selects impulse source from a dropdown: balloon pop, clapper board, starter pistol, other.
3. User taps "Start measurement".
4. App records 3 seconds of background noise (countdown shown).
5. App prompts "Trigger impulse now" and listens. Auto-detects impulse via threshold crossing on broadband signal (configurable threshold, default ~30 dB above the just-measured background RMS). Pre-trigger buffer of ~200 ms is retained.
6. App records the decay for a fixed duration (default 6 seconds, user-configurable 3–10 s).
7. App records 2 seconds of post-decay background noise to verify floor.
8. App processes the recording and displays results.
9. User can save the measurement, export to CSV, or discard and retry.

### Signal processing pipeline
Implement in JavaScript using Web Audio API. Sample rate: request 48 kHz, accept whatever the device provides, document actual rate in output.

For each third-octave band from 50 Hz to 10 kHz (centre frequencies per IEC 61260, base-10 system: 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1k, 1.25k, 1.6k, 2k, 2.5k, 3.15k, 4k, 5k, 6.3k, 8k, 10k Hz):

1. **Bandpass filter** the impulse response. Use 6th-order Butterworth IIR (cascaded biquads) designed per band. Filter coefficients calculated at runtime from the actual sample rate.
2. **Square** the filtered signal to get instantaneous power.
3. **Schroeder backward integration**: integrate the squared signal from the end backward to each time point. Convert to dB (10·log10).
4. **Find the noise floor** of the band from the post-decay background segment. Compute INR (impulse peak to noise floor in dB).
5. **Decision logic for what to report:**
   - INR ≥ 35 dB → report **T30** (regression from -5 to -35 dB)
   - INR ≥ 25 dB → report **T20** (regression from -5 to -25 dB), flag as "T20"
   - INR ≥ 15 dB → report **EDT only** (0 to -10 dB), flag as "EDT only — low INR"
   - INR < 15 dB → report **invalid**, show INR value
6. **Always** also compute and report **EDT** (0 to -10 dB regression) as a separate column.
7. **Linearity check**: report R² (coefficient of determination) of the regression. Flag bands with R² < 0.95 as "non-linear decay".
8. **Frequency response uncertainty flagging**: hardcode bands 50–100 Hz and 6.3–10 kHz as "uncertain — phone mic response" with an estimated ±20% error bound. Bands 125–5000 Hz are reported without that flag.

### Calibration
No absolute SPL calibration needed — RT60 is a relative measurement of decay slope. Do not attempt to display absolute dB SPL. All dB values shown are dB relative to the impulse peak in that band.

### Audio capture requirements
- Request `getUserMedia` with constraints: `autoGainControl: false`, `echoCancellation: false`, `noiseSuppression: false`, `channelCount: 1`.
- Display a warning to the user before each measurement noting that iOS Safari may not fully honour these constraints. Show the actual constraint values reported by the browser after stream acquisition.
- Detect clipping in the raw recording (any sample at ±1.0). If clipping detected on the impulse, flag the entire measurement as "impulse clipped — reduce source level or move further away". Allow user to proceed anyway with a warning.
- Use `AudioWorkletNode` for capture, not the deprecated `ScriptProcessorNode`.

### Decay curve visibility (critical requirement)
The user is an acoustic engineer who will visually assess decay curves to spot AGC artefacts, non-linearity, and noise floor issues that automated metrics may miss. The decay curve display is therefore a primary feature, not a secondary one.

- **Always show decay curves for every measurement**, prominently, not buried below the table.
- For each band that has a reported result, display the full Schroeder decay curve from impulse peak down to the noise floor.
- **Overlay on each curve**: the regression line used for T30/T20/EDT, with the regression range (e.g. -5 to -25 dB) clearly marked by horizontal reference lines. Show the noise floor as a horizontal line.
- Provide a band selector that allows the user to view any individual third-octave band's decay curve at full size, not just the default 500/1k/2k.
- Provide a "small multiples" view showing all bands as a grid of thumbnail decay curves, so the user can scan all bands at once for visual anomalies.
- The y-axis must be dB relative to peak, x-axis time in seconds. Both axes labelled with units. Gridlines at 5 dB intervals on y-axis.
- Curves must be exportable as the underlying data (in the JSON export — see Output below) so the user can re-plot in Excel or similar if desired.

### Output
**On-screen results table** with columns:
- Band centre frequency (Hz)
- T30 (s) or T20 (s) or "—"
- Reported metric type (T30 / T20 / EDT-only / invalid)
- EDT (s)
- INR (dB)
- R² of regression
- Flags (clipped, non-linear, uncertain-freq, low-INR)

Colour coding: green for T30 valid, amber for T20, red for EDT-only or invalid. Uncertainty-flagged bands shown with a striped/hashed background regardless of validity.

**Decay curve plots** as described above — these are a primary deliverable, not an afterthought.

**Export**:
- CSV download with all metadata, sample rate, and full results table.
- JSON export of the complete measurement including raw decay curve data per band (time-series of dB-vs-time for every band), regression endpoints, noise floor per band, and all metadata. This is for later re-analysis or external plotting.
- Both files named `RT60_<site>_<room>_<pos>_<timestamp>.csv` / `.json`.

### Storage
Use browser `IndexedDB` to persist all measurements locally on the device. Show a "Past measurements" list on the home screen with date, site, room, and position. User can re-open, re-export, or delete any past measurement. No cloud sync — local-only.

### UI structure
Single-page app, three views:
1. **Home**: list of past measurements, "New measurement" button, "Settings" link.
2. **Measurement**: metadata form → recording flow with large status text and countdowns → results display (table + decay curves).
3. **Settings**: decay duration, INR thresholds (with sensible defaults and a "Reset to defaults" button), enable/disable bands by frequency range.

Optimise for one-handed use on iPhone. Large tap targets. High-contrast colours. The recording flow must show very clear "what to do now" prompts because the user will have a clapper board in the other hand.

### PWA requirements
- Installable to iOS home screen (manifest.json, appropriate icons, theme colour).
- Works fully offline after first load (service worker caching all static assets).
- No backend, no analytics, no external API calls. Everything runs on-device.

### Tech stack
- **Framework**: React with Vite for the build. TypeScript.
- **Audio**: Web Audio API + AudioWorklet for capture and DSP.
- **DSP**: Implement filter design and Schroeder integration in pure TypeScript. No external DSP library — keep dependencies minimal.
- **Plotting**: a lightweight library like uPlot or Chart.js. Avoid heavyweight options. Plot quality matters here — decay curves must be clearly readable.
- **Storage**: IndexedDB via the `idb` wrapper library.
- **Hosting**: GitHub Pages (the user has a GitHub account). Deploy via GitHub Actions on push to main.

### Deployment priority
**Deploy to GitHub Pages early — by the end of step 2 in the build sequence.** iOS Safari requires HTTPS for microphone access, which the local dev server doesn't provide cleanly. The user should be able to test on their actual phone against the live GitHub Pages URL from very early in the build, so the testing loop is real-device from the start. Local dev server is fine for desktop testing of UI and DSP unit tests, but real audio capture testing must happen on the deployed URL on the phone.

### Deliverables
1. Complete working codebase in a Git repository, deployed live to GitHub Pages.
2. README with: what the app does, project structure, how to run locally, deployment status, how to install to iPhone home screen, known limitations.
3. **A separate `SETUP.md` written for a non-developer**, covering:
   - Installing Node.js on macOS via Homebrew (provide the exact commands).
   - Installing Git if not already installed.
   - Creating a new GitHub repository and pushing the project to it.
   - Configuring GitHub Pages (Settings → Pages → source: GitHub Actions).
   - The GitHub Actions workflow file is included in the repo, so deployment happens automatically on push to main.
   - How to access the deployed URL on the iPhone.
   - How to "Add to Home Screen" on iPhone Safari to install as PWA.
   - How to update the app: edit, commit, push — GitHub Actions does the rest.
   - Troubleshooting section: what to do if the build fails, if microphone permission is denied, if the app doesn't update after a push.
4. **A validation protocol document** (`VALIDATION.md`) describing how to compare results against a Type 1 meter:
   - Suggested test spaces (small reverberant room, large hall, outdoor space as control).
   - Number of impulses to average per position.
   - How to record discrepancies in a structured way.
   - **What to look for visually in the decay curves** that indicates AGC interference (e.g. flattening of the upper decay, "pumping" patterns, noise floor that rises rather than stays flat). Include sketches or descriptions of what good vs bad curves look like.
   - Format as a checklist the user can work through.

### Quality bar
- Code commented well enough that the user, with no JS background, can read the comments and understand what each function does. Especially the DSP — explain Schroeder integration, filter design, and the regression in plain English in the comments.
- All measurement logic in pure functions with no DOM dependencies, so it can be unit-tested.
- Include a small set of unit tests for the DSP pipeline using a synthetic exponential decay with known RT60 — verify the algorithm recovers the correct value within ±2%.

### What this brief explicitly does not include
- Native iOS port (separate Stage 2 project).
- Multi-position averaging (compute per-impulse only; user can average externally).
- Source position / receiver position metadata beyond a free-text field.
- T60 extrapolation as a separate metric (T20 and T30 already extrapolate to 60 dB).
- Background SPL display in absolute units.
- Cloud sync or multi-user.

### Build sequence
Work through these steps in order, pausing after each for user check-in:

1. Vite + React + TypeScript scaffold with the three-view structure. Initial commit to a new GitHub repo.
2. **Set up GitHub Actions workflow for deploying to GitHub Pages.** Get a "hello world" version of the app live on the Pages URL so the user can confirm the deployment pipeline works on their phone. This is a hard gate — do not proceed until the user confirms they can load the app on their iPhone over HTTPS.
3. Audio capture with constraint reporting and waveform display (no analysis yet). User tests microphone access on phone.
4. DSP pipeline as pure functions with unit tests against synthetic data.
5. Wire DSP into the recording flow, results table.
6. Decay curve plotting (full implementation per the visibility requirements above — full-size single-band view, small multiples, regression overlays, noise floor lines).
7. IndexedDB persistence.
8. CSV/JSON export.
9. PWA manifest and service worker for offline use and home-screen install.
10. Documentation (README, SETUP.md, VALIDATION.md).

---

## How the user will use this brief

1. Save this brief as `RT60-WEB-BRIEF.md` on the MacBook.
2. Install Claude Code (the user can ask Claude separately for installation steps if needed).
3. Open Terminal, make a new folder for the project, `cd` into it.
4. Run `claude` to start Claude Code in that folder.
5. Tell Claude Code: *"Read RT60-WEB-BRIEF.md and build the project according to the brief. Work through the build sequence step by step, and pause after each step so I can check progress."*
6. Answer Claude Code's questions as they arise. When it produces code, the user doesn't need to read it — just check the deliverables work as described in the brief.
