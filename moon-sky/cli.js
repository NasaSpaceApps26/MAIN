// Quick command-line check (no React):
//   node cli.js apollo11 2026-11-14T00:00Z 30
//   node cli.js -- -80.13 1.44 2026-11-14T00:00Z 30      (custom lat lon)

import { readFileSync } from 'node:fs';
import { fetchSky } from './lib/horizons.js';
import { analyzeSky, formatDuration } from './lib/analysis.js';

const SITES = JSON.parse(readFileSync(new URL('./lib/sites.json', import.meta.url)));
const args = process.argv.slice(2).filter((a) => a !== '--');

let lat, lon, rest, name;
const site = SITES.find((s) => s.id === args[0]);
if (site) { ({ lat, lon, name } = site); rest = args.slice(1); }
else { lat = +args[0]; lon = +args[1]; name = `${lat}, ${lon}`; rest = args.slice(2); }

const start = new Date(rest[0] ?? Date.now());
const days = +(rest[1] ?? 30);
const stop = new Date(start.getTime() + days * 86400_000);
const fmt = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '— (outside range)');

const sky = await fetchSky({ lat, lon, start, stop, step: '10m' });
const a = analyzeSky(sky, start.getTime());

console.log(`\n${name}  (lat ${lat}, lon ${lon})   moment: ${fmt(a.at)}\n`);
for (const [label, b] of [['SUN', a.sun], ['EARTH', a.earth]]) {
  console.log(`${label}: elevation ${b.el.toFixed(2)}°, azimuth ${b.az.toFixed(2)}°, ${b.isUp ? 'ABOVE horizon' : 'below horizon'}`);
  console.log(`  next rise: ${fmt(b.nextRise)}`);
  console.log(`  next set:  ${fmt(b.nextSet)}`);
  if (b.isUp) console.log(`  until set: ${formatDuration(b.minutesToSet)}`);
  else console.log(`  until rise: ${formatDuration(b.minutesToRise)}`);
  console.log(`  above horizon for ${(b.fractionUp * 100).toFixed(1)}% of the range, windows: ${b.windows.length}`);
  for (const w of b.windows) {
    console.log(`    ${fmt(w.start)}${w.startKnown ? '' : '*'} → ${fmt(w.end)}${w.endKnown ? '' : '*'}  (${formatDuration(w.durationMin)})`);
  }
}
console.log(`\nSun + Earth at the same time: ${a.both.windows.length} windows`);
console.log('(* = window cut off by the edge of the fetched range)\n');
