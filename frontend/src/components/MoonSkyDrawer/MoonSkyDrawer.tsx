import { useEffect, useState } from 'react'
import MoonSky from '../../features/moonSky/MoonSky.jsx'
import styles from './MoonSkyDrawer.module.css'

const TABS = [
  { id: 'settings', label: 'Landing settings', hash: '#landing-settings' },
  { id: 'results', label: 'Lunar Sky', hash: '#moon-sky' },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId | null {
  return TABS.find((t) => t.hash === window.location.hash)?.id ?? null
}

/** Open tab lives in the URL hash (#landing-settings / #moon-sky) so it survives reloads and can be linked. */
function useOpenTab() {
  const [tab, setTab] = useState<TabId | null>(tabFromHash)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const set = (next: TabId | null) => {
    const { pathname, search } = window.location
    const hash = TABS.find((t) => t.id === next)?.hash ?? ''
    window.history.replaceState(null, '', pathname + search + hash)
    setTab(next)
  }

  return [tab, set] as const
}

/**
 * Lunar Sky calculator as a panel that slides in over the 3D solar system from the left.
 * Two tabs on its edge: the landing settings form (narrow) and the results (wide).
 * The solar system stays rendered and visible to the right at all times.
 */
export function MoonSkyDrawer() {
  const [tab, setTab] = useOpenTab()
  const open = tab !== null
  // the last tab shown stays rendered while the panel slides out
  const [shown, setShown] = useState<TabId>(tab ?? 'settings')
  if (tab && tab !== shown) setShown(tab)
  // mount the calculator on first open, then keep it mounted so its state and data survive closing
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTab(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setTab])

  const classes = [styles.drawer, open && styles.open, shown === 'results' && styles.wide]
  return (
    <aside className={classes.filter(Boolean).join(' ')} aria-label="Lunar Sky calculator">
      <div className={styles.handles} role="tablist" aria-orientation="vertical">
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="moon-sky-panel"
              className={active ? `${styles.handle} ${styles.active}` : styles.handle}
              title={active ? `Hide ${t.label} (Esc)` : `Show ${t.label}`}
              onClick={() => setTab(active ? null : t.id)}
            >
              <span aria-hidden="true">{active ? '‹' : '›'}</span> {t.label}
            </button>
          )
        })}
      </div>
      <div id="moon-sky-panel" role="tabpanel" className={styles.body} inert={!open}>
        {mounted && <MoonSky view={shown} active={open} />}
      </div>
    </aside>
  )
}
