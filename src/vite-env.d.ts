/// <reference types="vite/client" />

// Compile-time constants injected via vite.config.ts `define` block.
// Read from package.json + build date so the Settings footer can show
// a single source of truth without hardcoding numbers in the source.
declare const __APP_VERSION__: string
declare const __APP_BUILD_DATE__: string
