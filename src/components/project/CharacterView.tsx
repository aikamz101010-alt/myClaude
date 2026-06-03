import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { Volume2, VolumeX, Loader2, Bot, Settings, X } from 'lucide-react'
import { useSessionStore, type Message } from '@/store/sessionStore'
import { useAvatarStore } from '@/store/avatarStore'
import { lipSync } from '@/lib/lipsync'
import { enqueueSpeech, resetNarration, markNarrated, stopSpeaking, sanitizeForSpeech } from '@/lib/speak'
import { cn } from '@/lib/utils'
import { ChatInput, type AttachedFile } from './ChatInput'
import { AvatarVoiceSettings } from '@/components/settings/AvatarVoiceSettings'
import { STANDBY_POSES, nextStandbyPose, SPEAK_GESTURES, nextSpeakGesture, type StandbyPose } from '@/lib/standbyPoses'
import { runDirector, ensureLiveAssistantAgent, type Emotion } from '@/lib/liveAssistant'

// A live-assistant performance cue applied for a short window.
interface ActiveCue { emotion: Emotion; gesture: string; until: number }

// Look up a gesture/pose by name (for live-assistant gesture cues).
const POSE_BY_NAME = new Map<string, StandbyPose>(
  [...STANDBY_POSES, ...SPEAK_GESTURES].map(p => [p.name, p]),
)
// Emotion → VRM expression preset.
const EMO_PRESET: Record<Emotion, VRMExpressionPresetName | null> = {
  neutral: null,
  happy: VRMExpressionPresetName.Happy,
  sad: VRMExpressionPresetName.Sad,
  angry: VRMExpressionPresetName.Angry,
  surprised: VRMExpressionPresetName.Surprised,
  relaxed: VRMExpressionPresetName.Relaxed,
}
const EMOTION_KEYS: Emotion[] = ['happy', 'sad', 'angry', 'surprised', 'relaxed']

interface Props {
  chatId: string | null
  slashCommands?: string[]
  active?: boolean   // panel is the visible tab (gates narration + rendering)
}

type Status = 'loading' | 'ready' | 'error'
type Zoom = 'full' | 'three' | 'half' | 'head'


// ── Vanilla three.js VRM stage with walking, gestures & zoom framing ──────────

