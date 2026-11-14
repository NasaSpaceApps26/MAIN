import { useEffect } from 'react'
import { useHealth } from '../../api/hooks'

export function BackendStatus() {
  const { data, isError } = useHealth()
  const status = isError ? 'offline' : data?.status

  useEffect(() => {
    if (!status) return
    if (status === 'ok') {
      console.info('%c[backend] online', 'color: #5cc8ff')
    } else {
      console.warn('[backend] offline – is the backend container running?')
    }
  }, [status])

  return null
}
