/** Rockets, the crawler-transporter, an airplane and parked cars. */
import { useMemo, type ReactNode } from 'react'
import { DoubleSide, LatheGeometry, Vector2 } from 'three'
import { Box, Boxes, Building, Cylinder, Instanced, type Item } from './basics'
import { CAR_COLORS, COLORS } from './colors'
import { pick, rng, rocketDims, SATURN_V, type V3 } from './lib'
import { LatticeTower, type Arm } from './structures'

/** Ogive (pointed arch) nose: straight for `straight` of its height, then curving to a tip. */
function useNoseGeometry(radius: number, height: number, straight = 0.4) {
  return useMemo(() => {
    const pts: Vector2[] = []
    const hs = height * straight
    pts.push(new Vector2(0.0001, 0), new Vector2(radius, 0), new Vector2(radius, hs))
    const n = 14
    for (let i = 1; i <= n; i++) {
      const u = i / n
      pts.push(new Vector2(Math.max(0.0001, radius * Math.cos((u * Math.PI) / 2) ** 0.9), hs + (height - hs) * Math.sin((u * Math.PI) / 2) ** 1.1))
    }
    return new LatheGeometry(pts, 28)
  }, [radius, height, straight])
}

function Nose({ radius, height, y, color = COLORS.white, straight }: { radius: number; height: number; y: number; color?: string; straight?: number }) {
  const geometry = useNoseGeometry(radius, height, straight)
  return (
    <mesh geometry={geometry} position={[0, y, 0]} castShadow>
      <meshStandardMaterial color={color} roughness={0.35} />
    </mesh>
  )
}

/** Engine bells under a stage. */
function Nozzles({ count, radius, y, size }: { count: number; radius: number; y: number; size: number }) {
  const items = useMemo<Item[]>(() => {
    if (count === 1) return [{ p: [0, y, 0], s: [size, size * 1.6, size] }]
    const ring = count > 6 ? count - 1 : count
    const out: Item[] = []
    if (count > 6) out.push({ p: [0, y, 0], s: [size, size * 1.6, size] })
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2
      out.push({ p: [Math.cos(a) * radius * 0.62, y, Math.sin(a) * radius * 0.62], s: [size, size * 1.6, size] })
    }
    return out
  }, [count, radius, y, size])
  return (
    <Instanced items={items} color="#3b3a38" metalness={0.7} roughness={0.35}>
      <cylinderGeometry args={[0.35, 1, 1, 14, 1, true]} />
    </Instanced>
  )
}

export type RocketProps = {
  position?: V3
  rotation?: V3
  height?: number
  radius?: number
  color?: string // first and second stage
  accent?: string // interstage band and engine section
  fairingRadius?: number // payload fairing, defaults to the core radius
  fairingColor?: string
  engines?: number
  boosters?: number
  boosterColor?: string
  boosterRadius?: number // defaults to 0.42 of the core radius
  boosterHeight?: number // fraction of the rocket height
  boosterNose?: boolean // false = flat-topped liquid boosters
  capsule?: boolean // crew capsule with a launch abort tower instead of a fairing
  gridFins?: boolean
  legs?: boolean // folded landing legs
  stripes?: { at: number; h: number; color: string }[] // bands, fractions of the height
  part?: RocketPart
}

/**
 * Which piece of the rocket to draw: everything, the first stage (with engines and interstage),
 * the upper stage with its payload, or one side booster. The pieces line up in the rocket's own frame,
 * so a launch can draw them separately and let them fall away.
 */
export type RocketPart = 'all' | 'stage1' | 'upper' | { booster: number }

/**
 * Generic rocket, base at `position`: engine bells, first stage, interstage, second stage, and a
 * payload fairing or a crew capsule with an abort tower. Optional side boosters, grid fins and legs.
 */
