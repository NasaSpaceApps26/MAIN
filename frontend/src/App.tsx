import { AppLayout } from './components/AppLayout/AppLayout'
import { Hud } from './components/Hud/Hud'
import { SolarSystem } from './components/SolarSystem/SolarSystem'

export default function App() {
  return (
    <AppLayout>
      <SolarSystem />
      <Hud />
    </AppLayout>
  )
}