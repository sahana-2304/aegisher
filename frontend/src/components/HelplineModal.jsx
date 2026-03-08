export default function HelplineModal({ user, onClose }) {
  const contacts = [
    { icon: "👤", type: "emergency", name: "Emergency Contact 1", number: user?.emergency1 || "+91 XXXXX XXXXX" },
    { icon: "👤", type: "emergency", name: "Emergency Contact 2", number: user?.emergency2 || "+91 XXXXX XXXXX" },
    { icon: "🛡️", type: "helpline", name: "Women Helpline", number: "1091" },
    { icon: "🚔", type: "helpline", name: "Police Emergency", number: "100" },
    { icon: "🚑", type: "helpline", name: "Emergency Services", number: "112" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">HELPLINE</h3>
        <p className="modal-subtitle">Select contact or hold the phone icon for direct call</p>
        <div className="contact-list">
          {contacts.map((c, i) => (
            <div key={i} className="contact-item" onClick={() => window.location.href = `tel:${c.number.replace(/\s/g, "")}`}>
              <div className={`contact-icon ${c.type}`}>{c.icon}</div>
              <div className="contact-info">
                <div className="contact-name">{c.name}</div>
                <div className="contact-number">{c.number}</div>
              </div>
              <span className="contact-call">📞</span>
            </div>
          ))}
        </div>
        <button className="btn-cancel" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}