export function Rocket(props: RocketProps) {
  const {
    position = [0, 0, 0],
    rotation,
    height = 7,
    radius = 0.3,
    color = COLORS.white,
    accent = COLORS.dark,
    fairingRadius = radius,
    fairingColor = COLORS.white,
    engines = 1,
    boosterColor = COLORS.white,
    boosterNose = true,
    capsule = false,
    gridFins = false,
    legs = false,
    stripes = [],
    part = 'all',
  } = props
  const { nozzle, s1, inter, s2, top, y1, y2, y3, y4, d, boosterRadius, bh, boosterAt } = rocketDims(props)
  const lower = part === 'all' || part === 'stage1'
  const upper = part === 'all' || part === 'upper'
  const showBooster = (i: number) => part === 'all' || (typeof part === 'object' && part.booster === i)

  const fins = useMemo<Item[]>(
    () =>
      gridFins && lower
        ? [0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            return { p: [Math.cos(a) * radius * 1.15, y2 - radius * 0.4, Math.sin(a) * radius * 1.15], s: [radius * 0.55, radius * 0.5, 0.03], r: [0, -a + Math.PI / 2, 0] }
          })
        : [],
    [gridFins, lower, radius, y2],
  )
  const legItems = useMemo<Item[]>(
    () =>
      legs && lower
        ? [0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            return { p: [Math.cos(a) * radius * 1.02, y1 + s1 * 0.16, Math.sin(a) * radius * 1.02], s: [0.09, s1 * 0.3, 0.09], r: [0, -a, 0] }
          })
        : [],
    [legs, lower, radius, y1, s1],
  )

  return (
    <group position={position} rotation={rotation}>
      {lower && (
        <>
          <Nozzles count={engines} radius={radius} y={nozzle * 0.5} size={nozzle * 0.42 * (engines > 1 ? 0.75 : 1.2)} />
          <Cylinder radius={radius} height={radius * 0.25} position={[0, y1 + radius * 0.12, 0]} color={COLORS.dark} segments={24} />
          <Cylinder radius={radius} height={s1} position={[0, y1 + s1 / 2, 0]} color={color} segments={28} roughness={0.45} />
          {/* raceway: cable tray along the side */}
          <Box size={[0.05, s1 + inter, 0.09]} position={[radius + 0.02, y1 + (s1 + inter) / 2, 0]} color={COLORS.offWhite} />
          <Cylinder radius={radius * 1.005} height={inter} position={[0, y2 + inter / 2, 0]} color={accent} segments={28} />
          <Boxes items={fins} color="#3a3a3a" metalness={0.5} />
          <Boxes items={legItems} color="#2d2f33" />
        </>
      )}
      {upper && (
        <>
          <Cylinder radius={radius} height={s2} position={[0, y3 + s2 / 2, 0]} color={color} segments={28} roughness={0.45} />
          <Box size={[0.05, s2, 0.09]} position={[radius + 0.02, y3 + s2 / 2, 0]} color={COLORS.offWhite} />
          {/* upper stage engine bell, hidden inside the interstage until the stages separate */}
          {part === 'upper' && (
            <mesh position={[0, y3 - radius * 0.35, 0]}>
              <cylinderGeometry args={[radius * 0.2, radius * 0.55, radius * 0.7, 16, 1, true]} />
              <meshStandardMaterial color="#3b3a38" metalness={0.7} roughness={0.35} side={DoubleSide} />
            </mesh>
          )}
        </>
      )}
      {stripes
        .filter((st) => (height * st.at < y3 ? lower : upper))
        .map((st) => (
          <Cylinder key={st.at} radius={radius * 1.006} height={height * st.h} position={[0, height * st.at, 0]} color={st.color} segments={28} />
        ))}

      {upper &&
        (capsule ? (
          <group position={[0, y4, 0]}>
            {/* service module, capsule, abort tower */}
            <Cylinder radius={radius * 0.92} height={top * 0.3} position={[0, top * 0.15, 0]} color={COLORS.offWhite} segments={24} />
            <Cylinder radius={radius * 0.95} radiusTop={radius * 0.35} height={top * 0.28} position={[0, top * 0.3 + top * 0.14, 0]} color={COLORS.white} segments={24} roughness={0.3} />
            <Cylinder radius={radius * 0.32} radiusTop={radius * 0.12} height={top * 0.14} position={[0, top * 0.58 + top * 0.07, 0]} color={COLORS.white} segments={16} />
            <Cylinder radius={radius * 0.08} height={top * 0.22} position={[0, top * 0.72 + top * 0.11, 0]} color="#c0392b" segments={8} />
            <mesh position={[0, top * 0.94 + top * 0.03, 0]} castShadow>
              <coneGeometry args={[radius * 0.1, top * 0.12, 8]} />
              <meshStandardMaterial color="#c0392b" />
            </mesh>
          </group>
        ) : (
          <>
            {fairingRadius > radius && <Cylinder radius={radius} radiusTop={fairingRadius} height={radius * 0.4} position={[0, y4 + radius * 0.2, 0]} color={fairingColor} segments={28} />}
            <Nose radius={fairingRadius} height={top - (fairingRadius > radius ? radius * 0.4 : 0)} y={y4 + (fairingRadius > radius ? radius * 0.4 : 0)} color={fairingColor} />
          </>
        ))}

      {boosterAt.map(({ a, x: bx, z: bz }, i) => {
        if (!showBooster(i)) return null
        const bn = boosterRadius * 0.7
        return (
          <group key={i} position={[bx, 0, bz]}>
            <mesh position={[0, bn * 0.5, 0]} castShadow>
              <cylinderGeometry args={[boosterRadius * 0.55, boosterRadius * 0.9, bn, 14, 1, true]} />
              <meshStandardMaterial color="#3b3a38" metalness={0.7} roughness={0.35} />
            </mesh>
            <Cylinder radius={boosterRadius} height={bh - bn} position={[0, bn + (bh - bn) / 2, 0]} color={boosterColor} segments={18} roughness={0.5} />
            {[0.3, 0.6].map((f) => (
              <Cylinder key={f} radius={boosterRadius * 1.02} height={bh * 0.015} position={[0, bh * f, 0]} color={COLORS.dark} segments={18} />
            ))}
            {boosterNose ? (
              <Nose radius={boosterRadius} height={boosterRadius * 3} y={bh} color={boosterColor} straight={0.05} />
            ) : (
              <Cylinder radius={boosterRadius * 1.005} height={boosterRadius * 0.4} position={[0, bh + boosterRadius * 0.2, 0]} color={accent} segments={18} />
            )}
            {/* attach struts */}
            {[0.2, bh * 0.85].map((y) => (
              <Box key={y} size={[d * 0.6, 0.06, 0.06]} position={[-Math.cos(a) * d * 0.45, y, -Math.sin(a) * d * 0.45]} rotation={[0, -a, 0]} color={COLORS.steelDark} />
            ))}
          </group>
        )
      })}
    </group>
  )
}

