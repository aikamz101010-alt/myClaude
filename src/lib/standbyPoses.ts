// VRoid-style standby poses for the idle avatar. Each pose is a set of target
// rotations (radians) for the arm bones, using the same sign conventions as the
// CharacterView animation loop:
//   upperArm.z  : negative lowers the LEFT arm, positive lowers the RIGHT arm
//   upperArm.x  : negative lifts the arm forward/up, positive pushes it back
//   lowerArm.z  : elbow bend (neg for left, pos for right; larger = more bent)
// The render loop lerps toward these so transitions between poses are smooth.

export interface StandbyPose {
  name: string
  lUAz: number; lUAx: number
  rUAz: number; rUAx: number
  lLAz: number; rLAz: number
  spineY?: number   // optional slight torso turn for attitude
  headY?: number    // optional head turn
  wave?: 'l' | 'r'  // (speaking gestures only) wave that hand
}

export const STANDBY_POSES: StandbyPose[] = [
  // Relaxed arms at the sides (the calm default).
  { name: 'rest', lUAz: -1.40, lUAx: 0.05, rUAz: 1.40, rUAx: 0.05, lLAz: -0.15, rLAz: 0.15 },
  // Arms folded across the chest.
  { name: 'arms-crossed', lUAz: -1.05, lUAx: -0.10, rUAz: 1.05, rUAx: -0.10, lLAz: -1.45, rLAz: 1.45 },
  // Right hand presents outward (gesturing aside).
  { name: 'present-right', lUAz: -1.40, lUAx: 0.05, rUAz: 0.78, rUAx: -0.45, lLAz: -0.18, rLAz: 0.40, spineY: -0.05, headY: 0.06 },
  // Both hands up near the head (playful).
  { name: 'hands-up', lUAz: -0.78, lUAx: -1.30, rUAz: 0.78, rUAx: -1.30, lLAz: -1.60, rLAz: 1.60 },
  // Hands clasped in front.
  { name: 'clasped', lUAz: -1.15, lUAx: -0.35, rUAz: 1.15, rUAx: -0.35, lLAz: -1.50, rLAz: 1.50 },
  // Right hand on the hip (confident).
  { name: 'hand-on-hip', lUAz: -1.40, lUAx: 0.05, rUAz: 1.18, rUAx: 0.18, lLAz: -0.15, rLAz: 1.55, spineY: -0.06, headY: 0.05 },
  // Left hand presents outward (mirror of present-right).
  { name: 'present-left', lUAz: -0.78, lUAx: -0.45, rUAz: 1.40, rUAx: 0.05, lLAz: -0.40, rLAz: 0.18, spineY: 0.05, headY: -0.06 },
]

/** Pick a random pose index different from `current`. */
export function nextStandbyPose(current: number): number {
  if (STANDBY_POSES.length <= 1) return 0
  let n = current
  while (n === current) n = Math.floor(Math.random() * STANDBY_POSES.length)
  return n
}

// ── Speaking gestures ─────────────────────────────────────────────────────────
// Cycled while the avatar narrates so gesticulation looks varied and lively
// instead of one repeating motion. Forearms stay in front / raised (clear of the
// skirt). `wave` makes that hand wave. The render loop adds a small live overlay
// on top of each held gesture.
export const SPEAK_GESTURES: StandbyPose[] = [
  // Both hands explaining in front (open, mid height).
  { name: 'explain', lUAz: -1.12, lUAx: -0.55, rUAz: 1.12, rUAx: -0.55, lLAz: -0.90, rLAz: 0.90 },
  // Both hands raised up (emphatic).
  { name: 'both-up', lUAz: -0.85, lUAx: -1.15, rUAz: 0.85, rUAx: -1.15, lLAz: -1.20, rLAz: 1.20 },
  // Right hand up, waving.
  { name: 'wave-right', lUAz: -1.32, lUAx: 0.06, rUAz: 0.70, rUAx: -1.28, lLAz: -0.18, rLAz: 1.30, wave: 'r', headY: 0.05 },
  // Open palms out to the sides (presenting).
  { name: 'open-palms', lUAz: -0.95, lUAx: -0.35, rUAz: 0.95, rUAx: -0.35, lLAz: -0.50, rLAz: 0.50 },
  // Right index pointing up (making a point).
  { name: 'point-up', lUAz: -1.15, lUAx: -0.45, rUAz: 0.60, rUAx: -1.38, lLAz: -0.70, rLAz: 0.85, spineY: -0.05 },
  // Right hand presents to the side, left relaxed.
  { name: 'present-right', lUAz: -1.32, lUAx: 0.06, rUAz: 0.80, rUAx: -0.50, lLAz: -0.18, rLAz: 0.55, spineY: -0.05, headY: 0.05 },
  // Left hand up, waving (mirror).
  { name: 'wave-left', lUAz: -0.70, lUAx: -1.28, rUAz: 1.32, rUAx: 0.06, lLAz: -1.30, rLAz: 0.18, wave: 'l', headY: -0.05 },
  // Hands together in front (counting / itemizing).
  { name: 'count-front', lUAz: -1.10, lUAx: -0.62, rUAz: 1.10, rUAx: -0.62, lLAz: -1.05, rLAz: 1.05 },
]

