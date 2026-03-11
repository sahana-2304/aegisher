import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  CheckCircle,
  Heart,
  MapPin,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  Shield,
  Trash2,
  X,
} from "lucide-react";

import {
  addCommunityComment,
  deleteCommunityPost,
  subscribeToCommunityComments,
  subscribeToCommunityPost,
  subscribeToSavedPostIds,
  toggleCommunityLike,
  toggleCommunitySavedPost,
} from "../services/community";
import "./PostDetailScreen.css";

function formatRelativeTime(timestampMs) {
  const now = Date.now();
  const diff = Math.max(0, now - Number(timestampMs || now));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isImageSource(value) {
  if (!value || typeof value !== "string") return false;
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/");
}

export default function PostDetailScreen({ user }) {
  const navigate = useNavigate();
  const { postId } = useParams();
  const currentUserId = user?.user_id || user?.id || "";

  const [post, setPost] = useState(null);
  const [postLoading, setPostLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [pendingLike, setPendingLike] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  useEffect(() => {
    const unsubscribe = subscribeToCommunityPost(
      postId,
      (nextPost) => {
        setPost(nextPost);
        setPostLoading(false);
      },
      (nextError) => {
        setError(nextError?.message || "Could not load this post.");
        setPostLoading(false);
      },
    );
    return () => unsubscribe?.();
  }, [postId]);

  useEffect(() => {
    const unsubscribe = subscribeToCommunityComments(
      postId,
      (nextComments) => {
        setComments(nextComments);
        setCommentsLoading(false);
      },
      (nextError) => {
        setError(nextError?.message || "Could not load comments.");
        setCommentsLoading(false);
      },
      { limit: 400 },
    );
    return () => unsubscribe?.();
  }, [postId]);

  useEffect(() => {
    const unsubscribe = subscribeToSavedPostIds(
      currentUserId,
      (savedIds) => {
        setSaved(savedIds.includes(postId));
      },
      () => {
        // Non-fatal in detail view.
      },
    );
    return () => unsubscribe?.();
  }, [currentUserId, postId]);

  useEffect(() => {
    setActiveMediaIndex(0);
    setLightboxIndex(-1);
  }, [postId]);

  const media = useMemo(() => (Array.isArray(post?.media) ? post.media : []), [post?.media]);
  const likedByUser = useMemo(
    () => Array.isArray(post?.likedBy) && post.likedBy.includes(currentUserId),
    [currentUserId, post?.likedBy],
  );
  const isPoster = useMemo(
    () => Boolean(post?.createdBy) && Boolean(currentUserId) && String(post.createdBy) === String(currentUserId),
    [currentUserId, post?.createdBy],
  );

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/community", { replace: true });
  }

  async function handleToggleLike() {
    if (!post || !currentUserId || pendingLike) return;
    setPendingLike(true);
    try {
      await toggleCommunityLike(post.id, currentUserId, likedByUser);
    } catch (nextError) {
      setError(nextError?.message || "Could not update like.");
    } finally {
      setPendingLike(false);
    }
  }

  async function handleToggleSave() {
    if (!post || !currentUserId || pendingSave) return;
    const shouldSave = !saved;
    setPendingSave(true);
    try {
      await toggleCommunitySavedPost(currentUserId, post.id, shouldSave);
      setSaved(shouldSave);
    } catch (nextError) {
      setError(nextError?.message || "Could not save this post.");
    } finally {
      setPendingSave(false);
    }
  }

  async function handleSubmitComment() {
    if (!post || postingComment) return;
    const text = commentText.trim();
    if (!text) return;

    setPostingComment(true);
    setError("");
    try {
      await addCommunityComment(post.id, user, text);
      setCommentText("");
    } catch (nextError) {
      setError(nextError?.message || "Could not post comment.");
    } finally {
      setPostingComment(false);
    }
  }

  async function handleDeletePost() {
    if (!post || !isPoster || deletingPost) return;
    const ok = window.confirm("Delete this post? This cannot be undone.");
    if (!ok) return;

    setDeletingPost(true);
    setError("");
    try {
      await deleteCommunityPost(post.id, currentUserId);
      navigate("/community", { replace: true });
    } catch (nextError) {
      setError(nextError?.message || "Could not delete this post.");
      setDeletingPost(false);
    }
  }

  async function handleShare() {
    if (!post) return;
    const textToShare = `${post.user}: ${post.text || "Safety update"}\n${post.location}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "AegisHer Safety Post",
          text: textToShare,
        });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToShare);
        return;
      }
      setError("Sharing is not supported on this device.");
    } catch (nextError) {
      if (nextError?.name !== "AbortError") {
        setError("Could not share this post.");
      }
    }
  }

  const lightboxMedia = lightboxIndex >= 0 ? media[lightboxIndex] : null;

  return (
    <div className="cp-screen">
      <header className="cp-header">
        <button type="button" className="cp-header-btn" onClick={handleBack}>
          <ArrowLeft size={18} />
        </button>
        <h2>Post</h2>
        {isPoster ? (
          <button
            type="button"
            className="cp-header-btn danger"
            onClick={handleDeletePost}
            disabled={deletingPost}
            title="Delete post"
          >
            {deletingPost ? <RefreshCw size={16} className="spin" /> : <Trash2 size={16} />}
          </button>
        ) : (
          <div className="cp-header-spacer" />
        )}
      </header>

      {error && <div className="cp-error">{error}</div>}

      <main className="cp-body">
        {postLoading ? (
          <div className="cp-state">Loading post...</div>
        ) : !post ? (
          <div className="cp-state">Post not found.</div>
        ) : (
          <article className="cp-post-card">
            <div className="cp-post-head">
              <div className="cp-post-author">
                <span className="cp-author-avatar">
                  {isImageSource(post.avatar) ? <img src={post.avatar} alt={`${post.user} avatar`} /> : post.avatar}
                </span>
                <div>
                  <div className="cp-author-line">
                    <strong>{post.user}</strong>
                    {post.verified && <CheckCircle size={13} className="cp-verified" />}
                    <span>{post.handle}</span>
                  </div>
                  <small>{formatRelativeTime(post.timeMs)}</small>
                </div>
              </div>
            </div>

            {post.text && <p className="cp-post-text">{post.text}</p>}

            {media.length > 0 && (
              <div className="cp-media-wrap">
                <button
                  type="button"
                  className="cp-active-media"
                  onClick={() => setLightboxIndex(activeMediaIndex)}
                >
                  <img src={media[activeMediaIndex]?.url} alt={`Post image ${activeMediaIndex + 1}`} />
                </button>

                <div className="cp-media-strip">
                  {media.map((item, index) => (
                    <button
                      key={item.id || `${item.url}-${index}`}
                      type="button"
                      className={`cp-media-thumb ${activeMediaIndex === index ? "active" : ""}`}
                      onClick={() => setActiveMediaIndex(index)}
                    >
                      <img src={item.url} alt={`Thumbnail ${index + 1}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="cp-meta-row">
              <span>
                <MapPin size={13} />
                {post.location || "Location unavailable"}
              </span>
              <span>
                <Shield size={13} />
                Trust {post.trusted}%
              </span>
            </div>

            <div className="cp-actions">
              <button type="button" className={`cp-action-btn ${likedByUser ? "liked" : ""}`} onClick={handleToggleLike} disabled={pendingLike}>
                <Heart size={19} fill={likedByUser ? "currentColor" : "none"} />
                <span>{post.likes}</span>
              </button>
              <button type="button" className="cp-action-btn" aria-label="comments">
                <MessageCircle size={19} />
                <span>{post.comments}</span>
              </button>
              <button type="button" className="cp-action-btn" onClick={handleShare}>
                <Share2 size={19} />
              </button>
              <button type="button" className={`cp-action-btn ${saved ? "saved" : ""}`} onClick={handleToggleSave} disabled={pendingSave}>
                <Bookmark size={19} fill={saved ? "currentColor" : "none"} />
              </button>
            </div>

            <section className="cp-comments">
              <h3>Comments</h3>
              {commentsLoading ? (
                <div className="cp-comments-state">Loading comments...</div>
              ) : comments.length === 0 ? (
                <div className="cp-comments-state">No comments yet. Start the conversation.</div>
              ) : (
                <div className="cp-comment-list">
                  {comments.map((comment) => (
                    <div key={comment.id} className="cp-comment-item">
                      <span className="cp-comment-avatar">
                        {isImageSource(comment.userAvatar) ? <img src={comment.userAvatar} alt="" /> : comment.userAvatar}
                      </span>
                      <div className="cp-comment-content">
                        <div className="cp-comment-meta">
                          <strong>{comment.userName}</strong>
                          <small>{formatRelativeTime(comment.createdAtMs)}</small>
                        </div>
                        <p>{comment.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="cp-comment-composer">
                <input
                  type="text"
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSubmitComment();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmitComment}
                  disabled={postingComment || !commentText.trim()}
                >
                  {postingComment ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                </button>
              </div>
            </section>
          </article>
        )}
      </main>

      {lightboxMedia && (
        <div className="cp-lightbox" onClick={() => setLightboxIndex(-1)}>
          <button
            type="button"
            className="cp-lightbox-close"
            onClick={(event) => {
              event.stopPropagation();
              setLightboxIndex(-1);
            }}
          >
            <X size={18} />
          </button>
          <img
            src={lightboxMedia.url}
            alt="Post media full view"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
