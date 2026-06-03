import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { Volume2, VolumeX, Loader2, Bot, PanelLeft, PanelRight, Settings, X, ScrollText } from 'lucide-react'
import { useSessionStore } from '@/store/sessionStore'
import { useAvatarStore } from '@/store/avatarStore'
import { lipSync } from '@/lib/lipsync'
import { speakMessageOnce, stopSpeaking } from '@/lib/speak'
import { cn } from '@/lib/utils'
import { ChatInput, type AttachedFile } from './ChatInput'
import { AvatarVoiceSettings } from '@/components/settings/AvatarVoiceSettings'

interface Props {
  chatId: string | null
  slashCommands?: string[]
  active?: boolean   // panel is the visible tab (gates narration + rendering)
}

type Status = 'loading' | 'ready' | 'error'
type Zoom = 'full' | 'three' | 'half' | 'head'

const ZOOMS: { key: Zoom; label: string }[] = [
  { key: 'full',  label: 'Full'  },
  { key: 'three', label: '3/4'   },
  { key: 'half',  label: '1/2'   },
  { key: 'head',  label: 'Head'  },
]

// ── Vanilla three.js VRM stage with walking, gestures & zoom framing ──────────

function VrmStage({ url, zoom, thinkingRef, activeRef, interactiveRef, onStatus }: {
  url: string
  zoom: Zoom
  thinkingRef: MutableRefObject<boolean>
  activeRef: MutableRefObject<boolean>
  interactiveRef: MutableRefObject<boolean>
  onStatus: (s: Status) => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<Zoom>(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.1, 50)
    camera.position.set(0, 1.3, 3)
    camera.lookAt(0, 1.3, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 1.15))
    const dir = new THREE.DirectionalLight(0xffffff, 1.25)
    dir.position.set(1, 2, 2)
    scene.add(dir)

    // Soft ground shadow disc so the character feels grounded while walking.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 }),
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    let vrm: VRM | null = null
    // Model bounding info (set on load) used to compute zoom framing.
    const info = { minY: 0, maxY: 1.6, sizeY: 1.6, sizeZ: 0.3, centerY: 0.8, frontZ: 0.15 }

    onStatus('loading')
    const loader = new GLTFLoader()
    loader.register(parser => new VRMLoaderPlugin(parser))
    loader.load(
      url,
      gltf => {
        const v = gltf.userData.vrm as VRM | undefined
        if (!v) { onStatus('error'); return }
        if (disposed) { VRMUtils.deepDispose(v.scene); return }
        VRMUtils.removeUnnecessaryVertices(v.scene)
        VRMUtils.combineSkeletons(v.scene)
        scene.add(v.scene)
        v.scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(v.scene)
        const size = new THREE.Vector3(); box.getSize(size)
        const center = new THREE.Vector3(); box.getCenter(center)
        info.minY = box.min.y
        info.maxY = box.max.y
        info.sizeY = size.y || 1.6
        info.sizeZ = size.z || 0.3
        info.centerY = center.y
        info.frontZ = box.max.z
        vrm = v
        onStatus('ready')
      },
      undefined,
      () => onStatus('error'),
    )

    // Target framing for the current zoom level (focus height + vertical extent).
    const framingFor = (z: Zoom): { focusY: number; frameH: number } => {
      const { minY, maxY, sizeY, centerY } = info
      switch (z) {
        case 'head':  return { focusY: maxY - sizeY * 0.13, frameH: sizeY * 0.26 }
        case 'half':  return { focusY: minY + sizeY * 0.74, frameH: sizeY * 0.52 }
        case 'three': return { focusY: minY + sizeY * 0.60, frameH: sizeY * 0.74 }
        default:      return { focusY: centerY,             frameH: sizeY * 1.06 }
      }
    }

    const clock = new THREE.Clock()
    let raf = 0
    let modelX = 0           // current horizontal position
    let camX = 0             // smoothed camera x (follows model)
    let legPhase = 0
    let faceAngle = 0        // smoothed Y rotation
    let idleDwell = 0        // seconds spent continuously idle (gates walking)
    // Eye saccades (gaze darts to a new spot, then holds).
    let gazeX = 0, gazeY = 0, gazeTX = 0, gazeTY = 0, nextSaccadeAt = 0
    // Occasional idle hand gesture.
    let idleGestureUntil = 0, nextIdleGestureAt = 4, idleGestureSide: 'l' | 'r' = 'r'

    const lerpRot = (
      b: THREE.Object3D | null | undefined,
      axis: 'x' | 'y' | 'z',
      target: number,
      k = 0.18,
    ) => { if (b) b.rotation[axis] += (target - b.rotation[axis]) * k }

    const animate = () => {
      raf = requestAnimationFrame(animate)
      // Pause all work while the panel is hidden (saves GPU / battery).
      if (!activeRef.current) return
      const delta = Math.min(clock.getDelta(), 0.05)
      const time = clock.elapsedTime

      const thinking = thinkingRef.current            // waiting for / receiving a reply
      const speaking = !thinking && lipSync.speaking   // narrating the reply

      // ── Camera framing (smooth zoom) ──
      const { focusY, frameH } = framingFor(zoomRef.current)
      const fovRad = (camera.fov * Math.PI) / 180
      const dist = (frameH / 2) / Math.tan(fovRad / 2) + info.sizeZ * 0.6
      camX += (modelX - camX) * 0.06   // camera trails the character horizontally
      const targetCam = new THREE.Vector3(camX, focusY, info.frontZ + dist)
      camera.position.lerp(targetCam, 0.08)
      camera.lookAt(camX, focusY, 0)

      if (vrm) {
        const em = vrm.expressionManager
        const H = vrm.humanoid
        const bone = (n: Parameters<NonNullable<typeof H>['getNormalizedBoneNode']>[0]) =>
          H?.getNormalizedBoneNode(n)

        const lUL = bone('leftUpperLeg');  const rUL = bone('rightUpperLeg')
        const lLL = bone('leftLowerLeg');  const rLL = bone('rightLowerLeg')
        const lUA = bone('leftUpperArm');  const rUA = bone('rightUpperArm')
        const lLA = bone('leftLowerArm');  const rLA = bone('rightLowerArm')

        // ── Walk ONLY when genuinely idle for a moment (never while thinking/speaking) ──
        const canWalk = !thinking && !speaking
        idleDwell = canWalk ? idleDwell + delta : 0
        const wander = idleDwell > 2.5   // settle first, then pace around
        const targetX = wander ? Math.sin(time * 0.23) * 0.95 : 0
        const prevX = modelX
        modelX += (targetX - modelX) * Math.min(1, delta * 1.4)
        const vx = (modelX - prevX) / (delta || 1 / 60)
        const moving = Math.abs(vx) > 0.06
        vrm.scene.position.x = modelX
        ground.position.x = modelX

        // Face travel direction while walking; face the camera otherwise.
        const targetAngle = moving ? (vx > 0 ? Math.PI / 2 : -Math.PI / 2) : 0
        faceAngle += (targetAngle - faceAngle) * Math.min(1, delta * 6)
        vrm.scene.rotation.y = faceAngle

        // Legs walk cycle (amplitude scales with speed).
        const walkAmp = Math.min(1, Math.abs(vx) * 1.6)
        legPhase += delta * 9 * walkAmp
        if (lUL) lUL.rotation.x = Math.sin(legPhase) * 0.5 * walkAmp
        if (rUL) rUL.rotation.x = Math.sin(legPhase + Math.PI) * 0.5 * walkAmp
        if (lLL) lLL.rotation.x = Math.max(0, -Math.sin(legPhase)) * 0.7 * walkAmp
        if (rLL) rLL.rotation.x = Math.max(0, -Math.sin(legPhase + Math.PI)) * 0.7 * walkAmp

        // ── Expressions: blink (with occasional double-blink) + mouth + smile ──
        const phase = time % 4
        let blink = phase > 3.8 ? Math.sin(((phase - 3.8) / 0.2) * Math.PI) : 0
        const phase2 = (time + 2.05) % 6.5      // a second, rarer blink beat → double-blinks
        if (phase2 > 6.4) blink = Math.max(blink, Math.sin(((phase2 - 6.4) / 0.1) * Math.PI))
        em?.setValue(VRMExpressionPresetName.Blink, blink)
        em?.setValue(VRMExpressionPresetName.Aa, thinking ? 0 : lipSync.mouth())
        em?.setValue(VRMExpressionPresetName.Happy, speaking ? 0.3 : thinking ? 0.05 : 0.12)

        // ── Eyes: lively gaze. Thinking → steady up-aside ponder; otherwise the
        // eyes dart to a new target every 1-3s (saccade) then hold. ──
        const interactive = interactiveRef.current
        if (thinking) {
          gazeTX = -0.3; gazeTY = -0.35
        } else if (interactive && time > nextSaccadeAt) {
          gazeTX = (Math.random() * 2 - 1) * 0.6
          gazeTY = (Math.random() * 2 - 1) * 0.4
          nextSaccadeAt = time + 1.0 + Math.random() * 2.2
        } else if (!interactive) {
          gazeTX = 0; gazeTY = 0
        }
        gazeX += (gazeTX - gazeX) * 0.28   // fast saccade, then holds
        gazeY += (gazeTY - gazeY) * 0.28
        if (em) {
          try {
            em.setValue(VRMExpressionPresetName.LookLeft, Math.max(0, -gazeX))
            em.setValue(VRMExpressionPresetName.LookRight, Math.max(0, gazeX))
            em.setValue(VRMExpressionPresetName.LookUp, Math.max(0, -gazeY))
            em.setValue(VRMExpressionPresetName.LookDown, Math.max(0, gazeY))
          } catch { /* some models lack look-direction expressions */ }
        }

        // ── Occasional idle hand gesture (liveliness) ──
        if (interactive && !thinking && !speaking && !moving && time > nextIdleGestureAt) {
          idleGestureUntil = time + 1.6
          nextIdleGestureAt = time + 5 + Math.random() * 6
          idleGestureSide = Math.random() < 0.5 ? 'l' : 'r'
        }
        const idleG = time < idleGestureUntil
          ? Math.sin(((idleGestureUntil - time) / 1.6) * Math.PI)   // 0 → 1 → 0
          : 0

        // ── Arm pose targets (lerped → smooth transitions between modes) ──
        const gesture = speaking ? 1 : 0
        const armSwing = moving ? Math.sin(legPhase) * 0.25 : 0
        let lUAz = -1.40 + Math.sin(time * 0.9) * 0.04
        let lUAx = Math.sin(time * 0.7) * 0.05 + gesture * Math.sin(time * 3.0) * 0.18 - armSwing
        let rUAz = 1.40 + Math.sin(time * 0.9 + 1.0) * 0.04
        let rUAx = Math.sin(time * 0.7 + 0.5) * 0.05 + gesture * Math.sin(time * 3.2 + 1) * 0.18 + armSwing
        let lLAz = -0.20 - gesture * Math.abs(Math.sin(time * 3.0)) * 0.28
        let rLAz = 0.20 + gesture * Math.abs(Math.sin(time * 3.2 + 1)) * 0.28
        // Idle gesture raises one hand briefly.
        if (idleGestureSide === 'r') { rUAx -= idleG * 0.5; rLAz += idleG * 0.5 }
        else { lUAx -= idleG * 0.5; lLAz -= idleG * 0.5 }
        if (thinking) {
          // Pondering: right hand up toward the chin, left arm relaxed down.
          rUAz = 0.95
          rUAx = -0.35 + Math.sin(time * 0.8) * 0.03
          rLAz = 1.45
          lUAz = -1.32; lUAx = 0; lLAz = -0.25
        }
        lerpRot(lUA, 'z', lUAz); lerpRot(lUA, 'x', lUAx)
        lerpRot(rUA, 'z', rUAz); lerpRot(rUA, 'x', rUAx)
        lerpRot(lLA, 'z', lLAz); lerpRot(rLA, 'z', rLAz)

        // Subtle hand/wrist motion so the hands are never frozen.
        const hw = interactive ? 1 : 0
        const lHand = bone('leftHand'); const rHand = bone('rightHand')
        if (lHand) lHand.rotation.z = Math.sin(time * 1.7) * 0.06 * hw - (idleGestureSide === 'l' ? idleG * 0.2 : 0)
        if (rHand) rHand.rotation.z = Math.sin(time * 1.9 + 1) * 0.06 * hw + (idleGestureSide === 'r' ? idleG * 0.2 : 0)

        // ── Body: weight shift + breathing ──
        const hips = bone('hips'); const spine = bone('spine')
        const chest = bone('upperChest') ?? bone('chest')
        const sway = Math.sin(time * 0.31) + 0.4 * Math.sin(time * 0.73)
        if (hips) hips.rotation.z = sway * 0.02
        if (spine) spine.rotation.y = Math.sin(time * 0.4) * 0.03 + gesture * Math.sin(time * 1.1) * 0.05
        if (chest) chest.rotation.x = Math.sin(time * 1.3) * 0.016

        // ── Head: thinking gaze (up & aside) / nods when speaking / idle look ──
        const head = bone('head')
        if (head) {
          const lookY = Math.sin(time * 0.37) * 0.18 + Math.sin(time * 0.13) * 0.12
          const lookX = Math.sin(time * 0.29) * 0.06
          let hx: number, hy: number, hz: number
          if (thinking) {
            hx = -0.12 + Math.sin(time * 0.8) * 0.02   // look up, slow ponder
            hy = 0.10 + Math.sin(time * 0.5) * 0.05
            hz = 0.10
          } else if (speaking) {
            hx = lookX * 0.4 + Math.sin(time * 5.5) * 0.05 + Math.sin(time * 1.3) * 0.03
            hy = lookY * 0.5 + Math.sin(time * 0.9) * 0.06
            hz = Math.sin(time * 1.1) * 0.02
          } else {
            hx = lookX; hy = lookY; hz = Math.sin(time * 0.6) * 0.02
          }
          head.rotation.x += (hx - head.rotation.x) * 0.2
          head.rotation.y += (hy - head.rotation.y) * 0.2
          head.rotation.z += (hz - head.rotation.z) * 0.2
        }

        vrm.update(delta)
      }
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (vrm) VRMUtils.deepDispose(vrm.scene)
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url, onStatus])

  return <div ref={mountRef} className="w-full h-full" />
}

