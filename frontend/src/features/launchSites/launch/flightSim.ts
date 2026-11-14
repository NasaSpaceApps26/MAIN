/**
 * One rocket's launch, stepped every frame: countdown, ignition, liftoff, pitch-over, booster and
 * stage separation, falling spent stages, and all the smoke (vapour, steam, pad exhaust, trails).
 * Works in world space: the rocket starts where its anchor on the pad is.
 */
import { Color, Euler, Fog, Group, PointLight, Quaternion, Scene, Vector3 } from 'three'
import { rocketDims, smoothstep } from '../models/lib'
import type { RocketProps } from '../models/vehicles'
import { FLAME_LOOK, type Burn } from './flameLook'
import { tracker, type LaunchPhase } from './launchStore'
import { ParticlePool, type Shade } from './particles'
import { TRENCH, type EngineKind, type FlightProfile } from './profiles'

const UP = new Vector3(0, 1, 0)
const TRENCH_ANGLE = Math.atan2(TRENCH[1], TRENCH[0])
const GRAVITY = 2.6 // units/s² for falling stages (exaggerated so they visibly drop away)

const hex = (from: string, to: string): Shade => ({ from: new Color(from), to: new Color(to) })
const SHADES = {
  ground: hex('#ffd29a', '#d3cfc6'),
  groundSolid: hex('#ffc890', '#c4bbaa'),
  steam: hex('#ffffff', '#f3f5f7'),
  vapor: hex('#ffffff', '#eaf0f5'),
  fire: hex('#fff0a0', '#ff8a2a'),
  puff: hex('#ffffff', '#e4e6e8'),
}
/** Trail look per propellant: puff spacing along the path, final size (× nozzle radius), lifetime. */
const TRAIL: Record<EngineKind, { spacing: number; size: number; life: number; shade: Shade }> = {
  solid: { spacing: 0.16, size: 6, life: 11, shade: hex('#ffe4b8', '#efede8') },
  kerosene: { spacing: 0.24, size: 4, life: 8, shade: hex('#ffe2bc', '#dedad3') },
  hydrogen: { spacing: 0.45, size: 2, life: 2.5, shade: hex('#fff6ec', '#f8f9fa') },
}

/** A piece that flies with the stack until it separates, then falls on its own and tumbles. */
export type Piece = {
  free: boolean
  pos: Vector3 // origin of the rocket's frame for this piece
  quat: Quaternion
  vel: Vector3
  axis: Vector3 // tumble axis (world) and rate, rad/s
  rate: number
  pivot: Vector3 // tumbles around this point, rocket frame
  burn: Burn
  group: Group | null
}

const makePiece = (pivot: Vector3): Piece => ({
  free: false,
  pos: new Vector3(),
  quat: new Quaternion(),
  vel: new Vector3(),
  axis: new Vector3(1, 0, 0),
  rate: 0,
  pivot,
  burn: { throttle: 0, expand: 0 },
  group: null,
})

/** Trail emitter: puffs dropped along a nozzle's path, evenly spaced however fast it moves. */
type Emitter = { offset: Vector3; radius: number; kind: EngineKind; last: Vector3; carry: number }

type Report = (s: { phase: LaunchPhase; clock: number; event: string }) => void

// scratch objects reused every frame
const v1 = new Vector3()
const v2 = new Vector3()
const v3 = new Vector3()
const q1 = new Quaternion()
const q2 = new Quaternion()

export class FlightSim {
  readonly dims: ReturnType<typeof rocketDims>
  readonly stage1: Piece
  readonly upper: Piece
  readonly boosters: Piece[]
  readonly coreRadius: number
  readonly pool: ParticlePool
  private light: PointLight | null = null

  private readonly P: FlightProfile
  private readonly track: boolean
  private readonly report: Report
  private readonly emitters: Emitter[]
  private readonly size: number // how big the pad cloud is: heavier rockets make far more
  private readonly events: [number, string][]

