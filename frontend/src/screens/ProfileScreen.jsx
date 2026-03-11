import { useRef, useState } from "react";
import { updateUserProfilePhoto } from "../services/auth";

function formatDateTime(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleString();
}

function withFallback(value) {
  if (value == null) return "Not set";
  const text = String(value).trim();
  return text.length ? text : "Not set";
}

export default function ProfileScreen({ user, onLogout, onUserUpdate }) {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const name = withFallback(user?.name).replace("Not set", "User");
  const email = withFallback(user?.email).replace("Not set", "No email");
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";

  const details = [
    { label: "User ID", value: user?.user_id || user?.id },
    { label: "Phone", value: user?.phone },
    { label: "Address", value: user?.address },
    { label: "Emergency Contact 1", value: user?.emergency1 },
    { label: "Emergency Contact 2", value: user?.emergency2 },
    { label: "Joined", value: formatDateTime(user?.createdAt) },
    { label: "Last Login", value: formatDateTime(user?.lastLoginAt) },
  ];

  function openPhotoPicker() {
    fileInputRef.current?.click();
  }

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadError("");
    setIsUploading(true);
    try {
      const updatedUser = await updateUserProfilePhoto(file);
      onUserUpdate?.(updatedUser);
    } catch (error) {
      setUploadError(error?.message || "Failed to upload photo.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleLogout() {
    if (!onLogout || isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="profile-screen">
      <div className="profile-header">
        <h2>PROFILE</h2>
        <p>Manage your account and emergency details</p>
      </div>

      <div className="profile-card profile-identity">
        <div className="profile-avatar">
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="Profile" className="profile-avatar-image" />
          ) : (
            initials
          )}
        </div>
        <div className="profile-identity-text">
          <h3>{name}</h3>
          <p>{email}</p>
          <div className="profile-photo-actions">
            <button className="profile-photo-btn" onClick={openPhotoPicker} disabled={isUploading}>
              {isUploading ? "UPLOADING..." : user?.photoUrl ? "CHANGE PHOTO" : "ADD PHOTO"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="profile-photo-input"
              onChange={handlePhotoUpload}
            />
          </div>
          {uploadError && <p className="profile-photo-error">{uploadError}</p>}
        </div>
      </div>

      <div className="profile-card">
        <div className="profile-card-title">Account Details</div>
        <div className="profile-grid">
          {details.map((item) => (
            <div key={item.label} className="profile-row">
              <span className="profile-row-label">{item.label}</span>
              <span className="profile-row-value">{withFallback(item.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="profile-actions">
        <button className="btn-primary profile-logout-btn" onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? "LOGGING OUT..." : "LOG OUT"}
        </button>
      </div>
    </div>
  );
}
