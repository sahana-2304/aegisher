/**
 * ReportIncidentScreen - 3-step wizard for incident reporting
 * 
 * Step 1: Harassment type selection
 * Step 2: Incident details (description, time, location, evidence, anonymous toggle)
 * Step 3: Review + submit with legal panel
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { incidentsApi, draftUtils, validationUtils, INCIDENT_TYPES } from "../services/incidents";
import { api } from "../services/api";
import "./ReportIncidentScreen.css";

const STEPS = [
  { id: 1, title: "Incident Type", icon: "📋" },
  { id: 2, title: "Details", icon: "📝" },
  { id: 3, title: "Review & Submit", icon: "✅" },
];

export default function ReportIncidentScreen() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [description, setDescription] = useState("");
  const [incidentType, setIncidentType] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentTime, setIncidentTime] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [locationCoords, setLocationCoords] = useState({ latitude: null, longitude: null });
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [uploadedEvidence, setUploadedEvidence] = useState([]);
  const [anonymousReport, setAnonymousReport] = useState(true);
  const [legalDisclaimerAccepted, setLegalDisclaimerAccepted] = useState(false);
  const [truthDeclarationAccepted, setTruthDeclarationAccepted] = useState(false);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  
  // Default legal content (used as fallback if API fails)
  const DEFAULT_LEGAL_CONTENT = {
    version: "1.0.0",
    disclaimer: "This is a simulated legal guidance tool for informational purposes only.",
    emergency_contacts: [
      { name: "Police Emergency", number: "100", description: "Dial for any emergency" },
      { name: "National Emergency", number: "112", description: "All-in-one emergency response" },
      { name: "Women Helpline", number: "181", description: "24/7 Women Helpline" },
      { name: "State Women Helpline", number: "1091", description: "Women Safety Helpline" }
    ],
    immediate_safety_actions: [
      "Move to a safe, public location if possible",
      "Call emergency services (100/112) if in immediate danger",
      "Inform trusted people about your location",
      "Do not confront the perpetrator if it puts you at risk",
      "Preserve any evidence"
    ],
    rights_guidance: [
      "You have the right to file a complaint at any police station",
      "You can file an FIR even if outside jurisdiction",
      "For workplace harassment, approach the Internal Complaints Committee",
      "You have the right to file complaints anonymously"
    ]
  };
  
  const [legalContent, setLegalContent] = useState(DEFAULT_LEGAL_CONTENT);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedIncidentId, setSubmittedIncidentId] = useState(null);
  
  const fileInputRef = useRef(null);
  const autoSaveTimerRef = useRef(null);

  // Load draft on mount
  useEffect(() => {
    const savedDraft = draftUtils.loadDraft();
    if (savedDraft) {
      setIncidentType(savedDraft.incidentType || "");
      setDescription(savedDraft.description || "");
      setIncidentDate(savedDraft.incidentDate || "");
      setIncidentTime(savedDraft.incidentTime || "");
      setLocationLabel(savedDraft.locationLabel || "");
      setLocationCoords(savedDraft.locationCoords || { latitude: null, longitude: null });
      setAnonymousReport(savedDraft.anonymousReport !== false);
      setDraftId(savedDraft.draftId || null);
      setUploadedEvidence(savedDraft.uploadedEvidence || []);
    }
  }, []);

  // Load legal content (use default, update from API if available)
  useEffect(() => {
    incidentsApi.getLegalContent()
      .then((content) => {
        if (content) setLegalContent(content);
      })
      .catch(() => {
        // Use default legal content on error
      });
  }, []);

  // Auto-save draft
  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    autoSaveTimerRef.current = setTimeout(() => {
      draftUtils.saveDraft({
        incidentType,
        description,
        incidentDate,
        incidentTime,
        locationLabel,
        locationCoords,
        anonymousReport,
        draftId,
        uploadedEvidence,
      });
    }, 1000);
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [incidentType, description, incidentDate, incidentTime, locationLabel, locationCoords, anonymousReport, draftId, uploadedEvidence]);

  // Create draft on first step completion
  const ensureDraft = useCallback(async () => {
    if (!draftId) {
      try {
        const draft = await incidentsApi.createIncidentDraft();
        setDraftId(draft.incident_id);
        return draft.incident_id;
      } catch (e) {
        throw new Error("Failed to create draft: " + e.message);
      }
    }
    return draftId;
  }, [draftId]);

  // Get current location
  const getCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }
    
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setLocationCoords({ latitude, longitude });
        setUseCurrentLocation(true);
        
        try {
          const result = await api.reverseGeocode(latitude, longitude);
          setLocationLabel(result.display_name);
        } catch {
          setLocationLabel(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        }
        setLoading(false);
      },
      (err) => {
        setError("Unable to get your location: " + err.message);
        setLoading(false);
      }
    );
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // Validate files
    for (const file of files) {
      const validation = validationUtils.validateFile(file);
      if (!validation.valid) {
        setError(validation.errors.join(", "));
        return;
      }
    }
    
    // Check max files
    if (evidenceFiles.length + files.length > 10) {
      setError("Maximum 10 files allowed");
      return;
    }
    
    // Add files to local state (will be uploaded when draft is created)
    setEvidenceFiles(prev => [...prev, ...files]);
    setError(null);
  }, [evidenceFiles]);

  // Remove file from selection
  const removeFile = useCallback((index) => {
    setEvidenceFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Upload evidence files
  const uploadEvidence = useCallback(async () => {
    if (evidenceFiles.length === 0) return;
    
    const currentDraftId = await ensureDraft();
    setEvidenceUploading(true);
    setError(null);
    
    const uploaded = [];
    for (const file of evidenceFiles) {
      try {
        const result = await incidentsApi.uploadIncidentEvidence(currentDraftId, file);
        uploaded.push(...result.evidence);
      } catch (e) {
        setError("Failed to upload some files: " + e.message);
        break;
      }
    }
    
    setUploadedEvidence(prev => [...prev, ...uploaded]);
    setEvidenceFiles([]);
    setEvidenceUploading(false);
  }, [evidenceFiles, ensureDraft]);

  // Remove uploaded evidence
  const removeUploadedEvidence = useCallback(async (evidenceId) => {
    if (!draftId) return;
    
    try {
      await incidentsApi.deleteIncidentEvidence(draftId, evidenceId);
      setUploadedEvidence(prev => prev.filter(e => e.evidence_id !== evidenceId));
    } catch (e) {
      setError("Failed to delete evidence: " + e.message);
    }
  }, [draftId]);

  // Validate current step
  const validateStep = useCallback((step) => {
    const errors = [];
    
    if (step === 1) {
      if (!incidentType) {
        errors.push("Please select an incident type");
      }
    }
    
    if (step === 2) {
      const descValidation = validationUtils.validateDescription(description);
      errors.push(...descValidation.errors);
      
      if (!incidentDate || !incidentTime) {
        errors.push("Please provide incident date and time");
      }
      
      const locValidation = validationUtils.validateLocation({
        label: locationLabel,
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
      });
      errors.push(...locValidation.errors);
    }
    
    if (errors.length > 0) {
      setError(errors[0]);
      return false;
    }
    
    setError(null);
    return true;
  }, [incidentType, description, incidentDate, incidentTime, locationLabel, locationCoords]);

  // Navigate to next step
  const nextStep = useCallback(() => {
    if (validateStep(currentStep)) {
      if (currentStep === 2 && evidenceFiles.length > 0) {
        uploadEvidence().then(() => {
          setCurrentStep(3);
        });
      } else {
        setCurrentStep(prev => Math.min(prev + 1, 3));
      }
    }
  }, [currentStep, validateStep, evidenceFiles, uploadEvidence]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError(null);
  }, []);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!legalDisclaimerAccepted || !truthDeclarationAccepted) {
      setError("Please accept the legal disclaimer and truth declaration");
      return;
    }
    
    setSubmitting(true);
    setError(null);
    
    try {
      const currentDraftId = await ensureDraft();
      
      // Upload any remaining evidence
      if (evidenceFiles.length > 0) {
        await uploadEvidence();
      }
      
      // Combine date and time
      const incidentDateTime = new Date(`${incidentDate}T${incidentTime}`);
      
      const result = await incidentsApi.submitIncident(currentDraftId, {
        incidentType,
        description,
        incidentTimeIso: incidentDateTime.toISOString(),
        locationLabel,
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
        locationSource: useCurrentLocation ? "gps" : "manual",
        anonymousReport,
        legalDisclaimerAccepted,
        truthDeclarationAccepted,
        firSummaryText: null, // Let backend generate
        mapToCommunity: true,
      });
      
      // Clear draft
      draftUtils.clearDraft();
      
      setSubmittedIncidentId(result.incident_id);
      setSubmitSuccess(true);
    } catch (e) {
      setError("Failed to submit: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }, [
    incidentType, description, incidentDate, incidentTime,
    locationLabel, locationCoords, useCurrentLocation,
    anonymousReport, legalDisclaimerAccepted, truthDeclarationAccepted,
    ensureDraft, evidenceFiles, uploadEvidence
  ]);

  // Generate FIR summary for display
  const generateFirSummary = useCallback(() => {
    const typeLabel = INCIDENT_TYPES.find(t => t.value === incidentType)?.label || incidentType;
    const dateTime = incidentDate && incidentTime 
      ? `${incidentDate} at ${incidentTime}` 
      : "Not specified";
    
    return `
FIR/NCRC COMPLAINT SUMMARY
==========================

Type of Incident: ${typeLabel}

Date and Time: ${dateTime}

Location: ${locationLabel}
Coordinates: ${locationCoords.latitude}, ${locationCoords.longitude}

Description of Incident:
${description}

---
This summary was generated by AegisHer Safety App for complaint filing purposes.
This is NOT an official FIR filing. Please visit the nearest police station 
or file online at https://portal.police.gov.in for official complaint registration.
    `.trim();
  }, [incidentType, incidentDate, incidentTime, locationLabel, locationCoords, description]);

  // Copy FIR summary to clipboard
  const copyFirSummary = useCallback(() => {
    navigator.clipboard.writeText(generateFirSummary());
  }, [generateFirSummary]);

  // Render step 1: Incident type
  const renderStep1 = () => (
    <div className="incident-step-content">
      <h3>What type of incident occurred?</h3>
      <p className="step-description">Select the category that best describes the harassment or incident.</p>
      
      <div className="incident-type-grid">
        {INCIDENT_TYPES.map((type) => (
          <button
            key={type.value}
            className={`incident-type-card ${incidentType === type.value ? "selected" : ""}`}
            onClick={() => setIncidentType(type.value)}
          >
            <span className="type-icon">
              {type.value === "verbal_abuse" && "🗣️"}
              {type.value === "stalking" && "👁️"}
              {type.value === "physical_harassment" && "✋"}
              {type.value === "workplace_harassment" && "🏢"}
              {type.value === "public_transport_harassment" && "🚌"}
              {type.value === "other" && "⚠️"}
            </span>
            <span className="type-label">{type.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // Render step 2: Incident details
  const renderStep2 = () => (
    <div className="incident-step-content">
      <h3>Incident Details</h3>
      <p className="step-description">Provide information about what happened.</p>
      
      {/* Description */}
      <div className="form-group">
        <label htmlFor="description">Description *</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened in as much detail as possible..."
          rows={5}
          minLength={10}
          maxLength={4000}
        />
        <div className="char-count">
          {description.length} / 4000 (min: 10)
        </div>
      </div>
      
      {/* Date and Time */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="incident-date">Date *</label>
          <input
            type="date"
            id="incident-date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            max={new Date().toISOString().split("T")[0]}
          />
        </div>
        <div className="form-group">
          <label htmlFor="incident-time">Time *</label>
          <input
            type="time"
            id="incident-time"
            value={incidentTime}
            onChange={(e) => setIncidentTime(e.target.value)}
          />
        </div>
      </div>
      
      {/* Location */}
      <div className="form-group">
        <label>Location *</label>
        <div className="location-input-group">
          <input
            type="text"
            value={locationLabel}
            onChange={(e) => setLocationLabel(e.target.value)}
            placeholder="Enter location address or description..."
            className="location-text-input"
          />
          <button
            type="button"
            className="location-gps-btn"
            onClick={getCurrentLocation}
            disabled={loading}
          >
            {loading ? "..." : "📍"}
          </button>
        </div>
        {locationCoords.latitude && (
          <div className="coords-display">
            {locationCoords.latitude.toFixed(6)}, {locationCoords.longitude.toFixed(6)}
          </div>
        )}
      </div>
      
      {/* Evidence */}
      <div className="form-group">
        <label>Evidence (optional)</label>
        <p className="field-hint">Upload photos, videos, or audio recordings as evidence.</p>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        
        <button
          type="button"
          className="add-evidence-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          + Add Files
        </button>
        
        {/* Pending files */}
        {evidenceFiles.length > 0 && (
          <div className="evidence-list">
            {evidenceFiles.map((file, index) => (
              <div key={index} className="evidence-item pending">
                <span className="evidence-name">{file.name}</span>
                <span className="evidence-size">{validationUtils.formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="remove-evidence-btn"
                  onClick={() => removeFile(index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Uploaded files */}
        {uploadedEvidence.length > 0 && (
          <div className="evidence-list">
            {uploadedEvidence.map((evidence) => (
              <div key={evidence.evidence_id} className="evidence-item uploaded">
                <span className="evidence-name">{evidence.filename}</span>
                <span className="evidence-size">{validationUtils.formatFileSize(evidence.size_bytes)}</span>
                <button
                  type="button"
                  className="remove-evidence-btn"
                  onClick={() => removeUploadedEvidence(evidence.evidence_id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        
        {evidenceUploading && <div className="uploading-indicator">Uploading...</div>}
      </div>
      
      {/* Anonymous toggle */}
      <div className="form-group anonymous-toggle">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={anonymousReport}
            onChange={(e) => setAnonymousReport(e.target.checked)}
          />
          <span className="toggle-text">
            <strong>Report Anonymously</strong>
            <span className="toggle-hint">
              Your identity will be hidden in standard views; retained securely for abuse prevention.
            </span>
          </span>
        </label>
      </div>
    </div>
  );

  // Render step 3: Review and submit
  const renderStep3 = () => {
    const typeLabel = INCIDENT_TYPES.find(t => t.value === incidentType)?.label || incidentType;
    
    return (
      <div className="incident-step-content">
        <h3>Review Your Report</h3>
        <p className="step-description">Please review the information before submitting.</p>
        
        {/* Summary */}
        <div className="review-section">
          <h4>Incident Type</h4>
          <p>{typeLabel}</p>
        </div>
        
        <div className="review-section">
          <h4>Description</h4>
          <p className="description-preview">{description}</p>
        </div>
        
        <div className="review-section">
          <h4>Date & Time</h4>
          <p>{incidentDate} at {incidentTime}</p>
        </div>
        
        <div className="review-section">
          <h4>Location</h4>
          <p>{locationLabel}</p>
          <p className="coords-small">
            {locationCoords.latitude?.toFixed(6)}, {locationCoords.longitude?.toFixed(6)}
          </p>
        </div>
        
        {uploadedEvidence.length > 0 && (
          <div className="review-section">
            <h4>Evidence ({uploadedEvidence.length} files)</h4>
            <div className="evidence-summary">
              {uploadedEvidence.map((e) => (
                <span key={e.evidence_id} className="evidence-tag">
                  {e.filename} ({validationUtils.formatFileSize(e.size_bytes)})
                </span>
              ))}
            </div>
          </div>
        )}
        
        <div className="review-section">
          <h4>Anonymous Report</h4>
          <p>{anonymousReport ? "Yes - Identity hidden" : "No - Standard reporting"}</p>
        </div>
        
        {/* Legal Panel */}
        {legalContent && (
          <div className="legal-panel">
            <div className="legal-disclaimer">
              <h4>⚠️ Important Disclaimer</h4>
              <p>{legalContent.disclaimer}</p>
            </div>
            
            <div className="emergency-numbers">
              <h4>📞 Emergency Numbers</h4>
              <div className="emergency-grid">
                {legalContent.emergency_contacts.map((contact) => (
                  <a key={contact.number} href={`tel:${contact.number}`} className="emergency-btn">
                    {contact.number} - {contact.name}
                  </a>
                ))}
              </div>
            </div>
            
            <div className="immediate-actions">
              <h4>🛡️ Immediate Safety Actions</h4>
              <ul>
                {legalContent.immediate_safety_actions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            </div>
            
            <div className="rights-guidance">
              <h4>📜 Your Rights (India)</h4>
              <ul>
                {legalContent.rights_guidance.map((right, i) => (
                  <li key={i}>{right}</li>
                ))}
              </ul>
            </div>
            
            <div className="fir-summary-section">
              <h4>📄 FIR-Ready Summary</h4>
              <button type="button" className="copy-summary-btn" onClick={copyFirSummary}>
                📋 Copy to Clipboard
              </button>
              <pre className="fir-summary-text">{generateFirSummary()}</pre>
            </div>
          </div>
        )}
        
        {/* Consent checkboxes */}
        <div className="consent-section">
          <label className="consent-checkbox">
            <input
              type="checkbox"
              checked={legalDisclaimerAccepted}
              onChange={(e) => setLegalDisclaimerAccepted(e.target.checked)}
            />
            <span>I acknowledge that this is a simulated legal guidance tool and not official legal advice. *</span>
          </label>
          
          <label className="consent-checkbox">
            <input
              type="checkbox"
              checked={truthDeclarationAccepted}
              onChange={(e) => setTruthDeclarationAccepted(e.target.checked)}
            />
            <span>I confirm that the information provided is true to the best of my knowledge. *</span>
          </label>
        </div>
      </div>
    );
  };

  // Render success screen
  if (submitSuccess) {
    return (
      <div className="report-incident-screen">
        <div className="success-container">
          <div className="success-icon">✅</div>
          <h2>Report Submitted Successfully!</h2>
          <p className="incident-id">Incident ID: {submittedIncidentId}</p>
          <p>Your incident report has been submitted. You can use the summary below when filing an official complaint.</p>
          
          <div className="success-actions">
            <button className="primary-btn" onClick={() => navigate("/")}>
              Return to Home
            </button>
          </div>
          
          <div className="fir-summary-box">
            <h4>FIR-Ready Summary</h4>
            <button className="copy-btn" onClick={copyFirSummary}>📋 Copy</button>
            <pre>{generateFirSummary()}</pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-incident-screen">
      <div className="incident-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h2>Report Incident</h2>
      </div>
      
      {/* Progress indicator */}
      <div className="progress-indicator">
        {STEPS.map((step) => (
          <div
            key={step.id}
            className={`progress-step ${currentStep >= step.id ? "active" : ""} ${currentStep > step.id ? "completed" : ""}`}
          >
            <span className="step-icon">{step.icon}</span>
            <span className="step-title">{step.title}</span>
          </div>
        ))}
      </div>
      
      {/* Error display */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      
      {/* Step content */}
      {currentStep === 1 && renderStep1()}
      {currentStep === 2 && renderStep2()}
      {currentStep === 3 && renderStep3()}
      
      {/* Navigation buttons */}
      <div className="step-navigation">
        {currentStep > 1 && (
          <button className="secondary-btn" onClick={prevStep} disabled={submitting}>
            Previous
          </button>
        )}
        
        {currentStep < 3 ? (
          <button className="primary-btn" onClick={nextStep}>
            Continue
          </button>
        ) : (
          <button 
            className="submit-btn" 
            onClick={handleSubmit}
            disabled={submitting || !legalDisclaimerAccepted || !truthDeclarationAccepted}
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        )}
      </div>
    </div>
  );
}

