import { useState } from "react";
import { Link } from "react-router-dom";
import { loginUser } from "../services/auth";

export default function LoginScreen({ onComplete }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  function validate() {
    const next = {};
    if (!/\S+@\S+\.\S+/.test(form.email)) next.email = true;
    if (!form.password || form.password.length < 6) next.password = true;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setApiError("");
    if (!validate()) return;

    setLoading(true);
    try {
      const user = await loginUser({ email: form.email, password: form.password });
      onComplete(user);
    } catch (err) {
      setApiError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const errStyle = (key) => (errors[key] ? { borderColor: "var(--accent-coral)" } : {});

  return (
    <div className="onboarding">
      <div className="onboarding-header">
        <div className="onboarding-badge">
          <span>FIREBASE LOGIN</span>
        </div>
        <h1>AEGIS<em>HER</em></h1>
        <p>Sign in with your Firebase email and password.</p>
      </div>

      <div className="onboarding-form">
        <div className="form-section-label">Sign In</div>
        <div className="field-group">
          <label>Email *</label>
          <input
            type="email"
            placeholder="you@email.com"
            value={form.email}
            onChange={set("email")}
            style={errStyle("email")}
          />
        </div>
        <div className="field-group">
          <label>Password *</label>
          <input
            type="password"
            placeholder="Enter password"
            value={form.password}
            onChange={set("password")}
            style={errStyle("password")}
          />
        </div>

        {apiError && (
          <p style={{ color: "var(--accent-coral)", fontSize: "0.8rem", marginTop: 2 }}>
            {apiError}
          </p>
        )}

        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "SIGNING IN..." : "SIGN IN"}
        </button>

        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center" }}>
          New user?{" "}
          <Link to="/onboarding" style={{ color: "var(--accent-teal)" }}>
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
