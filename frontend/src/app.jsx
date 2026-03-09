import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";

import CommunityScreen from "./screens/CommunityScreen";
import HomeScreen from "./screens/HomeScreen";
import LoginScreen from "./screens/LoginScreen";
import ModelTestingScreen from "./screens/ModelTestingScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
import { getUser } from "./services/auth";
import "./styles/global.css";

function SplashScreen() {
  return (
    <div className="splash">
      <div className="splash-logo">
        <div className="shield-icon">[]</div>
        <h1>AegisHer</h1>
        <p>Your safety, our mission</p>
      </div>
    </div>
  );
}

function OnboardingPage({ onComplete }) {
  const navigate = useNavigate();
  return (
    <OnboardingScreen
      onComplete={(nextUser) => {
        onComplete(nextUser);
        navigate("/home", { replace: true });
      }}
    />
  );
}

function LoginPage({ onComplete }) {
  const navigate = useNavigate();
  return (
    <LoginScreen
      onComplete={(nextUser) => {
        onComplete(nextUser);
        navigate("/home", { replace: true });
      }}
    />
  );
}

function MainShell({ children }) {
  return (
    <div className="app-shell">
      <div className="screen-content">{children}</div>
      <nav className="bottom-nav">
        <NavLink to="/home" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <span className="nav-icon">S</span><span className="nav-label">Safety</span>
        </NavLink>
        <NavLink to="/community" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <span className="nav-icon">C</span><span className="nav-label">Community</span>
        </NavLink>
      </nav>
    </div>
  );
}

function ProtectedPage({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const isDevTools = import.meta.env.DEV;

  useEffect(() => {
    setUser(getUser());
    setLoading(false);
  }, []);

  if (loading) return <SplashScreen />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? "/home" : "/login"} replace />} />
      <Route
        path="/login"
        element={user ? <Navigate to="/home" replace /> : <LoginPage onComplete={setUser} />}
      />
      <Route
        path="/onboarding"
        element={user ? <Navigate to="/home" replace /> : <OnboardingPage onComplete={setUser} />}
      />
      <Route
        path="/home"
        element={
          <ProtectedPage user={user}>
            <MainShell>
              <HomeScreen user={user} />
            </MainShell>
          </ProtectedPage>
        }
      />
      <Route
        path="/community"
        element={
          <ProtectedPage user={user}>
            <MainShell>
              <CommunityScreen user={user} />
            </MainShell>
          </ProtectedPage>
        }
      />
      {isDevTools && (
        <Route
          path="/ml-test"
          element={
            <ProtectedPage user={user}>
              <MainShell>
                <ModelTestingScreen />
              </MainShell>
            </ProtectedPage>
          }
        />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
