import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
} from "react-router-dom";
import { LayoutDashboard, Landmark, LogOut, ShieldCheck } from "lucide-react";

import EmployeeLogin from "./pages/EmployeeLogin";
import Signup from "./pages/Signup";
import Login from "./pages/login";
import Cams from "./pages/cams";
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
  Finance Hub Navigation
========================= */
function AppShell({ children }) {
  const navigate = useNavigate();

  const fullname =
    localStorage.getItem("fullname") || "Employee";
  const displayName = fullname
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  const department =
    localStorage.getItem("department") || "Banking";

  const logout = () => {
    localStorage.clear();
    navigate("/employee-login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">L</div>

          <div className="brand-copy">
            <span className="brand-name">Labdhi Banking</span>
            <span className="brand-product">Finance Hub</span>
          </div>
        </div>

        <nav className="topbar-nav" aria-label="Main navigation">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            <LayoutDashboard size={17} strokeWidth={1.8} />
            Dashboard
          </NavLink>

          <NavLink
            to="/banking"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            <Landmark size={17} strokeWidth={1.8} />
            Banking
          </NavLink>

          <NavLink
            to="/insurance"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            <ShieldCheck size={17} strokeWidth={1.8} />
            Insurance
          </NavLink>
        </nav>

        <div className="topbar-account">
          <div className="profile-card">
            <span className="profile-avatar" aria-hidden="true">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <small>{department}</small>
            </span>
          </div>

          <button className="topbar-logout" onClick={logout}>
            <LogOut size={17} strokeWidth={1.8} />
            <span>Logout</span>
          </button>
        </div>
      </header>

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
            <AppShell>
              <Dashboard />
            </AppShell>
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