  private init = false
  private done = false
  private t: number // seconds from liftoff
  private readonly p0 = new Vector3() // base of the rocket on the pad
  private readonly q0 = new Quaternion()
  private readonly d0 = new Vector3() // initial axis (tilted on a rail launcher)
  private theta0 = 0
  private readonly heading = new Vector3()
  private readonly pos = new Vector3()
  private readonly quat = new Quaternion()
  private readonly dir = new Vector3(0, 1, 0)
  private v = 0 // speed along the path
  private s = 0 // path length flown
  private boostersOff = false
  private staged = false
  private readonly acc = { ground: 0, steam: 0, vapor: 0, fire: 0 }
  private reportKey = ''

  constructor(rocket: RocketProps, profile: FlightProfile, track: boolean, report: Report) {
    const P = (this.P = profile)
    this.track = track
    this.report = report
    this.t = -P.countdown
    const dims = (this.dims = rocketDims(rocket))
    const rot = new Euler(...(rocket.rotation ?? [0, 0, 0]))
    const nb = dims.boosterAt.length
    this.stage1 = makePiece(new Vector3(0, dims.y1 + dims.s1 / 2, 0))
    this.upper = makePiece(new Vector3())
    this.boosters = dims.boosterAt.map((b) =>
      makePiece(new Vector3(b.x, dims.bh / 2, b.z).applyEuler(rot)),
    )
    this.coreRadius = (rocket.engines ?? 1) > 1 ? dims.radius * 0.85 : dims.radius * 0.6
    // trails start near the tip of the flame, so the smoke does not hide it
    const coreFlame = this.coreRadius * FLAME_LOOK[P.core].length * 0.6
    const boosterKind = P.boosters ?? 'solid'
    const boosterFlame = dims.boosterRadius * 0.75 * FLAME_LOOK[boosterKind].length * 0.6
    this.emitters = [
      {
        offset: new Vector3(0, -coreFlame, 0),
        radius: dims.radius,
        kind: P.core,
        last: new Vector3(),
        carry: 0,
      },
      ...dims.boosterAt.map((b) => ({
        offset: new Vector3(b.x, -boosterFlame, b.z).applyEuler(rot),
        radius: dims.boosterRadius * 1.1,
        kind: boosterKind,
        last: new Vector3(),
        carry: 0,
      })),
    ]
    this.size = Math.min(2.6, Math.max(0.55, (dims.radius + nb * dims.boosterRadius * 0.8) / 0.3))
    this.pool = new ParticlePool(nb ? 3600 : 2600)

    // time when the rocket clears the tower, for the event log
    let tClear = 0
    for (let v = 0, s = 0; s < dims.height * 1.3 && tClear < 30; tClear += 0.05) {
      v += (P.accel + P.jerk * tClear) * 0.05
      s += v * 0.05
    }
    const sounding = P.burnout !== undefined
    const events: [number, string][] = [[-Infinity, 'Countdown']]
    if (!sounding) events.push([-P.hold - 0.8, 'Sound suppression water on'])
    if (P.hold > 0) events.push([-P.hold, 'Engine ignition'])
    events.push([0, sounding ? 'Launch' : 'Liftoff'])
    if (P.roll) events.push([1.5, 'Roll program'])
    if (!sounding) events.push([tClear, 'Tower cleared'])
    if (P.stageSep)
      events.push([Math.min(P.stageSep * 0.5, (P.boosterSep ?? Infinity) - 1.5), 'Max Q'])
    if (P.boosterSep) events.push([P.boosterSep, 'Booster separation'])
    if (P.stageSep)
      events.push([P.stageSep, 'Stage separation'], [P.stageSep + 1.2, 'Second stage ignition'])
    if (P.burnout) events.push([P.burnout, 'Motor burnout, coasting'])
    events.push([P.duration, P.endEvent ?? 'Out of sight'])
    this.events = events.sort((a, b) => a[0] - b[0])
  }

  private get pieces() {
    return [this.stage1, this.upper, ...this.boosters]
  }

