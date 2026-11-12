import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type * as Three from 'three'
import robotPointCloud from './assets/points/robot.points.b64?url'
import helmetPointCloud from './assets/points/helmet.points.b64?url'
import boomboxPointCloud from './assets/points/boombox.points.b64?url'
import drillPointCloud from './assets/points/drill.points.b64?url'
import { getCachedPointCloud, loadPointCloud, preloadEverything, type PointCloudData } from './points'
import { ensureAudio, isMuted, playAssemble, playClick, playRunComplete, playSlideChange, setMuted } from './sound'
import './App.css'

// Structural view of a mesh/points node for scene traversal: the three.js
// types put isMesh/isPoints on the concrete classes only, so the union
// type cannot be probed directly.
type DrawableObject = Three.Object3D & {
  isMesh?: boolean
  isPoints?: boolean
  geometry: Three.BufferGeometry
  material: Three.Material | Three.Material[]
}

type PointsUniforms = {
  uTime: { value: number }
  uGlitch: { value: number }
  uAssemble: { value: number }
  uYMin: { value: number }
  uYMax: { value: number }
  uSweepColor: { value: Three.Color }
}

type LiveModel = {
  group: Three.Group
  uniforms: PointsUniforms
  material: Three.PointsMaterial
  inT: number
  outT: number | null
  spinBoost: number
  baseScale: number
  restX: number
  restY: number
  restZ: number
}

type Mission = { id: string; goal: string; stage: string; status: 'running' | 'completed'; time: number }
type FeatureSlide = { id: string; name: string; role: string; eyebrow: string; title: [string, string, string]; description: string; quote: string; model: string; accent: string; signal: string }

const storageKey = 'ferrum-demo-runs-v1'
const themeKey = 'ferrum-theme-v1'
const featureSlides: FeatureSlide[] = [
  { id: 'core', name: 'Ferrum Core', role: 'ANDROID MULTI-TOOL', eyebrow: 'A RUST-POWERED TOOLBOX FOR ANDROID / 01', title: ['Every tool', 'for Android', 'in one place.'], description: 'Ferrum brings Android utilities together in one workbench: device inspection, file operations, network diagnostics, and routine automation.', quote: 'One fast workbench. Your Android, understood.', model: robotPointCloud, accent: '#b7e7c9', signal: 'ANDROID · RUST' },
  { id: 'device', name: 'Device Inspector', role: 'DEVICE DIAGNOSTICS', eyebrow: 'GET TO KNOW YOUR DEVICE / 02', title: ['Know your', 'device from', 'the inside.'], description: 'A concise summary of device info, storage, battery, and system status, so daily checkups feel fast and clear.', quote: 'The right details, right when you need them.', model: helmetPointCloud, accent: '#a9d6dc', signal: 'DEVICE · STATUS' },
  { id: 'network', name: 'Network Lab', role: 'NETWORK UTILITIES', eyebrow: 'SEE WHAT YOUR CONNECTION IS DOING / 03', title: ['Read the', 'signals around', 'your device.'], description: 'A set of network utilities to check your connection and understand what is happening around your device.', quote: 'Make every connection easier to understand.', model: boomboxPointCloud, accent: '#d8c7e8', signal: 'NETWORK · DIAGNOSTICS' },
  { id: 'automation', name: 'Automation Kit', role: 'REPEATABLE WORKFLOWS', eyebrow: 'LESS REPETITION, MORE MOMENTUM / 04', title: ['Make routine', 'operations', 'move faster.'], description: 'Turn repeated steps into a consistent workflow, then run it with the visibility still in your hands.', quote: 'Build a flow once. Make it yours every time.', model: drillPointCloud, accent: '#e1d6a0', signal: 'AUTOMATION · WORKFLOWS' },
]
const suggestions = ['Show device overview', 'Check storage usage', 'Run a network check']

function BootScreen({ progress, label, leaving }: { progress: number; label: string; leaving: boolean }) {
  return (
    <div className={`boot-screen${leaving ? ' is-leaving' : ''}`} role="status" aria-label="Loading Ferrum">
      <div className="boot-inner">
        <div className="boot-mark"><span className="ferrum-mark">Fe</span> FERRUM</div>
        <div className="boot-percent">{String(progress).padStart(3, '0')}<span>%</span></div>
        <div className="boot-bar"><i style={{ width: `${progress}%` }} /></div>
        <div className="boot-label"><span className="boot-flower">✳</span> {label}</div>
        <div className="boot-sub">POINT CLOUDS · WEBGL · LOCAL ONLY</div>
      </div>
    </div>
  )
}

