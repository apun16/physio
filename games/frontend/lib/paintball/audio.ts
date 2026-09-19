export class AudioManager {
  private context: AudioContext | null = null;

  private ensure() {
    if (this.context) return this.context;
    const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }

  resume() {
    void this.ensure()?.resume();
  }

  dispose() {
    void this.context?.close();
    this.context = null;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gain = 0.07, slide = 0) {
    const context = this.ensure();
    if (!context) return;
    const oscillator = context.createOscillator();
    const amp = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), context.currentTime + duration);
    amp.gain.setValueAtTime(gain, context.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(amp).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  shoot() {
    this.tone(240, 0.1, "square", 0.06, -160);
    this.tone(90, 0.12, "sine", 0.04, -30);
  }

  hit() {
    this.tone(620, 0.09, "triangle", 0.06, 140);
  }

  miss() {
    this.tone(150, 0.08, "sine", 0.035, -90);
  }

  dodge() {
    this.tone(510, 0.1, "triangle", 0.05, 180);
  }

  hurt() {
    this.tone(120, 0.2, "sawtooth", 0.07, -50);
  }

  wave() {
    this.tone(340, 0.16, "square", 0.05, 200);
  }

  over() {
    this.tone(170, 0.38, "triangle", 0.06, -110);
  }
}
