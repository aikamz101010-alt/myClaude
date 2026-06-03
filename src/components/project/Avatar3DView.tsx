import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { Volume2, VolumeX, X, Loader2, Bot } from 'lucide-react'
import { useSessionStore } from '@/store/sessionStore'
import { useAvatarStore } from '@/store/avatarStore'
import { lipSync } from '@/lib/lipsync'
import { speak, stopSpeaking } from '@/lib/speak'
import { cn } from '@/lib/utils'

interface Props {
  chatId: string | null
  onClose: () => void
}

type Status = 'loading' | 'ready' | 'error'

// ── Vanilla three.js VRM stage (no global JSX pollution) ──────────────────────
// Implemented imperatively rather than with @react-three/fiber: R3F augments the
// global JSX namespace under React 19, which breaks unrelated components.

function VrmStage({ url, onStatus }: { url: string; onStatus: (s: Status) => void }) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, mount.clientWidth / mount.clientHeight, 0.1, 20)
    camera.position.set(0, 1.32, 1.15)
    camera.lookAt(0, 1.3, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const dir = new THREE.DirectionalLight(0xffffff, 1.3)
    dir.position.set(1, 2, 2)
    scene.add(dir)

    let vrm: VRM | null = null
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
        // Frame the FULL body. Model faces +Z, so the camera sits on the +Z
        // (front) side and pulls back far enough to fit the whole height.
        const box = new THREE.Box3().setFromObject(v.scene)
        const size = new THREE.Vector3(); box.getSize(size)
        const center = new THREE.Vector3(); box.getCenter(center)
        const fovRad = (camera.fov * Math.PI) / 180
        const fitDist = (size.y / 2) / Math.tan(fovRad / 2) * 1.12 + size.z
        camera.position.set(center.x, center.y, box.max.z + fitDist)
        camera.lookAt(center.x, center.y, center.z)
        camera.updateProjectionMatrix()
        vrm = v
        onStatus('ready')
      },
      undefined,
      () => onStatus('error'),
    )

    const clock = new THREE.Clock()
    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      if (vrm) {
        const time = clock.elapsedTime
        const em = vrm.expressionManager
        const speaking = lipSync.speaking
        const H = vrm.humanoid
        const bone = (n: Parameters<NonNullable<typeof H>['getNormalizedBoneNode']>[0]) =>
          H?.getNormalizedBoneNode(n)

        // Facial: lip-sync + periodic blink + subtle smile.
        em?.setValue(VRMExpressionPresetName.Aa, lipSync.mouth())
        const phase = time % 4
        const blink = phase > 3.8 ? Math.sin(((phase - 3.8) / 0.2) * Math.PI) : 0
        em?.setValue(VRMExpressionPresetName.Blink, blink)
        em?.setValue(VRMExpressionPresetName.Happy, speaking ? 0.3 : 0.12)

        // Arms: VRM rest pose is a T-pose — lower the arms to the sides, with a
        // gentle sway + bigger motion while speaking (so it gestures, not stiff).
        const gesture = speaking ? 1 : 0
        const lUA = bone('leftUpperArm'); const rUA = bone('rightUpperArm')
        const lLA = bone('leftLowerArm'); const rLA = bone('rightLowerArm')
        if (lUA) {
          lUA.rotation.z = -1.40 + Math.sin(time * 0.9) * 0.04
          lUA.rotation.x = Math.sin(time * 0.7) * 0.05 + gesture * Math.sin(time * 3.0) * 0.16
        }
        if (rUA) {
          rUA.rotation.z = 1.40 + Math.sin(time * 0.9 + 1.0) * 0.04
          rUA.rotation.x = Math.sin(time * 0.7 + 0.5) * 0.05 + gesture * Math.sin(time * 3.2 + 1) * 0.16
        }
        if (lLA) lLA.rotation.z = -0.20 - gesture * Math.abs(Math.sin(time * 3.0)) * 0.25
        if (rLA) rLA.rotation.z = 0.20 + gesture * Math.abs(Math.sin(time * 3.2 + 1)) * 0.25

        // Body: weight-shift + breathing using incommensurate frequencies so the
        // idle loop never visibly repeats.
        const hips = bone('hips'); const spine = bone('spine')
        const chest = bone('upperChest') ?? bone('chest')
        const sway = Math.sin(time * 0.31) + 0.4 * Math.sin(time * 0.73)
        if (hips) hips.rotation.z = sway * 0.02
        if (spine) spine.rotation.y = Math.sin(time * 0.4) * 0.03 + gesture * Math.sin(time * 1.1) * 0.05
        if (chest) chest.rotation.x = Math.sin(time * 1.3) * 0.016 // breathing

        // Head: looks around naturally (sum of slow sines) + nods when speaking.
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
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url, onStatus])

  return <div ref={mountRef} className="w-full h-full" />
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

