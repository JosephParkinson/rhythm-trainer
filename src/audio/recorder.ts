import type { Recording } from './analysis';

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  process(inputs) {
    const i = inputs[0];
    if (i.length === 2) this.port.postMessage([currentFrame, i[0].slice(), i[1].slice()]);
    return true;
  }
}
registerProcessor('rt-rec', Rec);
`;
const loaded = new WeakSet<BaseAudioContext>();

/** Opens the mic raw: echo cancellation would remove the speaker's test tone from the recording. */
function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

/**
 * Records the mic while `body` runs, then always releases it. `body` calls
 * `rec.finish()` to get the recording.
 */
export async function withMicRecording<T>(ctx: AudioContext, body: (rec: Recorder) => Promise<T>): Promise<T> {
  const stream = await openMic();
  let rec: Recorder | null = null;
  try {
    rec = await startRecorder(ctx, stream);
    return await body(rec);
  } finally {
    rec?.dispose();
    stream.getTracks().forEach((t) => t.stop());
  }
}

const POLL_MS = 50;

/** One step of a mic test's wait loop: throws if the test was cancelled, else waits briefly. */
export async function poll(cancelled: () => boolean) {
  if (cancelled()) throw new Error('CANCELLED');
  await new Promise((r) => setTimeout(r, POLL_MS));
}

export interface Recorder {
  /** Stops recording and returns everything captured. */
  finish(): Recording;
  /** Disconnects the graph (safe to call more than once). */
  dispose(): void;
}

/**
 * Records the mic on the AudioContext clock. Channel 0 is high-passed
 * (broadband onsets), channel 1 band-passed at 1 kHz (test tones). Each block
 * carries its context frame, so recording positions map to context times.
 */
async function startRecorder(ctx: AudioContext, stream: MediaStream): Promise<Recorder> {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    loaded.add(ctx);
  }

  const src = ctx.createMediaStreamSource(stream);
  const merge = ctx.createChannelMerger(2);
  src.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300 })).connect(merge, 0, 0);
  src.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 8 })).connect(merge, 0, 1);
  const rec = new AudioWorkletNode(ctx, 'rt-rec', {
    outputChannelCount: [1],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
  });
  const sink = new GainNode(ctx, { gain: 0 }); // keeps the worklet pulled
  merge.connect(rec).connect(sink).connect(ctx.destination);

  const blocks: [number, Float32Array, Float32Array][] = [];
  rec.port.onmessage = (e) => blocks.push(e.data);

  const dispose = () => {
    rec.port.onmessage = null;
    src.disconnect();
    sink.disconnect();
  };
  return {
    dispose,
    finish() {
      dispose();
      return stitch(blocks, ctx.sampleRate);
    },
  };
}

function stitch(blocks: [number, Float32Array, Float32Array][], sampleRate: number): Recording {
  if (!blocks.length) throw new Error('NO MIC INPUT');
  const startFrame = blocks[0][0];
  const last = blocks[blocks.length - 1];
  const len = last[0] + last[1].length - startFrame;
  const hp = new Float32Array(len);
  const bp = new Float32Array(len);
  for (const [frame, h, b] of blocks) {
    hp.set(h, frame - startFrame);
    bp.set(b, frame - startFrame);
  }
  return { hp, bp, sampleRate, startFrame };
}
