// The music as numbers, from the tap's two loudnesses (src-tauri/src/vibe.rs sends them thirty times a second):
// env (how loud, smoothed), beat (a pulse on each beat of the low end), beats (counted), bar (a quarter turn a beat).
// Shared by the face (vibe.ts) and the glow window (glow.ts), each with its own instance.
export class Beat {
  env = 0; beat = 0; beats = 0; bar = 0;
  heard = -1e9;
  private target = 0; private lowAvg = 0; private lastBeat = -1e9; private barTarget = 0;
  static level(rms: number) { return Math.min(1, Math.sqrt(rms) * 1.6); }   // speech uses 1.8 (state.ts); music is denser
  hear(full: number, low: number, now = performance.now()) {
    this.heard = now;
    this.target = Beat.level(full);
    // a beat: the low end jumps over its recent mean (about half a second of it); one every 250 ms at most
    this.lowAvg += (low - this.lowAvg) * 0.06;
    if (low > this.lowAvg * 1.45 + 0.004 && now - this.lastBeat > 250 && this.target > 0.08) {
      this.lastBeat = now; this.beat = 1; this.beats++; this.barTarget += 0.25;
    }
  }
  /** nothing heard for a while: the helper is gone or asleep */
  silent(now: number) { return now - this.heard > 1500; }
  tick(dt: number, now: number) {
    const t = this.silent(now) ? 0 : this.target;
    this.env += (t - this.env) * (1 - Math.pow(0.001, dt / 0.12));
    this.beat *= Math.pow(0.02, dt / 0.25);
    if (this.beat < 0.01) this.beat = 0;
    this.bar += (this.barTarget - this.bar) * (1 - Math.pow(0.001, dt / 0.35));
  }
}
