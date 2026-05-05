// AudioWorkletProcessor that runs on the dedicated audio thread.
//
// The browser calls process() every 128 samples (about 2.7 ms at 48 kHz).
// We do two things per call:
//   1) Copy the input samples into a Float32Array and post them back to
//      the main UI thread, where they get appended to a recording buffer
//      and shown in the waveform display.
//   2) Track whether any sample hit the digital ceiling (+/- 1.0). That
//      flag is included in the message so the UI can warn about clipping
//      on the impulse later.
//
// We use AudioWorkletNode (not the deprecated ScriptProcessorNode) per
// the project brief.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // When the main thread sends { type: 'stop' } we set this so process()
    // returns false and the node is shut down by the engine.
    this._stopped = false
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this._stopped = true
    }
  }

  process(inputs) {
    if (this._stopped) return false

    // We only care about channel 0 (mono capture).
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true

    // Detect clipping in this block. A sample at exactly +/- 1.0 (in the
    // float-normalised representation) means the analog-to-digital chain
    // ran out of headroom and the signal was hard-limited.
    let clipped = false
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i]
      if (s >= 1 || s <= -1) {
        clipped = true
        break
      }
    }

    // Float32Arrays cannot be transferred directly across the postMessage
    // boundary unless we send the underlying ArrayBuffer in the transfer
    // list. We copy first because the engine reuses the input buffer on
    // the next process() call.
    const copy = new Float32Array(channel.length)
    copy.set(channel)
    this.port.postMessage(
      { type: 'samples', samples: copy, clipped },
      [copy.buffer],
    )

    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
