import type { ReactNode } from 'react'
import styles from './AppLayout.module.css'

type Props = {
  header: ReactNode
  children: ReactNode
}

export function AppLayout({ header, children }: Props) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>{header}</header>
      <main className={styles.viewport}>{children}</main>
    </div>
  )
}
