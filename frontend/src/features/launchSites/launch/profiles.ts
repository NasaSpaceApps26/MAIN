/**
 * Flight profiles: how a rocket counts down, lifts off and flies. Everything runs in real time;
 * lengths are in model units (about 10 m).
 */

/** Whole launch animation, from pressing Launch to the cut back to the overview, in seconds. */
export const LAUNCH_SECONDS = 10

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
  duration: number // seconds after liftoff when the launch animation ends
  endEvent?: string // shown on the mission clock when it ends
  fireball?: boolean // hydrogen fireball climbing the rocket at ignition
}

/** Direction (x, z) the flame trenches blow the exhaust: every pad in the models faces it this way. */
export const TRENCH: [number, number] = [0, -1]

const COUNTDOWN = 3

export const PROFILES = {
  /**
   * Saturn V from LC-39A: ignition sequence on the pad, liftoff, the roll toward the flight azimuth
   * (72° east of north, as on the Apollo Moon missions) and clearing the tower. The animation ends
   * there, long before any stage falls away.
   */
  saturnV: {
    countdown: COUNTDOWN,
    hold: 1.5,
    accel: 1.2,
    jerk: 0.12,
    heading: [0.95, -0.31],
    pitchStart: 12,
    pitchEnd: 450,
    pitchMax: 1.1,
    roll: 0.31,
    core: 'kerosene',
    duration: LAUNCH_SECONDS - COUNTDOWN,
    endEvent: 'Liftoff complete',
  },
} satisfies Record<string, FlightProfile>
