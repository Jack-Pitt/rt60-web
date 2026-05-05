import { Link } from 'react-router-dom'

// Home view: shows the list of past measurements (added in step 7),
// and a big "New measurement" button. For now (step 1) we render a
// placeholder so the user can see the three-view shell working.
export default function Home() {
  return (
    <div className="view view-home">
      <p className="view-stub">No measurements saved yet.</p>
      <Link to="/measure" className="primary-btn">
        + New measurement
      </Link>
    </div>
  )
}
