import { HashRouter, Routes, Route, NavLink, Outlet } from 'react-router-dom'
import Home from './views/Home'
import Measurement from './views/Measurement'
import Settings from './views/Settings'
import { SettingsProvider } from './settings/SettingsContext'
import './App.css'

// Top-level layout: a header with the app name and a small nav,
// and an <Outlet/> where the active route renders its content.
function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">RT60</h1>
        <nav className="app-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/measure">Measure</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  // HashRouter is used (not BrowserRouter) so the app can be hosted on
  // GitHub Pages without server-side SPA fallback. URLs look like
  // /#/measure instead of /measure but this avoids 404s on refresh.
  return (
    <SettingsProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="measure" element={<Measurement />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </SettingsProvider>
  )
}
