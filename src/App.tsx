import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type * as Three from 'three'
import robotPointCloud from './assets/points/robot.points.b64?url'
import helmetPointCloud from './assets/points/helmet.points.b64?url'
import boomboxPointCloud from './assets/points/boombox.points.b64?url'
import drillPointCloud from './assets/points/drill.points.b64?url'
import { loadPointCloud } from './points'
import { ensureAudio, isMuted, playAssemble, playClick, playRunComplete, playSlideChange, setMuted } from './sound'
import './App.css'

function isPointCloudModel(src: string): boolean {
  const lower = src.toLowerCase()
  return lower.endsWith('.ply') || lower.endsWith('.b64')
}

// Structural view of a mesh/points node for scene traversal: the three.js
// types put isMesh/isPoints on the concrete classes only, so the union
// type cannot be probed directly.
type DrawableObject = Three.Object3D & {
  isMesh?: boolean
  isPoints?: boolean
  geometry: Three.BufferGeometry
  material: Three.Material | Three.Material[]
}

type Mission = { id: string; goal: string; stage: string; status: 'running' | 'completed'; time: number }
type FeatureSlide = { id: string; name: string; role: string; eyebrow: string; title: [string, string, string]; description: string; quote: string; model: string; accent: string; signal: string }

const storageKey = 'ferrum-demo-runs-v1'
const featureSlides: FeatureSlide[] = [
  { id: 'core', name: 'Ferrum Core', role: 'ANDROID MULTI-TOOL', eyebrow: 'A RUST-POWERED TOOLBOX FOR ANDROID / 01', title: ['Every tool', 'for Android', 'in one place.'], description: 'Ferrum menyatukan utilitas Android dalam satu workbench: inspeksi perangkat, operasi file, diagnostik jaringan, dan automasi rutin.', quote: 'One fast workbench. Your Android, understood.', model: robotPointCloud, accent: '#b7e7c9', signal: 'ANDROID · RUST' },
  { id: 'device', name: 'Device Inspector', role: 'DEVICE DIAGNOSTICS', eyebrow: 'GET TO KNOW YOUR DEVICE / 02', title: ['Know your', 'device from', 'the inside.'], description: 'Ringkas informasi perangkat, storage, baterai, dan status sistem supaya pemeriksaan harian terasa cepat dan jelas.', quote: 'The right details, right when you need them.', model: helmetPointCloud, accent: '#a9d6dc', signal: 'DEVICE · STATUS' },
  { id: 'network', name: 'Network Lab', role: 'NETWORK UTILITIES', eyebrow: 'SEE WHAT YOUR CONNECTION IS DOING / 03', title: ['Read the', 'signals around', 'your device.'], description: 'Kumpulan utilitas jaringan untuk memeriksa koneksi dan memahami apa yang terjadi di sekitar perangkatmu.', quote: 'Make every connection easier to understand.', model: boomboxPointCloud, accent: '#d8c7e8', signal: 'NETWORK · DIAGNOSTICS' },
  { id: 'automation', name: 'Automation Kit', role: 'REPEATABLE WORKFLOWS', eyebrow: 'LESS REPETITION, MORE MOMENTUM / 04', title: ['Make routine', 'operations', 'move faster.'], description: 'Susun langkah berulang jadi alur kerja yang konsisten, lalu jalankan dengan visibilitas yang tetap di tanganmu.', quote: 'Build a flow once. Make it yours every time.', model: drillPointCloud, accent: '#e1d6a0', signal: 'AUTOMATION · WORKFLOWS' },
]
const suggestions = ['Show device overview', 'Check storage usage', 'Run a network check']

