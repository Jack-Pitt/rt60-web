import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites under https://<user>.github.io/<repo>/.
// `base` makes Vite emit relative URLs that resolve against that subpath in
// production. For local `npm run dev` it stays at '/' so HMR works normally.
//
// VitePWA wires up Workbox-powered service worker generation and a Web App
// Manifest so the app can be installed to the iPhone home screen and used
// fully offline after the first load.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' silently swaps in new bundles when the user reloads
      // after a deploy — the user just gets the latest version next time
      // they open the app, no prompt required.
      registerType: 'autoUpdate',
      // Inject the SW registration into index.html automatically so we
      // don't have to touch main.tsx.
      injectRegister: 'auto',
      // Files to include in the precache manifest beyond the bundled JS/CSS.
      // The audio worklet file (?url-imported) is bundled with a hash and
      // gets picked up automatically; we just need the static favicon.
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'RT60 — NVC Acoustic Measurement',
        short_name: 'RT60',
        description:
          'On-site reverberation time (RT60) measurement triage tool by NVC.',
        // Status-bar tint when the app is foregrounded (matches our --color-bg).
        theme_color: '#0e1014',
        // iOS splash-screen background while the app is loading.
        background_color: '#0e1014',
        // Fullscreen, no Safari chrome — feels native after Add to Home Screen.
        display: 'standalone',
        // Allow either orientation so iPad / large iPhones / desktop
        // browsers in landscape don't get force-rotated.
        orientation: 'any',
        // Both scope and start_url honour the GitHub Pages subpath; Vite
        // injects the correct base via the `base` setting below.
        scope: './',
        start_url: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache everything the build emits + the small static set.
        // The user can take a measurement, save it, view the saved
        // results, and export — all without a network connection.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Vite emits hashed filenames so cache keys are content-versioned;
        // we don't need fancy runtime strategies.
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Disable SW in dev mode — HMR + SW caching makes for a confusing
        // dev loop. The PWA runs only on the production build.
        enabled: false,
      },
    }),
  ],
  base: command === 'build' ? '/rt60-web/' : '/',
}))
