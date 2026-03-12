/**
 * Incident Reporting API Service
 * Handles incident draft creation, evidence uploads, and submission
 */
import { auth, db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Storage keys for draft autosave
const DRAFT_STORAGE_KEY = "aegisher_incident_draft";

// Allowed MIME types
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/3gpp", "video/webm"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp3"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];

// File size limits (in bytes)
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 10;

/**
 * Get authorization header with Firebase token
 */
async function getAuthHeader() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not authenticated. Please log in.");
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Make authenticated request to incidents API
 */
async function incidentsRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...await getAuthHeader(),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let detail = `API error ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      // Keep fallback
    }
    throw new Error(detail);
  }

  return res.json();
}

/**
 * Make multipart request for file uploads
 */
async function incidentsMultipartRequest(path, formData) {
  const headers = {
    ...await getAuthHeader(),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: formData,
    headers,
  });

  if (!res.ok) {
    let detail = `Upload error ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      // Keep fallback
    }
    throw new Error(detail);
  }

  return res.json();
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const incidentsApi = {
  /**
   * Create a new incident draft
   * @param {Object} options - Options for draft creation
   * @param {string} options.source - Source of the report (default: 'web_beta')
   * @param {string} options.appVersion - App version
   * @returns {Promise<{incident_id: string, status: string, created_at: string}>}
   */
  createIncidentDraft: async (options = {}) => {
    return incidentsRequest("/api/incidents/drafts", {
      method: "POST",
      body: JSON.stringify({
        source: options.source || "web_beta",
        app_version: options.appVersion || "1.0.0",
      }),
    });
  },

  /**
   * Upload evidence to an incident draft
   * @param {string} draftId - The incident/draft ID
   * @param {File} file - The file to upload
   * @returns {Promise<{incident_id: string, uploaded_count: number, evidence: Array}>}
   */
  uploadIncidentEvidence: async (draftId, file) => {
    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`File type not allowed. Allowed types: ${ALLOWED_TYPES.join(", ")}`);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    const formData = new FormData();
    formData.append("file", file);

    return incidentsMultipartRequest(`/api/incidents/${draftId}/evidence`, formData);
  },

  /**
   * Delete evidence from an incident draft
   * @param {string} draftId - The incident/draft ID
   * @param {string} evidenceId - The evidence ID to delete
   */
  deleteIncidentEvidence: async (draftId, evidenceId) => {
    return incidentsRequest(`/api/incidents/${draftId}/evidence/${evidenceId}`, {
      method: "DELETE",
    });
  },

  /**
   * Submit an incident report
   * @param {string} draftId - The incident/draft ID
   * @param {Object} payload - The incident data
   * @returns {Promise<{incident_id: string, status: string, submitted_at: string, idempotent: boolean}>}
   */
  submitIncident: async (draftId, payload) => {
    return incidentsRequest(`/api/incidents/${draftId}/submit`, {
      method: "POST",
      body: JSON.stringify({
        incident_type: payload.incidentType,
        description: payload.description,
        incident_time_iso: payload.incidentTimeIso,
        location: {
          label: payload.locationLabel,
          latitude: payload.latitude,
          longitude: payload.longitude,
          source: payload.locationSource || "manual",
        },
        anonymous_report: payload.anonymousReport,
        legal_disclaimer_accepted: payload.legalDisclaimerAccepted,
        truth_declaration_accepted: payload.truthDeclarationAccepted,
        fir_summary_text: payload.firSummaryText,
        app_version: payload.appVersion || "1.0.0",
        map_to_community: payload.mapToCommunity !== false,
      }),
    });
  },

  /**
   * Get incident details
   * @param {string} incidentId - The incident ID
   */
  getIncident: async (incidentId) => {
    return incidentsRequest(`/api/incidents/${incidentId}`);
  },

  /**
   * Get legal content for the incident reporting flow (public endpoint)
   */
  getLegalContent: async () => {
    const res = await fetch(`${BASE_URL}/api/incidents/legal-content`);
    if (!res.ok) {
      throw new Error("Failed to load legal content");
    }
    return res.json();
  },
};

// ─── Draft Autosave Utilities ─────────────────────────────────────────────

export const draftUtils = {
  /**
   * Save draft to localStorage
   */
  saveDraft: (draftData) => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        ...draftData,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      console.warn("Failed to save draft:", e);
    }
  },

  /**
   * Load draft from localStorage
   */
  loadDraft: () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn("Failed to load draft:", e);
      return null;
    }
  },

  /**
   * Clear saved draft
   */
  clearDraft: () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear draft:", e);
    }
  },
};

// ─── Validation Helpers ─────────────────────────────────────────────────

export const validationUtils = {
  /**
   * Validate a file for upload
   */
  validateFile: (file) => {
    const errors = [];

    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push(`Invalid file type: ${file.type}`);
    }

    if (file.size > MAX_FILE_SIZE) {
      errors.push(`File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max: ${MAX_FILE_SIZE / (1024 * 1024)}MB)`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Validate description text
   */
  validateDescription: (text) => {
    const errors = [];
    if (!text || text.trim().length < 10) {
      errors.push("Description must be at least 10 characters");
    }
    if (text && text.length > 4000) {
      errors.push("Description cannot exceed 4000 characters");
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Validate location
   */
  validateLocation: (location) => {
    const errors = [];
    if (!location?.label || location.label.length < 3) {
      errors.push("Location label is required");
    }
    if (location?.latitude == null || location?.longitude == null) {
      errors.push("Location coordinates are required");
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Get human-readable file size
   */
  formatFileSize: (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  },
};

// ─── Incident Type Definitions ─────────────────────────────────────────

export const INCIDENT_TYPES = [
  { value: "verbal_abuse", label: "Verbal abuse" },
  { value: "stalking", label: "Stalking" },
  { value: "physical_harassment", label: "Physical harassment" },
  { value: "workplace_harassment", label: "Workplace harassment" },
  { value: "public_transport_harassment", label: "Public transportation harassment" },
  { value: "other", label: "Others" },
];

// Export constants
export {
  ALLOWED_TYPES,
  MAX_FILE_SIZE,
  MAX_FILES,
};
