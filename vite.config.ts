import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites under https://<user>.github.io/<repo>/.
// `base` makes Vite emit relative URLs that resolve against that subpath in
// production. For local `npm run dev` it stays at '/' so HMR works normally.
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/rt60-web/' : '/',
}))
