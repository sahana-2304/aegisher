// services/auth.js
// In production: replace with Firebase Authentication

const USER_KEY = "aegisher_user";

export function saveUser(userData) {
  const user = { ...userData, id: `user_${Date.now()}`, createdAt: new Date().toISOString() };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}