  /** Scene objects this flight moves: the pieces' groups and the flame light. */
  setGroup(piece: 'stage1' | 'upper' | number, group: Group | null) {
    const p =
      piece === 'stage1' ? this.stage1 : piece === 'upper' ? this.upper : this.boosters[piece]
    p.group = group
  }

  setLight(light: PointLight | null) {
    this.light = light
  }

  /** First frame: read where the rocket stands from its anchor on the pad. */
  private start(anchor: Group, scene: Scene) {
    const { P } = this
    anchor.updateWorldMatrix(true, false)
    anchor.matrixWorld.decompose(this.p0, this.q0, v1)
    this.d0.copy(UP).applyQuaternion(this.q0)
    this.theta0 = Math.acos(Math.min(1, this.d0.y))
    this.heading.set(this.d0.x, 0, this.d0.z)
    if (this.theta0 > 0.02) this.heading.normalize()
    else this.heading.set(P.heading[0], 0, P.heading[1]).normalize()
    this.pos.copy(this.p0)
    this.quat.copy(this.q0)
    this.dir.copy(this.d0)
    for (const e of this.emitters) e.last.copy(e.offset).applyQuaternion(this.quat).add(this.pos)
    const fog = scene.fog as Fog | null
    if (fog) this.pool.haze.copy(fog.color)
    if (this.track) {
      tracker.owner = this
      tracker.active = true
      tracker.cut = false
      tracker.base.copy(this.p0)
      tracker.heading.copy(this.heading)
      tracker.height = Math.max(this.dims.height, 8) // small rockets: frame their trail and salvo too
      tracker.focus
        .copy(this.dir)
        .multiplyScalar(this.dims.height * 0.5)
        .add(this.pos)
    }
    for (const p of this.pieces) if (p.group) p.group.visible = true
    this.init = true
  }

