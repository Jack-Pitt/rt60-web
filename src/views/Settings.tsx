// Settings view: decay duration, INR thresholds, enabled bands.
// Step 1 is a placeholder; real controls land in later steps once
// the DSP pipeline is in place and the values are wired through.
export default function Settings() {
  return (
    <div className="view view-settings">
      <h2>Settings</h2>
      <p className="view-stub">
        Decay duration, INR thresholds, and band selection go here.
      </p>
    </div>
  )
}
