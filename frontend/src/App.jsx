import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
} from "react-router-dom";

import EmployeeLogin from "./pages/EmployeeLogin";
import Signup from "./pages/Signup";
import Login from "./pages/login";
import Cams from "./pages/Cams";
import Otp from "./pages/otp";
import Dashboard from "./pages/Dashboard";
import Banking from "./pages/Banking";
import Insurance from "./pages/Insurance";

import "./App.css";

/* =========================
   Employee Protection
========================= */
function EmployeeProtected({ children }) {
  const employee = localStorage.getItem("employeeLoggedIn");

  if (!employee) {
    return <Navigate to="/employee-login" replace />;
  }

  return children;
}

/* =========================
   Consent Protection
========================= */
function ConsentProtected({ children }) {
  const consentId = localStorage.getItem("consentId");
  const consentActive = localStorage.getItem("camsConsent") === "true";

  if (!consentId || !consentActive) {
    return <Navigate to="/cams" replace />;
  }

  return children;
}

/* =========================
   Sidebar Layout
========================= */
function AppShell({ children }) {
  const navigate = useNavigate();

  const fullname =
    localStorage.getItem("fullname") || "Employee";

  const department =
    localStorage.getItem("department") || "Banking";

  const logout = () => {
    localStorage.clear();
    navigate("/employee-login");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">L</div>

          <div>
            <p className="eyebrow">Labdhi Banking</p>
            <h2>Finance Hub</h2>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? "nav-item active" : "nav-item"
            }
          >
            Dashboard
          </NavLink>

          <NavLink
            to="/banking"
            className={({ isActive }) =>
              isActive ? "nav-item active" : "nav-item"
            }
          >
            Banking
          </NavLink>

          <NavLink
            to="/insurance"
            className={({ isActive }) =>
              isActive ? "nav-item active" : "nav-item"
            }
          >
            Insurance
          </NavLink>
        </nav>

        <div className="profile-card">
          <span className="status-dot"></span>

          <div>
            <strong>{fullname}</strong>
            <small>{department} Department</small>
          </div>
        </div>

        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}

/* =========================
   Main App
========================= */

export default function App() {
  return (
    <Routes>
      {/* Default */}
      <Route
        path="/"
        element={<Navigate to="/employee-login" replace />}
      />

      {/* Employee */}
      <Route
        path="/employee-login"
        element={<EmployeeLogin />}
      />
      <Route path="/signup" element={<Signup />} />

      {/* CAMS */}
      <Route
        path="/cams-login"
        element={
          <EmployeeProtected>
            <Login />
          </EmployeeProtected>
        }
      />

      <Route
        path="/cams"
        element={
          <EmployeeProtected>
            <Cams />
          </EmployeeProtected>
        }
      />

      <Route
        path="/otp"
        element={
          <EmployeeProtected>
            <Otp />
          </EmployeeProtected>
        }
      />

      {/* Dashboard */}
      <Route
        path="/dashboard"
        element={
          <EmployeeProtected>
            <ConsentProtected>
              <AppShell>
                <Dashboard />
              </AppShell>
            </ConsentProtected>
          </EmployeeProtected>
        }
      />

      {/* Banking */}
      <Route
        path="/banking"
        element={
          <EmployeeProtected>
            <ConsentProtected>
              <AppShell>
                <Banking />
              </AppShell>
            </ConsentProtected>
          </EmployeeProtected>
        }
      />

      {/* Insurance */}
      <Route
        path="/insurance"
        element={
          <EmployeeProtected>
            <ConsentProtected>
              <AppShell>
                <Insurance />
              </AppShell>
            </ConsentProtected>
          </EmployeeProtected>
        }
      />

      {/* Invalid Route */}
      <Route
        path="*"
        element={<Navigate to="/employee-login" replace />}
      />
    </Routes>
  );
}