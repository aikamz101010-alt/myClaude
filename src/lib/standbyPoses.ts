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

/** Pick a random speaking-gesture index different from `current`. */
export function nextSpeakGesture(current: number): number {
  if (SPEAK_GESTURES.length <= 1) return 0
  let n = current
  while (n === current) n = Math.floor(Math.random() * SPEAK_GESTURES.length)
  return n
}
