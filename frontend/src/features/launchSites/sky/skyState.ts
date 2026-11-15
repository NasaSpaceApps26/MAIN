/**
 * Time of day at the launch site: where the Sun and Moon are, how dark it is, and what that does
 * to the sky colours, the lights and the night lamps. A plain mutable object updated once a frame
 * (by SkyClock) and read by the scene every frame, so nothing re-renders as the clock runs.
 */
import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { COLORS } from '../models/colors'
import { smoothstep } from '../models/lib'
import { moonPosition, sunPosition } from './astro'

/** Scene direction for a sky position: x = east, -z = north, y = up (as in every model). */
export function skyDirection(az: number, el: number, out = new Vector3()) {
  const a = (az * Math.PI) / 180
  const e = (el * Math.PI) / 180
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
}

export const sky = {
  sunDir: new Vector3(0.4, 0.8, 0.3).normalize(),
  moonDir: new Vector3(0, -1, 0),
  sunEl: 50,
  moonEl: -10,
  day: 1, // 1 in daylight, 0 at night (fades through civil twilight)
  night: 0, // how much the night lamps are on: they come on at dusk
  twilight: 0, // 1 around sunrise / sunset, for the orange glow
}

/** Moves the Sun and Moon to the given moment at the given place. */
export function updateSky(timeMs: number, lat: number, lon: number) {
  const s = sunPosition(timeMs, lat, lon)
  const m = moonPosition(timeMs, lat, lon)
  skyDirection(s.az, s.el, sky.sunDir)
  skyDirection(m.az, m.el, sky.moonDir)
  sky.sunEl = s.el
  sky.moonEl = m.el
  sky.day = smoothstep(-6, 6, s.el)
  sky.night = 1 - smoothstep(-8, 3, s.el)
  sky.twilight = Math.max(0, 1 - Math.abs(s.el + 1) / 8)
}

// --- sky colours ---------------------------------------------------------------------------------

const NIGHT_HORIZON = new Color('#0c1526')
const NIGHT_ZENITH = new Color('#02040b')
const SUNSET = new Color('#f2a06c')
const TWILIGHT_ZENITH = new Color('#24365f')

/** Horizon (= fog) and zenith colours now, from the model's daytime colours. */
export function skyColors(dayHorizon: Color, dayZenith: Color, horizon: Color, zenith: Color) {
  horizon
    .copy(NIGHT_HORIZON)
    .lerp(dayHorizon, sky.day)
    .lerp(SUNSET, sky.twilight * 0.5)
  zenith
    .copy(NIGHT_ZENITH)
    .lerp(dayZenith, sky.day)
    .lerp(TWILIGHT_ZENITH, sky.twilight * 0.35 * (1 - sky.day))
}

// --- scene lights --------------------------------------------------------------------------------

const WARM = new Color('#ffb070')
const NOON = new Color('#fff6e8')
const MOONLIGHT = new Color('#9fb6ff')
const HEMI_DAY = new Color('#dfefff')
const HEMI_NIGHT = new Color('#2c3c64')
const GROUND_DAY = new Color('#4b5a3a')
const GROUND_NIGHT = new Color('#0a0d12')
const tmp = new Vector3()

/** Sunlight from the Sun's direction (warm when low), moonlight at night, dimmer sky light. */
export function applySkyLights(
  sun: DirectionalLight | null,
  hemi: HemisphereLight | null,
  ambient: AmbientLight | null,
) {
  if (sun) {
    if (sky.sunEl > -3) {
      sun.intensity = 2.3 * smoothstep(-3, 10, sky.sunEl)
      sun.color.copy(WARM).lerp(NOON, smoothstep(0, 25, sky.sunEl))
      sun.position.copy(tmp.copy(sky.sunDir).multiplyScalar(150))
    } else {
      sun.intensity = sky.moonEl > 0 ? 0.35 * smoothstep(0, 12, sky.moonEl) : 0
      sun.color.copy(MOONLIGHT)
      sun.position.copy(tmp.copy(sky.moonDir).multiplyScalar(150))
    }
  }
  if (hemi) {
    hemi.intensity = 0.9 * sky.day + 0.1
    hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, sky.day)
    hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, sky.day)
  }
  if (ambient) ambient.intensity = 0.15 * sky.day + 0.05
}

// --- night lamps ---------------------------------------------------------------------------------

/** Soft round spot of light on the ground, bright in the middle. */
function poolTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

let night: ReturnType<typeof makeNightMaterials> | null = null

function makeNightMaterials() {
  const glow = {
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }
  return {
    /** Office windows: dark glass by day, warm light at night. */
    window: new MeshStandardMaterial({
      color: COLORS.glass,
      roughness: 0.2,
      metalness: 0.4,
      emissive: '#ffc77a',
      emissiveIntensity: 0,
    }),
    /** Flood light lamp faces. */
    lamp: new MeshStandardMaterial({
      color: '#fff6d5',
      emissive: '#ffe9a8',
      emissiveIntensity: 1.2,
    }),
    /** Beam of a flood light and the pool of light it throws on the ground. */
    beam: new MeshBasicMaterial({ color: '#fff0c4', opacity: 0, side: DoubleSide, ...glow }),
    pool: new MeshBasicMaterial({ color: '#ffe2a6', opacity: 0, map: poolTexture(), ...glow }),
    /** Red aircraft warning lights on masts and towers: blink at night. */
    warning: new MeshStandardMaterial({
      color: '#ff3030',
      emissive: '#ff2020',
      emissiveIntensity: 2,
    }),
    /** Sweeping lighthouse beam: faint by day, clear at night. */
    lighthouseBeam: new MeshBasicMaterial({
      color: '#fff2c0',
      opacity: 0.18,
      side: DoubleSide,
      ...glow,
    }),
  }
}

/** Materials shared by every night lamp in the scene, so one update a frame drives them all. */
export function nightMaterials() {
  return (night ??= makeNightMaterials())
}

/** Turns the lamps up as it gets dark; the warning lights blink. */
export function updateNightMaterials(timeSec: number) {
  const m = nightMaterials()
  const n = sky.night
  m.window.emissiveIntensity = n * 1.2
  m.lamp.emissiveIntensity = 1.2 + n * 3
  m.beam.opacity = n * 0.14
  m.pool.opacity = n * 0.6
  const blink = Math.sin(timeSec * 3) > 0.3 ? 1 : 0.15
  m.warning.emissiveIntensity = 0.8 + n * 3 * blink
  m.lighthouseBeam.opacity = 0.04 + n * 0.24
}
