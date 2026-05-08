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
            min={1}
            max={10}
            step={0.5}
            value={settings.decayDurationSec}
            onChange={(e) =>
              update('decayDurationSec', clamp(Number(e.target.value), 1, 10))
            }
          />
        </label>
        <p className="muted">How long to record after the impulse triggers. 1–10 s. Default 2 s — bump up if you're measuring a large reverberant room.</p>
      </section>

      <section className="settings-section">
        <label className="settings-label">
          RT spectrum plot — y-axis ceiling (s)
          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            value={settings.rtPlotMaxSec}
            onChange={(e) =>
              update('rtPlotMaxSec', clamp(Number(e.target.value), 1, 10))
            }
          />
        </label>
        <p className="muted">
          Maximum RT (in seconds) shown on the y-axis of the RT-vs-frequency
          plot. The axis still auto-scales below this — set higher only if
          you're measuring a large reverberant space.
        </p>
      </section>

      <section className="settings-section">
        <h3>Trigger threshold (dB above background)</h3>
        <p className="muted">
          Impulse is detected when any sample is this many dB above the just-measured
          background RMS. Default 30 dB.
        </p>
        <div className="threshold-chip-row">
          {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((db) => (
            <button
              key={db}
              type="button"
              className={`threshold-chip ${settings.triggerThresholdDb === db ? 'on' : ''}`}
              onClick={() => update('triggerThresholdDb', db)}
            >
              {db}
            </button>
          ))}
        </div>
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

      <section className="settings-section">
        <h3>Advanced</h3>
        <label className="settings-label settings-toggle">
          <input
            type="checkbox"
            checked={settings.enableJsonExport}
            onChange={(e) => update('enableJsonExport', e.target.checked)}
          />
          <span>Show JSON (raw) export option</span>
        </label>
        <p className="muted">
          Adds an "Export JSON" button alongside Export CSV in the History
          select bar. JSON files include the raw per-band Schroeder decay
          curves so the data can be re-plotted in Python or other tools
          without re-recording. Files are large (tens of MB per measurement)
          and only useful if you intend to do programmatic re-analysis.
        </p>
      </section>

      <button className="primary-btn primary-btn-stop" onClick={reset}>
        Reset all to defaults
      </button>

      {/* Version + build date stamped at build time from package.json
          and the deploy timestamp; "by Jack Pitt" credit. Footer is
          subtle so it doesn't compete with the controls above. */}
      <footer className="settings-footer">
        <div>
          RT60 <strong>v{__APP_VERSION__}</strong> · built {__APP_BUILD_DATE__}
        </div>
        <div>by Jack Pitt</div>
      </footer>
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