/** Black and white quarters painted around the body (the Saturn V roll pattern). */
function RollPattern({ radius, y0, y1, phase = 0 }: { radius: number; y0: number; y1: number; phase?: number }) {
  const h = y1 - y0
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, y0 + h / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[radius * 1.004, radius * 1.004, h, 10, 1, true, phase + (i * Math.PI) / 2, Math.PI / 2]} />
          <meshStandardMaterial color={i % 2 ? COLORS.dark : COLORS.white} roughness={0.45} side={DoubleSide} />
        </mesh>
      ))}
    </>
  )
}

/** Thin dark ring around the body: seams between stages. */
const Seam = ({ radius, y }: { radius: number; y: number }) => <Cylinder radius={radius * 1.006} height={0.03} position={[0, y, 0]} color="#3a3c40" segments={32} />

/**
 * Saturn V, base at `position`, about 1 unit = 10 m (SATURN_V in lib.ts). First stage (S-IC): five
 * F-1 engines, engine fairings and fins, roll pattern, black intertank band. Upper stages: S-II, the
 * narrower S-IVB with its roll pattern and APS pods, instrument unit, spacecraft adapter, Apollo
 * service and command modules, and the red launch escape tower. `part` splits it like Rocket.
 */
export function SaturnV({ position = [0, 0, 0], rotation, part = 'all' }: RocketProps) {
  const { radius: R, upperRadius: R3, sicTop, siiTop, adapterTop, sivbTop, iuTop, slaTop, smTop, cmTop, height } = SATURN_V
  const lower = part === 'all' || part === 'stage1'
  const upper = part === 'all' || part === 'upper'
  const corners = [0, 1, 2, 3].map((i) => Math.PI / 4 + (i * Math.PI) / 2)
  return (
    <group position={position} rotation={rotation}>
      {lower && (
        <>
          {/* five F-1 engines: one in the middle, four around it */}
          {[null, ...corners].map((a, i) => (
            <mesh key={i} position={a === null ? [0, 0.29, 0] : [Math.cos(a) * 0.3, 0.29, Math.sin(a) * 0.3]} castShadow>
              <cylinderGeometry args={[0.07, 0.17, 0.58, 16, 1, true]} />
              <meshStandardMaterial color="#2f2e2c" metalness={0.6} roughness={0.4} side={DoubleSide} />
            </mesh>
          ))}
          <Cylinder radius={R} height={0.12} position={[0, 0.64, 0]} color={COLORS.dark} segments={32} />
          {corners.map((a) => (
            <group key={a} rotation={[0, -a, 0]}>
              {/* engine fairing and fin */}
              <Cylinder radius={0.17} radiusTop={0.12} height={0.65} position={[0.42, 0.85, 0]} color="#2d2f33" segments={14} />
              <Box size={[0.42, 0.75, 0.04]} position={[0.66, 0.8, 0]} color={COLORS.offWhite} />
            </group>
          ))}
          <Cylinder radius={R} height={sicTop - 0.7} position={[0, (0.7 + sicTop) / 2, 0]} color={COLORS.white} segments={32} roughness={0.45} />
          <RollPattern radius={R} y0={0.7} y1={1.35} />
          <Cylinder radius={R * 1.004} height={0.25} position={[0, 2.48, 0]} color={COLORS.dark} segments={32} />
          <RollPattern radius={R} y0={sicTop - 0.26} y1={sicTop} phase={Math.PI / 2} />
        </>
      )}
      {upper && (
        <>
          <Cylinder radius={R} height={siiTop - sicTop} position={[0, (sicTop + siiTop) / 2, 0]} color={COLORS.white} segments={32} roughness={0.45} />
          <Seam radius={R} y={sicTop + 0.3} />
          <Seam radius={R} y={siiTop - 0.25} />
          {/* S-IVB: narrower, on a conical adapter */}
          <Cylinder radius={R} radiusTop={R3} height={adapterTop - siiTop} position={[0, (siiTop + adapterTop) / 2, 0]} color={COLORS.white} segments={32} roughness={0.45} />
          <Cylinder radius={R3} height={sivbTop - adapterTop} position={[0, (adapterTop + sivbTop) / 2, 0]} color={COLORS.white} segments={28} roughness={0.45} />
          <RollPattern radius={R3} y0={adapterTop} y1={adapterTop + 0.32} />
          {[-1, 1].map((s) => (
            <Box key={s} size={[0.08, 0.2, 0.15]} position={[s * (R3 + 0.03), adapterTop + 0.16, 0]} color="#d8d6d0" />
          ))}
          <Cylinder radius={R3 * 1.005} height={iuTop - sivbTop} position={[0, (sivbTop + iuTop) / 2, 0]} color="#c9c9c6" segments={28} />
          {/* spacecraft adapter, service module, command module */}
          <Cylinder radius={R3} radiusTop={0.2} height={slaTop - iuTop} position={[0, (iuTop + slaTop) / 2, 0]} color="#e6e4dd" segments={28} roughness={0.4} />
          <Cylinder radius={0.2} height={smTop - slaTop} position={[0, (slaTop + smTop) / 2, 0]} color="#d4d6d9" segments={24} metalness={0.4} roughness={0.35} />
          <Cylinder radius={0.2} radiusTop={0.05} height={cmTop - smTop} position={[0, (smTop + cmTop) / 2, 0]} color="#f2f2ee" segments={24} roughness={0.3} />
          {/* launch escape tower and motor */}
          <Cylinder radius={0.07} radiusTop={0.035} height={0.44} position={[0, cmTop + 0.22, 0]} color={COLORS.tower} segments={4} />
          <Cylinder radius={0.05} height={0.36} position={[0, cmTop + 0.62, 0]} color="#e9e7e1" segments={12} />
          <mesh position={[0, (cmTop + 0.8 + height) / 2, 0]} castShadow>
            <coneGeometry args={[0.05, height - cmTop - 0.8, 12]} />
            <meshStandardMaterial color="#c0392b" />
          </mesh>
        </>
      )}
    </group>
  )
}

