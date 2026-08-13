import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar         from './components/Navbar';
import Footer         from './components/Footer';
import RequireRole     from './components/RequireRole';
import Home           from './pages/Home';
import About          from './pages/About';
import Login          from './pages/Login';
import Register       from './pages/Register';
import Electricity    from './pages/Electricity';
import Fuel           from './pages/Fuel';
import Roads          from './pages/Roads';
import Health         from './pages/Health';
import Transportation from './pages/Transportation';
import Offices from './pages/Offices';
import Report         from './pages/Report';
import MapView        from './pages/MapView';
import Admin          from './pages/Admin';
import ChangePassword    from './pages/ChangePassword';
import ApplyOrganization from './pages/ApplyOrganization';
import StaffManagement   from './pages/StaffManagement';
import FuelStationsManager from './pages/FuelStationsManager';
import Notifications from './pages/Notifications';
import DashboardHeader from './components/DashboardHeader';
import './styles/global.css';

// Routes that render their own full-page layout (dashboard-style)
// and shouldn't be wrapped in the citizen-facing Navbar/Footer.
const NO_CHROME_PREFIXES = ['/admin', '/staff'];

function ForcePasswordChangeGuard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (user?.must_change_password && location.pathname !== '/change-password') {
      navigate('/change-password', { replace: true });
    }
  }, [user, location, navigate]);

  return null;
}

// On a fresh page load (npm start, or a browser refresh) the session is
// restored silently from localStorage — no login submit ever fires, so the
// role-based redirect in Login.js never runs, and a staff/lead/admin account
// is left stranded on whatever page the tab was last on (usually the citizen
// homepage). This sends them to their own homepage ONCE, right after that
// initial load — the `hasRedirected` ref means it never fires again during
// this session, so clicking "Home" afterward stays on the citizen homepage
// as normal, instead of fighting the person every time they navigate there.
function RoleHomeGuard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const hasRedirected = React.useRef(false);

  React.useEffect(() => {
    if (hasRedirected.current) return;
    if (!user || location.pathname !== '/') return;
    if (user.must_change_password) return; // ForcePasswordChangeGuard handles this case instead

    if (user.role === 'admin') {
      hasRedirected.current = true;
      navigate('/admin', { replace: true });
    } else if (user.role === 'org_lead') {
      hasRedirected.current = true;
      navigate('/staff', { replace: true });
    } else if (user.role === 'org_staff') {
      hasRedirected.current = true;
      navigate('/staff/fuel-stations', { replace: true });
    }
  }, [user, location, navigate]);

  return null;
}

function Chrome({ children }) {
  const location = useLocation();
  const isDashboard = NO_CHROME_PREFIXES.some(p => location.pathname.startsWith(p));

  return (
    <>
      {isDashboard ? <DashboardHeader/> : <Navbar/>}
      {children}
      {!isDashboard && <Footer/>}
    </>
  );
}

export default function App() {
  // Some browsers restore a cached visual snapshot of the page when you
  // navigate back (the "back-forward cache"), without actually re-running
  // React or re-checking auth state — meaning right after logging out,
  // pressing Back could briefly show what LOOKS like a still-logged-in
  // page. Forcing a full reload when a persisted/cached page is restored
  // ensures the app always freshly re-evaluates the real (logged-out)
  // state instead.
  React.useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return (
    <AuthProvider>
      <Router>
        <ForcePasswordChangeGuard/>
        <RoleHomeGuard/>
        <Chrome>
          <Routes>
            <Route path="/"               element={<Home/>}/>
            <Route path="/about"          element={<About/>}/>
            <Route path="/login"          element={<Login/>}/>
            <Route path="/register"       element={<Register/>}/>
            <Route path="/electricity"    element={<Electricity/>}/>
            <Route path="/fuel"           element={<Fuel/>}/>
            <Route path="/roads"          element={<Roads/>}/>
            <Route path="/health"         element={<Health/>}/>
            <Route path="/transportation" element={<Transportation/>}/>
            <Route path="/offices" element={<Offices />} />
            <Route path="/report"         element={<Report/>}/>
            <Route path="/map"            element={<MapView/>}/>
            <Route path="/notifications"  element={<Notifications/>}/>
            <Route path="/admin"          element={<Admin/>}/>
            <Route path="/change-password" element={<ChangePassword/>}/>
            <Route path="/organizations/apply" element={<ApplyOrganization/>}/>
            <Route path="/staff" element={<RequireRole roles={['org_lead']}><StaffManagement/></RequireRole>}/>
            <Route path="/staff/fuel-stations" element={<RequireRole roles={['org_staff']}><FuelStationsManager/></RequireRole>}/>
          </Routes>
        </Chrome>
      </Router>
    </AuthProvider>
  );
}