  step(rawDt: number, anchor: Group | null, scene: Scene) {
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    if (!this.init) {
      if (!anchor) return
      this.start(anchor, scene)
    }
    this.t += dt
    const { P, dims, stage1, upper, boosters } = this
    const T = this.t
    const r = dims.radius

    // --- engines -----------------------------------------------------------------------------
    const expand = Math.min(1.6, Math.max(0, (this.pos.y - this.p0.y) / 260))
    const ramp = (b: Burn, on: boolean, solid: boolean) => {
      const target = on && !this.done ? 1 : 0
      const speed = target > b.throttle ? (solid ? 18 : 2.5) : 9
      b.throttle += (target - b.throttle) * Math.min(1, dt * speed)
      b.expand = expand
    }
    const coreSolid = P.core === 'solid'
    const coreOn =
      T >= (coreSolid ? 0 : -P.hold) &&
      !(P.stageSep !== undefined && T > P.stageSep - 0.3) &&
      !(P.burnout !== undefined && T > P.burnout)
    ramp(stage1.burn, coreOn && !stage1.free, coreSolid)
    const bSolid = (P.boosters ?? 'solid') === 'solid'
    for (const b of boosters)
      ramp(
        b.burn,
        T >= (bSolid ? 0 : -P.hold) && !(P.boosterSep !== undefined && T > P.boosterSep - 0.4),
        bSolid,
      )
    ramp(upper.burn, P.stageSep !== undefined && T > P.stageSep + 1.2, false)
    upper.burn.expand = 0.6 + expand * 0.5

    // --- motion --------------------------------------------------------------------------------
    const prevPos = v3.copy(this.pos)
    if (T >= 0 && !this.done) {
      const coasting =
        P.burnout !== undefined
          ? T > P.burnout
          : P.stageSep !== undefined && T > P.stageSep - 0.3 && T < P.stageSep + 1.2
      this.v = Math.max(0, this.v + (coasting ? -1.4 : P.accel + P.jerk * T) * dt)
      this.s += this.v * dt
      // tip over gradually downrange as the path gets longer
      const thetaMax = Math.max(P.pitchMax, this.theta0)
      const theta =
        this.theta0 + (thetaMax - this.theta0) * smoothstep(P.pitchStart, P.pitchEnd, this.s)
      this.dir
        .copy(UP)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(this.heading, Math.sin(theta))
      this.pos.addScaledVector(this.dir, this.v * dt)
      q1.setFromUnitVectors(this.d0, this.dir)
      q2.setFromAxisAngle(UP, P.roll * smoothstep(1.5, 5, T))
      this.quat.copy(q1).multiply(this.q0).multiply(q2)
    }
    const bodyVel = v2.copy(this.pos).sub(prevPos).divideScalar(dt)

    // --- separations ---------------------------------------------------------------------------
    if (P.boosterSep !== undefined && T >= P.boosterSep && !this.boostersOff) {
      this.boostersOff = true
      for (const b of boosters) {
        b.free = true
        b.pos.copy(this.pos)
        b.quat.copy(this.quat)
        const out = v1.set(b.pivot.x, 0, b.pivot.z).normalize().applyQuaternion(this.quat)
        b.vel.copy(bodyVel).addScaledVector(out, 2.6).addScaledVector(this.dir, -1.2)
        b.axis.crossVectors(this.dir, out).normalize()
        b.rate = 0.8
        this.puff(
          v1.copy(b.pivot).multiplyScalar(1.8).applyQuaternion(this.quat).add(this.pos),
          14,
          r,
        )
      }
    }
    if (P.stageSep !== undefined && T >= P.stageSep && !this.staged) {
      this.staged = true
      stage1.free = true
      stage1.pos.copy(this.pos)
      stage1.quat.copy(this.quat)
      stage1.vel.copy(bodyVel).addScaledVector(this.dir, -2.5)
      stage1.axis.set(1, 0, 0).applyQuaternion(this.quat)
      stage1.rate = 0.35
      this.puff(v1.copy(this.dir).multiplyScalar(dims.y3).add(this.pos), 22, r)
    }
    for (const p of this.pieces) this.place(p, dt)

    // --- smoke, steam and exhaust ----------------------------------------------------------------
    this.emitSmoke(dt, T)
    this.pool.update(dt)

    // --- light from the flames on the pad and the smoke -----------------------------------------
    const thrust = this.thrust()
    if (this.light) {
      const lit = this.done ? 0 : !stage1.free ? thrust : upper.burn.throttle * 0.15
      this.light.intensity = lit * 260 * this.size * (0.9 + 0.2 * Math.random())
      this.light.position.copy(this.dir).multiplyScalar(-1.2).add(this.pos)
    }

    // --- end of the flight, camera tracking and the mission clock -------------------------------
    // the animation ends here: the rocket goes, the camera cuts back to the overview (see tracker.cut)
    if (T >= P.duration && !this.done) {
      this.done = true
      for (const p of this.pieces) if (p.group) p.group.visible = false
      if (this.track && tracker.owner === this) tracker.cut = true
    }
    if (this.track && tracker.owner === this) {
      const lift = this.pos.y - this.p0.y
      tracker.active = !this.done
      if (stage1.free)
        tracker.focus
          .copy(this.dir)
          .multiplyScalar((dims.y3 + dims.height) / 2)
          .add(this.pos)
      else
        tracker.focus
          .copy(this.dir)
          .multiplyScalar(dims.height * 0.5)
          .add(this.pos)
      tracker.shake = this.done
        ? 0
        : Math.min(1, thrust * this.size * 0.45) * Math.max(0, 1 - lift / 35)

      const phase: LaunchPhase = this.done ? 'done' : T < 0 ? 'countdown' : 'flight'
      const clock = T < 0 ? -Math.ceil(-T) : Math.floor(Math.min(T, P.duration)) // stops when out of sight
      let event = this.events[0][1]
      for (const [at, label] of this.events) if (at <= T) event = label
      const key = `${phase}|${clock}|${event}`
      if (key !== this.reportKey) {
        this.reportKey = key
        this.report({ phase, clock, event })
      }
    }
  }

