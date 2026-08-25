import { useEffect } from 'react'
import { applyStoredUiPrefs } from './lib/uiPrefs'
import { readDesktopPrefs } from './lib/desktopPrefs'
import { isDesktopApp } from './lib/apiOrigin'
import { callManager } from './lib/webrtc'
import { Login } from './components/Login'
import { Shell } from './components/Shell'
import { TitleBar } from './components/TitleBar'
import { UpdateNotifier } from './components/UpdateNotifier'
import { ScreenSharePicker } from './components/ScreenSharePicker'
import { useAppStore } from './store'

export default function App() {
  const me = useAppStore((s) => s.me)
  const ready = useAppStore((s) => s.authReady)
  const resume = useAppStore((s) => s.resumeSession)

  useEffect(() => {
    resume()
    applyStoredUiPrefs()
  }, [resume])

  useEffect(() => {
    if (!isDesktopApp()) return
    const onVis = () => {
      if (!readDesktopPrefs().minimizeToBackground) return
      if (document.hidden) void callManager.enterPowerSave()
      else void callManager.exitPowerSave()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  if (!ready) {
    return (
      <>
        <TitleBar />
        <div className="boot">Entrando…</div>
      </>
    )
  }

  return (
    <>
      <TitleBar />
      <UpdateNotifier />
      {me ? (
        <>
          <Shell />
          <ScreenSharePicker />
        </>
      ) : (
        <Login />
      )}
    </>
  )
}