export function Avatar3DView({ chatId, onClose }: Props) {
  const vrmUrl = useAvatarStore(s => s.vrmUrl)
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const setAutoSpeak = useAvatarStore(s => s.setAutoSpeak)
  const pos = useAvatarStore(s => s.pos)
  const setPos = useAvatarStore(s => s.setPos)
  const [status, setStatus] = useState<Status>('loading')

  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useAutoSpeak(chatId)

  // Stop narration when the panel unmounts.
  useEffect(() => () => stopSpeaking(), [])

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // let header buttons click
    const panel = panelRef.current
    if (!panel) return
    const parent = panel.offsetParent as HTMLElement | null
    const rect = panel.getBoundingClientRect()
    const prect = parent?.getBoundingClientRect()
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left - (prect?.left ?? 0),
      origY: rect.top - (prect?.top ?? 0),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const panel = panelRef.current
    if (!panel) return
    const parent = panel.offsetParent as HTMLElement | null
    const pw = parent?.clientWidth ?? window.innerWidth
    const ph = parent?.clientHeight ?? window.innerHeight
    const w = panel.offsetWidth
    const h = panel.offsetHeight
    const x = Math.max(0, Math.min(drag.current.origX + (e.clientX - drag.current.startX), pw - w))
    const y = Math.max(0, Math.min(drag.current.origY + (e.clientY - drag.current.startY), ph - h))
    setPos({ x, y })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  // null position → default to top-right corner.
  const positionStyle = pos
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : { right: 16, top: 16 }

  return (
    <div ref={panelRef} style={positionStyle}
      className="absolute z-20 w-60 rounded-2xl border border-white/10 bg-surface/95 backdrop-blur shadow-2xl overflow-hidden flex flex-col select-none">
      {/* Header (drag handle) */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 cursor-move touch-none">
        <span className="flex items-center gap-1.5 text-xs font-mono text-text">
          <Bot className="w-3.5 h-3.5 text-accent" /> Assistant
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { if (autoSpeak) stopSpeaking(); setAutoSpeak(!autoSpeak) }}
            title={autoSpeak ? 'Mute narration' : 'Unmute narration'}
            className={cn('p-1 rounded cursor-pointer transition-colors', autoSpeak ? 'text-accent hover:text-accent/80' : 'text-muted hover:text-text')}>
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} title="Hide avatar" className="p-1 rounded text-muted hover:text-error cursor-pointer transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3D stage (full body) */}
      <div className="relative h-[380px] bg-gradient-to-b from-surface2/40 to-bg/60">
        <VrmStage url={vrmUrl} onStatus={setStatus} />

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-5 h-5 text-muted animate-spin" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center pointer-events-none">
            <Bot className="w-8 h-8 text-muted/50" />
            <p className="text-[11px] leading-snug text-muted font-mono">
              No VRM found. Drop a model at<br />
              <span className="text-text">public/avatar/character.vrm</span><br />
              (make one free in VRoid Studio)
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
