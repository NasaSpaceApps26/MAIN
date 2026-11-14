// Offline tests: a fake response in Horizons format + checks of the calculations.
//   node test.js
import assert from 'node:assert/strict';
import { parseHorizonsResult, fetchSky, buildHorizonsUrl } from './lib/horizons.js';
import { analyzeSky, findCrossings, positionAt } from './lib/analysis.js';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (t) => {
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${MON[d.getUTCMonth()]}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

const T0 = Date.UTC(2026, 10, 14);
const STEP = 10 * 60_000;
const N = 30 * 144;               // 30 days every 10 min
const SYNODIC = 29.53 * 86400_000;

// Sun: sets exactly at T0 + 3 days, then night lasts ~14.77 d
const sunEl = (t) => 80 * Math.sin((2 * Math.PI * (t - (T0 + 3 * 86400_000))) / SYNODIC + Math.PI);
// Earth (site near the limb of the disc): libration ±4° around 1°
const earthEl = (t) => 1 + 4 * Math.sin((2 * Math.PI * (t - T0)) / (27.32 * 86400_000));

function fakeResult(elFn, azFn) {
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const t = T0 + i * STEP;
    rows.push(` ${fmt(t)},*, ,${azFn(t).toFixed(6)}, ${elFn(t).toFixed(6)},`);
  }
  return [
    'API VERSION: 1.2', 'Center geodetic : 23.473,0.6741,0', '',
    '*******************************************************************************',
    ' Date__(UT)__HR:MN, , ,Azi_(a-app), Elev_(a-app),',
    '*******************************************************************************',
    '$$SOE', ...rows, '$$EOE', '*******************************************************************************',
  ].join('\n');
}

const fakeFetch = async (url) => {
  const isSun = decodeURIComponent(url).includes("COMMAND='10'");
  const result = isSun
    ? fakeResult(sunEl, (t) => (90 + (t - T0) / 86400_000) % 360)
    : fakeResult(earthEl, (t) => (359.5 + 0.2 * Math.sin((t - T0) / 86400_000)) % 360);
  return { ok: true, json: async () => ({ result }) };
};

// --- URL ---
const url = decodeURIComponent(buildHorizonsUrl({ body: '10', lat: 0.6741, lon: 23.473, start: T0, stop: T0 + 86400_000 }));
assert.match(url, /CENTER='coord@301'/);
assert.match(url, /SITE_COORD='23.473,0.6741,0'/);
assert.match(url, /START_TIME='2026-11-14 00:00'/);

// --- parser ---
const parsed = parseHorizonsResult(fakeResult(sunEl, () => 10));
assert.equal(parsed.length, N + 1);
assert.equal(parsed[0].t, T0);
assert.throws(() => parseHorizonsResult('Cannot interpret date'), /returned no ephemeris/);

// --- analysis ---
const sky = await fetchSky({ lat: 0.6741, lon: 23.473, start: T0, stop: T0 + 30 * 86400_000 }, { fetchImpl: fakeFetch });
const a = analyzeSky(sky, T0);

assert.ok(a.sun.isUp);
const expectedSet = T0 + 3 * 86400_000;
assert.ok(Math.abs(a.sun.nextSet - expectedSet) < 60_000, 'sunset ±1 min');
assert.ok(Math.abs(a.sun.minutesToSet - 3 * 1440) <= 1);
const night = a.sun.windows[1].start - a.sun.windows[0].end;
assert.ok(Math.abs(night - SYNODIC / 2) < 5 * 60_000, 'night ≈ half a synodic day');

const ec = findCrossings(sky.earth, 0);
assert.ok(ec.length >= 2, 'Earth rises and sets due to libration');
assert.ok(a.both.windows.length >= 1);

// azimuth interpolation across 0/360
const p = positionAt([{ t: 0, az: 359, el: 0 }, { t: 10, az: 1, el: 2 }], 5);
assert.ok(Math.abs(p.az - 0) < 1e-9 || Math.abs(p.az - 360) < 1e-9);
assert.equal(p.el, 1);

// Horizons 503 / dropped connection → retried; a 400 is not retried
{
  let calls = 0;
  const flaky = async (url, opts) => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, headers: new Headers() };
    if (calls === 2) throw new TypeError('fetch failed');
    return fakeFetch(url, opts);
  };
  const noSleep = async () => {};
  const s = await fetchSky({ lat: 0.6741, lon: 23.473, start: T0, stop: T0 + 86400_000 }, { fetchImpl: flaky, sleep: noSleep });
  assert.ok(s.sun.length > 0 && s.earth.length > 0, 'retries recover from 503 and network errors');

  let badCalls = 0;
  const bad = async () => { badCalls++; return { ok: false, status: 400, headers: new Headers() }; };
  await assert.rejects(
    fetchSky({ lat: 0, lon: 0, start: T0, stop: T0 + 86400_000 }, { fetchImpl: bad, sleep: noSleep }),
    /HTTP 400/,
  );
  assert.equal(badCalls, 2, '400 is not retried (one call per body)');

  const down = async () => ({ ok: false, status: 503, headers: new Headers() });
  await assert.rejects(
    fetchSky({ lat: 0, lon: 0, start: T0, stop: T0 + 86400_000 }, { fetchImpl: down, sleep: noSleep }),
    (e) => e.upstreamBusy === true,
  );
}

console.log('OK – all tests passed');
console.log('Sun: until set', a.sun.minutesToSet, 'min; windows:', a.sun.windows.length);
console.log('Earth: el', a.earth.el.toFixed(2), '°; rises/sets:', ec.length);
