import { HashRouter, Routes, Route, NavLink, Outlet } from 'react-router-dom'
import Home from './views/Home'
import Measurement from './views/Measurement'
import Settings from './views/Settings'
import { SettingsProvider } from './settings/SettingsContext'
import { MeasurementDraftProvider } from './measurement/DraftContext'
import './App.css'

// NVC website — replace with the canonical URL once confirmed.
// Set as a const so it's easy to update in one place.
const NVC_WEBSITE_URL = 'https://nvc.com.au'

// Top-level layout. Header has three rows on iPhone:
//   1. Brand bar — NVC mark on the left, "RT60" title centred, external
//      link to the NVC website on the right.
//   2. Tab nav with the teal underline rule.
// And an <Outlet/> where the active route renders its content.
function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-bar">
          <img
            className="app-mark-nvc"
            src={`${import.meta.env.BASE_URL}nvc-mark.svg`}
            alt="NVC"
            width="120"
            height="38"
          />
          <h1 className="app-title">RT60</h1>
          <a
            className="app-mark-link"
            href={NVC_WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit NVC website"
          >
            <ExternalLinkIcon />
          </a>
        </div>
        <nav className="app-nav">
          <NavLink to="/" end>History</NavLink>
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

/** Compact external-link icon used in the brand bar. Inline SVG so it
 *  inherits currentColor from the parent <a> for hover/focus styling. */
function ExternalLinkIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

export default function App() {
  // HashRouter is used (not BrowserRouter) so the app can be hosted on
  // GitHub Pages without server-side SPA fallback. URLs look like
  // /#/measure instead of /measure but this avoids 404s on refresh.
  return (
    <SettingsProvider>
      <MeasurementDraftProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="measure" element={<Measurement />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </HashRouter>
      </MeasurementDraftProvider>
    </SettingsProvider>
  )
}
