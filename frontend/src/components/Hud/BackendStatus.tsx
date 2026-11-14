import { useHealth } from '../../api/hooks'

export function BackendStatus() {
  const health = useHealth()
  const status = health.isLoading ? '…' : health.isError ? 'offline' : health.data?.status
  return <p>Backend: {status}</p>
}
