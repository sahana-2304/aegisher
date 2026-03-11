import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { app, auth, db, storage } from "./firebase";

const USER_KEY = "aegisher_user";
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const STORAGE_DISABLED_KEY = "aegisher_storage_upload_disabled";
const PROFILE_PHOTO_UPLOAD_MODE = String(import.meta.env.VITE_PROFILE_PHOTO_UPLOAD_MODE || "auto").toLowerCase();

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
    photoUrl: profile?.photo_url || "",
    createdAt: profile?.created_at || new Date().toISOString(),
    lastLoginAt: profile?.last_login_at || new Date().toISOString(),
  };
}

function shouldSkipStorageUpload() {
  if (PROFILE_PHOTO_UPLOAD_MODE === "firestore") return true;
  if (typeof window === "undefined") return false;
  if (PROFILE_PHOTO_UPLOAD_MODE !== "storage" && import.meta.env.DEV) return true;

  return window.sessionStorage.getItem(STORAGE_DISABLED_KEY) === "1";
}

function markStorageUploadFailed() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_DISABLED_KEY, "1");
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode the selected image."));
    };
    image.src = objectUrl;
  });
}

async function compressImageToDataUrl(file) {
  const image = await loadImageFile(file);
  const maxDimension = 420;
  const longestSide = Math.max(image.width, image.height) || 1;
  const scale = Math.min(1, maxDimension / longestSide);

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process this image.");
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

function deriveBucketFallbacks() {
  const configuredBucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim();
  if (!configuredBucket) return [];

  const candidates = [];
  if (configuredBucket.endsWith(".firebasestorage.app")) {
    candidates.push(configuredBucket.replace(/\.firebasestorage\.app$/, ".appspot.com"));
  } else if (configuredBucket.endsWith(".appspot.com")) {
    candidates.push(configuredBucket.replace(/\.appspot\.com$/, ".firebasestorage.app"));
  }

  return [...new Set(candidates)];
}

async function uploadProfilePhotoToStorage(uid, safeName, file) {
  const bucketCandidates = deriveBucketFallbacks();
  const storageClients = [storage];

  for (const bucket of bucketCandidates) {
    storageClients.push(getStorage(app, `gs://${bucket}`));
  }

  let lastError = null;
  for (const storageClient of storageClients) {
    try {
      const photoRef = ref(storageClient, `profile_photos/${uid}/${Date.now()}-${safeName}`);
      await uploadBytes(photoRef, file, { contentType: file.type });
      return await getDownloadURL(photoRef);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Storage upload failed.");
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

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch {
    // Always clear local session even if Firebase sign-out fails.
  }
  clearUser();
}

export async function updateUserProfilePhoto(file) {
  if (!file) throw new Error("Please choose an image file.");
  if (!file.type?.startsWith("image/")) throw new Error("Only image files are supported.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");

  const currentAuthUser = auth.currentUser;
  const currentSessionUser = getUser();
  const uid = currentAuthUser?.uid || currentSessionUser?.user_id || currentSessionUser?.id;
  if (!uid) throw new Error("Session expired. Please log in again.");

  const safeName = (file.name || "profile")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  let photoUrl = "";
  let photoSource = "storage";
  if (!shouldSkipStorageUpload()) {
    try {
      photoUrl = await uploadProfilePhotoToStorage(uid, safeName, file);
    } catch {
      markStorageUploadFailed();
    }
  }

  if (!photoUrl) {
    // Fallback for bucket/CORS issues: persist a compressed data URL in Firestore.
    photoUrl = await compressImageToDataUrl(file);
    photoSource = "firestore_inline";
  }

  const now = new Date().toISOString();
  await setDoc(
    doc(db, "Users", uid),
    {
      user_id: uid,
      email: currentSessionUser?.email || currentAuthUser?.email || "",
      photo_url: photoUrl,
      photo_source: photoSource,
      updated_at: now,
    },
    { merge: true },
  );

  const updatedUser = persistUser({
    ...(currentSessionUser || {}),
    id: uid,
    user_id: uid,
    email: currentSessionUser?.email || currentAuthUser?.email || "",
    photoUrl,
  });

  return updatedUser;
}
