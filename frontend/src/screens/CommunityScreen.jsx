import { useState } from "react";

const SEED_POSTS = [
  {
    id: 1, user: "Priya M.", avatar: "👩", time: "5m ago", tag: "alert", tagLabel: "ALERT",
    text: "Avoid the street behind Central Park after 9 PM. Poorly lit and no CCTV coverage. Saw suspicious activity yesterday night.",
    location: "Anna Nagar, Chennai", likes: 24, comments: 8,
  },
  {
    id: 2, user: "Ananya R.", avatar: "👩‍🦱", time: "1h ago", tag: "tip", tagLabel: "SAFETY TIP",
    text: "The 14B bus route has good lighting all along the route and is usually crowded even late evening. Good option if you need to travel at night.",
    location: "T. Nagar, Chennai", likes: 41, comments: 12,
  },
  {
    id: 3, user: "Safety Bot", avatar: "🛡️", time: "2h ago", tag: "info", tagLabel: "INFO",
    text: "Risk level in Adyar area has decreased following increased police patrolling. Community reports show 40% reduction in incidents this week.",
    location: "Adyar, Chennai", likes: 65, comments: 5,
  },
  {
    id: 4, user: "Kavitha S.", avatar: "👩‍💼", time: "3h ago", tag: "alert", tagLabel: "ALERT",
    text: "The underpass near Koyambedu metro exit has been reported unsafe. Use the main road instead, especially after 8 PM.",
    location: "Koyambedu, Chennai", likes: 89, comments: 21,
  },
];

const CATEGORIES = [
  { id: "alert", label: "⚠️ Alert" },
  { id: "tip", label: "✅ Safety Tip" },
  { id: "info", label: "ℹ️ Info" },
];

export default function CommunityScreen({ user }) {
  const [posts, setPosts] = useState(SEED_POSTS);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("alert");
  const [liked, setLiked] = useState({});

  function submitPost() {
    if (!text.trim()) return;
    const newPost = {
      id: Date.now(), user: user?.name || "Anonymous", avatar: "👤",
      time: "just now", tag: category, tagLabel: CATEGORIES.find(c => c.id === category)?.label.split(" ")[1] || category.toUpperCase(),
      text, location: "Your Location", likes: 0, comments: 0,
    };
    setPosts([newPost, ...posts]);
    setText("");
  }

  function toggleLike(id) {
    setLiked((l) => ({ ...l, [id]: !l[id] }));
    setPosts((p) => p.map((post) =>
      post.id === id ? { ...post, likes: post.likes + (liked[id] ? -1 : 1) } : post
    ));
  }

  return (
    <div className="community-screen">
      <div className="community-header">
        <h2>COMMUNITY</h2>
        <p>Share safety alerts & tips with others nearby</p>
      </div>

      {/* Composer */}
      <div style={{ margin: "16px" }}>
        <div className="post-composer">
          <div className="composer-top">
            <div className="composer-avatar">👤</div>
            <textarea
              className="composer-input"
              placeholder="Share a safety alert, tip, or experience..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="composer-footer">
            <div className="category-pills">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`cat-pill ${c.id} ${category === c.id ? "selected" : ""}`}
                  onClick={() => setCategory(c.id)}>{c.label}</button>
              ))}
            </div>
            <button className="post-btn" onClick={submitPost}>POST</button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: "flex", gap: 0, margin: "0 16px 12px",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", overflow: "hidden"
      }}>
        {[
          { label: "Reports Today", value: "47" },
          { label: "Safe Zones", value: "12" },
          { label: "Community Members", value: "2.4K" },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, padding: "12px 8px", textAlign: "center",
            borderRight: i < 2 ? "1px solid var(--border)" : "none"
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", color: "var(--accent-teal)" }}>{s.value}</div>
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Feed */}
      <div className="feed">
        {posts.map((post) => (
          <div key={post.id} className="post-card">
            <div className="post-header">
              <div className="post-avatar" style={{ background: "var(--bg-elevated)" }}>{post.avatar}</div>
              <div className="post-meta">
                <div className="post-user">{post.user}</div>
                <div className="post-time">{post.time}</div>
              </div>
              <span className={`post-tag tag-${post.tag}`}>{post.tagLabel}</span>
            </div>
            <p className="post-text">{post.text}</p>
            <div className="post-location">📍 {post.location}</div>
            <div className="post-actions">
              <button className={`post-action-btn ${liked[post.id] ? "liked" : ""}`} onClick={() => toggleLike(post.id)}>
                {liked[post.id] ? "❤️" : "🤍"} {post.likes}
              </button>
              <button className="post-action-btn">💬 {post.comments}</button>
              <button className="post-action-btn">🔔 Alert</button>
              <button className="post-action-btn" style={{ marginLeft: "auto" }}>↗ Share</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}