function VrmStage({ url, zoom, thinkingRef, activeRef, interactiveRef, cueRef, onStatus }: {
  url: string
  zoom: Zoom
  thinkingRef: MutableRefObject<boolean>
  activeRef: MutableRefObject<boolean>
  interactiveRef: MutableRefObject<boolean>
  cueRef: MutableRefObject<ActiveCue | null>
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
    // Eye saccades (gaze darts to a new spot, then holds).
    let gazeX = 0, gazeY = 0, gazeTX = 0, gazeTY = 0, nextSaccadeAt = 0
    // Occasional idle hand gesture.
    let idleGestureUntil = 0, nextIdleGestureAt = 4, idleGestureSide: 'l' | 'r' = 'r'
    // Standby pose cycling (VRoid-style): hold a pose, then switch to a random one.
    let standbyIdx = 0, standbyUntil = 0
    // Speaking-gesture cycling: rotate through hands-up / wave / point / etc.
    let speakIdx = 0, speakUntil = 0, waveSide: 'l' | 'r' | undefined
    // Double-click → glance: the character turns its head toward that screen point.
    let lookYaw = 0, lookPitch = 0, lookUntil = 0
    // Hover → the head gently follows the cursor while it's over the stage.
    let hoverYaw = 0, hoverPitch = 0, hovering = false

    const lerpRot = (
      b: THREE.Object3D | null | undefined,
      axis: 'x' | 'y' | 'z',
      target: number,
      k = 0.18,
    ) => { if (b) b.rotation[axis] += (target - b.rotation[axis]) * k }

    // Double-click anywhere on the stage → the character glances at that point.
    const onDblClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1   // -1 (left) .. 1 (right)
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1   // -1 (top) .. 1 (bottom)
      // head.rotation.y > 0 turns the face toward screen-right, so use +nx to
      // look toward the side the cursor is actually on.
      lookYaw = THREE.MathUtils.clamp(nx, -1, 1) * 0.8           // turn head toward the clicked side
      lookPitch = THREE.MathUtils.clamp(ny, -1, 1) * 0.5         // tilt up/down toward it
      lookUntil = clock.elapsedTime + 3.5                        // hold the glance briefly
    }
    renderer.domElement.addEventListener('dblclick', onDblClick)

    // Hover → gentle continuous head-follow toward the cursor.
    const onMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1
      hoverYaw = THREE.MathUtils.clamp(nx, -1, 1) * 0.5    // +nx: follow the cursor's actual side
      hoverPitch = THREE.MathUtils.clamp(ny, -1, 1) * 0.32
      hovering = true
    }
    const onMouseLeave = () => { hovering = false }
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('mouseleave', onMouseLeave)

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

        // ── Standby: stand centered and strike poses — no pacing left/right ──
        const targetX = 0
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
        // Emotion: a live-assistant cue overrides the default subtle smile.
        const cueNow = cueRef.current
        const cueActive = !!cueNow && Date.now() < cueNow.until
        const emo: Emotion = cueActive ? cueNow!.emotion : 'happy'
        const emoLevel = cueActive ? 0.7 : speaking ? 0.3 : thinking ? 0.05 : 0.12
        for (const k of EMOTION_KEYS) {
          const preset = EMO_PRESET[k]
          if (preset) { try { em?.setValue(preset, emo === k ? emoLevel : 0) } catch { /* missing expr */ } }
        }

        // ── Eyes: lively gaze. Thinking → steady up-aside ponder; otherwise the
        // eyes dart to a new target every 1-3s (saccade) then hold. ──
        const interactive = interactiveRef.current
        const lookActive = time < lookUntil
        if (thinking) {
          gazeTX = -0.3; gazeTY = -0.35
        } else if (lookActive || hovering) {
          gazeTX = 0; gazeTY = 0   // eyes forward along the turned/following head
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

        // ── Arm pose targets per mode (lerped → smooth transitions) ──
        // Note on clipping: forearms are lifted FORWARD (negative upper-arm X +
        // strong elbow bend) so the hands sit in front of the torso, clear of the
        // skirt mesh, instead of hanging down into it.
        let lUAz: number, lUAx: number, rUAz: number, rUAx: number, lLAz: number, rLAz: number
        if (thinking) {
          // Pondering: right hand up toward the chin, left arm relaxed down.
          rUAz = 0.95; rUAx = -0.35 + Math.sin(time * 0.8) * 0.03; rLAz = 1.45
          lUAz = -1.30; lUAx = 0.08; lLAz = -0.30
        } else if (speaking) {
          // Talking: cycle through a repertoire of gestures (hands up, wave,
          // open palms, point, present…) so it looks natural, not one fixed loop.
          // A small live overlay keeps each held gesture breathing.
          if (time > speakUntil) {
            speakIdx = speakUntil === 0 ? 0 : nextSpeakGesture(speakIdx)
            speakUntil = time + 1.8 + Math.random() * 1.6   // 1.8–3.4s per gesture
          }
          const g = SPEAK_GESTURES[speakIdx]
          waveSide = g.wave
          const o = Math.sin(time * 2.7)          // emphasis beat
          const o2 = Math.sin(time * 3.6 + 1.0)
          lUAz = g.lUAz + o * 0.06
          lUAx = g.lUAx + o2 * 0.12
          rUAz = g.rUAz - o * 0.06
          rUAx = g.rUAx + o2 * 0.12
          lLAz = g.lLAz - Math.abs(o) * 0.18
          rLAz = g.rLAz + Math.abs(o) * 0.18
        } else {
          waveSide = undefined
          // Standby: cycle through VRoid-style poses — hold one a few seconds,
          // then smoothly transition to a random different pose. A subtle breath
          // keeps the held pose from looking frozen.
          if (time > standbyUntil) {
            standbyIdx = standbyUntil === 0 ? 0 : nextStandbyPose(standbyIdx)
            standbyUntil = time + 5 + Math.random() * 4   // hold 5–9s
          }
          const p = STANDBY_POSES[standbyIdx]
          const breath = Math.sin(time * 0.9) * 0.03
          lUAz = p.lUAz + breath; lUAx = p.lUAx
          rUAz = p.rUAz - breath; rUAx = p.rUAx
          lLAz = p.lLAz; rLAz = p.rLAz
        }
        // Live-assistant gesture cue: hold the chosen gesture while active.
        if (cueActive && cueNow!.gesture && cueNow!.gesture !== 'none') {
          const gp = POSE_BY_NAME.get(cueNow!.gesture)
          if (gp) {
            lUAz = gp.lUAz; lUAx = gp.lUAx; rUAz = gp.rUAz; rUAx = gp.rUAx
            lLAz = gp.lLAz; rLAz = gp.rLAz
            waveSide = gp.wave
          }
        }
        // Faster lerp while speaking so the gesticulation is clearly visible.
        const armK = speaking ? 0.30 : 0.16
        lerpRot(lUA, 'z', lUAz, armK); lerpRot(lUA, 'x', lUAx, armK)
        lerpRot(rUA, 'z', rUAz, armK); lerpRot(rUA, 'x', rUAx, armK)
        lerpRot(lLA, 'z', lLAz, armK); lerpRot(rLA, 'z', rLAz, armK)

        // Hands/wrists: subtle idle motion + varied flicks while speaking, and a
        // brisk side-to-side wave on the raised hand when the gesture calls for it.
        const hw = interactive ? 1 : 0
        const speakHand = speaking ? Math.sin(time * 4.2) * 0.16 + Math.sin(time * 6.7) * 0.06 : 0
        const wave = Math.sin(time * 7) * 0.5
        const lWave = waveSide === 'l' ? wave : 0
        const rWave = waveSide === 'r' ? wave : 0
        const lHand = bone('leftHand'); const rHand = bone('rightHand')
        if (lHand) lHand.rotation.z = Math.sin(time * 1.7) * 0.06 * hw + speakHand + lWave - (idleGestureSide === 'l' ? idleG * 0.25 : 0)
        if (rHand) rHand.rotation.z = Math.sin(time * 1.9 + 1) * 0.06 * hw - speakHand + rWave + (idleGestureSide === 'r' ? idleG * 0.25 : 0)

        // ── Body: weight shift + breathing ──
        const hips = bone('hips'); const spine = bone('spine')
        const chest = bone('upperChest') ?? bone('chest')
        const sway = Math.sin(time * 0.31) + 0.4 * Math.sin(time * 0.73)
        if (hips) hips.rotation.z = sway * 0.02
        if (spine) spine.rotation.y = Math.sin(time * 0.4) * 0.03 + (speaking ? Math.sin(time * 1.1) * 0.06 : 0)
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
          if (lookActive) { hy = lookYaw; hx = lookPitch; hz = 0 }            // double-click glance (priority)
          else if (hovering && !thinking && !speaking) { hy = hoverYaw; hx = hoverPitch; hz = 0 } // hover-follow
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
      renderer.domElement.removeEventListener('dblclick', onDblClick)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url, onStatus])

  return <div ref={mountRef} className="w-full h-full" />
}

