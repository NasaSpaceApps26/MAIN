import { useEffect, useEffectEvent, useLayoutEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls, Stars } from '@react-three/drei';
import { AdditiveBlending, CanvasTexture, DoubleSide, LinearFilter, SRGBColorSpace } from 'three';

const R = 10; // dome radius
const DEG = Math.PI / 180;
const SUN = '#f5b83d';
const EARTH = '#4ea8ff';
const TEXT = '#e6e9f2';
const MUTED = '#8a93ab';
const EYE = [0, 0.8, 0]; // observer's eye at the lander

/** Direction in the sky -> point on a sphere of radius r: north = -z, east = +x, up = +y. */
function toXYZ(az, el, r = R) {
  const a = az * DEG;
  const e = el * DEG;
  return [r * Math.cos(e) * Math.sin(a), r * Math.sin(e), -r * Math.cos(e) * Math.cos(a)];
}

/** A body's path above the horizon over the whole range, split wherever it sets. */
function trackSegments(samples) {
  const k = Math.max(1, Math.floor(samples.length / 800));
  const segs = [];
  let cur = null;
  for (let i = 0; i < samples.length; i += k) {
    const s = samples[i];
    if (s.el < 0) {
      cur = null;
      continue;
    }
    if (!cur) segs.push((cur = []));
    cur.push(toXYZ(s.az, s.el, R * 0.995));
  }
  return segs.filter((s) => s.length > 1);
}

/**
 * Text label that always faces the camera and keeps the same size on screen: drawn into a small
 * canvas and shown on a sprite (no DOM elements, so it mounts and unmounts like any 3D object).
 * `lift` raises it above its anchor point, in label heights.
 */
function Label({ text, position, color = TEXT, border, dashed = false, size = 0.045, lift = 0, bold = false }) {
  const { texture, aspect } = useMemo(() => {
    const h = 48;
    const font = `${bold ? 700 : 500} 26px system-ui, 'Segoe UI', sans-serif`;
    const canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    ctx.font = font;
    const pad = border ? 14 : 4;
    canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
    canvas.height = h;
    ctx = canvas.getContext('2d');
    if (border) {
      ctx.fillStyle = 'rgba(11, 15, 26, 0.75)';
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.roundRect(1, 1, canvas.width - 2, h - 2, 14);
      ctx.fill();
      ctx.stroke();
    }
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, h / 2 + 1);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    return { texture: t, aspect: canvas.width / h };
  }, [text, color, border, dashed, bold]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} center={[0.5, 0.5 - lift]} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent toneMapped={false} />
    </sprite>
  );
}

/** Wire dome: horizon, 30° and 60° circles, a meridian every 30°, and their labels. */
function Grid({ labelScale }) {
  const lines = useMemo(() => {
    const ring = (el) => Array.from({ length: 73 }, (_, i) => toXYZ(i * 5, el));
    const meridian = (az) => Array.from({ length: 19 }, (_, i) => toXYZ(az, i * 5));
    return [
      ...[0, 30, 60].map((el) => ({ pts: ring(el), strong: el === 0 })),
      ...Array.from({ length: 12 }, (_, i) => ({ pts: meridian(i * 30), strong: i % 3 === 0 })),
    ];
  }, []);
  return (
    <>
      {lines.map((l, i) => (
        <Line key={i} points={l.pts} color="#ffffff" lineWidth={l.strong ? 1.2 : 0.8} transparent opacity={l.strong ? 0.45 : 0.18} />
      ))}
      {/* faint glass, so the dome reads as a surface */}
      <mesh>
        <sphereGeometry args={[R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#6f8fd0" transparent opacity={0.05} depthWrite={false} side={DoubleSide} />
      </mesh>
      {[
        ['N', 0],
        ['E', 90],
        ['S', 180],
        ['W', 270],
      ].map(([t, az]) => (
        <Label key={t} text={t} position={toXYZ(az, 0, R * 1.08)} bold size={0.05 * labelScale} />
      ))}
      {[30, 60].map((el) => (
        <Label key={el} text={`${el}°`} position={toXYZ(200, el, R * 1.01)} color={MUTED} size={0.038 * labelScale} />
      ))}
    </>
  );
}

/** Patch of grey regolith with a few low crater rims, and a small lander where the observer stands. */
function Ground() {
  const craters = [
    [4, -6, 1.6],
    [-7, 3, 2.2],
    [8, 5, 1.1],
    [-3, -9, 1.3],
    [-10, -5, 0.9],
    [2, 9, 1.8],
  ];
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[R * 1.6, 64]} />
        <meshStandardMaterial color="#7a766f" roughness={1} />
      </mesh>
      {craters.map(([x, z, r]) => (
        <mesh key={`${x}${z}`} position={[x, 0, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 0.8, r, 32]} />
          <meshStandardMaterial color="#918d86" roughness={1} />
        </mesh>
      ))}
      {/* lander: gold foil body on four legs */}
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.5, 0.35, 0.5]} />
        <meshStandardMaterial color="#c9a23a" metalness={0.6} roughness={0.35} />
      </mesh>
      {[45, 135, 225, 315].map((a) => (
        <mesh key={a} position={[0.35 * Math.cos(a * DEG), 0.2, 0.35 * Math.sin(a * DEG)]} rotation={[0, -a * DEG, 0.5]}>
          <cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />
          <meshStandardMaterial color="#9a9a9a" />
        </mesh>
      ))}
    </>
  );
}

