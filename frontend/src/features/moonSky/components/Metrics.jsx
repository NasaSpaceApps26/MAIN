import { compass, fmtDeg, fmtUtc, formatDuration } from '../format.js';

function BodyCard({ name, cls, b }) {
  return (
    <div className={`metric ${cls}`}>
      <h3>
        {name}
        <span className={b.isUp ? 'badge up' : 'badge down'}>{b.isUp ? 'above horizon' : 'below horizon'}</span>
      </h3>
      <dl>
        <dt>Elevation</dt><dd>{fmtDeg(b.el, 2)}</dd>
        <dt>Azimuth</dt><dd>{fmtDeg(b.az)} ({compass(b.az)})</dd>
        {b.isUp ? (
          <>
            <dt>Until set</dt><dd>{b.minutesToSet != null ? formatDuration(b.minutesToSet) : 'after end of range'}</dd>
            <dt>Set</dt><dd>{fmtUtc(b.nextSet)}</dd>
            <dt>Peak in this window</dt><dd>{b.currentPeak ? fmtDeg(b.currentPeak.el) : '—'}</dd>
          </>
        ) : (
          <>
            <dt>Until rise</dt><dd>{b.minutesToRise != null ? formatDuration(b.minutesToRise) : 'after end of range'}</dd>
            <dt>Rise</dt><dd>{fmtUtc(b.nextRise)}</dd>
          </>
        )}
        <dt>Above horizon</dt><dd>{(b.fractionUp * 100).toFixed(0)}% of range</dd>
      </dl>
    </div>
  );
}

export default function Metrics({ a }) {
  const nextBoth = a.both.windows.find((w) => w.start > a.at);
  return (
    <div className="metrics">
      <BodyCard name="Sun" cls="sun" b={a.sun} />
      <BodyCard name="Earth" cls="earth" b={a.earth} />
      <div className={`metric both ${a.both.isUp ? 'ok' : 'warn'}`}>
        <h3>Power + communications</h3>
        {a.both.isUp ? (
          <p>Sun and Earth visible at the same time.
            <br />Ends in: <b>{a.both.minutesToEnd != null ? formatDuration(a.both.minutesToEnd) : 'after end of range'}</b></p>
        ) : (
          <p>Missing {!a.sun.isUp && !a.earth.isUp ? 'Sun and Earth' : !a.sun.isUp ? 'Sun (no power)' : 'Earth (no communications)'}.
            <br />Next shared window: <b>{nextBoth ? `in ${formatDuration(Math.round((nextBoth.start - a.at) / 60_000))}` : 'none in range'}</b></p>
        )}
      </div>
    </div>
  );
}
