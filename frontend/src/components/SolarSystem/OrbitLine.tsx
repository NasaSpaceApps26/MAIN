import { useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Color, Vector3 } from 'three'
import type { BufferGeometry, Group, InterleavedBufferAttribute } from 'three'
import type { OrbitalElements, StateSample } from '../../api/types'
import { useSimStore } from '../../store/simStore'
import { orbitEllipse, orbitIndexAt, positionAt } from './orbitMath'

// ---- Look of the orbit lines: play with these ----
const LINE_WIDTH = 1.2 // in screen pixels, stays the same at any zoom
const FAINT = 0.08 // opacity of the orbit ahead of the planet
const BRIGHT = 0.85 // opacity right behind the planet
const TAIL = 0.7 // how much of the orbit the fading tail covers (1 = all of it)
const RESTING = 0.3 // opacity of the whole orbit while the planet positions are still loading

type RGBA = [number, number, number, number]

type Props = {
  // The orbit over time: one fixed orbit (planets) or one orbit per day (the Moon)
  orbits: OrbitalElements[]
  // The body's own positions: used to find where the bright end of the tail goes.
  // Until they arrive, the orbit is drawn evenly.
  samples?: StateSample[]
  // Positions of the body this orbit goes around, if it moves (Earth for the Moon).
  // Leave empty for orbits around the Sun, which stays at the origin.
  parentSamples?: StateSample[]
  color?: string
}

export function OrbitLine({ orbits, samples, parentSamples, color = '#ffffff' }: Props) {
  const group = useRef<Group>(null)
  const line = useRef<ComponentRef<typeof Line>>(null)
  const center = useRef(new Vector3())
  const bodyPos = useRef(new Vector3())
  const painted = useRef<{ geometry: BufferGeometry | null; point: number }>({
    geometry: null,
    point: -1,
  })

  // The orbit for the clock's current day. This only re-renders when the day changes,
  // and never for planets (they have a single orbit).
  const orbitIndex = useSimStore((s) => orbitIndexAt(orbits, s.simTimeMs))
  const elements = orbits[orbitIndex]
  const points = useMemo(() => orbitEllipse(elements), [elements])
  // One RGBA colour per point. The 4th number (alpha) is what makes the tail fade.
  const colors = useMemo(() => {
    const [r, g, b] = new Color(color).toArray()
    return points.map((): RGBA => [r, g, b, RESTING])
  }, [points, color])

  useFrame(() => {
    if (!group.current || !line.current) return
    const t = useSimStore.getState().simTimeMs

    // Orbits around a moving body (the Moon around Earth) travel with that body
    if (parentSamples) positionAt(parentSamples, t, center.current)
    else center.current.set(0, 0, 0)
    group.current.position.copy(center.current)
    if (!samples) return // positions not loaded yet: keep the even line

    // Which point of the ellipse is the body closest to right now?
    positionAt(samples, t, bodyPos.current).sub(center.current)
    let point = 0
    let best = Infinity
    for (let k = 0; k < points.length; k++) {
      const d = points[k].distanceToSquared(bodyPos.current)
      if (d < best) {
        best = d
        point = k
      }
    }

    // Only repaint when the body reached another point (or the line was rebuilt)
    const geometry = line.current.geometry
    if (painted.current.point === point && painted.current.geometry === geometry) return
    painted.current = { geometry, point }

    // Bright just behind the body, fading out along the path it came from.
    // Points go round in the direction of motion, so "behind" = lower index.
    const segments = points.length - 1
    const opacity = (k: number) => {
      const behind = ((((point - k) % segments) + segments) % segments) / segments // 0 → 1
      const fade = Math.max(0, 1 - behind / TAIL)
      return FAINT + (BRIGHT - FAINT) * fade * fade
    }

    // The line stores 8 numbers per segment: start RGBA, then end RGBA. We only touch the alphas.
    const buffer = (geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data
    for (let s = 0; s < segments; s++) {
      buffer.array[s * 8 + 3] = opacity(s)
      buffer.array[s * 8 + 7] = opacity(s + 1)
    }
    buffer.needsUpdate = true
  })

  return (
    <group ref={group}>
      <Line
        ref={line}
        points={points}
        vertexColors={colors}
        lineWidth={LINE_WIDTH}
        depthWrite={false}
      />
    </group>
  )
}