// ── Subtitle: reveal words in sync with TTS playback progress ─────────────────

function Subtitle({ side }: { side: 'left' | 'right' }) {
  const [shown, setShown] = useState('')

  useEffect(() => {
    const id = setInterval(() => {
      const cap = lipSync.caption
      if (!cap) { setShown(''); return }
      const words = cap.split(' ')
      const n = Math.max(1, Math.ceil(lipSync.progress() * words.length))
      setShown(words.slice(0, n).join(' '))
    }, 70)
    return () => clearInterval(id)
  }, [])

  if (!shown) return null

  return (
    <div className={cn('absolute top-1/2 -translate-y-1/2 max-w-[300px] z-10',
      side === 'left' ? 'left-4' : 'right-4')}>
      <div className="rounded-2xl border border-accent/25 bg-bg/80 backdrop-blur px-4 py-3 shadow-2xl">
        <p className="text-sm leading-relaxed text-text font-medium">
          {shown}<span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-accent/70 animate-pulse" />
        </p>
      </div>
    </div>
  )
}

// ── Auto-speak: narrate each completed assistant reply (when panel active) ────

function useAutoSpeak(chatId: string | null, active: boolean) {
  const status = useSessionStore(s => (chatId ? s.chats[chatId]?.status : undefined))
  const messages = useSessionStore(s => (chatId ? s.chats[chatId]?.messages : undefined))
  const autoSpeak = useAvatarStore(s => s.autoSpeak)

  useEffect(() => {
    if (!active || !autoSpeak || status !== 'idle' || !messages?.length) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      const text = (m.blocks ?? [])
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(' ')
        .trim() || m.content
      if (!text) return
      // Global dedup → no double narration, no re-speak on tab switch / remount.
      speakMessageOnce(m.id, text)
      return
    }
  }, [status, messages, autoSpeak, active])
}

