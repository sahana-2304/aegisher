import { useState } from "react";
import { Link } from "react-router-dom";
import { registerUser } from "../services/auth";

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    emergency1: "",
    emergency2: "",
    address: "",
  });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validateStep1() {
    const e = {};
    if (!form.name.trim()) e.name = true;
    if (!/^\+?[\d\s-]{10,}$/.test(form.phone)) e.phone = true;
    if (!/\S+@\S+\.\S+/.test(form.email)) e.email = true;
    if (!form.password || form.password.length < 6) e.password = true;
    if (form.confirmPassword !== form.password) e.confirmPassword = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e = {};
    if (!/^\+?[\d\s-]{10,}$/.test(form.emergency1)) e.emergency1 = true;
    if (!/^\+?[\d\s-]{10,}$/.test(form.emergency2)) e.emergency2 = true;
    if (!form.address.trim()) e.address = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    setApiError("");
    if (step === 1 && validateStep1()) setStep(2);
  }

  async function handleSubmit() {
    setApiError("");
    if (!validateStep2()) return;

    setLoading(true);
    try {
      const user = await registerUser(form);
      onComplete(user);
    } catch (err) {
      setApiError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const err = (k) => (errors[k] ? { borderColor: "var(--accent-coral)" } : {});

  return (
    <div className="onboarding">
      <div className="onboarding-header">
        <div className="onboarding-badge">
          <span>FIREBASE SIGNUP</span>
        </div>
        <h1>
          AEGIS<em>HER</em>
        </h1>
        <p>Create your account with Firebase Auth and store profile data in Firestore.</p>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {[1, 2].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: step >= s ? "var(--accent-teal)" : "var(--border)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
      </div>

      <div className="onboarding-form">
        {step === 1 && (
          <>
            <div className="form-section-label">Personal Details</div>
            <div className="field-group">
              <label>Full Name *</label>
              <input placeholder="Your full name" value={form.name} onChange={set("name")} style={err("name")} />
            </div>
            <div className="field-row">
              <div className="field-group">
                <label>Mobile Number *</label>
                <input placeholder="+91 98765 43210" value={form.phone} onChange={set("phone")} style={err("phone")} />
              </div>
              <div className="field-group">
                <label>Email ID *</label>
                <input placeholder="you@email.com" type="email" value={form.email} onChange={set("email")} style={err("email")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field-group">
                <label>Password *</label>
                <input
                  type="password"
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={set("password")}
                  style={err("password")}
                />
              </div>
              <div className="field-group">
                <label>Confirm Password *</label>
                <input
                  type="password"
                  placeholder="Re-enter password"
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  style={err("confirmPassword")}
                />
              </div>
            </div>
            <button className="btn-primary" onClick={handleNext}>
              {"CONTINUE ->"}
            </button>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center" }}>
              Already have an account?{" "}
              <Link to="/login" style={{ color: "var(--accent-teal)" }}>
                Sign in
              </Link>
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <div className="form-section-label">Emergency Contacts</div>
            <div className="field-group">
              <label>Emergency Contact 1 *</label>
              <input
                placeholder="+91 emergency number"
                value={form.emergency1}
                onChange={set("emergency1")}
                style={err("emergency1")}
              />
            </div>
            <div className="field-group">
              <label>Emergency Contact 2 *</label>
              <input
                placeholder="+91 emergency number"
                value={form.emergency2}
                onChange={set("emergency2")}
                style={err("emergency2")}
              />
            </div>
            <div className="form-section-label" style={{ marginTop: 8 }}>
              Residential Address
            </div>
            <div className="field-group">
              <label>Home Address *</label>
              <input
                placeholder="Your full residential address"
                value={form.address}
                onChange={set("address")}
                style={err("address")}
              />
            </div>

            {apiError && (
              <p style={{ color: "var(--accent-coral)", fontSize: "0.8rem", marginTop: 2 }}>{apiError}</p>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                style={{
                  flex: 1,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 14,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.9rem",
                }}
                onClick={() => setStep(1)}
              >
                {"<- Back"}
              </button>
              <button className="btn-primary" style={{ flex: 2, marginTop: 0 }} onClick={handleSubmit} disabled={loading}>
                {loading ? "CREATING ACCOUNT..." : "ACTIVATE PROTECTION"}
              </button>
            </div>

            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
              Firebase Auth + Firestore enabled
            </p>
          </>
        )}
      </div>
    </div>
  );
}