/** A first stage standing on its deployed landing legs, sooty from re-entry. */
export function LandedBooster({ position = [0, 0, 0], height = 5, radius = 0.28 }: { position?: V3; height?: number; radius?: number }) {
  const legLen = height * 0.3
  const legs = useMemo<Item[]>(
    () =>
      [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        const spread = radius * 2.6
        const top: V3 = [Math.cos(a) * radius, legLen * 0.95, Math.sin(a) * radius]
        const foot: V3 = [Math.cos(a) * spread, 0.05, Math.sin(a) * spread]
        const tilt = Math.atan2(spread - radius, legLen)
        return { p: [(top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2, (top[2] + foot[2]) / 2], s: [0.09, Math.hypot(spread - radius, legLen), 0.12], r: [0, -a, tilt] }
      }),
    [radius, legLen],
  )
  const fins = useMemo<Item[]>(
    () =>
      [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        return { p: [Math.cos(a) * radius * 1.5, height - radius * 0.6, Math.sin(a) * radius * 1.5], s: [radius, radius * 0.7, 0.03], r: [0, -a + Math.PI / 2, 0] }
      }),
    [radius, height],
  )
  return (
    <group position={position}>
      <Cylinder radius={radius} height={height * 0.35} position={[0, legLen * 0.5 + height * 0.175, 0]} color="#77736b" segments={24} />
      <Cylinder radius={radius} height={height * 0.4} position={[0, legLen * 0.5 + height * 0.35 + height * 0.2, 0]} color="#b4b0a6" segments={24} />
      <Cylinder radius={radius} height={height * 0.25 - legLen * 0.5} position={[0, (height * 0.75 + legLen * 0.5 + height) / 2, 0]} color="#d8d5cd" segments={24} />
      <Cylinder radius={radius * 1.01} height={radius * 0.6} position={[0, height - radius * 0.3, 0]} color={COLORS.dark} segments={24} />
      <Cylinder radius={radius * 0.95} radiusTop={radius} height={legLen * 0.5} position={[0, legLen * 0.25, 0]} color="#3b3a38" segments={24} metalness={0.5} />
      <Boxes items={legs} color="#2b2d31" />
      <Boxes items={fins} color="#3a3a3a" metalness={0.5} />
    </group>
  )
}

