import type { EngineKind } from './profiles'

/** Engine state shared with the flight: how hard it burns and how much the plume has spread. */
export type Burn = { throttle: number; expand: number }

export type FlameKind = EngineKind | 'vacuum'

/** Outer, middle and core cone colours and opacities, and length of the plume per unit width. */
export const FLAME_LOOK: Record<
  FlameKind,
  { colors: [string, string, string]; opacity: [number, number, number]; length: number }
> = {
  kerosene: { colors: ['#ff6a1a', '#ffae45', '#fff1cf'], opacity: [0.55, 0.8, 1], length: 14 },
  solid: { colors: ['#ff8a30', '#ffd070', '#ffffff'], opacity: [0.65, 0.9, 1], length: 16 },
  hydrogen: { colors: ['#8fa8ff', '#ffc890', '#ffffff'], opacity: [0.3, 0.55, 1], length: 10 },
  vacuum: { colors: ['#ffb27a', '#ffd9b0', '#ffffff'], opacity: [0.18, 0.3, 0.7], length: 9 },
}
