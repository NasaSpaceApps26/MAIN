import type { ReactNode } from 'react'
import styles from './AppLayout.module.css'

export function AppLayout({ children }: { children: ReactNode }) {
  return <div className={styles.layout}>{children}</div>
}
