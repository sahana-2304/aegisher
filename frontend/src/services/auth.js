import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const USER_KEY = "aegisher_user";
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function mapFirebaseError(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "Email is already registered.";
  if (code.includes("invalid-email")) return "Invalid email address.";
  if (code.includes("weak-password")) return "Password is too weak.";
  if (code.includes("invalid-credential")) return "Invalid email or password.";
  if (code.includes("wrong-password")) return "Invalid email or password.";
  if (code.includes("user-not-found")) return "User not found.";
  return error?.message || "Authentication failed";
}

function persistUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

async function backendRequest(path, token, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
    ...opts,
  });

  if (!res.ok) {
    let detail = `Backend error ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      // Ignore parse errors and keep generic detail.
    }
    throw new Error(detail);
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildSessionUser(uid, profile, fallbackEmail = "") {
  return {
    id: uid,
    user_id: uid,
    name: profile?.name || "User",
    email: profile?.email || fallbackEmail,
    phone: profile?.phone || "",
    emergency1: profile?.emergency_contact_1 || "",
    emergency2: profile?.emergency_contact_2 || "",
    address: profile?.address || "",
    createdAt: profile?.created_at || new Date().toISOString(),
    lastLoginAt: profile?.last_login_at || new Date().toISOString(),
  };
}

export async function registerUser(formData) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
    const uid = cred.user.uid;
    const idToken = await cred.user.getIdToken();
    const now = new Date().toISOString();

    const profile = {
      user_id: uid,
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      emergency_contact_1: formData.emergency1,
      emergency_contact_2: formData.emergency2,
      address: formData.address,
      created_at: now,
      last_login_at: now,
    };

    try {
      await backendRequest("/api/auth/register", idToken, {
        method: "POST",
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          email: formData.email,
          emergency_contact_1: formData.emergency1,
          emergency_contact_2: formData.emergency2,
          address: formData.address,
          fcm_token: null,
        }),
      });
    } catch {
      // Fallback to direct Firestore write when backend auth service is unavailable.
      await setDoc(doc(db, "Users", uid), profile, { merge: true });
    }

    return persistUser(buildSessionUser(uid, profile, formData.email));
  } catch (error) {
    throw new Error(mapFirebaseError(error));
  }
}

export async function loginUser({ email, password }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    const ref = doc(db, "Users", uid);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();

    let profile;
    if (snap.exists()) {
      profile = snap.data();
      await updateDoc(ref, { last_login_at: now });
      profile.last_login_at = now;
    } else {
      profile = {
        user_id: uid,
        name: "User",
        phone: "",
        email: email,
        emergency_contact_1: "",
        emergency_contact_2: "",
        address: "",
        created_at: now,
        last_login_at: now,
      };
      await setDoc(ref, profile, { merge: true });
    }

    return persistUser(buildSessionUser(uid, profile, email));
  } catch (error) {
    throw new Error(mapFirebaseError(error));
  }
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}
