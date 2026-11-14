import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three'

/** Start and end colour of a puff; it fades from start to end early, then into the haze before it vanishes. */
export type Shade = { from: Color; to: Color }

const geometry = new IcosahedronGeometry(1, 1)

/**
 * Pool of smoke puffs drawn as one instanced mesh: exhaust clouds, steam, vapour and trails.
 * The oldest puff is reused when the pool is full. Positions are in the space of the mesh's parent.
 */
export class ParticlePool {
  readonly mesh: InstancedMesh
  private readonly n: number
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size0: Float32Array
  private readonly size1: Float32Array
  private readonly c0: Float32Array
  private readonly c1: Float32Array
  private readonly drag: Float32Array
  private readonly lift: Float32Array
  private readonly floor: Float32Array
  private next = 0
  /** Colour the puffs fade into at the end of their life (the sky haze). */
  readonly haze = new Color('#c9d9e6')
  /** Wind drift, units/s. */
  wind: [number, number, number] = [0.5, 0, 0.25]

  constructor(n: number) {
    this.n = n
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.age = new Float32Array(n).fill(1)
    this.life = new Float32Array(n)
    this.size0 = new Float32Array(n)
    this.size1 = new Float32Array(n)
    this.c0 = new Float32Array(n * 3)
    this.c1 = new Float32Array(n * 3)
    this.drag = new Float32Array(n)
    this.lift = new Float32Array(n)
    this.floor = new Float32Array(n)
    // a little self-light so the shaded side of the smoke stays soft and bright, not muddy
    const material = new MeshLambertMaterial({ color: '#ffffff', emissive: '#5a5a5a' })
    this.mesh = new InstancedMesh(geometry, material, n)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.instanceMatrix.array.fill(0)
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
    this.mesh.instanceColor.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.userData.launchFx = true // the launch camera looks through smoke when placing itself
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    {
      life,
      size0,
      size1,
      shade,
      drag = 1,
      lift = 0.3,
      floor = -Infinity,
    }: {
      life: number
      size0: number
      size1: number
      shade: Shade
      drag?: number
      lift?: number
      floor?: number
    },
  ) {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.age[i] = 0
    this.life[i] = life
    this.size0[i] = size0
    this.size1[i] = size1
    this.c0.set([shade.from.r, shade.from.g, shade.from.b], i * 3)
    this.c1.set([shade.to.r, shade.to.g, shade.to.b], i * 3)
    this.drag[i] = drag
    this.lift[i] = lift
    this.floor[i] = floor
  }

  update(dt: number) {
    const m = this.mesh.instanceMatrix.array as Float32Array
    const col = this.mesh.instanceColor!.array as Float32Array
    const [wx, wy, wz] = this.wind
    const hz = this.haze
    for (let i = 0; i < this.n; i++) {
      const j = i * 16
      if (this.age[i] >= this.life[i]) {
        if (m[j] !== 0) m.fill(0, j, j + 16)
        continue
      }
      this.age[i] += dt
      const t = Math.min(1, this.age[i] / this.life[i])
      const k = i * 3
      const damp = Math.exp(-this.drag[i] * dt)
      this.vel[k] *= damp
      this.vel[k + 1] = this.vel[k + 1] * damp + this.lift[i] * dt
      this.vel[k + 2] *= damp
      this.pos[k] += (this.vel[k] + wx * t) * dt
      this.pos[k + 1] = Math.max(this.floor[i], this.pos[k + 1] + (this.vel[k + 1] + wy * t) * dt)
      this.pos[k + 2] += (this.vel[k + 2] + wz * t) * dt

      // grow fast, then slowly; shrink away at the very end
      const grow = 1 - (1 - t) * (1 - t)
      let s = this.size0[i] + (this.size1[i] - this.size0[i]) * grow
      if (t > 0.8) s *= 1 - ((t - 0.8) / 0.2) * 0.7
      m[j] = s
      m[j + 1] = 0
      m[j + 2] = 0
      m[j + 3] = 0
      m[j + 4] = 0
      m[j + 5] = s
      m[j + 6] = 0
      m[j + 7] = 0
      m[j + 8] = 0
      m[j + 9] = 0
      m[j + 10] = s
      m[j + 11] = 0
      m[j + 12] = this.pos[k]
      m[j + 13] = this.pos[k + 1]
      m[j + 14] = this.pos[k + 2]
      m[j + 15] = 1

      // glow colour near the flame -> smoke colour -> haze
      let r: number, g: number, b: number
      if (t < 0.12) {
        const u = t / 0.12
        r = this.c0[k] + (this.c1[k] - this.c0[k]) * u
        g = this.c0[k + 1] + (this.c1[k + 1] - this.c0[k + 1]) * u
        b = this.c0[k + 2] + (this.c1[k + 2] - this.c0[k + 2]) * u
      } else if (t > 0.55) {
        const u = (t - 0.55) / 0.45
        r = this.c1[k] + (hz.r - this.c1[k]) * u
        g = this.c1[k + 1] + (hz.g - this.c1[k + 1]) * u
        b = this.c1[k + 2] + (hz.b - this.c1[k + 2]) * u
      } else {
        r = this.c1[k]
        g = this.c1[k + 1]
        b = this.c1[k + 2]
      }
      col[k] = r
      col[k + 1] = g
      col[k + 2] = b
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  dispose() {
    this.mesh.dispose()
    ;(this.mesh.material as MeshLambertMaterial).dispose()
  }
}