function FlowerScene({ src, accent, label, lightMode, onInteractionChange, onModelReady }: { src: string; accent: string; label: string; lightMode: boolean; onInteractionChange: (active: boolean) => void; onModelReady?: () => void }) {
  const mount = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [glitching, setGlitching] = useState(false)
  // The scene mounts once and stays alive across slides; the render loop
  // picks up prop changes through this ref so transitions run inside the
  // same WebGL context instead of tearing the scene down per slide.
  const latest = useRef({ src, accent, lightMode, onInteractionChange, onModelReady })
  latest.current = { src, accent, lightMode, onInteractionChange, onModelReady }

  useEffect(() => {
    const hostNode = mount.current
    if (!hostNode) return
    const host: HTMLDivElement = hostNode
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let alive = true
    let frame = 0
    let renderer: Three.WebGLRenderer | undefined
    let scene: Three.Scene | undefined
    let resizeObserver: ResizeObserver | undefined
    let artifacts: Three.Group | undefined
    let rimLight: Three.PointLight | undefined
    let nodeMaterial: Three.MeshBasicMaterial | undefined
    let current: LiveModel | null = null
    let outgoing: LiveModel | null = null
    let currentSrc: string | null = null
    let pendingSrc: string | null = null
    let appliedLight: boolean | null = null
    let isGlitching = false
    let pointerActive = false
    let lastPointerX = 0
    let lastPointerY = 0

    const handlePointerDown = (event: PointerEvent) => {
      if (!current) return
      pointerActive = true
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      host.classList.add('is-dragging')
      host.setPointerCapture(event.pointerId)
      latest.current.onInteractionChange(true)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerActive || !current) return
      const deltaX = event.clientX - lastPointerX
      const deltaY = event.clientY - lastPointerY
      current.group.rotation.y += deltaX * 0.009
      current.group.rotation.x = Math.max(-0.8, Math.min(0.8, current.group.rotation.x + deltaY * 0.006))
      lastPointerX = event.clientX
      lastPointerY = event.clientY
    }
    const handlePointerUp = () => {
      pointerActive = false
      host.classList.remove('is-dragging')
      latest.current.onInteractionChange(false)
    }

    async function mountScene() {
      try {
        const THREE = await import('three')
        if (!alive) return

        scene = new THREE.Scene()
        const clock = new THREE.Clock()
        const camera = new THREE.PerspectiveCamera(20, 1, 1.1, 100)
        camera.position.set(0, 1, 10)
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 10.28
        renderer.setClearColor(0x000000, 0.2)
        renderer.domElement.setAttribute('aria-hidden', 'true')
        host.appendChild(renderer.domElement)

        scene.add(new THREE.HemisphereLight(0xc9ffe0, 0x18231c, 1.2))
        const keyLight = new THREE.DirectionalLight(0xfff7de, 1.2)
        keyLight.position.set(2.5, 3.4, 4)
        scene.add(keyLight)
        rimLight = new THREE.PointLight(0x8fe2c7, 14, 7)
        rimLight.color.set(latest.current.accent)
        rimLight.position.set(-2, 0.4, -2)
        scene.add(rimLight)

        artifacts = new THREE.Group()
        const crystalColors = [0x9ee5c3, 0xb9e7d5, 0xd7cf9b, 0x86bbac]
        for (let index = 0; index < 9; index += 1) {
          const angle = index / 9 * Math.PI * 2
          const size = 0.045 + (index % 3) * 0.014
          const geometry = index % 3 === 0
            ? new THREE.IcosahedronGeometry(size, 0)
            : index % 3 === 1
              ? new THREE.OctahedronGeometry(size * 1.2, 0)
              : new THREE.TetrahedronGeometry(size * 1.3, 0)
          const color = crystalColors[index % crystalColors.length]
          const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, metalness: 0.58, roughness: 0.24, wireframe: index % 3 === 0 })
          const crystal = new THREE.Mesh(geometry, material)
          crystal.position.set(Math.cos(angle) * 0.78, Math.sin(angle * 1.7) * 0.72, Math.sin(angle) * 0.62)
          crystal.rotation.set(angle, angle * 0.7, angle * 0.3)
          artifacts.add(crystal)
        }
        nodeMaterial = new THREE.MeshBasicMaterial({ color: latest.current.accent, transparent: true, opacity: 0.7 })
        for (let index = 0; index < 18; index += 1) {
          const angle = index / 18 * Math.PI * 2
          const node = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), nodeMaterial)
          node.position.set(Math.cos(angle) * 0.94, Math.sin(angle * 2) * 0.9, Math.sin(angle) * 0.54)
          artifacts.add(node)
        }
        scene.add(artifacts)

        const resize = () => {
          if (!alive) return
          const width = host.clientWidth
          const height = host.clientHeight
          if (!width || !height || !renderer) return
          camera.aspect = width / height
          camera.position.z = width < 520 ? 4.15 : 3.6
          camera.updateProjectionMatrix()
          renderer.setSize(width, height, false)
        }
        resize()
        resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)

        host.addEventListener('pointerdown', handlePointerDown)
        host.addEventListener('pointermove', handlePointerMove)
        host.addEventListener('pointerup', handlePointerUp)
        host.addEventListener('pointercancel', handlePointerUp)

        const disposeLive = (live: LiveModel) => {
          scene?.remove(live.group)
          live.group.traverse((object) => {
            const drawable = object as DrawableObject
            if (!drawable.isPoints && !drawable.isMesh) return
            drawable.geometry.dispose()
            const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
            materials.forEach((material) => material.dispose())
          })
        }

        // Additive glow is invisible on a light page, so light mode renders
        // the same points with normal blending and a darkened color.
        const applyThemeToLive = (live: LiveModel, light: boolean) => {
          live.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending
          live.material.color.set(light ? 0x3a3f3a : 0xffffff)
          live.material.opacity = light ? 0.9 : 0.95
          live.material.needsUpdate = true
          const sweep = new THREE.Color(latest.current.accent)
          if (light) sweep.multiplyScalar(0.45)
          live.uniforms.uSweepColor.value.copy(sweep)
        }

        const applyTheme = (light: boolean) => {
          renderer?.setClearColor(light ? 0xffffff : 0x000000, light ? 0.12 : 0.2)
          if (current) applyThemeToLive(current, light)
          if (outgoing) applyThemeToLive(outgoing, light)
        }

        const buildLiveModel = (cloud: PointCloudData, accentValue: string): LiveModel => {
          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
          geometry.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3))
          const scatter = new Float32Array(cloud.count * 3)
          const delays = new Float32Array(cloud.count)
          for (let i = 0; i < cloud.count; i += 1) {
            const theta = Math.random() * Math.PI * 2
            const phi = Math.acos(2 * Math.random() - 1)
            const radius = 0.55 + Math.random() * 1.05
            scatter[i * 3] = Math.sin(phi) * Math.cos(theta) * radius
            scatter[i * 3 + 1] = Math.cos(phi) * radius * 0.8
            scatter[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius
            delays[i] = Math.random()
          }
          geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3))
          geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1))
          const uniforms: PointsUniforms = {
            uTime: { value: 0 },
            uGlitch: { value: 0 },
            uAssemble: { value: reducedMotion ? 1 : 0 },
            uYMin: { value: cloud.min[1] },
            uYMax: { value: cloud.min[1] + cloud.size[1] },
            uSweepColor: { value: new THREE.Color(accentValue) },
          }
          const material = new THREE.PointsMaterial({
            vertexColors: true,
            size: 0.016,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
          material.toneMapped = false
          material.userData.ferrumPoints = true
          material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms)
            shader.vertexShader = shader.vertexShader
              .replace('#include <common>', `#include <common>
                  attribute vec3 aScatter;
                  attribute float aDelay;
                  uniform float uTime;
                  uniform float uGlitch;
                  uniform float uAssemble;
                  uniform float uYMin;
                  uniform float uYMax;
                  varying float vSweep;
                  varying float vAssemble;`)
              .replace('#include <begin_vertex>', `#include <begin_vertex>
                  float ferrumAssemble = clamp(uAssemble * 1.35 - aDelay * 0.35, 0.0, 1.0);
                  ferrumAssemble = ferrumAssemble * ferrumAssemble * (3.0 - 2.0 * ferrumAssemble);
                  transformed = mix(transformed + aScatter, transformed, ferrumAssemble);
                  vAssemble = ferrumAssemble;
                  float ferrumSlice = step(0.91, sin(transformed.y * 74.0 + uTime * 18.0));
                  transformed.x += sin(uTime * 36.0 + transformed.y * 51.0) * 0.045 * uGlitch * ferrumSlice;
                  float ferrumYNorm = clamp((transformed.y - uYMin) / max(uYMax - uYMin, 0.0001), 0.0, 1.0);
                  vSweep = exp(-abs(ferrumYNorm - fract(uTime * 0.12)) * 18.0);`)
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', `#include <common>
                  uniform vec3 uSweepColor;
                  varying float vSweep;
                  varying float vAssemble;`)
              .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                  float ferrumPointFade = smoothstep(0.5, 0.12, length(gl_PointCoord - vec2(0.5)));`)
              .replace('#include <color_fragment>', `#include <color_fragment>
                  diffuseColor.rgb += uSweepColor * vSweep * 0.55;
                  diffuseColor.a *= ferrumPointFade * (0.2 + 0.8 * vAssemble);`)
          }
          material.customProgramCacheKey = () => 'ferrum-points-v1'
          const drawable = new THREE.Points(geometry, material)
          const group = new THREE.Group()
          group.add(drawable)
          const bounds = new THREE.Box3().setFromObject(group)
          const center = bounds.getCenter(new THREE.Vector3())
          const size = bounds.getSize(new THREE.Vector3())
          const baseScale = 1.72 / Math.max(size.x, size.y, size.z)
          group.scale.setScalar(baseScale)
          group.position.set(-center.x, -center.y, -center.z)
          group.rotation.x = -0.08
          return {
            group,
            uniforms,
            material,
            inT: reducedMotion ? 1 : 0,
            outT: null,
            spinBoost: reducedMotion ? 0 : 2.4,
            baseScale,
            restX: -center.x,
            restY: -center.y,
            restZ: -center.z,
          }
        }

        const swapTo = (next: LiveModel, requestedSrc: string) => {
          if (!scene) return
          if (outgoing) disposeLive(outgoing)
          if (current) {
            outgoing = current
            outgoing.outT = 0
            outgoing.spinBoost = reducedMotion ? 0 : 3.2
          }
          current = next
          currentSrc = requestedSrc
          scene.add(next.group)
          applyThemeToLive(next, latest.current.lightMode)
          latest.current.onModelReady?.()
        }

        const showModel = (requestedSrc: string, accentValue: string) => {
          if (!scene) return
          if (requestedSrc === currentSrc) return
          if (requestedSrc === pendingSrc) return
          const cached = getCachedPointCloud(requestedSrc)
          if (!cached) {
            // Should not happen after the boot preload; fall back to a
            // silent on-demand load rather than showing a loading state.
            pendingSrc = requestedSrc
            void loadPointCloud(requestedSrc).then((cloud) => {
              pendingSrc = null
              if (!alive || !scene) return
              if (latest.current.src !== requestedSrc) return
              swapTo(buildLiveModel(cloud, latest.current.accent), requestedSrc)
            }).catch(() => {
              if (alive) setFailed(true)
            })
            return
          }
          swapTo(buildLiveModel(cached, accentValue), requestedSrc)
        }

        const render = () => {
          if (!renderer || !scene || !alive) return
          frame = window.requestAnimationFrame(render)
          const delta = Math.min(clock.getDelta(), 0.05)
          const phase = clock.elapsedTime % 9.5
          const glitchStrength = !reducedMotion && phase > 6.05 && phase < 6.62
            ? Math.sin(((phase - 6.05) / 0.57) * Math.PI) * 0.88
            : 0
          if ((glitchStrength > 0.08) !== isGlitching) {
            isGlitching = glitchStrength > 0.08
            setGlitching(isGlitching)
          }

          // Pick up slide / theme changes from React props.
          if (latest.current.src !== currentSrc && !pendingSrc) {
            showModel(latest.current.src, latest.current.accent)
          }
          if (appliedLight !== latest.current.lightMode) {
            appliedLight = latest.current.lightMode
            applyTheme(appliedLight)
          }
          rimLight?.color.set(latest.current.accent)
          nodeMaterial?.color.set(latest.current.accent)

          for (const live of [current, outgoing]) {
            if (!live) continue
            live.uniforms.uTime.value = clock.elapsedTime
            live.uniforms.uGlitch.value = glitchStrength
          }

          if (outgoing) {
            if (reducedMotion) {
              disposeLive(outgoing)
              outgoing = null
            } else {
              const t = Math.min(1, (outgoing.outT ?? 0) + delta / 0.45)
              outgoing.outT = t
              outgoing.uniforms.uAssemble.value = 1 - t
              outgoing.group.rotation.y += delta * outgoing.spinBoost
              outgoing.spinBoost *= Math.max(0, 1 - delta * 2)
              outgoing.group.scale.setScalar(outgoing.baseScale * (1 + t * 0.05))
              outgoing.material.opacity = (latest.current.lightMode ? 0.9 : 0.95) * (1 - t)
              if (t >= 1) {
                disposeLive(outgoing)
                outgoing = null
              }
            }
          }

          if (current) {
            if (current.inT < 1 && !reducedMotion) {
              current.inT = Math.min(1, current.inT + delta / 0.75)
              const eased = current.inT * current.inT * (3 - 2 * current.inT)
              current.uniforms.uAssemble.value = eased
              current.group.scale.setScalar(current.baseScale * (0.95 + 0.05 * eased))
            } else {
              current.uniforms.uAssemble.value = 1
            }
            if (!pointerActive && !reducedMotion) {
              current.group.rotation.y += delta * (0.16 + current.spinBoost * (1 - current.inT))
            }
            current.spinBoost *= Math.max(0, 1 - delta * 1.6)
            current.group.position.y = current.restY + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.45) * 0.025)
            current.group.position.x = current.restX + Math.sin(clock.elapsedTime * 34) * glitchStrength * 0.018
            current.group.position.z = current.restZ
          }
          if (artifacts && !reducedMotion) artifacts.rotation.y += delta * 0.08
          renderer.render(scene, camera)
        }
        render()
      } catch {
        if (alive) setFailed(true)
      }
    }

    void mountScene()

    return () => {
      alive = false
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      host.removeEventListener('pointerdown', handlePointerDown)
      host.removeEventListener('pointermove', handlePointerMove)
      host.removeEventListener('pointerup', handlePointerUp)
      host.removeEventListener('pointercancel', handlePointerUp)
      scene?.traverse((object) => {
        const drawable = object as DrawableObject
        if (drawable.isMesh || drawable.isPoints) {
          drawable.geometry.dispose()
          const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [])

  return <div className={`ferrum-canvas${glitching ? ' is-glitching' : ''}`} ref={mount} aria-label={`3D model of ${label}, draggable, with glitch effects`} role="img">
    {failed && <div className="model-loading"><span className="loading-flower">✳</span><span>MODEL UNAVAILABLE</span></div>}
  </div>
}

function readMissions(): Mission[] {
  try {
    const saved = window.localStorage.getItem(storageKey)
    return saved ? (JSON.parse(saved) as Mission[]) : []
  } catch {
    return []
  }
}

function App() {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [copyLeaving, setCopyLeaving] = useState(false)
  const [autoPlay, setAutoPlay] = useState(true)
  const [modelInteracting, setModelInteracting] = useState(false)
  const [missions, setMissions] = useState<Mission[]>(readMissions)
  const [goal, setGoal] = useState('')
  const [toast, setToast] = useState('')
  const [soundOn, setSoundOn] = useState(() => !isMuted())
  const [lightMode, setLightMode] = useState(() => window.localStorage.getItem(themeKey) === 'light')
  const [bootProgress, setBootProgress] = useState(0)
  const [bootLabel, setBootLabel] = useState('INITIALIZING')
  const [booted, setBooted] = useState(false)
  const [bootGone, setBootGone] = useState(false)
  const timers = useRef<number[]>([])
  const firstSlideRef = useRef(true)

  useEffect(() => {
    let alive = true
    const started = performance.now()
    preloadEverything(featureSlides.map((slide) => slide.model), (fraction, label) => {
      if (!alive) return
      setBootProgress(Math.round(fraction * 100))
      setBootLabel(label)
    }).then(() => {
      if (!alive) return
      // Keep the loader up briefly so it reads as a moment, not a flicker.
      const wait = Math.max(0, 900 - (performance.now() - started))
      window.setTimeout(() => {
        if (!alive) return
        setBooted(true)
        window.setTimeout(() => { if (alive) setBootGone(true) }, 550)
      }, wait)
    }).catch(() => {
      if (!alive) return
      setBooted(true)
      setBootGone(true)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const unlock = () => ensureAudio()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (firstSlideRef.current) {
      firstSlideRef.current = false
      return
    }
    playSlideChange()
  }, [activeSlideIndex])

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(missions))
  }, [missions])

  useEffect(() => {
    window.localStorage.setItem(themeKey, lightMode ? 'light' : 'dark')
  }, [lightMode])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  function updateMission(id: string, stage: string, status: Mission['status']) {
    setMissions((current) => current.map((mission) => mission.id === id ? { ...mission, stage, status, time: Date.now() } : mission))
  }

  function startMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedGoal = goal.trim()
    if (!trimmedGoal) return
    const id = window.crypto?.randomUUID?.() ?? String(Date.now())
    const mission: Mission = { id, goal: trimmedGoal, stage: 'Queued in local demo', status: 'running', time: Date.now() }
    setMissions((current) => [mission, ...current].slice(0, 8))
    setGoal('')
    setToast('Ferrum is starting a simulated tool run.')
    playClick()
    timers.current.push(window.setTimeout(() => updateMission(id, 'Checking module selection', 'running'), 900))
    timers.current.push(window.setTimeout(() => updateMission(id, 'Preparing local operation', 'running'), 1900))
    timers.current.push(window.setTimeout(() => updateMission(id, 'Running frontend simulation', 'running'), 3000))
    timers.current.push(window.setTimeout(() => {
      updateMission(id, 'Demo complete · preview ready', 'completed')
      setToast('Ferrum demo finished. The run is saved in this browser.')
      playRunComplete()
    }, 4100))
    timers.current.push(window.setTimeout(() => setToast(''), 6500))
  }

  function clearMissions() {
    setMissions([])
    setToast('Demo history cleared from this browser.')
    playClick()
    timers.current.push(window.setTimeout(() => setToast(''), 3500))
  }

  const activeCount = missions.filter((mission) => mission.status === 'running').length
  const activeSlide = featureSlides[activeSlideIndex]
  const handleModelInteraction = useCallback((active: boolean) => setModelInteracting(active), [])
  const handleModelReady = useCallback(() => playAssemble(), [])

  function toggleSound() {
    ensureAudio()
    const next = !soundOn
    setSoundOn(next)
    setMuted(!next)
    if (next) playClick()
  }

  function toggleTheme() {
    setLightMode((current) => !current)
    playClick()
  }

  // Slide changes run in two beats: the copy exits first (200ms), then the
  // slide swaps, so the new text arrives together with the model transition.
  function requestSlide(index: number) {
    const next = (index + featureSlides.length) % featureSlides.length
    if (next === activeSlideIndex || copyLeaving) return
    setCopyLeaving(true)
    timers.current.push(window.setTimeout(() => {
      setActiveSlideIndex(next)
      setCopyLeaving(false)
    }, 200))
  }

  useEffect(() => {
    if (!autoPlay || modelInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setTimeout(() => {
      requestSlide(activeSlideIndex + 1)
    }, 9500)
    return () => window.clearTimeout(timer)
  }, [activeSlideIndex, autoPlay, modelInteracting])

  function changeSlide(direction: number) {
    requestSlide(activeSlideIndex + direction)
  }

  return (
    <>
      {!bootGone && <BootScreen progress={bootProgress} label={bootLabel} leaving={booted} />}
      <main className={`min-h-screen overflow-hidden bg-[#08110f] text-[#f1f2ea] selection:bg-[#b7e7c9] selection:text-[#08110f]${lightMode ? ' theme-light' : ''}`}>
      <header className="relative z-20 mx-auto flex h-[78px] w-[min(1320px,calc(100%-48px))] items-center justify-between border-b border-white/10">
        <a href="#home" className="flex items-center gap-3 text-[13px] font-semibold tracking-[.24em] text-white no-underline"><span className="ferrum-mark">Fe</span> FERRUM<span className="hidden text-[8px] font-normal tracking-[.3em] text-white/40 sm:inline">ANDROID MULTI-TOOL</span></a>
        <nav className="hidden items-center gap-9 text-[9px] uppercase tracking-[.2em] text-white/55 md:flex"><a className="transition hover:text-[#c8efd4]" href="#platform">Platform</a><a className="transition hover:text-[#c8efd4]" href="#modules">Modules</a><a className="transition hover:text-[#c8efd4]" href="#workspace">Workspace</a></nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleTheme} aria-pressed={lightMode} className="border border-white/20 bg-transparent px-3 py-2.5 text-[9px] uppercase tracking-[.14em] text-white/60 transition hover:border-white/50 hover:text-white">{lightMode ? '☀ Light' : '☽ Dark'}</button>
          <button type="button" onClick={toggleSound} aria-pressed={soundOn} className="border border-white/20 bg-transparent px-3 py-2.5 text-[9px] uppercase tracking-[.14em] text-white/60 transition hover:border-white/50 hover:text-white">Sound {soundOn ? 'on' : 'off'}</button>
          <a href="#workspace" className="flex items-center gap-3 border border-[#a8d8b6]/50 px-4 py-2.5 text-[9px] uppercase tracking-[.14em] text-[#c8efd4] no-underline transition hover:bg-[#b7e7c9] hover:text-[#08110f]">Explore Ferrum <span>↗</span></a>
        </div>
      </header>

      <section id="home" className="ferrum-hero relative mx-auto grid min-h-[690px] w-[min(1320px,calc(100%-48px))] items-center gap-7 py-12 lg:grid-cols-[.92fr_1.08fr] lg:py-10" aria-label="Ferrum Android toolkit carousel" aria-roledescription="carousel" onKeyDown={(event) => { if (event.key === 'ArrowRight') changeSlide(1); if (event.key === 'ArrowLeft') changeSlide(-1) }}>
        <div className="ferrum-copy relative z-10 max-w-[590px]">
          <div key={activeSlide.id} className={`slide-copy${copyLeaving ? ' slide-copy-out' : ''}`} aria-live="polite">
            <div className="mb-7 flex items-center gap-3 text-[9px] uppercase tracking-[.24em] text-[#c8efd4]/75"><span className="pulse-dot" /> {activeSlide.eyebrow}</div>
            <h1 className="max-w-[700px] text-[clamp(54px,7.6vw,100px)] leading-[.9] font-medium tracking-[-.075em] text-[#f2f0e7]">{activeSlide.title[0]}<br /><span className="font-serif font-normal italic text-[#b7e7c9]">{activeSlide.title[1]}</span><br />{activeSlide.title[2]}</h1>
            <p className="mt-8 max-w-[440px] text-[13px] leading-7 text-white/55">{activeSlide.description}</p>
            <blockquote className="mt-5 border-l border-[#b7e7c9]/45 pl-3 font-serif text-[13px] italic text-white/55">“{activeSlide.quote}”</blockquote>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-5"><a onClick={() => setGoal(activeSlide.signal)} className="group flex items-center gap-8 bg-[#b7e7c9] px-5 py-3.5 text-[9px] font-bold uppercase tracking-[.14em] text-[#10221a] no-underline transition hover:bg-white" href="#workspace">Explore this module <span className="text-base transition group-hover:translate-x-1">→</span></a><a href="#platform" className="text-[9px] uppercase tracking-[.14em] text-white/55 no-underline hover:text-white">See the toolkit ↓</a></div>
          <div className="mt-10 flex items-center gap-6 border-t border-white/10 pt-5 text-[8px] uppercase tracking-[.16em] text-white/40"><span><b className="mr-2 text-white/80">01</b> Inspect</span><span className="text-[#b7e7c9]/60">→</span><span><b className="mr-2 text-white/80">02</b> Operate</span><span className="hidden text-[#b7e7c9]/60 sm:inline">→</span><span className="hidden sm:inline"><b className="mr-2 text-white/80">03</b> Automate</span></div>
        </div>

        <div className="ferrum-visual relative mx-auto grid h-[440px] w-full max-w-[660px] place-items-center lg:h-[590px]">
          <div className="visual-horizon" /><div className="visual-halo" />
          <div className="model-orbit model-orbit-one" /><div className="model-orbit model-orbit-two" /><div className="model-orbit model-orbit-three" />
          <svg className="hud-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="48" fill="none" stroke="#b7e7c9" strokeOpacity=".22" strokeWidth=".3" />
            <circle cx="50" cy="50" r="46.5" fill="none" stroke="#b7e7c9" strokeOpacity=".45" strokeWidth=".5" strokeDasharray="1.2 4.8" />
            <g className="hud-ring-spin">
              <circle cx="50" cy="50" r="44" fill="none" stroke="#b7e7c9" strokeOpacity=".8" strokeWidth=".5" strokeDasharray="14 264" />
              <circle cx="50" cy="6" r="1" fill="#b7e7c9" />
            </g>
          </svg>
          {booted && <FlowerScene src={activeSlide.model} accent={activeSlide.accent} label={activeSlide.name} lightMode={lightMode} onInteractionChange={handleModelInteraction} onModelReady={handleModelReady} />}
          <div className="visual-label visual-label-top"><span>✳</span><div>{activeSlide.name.toUpperCase()} / 0{activeSlideIndex + 1}<br /><b>{activeSlide.role}</b></div></div>
          <div className="visual-label visual-label-right"><span>0{activeSlideIndex + 1}</span><div>FERRUM MODULE<br /><b>DRAG TO ROTATE</b></div></div>
          <div className="hud-card hud-memory"><div className="hud-card-head"><span>01 / DEVICE MAP</span><b>LOCAL</b></div><svg viewBox="0 0 126 52" aria-hidden="true"><path d="M10 33 36 15 57 35 82 12 115 24M36 15l10 28 36-31 13 35" /><circle cx="10" cy="33" r="3" /><circle cx="36" cy="15" r="3" /><circle cx="57" cy="35" r="3" /><circle cx="82" cy="12" r="3" /><circle cx="115" cy="24" r="3" /><circle cx="46" cy="43" r="2" /><circle cx="96" cy="47" r="2" /></svg><span className="hud-card-foot">ANDROID TOOLCHAIN</span></div>
          <div className="hud-card hud-plan"><div className="hud-card-head"><span>02 / {activeSlide.signal.split(' · ')[0]}</span><b>READY</b></div><div className="hud-step"><i>✓</i> Inspect device</div><div className="hud-step"><i>02</i> Choose a utility</div><div className="hud-step"><i>03</i> Run locally</div></div>
          <div className="visual-coordinates">FERRUM / {activeSlide.role}<br />POINT CLOUD · ANDROID</div>
          <div className="visual-caption">FIG. 00{activeSlideIndex + 1} — {activeSlide.signal}</div>
          <div className="visual-status"><span className="pulse-dot" /> TOOLCHAIN READY</div>
        </div>
        <div className="carousel-controls col-span-full flex items-center justify-between border-t border-white/10 pt-4" aria-label="Choose a Ferrum module">
          <div className="flex items-center gap-4"><span className="font-mono text-[10px] text-[#b7e7c9]">0{activeSlideIndex + 1}<i className="px-1 text-white/25">/</i>0{featureSlides.length}</span><div className="flex items-center gap-1.5">{featureSlides.map((slide, index) => <button key={slide.id} type="button" className={`carousel-dot${index === activeSlideIndex ? ' active' : ''}`} aria-label={`Show ${slide.name}`} aria-current={index === activeSlideIndex ? 'true' : undefined} onClick={() => requestSlide(index)} />)}</div><span key={activeSlide.id} className={`carousel-timer${autoPlay && !modelInteracting ? ' is-running' : ''}`} aria-hidden="true"><i /></span><span className="hidden text-[8px] uppercase tracking-[.15em] text-white/35 sm:inline">Choose a Ferrum module</span></div>
          <div className="flex items-center gap-2"><span className="mr-2 hidden text-[8px] uppercase tracking-[.14em] text-white/35 sm:inline">{modelInteracting ? 'Spin it however you like' : 'Drag the model to rotate'}</span><button type="button" className="carousel-autoplay" aria-pressed={autoPlay} onClick={() => setAutoPlay((playing) => !playing)}>{autoPlay ? 'Ⅱ PAUSE' : '▶ PLAY'}</button><button type="button" className="carousel-arrow" aria-label="Previous model" onClick={() => changeSlide(-1)}>←</button><button type="button" className="carousel-arrow" aria-label="Next model" onClick={() => changeSlide(1)}>→</button></div>
        </div>
      </section>

      <div className="border-y border-white/10 bg-white/[.025]"><div className="mx-auto grid w-[min(1320px,calc(100%-48px))] grid-cols-2 md:grid-cols-4">{[['RUST', 'FAST NATIVE CORE'], ['ANDROID', 'BUILT FOR YOUR DEVICE'], ['LOCAL', 'TOOLS CLOSE TO HOME'], ['MODULAR', 'ONE TOOL AT A TIME']].map(([value, label]) => <div key={label} className="flex items-center gap-3 border-white/10 px-3 py-5 odd:border-r md:justify-center md:border-r"><b className="font-mono text-xl font-normal text-[#b7e7c9]">{value}</b><span className="max-w-[110px] text-[8px] leading-4 tracking-[.13em] text-white/40">{label}</span></div>)}</div></div>

      <section id="platform" className="mx-auto w-[min(1320px,calc(100%-48px))] py-24 md:py-32">
        <div className="mb-12 grid gap-6 md:grid-cols-[1fr_.7fr] md:items-end"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">A TOOLKIT BUILT AROUND ANDROID / 02</span><h2 className="mt-5 max-w-[730px] text-4xl leading-[1.02] font-medium tracking-[-.055em] md:text-6xl">Your Android workflow.<br /><span className="font-serif font-normal italic text-[#b7e7c9]">One sharp toolbox.</span></h2></div><p className="max-w-[355px] text-[13px] leading-6 text-white/50">Ferrum gathers device utilities into one consistent interface. A lightweight Rust core, focused modules, and you stay in control.</p></div>
        <div className="grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">{[['01 / INSPECT', '⌕', 'Know your device', 'Check device info and system status in a concise view.'], ['02 / MANAGE', '⌘', 'Manage files & tools', 'Utilities for files, storage, and everyday device operations in one workbench.'], ['03 / AUTOMATE', '↗', 'Repeat less', 'Shape routine steps into a workflow that is more consistent and easier to review.']].map(([number, icon, title, body], i) => <article key={number} className="group bg-[#0a1512] p-6 transition hover:bg-[#10201a] md:p-8"><div className="flex items-center justify-between"><span className="text-[8px] tracking-[.19em] text-white/35">{number}</span><span className={`grid size-10 place-items-center border text-lg ${i === 1 ? 'border-[#d7d1a1]/30 text-[#d7d1a1]' : 'border-[#b7e7c9]/30 text-[#b7e7c9]'}`}>{icon}</span></div><h3 className="mt-12 text-lg font-medium tracking-tight">{title}</h3><p className="mt-3 min-h-[58px] max-w-[315px] text-[11px] leading-6 text-white/45">{body}</p><span className="mt-7 inline-block text-[8px] uppercase tracking-[.16em] text-[#b7e7c9]/70">FERRUM MODULE &nbsp; ↗</span></article>)}</div>
      </section>

      <section id="modules" className="border-y border-white/10 bg-[#0c1714] py-24 md:py-28"><div className="mx-auto grid w-[min(1320px,calc(100%-48px))] gap-12 lg:grid-cols-[.82fr_1.18fr] lg:items-center"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">THE FERRUM TOOLKIT / 03</span><h2 className="mt-5 text-4xl leading-tight font-medium tracking-[-.055em] md:text-6xl">Purpose-built<br /><span className="font-serif font-normal italic text-[#b7e7c9]">Android utilities.</span></h2><p className="mt-6 max-w-[415px] text-[13px] leading-7 text-white/48">Ferrum is built with Rust to deliver fast, modular Android utilities. Pick the tool you need, see its steps, and run it deliberately.</p><a className="mt-8 inline-flex border-b border-[#b7e7c9]/50 pb-2 text-[9px] uppercase tracking-[.16em] text-[#b7e7c9] no-underline" href="#workspace">Try the local demo <span className="ml-5">→</span></a></div><div className="grid gap-3 sm:grid-cols-2">{[['◉', 'DEVICE INSPECTOR', 'Device, storage, battery, and system status summary.', 'DEVICE · STATUS'], ['⌁', 'FILE OPERATIONS', 'File and storage utilities for everyday work.', 'FILES · STORAGE'], ['⌘', 'NETWORK LAB', 'Connection checks and network diagnostic utilities.', 'NETWORK · CHECKS'], ['◌', 'AUTOMATION KIT', 'Simple workflows for operations you repeat often.', 'ROUTINES · TASKS']].map(([icon, name, description, tags], i) => <article key={name} className={`border border-white/10 bg-[#08110f] p-5 ${i === 1 || i === 2 ? 'sm:translate-y-5' : ''}`}><div className="flex items-center justify-between"><span className="text-2xl text-[#b7e7c9]">{icon}</span><span className="size-1.5 rounded-full bg-[#b7e7c9] shadow-[0_0_12px_#b7e7c9]" /></div><h3 className="mt-6 text-[9px] font-semibold tracking-[.17em]">{name}</h3><p className="mt-2 text-[10px] leading-5 text-white/45">{description}</p><div className="mt-5 border-t border-white/10 pt-3 font-mono text-[8px] tracking-[.14em] text-white/30">{tags}</div></article>)}</div></div></section>

      <section id="workspace" className="mx-auto w-[min(1320px,calc(100%-48px))] py-24 md:py-32"><div className="grid gap-12 lg:grid-cols-[.82fr_1.18fr]"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">FERRUM WORKSPACE / 04</span><h2 className="mt-5 text-4xl leading-tight font-medium tracking-[-.055em] md:text-6xl">Your Android.<br /><span className="font-serif font-normal italic text-[#b7e7c9]">Your toolchain.</span></h2><p className="mt-6 max-w-[405px] text-[13px] leading-7 text-white/48">Try one sample command. This demo only simulates a tool run in the browser; connect it to the Ferrum app for real device operations.</p><div className="mt-8 flex gap-8"><div><b className="block font-mono text-2xl font-normal text-white">{String(missions.length).padStart(2, '0')}</b><span className="text-[8px] tracking-[.16em] text-white/35">SAVED RUNS</span></div><div><b className="block font-mono text-2xl font-normal text-[#b7e7c9]">{String(activeCount).padStart(2, '0')}</b><span className="text-[8px] tracking-[.16em] text-white/35">IN PROGRESS</span></div></div></div>
        <div className="border border-white/10 bg-[#0c1714]"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-3"><span className="size-2 rounded-full bg-[#b7e7c9]" /><span className="text-[9px] font-semibold tracking-[.19em]">FERRUM QUICK RUN</span></div><span className="font-mono text-[8px] text-white/30">LOCAL DEMO / 01</span></div>
          <form onSubmit={startMission} className="border-b border-white/10 p-5"><label htmlFor="ferrum-goal" className="mb-3 block text-[8px] uppercase tracking-[.19em] text-white/40">Which Android utility do you want to try?</label><div className="flex flex-col gap-3 sm:flex-row"><input id="ferrum-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={240} placeholder="Example: check the device summary..." className="min-w-0 flex-1 border border-white/10 bg-[#08110f] px-4 py-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-[#b7e7c9]/55" /><button disabled={!goal.trim()} className="flex shrink-0 items-center justify-center gap-6 bg-[#b7e7c9] px-5 py-3 text-[9px] font-bold uppercase tracking-[.11em] text-[#10221a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" type="submit">Run tool <span>↗</span></button></div><div className="mt-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} className="border border-white/10 px-3 py-2 text-left text-[8px] text-white/45 transition hover:border-[#b7e7c9]/40 hover:text-[#d7f0df]" type="button" onClick={() => setGoal(suggestion)}>{suggestion}</button>)}</div><p className="mt-3 text-[8px] text-white/30">Frontend simulation only · No Android command is executed and no data leaves this browser.</p></form>
          <div className="max-h-[300px] overflow-auto">{missions.length === 0 ? <div className="px-5 py-10 text-center text-[10px] text-white/35">No runs yet. Choose a utility to preview.</div> : missions.map((mission) => <article key={mission.id} className="flex gap-4 border-b border-white/[.06] px-5 py-4 last:border-0"><span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${mission.status === 'completed' ? 'bg-[#b7e7c9]' : 'animate-pulse bg-[#d7d1a1]'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{mission.goal}</p><p className="mt-1 font-mono text-[8px] tracking-[.1em] text-white/35">{mission.stage}</p></div><div className="shrink-0 text-right"><span className="text-[8px] uppercase tracking-[.1em] text-[#b7e7c9]/80">{mission.status === 'completed' ? 'DONE' : 'RUNNING'}</span><p className="mt-1 text-[8px] text-white/25">{new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(mission.time)}</p></div></article>)}</div>
          {missions.length > 0 && <div className="border-t border-white/10 px-5 py-3 text-right"><button type="button" onClick={clearMissions} className="text-[8px] uppercase tracking-[.13em] text-white/35 transition hover:text-white/70">Clear local history</button></div>}
        </div>
      </div></section>

      <footer className="border-t border-white/10 bg-[#070d0b]"><div className="mx-auto flex w-[min(1320px,calc(100%-48px))] flex-col items-start justify-between gap-5 py-7 text-[8px] uppercase tracking-[.15em] text-white/35 sm:flex-row sm:items-center"><a href="#home" className="flex items-center gap-2 text-[11px] font-semibold tracking-[.2em] text-white/75 no-underline"><span className="ferrum-mark">Fe</span>FERRUM</a><span>Android multi-tool · Rust-powered</span><span>Built by <b className="font-medium text-white/60">OICHIDEV</b> · © 2026</span></div></footer>
      {toast && <div className="fixed right-5 bottom-5 z-30 max-w-[calc(100%-40px)] border border-[#b7e7c9]/20 bg-[#11201a] px-5 py-3 text-[10px] text-[#d7f0df] shadow-xl" role="status">{toast}</div>}
      </main>
    </>
  )
}

export default App
