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

const inMin = (t, at) => formatDuration(Math.round((t - at) / 60_000));

/**
 * Link to Earth from the launch site (linkAt). Earth turns once a day: for about half of it the launch
 * site faces away from the Moon and there is no straight line, so a relay satellite in Earth orbit
 * has to pass the signal on.
 */
function LinkLine({ link, at }) {
  const name = link.station.name;
  const moon = `Moon ${Math.abs(link.moonEl).toFixed(1)}° ${link.moonEl >= 0 ? 'above' : 'below'} its horizon`;
  if (link.state === 'direct') {
    return (
      <p className="comm direct">
        <b>Direct line to {name}</b> ({moon}).
        <br />{link.endsAt ? <>Earth's rotation turns {name} away in <b>{inMin(link.endsAt, at)}</b>: then a relay satellite in Earth orbit is needed.</> : 'Lasts past the end of the range.'}
      </p>
    );
  }
  if (link.state === 'relay') {
    return (
      <p className="comm relay">
        <b>Relay satellite in Earth orbit needed.</b> {name} is on the other side of Earth ({moon}): there is no
        straight line from {name} to the landing site.
        <br />Direct line again: <b>{link.nextDirect ? `in ${inMin(link.nextDirect, at)}` : 'not within the range'}</b>.
      </p>
    );
  }
  return (
    <p className="comm none">
      <b>No line to Earth:</b> Earth is below the landing site's horizon, so neither {name} nor a satellite in Earth
      orbit can be reached directly – a relay satellite in lunar orbit is needed.
    </p>
  );
}

export default function Metrics({ a, link = null }) {
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
        {link && <LinkLine link={link} at={a.at} />}
      </div>
    </div>
  );
}
