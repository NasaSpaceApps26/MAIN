/**
 * Flight profiles: how a rocket counts down, lifts off and flies. Everything runs in real time;
 * lengths are in model units (about 10 m).
 */

/** Propellant, which sets the colour of the flame and how much of a smoke trail it leaves. */
export type EngineKind = 'kerosene' | 'hydrogen' | 'solid'

export type FlightProfile = {
  countdown: number // real seconds from pressing Launch to liftoff
  hold: number // liquid engines light this many seconds before liftoff, held down on the pad
  accel: number // acceleration at liftoff, units/s²
  jerk: number // growth of the acceleration as propellant burns off, units/s³
  heading: [number, number] // downrange direction on the ground (x, z); -z is north
  pitchStart: number // path length where the rocket starts to tip over downrange
  pitchEnd: number // path length where it reaches pitchMax
  pitchMax: number // final angle from vertical, radians
  roll: number // roll program right after clearing the tower, radians
  core: EngineKind
  boosters?: EngineKind
  boosterSep?: number // seconds after liftoff
  stageSep?: number // seconds after liftoff
  burnout?: number // single-stage rockets: engine stops, then they coast
  duration: number // longest flight, seconds after liftoff (it usually ends sooner, out of sight in the haze)
  fireball?: boolean // hydrogen fireball climbing the rocket at ignition
}

/** Direction (x, z) the flame trenches blow the exhaust: every pad in the models faces it this way. */
export const TRENCH: [number, number] = [0, -1]

/**
 * Saturn V: ignition sequence on the pad, liftoff, the roll toward the flight azimuth, clearing the
 * tower, then climbing and pitching over downrange until it fades into the haze. The first stage
 * keeps burning: no stage falls away while it is in view.
 */
const SATURN_V: FlightProfile = {
  countdown: 3,
  hold: 1.5,
  accel: 1.2,
  jerk: 0.12,
  heading: [0.95, -0.31], // from Florida: 72° east of north, as on the Apollo Moon missions
  pitchStart: 12,
  pitchEnd: 450,
  pitchMax: 1.1,
  roll: 0.31,
  core: 'kerosene',
  duration: 40,
}

export const PROFILES = {
  saturnV: SATURN_V,
  /** From Vandenberg: south over the Pacific, into a polar orbit. */
  saturnVPolar: { ...SATURN_V, heading: [-0.25, 1] },
  /** From Wallops: southeast over the Atlantic. */
  saturnVWallops: { ...SATURN_V, heading: [1, 0.35] },
} satisfies Record<string, FlightProfile>
