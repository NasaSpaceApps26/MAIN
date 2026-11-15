import { type PerspectiveCamera, Vector3 } from 'three'

/**
 * The flight overview: after liftoff the camera starts where it is (close to the rocket) and pulls
 * back until Earth, the Moon and the Moon where the flight meets it are all in view, so the whole
 * manoeuvre (parking orbit, translunar injection, coast, lunar orbit) can be watched as one picture.
 */

/** Asks the space view for the overview: `request` goes up on every ask (see showFlightOverview). */
export const overviewRequests = { request: 0, handled: 0 }

/** How long the camera takes to pull back from the rocket to the overview, real seconds. */
const PAN_S = 5

const UP = new Vector3(0, 1, 0)

/** A point to keep in view, relative to Earth's drawn centre, with the room it needs around it. */
export type FramePoint = { p: Vector3; r: number }

/** Where the overview camera looks from: `center` (relative to Earth) seen from `dir`, `dist` away. */
export type OverviewFrame = { center: Vector3; dir: Vector3; dist: number }

const along = new Vector3()
const side = new Vector3()
const across = new Vector3()

/**
 * Framing that shows every point: seen from above the orbit on the side facing the Sun (so Earth
 * and the Moon are lit), turned so the line from Earth to the last point (the Moon at the end of
 * the flight) runs across the screen, as far back as needed for everything to fit.
 */
export function overviewFrame(
  earthWorld: Vector3,
  points: FramePoint[],
  camera: PerspectiveCamera,
  out: OverviewFrame,
): OverviewFrame {
  const last = points[points.length - 1].p
  along.set(last.x, 0, last.z).normalize() // the Earth–Moon line, flat in the ecliptic
  if (along.lengthSq() === 0) along.set(1, 0, 0)
  side.crossVectors(along, UP).normalize()
  // the Sun is at the origin: look from its side
  if (side.dot(earthWorld) > 0) side.negate()
  out.dir.copy(side).multiplyScalar(0.8).add(UP).normalize()
  across.crossVectors(out.dir, along).normalize() // "up" on the screen

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const { p, r } of points) {
    const x = p.dot(along)
    const y = p.dot(across)
    minX = Math.min(minX, x - r)
    maxX = Math.max(maxX, x + r)
    minY = Math.min(minY, y - r)
    maxY = Math.max(maxY, y + r)
  }
  out.center
    .copy(along)
    .multiplyScalar((minX + maxX) / 2)
    .addScaledVector(across, (minY + maxY) / 2)

  // Far enough back that every point is inside the picture. A point nearer the camera than the
  // middle of the picture (`depth` > 0) looks further out from the middle, so it needs more room.
  const tanH = Math.tan(((camera.fov ?? 50) / 2) * (Math.PI / 180))
  const tanW = tanH * (camera.aspect ?? 16 / 9)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let dist = 0
  for (const { p, r } of points) {
    const depth = p.dot(out.dir) - out.center.dot(out.dir)
    const dx = Math.abs(p.dot(along) - cx) + r
    const dy = Math.abs(p.dot(across) - cy) + r
    dist = Math.max(dist, depth + (dx * 1.15) / tanW, depth + (dy * 1.15) / tanH)
  }
  out.dist = dist
  return out
}

/** Gentle start, gentle stop. */
const ease = (u: number) => u * u * u * (u * (u * 6 - 15) + 10)

const look = new Vector3()
const dir = new Vector3()

/**
 * The pull-back itself. Everything is measured from Earth's drawn centre, so the camera moves
 * along with Earth while it pulls back.
 */
export class OverviewPan {
  running = false
  private t = 0
  private readonly fromDir = new Vector3()
  private fromDist = 1
  cameraRequestN = 0 // the camera-view button count when the pan started: a new press stops it

  /**
   * Start from where the camera is now: `fromOffset` = the camera's position minus the rocket's.
   * (After the launch site window the camera is already close behind the rocket, so there is no jump.)
   */
  start(fromOffset: Vector3, cameraRequestN: number) {
    this.fromDist = Math.max(fromOffset.length(), 1e-9)
    this.fromDir.copy(fromOffset).divideScalar(this.fromDist)
    if (this.fromDir.lengthSq() === 0) this.fromDir.copy(UP)
    this.cameraRequestN = cameraRequestN
    this.t = 0
    this.running = true
  }

  /**
   * One frame of the pan. `rocket` = the rocket relative to Earth's centre, `frame` = the overview.
   * Returns true on the frame it finishes.
   */
  update(dt: number, camera: PerspectiveCamera, earthWorld: Vector3, rocket: Vector3, frame: OverviewFrame) {
    if (!this.running) return false
    this.t += Math.min(dt, 0.1)
    const u = Math.min(this.t / PAN_S, 1)
    const e = ease(u)
    // first rise straight back from the rocket, then turn toward the middle of the picture
    // (turning right away would sweep the view across Earth's surface)
    look.lerpVectors(rocket, frame.center, ease(Math.max(0, (u - 0.2) / 0.8)))
    dir.lerpVectors(this.fromDir, frame.dir, e)
    if (dir.lengthSq() < 1e-12) dir.copy(frame.dir)
    dir.normalize()
    // zoom out evenly: every second the distance grows by the same factor
    const dist = Math.exp(Math.log(this.fromDist) + (Math.log(frame.dist) - Math.log(this.fromDist)) * e)
    look.add(earthWorld)
    camera.position.copy(look).addScaledVector(dir, dist)
    camera.lookAt(look)
    if (u >= 1) {
      this.running = false
      return true
    }
    return false
  }
}
