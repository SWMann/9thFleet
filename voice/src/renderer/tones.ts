/** Short local tones. They play on this PC only and are never transmitted. */

function tone(audio: AudioContext, frequency: number, startIn: number, length: number, level: number): void {
  const start = audio.currentTime + startIn;
  const oscillator = new OscillatorNode(audio, { type: 'sine', frequency });
  const gain = new GainNode(audio, { gain: 0 });
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.005);
  gain.gain.setValueAtTime(level, start + length - 0.01);
  gain.gain.linearRampToValueAtTime(0, start + length);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

/** "Your microphone is live, speak now." */
export function permitTone(audio: AudioContext): void {
  tone(audio, 1200, 0, 0.05, 0.08);
}

/** "That press was refused": the other net is transmitting, or the app is not connected. */
export function refusedTone(audio: AudioContext): void {
  tone(audio, 320, 0, 0.09, 0.12);
  tone(audio, 320, 0.13, 0.09, 0.12);
}

/** "The app cut your transmission": time limit or lost link. */
export function cutTone(audio: AudioContext): void {
  tone(audio, 660, 0, 0.12, 0.12);
  tone(audio, 440, 0.14, 0.18, 0.12);
}