/** Deck height of the crawler-transporter: what it carries sits here. */
export const CRAWLER_DECK = 1.1

/** Crawler-transporter: four double track units, the body, two cabs and a flat deck. */
export function Crawler({ position = [0, 0, 0], rotationY = 0, children }: { position?: V3; rotationY?: number; children?: ReactNode }) {
  const treads = useMemo(() => {
    const items: Item[] = []
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const t of [-0.3, 0.3])
          for (let k = 0; k < 9; k++) items.push({ p: [sx * 1.3 + (k - 4) * 0.13, 0.42, sz * 1.25 + t], s: [0.05, 0.04, 0.5] })
    return items
  }, [])
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].flatMap((sz) =>
          [-0.3, 0.3].map((t) => <Box key={`${sx}${sz}${t}`} size={[1.2, 0.4, 0.5]} position={[sx * 1.3, 0.2, sz * 1.25 + t]} color="#3a3b3d" metalness={0.3} />),
        ),
      )}
      <Boxes items={treads} color="#26272a" shadows={false} />
      <Box size={[3.6, 0.55, 3.2]} position={[0, 0.72, 0]} color="#8c9096" metalness={0.2} />
      <Box size={[3.4, 0.08, 3.0]} position={[0, 1.04, 0]} color="#6e7278" />
      {/* driver cabs on two corners */}
      {[
        [1.95, -1.45],
        [-1.95, 1.45],
      ].map(([x, z]) => (
        <group key={x} position={[x, 0.75, z]}>
          <Box size={[0.4, 0.4, 0.5]} color={COLORS.offWhite} />
          <Box size={[0.41, 0.15, 0.51]} position={[0, 0.08, 0]} color={COLORS.glass} />
        </group>
      ))}
      <group position={[0, CRAWLER_DECK, 0]}>{children}</group>
    </group>
  )
}

/** Height of a mobile launcher's deck: the rocket stands here. */
export const ML_DECK = 0.8

/** Mobile launcher: two-story platform with a tall umbilical tower; children stand on the deck. */
export function MobileLauncher({ towerHeight = 12, towerColor = '#6f757d', arms = [], children }: { towerHeight?: number; towerColor?: string; arms?: Arm[]; children?: ReactNode }) {
  return (
    <group>
      <Building size={[5, ML_DECK, 4.4]} position={[0, 0, 0]} color="#7e848b" />
      <Box size={[1.6, 0.02, 1.6]} position={[0, ML_DECK + 0.01, 0]} color={COLORS.dark} />
      <LatticeTower position={[2.2, ML_DECK, 0]} height={towerHeight} width={1.5} color={towerColor} arms={arms} mast={0} crane />
      <group position={[0, ML_DECK, 0]}>{children}</group>
    </group>
  )
}