function FlowerScene({ src, accent, label, onInteractionChange, onModelReady }: { src: string; accent: string; label: string; onInteractionChange: (active: boolean) => void; onModelReady?: () => void }) {
  const mount = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)
  const [glitching, setGlitching] = useState(false)

  useEffect(() => {
    const hostNode = mount.current
    if (!hostNode) return
    const host: HTMLDivElement = hostNode

    let alive = true
    let frame = 0
    let renderer: Three.WebGLRenderer | undefined
    let scene: Three.Scene | undefined
    let resizeObserver: ResizeObserver | undefined
    let model: Three.Group | undefined
    let artifacts: Three.Group | undefined
    let isGlitching = false
    let pointsUniforms: {
      uTime: { value: number }
      uGlitch: { value: number }
      uAssemble: { value: number }
      uYMin: { value: number }
      uYMax: { value: number }
      uSweepColor: { value: Three.Color }
    } | undefined
    let assembleStartAt: number | undefined
    let pointerActive = false
    let lastPointerX = 0
    let lastPointerY = 0
    const handlePointerDown = (event: PointerEvent) => {
      if (!model) return
      pointerActive = true
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      host.classList.add('is-dragging')
      host.setPointerCapture(event.pointerId)
      onInteractionChange(true)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerActive || !model) return
      const deltaX = event.clientX - lastPointerX
      const deltaY = event.clientY - lastPointerY
      model.rotation.y += deltaX * 0.009
      model.rotation.x = Math.max(-0.8, Math.min(0.8, model.rotation.x + deltaY * 0.006))
      lastPointerX = event.clientX
      lastPointerY = event.clientY
    }
    const handlePointerUp = () => {
      pointerActive = false
      host.classList.remove('is-dragging')
      onInteractionChange(false)
    }

    async function mountScene() {
      try {
        const [THREE, { GLTFLoader }, { PLYLoader }] = await Promise.all([
          import('three'),
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/loaders/PLYLoader.js'),
        ])
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
        const rimLight = new THREE.PointLight(0x8fe2c7, 14, 7)
        rimLight.color.set(accent)
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
        const nodeMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7 })
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

        const disposeObject = (objectRoot: Three.Object3D) => {
          objectRoot.traverse((object) => {
            const drawable = object as DrawableObject
            if (!drawable.isObject3D && !drawable.isPoints) return
            drawable.geometry.dispose()
            const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
            materials.forEach((material) => material.dispose())
          })
        }

        const onModelLoaded = (loadedModel: Three.Group) => {
          if (!alive || !scene) {
            disposeObject(loadedModel)
            return
          }
          model = loadedModel
          const bounds = new THREE.Box3().setFromObject(model)
          const center = bounds.getCenter(new THREE.Vector3())
          const size = bounds.getSize(new THREE.Vector3())
          model.position.sub(center)
          model.scale.setScalar(1.72 / Math.max(size.x, size.y, size.z))
          model.rotation.x = -0.08
          const glitchUniforms = { time: { value: 0 }, strength: { value: 0 } }
          model.traverse((object) => {
            const drawable = object as DrawableObject
            if (!drawable.isMesh && !drawable.isPoints) return
            const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
            materials.forEach((material) => {
              // Point-cloud materials carry their own shader patch (assemble
              // + sweep + glitch); the generic patch below must not replace it.
              if (material.userData.ferrumPoints) return
              material.onBeforeCompile = (shader) => {
                shader.uniforms.uFerrumTime = glitchUniforms.time
                shader.uniforms.uFerrumGlitch = glitchUniforms.strength
                material.userData.ferrumUniforms = glitchUniforms
                shader.vertexShader = shader.vertexShader
                  .replace('#include <common>', '#include <common>\nuniform float uFerrumTime;\nuniform float uFerrumGlitch;')
                  .replace('#include <begin_vertex>', `#include <begin_vertex>
                    float ferrumSlice = step(0.91, sin(position.y * 74.0 + uFerrumTime * 18.0));
                    transformed.x += sin(uFerrumTime * 36.0 + position.y * 51.0) * 0.045 * uFerrumGlitch * ferrumSlice;
                    transformed.z += cos(uFerrumTime * 28.0 + position.x * 46.0) * 0.025 * uFerrumGlitch * ferrumSlice;`)
                shader.fragmentShader = shader.fragmentShader
                  .replace('#include <common>', '#include <common>\nuniform float uFerrumTime;\nuniform float uFerrumGlitch;')
                  .replace('#include <opaque_fragment>', `float ferrumScanline = step(0.965, sin(gl_FragCoord.y * 0.34 + uFerrumTime * 22.0));
                    float ferrumGlitchPulse = uFerrumGlitch * (0.45 + ferrumScanline * 1.6);
                    outgoingLight += vec3(0.02, 0.16, 0.09) * ferrumGlitchPulse;
                    outgoingLight += vec3(ferrumScanline * 0.12, 0.0, ferrumScanline * 0.2) * uFerrumGlitch;
                    #include <opaque_fragment>`)
              }
              material.customProgramCacheKey = () => 'ferrum-signal-glitch-v1'
              material.needsUpdate = true
            })
          })
          scene.add(model)
          setProgress(100)
          onModelReady?.()
        }

        const onProgress = (event: ProgressEvent<EventTarget>) => {
          if (alive && event.total) setProgress(Math.round(event.loaded / event.total * 100))
        }
        const onLoadError = () => {
          if (alive) setFailed(true)
        }

        if (src.toLowerCase().endsWith('.ply')) {
          new PLYLoader().load(src, (geometry) => {
            const hasColors = geometry.hasAttribute('color')
            let drawable: Three.Mesh | Three.Points
            if (geometry.index && geometry.index.count > 0) {
              if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
              const material = new THREE.MeshStandardMaterial({
                color: hasColors ? 0xffffff : accent,
                vertexColors: hasColors,
                metalness: 0.2,
                roughness: 0.48,
                side: THREE.DoubleSide,
              })
              drawable = new THREE.Mesh(geometry, material)
            } else {
              const material = new THREE.PointsMaterial({
                color: hasColors ? 0xffffff : accent,
                vertexColors: hasColors,
                size: 0.014,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.96,
                depthWrite: false,
              })
              drawable = new THREE.Points(geometry, material)
            }
            const pointCloudRoot = new THREE.Group()
            pointCloudRoot.add(drawable)
            onModelLoaded(pointCloudRoot)
          }, onProgress, onLoadError)
        } else if (src.toLowerCase().endsWith('.b64')) {
          try {
            const cloud = await loadPointCloud(src, (loaded, total) => {
              if (alive && total) setProgress(Math.round((loaded / total) * 100))
            })
            if (!alive) return
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
            pointsUniforms = {
              uTime: { value: 0 },
              uGlitch: { value: 0 },
              uAssemble: { value: 0 },
              uYMin: { value: cloud.min[1] },
              uYMax: { value: cloud.min[1] + cloud.size[1] },
              uSweepColor: { value: new THREE.Color(accent) },
            }
            const uniforms = pointsUniforms
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
            const pointCloudRoot = new THREE.Group()
            pointCloudRoot.add(drawable)
            assembleStartAt = clock.elapsedTime
            onModelLoaded(pointCloudRoot)
          } catch {
            onLoadError()
          }
        } else {
          new GLTFLoader().load(src, (gltf) => onModelLoaded(gltf.scene), onProgress, onLoadError)
        }
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
          model?.traverse((object) => {
            const drawable = object as DrawableObject
            if (!drawable.isMesh && !drawable.isPoints) return
            const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
            materials.forEach((material) => {
              const shaderMaterial = material as Three.Material & { userData: { ferrumUniforms?: { time: { value: number }; strength: { value: number } } } }
              if (shaderMaterial.userData.ferrumUniforms) {
                shaderMaterial.userData.ferrumUniforms.time.value = clock.elapsedTime
                shaderMaterial.userData.ferrumUniforms.strength.value = glitchStrength
              }
            })
          })
          if (pointsUniforms) {
            pointsUniforms.uTime.value = clock.elapsedTime
            pointsUniforms.uGlitch.value = glitchStrength
            pointsUniforms.uAssemble.value = reducedMotion
              ? 1
              : Math.min(1, Math.max(0, (clock.elapsedTime - (assembleStartAt ?? clock.elapsedTime)) / 1.6))
          }
          if (model && !reducedMotion) {
            if (!pointerActive) model.rotation.y += delta * 0.16
            model.position.y = Math.sin(clock.elapsedTime * 0.45) * 0.025
            model.position.x = Math.sin(clock.elapsedTime * 34) * glitchStrength * 0.018
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
  }, [src, accent, onInteractionChange, onModelReady])

  return <div className={`ferrum-canvas${glitching ? ' is-glitching' : ''}`} ref={mount} aria-label={`Model 3D ${label} bisa diputar dan memiliki efek glitch`} role="img">
    {progress < 100 && !failed && <div className="model-loading"><span className="loading-flower">✳</span><span>MEMUAT MODEL · {progress}%</span></div>}
    {failed && <div className="model-loading"><span className="loading-flower">✳</span><span>MODEL TIDAK DAPAT DIMUAT</span></div>}
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
  const [autoPlay, setAutoPlay] = useState(true)
  const [modelInteracting, setModelInteracting] = useState(false)
  const [missions, setMissions] = useState<Mission[]>(readMissions)
  const [goal, setGoal] = useState('')
  const [toast, setToast] = useState('')
  const [soundOn, setSoundOn] = useState(() => !isMuted())
  const timers = useRef<number[]>([])
  const firstSlideRef = useRef(true)

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
    setToast('Ferrum memulai simulasi tool run.')
    playClick()
    timers.current.push(window.setTimeout(() => updateMission(id, 'Checking module selection', 'running'), 900))
    timers.current.push(window.setTimeout(() => updateMission(id, 'Preparing local operation', 'running'), 1900))
    timers.current.push(window.setTimeout(() => updateMission(id, 'Running frontend simulation', 'running'), 3000))
    timers.current.push(window.setTimeout(() => {
      updateMission(id, 'Demo complete · preview ready', 'completed')
      setToast('Ferrum demo selesai. Run tersimpan di browser ini.')
      playRunComplete()
    }, 4100))
    timers.current.push(window.setTimeout(() => setToast(''), 6500))
  }

  function clearMissions() {
    setMissions([])
    setToast('Riwayat demo dibersihkan dari browser ini.')
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

  useEffect(() => {
    if (!autoPlay || modelInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setTimeout(() => {
      setActiveSlideIndex((current) => (current + 1) % featureSlides.length)
    }, 9500)
    return () => window.clearTimeout(timer)
  }, [activeSlideIndex, autoPlay, modelInteracting])

  function changeSlide(direction: number) {
    setActiveSlideIndex((current) => (current + direction + featureSlides.length) % featureSlides.length)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#08110f] text-[#f1f2ea] selection:bg-[#b7e7c9] selection:text-[#08110f]">
      <header className="relative z-20 mx-auto flex h-[78px] w-[min(1320px,calc(100%-48px))] items-center justify-between border-b border-white/10">
        <a href="#home" className="flex items-center gap-3 text-[13px] font-semibold tracking-[.24em] text-white no-underline"><span className="ferrum-mark">Fe</span> FERRUM<span className="hidden text-[8px] font-normal tracking-[.3em] text-white/40 sm:inline">ANDROID MULTI-TOOL</span></a>
        <nav className="hidden items-center gap-9 text-[9px] uppercase tracking-[.2em] text-white/55 md:flex"><a className="transition hover:text-[#c8efd4]" href="#platform">Platform</a><a className="transition hover:text-[#c8efd4]" href="#modules">Modules</a><a className="transition hover:text-[#c8efd4]" href="#workspace">Workspace</a></nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleSound} aria-pressed={soundOn} className="border border-white/20 bg-transparent px-3 py-2.5 text-[9px] uppercase tracking-[.14em] text-white/60 transition hover:border-white/50 hover:text-white">Sound {soundOn ? 'on' : 'off'}</button>
          <a href="#workspace" className="flex items-center gap-3 border border-[#a8d8b6]/50 px-4 py-2.5 text-[9px] uppercase tracking-[.14em] text-[#c8efd4] no-underline transition hover:bg-[#b7e7c9] hover:text-[#08110f]">Explore Ferrum <span>↗</span></a>
        </div>
      </header>

      <section id="home" className="ferrum-hero relative mx-auto grid min-h-[690px] w-[min(1320px,calc(100%-48px))] items-center gap-7 py-12 lg:grid-cols-[.92fr_1.08fr] lg:py-10" aria-label="Ferrum Android toolkit carousel" aria-roledescription="carousel" onKeyDown={(event) => { if (event.key === 'ArrowRight') changeSlide(1); if (event.key === 'ArrowLeft') changeSlide(-1) }}>
        <div className="ferrum-copy relative z-10 max-w-[590px]">
          <div className="mb-7 flex items-center gap-3 text-[9px] uppercase tracking-[.24em] text-[#c8efd4]/75"><span className="pulse-dot" /> {activeSlide.eyebrow}</div>
          <div key={activeSlide.id} className="slide-copy" aria-live="polite"><h1 className="max-w-[700px] text-[clamp(54px,7.6vw,100px)] leading-[.9] font-medium tracking-[-.075em] text-[#f2f0e7]">{activeSlide.title[0]}<br /><span className="font-serif font-normal italic text-[#b7e7c9]">{activeSlide.title[1]}</span><br />{activeSlide.title[2]}</h1>
            <p className="mt-8 max-w-[440px] text-[13px] leading-7 text-white/55">{activeSlide.description}</p>
            <blockquote className="mt-5 border-l border-[#b7e7c9]/45 pl-3 font-serif text-[13px] italic text-white/55">“{activeSlide.quote}”</blockquote></div>
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
          <FlowerScene key={activeSlide.id} src={activeSlide.model} accent={activeSlide.accent} label={activeSlide.name} onInteractionChange={handleModelInteraction} onModelReady={handleModelReady} />
          <div className="visual-label visual-label-top"><span>✳</span><div>{activeSlide.name.toUpperCase()} / 0{activeSlideIndex + 1}<br /><b>{activeSlide.role}</b></div></div>
          <div className="visual-label visual-label-right"><span>0{activeSlideIndex + 1}</span><div>FERRUM MODULE<br /><b>DRAG TO ROTATE</b></div></div>
          <div className="hud-card hud-memory"><div className="hud-card-head"><span>01 / DEVICE MAP</span><b>LOCAL</b></div><svg viewBox="0 0 126 52" aria-hidden="true"><path d="M10 33 36 15 57 35 82 12 115 24M36 15l10 28 36-31 13 35" /><circle cx="10" cy="33" r="3" /><circle cx="36" cy="15" r="3" /><circle cx="57" cy="35" r="3" /><circle cx="82" cy="12" r="3" /><circle cx="115" cy="24" r="3" /><circle cx="46" cy="43" r="2" /><circle cx="96" cy="47" r="2" /></svg><span className="hud-card-foot">ANDROID TOOLCHAIN</span></div>
          <div className="hud-card hud-plan"><div className="hud-card-head"><span>02 / {activeSlide.signal.split(' · ')[0]}</span><b>READY</b></div><div className="hud-step"><i>✓</i> Inspect device</div><div className="hud-step"><i>02</i> Choose a utility</div><div className="hud-step"><i>03</i> Run locally</div></div>
          <div className="visual-coordinates">FERRUM / {activeSlide.role}<br />{isPointCloudModel(activeSlide.model) ? 'POINT CLOUD' : 'GLB MODEL'} · ANDROID</div>
          <div className="visual-caption">FIG. 00{activeSlideIndex + 1} — {activeSlide.signal}</div>
          <div className="visual-status"><span className="pulse-dot" /> TOOLCHAIN READY</div>
        </div>
        <div className="carousel-controls col-span-full flex items-center justify-between border-t border-white/10 pt-4" aria-label="Pilih Ferrum module">
          <div className="flex items-center gap-4"><span className="font-mono text-[10px] text-[#b7e7c9]">0{activeSlideIndex + 1}<i className="px-1 text-white/25">/</i>0{featureSlides.length}</span><div className="flex items-center gap-1.5">{featureSlides.map((slide, index) => <button key={slide.id} type="button" className={`carousel-dot${index === activeSlideIndex ? ' active' : ''}`} aria-label={`Tampilkan ${slide.name}`} aria-current={index === activeSlideIndex ? 'true' : undefined} onClick={() => setActiveSlideIndex(index)} />)}</div><span key={activeSlide.id} className={`carousel-timer${autoPlay && !modelInteracting ? ' is-running' : ''}`} aria-hidden="true"><i /></span><span className="hidden text-[8px] uppercase tracking-[.15em] text-white/35 sm:inline">Pilih module Ferrum</span></div>
          <div className="flex items-center gap-2"><span className="mr-2 hidden text-[8px] uppercase tracking-[.14em] text-white/35 sm:inline">{modelInteracting ? 'Putar sesukamu' : 'Seret model untuk memutar'}</span><button type="button" className="carousel-autoplay" aria-pressed={autoPlay} onClick={() => setAutoPlay((playing) => !playing)}>{autoPlay ? 'Ⅱ PAUSE' : '▶ PLAY'}</button><button type="button" className="carousel-arrow" aria-label="Model sebelumnya" onClick={() => changeSlide(-1)}>←</button><button type="button" className="carousel-arrow" aria-label="Model berikutnya" onClick={() => changeSlide(1)}>→</button></div>
        </div>
      </section>

      <div className="border-y border-white/10 bg-white/[.025]"><div className="mx-auto grid w-[min(1320px,calc(100%-48px))] grid-cols-2 md:grid-cols-4">{[['RUST', 'FAST NATIVE CORE'], ['ANDROID', 'BUILT FOR YOUR DEVICE'], ['LOCAL', 'TOOLS CLOSE TO HOME'], ['MODULAR', 'ONE TOOL AT A TIME']].map(([value, label]) => <div key={label} className="flex items-center gap-3 border-white/10 px-3 py-5 odd:border-r md:justify-center md:border-r"><b className="font-mono text-xl font-normal text-[#b7e7c9]">{value}</b><span className="max-w-[110px] text-[8px] leading-4 tracking-[.13em] text-white/40">{label}</span></div>)}</div></div>

      <section id="platform" className="mx-auto w-[min(1320px,calc(100%-48px))] py-24 md:py-32">
        <div className="mb-12 grid gap-6 md:grid-cols-[1fr_.7fr] md:items-end"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">A TOOLKIT BUILT AROUND ANDROID / 02</span><h2 className="mt-5 max-w-[730px] text-4xl leading-[1.02] font-medium tracking-[-.055em] md:text-6xl">Your Android workflow.<br /><span className="font-serif font-normal italic text-[#b7e7c9]">One sharp toolbox.</span></h2></div><p className="max-w-[355px] text-[13px] leading-6 text-white/50">Ferrum mengumpulkan utilitas perangkat dalam satu antarmuka yang konsisten. Inti Rust yang ringan, modul yang fokus, dan kamu tetap memegang kendali.</p></div>
        <div className="grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">{[['01 / INSPECT', '⌕', 'Kenali perangkat', 'Periksa informasi perangkat dan status sistem lewat tampilan yang ringkas.'], ['02 / MANAGE', '⌘', 'Kelola file & tools', 'Akses utilitas untuk file, storage, dan operasi perangkat dalam satu workbench.'], ['03 / AUTOMATE', '↗', 'Ulangi lebih sedikit', 'Rangkai langkah rutin menjadi alur kerja yang lebih konsisten dan mudah ditinjau.']].map(([number, icon, title, body], i) => <article key={number} className="group bg-[#0a1512] p-6 transition hover:bg-[#10201a] md:p-8"><div className="flex items-center justify-between"><span className="text-[8px] tracking-[.19em] text-white/35">{number}</span><span className={`grid size-10 place-items-center border text-lg ${i === 1 ? 'border-[#d7d1a1]/30 text-[#d7d1a1]' : 'border-[#b7e7c9]/30 text-[#b7e7c9]'}`}>{icon}</span></div><h3 className="mt-12 text-lg font-medium tracking-tight">{title}</h3><p className="mt-3 min-h-[58px] max-w-[315px] text-[11px] leading-6 text-white/45">{body}</p><span className="mt-7 inline-block text-[8px] uppercase tracking-[.16em] text-[#b7e7c9]/70">FERRUM MODULE &nbsp; ↗</span></article>)}</div>
      </section>

      <section id="modules" className="border-y border-white/10 bg-[#0c1714] py-24 md:py-28"><div className="mx-auto grid w-[min(1320px,calc(100%-48px))] gap-12 lg:grid-cols-[.82fr_1.18fr] lg:items-center"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">THE FERRUM TOOLKIT / 03</span><h2 className="mt-5 text-4xl leading-tight font-medium tracking-[-.055em] md:text-6xl">Purpose-built<br /><span className="font-serif font-normal italic text-[#b7e7c9]">Android utilities.</span></h2><p className="mt-6 max-w-[415px] text-[13px] leading-7 text-white/48">Ferrum dibangun dengan Rust untuk menghadirkan utilitas Android yang cepat dan modular. Pilih alat sesuai kebutuhan, lihat langkahnya, dan jalankan dengan sadar.</p><a className="mt-8 inline-flex border-b border-[#b7e7c9]/50 pb-2 text-[9px] uppercase tracking-[.16em] text-[#b7e7c9] no-underline" href="#workspace">Try the local demo <span className="ml-5">→</span></a></div><div className="grid gap-3 sm:grid-cols-2">{[['◉', 'DEVICE INSPECTOR', 'Ringkasan perangkat, storage, baterai, dan status sistem.', 'DEVICE · STATUS'], ['⌁', 'FILE OPERATIONS', 'Utilitas file dan storage untuk pekerjaan sehari-hari.', 'FILES · STORAGE'], ['⌘', 'NETWORK LAB', 'Pemeriksaan koneksi dan utilitas diagnostik jaringan.', 'NETWORK · CHECKS'], ['◌', 'AUTOMATION KIT', 'Alur kerja sederhana untuk operasi yang sering diulang.', 'ROUTINES · TASKS']].map(([icon, name, description, tags], i) => <article key={name} className={`border border-white/10 bg-[#08110f] p-5 ${i === 1 || i === 2 ? 'sm:translate-y-5' : ''}`}><div className="flex items-center justify-between"><span className="text-2xl text-[#b7e7c9]">{icon}</span><span className="size-1.5 rounded-full bg-[#b7e7c9] shadow-[0_0_12px_#b7e7c9]" /></div><h3 className="mt-6 text-[9px] font-semibold tracking-[.17em]">{name}</h3><p className="mt-2 text-[10px] leading-5 text-white/45">{description}</p><div className="mt-5 border-t border-white/10 pt-3 font-mono text-[8px] tracking-[.14em] text-white/30">{tags}</div></article>)}</div></div></section>

      <section id="workspace" className="mx-auto w-[min(1320px,calc(100%-48px))] py-24 md:py-32"><div className="grid gap-12 lg:grid-cols-[.82fr_1.18fr]"><div><span className="text-[9px] uppercase tracking-[.24em] text-[#b7e7c9]/70">FERRUM WORKSPACE / 04</span><h2 className="mt-5 text-4xl leading-tight font-medium tracking-[-.055em] md:text-6xl">Your Android.<br /><span className="font-serif font-normal italic text-[#b7e7c9]">Your toolchain.</span></h2><p className="mt-6 max-w-[405px] text-[13px] leading-7 text-white/48">Coba satu perintah contoh. Demo ini hanya mensimulasikan tool run di browser; hubungkan ke aplikasi Ferrum untuk operasi perangkat sungguhan.</p><div className="mt-8 flex gap-8"><div><b className="block font-mono text-2xl font-normal text-white">{String(missions.length).padStart(2, '0')}</b><span className="text-[8px] tracking-[.16em] text-white/35">SAVED RUNS</span></div><div><b className="block font-mono text-2xl font-normal text-[#b7e7c9]">{String(activeCount).padStart(2, '0')}</b><span className="text-[8px] tracking-[.16em] text-white/35">IN PROGRESS</span></div></div></div>
        <div className="border border-white/10 bg-[#0c1714]"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-3"><span className="size-2 rounded-full bg-[#b7e7c9]" /><span className="text-[9px] font-semibold tracking-[.19em]">FERRUM QUICK RUN</span></div><span className="font-mono text-[8px] text-white/30">LOCAL DEMO / 01</span></div>
          <form onSubmit={startMission} className="border-b border-white/10 p-5"><label htmlFor="ferrum-goal" className="mb-3 block text-[8px] uppercase tracking-[.19em] text-white/40">Which Android utility do you want to try?</label><div className="flex flex-col gap-3 sm:flex-row"><input id="ferrum-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={240} placeholder="Contoh: cek ringkasan perangkat..." className="min-w-0 flex-1 border border-white/10 bg-[#08110f] px-4 py-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-[#b7e7c9]/55" /><button disabled={!goal.trim()} className="flex shrink-0 items-center justify-center gap-6 bg-[#b7e7c9] px-5 py-3 text-[9px] font-bold uppercase tracking-[.11em] text-[#10221a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" type="submit">Run tool <span>↗</span></button></div><div className="mt-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} className="border border-white/10 px-3 py-2 text-left text-[8px] text-white/45 transition hover:border-[#b7e7c9]/40 hover:text-[#d7f0df]" type="button" onClick={() => setGoal(suggestion)}>{suggestion}</button>)}</div><p className="mt-3 text-[8px] text-white/30">Frontend simulation only · No Android command is executed and no data leaves this browser.</p></form>
          <div className="max-h-[300px] overflow-auto">{missions.length === 0 ? <div className="px-5 py-10 text-center text-[10px] text-white/35">No runs yet. Choose a utility to preview.</div> : missions.map((mission) => <article key={mission.id} className="flex gap-4 border-b border-white/[.06] px-5 py-4 last:border-0"><span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${mission.status === 'completed' ? 'bg-[#b7e7c9]' : 'animate-pulse bg-[#d7d1a1]'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">{mission.goal}</p><p className="mt-1 font-mono text-[8px] tracking-[.1em] text-white/35">{mission.stage}</p></div><div className="shrink-0 text-right"><span className="text-[8px] uppercase tracking-[.1em] text-[#b7e7c9]/80">{mission.status === 'completed' ? 'DONE' : 'RUNNING'}</span><p className="mt-1 text-[8px] text-white/25">{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(mission.time)}</p></div></article>)}</div>
          {missions.length > 0 && <div className="border-t border-white/10 px-5 py-3 text-right"><button type="button" onClick={clearMissions} className="text-[8px] uppercase tracking-[.13em] text-white/35 transition hover:text-white/70">Clear local history</button></div>}
        </div>
      </div></section>

      <footer className="border-t border-white/10 bg-[#070d0b]"><div className="mx-auto flex w-[min(1320px,calc(100%-48px))] flex-col items-start justify-between gap-5 py-7 text-[8px] uppercase tracking-[.15em] text-white/35 sm:flex-row sm:items-center"><a href="#home" className="flex items-center gap-2 text-[11px] font-semibold tracking-[.2em] text-white/75 no-underline"><span className="ferrum-mark">Fe</span>FERRUM</a><span>Android multi-tool · Rust-powered</span><span>Built by <b className="font-medium text-white/60">OICHIDEV</b> · © 2026</span></div></footer>
      {toast && <div className="fixed right-5 bottom-5 z-30 max-w-[calc(100%-40px)] border border-[#b7e7c9]/20 bg-[#11201a] px-5 py-3 text-[10px] text-[#d7f0df] shadow-xl" role="status">{toast}</div>}
    </main>
  )
}

export default App
