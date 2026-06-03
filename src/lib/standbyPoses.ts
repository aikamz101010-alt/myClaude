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