/** Four-engine turboprop patrol/research airplane, nose toward +x. */
export function Airplane({ position = [0, 0, 0], rotationY = 0, color = COLORS.white }: { position?: V3; rotationY?: number; color?: string }) {
  const len = 3.6
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Cylinder radius={0.22} height={len} position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} color={color} segments={16} roughness={0.4} />
      <mesh position={[len / 2, 0.55, 0]} scale={[1.4, 1, 1]}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <mesh position={[-len / 2 - 0.35, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.2, 0.7, 14]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <Box size={[0.08, 0.05, len * 1.0]} position={[0.1, 0.5, 0]} color="#2a4f8f" />
      <Box size={[0.7, 0.06, 3.8]} position={[0.2, 0.55, 0]} color={color} />
      <Box size={[0.35, 0.04, 1.4]} position={[-len / 2 - 0.4, 0.7, 0]} color={color} />
      <Box size={[0.45, 0.7, 0.05]} position={[-len / 2 - 0.45, 1.0, 0]} color={color} />
      {[-1.3, -0.6, 0.6, 1.3].map((z) => (
        <group key={z} position={[0.45, 0.5, z]}>
          <Cylinder radius={0.08} height={0.6} rotation={[0, 0, Math.PI / 2]} color="#c9c9c9" segments={10} />
          <Cylinder radius={0.35} height={0.01} position={[0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]} color="#333" segments={14} />
        </group>
      ))}
      {/* landing gear */}
      {[
        [1.3, 0],
        [0, 0.55],
        [0, -0.55],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.05, 0.35, 0.05]} position={[x, 0.17, z]} color="#333" />
      ))}
    </group>
  )
}

/** Parking lot: asphalt, white bay lines and randomly parked cars. */
export function ParkingLot({ position = [0, 0, 0], rows = 3, cols = 10, rotationY = 0, seed = 1, fill = 0.75 }: { position?: V3; rows?: number; cols?: number; rotationY?: number; seed?: number; fill?: number }) {
  const bayW = 0.28
  const bayD = 0.55
  const aisle = 0.6
  const w = cols * bayW
  const d = rows * (bayD * 2 + aisle)
  const { lines, bodies, cabins } = useMemo(() => {
    const rand = rng(seed)
    const lines: Item[] = []
    const bodies: Item[] = []
    const cabins: Item[] = []
    for (let r = 0; r < rows; r++) {
      const z0 = -d / 2 + r * (bayD * 2 + aisle) + aisle / 2
      for (const side of [0, 1]) {
        const zc = z0 + bayD * (side + 0.5)
        for (let c = 0; c <= cols; c++) lines.push({ p: [-w / 2 + c * bayW, 0.015, zc], s: [0.02, 0.01, bayD * 0.9] })
        for (let c = 0; c < cols; c++) {
          if (rand() > fill) continue
          const x = -w / 2 + (c + 0.5) * bayW
          const col = pick(rand, CAR_COLORS)
          bodies.push({ p: [x, 0.07, zc], s: [0.17, 0.1, 0.4], c: col })
          cabins.push({ p: [x, 0.16, zc + (side ? 0.02 : -0.02)], s: [0.15, 0.08, 0.22], c: col })
        }
      }
    }
    return { lines, bodies, cabins }
  }, [rows, cols, d, w, seed, fill])
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[w + 0.4, d + 0.2]} />
        <meshStandardMaterial color={COLORS.asphalt} roughness={1} />
      </mesh>
      <Boxes items={lines} color={COLORS.white} shadows={false} />
      <Boxes items={bodies} roughness={0.4} metalness={0.3} />
      <Boxes items={cabins} roughness={0.3} metalness={0.3} />
    </group>
  )
}

/** Small control tower with a glass cab. */
export function ControlTower({ position = [0, 0, 0] }: { position?: V3 }) {
  return (
    <group position={position}>
      <Building size={[1.6, 0.8, 1.6]} color={COLORS.offWhite} />
      <Cylinder radius={0.35} height={3.2} position={[0, 2.4, 0]} color={COLORS.offWhite} segments={12} />
      <Cylinder radius={0.6} radiusTop={0.7} height={0.6} position={[0, 4.3, 0]} color={COLORS.glass} segments={8} roughness={0.2} metalness={0.5} />
      <Cylinder radius={0.75} height={0.12} position={[0, 4.66, 0]} color={COLORS.dark} segments={8} />
      <Cylinder radius={0.02} height={0.8} position={[0, 5.1, 0]} color={COLORS.steel} segments={4} />
    </group>
  )
}