// ── Transcript: the conversation log, streams the reply live ───────────────────

function Transcript({ chatId }: { chatId: string | null }) {
  const messages = useSessionStore(s => (chatId ? s.chats[chatId]?.messages : undefined)) ?? []
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div ref={ref} className="w-[300px] flex-shrink-0 border-l border-white/5 bg-bg/40 overflow-y-auto p-3 space-y-2">
      {messages.length === 0 && (
        <p className="text-xs font-mono text-muted/60">Belum ada percakapan.</p>
      )}
      {messages.map(m => {
        const text = (m.blocks ?? [])
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join(' ')
          .trim() || m.content
        if (!text) return null
        const user = m.role === 'user'
        return (
          <div key={m.id} className={cn('rounded-xl px-2.5 py-1.5 text-xs leading-relaxed',
            user ? 'bg-accent/10 text-text ml-5' : 'bg-surface2/50 text-text mr-5')}>
            <span className="block text-[10px] font-mono text-muted/60 mb-0.5">{user ? 'You' : 'Claude'}</span>
            <span className="whitespace-pre-wrap break-words">{text}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CharacterView({ chatId, slashCommands, active = true }: Props) {
  const vrmUrl = useAvatarStore(s => s.vrmUrl)
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const setAutoSpeak = useAvatarStore(s => s.setAutoSpeak)
  // Persisted Character-panel view settings.
  const zoom = useAvatarStore(s => s.zoom)
  const setZoom = useAvatarStore(s => s.setZoom)
  const side = useAvatarStore(s => s.subtitleSide)
  const setSide = useAvatarStore(s => s.setSubtitleSide)
  const showLog = useAvatarStore(s => s.showLog)
  const setShowLog = useAvatarStore(s => s.setShowLog)
  const interactive = useAvatarStore(s => s.interactive)
  const [status, setStatus] = useState<Status>('loading')
  const [showSettings, setShowSettings] = useState(false)

  // Chat wiring (same input as the Chat tab → type + speech-to-text + send)
  const { chats, sendMessageStream, interruptChat, setChatModel, setChatPermissionMode, setChatYolo } = useSessionStore()
  const chat = chatId ? chats[chatId] : null
  const streaming = chat?.status === 'streaming'

  // Live state read by the render loop (refs avoid re-creating the three.js scene).
  const thinkingRef = useRef(false)
  thinkingRef.current = !!streaming   // waiting for / receiving a reply → thinking pose, no walking
  const activeRef = useRef(active)
  activeRef.current = active
  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive

  useAutoSpeak(chatId, active)

  // Stop narration when leaving the panel.
  useEffect(() => () => stopSpeaking(), [])

  const handleSend = (text: string, files: AttachedFile[]) => {
    if (!chatId) return
    const fileRefs = files.map(f => `@${f.path}`).join(' ')
    const full = fileRefs ? `${fileRefs}\n${text}` : text
    sendMessageStream(chatId, full)
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Stage + transcript */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stage area */}
        <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-surface2/30 via-bg to-bg">
          {/* 3D stage */}
          <VrmStage url={vrmUrl} zoom={zoom} thinkingRef={thinkingRef} activeRef={activeRef} interactiveRef={interactiveRef} onStatus={setStatus} />

          {/* Synced subtitle box (left / right of the character) */}
          <Subtitle side={side} />

          {/* Thinking indicator */}
          {streaming && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-bg/80 backdrop-blur border border-white/10 px-3 py-1.5">
              <span className="flex gap-1">
                {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </span>
              <span className="text-xs font-mono text-muted">sedang berpikir…</span>
            </div>
          )}

          {/* Top-left: zoom presets */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 rounded-xl bg-surface/80 backdrop-blur border border-white/10 p-0.5">
            {ZOOMS.map(z => (
              <button key={z.key} onClick={() => setZoom(z.key)}
                className={cn('px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors',
                  zoom === z.key ? 'bg-accent text-bg' : 'text-muted hover:text-text')}>
                {z.label}
              </button>
            ))}
          </div>

          {/* Top-right: transcript toggle + subtitle side + mute + settings */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
            <button onClick={() => setShowLog(!showLog)}
              title={showLog ? 'Sembunyikan log percakapan' : 'Tampilkan log percakapan'}
              className={cn('p-1.5 rounded-lg bg-surface/80 backdrop-blur border border-white/10 cursor-pointer transition-colors',
                showLog ? 'text-accent' : 'text-muted hover:text-text')}>
              <ScrollText className="w-4 h-4" />
            </button>
            <button onClick={() => setSide(side === 'left' ? 'right' : 'left')}
              title={`Subtitle di ${side === 'left' ? 'kiri' : 'kanan'} — klik untuk pindah`}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur border border-white/10 text-muted hover:text-text cursor-pointer transition-colors">
              {side === 'left' ? <PanelLeft className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
            </button>
            <button onClick={() => { if (autoSpeak) stopSpeaking(); setAutoSpeak(!autoSpeak) }}
              title={autoSpeak ? 'Matikan suara' : 'Aktifkan suara'}
              className={cn('p-1.5 rounded-lg bg-surface/80 backdrop-blur border border-white/10 cursor-pointer transition-colors',
                autoSpeak ? 'text-accent hover:text-accent/80' : 'text-muted hover:text-text')}>
              {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button onClick={() => setShowSettings(v => !v)}
              title="Pengaturan avatar & suara"
              className={cn('p-1.5 rounded-lg bg-surface/80 backdrop-blur border border-white/10 cursor-pointer transition-colors',
                showSettings ? 'text-accent' : 'text-muted hover:text-text')}>
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Settings panel (avatar & voice) */}
          {showSettings && (
            <div className="absolute top-14 right-3 z-30 w-72 max-h-[calc(100%-4.5rem)] overflow-y-auto rounded-xl border border-white/10 bg-surface/95 backdrop-blur shadow-2xl p-2">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-mono font-semibold text-text">Pengaturan</span>
                <button onClick={() => setShowSettings(false)}
                  className="p-1 text-muted hover:text-text cursor-pointer rounded">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <AvatarVoiceSettings />
            </div>
          )}

          {/* Loading / error overlays */}
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2 className="w-6 h-6 text-muted animate-spin" />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center pointer-events-none">
              <Bot className="w-10 h-10 text-muted/50" />
              <p className="text-xs leading-snug text-muted font-mono">
                VRM tidak ditemukan. Letakkan model di<br />
                <span className="text-text">public/avatar/character.vrm</span><br />
                (buat gratis di VRoid Studio)
              </p>
            </div>
          )}
        </div>

        {/* Conversation log (same session as Chat) */}
        {showLog && <Transcript chatId={chatId} />}
      </div>

      {/* Type + speech-to-text + send — same input as the Chat tab */}
      {chat && (
        <div className="flex-shrink-0 border-t border-white/5 bg-bg/60">
          <ChatInput
            onSend={handleSend}
            onStop={() => chatId && interruptChat(chatId)}
            streaming={!!streaming}
            slashCommands={slashCommands}
            model={chat.model}
            onModelChange={m => chatId && setChatModel(chatId, m)}
            permissionMode={chat.permissionMode}
            onPermissionModeChange={m => chatId && setChatPermissionMode(chatId, m)}
            yolo={chat.yolo}
            onYoloChange={v => chatId && setChatYolo(chatId, v)}
          />
        </div>
      )}
    </div>
  )
}
