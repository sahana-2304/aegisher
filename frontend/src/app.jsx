import { useState, useEffect } from "react";
import OnboardingScreen from "./screens/OnboardingScreen";
import HomeScreen from "./screens/HomeScreen";
import CommunityScreen from "./screens/CommunityScreen";
import { getUser } from "./services/auth";
import "./styles/global.css";

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("home");

  useEffect(() => {
    const saved = getUser();
    if (saved) { setUser(saved); setScreen("main"); }
    else setScreen("onboarding");
  }, []);

  if (screen === "loading") return (
    <div className="splash">
      <div className="splash-logo">
        <div className="shield-icon">⬡</div>
        <h1>AegisHer</h1>
        <p>Your safety, our mission</p>
      </div>
    </div>
  );

  if (screen === "onboarding") return (
    <OnboardingScreen onComplete={(u) => { setUser(u); setScreen("main"); }} />
  );

  return (
    <div className="app-shell">
      <div className="screen-content">
        {activeTab === "home" && <HomeScreen user={user} />}
        {activeTab === "community" && <CommunityScreen user={user} />}
      </div>
      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
          <span className="nav-icon">◈</span><span className="nav-label">Safety</span>
        </button>
        <button className={`nav-item ${activeTab === "community" ? "active" : ""}`} onClick={() => setActiveTab("community")}>
          <span className="nav-icon">◎</span><span className="nav-label">Community</span>
        </button>
      </nav>
    </div>
  );
}