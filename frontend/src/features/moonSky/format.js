export { formatDuration } from './analysis.js';

export const fmtUtc = (t) =>
  t == null ? '—' : new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export const fmtDeg = (v, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}°`);

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (az) => DIRS[Math.round(((az % 360) + 360) % 360 / 45) % 8];

/** Current UTC time rounded down to the full hour, in datetime-local format. */
export const nowUtcInput = () => new Date(Math.floor(Date.now() / 3600_000) * 3600_000).toISOString().slice(0, 16);
