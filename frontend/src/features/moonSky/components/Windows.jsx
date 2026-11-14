import { fmtUtc, formatDuration } from '../format.js';

function Table({ title, cls, windows, at, onSeek }) {
  return (
    <div className="wtable">
      <h3 className={cls}>{title}</h3>
      {windows.length === 0 ? (
        <p className="muted">None in range.</p>
      ) : (
        <table>
          <thead><tr><th>From</th><th>To</th><th>Duration</th></tr></thead>
          <tbody>
            {windows.map((w, i) => (
              <tr key={i} className={w.start <= at && at <= w.end ? 'current' : ''} onClick={() => onSeek(w.start)}>
                <td>{w.startKnown ? fmtUtc(w.start) : '(before range)'}</td>
                <td>{w.endKnown ? fmtUtc(w.end) : '(after range)'}</td>
                <td>{(w.startKnown && w.endKnown ? '' : '≥ ') + formatDuration(w.durationMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Windows({ a, onSeek }) {
  return (
    <div className="windows">
      <Table title="☀️ Daylight (Sun)" cls="sun" windows={a.sun.windows} at={a.at} onSeek={onSeek} />
      <Table title="🌍 Earth above horizon" cls="earth" windows={a.earth.windows} at={a.at} onSeek={onSeek} />
      <Table title="✅ Sun + Earth" cls="both" windows={a.both.windows} at={a.at} onSeek={onSeek} />
    </div>
  );
}
