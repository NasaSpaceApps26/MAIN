import { useEffect, useState } from 'react';
import { BufferAttribute, BufferGeometry, LinearMipmapLinearFilter, SRGBColorSpace, TextureLoader } from 'three';
import { BASE } from '../../api/client';

/**
 * 3D model of the landing site: a 40 × 40 km block of ground around the point, shaped by LOLA
 * heights and covered with LROC imagery (backend: services/site_model.py).
 *
 * Model units: the block is 2·HALF wide and the site sits at the origin, on the ground (y = 0).
 * x = east, y = up, z = south, the same axes as the sky dome (north = −z). The geometry is at TRUE
 * scale, and it includes the Moon's curvature; the overview stretches it vertically with a group scale.
 */
export const HALF = 16; // half the block's side, in model units
const MOON_R_M = 1_737_400;

const cache = new Map(); // `${lat},${lon}` → Promise<model>
const MAX_CACHED = 4;

const key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

async function load(lat, lon) {
  const q = `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(`${BASE}/terrain/moon/site/heights.json?${q}`);
  if (!res.ok) throw new Error(`Terrain HTTP ${res.status}`);
  const d = await res.json();
  const { n, heights_m: h, center_m: center } = d;
  const mPerUnit = (d.span_km * 1000) / (2 * HALF);
  const step = (2 * HALF) / (n - 1);

  // ground surface: row 0 = north edge (−z), column 0 = west edge (−x)
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const x = -HALF + j * step;
      const z = -HALF + i * step;
      // height above the site, minus the drop of the curved surface below the site's level plane
      const y = (h[k] - center) / mPerUnit - ((x * x + z * z) * mPerUnit) / (2 * MOON_R_M);
      pos.set([x, y, z], k * 3);
      uv.set([j / (n - 1), 1 - i / (n - 1)], k * 2);
      minY = Math.min(minY, y);
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + 1, c = a + n, e = c + 1;
      idx.set([a, c, b, b, c, e], t);
      t += 6;
    }
  }
  const ground = new BufferGeometry();
  ground.setAttribute('position', new BufferAttribute(pos, 3));
  ground.setAttribute('uv', new BufferAttribute(uv, 2));
  ground.setIndex(new BufferAttribute(idx, 1));
  ground.computeVertexNormals();
  ground.computeBoundingSphere();

  // sides of the block, down to a flat base: the outline of the four edges, walked clockwise
  const base = minY - 0.6;
  const rim = [];
  for (let j = 0; j < n; j++) rim.push(j); // north edge, west → east
  for (let i = 1; i < n; i++) rim.push(i * n + n - 1); // east edge, north → south
  for (let j = n - 2; j >= 0; j--) rim.push((n - 1) * n + j); // south edge, east → west
  for (let i = n - 2; i >= 0; i--) rim.push(i * n); // west edge, south → north
  const wall = new Float32Array(rim.length * 6);
  rim.forEach((k, m) => {
    wall.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], pos[k * 3], base, pos[k * 3 + 2]], m * 6);
  });
  const wIdx = [];
  for (let m = 0; m < rim.length - 1; m++) {
    const a = m * 2, b = a + 1, c = a + 2, e = a + 3;
    wIdx.push(a, b, c, c, b, e);
  }
  const walls = new BufferGeometry();
  walls.setAttribute('position', new BufferAttribute(wall, 3));
  walls.setIndex(wIdx);
  walls.computeVertexNormals();

  // imagery is optional: without it the ground is plain grey, shaded by the Sun
  let texture = null;
  try {
    texture = await new TextureLoader().loadAsync(`${BASE}/terrain/moon/site/imagery.jpg?${q}`);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 8;
  } catch {
    texture = null;
  }

  return {
    ground,
    walls,
    texture,
    base,
    spanKm: d.span_km,
    dataset: d.dataset_id,
    demSpacingM: d.dem_spacing_m,
    centerM: center,
    reliefM: d.max_m - d.min_m,
  };
}

/** The same model object for both views (overview and from the lander); a few recent sites are kept. */
function getModel(lat, lon) {
  const k = key(lat, lon);
  let p = cache.get(k);
  if (!p) {
    p = load(lat, lon);
    p.catch(() => cache.delete(k)); // a failure is retried on the next request
    cache.set(k, p);
    if (cache.size > MAX_CACHED) {
      const [oldKey, old] = cache.entries().next().value;
      cache.delete(oldKey);
      old.then((m) => { m.ground.dispose(); m.walls.dispose(); m.texture?.dispose(); }, () => {});
    }
  }
  return p;
}

/** { model, loading, error } for the landing site at lat/lon. */
export function useSiteModel(lat, lon) {
  const k = lat == null || lon == null ? null : key(lat, lon);
  const [state, setState] = useState({ key: null, model: null, error: null });
  useEffect(() => {
    if (!k) return undefined;
    let live = true;
    getModel(lat, lon).then(
      (model) => live && setState({ key: k, model, error: null }),
      (e) => live && setState({ key: k, model: null, error: e.message || String(e) }),
    );
    return () => { live = false; };
  }, [k, lat, lon]);
  const current = state.key === k;
  return {
    model: current ? state.model : null,
    error: current ? state.error : null,
    loading: !!k && !current,
  };
}
