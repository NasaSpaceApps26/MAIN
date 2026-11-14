import { useSimStore } from '../../store/simStore'

const SPEEDS = [1, 60, 3600, 86400]

export function TimeControls() {
  const simTimeMs = useSimStore((s) => s.simTimeMs)
  const isPlaying = useSimStore((s) => s.isPlaying)
  const timeScale = useSimStore((s) => s.timeScale)
  const togglePlay = useSimStore((s) => s.togglePlay)
  const setTimeScale = useSimStore((s) => s.setTimeScale)

  return (
    <div>
      <div>{new Date(simTimeMs).toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
      <button onClick={togglePlay}>{isPlaying ? 'Pause' : 'Play'}</button>
      <select value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>
    </div>
  )
}