  /** Total engine output, boosters counting a little less than the core. */
  private thrust() {
    return (
      this.stage1.burn.throttle + this.boosters.reduce((sum, b) => sum + b.burn.throttle * 0.8, 0)
    )
  }

  /** Attached pieces ride with the stack; free ones fall, slow down and tumble. */
  private place(p: Piece, dt: number) {
    if (p.free) {
      p.vel.y -= GRAVITY * dt
      p.vel.multiplyScalar(Math.exp(-0.15 * dt))
      p.pos.addScaledVector(p.vel, dt)
      // turn around the pivot: keep the pivot's world position fixed while rotating
      const pivotWorld = v1.copy(p.pivot).applyQuaternion(p.quat).add(p.pos)
      p.quat.premultiply(q1.setFromAxisAngle(p.axis, p.rate * dt))
      p.pos.copy(pivotWorld).sub(v3.copy(p.pivot).applyQuaternion(p.quat))
    } else {
      p.pos.copy(this.pos)
      p.quat.copy(this.quat)
    }
    if (p.group) {
      p.group.position.copy(p.pos)
      p.group.quaternion.copy(p.quat)
    }
  }

  private emitSmoke(dt: number, T: number) {
    const { P, dims, pool, size, p0, acc } = this
    const r = dims.radius
    const rand = Math.random
    const lift = this.pos.y - p0.y
    const thrust = this.thrust()
    const sounding = P.burnout !== undefined
    const coreSolid = P.core === 'solid'
    const groundY = p0.y - 0.35

    // vapour boiling off the cold tanks during the countdown
    if (!coreSolid && T < -P.hold) {
      acc.vapor += dt * 7
      while (acc.vapor >= 1) {
        acc.vapor--
        const a = rand() * Math.PI * 2
        const y = rand() < 0.6 ? dims.y2 + dims.inter * 0.5 : dims.y4 - dims.s2 * 0.3
        const p = v1
          .set(Math.cos(a) * r * 1.05, y, Math.sin(a) * r * 1.05)
          .applyQuaternion(this.quat)
          .add(this.pos)
        pool.emit(p.x, p.y, p.z, Math.cos(a) * 0.35, -0.35, Math.sin(a) * 0.35, {
          life: 2.4,
          size0: r * 0.25,
          size1: r * 1.6,
          shade: SHADES.vapor,
          drag: 0.8,
          lift: -0.15,
        })
      }
    }

    // sound suppression water flashing to steam, under and around the pad
    if (!sounding && T > -P.hold - 0.8 && T < 4.5) {
      acc.steam += dt * 26 * size * (T < -P.hold ? 0.35 : 1)
      while (acc.steam >= 1) {
        acc.steam--
        const a = rand() * Math.PI * 2
        const d = (0.8 + rand() * 1.8) * Math.sqrt(size)
        pool.emit(
          p0.x + Math.cos(a) * d,
          groundY,
          p0.z + Math.sin(a) * d,
          Math.cos(a) * 0.6,
          1.4 + rand() * 1.6,
          Math.sin(a) * 0.6,
          {
            life: 3.5 + rand() * 3,
            size0: 0.3 * size,
            size1: (1.1 + rand() * 0.8) * Math.sqrt(size),
            shade: SHADES.steam,
            drag: 0.9,
            lift: 0.3,
            floor: groundY,
          },
        )
      }
    }

    // exhaust hitting the pad: jets out of the flame trench and a cloud billowing around
    if (thrust > 0.05 && lift < dims.height * 3) {
      const k = thrust * (1 - lift / (dims.height * 3))
      acc.ground += dt * 55 * k * size
      const shade = coreSolid || P.boosters === 'solid' ? SHADES.groundSolid : SHADES.ground
      while (acc.ground >= 1) {
        acc.ground--
        const jet = !sounding && rand() < 0.62
        const a = jet ? TRENCH_ANGLE + (rand() - 0.5) * 0.7 : rand() * Math.PI * 2
        const sp = jet ? (6 + rand() * 7) * Math.sqrt(size) : (sounding ? 1 : 2) + rand() * 4
        const d = jet ? 1.6 : 0.6
        pool.emit(
          p0.x + Math.cos(a) * d,
          groundY + rand() * 0.4,
          p0.z + Math.sin(a) * d,
          Math.cos(a) * sp,
          0.3 + rand() * 1.4,
          Math.sin(a) * sp,
          {
            life: 5 + rand() * 6,
            size0: 0.35 * size,
            size1: (1.2 + rand() * 1.3) * Math.sqrt(size) * (sounding ? 0.4 : 1),
            shade,
            drag: 0.85,
            lift: 0.3,
            floor: groundY,
          },
        )
      }
    }

    // hydrogen fireball licking up the side of the rocket as the engines light
    if (P.fireball && T > -P.hold && T < -P.hold + 1.2) {
      acc.fire += dt * 55
      while (acc.fire >= 1) {
        acc.fire--
        const a = rand() * Math.PI * 2
        const d = r * (1.2 + rand() * 1.8)
        pool.emit(
          p0.x + Math.cos(a) * d,
          p0.y + rand() * dims.height * 0.35,
          p0.z + Math.sin(a) * d,
          Math.cos(a) * 0.5,
          2.5 + rand() * 3,
          Math.sin(a) * 0.5,
          {
            life: 1.4 + rand(),
            size0: 0.25,
            size1: 0.8 + rand() * 0.6,
            shade: SHADES.fire,
            drag: 0.6,
            lift: 0.5,
          },
        )
      }
    }

    // trails behind the burning engines
    if (T < 0 || this.done) return
    const sources = [this.stage1, ...this.boosters]
    this.emitters.forEach((e, i) => {
      const src = sources[i]
      const now = v1.copy(e.offset).applyQuaternion(this.quat).add(this.pos)
      if (src.free || src.burn.throttle < 0.3) {
        e.last.copy(now)
        e.carry = 0
        return
      }
      const look = TRAIL[e.kind]
      const spacing = look.spacing * (1 + this.s / 260)
      const dist = e.last.distanceTo(now)
      let along = spacing - e.carry
      let count = 0
      while (along <= dist && count < 60) {
        const u = along / dist
        const back = 1.5 + rand() * 2.5
        pool.emit(
          e.last.x + (now.x - e.last.x) * u + (rand() - 0.5) * e.radius * 0.6,
          e.last.y + (now.y - e.last.y) * u,
          e.last.z + (now.z - e.last.z) * u + (rand() - 0.5) * e.radius * 0.6,
          -this.dir.x * back + (rand() - 0.5) * 0.8,
          -this.dir.y * back + (rand() - 0.5) * 0.8,
          -this.dir.z * back + (rand() - 0.5) * 0.8,
          {
            life: look.life * (0.8 + rand() * 0.4),
            size0: e.radius * 1.1,
            size1: e.radius * look.size * (1 + this.s / 320) * (0.8 + rand() * 0.4),
            shade: look.shade,
            drag: 1.6,
            lift: 0.05,
            floor: groundY,
          },
        )
        along += spacing
        count++
      }
      e.carry = count ? dist - (along - spacing) : e.carry + dist
      e.last.copy(now)
    })
  }

  /** Burst of small puffs from the separation motors. */
  private puff(at: Vector3, count: number, radius: number) {
    for (let i = 0; i < count; i++) {
      const vx = (Math.random() - 0.5) * 5
      const vy = (Math.random() - 0.5) * 5
      const vz = (Math.random() - 0.5) * 5
      this.pool.emit(at.x, at.y, at.z, vx, vy, vz, {
        life: 1.6 + Math.random(),
        size0: radius * 0.3,
        size1: radius * 2,
        shade: SHADES.puff,
        drag: 1.8,
        lift: 0,
      })
    }
  }

  dispose() {
    if (tracker.owner === this) {
      tracker.active = false
      tracker.owner = null
      tracker.shake = 0
    }
    this.pool.dispose()
  }
}
