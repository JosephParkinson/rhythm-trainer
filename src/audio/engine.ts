export type Voice = 'kick' | 'snare' | 'hat' | 'openhat';

/**
 * Owns the AudioContext: synthesised drum voices, metronome clicks, and the
 * mapping between event timestamps and audible time.
 *
 * Anything scheduled for later goes through a bus that cancelScheduled()
 * swaps out, so stopping never leaves stray sounds queued.
 */
export class Engine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private readonly out: GainNode;
  private scheduled: GainNode;
  private readonly noise: AudioBuffer;
  private openHat: GainNode | null = null;

  constructor() {
    this.out = new GainNode(this.ctx, { gain: 0.8 });
    this.out.connect(this.ctx.destination);
    this.scheduled = this.makeBus();

    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, len);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get now() {
    return this.ctx.currentTime;
  }

  /**
   * Converts a performance.now()-based timestamp (KeyboardEvent / MIDIMessageEvent
   * timeStamp) to the AudioContext time that was audible at that moment, so
   * comparing it with scheduled times cancels out output latency.
   */
  heardTime(perfMs: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts?.contextTime && ts.performanceTime) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    const latency = (this.ctx.outputLatency || 0) + this.ctx.baseLatency;
    return this.ctx.currentTime - latency - (performance.now() - perfMs) / 1000;
  }

  /** Silences everything scheduled but not yet played. */
  cancelScheduled() {
    this.scheduled.disconnect();
    this.scheduled = this.makeBus();
  }

  click(t: number, accent: boolean) {
    this.tone('square', accent ? 1600 : 1000, t, accent ? 0.22 : 0.13, 0.04, this.scheduled);
  }

  /** Pure 1 kHz burst with a hard attack, easy to find in a mic recording. */
  calClick(t: number) {
    this.tone('sine', 1000, t, 0.5, 0.03, this.scheduled);
  }

  /** Plays a voice now. `vel` is 0–1. */
  trigger(voice: Voice, vel = 1) {
    this.play(voice, this.ctx.currentTime, vel, this.out);
  }

  /** Plays a voice at a future time; cancelled by cancelScheduled(). */
  schedule(voice: Voice, t: number, vel = 1) {
    this.play(voice, t, vel, this.scheduled);
  }

  private play(voice: Voice, t: number, vel: number, dest: AudioNode) {
    const out = new GainNode(this.ctx, { gain: 0.15 + 0.85 * vel });
    out.connect(dest);
    if (voice === 'kick') this.kick(t, out);
    else if (voice === 'snare') this.snare(t, out);
    else this.hat(t, voice === 'openhat', out);
  }

  private makeBus() {
    const g = new GainNode(this.ctx);
    g.connect(this.out);
    return g;
  }

  /** Gain node that jumps to `peak` at t and decays exponentially. */
  private env(peak: number, t: number, decay: number, out: AudioNode) {
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    g.connect(out);
    return g;
  }

  private tone(type: OscillatorType, freq: number, t: number, peak: number, decay: number, out: AudioNode) {
    const o = new OscillatorNode(this.ctx, { type, frequency: freq });
    o.connect(this.env(peak, t, decay, out));
    o.start(t);
    o.stop(t + decay + 0.01);
    return o;
  }

  private noiseBurst(t: number, dur: number, highpass: number) {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s.connect(new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: highpass }));
  }

  private kick(t: number, out: AudioNode) {
    const o = this.tone('sine', 160, t, 1, 0.4, out);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  }

  private snare(t: number, out: AudioNode) {
    this.noiseBurst(t, 0.25, 1200).connect(this.env(0.6, t, 0.2, out));
    this.tone('triangle', 190, t, 0.5, 0.1, out);
  }

  private hat(t: number, open: boolean, out: AudioNode) {
    // Any new hat chokes a ringing open hat.
    if (this.openHat) {
      const p = this.openHat.gain;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
      else p.cancelScheduledValues(t);
      p.setTargetAtTime(0, t, 0.008);
      this.openHat = null;
    }
    const dur = open ? 0.4 : 0.06;
    const g = this.env(open ? 0.3 : 0.35, t, dur, out);
    this.noiseBurst(t, dur + 0.05, 7000).connect(g);
    if (open) this.openHat = g;
  }
}
