# SETUP — RT60 (NVC)

A no-prior-knowledge guide for setting up the RT60 app on a fresh Mac,
publishing it to your GitHub account, and installing it on your iPhone.

> If you already have Node.js, Git, and GitHub set up, skip ahead to
> **[Get the project](#3-get-the-project)**.

## What you'll end up with

- The RT60 app **running locally** on your Mac (for dev / testing).
- The RT60 app **deployed to GitHub Pages** at a permanent HTTPS URL
  (so iPhone Safari can access the microphone).
- The RT60 app **installed on your iPhone home screen** (full-screen,
  no Safari chrome, works offline).
- A workflow where you edit the code, push it to GitHub, and the live
  app **updates automatically** about a minute later.

---

## 0. What you need before you start

- **A Mac** running macOS 13 (Ventura) or newer.
- **An iPhone**, ideally with iOS 16.4 or later (full PWA + offline
  support landed in 16.4).
- **A GitHub account** (free is fine; if you don't have one, sign up at
  [github.com](https://github.com)).
- **An internet connection** for the install step.

About 30 minutes of attention. Most of the time is downloads.

---

## 1. Install command-line tools

### 1.1 Open Terminal

- Press **⌘ Space**, type "Terminal", press **Return**.
- A black-or-light window with text appears. This is where you type
  commands. **Copy each command below and paste it in (⌘ V), then press
  Return.**

### 1.2 Install Apple's command-line developer tools

```sh
xcode-select --install
```

A dialog pops up. Click **Install** and accept the licence. Wait until
it finishes (a few minutes). This gets you `git` and a few other tools.

To confirm it worked:

```sh
git --version
```

You should see something like `git version 2.39.5`. If you see a
"command not found" error, install didn't work — try again.

### 1.3 Install Homebrew (the macOS package manager)

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

This is a one-line script from [brew.sh](https://brew.sh). It will ask
for your Mac password (won't show as you type — just type and press
Return). Takes a few minutes.

When it finishes, follow the on-screen instructions to add Homebrew to
your PATH. On Apple Silicon Macs that's usually:

```sh
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Confirm:

```sh
brew --version
```

### 1.4 Install Node.js

```sh
brew install node
```

Takes a couple of minutes. Confirm:

```sh
node --version
npm --version
```

You should see version numbers for both (e.g. `v20.10.0` for Node and
`10.2.4` for npm). Anything ≥ Node 18 is fine.

### 1.5 Install GitHub's command-line tool

```sh
brew install gh
```

Then authenticate:

```sh
gh auth login
```

Follow the prompts: pick **GitHub.com**, **HTTPS**, **Login with a web
browser**. Copy the one-time code it shows, press Return, paste the
code into the browser window that opens, and approve. Done.

Confirm:

```sh
gh auth status
```

You should see `Logged in to github.com account <your-username>`.

---

## 2. Get the project

If you cloned this repository from someone else's GitHub:

```sh
cd ~/Documents
gh repo clone <their-username>/rt60-web
cd rt60-web
```

If you're starting from a folder you already have on disk (e.g.
copied from a USB drive), skip the clone and just `cd` into it:

```sh
cd "/path/to/your/rt60-web"
```

---

## 3. Run it locally

Inside the project folder:

```sh
npm install
```

This downloads the JavaScript dependencies. Takes a couple of minutes
the first time; subsequent runs are instant.

Then:

```sh
npm run dev
```

A line like `Local: http://localhost:5173/` appears. **⌘ click** that
link to open the app in your default browser.

> **Note**: microphone access on iPhone requires HTTPS. The local
> dev server runs over plain HTTP, so for **real-device microphone
> testing** you'll use the deployed GitHub Pages URL (next step).
> The dev server is fine for desktop UI work and DSP testing.

To stop the dev server, press **Ctrl C** in the Terminal.

To run the unit tests:

```sh
npm test
```

You should see `36 tests passed`. If anything fails, something in the
project files is broken.

---

## 4. Deploy to GitHub Pages

### 4.1 Push the project to your own GitHub repository

If the repo doesn't already live on your account:

```sh
gh repo create rt60-web --public --source=. --remote=origin --push
```

Make it **public** — GitHub Pages on private repos requires a paid plan.
The source is visible to anyone but contains no secrets, and the live
app is yours to use however you like.

If the repo already exists on your account and is just being moved or
re-pushed, use:

```sh
git push origin main
```

### 4.2 Enable GitHub Pages

```sh
gh api -X POST "repos/<your-username>/rt60-web/pages" -f "build_type=workflow"
```

Replace `<your-username>` with your GitHub username. You should see a
JSON response confirming the Pages site, including an `html_url` like
`https://<your-username>.github.io/rt60-web/`.

### 4.3 Wait for the first deploy

The repo includes a GitHub Actions workflow at
`.github/workflows/deploy.yml` that automatically builds and deploys
the app on every push to `main`. The push you just did kicks it off.

Watch it run:

```sh
gh run watch
```

Look for `✓ deploy in Xs`. The whole thing takes about a minute.

Visit `https://<your-username>.github.io/rt60-web/` in any browser to
confirm the live app loads.

### 4.4 Update the Vite base path (if your repo name isn't `rt60-web`)

Open `vite.config.ts`. Find the line:

```ts
base: command === 'build' ? '/rt60-web/' : '/',
```

If your repo is named differently, change `/rt60-web/` to match (e.g.
`/my-repo-name/`). Save, then push the change:

```sh
git add vite.config.ts
git commit -m "Update base path"
git push
```

---

## 5. Install the app on your iPhone

Now that the live URL exists:

1. Open **Safari** on your iPhone.
2. Visit `https://<your-username>.github.io/rt60-web/` — load it once
   over a real network connection (this triggers the service worker to
   cache everything for offline use).
3. Tap the **Share** button (square with up-arrow at the bottom of
   Safari).
4. Scroll down → **Add to Home Screen**.
5. Confirm the name "RT60" and tap **Add**.

You should now see an **RT60 icon** on your home screen — dark canvas
with **RT60** in white and **NVC** in teal. Tap it.

The app opens **fullscreen** (no Safari address bar, no toolbar). It
behaves like a native app from this point onwards. To switch to it
later you can find it in App Switcher (swipe up from bottom).

### Test offline

- Enable **Airplane Mode**.
- Force-close the app (swipe up in App Switcher and swipe the RT60
  card up).
- Reopen the home-screen icon. The app **still loads and works** — the
  service worker has cached the entire bundle.

---

## 6. Updating the app

The deploy workflow runs on every push to `main`. So:

1. Edit the source files on your Mac.
2. In Terminal, in the project folder:

   ```sh
   git add -A
   git commit -m "Describe the change"
   git push
   ```
3. Wait ~1 minute. The next time your iPhone Safari (or the installed
   PWA) reloads, the new bundle is fetched silently — the service
   worker auto-updates in the background. No re-install needed.

If you don't see the change immediately, force the iPhone to clear its
cache:

- Hard reload in Safari: tap the address bar, retype the URL with a
  cache-buster like `?v=99`, press Go.
- Or close and reopen the home-screen icon, then close + reopen again.
- Or: **iOS Settings → Safari → Advanced → Website Data → swipe-delete
  jack-pitt.github.io**. Nuclear option (also deletes saved
  measurements). Only do this as a last resort.

---

## 7. Troubleshooting

### "command not found" after running `npm` or `node`

Homebrew probably didn't add Node to your PATH. Try:

```sh
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Then retry. To make this permanent, run:

```sh
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

and open a fresh Terminal window.

### `npm install` fails with permissions errors

Don't `sudo`. Re-run:

```sh
brew uninstall node
brew install node
```

Homebrew's Node install puts everything in your user space, so you
should never need sudo for `npm`.

### Build fails on GitHub Actions

Open `https://github.com/<your-username>/rt60-web/actions` in a
browser. Click the failed run. Click "build" → expand the failed step.
The error message points to the cause — usually:

- Missing dependency (`npm ci` step) → run `npm install` locally,
  commit the updated `package-lock.json`, push.
- TypeScript error (`tsc -b` step) → run `npm run build` locally to
  reproduce; the error message tells you the file and line.

### iPhone says "Can't access microphone"

- Confirm you're on **the deployed `https://...` URL**, not the dev
  server. Microphone needs HTTPS on iOS.
- Settings → Safari → Advanced → Experimental Features → confirm
  WebRTC isn't disabled.
- Settings → Safari → Camera & Microphone → set to **Ask** (not Deny).
- Reload the page; the mic-permission prompt should appear when you
  tap **Enable mic**.

### App doesn't update after a push

- Check `gh run list` to confirm the deploy actually ran.
- The service worker may be holding a stale bundle. Force-refresh as
  described above (cache-buster URL or close-and-reopen). On modern
  iOS the service worker's auto-update kicks in within a minute of
  the next launch.

### Deleted a saved measurement by mistake

There's no undo. Saved measurements are local to the device only;
nothing is recoverable from a server. Use **Export CSV** from the
Records tab regularly if you want a paper trail.

### Want to start over from scratch

```sh
cd ..
rm -rf rt60-web
gh repo delete <your-username>/rt60-web --yes
```

(That deletes both the local copy and the GitHub repo. Then re-clone /
re-create.)

---

## Where to next

- [VALIDATION.md](./VALIDATION.md) — the protocol for cross-checking
  the app against your Type 1 meter. **Do this before relying on
  results in a real assessment.**
- [README.md](./README.md) — overview of the project structure, the
  signal-processing pipeline, and known limitations.
