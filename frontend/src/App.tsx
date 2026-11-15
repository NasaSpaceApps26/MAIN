import { AppLayout } from './components/AppLayout/AppLayout'
import { BackendStatus } from './components/BackendStatus/BackendStatus'
import { MoonSkyDrawer } from './components/MoonSkyDrawer/MoonSkyDrawer'
import { SolarSystem } from './components/SolarSystem/SolarSystem'
import { TopBar } from './components/TopBar/TopBar'
import { LaunchSiteViewer } from './features/launchSites/LaunchSiteViewer'
import { MissionPanel } from './features/mission/MissionPanel'

export default function App() {
  return (
    <AppLayout header={<TopBar />}>
      <BackendStatus />
      <SolarSystem />
      <MissionPanel />
      <MoonSkyDrawer />
      <LaunchSiteViewer />
    </AppLayout>
  )
}
