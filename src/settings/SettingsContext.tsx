import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { BANDS } from '../dsp/bands'
import { DEFAULT_INR_THRESHOLDS } from '../dsp/analyze'

// App-wide measurement settings.
// Persisted in localStorage so they survive a refresh on the iPhone.

export interface Settings {
  /** Length of the decay capture window in seconds. Brief: 3-10, default 6. */
  decayDurationSec: number
  /** Trigger threshold in dB above the measured background RMS. Brief: ~30. */
  triggerThresholdDb: number
  /** INR thresholds used by the decision logic. Per-metric, all in dB. */
  inrThresholds: { t30: number; t20: number; edtOnly: number }
  /** R-squared below which a band's regression is flagged "non-linear". */
  nonLinearR2Threshold: number
  /** Set of band centre frequencies (Hz) that are enabled for analysis. */
  enabledBandCentres: number[]
}

export const DEFAULT_SETTINGS: Settings = {
  decayDurationSec: 6,
  triggerThresholdDb: 30,
  inrThresholds: { ...DEFAULT_INR_THRESHOLDS },
  nonLinearR2Threshold: 0.95,
  enabledBandCentres: BANDS.map((b) => b.centre),
}

const STORAGE_KEY = 'rt60.settings.v1'

interface Ctx {
  settings: Settings
  setSettings: (next: Settings) => void
  reset: () => void
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Load once on mount. We accept partial saved state and fill in any
  // missing fields from defaults, so older saved settings won't crash
  // the app after we add new fields.
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())

  // Persist whenever settings change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // localStorage may be disabled (private mode etc) — ignore.
    }
  }, [settings])

  const setSettings = useCallback((next: Settings) => setSettingsState(next), [])
  const reset = useCallback(() => setSettingsState(DEFAULT_SETTINGS), [])

  return (
    <SettingsContext.Provider value={{ settings, setSettings, reset }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      decayDurationSec: clamp(parsed.decayDurationSec ?? DEFAULT_SETTINGS.decayDurationSec, 3, 10),
      triggerThresholdDb: clamp(parsed.triggerThresholdDb ?? DEFAULT_SETTINGS.triggerThresholdDb, 6, 60),
      inrThresholds: {
        t30: parsed.inrThresholds?.t30 ?? DEFAULT_SETTINGS.inrThresholds.t30,
        t20: parsed.inrThresholds?.t20 ?? DEFAULT_SETTINGS.inrThresholds.t20,
        edtOnly: parsed.inrThresholds?.edtOnly ?? DEFAULT_SETTINGS.inrThresholds.edtOnly,
      },
      nonLinearR2Threshold:
        parsed.nonLinearR2Threshold ?? DEFAULT_SETTINGS.nonLinearR2Threshold,
      enabledBandCentres:
        Array.isArray(parsed.enabledBandCentres) && parsed.enabledBandCentres.length > 0
          ? parsed.enabledBandCentres
          : DEFAULT_SETTINGS.enabledBandCentres,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