// ── Subtitle: reveal words in sync with TTS playback progress ─────────────────

function Subtitle({ side }: { side: 'left' | 'right' }) {
  const hideSec = useAvatarStore(s => s.captionHideSec)
  const [shown, setShown] = useState('')
  const endedAtRef = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      const cap = lipSync.caption
      if (!cap) { setShown(''); endedAtRef.current = 0; return }
      const words = cap.split(' ')
      const n = Math.max(1, Math.ceil(lipSync.progress() * words.length))
      const full = words.slice(0, n).join(' ')
      if (lipSync.speaking) {
        endedAtRef.current = 0
        setShown(full)
      } else {
        // Speech finished but caption still set → optionally auto-hide after a delay.
        if (endedAtRef.current === 0) endedAtRef.current = Date.now()
        const expired = hideSec > 0 && Date.now() - endedAtRef.current > hideSec * 1000
        setShown(expired ? '' : full)
      }
    }, 80)
    return () => clearInterval(id)
  }, [hideSec])

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

// ── Streaming narration: speak sentences AS they arrive (low latency) ─────────
// Instead of waiting for the whole reply to finish, narrate each completed
// sentence while Claude is still streaming, then flush the remainder when done.

function useStreamNarration(chatId: string | null, active: boolean) {
  const status = useSessionStore(s => (chatId ? s.chats[chatId]?.status : undefined))
  const messages = useSessionStore(s => (chatId ? s.chats[chatId]?.messages : undefined))
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const narrationLimit = useAvatarStore(s => s.narrationLimit)
  const msgIdRef = useRef<string | null>(null)
  const spokenRef = useRef(0)   // chars of sanitized text already enqueued

  useEffect(() => {
    if (!active || !autoSpeak || !messages?.length) return
    const msgs = messages
    let m: (typeof msgs)[number] | null = null
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { m = msgs[i]; break }
    }
    if (!m) return

    // New assistant message → reset the narration queue and progress.
    if (m.id !== msgIdRef.current) {
      const firstSight = msgIdRef.current === null
      msgIdRef.current = m.id
      resetNarration()
      markNarrated(m.id)   // so the floating avatar won't re-speak it
      if (firstSight && status === 'idle') {
        // Panel opened on an already-finished reply → don't re-read it aloud.
        spokenRef.current = Number.MAX_SAFE_INTEGER
        return
      }
      spokenRef.current = 0
    }

    const raw = (m.blocks ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim() || m.content
    let full = sanitizeForSpeech(raw)            // unlimited clean prose
    if (narrationLimit > 0) full = full.slice(0, narrationLimit)

    // While streaming, only narrate up to the last completed sentence; once the
    // reply is done, flush everything that remains.
    let upTo: number
    if (status === 'idle') {
      upTo = full.length
    } else {
      const b = Math.max(
        full.lastIndexOf('. '), full.lastIndexOf('! '), full.lastIndexOf('? '),
        full.lastIndexOf('… '), full.lastIndexOf('.\n'), full.lastIndexOf('\n\n'),
      )
      upTo = b >= 0 ? b + 1 : 0
    }
    if (upTo > spokenRef.current) {
      const piece = full.slice(spokenRef.current, upTo).trim()
      spokenRef.current = upTo
      if (piece) enqueueSpeech(piece)
    }
  }, [status, messages, autoSpeak, active, narrationLimit])
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

// ── Live Assistant: a separate-session director picks emotion+gesture per reply ─
function useLiveAssistant(chatId: string | null, active: boolean, cueRef: MutableRefObject<ActiveCue | null>) {
  const status = useSessionStore(s => (chatId ? s.chats[chatId]?.status : undefined))
  const messages = useSessionStore(s => (chatId ? s.chats[chatId]?.messages : undefined))
  const workingDir = useSessionStore(s => (chatId ? s.chats[chatId]?.workingDir : undefined))
  const liveAssistant = useAvatarStore(s => s.liveAssistant)
  const lastId = useRef<string | null>(null)

  // (Re)generate the local agent file whenever Live Assistant is enabled.
  useEffect(() => {
    if (liveAssistant && active && workingDir) void ensureLiveAssistantAgent(workingDir)
  }, [liveAssistant, active, workingDir])

  useEffect(() => {
    const msgs = messages
    if (!active || !liveAssistant || status !== 'idle' || !msgs?.length) return
    let msg: Message | undefined
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { msg = msgs[i]; break }
    }
    if (!msg || msg.id === lastId.current) return
    lastId.current = msg.id
    const text = (msg.blocks ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text).join(' ').trim() || msg.content
    if (!text) return
    void runDirector(text, workingDir || '.').then(cue => {
      if (cue) cueRef.current = { ...cue, until: Date.now() + 8000 }
    })
  }, [status, messages, active, liveAssistant]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function CharacterView({ chatId, slashCommands, active = true }: Props) {
  const vrmUrl = useAvatarStore(s => s.vrmUrl)
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const setAutoSpeak = useAvatarStore(s => s.setAutoSpeak)
  // Persisted Character-panel view settings.
  const zoom = useAvatarStore(s => s.zoom)
  const side = useAvatarStore(s => s.subtitleSide)
  const showLog = useAvatarStore(s => s.showLog)
  const interactive = useAvatarStore(s => s.interactive)
  const [status, setStatus] = useState<Status>('loading')
  const [showSettings, setShowSettings] = useState(false)

  // Chat wiring (same input as the Chat tab → type + speech-to-text + send)
  const { chats, sendMessageStream, interruptChat, setChatModel, setChatPermissionMode, setChatYolo } = useSessionStore()
  const chat = chatId ? chats[chatId] : null
  const streaming = chat?.status === 'streaming'

  // Show the thinking pose IMMEDIATELY on submit (before the stream status flips),
  // for both typed and voice input.
  const [pending, setPending] = useState(false)
  const thinking = pending || !!streaming
  useEffect(() => {
    if (!streaming) return
    setPending(false)   // stream started → it drives the thinking state now
  }, [streaming])

  // Live state read by the render loop (refs avoid re-creating the three.js scene).
  const thinkingRef = useRef(false)
  thinkingRef.current = thinking   // waiting for / receiving a reply → thinking pose, no walking
  const activeRef = useRef(active)
  activeRef.current = active
  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive
  const cueRef = useRef<ActiveCue | null>(null)

  useStreamNarration(chatId, active)
  useLiveAssistant(chatId, active, cueRef)

  // Stop narration when leaving the panel; also stop if the tab is hidden.
  useEffect(() => { if (!active) resetNarration() }, [active])
  useEffect(() => () => stopSpeaking(), [])

  const handleSend = (text: string, files: AttachedFile[]) => {
    if (!chatId) return
    setPending(true)   // react instantly: think now, answer when Claude responds
    const fileRefs = files.map(f => `@${f.path}`).join(' ')
    const full = fileRefs ? `${fileRefs}\n${text}` : text
    sendMessageStream(chatId, full)
  }

  // Safety: clear a stuck pending state if no stream starts within a few seconds.
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setPending(false), 8000)
    return () => clearTimeout(t)
  }, [pending])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Stage + transcript */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stage area */}
        <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-surface2/30 via-bg to-bg">
          {/* 3D stage */}
          <VrmStage url={vrmUrl} zoom={zoom} thinkingRef={thinkingRef} activeRef={activeRef} interactiveRef={interactiveRef} cueRef={cueRef} onStatus={setStatus} />

          {/* Synced subtitle box (left / right of the character) */}
          <Subtitle side={side} />

          {/* Thinking indicator */}
          {thinking && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-bg/80 backdrop-blur border border-white/10 px-3 py-1.5">
              <span className="flex gap-1">
                {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </span>
              <span className="text-xs font-mono text-muted">sedang berpikir…</span>
            </div>
          )}

          {/* Top-right: mute + settings */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
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