/** Earth lit from the Sun's direction, so it shows the phase an astronaut would see. */
const earthVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const earthFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform float opacity;
  varying vec3 vNormal;
  void main() {
    float lit = smoothstep(-0.08, 0.18, dot(normalize(vNormal), sunDir));
    vec3 day = vec3(0.24, 0.56, 0.95);
    vec3 night = vec3(0.03, 0.05, 0.09);
    gl_FragColor = vec4(mix(night, day, lit), opacity);
  }
`;

/** Sun or Earth where it is now; below the horizon it is a faint ghost seen through the ground. */
function Body({ kind, b, sunDir, labelScale }) {
  const up = b.isUp;
  const size = kind === 'sun' ? 0.55 : 0.7;
  const name = kind === 'sun' ? 'Sun' : 'Earth';
  const see = { transparent: !up, depthTest: up, depthWrite: up };
  return (
    <group position={toXYZ(b.az, b.el, R)}>
      {kind === 'sun' ? (
        <>
          <mesh renderOrder={up ? 0 : 3}>
            <sphereGeometry args={[size, 32, 16]} />
            <meshBasicMaterial color="#fff2c4" opacity={up ? 1 : 0.3} toneMapped={false} {...see} />
          </mesh>
          {up && (
            <mesh>
              <sphereGeometry args={[size * 2.2, 32, 16]} />
              <meshBasicMaterial color={SUN} transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          )}
        </>
      ) : (
        <mesh renderOrder={up ? 0 : 3}>
          <sphereGeometry args={[size, 48, 24]} />
          <shaderMaterial
            vertexShader={earthVertex}
            fragmentShader={earthFragment}
            uniforms={{ sunDir: { value: sunDir }, opacity: { value: up ? 1 : 0.3 } }}
            {...see}
          />
        </mesh>
      )}
      <Label
        text={up ? name : `${name} (below horizon)`}
        position={[0, size * 1.3, 0]}
        lift={0.7}
        size={0.042 * labelScale}
        color={up ? TEXT : MUTED}
        border={kind === 'sun' ? SUN : EARTH}
        dashed={!up}
      />
    </group>
  );
}

/**
 * Places the camera when the view mode changes: outside, far enough back that the whole dome fits
 * the canvas whatever its shape; or at the lander's eye, looking toward the Earth.
 */
function CameraRig({ mode, lookAt, aimKey }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const place = useEffectEvent(() => {
    if (mode === 'outside') {
      camera.fov = 45;
      const v = (camera.fov / 2) * DEG;
      const h = Math.atan(Math.tan(v) * aspect);
      const dist = (R * 1.2) / Math.sin(Math.min(v, h));
      const dir = [15, 9, 17];
      const len = Math.hypot(...dir);
      camera.position.set((dir[0] / len) * dist, 2 + (dir[1] / len) * dist, (dir[2] / len) * dist);
    } else {
      camera.fov = 80; // wide enough to see the ground and a body high in the sky together
      // stand at the eye, a hair behind it, so the orbit controls turn the view around the eye
      const [x, y, z] = toXYZ(lookAt.az, Math.min(35, Math.max(8, lookAt.el)), 0.05);
      camera.position.set(EYE[0] - x, EYE[1] - y, EYE[2] - z);
    }
    camera.updateProjectionMatrix();
  });
  // again whenever new data arrives (first load, another site or range), not on every clock tick
  useLayoutEffect(() => place(), [mode, aimKey]);
  return null;
}

/**
 * 3D sky over the landing site: a wire dome with the Sun's and Earth's paths over the whole range
 * (dashed) and where they are now. Black sky with stars, as on the airless Moon.
 * mode = 'outside': the whole dome from outside (drag to turn, scroll to zoom);
 *        'inside':  standing at the lander, looking around the sky (drag to look around).
 */
export default function SkyDome3D({ samples, a, mode = 'outside' }) {
  const tracks = useMemo(() => (samples ? { sun: trackSegments(samples.sun), earth: trackSegments(samples.earth) } : null), [samples]);

  // direction to the Sun: lights the ground, and gives the Earth its phase (the Sun is so far away
  // that the direction is the same seen from the Moon or from the Earth)
  const sunDir = a ? toXYZ(a.sun.az, a.sun.el, 1) : null;
  // sunlight on the ground fades out as the Sun sets; earthshine keeps it visible
  const daylight = a ? Math.min(1, Math.max(0, (a.sun.el + 1) / 4)) : 1;
  // from the lander, start out facing the Earth (or the Sun when the Earth is down)
  const lookAt = a ? (a.earth.isUp || !a.sun.isUp ? a.earth : a.sun) : { az: 0, el: 20 };
  // labels keep their size on screen relative to the field of view, so widen them with it
  const labelScale = mode === 'inside' ? Math.tan(40 * DEG) / Math.tan(22.5 * DEG) : 1;

  return (
    <div className="sky3d-wrap">
      <div className="sky3d">
        <Canvas camera={{ position: [15, 11, 17], fov: 45, near: 0.02, far: 300 }} dpr={[1, 2]}>
          <color attach="background" args={['#02030a']} />
          <Stars radius={80} depth={30} count={2500} factor={3} saturation={0} fade speed={0} />
          <ambientLight intensity={0.9} color="#a9bbdc" />
          {sunDir && <directionalLight position={sunDir.map((v) => v * 50)} intensity={2.4 * daylight} color="#fff4dc" />}
          <Ground />
          <Grid labelScale={labelScale} />
          {tracks?.sun.map((seg, i) => <Line key={`s${i}`} points={seg} color={SUN} lineWidth={1.6} dashed dashSize={0.35} gapSize={0.25} />)}
          {tracks?.earth.map((seg, i) => <Line key={`e${i}`} points={seg} color={EARTH} lineWidth={1.6} dashed dashSize={0.35} gapSize={0.25} />)}
          {a && <Body kind="sun" b={a.sun} labelScale={labelScale} />}
          {a && <Body kind="earth" b={a.earth} sunDir={sunDir} labelScale={labelScale} />}
          <CameraRig mode={mode} lookAt={lookAt} aimKey={samples} />
          {mode === 'outside' ? (
            <OrbitControls key="outside" makeDefault target={[0, 2, 0]} minDistance={8} maxDistance={70} maxPolarAngle={Math.PI / 2 - 0.04} enablePan={false} />
          ) : (
            <OrbitControls key="inside" makeDefault target={EYE} enableZoom={false} enablePan={false} rotateSpeed={-0.35} />
          )}
        </Canvas>
        <span className="sky3d-caption">{mode === 'outside' ? 'Overview' : 'From the lander'}</span>
      </div>
    </div>
  );
}
