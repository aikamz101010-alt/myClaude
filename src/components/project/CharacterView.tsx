import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { Volume2, VolumeX, Loader2, Bot, PanelLeft, PanelRight } from 'lucide-react'
import { useSessionStore } from '@/store/sessionStore'
import { useAvatarStore } from '@/store/avatarStore'
import { lipSync } from '@/lib/lipsync'
import { speak, stopSpeaking } from '@/lib/speak'
import { cn } from '@/lib/utils'
import { ChatInput, type AttachedFile } from './ChatInput'

interface Props {
  chatId: string | null
  slashCommands?: string[]
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

function VrmStage({ url, zoom, onStatus }: { url: string; zoom: Zoom; onStatus: (s: Status) => void }) {
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

    const animate = () => {
      raf = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.05)
      const time = clock.elapsedTime
      const speaking = lipSync.speaking

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

        // ── Walking: idle paces left↔right; speaking returns to centre & faces front ──
        const targetX = speaking ? 0 : Math.sin(time * 0.23) * 0.95
        const prevX = modelX
        modelX += (targetX - modelX) * Math.min(1, delta * 1.4)
        const vx = (modelX - prevX) / (delta || 1 / 60)
        const moving = Math.abs(vx) > 0.06 && !speaking
        vrm.scene.position.x = modelX
        ground.position.x = modelX

        // Face direction of travel while walking; face the camera while speaking/idle-still.
        const targetAngle = moving ? (vx > 0 ? Math.PI / 2 : -Math.PI / 2) : 0
        faceAngle += (targetAngle - faceAngle) * Math.min(1, delta * 6)
        vrm.scene.rotation.y = faceAngle

        // Walk cycle on the legs (amplitude scales with speed).
        const walkAmp = Math.min(1, Math.abs(vx) * 1.6)
        legPhase += delta * 9 * walkAmp
        const lUL = bone('leftUpperLeg');  const rUL = bone('rightUpperLeg')
        const lLL = bone('leftLowerLeg');  const rLL = bone('rightLowerLeg')
        if (lUL) lUL.rotation.x = Math.sin(legPhase) * 0.5 * walkAmp
        if (rUL) rUL.rotation.x = Math.sin(legPhase + Math.PI) * 0.5 * walkAmp
        if (lLL) lLL.rotation.x = Math.max(0, -Math.sin(legPhase)) * 0.7 * walkAmp
        if (rLL) rLL.rotation.x = Math.max(0, -Math.sin(legPhase + Math.PI)) * 0.7 * walkAmp

        // ── Face: lip-sync + blink + subtle smile ──
        em?.setValue(VRMExpressionPresetName.Aa, lipSync.mouth())
        const phase = time % 4
        const blink = phase > 3.8 ? Math.sin(((phase - 3.8) / 0.2) * Math.PI) : 0
        em?.setValue(VRMExpressionPresetName.Blink, blink)
        em?.setValue(VRMExpressionPresetName.Happy, speaking ? 0.3 : 0.12)

        // ── Arms: T-pose → down; gesture while speaking, swing while walking ──
        const gesture = speaking ? 1 : 0
        const armSwing = moving ? Math.sin(legPhase) * 0.25 : 0
        const lUA = bone('leftUpperArm');  const rUA = bone('rightUpperArm')
        const lLA = bone('leftLowerArm');  const rLA = bone('rightLowerArm')
        if (lUA) {
          lUA.rotation.z = -1.40 + Math.sin(time * 0.9) * 0.04
          lUA.rotation.x = Math.sin(time * 0.7) * 0.05 + gesture * Math.sin(time * 3.0) * 0.18 - armSwing
        }
        if (rUA) {
          rUA.rotation.z = 1.40 + Math.sin(time * 0.9 + 1.0) * 0.04
          rUA.rotation.x = Math.sin(time * 0.7 + 0.5) * 0.05 + gesture * Math.sin(time * 3.2 + 1) * 0.18 + armSwing
        }
        if (lLA) lLA.rotation.z = -0.20 - gesture * Math.abs(Math.sin(time * 3.0)) * 0.28
        if (rLA) rLA.rotation.z = 0.20 + gesture * Math.abs(Math.sin(time * 3.2 + 1)) * 0.28

        // ── Body: weight shift + breathing ──
        const hips = bone('hips'); const spine = bone('spine')
        const chest = bone('upperChest') ?? bone('chest')
        const sway = Math.sin(time * 0.31) + 0.4 * Math.sin(time * 0.73)
        if (hips) hips.rotation.z = sway * 0.02
        if (spine) spine.rotation.y = Math.sin(time * 0.4) * 0.03 + gesture * Math.sin(time * 1.1) * 0.05
        if (chest) chest.rotation.x = Math.sin(time * 1.3) * 0.016

        // ── Head: looks around; nods when speaking ──
        const head = bone('head')
        if (head) {
          const lookY = Math.sin(time * 0.37) * 0.18 + Math.sin(time * 0.13) * 0.12
          const lookX = Math.sin(time * 0.29) * 0.06
          if (speaking) {
            head.rotation.x = lookX * 0.4 + Math.sin(time * 5.5) * 0.05 + Math.sin(time * 1.3) * 0.03
            head.rotation.y = lookY * 0.5 + Math.sin(time * 0.9) * 0.06
            head.rotation.z = Math.sin(time * 1.1) * 0.02
          } else {
            head.rotation.x = lookX
            head.rotation.y = lookY
            head.rotation.z = Math.sin(time * 0.6) * 0.02
          }
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

// ── Auto-speak: narrate each completed assistant reply ────────────────────────

function useAutoSpeak(chatId: string | null) {
  const status = useSessionStore(s => (chatId ? s.chats[chatId]?.status : undefined))
  const messages = useSessionStore(s => (chatId ? s.chats[chatId]?.messages : undefined))
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const lastSpoken = useRef<string | null>(null)

  useEffect(() => {
    if (!autoSpeak || status !== 'idle' || !messages?.length) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      const text = (m.blocks ?? [])
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join(' ')
        .trim() || m.content
      if (!text) return
      if (m.id !== lastSpoken.current) {
        lastSpoken.current = m.id
        speak(text)
      }
      return
    }
  }, [status, messages, autoSpeak])
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CharacterView({ chatId, slashCommands }: Props) {
  const vrmUrl = useAvatarStore(s => s.vrmUrl)
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const setAutoSpeak = useAvatarStore(s => s.setAutoSpeak)
  const [status, setStatus] = useState<Status>('loading')
  const [zoom, setZoom] = useState<Zoom>('full')
  const [side, setSide] = useState<'left' | 'right'>('left')

  // Chat wiring (same input as the Chat tab → type + speech-to-text + send)
  const { chats, sendMessageStream, interruptChat, setChatModel, setChatPermissionMode, setChatYolo } = useSessionStore()
  const chat = chatId ? chats[chatId] : null
  const streaming = chat?.status === 'streaming'

  useAutoSpeak(chatId)

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
      {/* Stage area */}
      <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-surface2/30 via-bg to-bg">
        {/* 3D stage */}
        <VrmStage url={vrmUrl} zoom={zoom} onStatus={setStatus} />

        {/* Synced subtitle box (left / right of the character) */}
        <Subtitle side={side} />

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

        {/* Top-right: subtitle side + mute */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          <button onClick={() => setSide(s => (s === 'left' ? 'right' : 'left'))}
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
        </div>

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