// ── Dynamic motions ─────────────────────────────────────────────────────────
// Unlike the static poses above, these are TIME-BASED animations the live
// assistant can trigger (e.g. "joget"/dance). Each sets bone rotations directly
// every frame for the duration of the cue, giving lively full-body movement.
type MBone = { rotation: { x: number; y: number; z: number }; position: { x: number; y: number; z: number } } | null | undefined
type Motion = (t: number, bone: (n: string) => MBone) => void

const set = (b: MBone, axis: 'x' | 'y' | 'z', v: number) => { if (b) b.rotation[axis] = v }

export const MOTIONS: Record<string, Motion> = {
  // Upbeat dance — hips sway, arms up bouncing, head bob, knee bounce.
  dance: (t, b) => {
    const beat = t * 7
    set(b('hips'), 'z', Math.sin(beat) * 0.14); set(b('hips'), 'y', Math.sin(beat / 2) * 0.12)
    set(b('spine'), 'z', -Math.sin(beat) * 0.08)
    set(b('leftUpperArm'), 'z', -0.5 + Math.sin(beat) * 0.25); set(b('leftUpperArm'), 'x', -0.9 + Math.sin(beat * 2) * 0.4)
    set(b('rightUpperArm'), 'z', 0.5 - Math.sin(beat) * 0.25); set(b('rightUpperArm'), 'x', -0.9 - Math.sin(beat * 2) * 0.4)
    set(b('leftLowerArm'), 'z', -1.3); set(b('rightLowerArm'), 'z', 1.3)
    set(b('head'), 'z', Math.sin(beat) * 0.12); set(b('head'), 'x', Math.sin(beat * 2) * 0.05)
    set(b('leftUpperLeg'), 'x', Math.max(0, Math.sin(beat)) * 0.3)
    set(b('rightUpperLeg'), 'x', Math.max(0, -Math.sin(beat)) * 0.3)
  },
  // Cheer — both arms up, fists pumping.
  cheer: (t, b) => {
    const p = Math.abs(Math.sin(t * 5))
    set(b('leftUpperArm'), 'z', -0.3); set(b('leftUpperArm'), 'x', -2.4 + p * 0.4)
    set(b('rightUpperArm'), 'z', 0.3); set(b('rightUpperArm'), 'x', -2.4 + p * 0.4)
    set(b('leftLowerArm'), 'z', -1.6); set(b('rightLowerArm'), 'z', 1.6)
    set(b('head'), 'x', -0.1)
  },
  // Clap — forearms meet in front repeatedly.
  clap: (t, b) => {
    const c = (Math.sin(t * 9) + 1) / 2
    set(b('leftUpperArm'), 'z', -1.0); set(b('leftUpperArm'), 'x', -0.7)
    set(b('rightUpperArm'), 'z', 1.0); set(b('rightUpperArm'), 'x', -0.7)
    set(b('leftLowerArm'), 'z', -1.3 - c * 0.4); set(b('rightLowerArm'), 'z', 1.3 + c * 0.4)
  },
  // Bow — gentle repeated bow from the waist.
  bow: (t, b) => {
    const d = (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.5
    set(b('spine'), 'x', d); set(b('chest'), 'x', d * 0.4); set(b('head'), 'x', d * 0.5)
    set(b('leftUpperArm'), 'z', -1.45); set(b('rightUpperArm'), 'z', 1.45)
  },
  // Nod — yes.
  nod: (t, b) => { set(b('head'), 'x', 0.18 + Math.sin(t * 5) * 0.18) },
  // Shake — no.
  shake: (t, b) => { set(b('head'), 'y', Math.sin(t * 5) * 0.3) },
  // Raise hand straight up (acung tangan).
  'raise-hand': (_t, b) => {
    set(b('rightUpperArm'), 'z', 0.2); set(b('rightUpperArm'), 'x', -2.7); set(b('rightLowerArm'), 'z', 0.3)
    set(b('leftUpperArm'), 'z', -1.4); set(b('leftLowerArm'), 'z', -0.15)
  },
  // Wave a raised right hand.
  wave: (t, b) => {
    set(b('rightUpperArm'), 'z', 0.3); set(b('rightUpperArm'), 'x', -2.5)
    set(b('rightLowerArm'), 'z', 0.6 + Math.sin(t * 9) * 0.45)
    set(b('leftUpperArm'), 'z', -1.4)
    set(b('head'), 'z', Math.sin(t * 3) * 0.05)
  },
  // Point up (raised index / making a point).
  'point-up': (_t, b) => {
    set(b('rightUpperArm'), 'z', 0.4); set(b('rightUpperArm'), 'x', -2.6); set(b('rightLowerArm'), 'z', 0.1)
    set(b('leftUpperArm'), 'z', -1.35)
  },
  // Peace / hi near the head.
  peace: (t, b) => {
    set(b('rightUpperArm'), 'z', 0.5); set(b('rightUpperArm'), 'x', -2.0); set(b('rightLowerArm'), 'z', 1.4)
    set(b('leftUpperArm'), 'z', -1.4)
    set(b('head'), 'z', 0.08 + Math.sin(t * 3) * 0.04)
  },
  // Love — both hands up, forearms meeting overhead (heart-ish).
  love: (_t, b) => {
    set(b('leftUpperArm'), 'z', -0.5); set(b('leftUpperArm'), 'x', -2.3); set(b('leftLowerArm'), 'z', -2.0)
    set(b('rightUpperArm'), 'z', 0.5); set(b('rightUpperArm'), 'x', -2.3); set(b('rightLowerArm'), 'z', 2.0)
    set(b('head'), 'x', -0.1)
  },
  // Thinking — hand to chin.
  think: (t, b) => {
    set(b('rightUpperArm'), 'z', 0.95); set(b('rightUpperArm'), 'x', -0.35); set(b('rightLowerArm'), 'z', 1.45)
    set(b('leftUpperArm'), 'z', -1.3); set(b('leftLowerArm'), 'z', -0.3)
    set(b('head'), 'x', -0.1 + Math.sin(t * 0.8) * 0.02); set(b('head'), 'y', 0.1)
  },
  // Sad slump.
  slump: (_t, b) => {
    set(b('spine'), 'x', 0.2); set(b('head'), 'x', 0.25)
    set(b('leftUpperArm'), 'z', -1.45); set(b('rightUpperArm'), 'z', 1.45)
  },
  // Shy — both hands up near face.
  shy: (t, b) => {
    set(b('leftUpperArm'), 'z', -0.7); set(b('leftUpperArm'), 'x', -1.7); set(b('leftLowerArm'), 'z', -1.8)
    set(b('rightUpperArm'), 'z', 0.7); set(b('rightUpperArm'), 'x', -1.7); set(b('rightLowerArm'), 'z', 1.8)
    set(b('head'), 'x', 0.08); set(b('head'), 'z', Math.sin(t * 2) * 0.04)
  },
}

export const MOTION_NAMES = Object.keys(MOTIONS)
export const isMotion = (name: string): boolean => name in MOTIONS

/** Pick a random speaking-gesture index different from `current`. */
export function nextSpeakGesture(current: number): number {
  if (SPEAK_GESTURES.length <= 1) return 0
  let n = current
  while (n === current) n = Math.floor(Math.random() * SPEAK_GESTURES.length)
  return n
}
