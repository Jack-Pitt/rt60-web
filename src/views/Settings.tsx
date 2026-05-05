import { useSettings } from '../settings/SettingsContext'
import { BANDS } from '../dsp/bands'

// Settings view — decay duration, INR thresholds, trigger threshold,
// and which bands are enabled for analysis. All values persist to
// localStorage via SettingsContext.
export default function Settings() {
  const { settings, setSettings, reset } = useSettings()

  function update<K extends keyof typeof settings>(key: K, value: typeof settings[K]) {
    setSettings({ ...settings, [key]: value })
  }

  function toggleBand(centre: number) {
    const enabled = settings.enabledBandCentres
    const next = enabled.includes(centre)
      ? enabled.filter((c) => c !== centre)
      : [...enabled, centre].sort((a, b) => a - b)
    update('enabledBandCentres', next)
  }

  function setBandRange(min: number, max: number) {
    update(
      'enabledBandCentres',
      BANDS.filter((b) => b.centre >= min && b.centre <= max).map((b) => b.centre),
    )
  }

  return (
    <div className="view view-settings">
      <h2>Settings</h2>

      <section className="settings-section">
        <label className="settings-label">
          Decay capture window (seconds)
          <input
            type="number"
            min={3}
            max={10}
            step={0.5}
            value={settings.decayDurationSec}
            onChange={(e) =>
              update('decayDurationSec', clamp(Number(e.target.value), 3, 10))
            }
          />
        </label>
        <p className="muted">How long to record after the impulse triggers. 3–10 s.</p>
      </section>

      <section className="settings-section">
        <label className="settings-label">
          Trigger threshold (dB above background)
          <input
            type="number"
            min={6}
            max={60}
            step={1}
            value={settings.triggerThresholdDb}
            onChange={(e) =>
              update('triggerThresholdDb', clamp(Number(e.target.value), 6, 60))
            }
          />
        </label>
        <p className="muted">
          Impulse is detected when any sample is this many dB above the just-measured
          background RMS. Default 30 dB.
        </p>
      </section>

      <section className="settings-section">
        <h3>INR thresholds (dB)</h3>
        <p className="muted">
          Decision logic per band: T30 if INR ≥ T30 threshold; otherwise T20 if
          ≥ T20 threshold; otherwise EDT-only if ≥ EDT threshold; otherwise invalid.
        </p>
        <label className="settings-label">
          T30 minimum
          <input
            type="number"
            min={10}
            max={80}
            step={1}
            value={settings.inrThresholds.t30}
            onChange={(e) =>
              update('inrThresholds', { ...settings.inrThresholds, t30: Number(e.target.value) })
            }
          />
        </label>
        <label className="settings-label">
          T20 minimum
          <input
            type="number"
            min={10}
            max={80}
            step={1}
            value={settings.inrThresholds.t20}
            onChange={(e) =>
              update('inrThresholds', { ...settings.inrThresholds, t20: Number(e.target.value) })
            }
          />
        </label>
        <label className="settings-label">
          EDT-only minimum
          <input
            type="number"
            min={5}
            max={80}
            step={1}
            value={settings.inrThresholds.edtOnly}
            onChange={(e) =>
              update('inrThresholds', { ...settings.inrThresholds, edtOnly: Number(e.target.value) })
            }
          />
        </label>
      </section>

      <section className="settings-section">
        <h3>Enabled bands</h3>
        <p className="muted">{settings.enabledBandCentres.length} of {BANDS.length} bands enabled.</p>
        <div className="band-quick-buttons">
          <button onClick={() => setBandRange(50, 10000)}>All</button>
          <button onClick={() => setBandRange(125, 5000)}>125 Hz – 5 kHz (mic-reliable)</button>
          <button onClick={() => setBandRange(250, 4000)}>250 Hz – 4 kHz (speech)</button>
          <button onClick={() => update('enabledBandCentres', [])}>None</button>
        </div>
        <div className="band-grid">
          {BANDS.map((b) => {
            const on = settings.enabledBandCentres.includes(b.centre)
            return (
              <button
                key={b.centre}
                className={`band-chip ${on ? 'on' : ''} ${b.uncertain ? 'uncertain' : ''}`}
                onClick={() => toggleBand(b.centre)}
              >
                {formatHz(b.centre)}
              </button>
            )
          })}
        </div>
      </section>

      <button className="primary-btn primary-btn-stop" onClick={reset}>
        Reset all to defaults
      </button>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} k` : `${hz}`
}
