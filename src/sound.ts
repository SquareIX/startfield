// Soft synthesized sound kit (Web Audio API, no audio files).
// Everything is sine tones and filtered noise at low volume — airy
// whooshes and faint chimes, never beeps. Browsers block audio before
// the first user gesture, so the context is created lazily by
// ensureAudio() on first interaction and stays silent until then.
// All output runs through one master gain for the mute toggle.

let context: AudioContext | null = null
let master: GainNode | null = null
let humStarted = false
let noiseBuffer: AudioBuffer | null = null
let muted = false

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  if (context && master) {
    master.gain.setTargetAtTime(muted ? 0 : 0.5, context.currentTime, 0.06)
  }
}

export function ensureAudio(): void {
  if (typeof window === 'undefined') return
  if (!context) {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    context = new AudioContextClass()
    master = context.createGain()
    master.gain.value = muted ? 0 : 0.5
    master.connect(context.destination)
    startHum()
  }
  if (context.state === 'suspended') void context.resume()
}

function getNoiseBuffer(): AudioBuffer | null {
  if (!context) return null
  if (!noiseBuffer) {
    noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

function startHum(): void {
  if (!context || !master || humStarted) return
  humStarted = true
  // Warm low drone, barely audible, slowly breathing.
  const humGain = context.createGain()
  humGain.gain.value = 0.007
  const lfo = context.createOscillator()
  lfo.frequency.value = 0.06
  const lfoGain = context.createGain()
  lfoGain.gain.value = 0.003
  lfo.connect(lfoGain)
  lfoGain.connect(humGain.gain)
  for (const frequency of [48, 96.5]) {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency
    osc.connect(humGain)
    osc.start()
  }
  lfo.start()
  humGain.connect(master)
  // Faint room air: looped noise through a low lowpass.
  const buffer = getNoiseBuffer()
  if (buffer) {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 320
    const airGain = context.createGain()
    airGain.gain.value = 0.0035
    source.connect(filter)
    filter.connect(airGain)
    airGain.connect(master)
    source.start()
  }
}

function tone(
  frequency: number,
  duration: number,
  volume: number,
  delay = 0,
  attack = 0.02,
): void {
  if (!context || !master || muted) return
  const start = context.currentTime + delay
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

function noiseBurst(
  duration: number,
  volume: number,
  filterType: BiquadFilterType,
  freqFrom: number,
  freqTo: number,
  delay = 0,
  q = 1,
): void {
  if (!context || !master || muted) return
  const buffer = getNoiseBuffer()
  if (!buffer) return
  const start = context.currentTime + delay
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = filterType
  filter.Q.value = q
  filter.frequency.setValueAtTime(freqFrom, start)
  filter.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), start + duration)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(master)
  source.start(start, Math.random())
  source.stop(start + duration + 0.05)
}

export function playClick(): void {
  noiseBurst(0.04, 0.018, 'highpass', 1600, 1600, 0, 0.7)
  tone(1350, 0.05, 0.006, 0, 0.005)
}

export function playSlideChange(): void {
  noiseBurst(0.45, 0.022, 'bandpass', 280, 1900, 0, 0.8)
  tone(1174, 0.5, 0.01, 0.06, 0.08)
}

export function playAssemble(): void {
  tone(392, 0.7, 0.014, 0, 0.12)
  tone(587, 0.7, 0.014, 0.09, 0.12)
  tone(784, 0.7, 0.014, 0.18, 0.12)
}

export function playRunComplete(): void {
  tone(523.25, 0.9, 0.018, 0, 0.03)
  tone(783.99, 0.9, 0.018, 0.12, 0.03)
}
