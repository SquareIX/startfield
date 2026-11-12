// Tiny synthesized sound kit (Web Audio API, no audio files).
// Browsers block audio before the first user gesture, so the context is
// created lazily by ensureAudio() on first interaction and stays silent
// until then. Everything runs through one master gain for the mute toggle.

let context: AudioContext | null = null
let master: GainNode | null = null
let humStarted = false
let muted = false

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  if (context && master) {
    master.gain.setTargetAtTime(muted ? 0 : 0.9, context.currentTime, 0.06)
  }
}

export function ensureAudio(): void {
  if (typeof window === 'undefined') return
  if (!context) {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    context = new AudioContextClass()
    master = context.createGain()
    master.gain.value = muted ? 0 : 0.9
    master.connect(context.destination)
    startHum()
  }
  if (context.state === 'suspended') void context.resume()
}

function startHum(): void {
  if (!context || !master || humStarted) return
  humStarted = true
  const humGain = context.createGain()
  humGain.gain.value = 0.011
  const lfo = context.createOscillator()
  lfo.frequency.value = 0.07
  const lfoGain = context.createGain()
  lfoGain.gain.value = 0.004
  lfo.connect(lfoGain)
  lfoGain.connect(humGain.gain)
  for (const frequency of [54, 54.6, 108.3]) {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency
    osc.connect(humGain)
    osc.start()
  }
  lfo.start()
  humGain.connect(master)
}

function tone(
  fromFreq: number,
  toFreq: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  delay = 0,
): void {
  if (!context || !master || muted) return
  const start = context.currentTime + delay
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(fromFreq, start)
  osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), start + duration)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

export function playClick(): void {
  tone(880, 620, 0.07, 0.035, 'triangle')
}

export function playSlideChange(): void {
  tone(520, 190, 0.16, 0.045, 'triangle')
  tone(1040, 780, 0.1, 0.02, 'sine', 0.05)
}

export function playAssemble(): void {
  tone(660, 660, 0.12, 0.03, 'sine', 0)
  tone(880, 880, 0.12, 0.03, 'sine', 0.07)
  tone(1320, 1320, 0.16, 0.028, 'sine', 0.14)
}

export function playRunComplete(): void {
  tone(523, 523, 0.12, 0.04, 'sine', 0)
  tone(784, 784, 0.2, 0.04, 'sine', 0.1)
}
