import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Bookmark,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Globe,
  Heart,
  Image,
  Info,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Shield,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

import {
  createCommunityPost,
  createCommunityStory,
  markCommunityStorySeen,
  MAX_POST_IMAGES,
  subscribeToCommunityPosts,
  subscribeToCommunityStories,
  subscribeToSavedPostIds,
  toggleCommunityLike,
  toggleCommunitySavedPost,
} from "../services/community";
import { api } from "../services/api";
import "./CommunityScreen.css";

const STORY_DURATION_MS = 6000;

const CATEGORIES = [
  { id: "for-you", label: "For You", icon: TrendingUp },
  { id: "alert", label: "Alerts", icon: AlertTriangle, color: "#ef4444" },
  { id: "tip", label: "Safety Tips", icon: Shield, color: "#10b981" },
  { id: "info", label: "Info", icon: Info, color: "#3b82f6" },
  { id: "nearby", label: "Nearby", icon: MapPin, color: "#8b5cf6" },
];

const COMPOSER_CATEGORIES = CATEGORIES.filter((cat) => ["alert", "tip", "info"].includes(cat.id));

const TRENDING_TOPICS = [
  { topic: "Anna Nagar Safety", posts: 234 },
  { topic: "Women's Night Travel", posts: 189 },
  { topic: "Safe Routes", posts: 156 },
  { topic: "Police Patrolling", posts: 98 },
];

const SORT_LABELS = {
  recent: "Recent",
  popular: "Popular",
  trending: "Trending",
};

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

function getTagIcon(tag) {
  if (tag === "alert") return <AlertTriangle size={14} />;
  if (tag === "tip") return <Shield size={14} />;
  if (tag === "info") return <Info size={14} />;
  return <Bell size={14} />;
}

function getNameInitial(name, fallback = "U") {
  const first = String(name || "").trim().charAt(0);
  return (first || fallback).toUpperCase();
}

function renderPostMedia(post) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (!media.length) return null;

  if (media.length === 1) {
    return (
      <div className="cs-post-image-wrap">
        <img src={media[0].url} alt="Post attachment" className="cs-post-image" loading="lazy" />
      </div>
    );
  }

  const preview = media.slice(0, 4);
  return (
    <div className="cs-post-media-grid" role="img" aria-label={`${media.length} attached images`}>
      {preview.map((item, index) => {
        const hiddenCount = media.length - 4;
        const showOverlay = index === 3 && hiddenCount > 0;
        return (
          <div key={item.id || item.url || index} className="cs-post-media-cell">
            <img src={item.url} alt={`Post media ${index + 1}`} loading="lazy" />
            {showOverlay && <div className="cs-post-media-more">+{hiddenCount}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function CommunityScreen({ user }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [feedCategory, setFeedCategory] = useState("for-you");
  const [composerCategory, setComposerCategory] = useState("alert");
  const [saved, setSaved] = useState({});
  const [pendingLikes, setPendingLikes] = useState({});
  const [pendingSaves, setPendingSaves] = useState({});
  const [showComposer, setShowComposer] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("recent");
  const [refreshing, setRefreshing] = useState(false);
  const [showTrending, setShowTrending] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [composerError, setComposerError] = useState("");
  const [uploadingPost, setUploadingPost] = useState(false);
  const [composerImages, setComposerImages] = useState([]);
  const [composerLocating, setComposerLocating] = useState(false);
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyError, setStoryError] = useState("");
  const [showStoryComposer, setShowStoryComposer] = useState(false);
  const [storyText, setStoryText] = useState("");
  const [storyImage, setStoryImage] = useState(null);
  const [uploadingStory, setUploadingStory] = useState(false);
  const [storyViewerState, setStoryViewerState] = useState(null);
  const [locallySeenStoryIds, setLocallySeenStoryIds] = useState({});
  const [composerLocation, setComposerLocation] = useState({
    status: "pending",
    label: "Resolving location...",
    lat: null,
    lng: null,
    accuracy_m: null,
  });

  const composerRef = useRef(null);
  const composerImageInputRef = useRef(null);
  const storyImageInputRef = useRef(null);
  const composerImagesRef = useRef([]);
  const currentUserId = user?.user_id || user?.id || "";

  useEffect(() => {
    const unsubscribe = subscribeToCommunityPosts(
      (nextPosts) => {
        setPosts(nextPosts);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setFeedError(error?.message || "Could not load community posts.");
      },
    );
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSavedPostIds(
      currentUserId,
      (savedIds) => {
        const nextSaved = {};
        savedIds.forEach((id) => {
          nextSaved[id] = true;
        });
        setSaved(nextSaved);
      },
      (error) => {
        setFeedError(error?.message || "Could not load saved posts.");
      },
    );
    return () => unsubscribe?.();
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setStories([]);
      setStoriesLoading(false);
      return () => {};
    }

    const unsubscribe = subscribeToCommunityStories(
      currentUserId,
      (nextStories) => {
        setStories(nextStories);
        setStoriesLoading(false);
      },
      (error) => {
        setStoryError(error?.message || "Could not load stories.");
        setStoriesLoading(false);
      },
    );
    return () => unsubscribe?.();
  }, [currentUserId]);

  useEffect(() => {
    if (showComposer && composerRef.current) {
      composerRef.current.focus();
    }
  }, [showComposer]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  useEffect(() => {
    return () => {
      composerImagesRef.current.forEach((item) => {
        if (item.url?.startsWith("blob:")) {
          URL.revokeObjectURL(item.url);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!storyImage?.previewUrl?.startsWith("blob:")) return undefined;
    return () => URL.revokeObjectURL(storyImage.previewUrl);
  }, [storyImage]);

  useEffect(() => {
    if (!infoMessage) return undefined;
    const timer = setTimeout(() => setInfoMessage(""), 2400);
    return () => clearTimeout(timer);
  }, [infoMessage]);

  useEffect(() => {
    if (!showComposer) return;
    if (composerLocation.status !== "pending") return;

    let canceled = false;
    async function resolveLocation() {
      if (!navigator.geolocation) {
        if (!canceled) {
          setComposerLocation({
            status: "unsupported",
            label: "Location unavailable",
            lat: null,
            lng: null,
            accuracy_m: null,
          });
        }
        return;
      }

      setComposerLocating(true);
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 60000,
          });
        });

        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy);
        let label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

        try {
          const resolved = await api.reverseGeocode(lat, lng);
          if (resolved?.display_name) label = resolved.display_name;
        } catch {
          // Keep coordinate fallback.
        }

        if (!canceled) {
          setComposerLocation({
            status: "available",
            label,
            lat,
            lng,
            accuracy_m: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          });
        }
      } catch {
        if (!canceled) {
          setComposerLocation({
            status: "unavailable",
            label: "Location unavailable",
            lat: null,
            lng: null,
            accuracy_m: null,
          });
        }
      } finally {
        if (!canceled) setComposerLocating(false);
      }
    }

    resolveLocation();
    return () => {
      canceled = true;
    };
  }, [showComposer, composerLocation.status]);

  function closeComposer() {
    if (uploadingPost) return;
    setShowComposer(false);
  }

  function resetComposerState() {
    setText("");
    setComposerCategory("alert");
    setComposerError("");
    setComposerLocation({
      status: "pending",
      label: "Resolving location...",
      lat: null,
      lng: null,
      accuracy_m: null,
    });
    setComposerImages((previous) => {
      previous.forEach((item) => {
        if (item.url?.startsWith("blob:")) {
          URL.revokeObjectURL(item.url);
        }
      });
      return [];
    });
  }

  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }

  function handleComposerImageChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    if (composerImages.length + files.length > MAX_POST_IMAGES) {
      setComposerError(`You can upload up to ${MAX_POST_IMAGES} images.`);
      return;
    }

    const nextEntries = [];
    for (const file of files) {
      if (!file.type?.startsWith("image/")) {
        setComposerError("Only image files are supported.");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setComposerError("Each image must be 8 MB or smaller.");
        continue;
      }
      nextEntries.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      });
    }

    if (nextEntries.length) {
      setComposerError("");
      setComposerImages((previous) => [...previous, ...nextEntries]);
    }
  }

  function removeComposerImage(imageId) {
    setComposerImages((previous) => {
      const target = previous.find((item) => item.id === imageId);
      if (target?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(target.url);
      }
      return previous.filter((item) => item.id !== imageId);
    });
  }

  async function submitPost() {
    if ((!text.trim() && !composerImages.length) || uploadingPost) return;
    setComposerError("");
    setUploadingPost(true);
    try {
      await createCommunityPost({
        user,
        text,
        tag: composerCategory,
        location: { label: composerLocation.label },
        locationMeta: composerLocation,
        imageFiles: composerImages.map((item) => item.file),
      });
      resetComposerState();
      setShowComposer(false);
    } catch (error) {
      setComposerError(error?.message || "Failed to create post.");
    } finally {
      setUploadingPost(false);
    }
  }

  async function handleToggleLike(post) {
    if (!currentUserId) {
      setFeedError("Please log in again.");
      return;
    }
    const isLiked = Array.isArray(post.likedBy) && post.likedBy.includes(currentUserId);
    setPendingLikes((previous) => ({ ...previous, [post.id]: true }));
    try {
      await toggleCommunityLike(post.id, currentUserId, isLiked);
    } catch (error) {
      setFeedError(error?.message || "Could not update like.");
    } finally {
      setPendingLikes((previous) => ({ ...previous, [post.id]: false }));
    }
  }

  async function handleToggleSave(postId) {
    if (!currentUserId) {
      setFeedError("Please log in again.");
      return;
    }
    const shouldSave = !saved[postId];
    setPendingSaves((previous) => ({ ...previous, [postId]: true }));
    try {
      await toggleCommunitySavedPost(currentUserId, postId, shouldSave);
      setSaved((previous) => ({ ...previous, [postId]: shouldSave }));
    } catch (error) {
      setFeedError(error?.message || "Could not update saved posts.");
    } finally {
      setPendingSaves((previous) => ({ ...previous, [postId]: false }));
    }
  }

  async function handleSharePost(post) {
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
        setInfoMessage("Post copied to clipboard.");
        return;
      }
      setInfoMessage("Sharing not supported on this device.");
    } catch (error) {
      if (error?.name !== "AbortError") {
        setFeedError("Could not share post.");
      }
    }
  }

  function resetStoryComposerState() {
    setStoryText("");
    setStoryError("");
    setStoryImage((previous) => {
      if (previous?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return null;
    });
  }

  function closeStoryComposer() {
    if (uploadingStory) return;
    setShowStoryComposer(false);
  }

  function handleStoryImageChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type?.startsWith("image/")) {
      setStoryError("Only image files are supported.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setStoryError("Story image must be 6 MB or smaller.");
      return;
    }

    setStoryImage((previous) => {
      if (previous?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });
    setStoryError("");
  }

  async function submitStory() {
    if (uploadingStory) return;
    if (!storyText.trim() && !storyImage?.file) {
      setStoryError("Add story text or an image.");
      return;
    }

    setUploadingStory(true);
    setStoryError("");
    try {
      await createCommunityStory({
        user,
        text: storyText,
        imageFile: storyImage?.file || null,
      });
      resetStoryComposerState();
      setShowStoryComposer(false);
      setInfoMessage("Story published.");
    } catch (error) {
      setStoryError(error?.message || "Could not publish story.");
    } finally {
      setUploadingStory(false);
    }
  }

  const ownStoryGroup = useMemo(
    () => stories.find((group) => group.isOwn) || null,
    [stories],
  );

  const orderedStoryGroups = useMemo(() => {
    const others = stories.filter((group) => !group.isOwn);
    return ownStoryGroup ? [ownStoryGroup, ...others] : others;
  }, [ownStoryGroup, stories]);

  const activeStoryGroup = useMemo(
    () => orderedStoryGroups.find((group) => group.id === storyViewerState?.groupId) || null,
    [orderedStoryGroups, storyViewerState?.groupId],
  );

  const activeStoryItem = useMemo(() => {
    if (!activeStoryGroup) return null;
    const index = Math.max(0, Math.min(Number(storyViewerState?.index || 0), activeStoryGroup.stories.length - 1));
    return activeStoryGroup.stories[index] || null;
  }, [activeStoryGroup, storyViewerState?.index]);

  function openStoryGroup(group) {
    if (!group?.stories?.length) return;
    const firstUnseenIndex = group.stories.findIndex((story) => {
      const seenRemote = Array.isArray(story.seenBy) && story.seenBy.includes(currentUserId);
      const seenLocal = Boolean(locallySeenStoryIds[story.id]);
      return !seenRemote && !seenLocal;
    });
    const nextIndex = firstUnseenIndex >= 0 ? firstUnseenIndex : Math.max(0, group.stories.length - 1);
    setStoryViewerState({ groupId: group.id, index: nextIndex });
  }

  function openOwnStoryEntry() {
    if (ownStoryGroup?.stories?.length) {
      openStoryGroup(ownStoryGroup);
      return;
    }
    resetStoryComposerState();
    setShowStoryComposer(true);
  }

  function moveStory(delta) {
    if (!storyViewerState) return;
    const groupIndex = orderedStoryGroups.findIndex((group) => group.id === storyViewerState.groupId);
    if (groupIndex < 0) {
      setStoryViewerState(null);
      return;
    }

    const currentGroup = orderedStoryGroups[groupIndex];
    const currentIndex = Number(storyViewerState.index || 0);
    const targetIndex = currentIndex + delta;

    if (targetIndex >= 0 && targetIndex < currentGroup.stories.length) {
      setStoryViewerState({ groupId: currentGroup.id, index: targetIndex });
      return;
    }

    const nextGroupIndex = groupIndex + (delta > 0 ? 1 : -1);
    if (nextGroupIndex < 0 || nextGroupIndex >= orderedStoryGroups.length) {
      setStoryViewerState(null);
      return;
    }

    const nextGroup = orderedStoryGroups[nextGroupIndex];
    setStoryViewerState({
      groupId: nextGroup.id,
      index: delta > 0 ? 0 : Math.max(0, nextGroup.stories.length - 1),
    });
  }

  useEffect(() => {
    if (!storyViewerState) return;
    const hasGroup = orderedStoryGroups.some((group) => group.id === storyViewerState.groupId);
    if (!hasGroup) setStoryViewerState(null);
  }, [orderedStoryGroups, storyViewerState]);

  useEffect(() => {
    if (!activeStoryItem || !currentUserId) return;
    if (activeStoryItem.userId === currentUserId) return;
    const seenRemote = Array.isArray(activeStoryItem.seenBy) && activeStoryItem.seenBy.includes(currentUserId);
    if (seenRemote || locallySeenStoryIds[activeStoryItem.id]) return;

    setLocallySeenStoryIds((previous) => ({ ...previous, [activeStoryItem.id]: true }));
    markCommunityStorySeen(activeStoryItem.id, currentUserId).catch(() => {});
  }, [activeStoryItem, currentUserId, locallySeenStoryIds]);

  useEffect(() => {
    if (!activeStoryItem) return undefined;
    const timer = window.setTimeout(() => {
      moveStory(1);
    }, STORY_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [activeStoryItem, storyViewerState]);

  useEffect(() => {
    if (!storyViewerState) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setStoryViewerState(null);
      if (event.key === "ArrowRight") moveStory(1);
      if (event.key === "ArrowLeft") moveStory(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [storyViewerState, orderedStoryGroups]);

  const visiblePosts = useMemo(() => {
    const byCategory = posts.filter((post) => {
      if (feedCategory === "for-you") return true;
      if (feedCategory === "nearby") return true;
      return post.tag === feedCategory;
    });

    const sorted = [...byCategory];
    if (selectedFilter === "popular") {
      sorted.sort((a, b) => b.likes - a.likes);
    } else if (selectedFilter === "trending") {
      sorted.sort((a, b) => b.likes + b.comments + b.trusted - (a.likes + a.comments + a.trusted));
    } else {
      sorted.sort((a, b) => b.timeMs - a.timeMs);
    }
    return sorted;
  }, [posts, feedCategory, selectedFilter]);

  return (
    <div className="community-screen cs-screen">
      <header className="cs-header">
        <div className="cs-header-top">
          <div className="cs-header-left">
            <h1>Community</h1>
            <span className="cs-header-badge">
              <Users size={14} />
              {loading ? "Syncing..." : `${visiblePosts.length} live posts`}
            </span>
          </div>
          <div className="cs-header-actions">
            <button type="button" className="cs-icon-btn" onClick={() => setShowFilters((previous) => !previous)}>
              <Filter size={18} />
            </button>
            <button type="button" className="cs-icon-btn" onClick={() => setShowTrending((previous) => !previous)}>
              <TrendingUp size={18} />
            </button>
            <button type="button" className="cs-icon-btn" onClick={handleRefresh}>
              <RefreshCw size={18} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </div>

        <div className="cs-stories">
          <button type="button" className="cs-story-item" onClick={openOwnStoryEntry}>
            <span className={`cs-story-avatar own ${ownStoryGroup?.hasUnseen ? "" : "seen"}`}>
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt="Your story" className="cs-story-image" />
              ) : (
                <span className="cs-story-emoji">{getNameInitial(user?.name, "Y")}</span>
              )}
              <button
                type="button"
                className="cs-story-plus-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  resetStoryComposerState();
                  setShowStoryComposer(true);
                }}
              >
                <Plus size={11} />
              </button>
            </span>
            <span className="cs-story-name">Your Story</span>
          </button>

          {orderedStoryGroups
            .filter((group) => !group.isOwn)
            .map((group) => {
              const isSeen = !group.stories.some((story) => {
                const seenRemote = Array.isArray(story.seenBy) && story.seenBy.includes(currentUserId);
                const seenLocal = Boolean(locallySeenStoryIds[story.id]);
                return !seenRemote && !seenLocal;
              });

              return (
                <button key={group.id} type="button" className="cs-story-item" onClick={() => openStoryGroup(group)}>
                  <span className={`cs-story-avatar ${isSeen ? "seen" : ""}`}>
                    {isImageSource(group.userAvatar) ? (
                      <img src={group.userAvatar} alt={`${group.userName} story`} className="cs-story-image" />
                    ) : (
                      <span className="cs-story-emoji">{getNameInitial(group.userName)}</span>
                    )}
                  </span>
                  <span className="cs-story-name">{group.userName}</span>
                </button>
              );
            })}

          {storiesLoading && <span className="cs-story-loading">Loading stories...</span>}
        </div>
        {storyError && <div className="cs-inline-error">{storyError}</div>}

        <div className="cs-category-tabs">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = feedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`cs-category-tab ${active ? "active" : ""}`}
                style={active && cat.color ? { color: cat.color, borderColor: cat.color } : undefined}
                onClick={() => setFeedCategory(cat.id)}
              >
                <Icon size={15} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {showFilters && (
          <div className="cs-panel cs-filters">
            <div className="cs-filter-row">
              <span className="cs-filter-label">Sort by</span>
              <div className="cs-filter-options">
                {["recent", "popular", "trending"].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`cs-filter-option ${selectedFilter === filter ? "selected" : ""}`}
                    onClick={() => setSelectedFilter(filter)}
                  >
                    {filter === "recent" && <Clock size={13} />}
                    {filter === "popular" && <Heart size={13} />}
                    {filter === "trending" && <TrendingUp size={13} />}
                    {SORT_LABELS[filter]}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="cs-location-filter">
              <MapPin size={13} />
              Within 5km
              <ChevronDown size={13} />
            </button>
          </div>
        )}

        {showTrending && (
          <div className="cs-panel cs-trending">
            <h4>Trending in your area</h4>
            {TRENDING_TOPICS.map((topic) => (
              <div key={topic.topic} className="cs-trending-item">
                <div>
                  <strong>{topic.topic}</strong>
                  <span>{topic.posts} posts</span>
                </div>
                <TrendingUp size={14} />
              </div>
            ))}
          </div>
        )}
      </header>

      <section className="cs-stats">
        {[
          { label: "Reports Today", value: "47" },
          { label: "Safe Zones", value: "12" },
          { label: "Members", value: "2.4K" },
          { label: "Trust Score", value: "89%" },
        ].map((stat) => (
          <div key={stat.label} className="cs-stat-item">
            <span className="cs-stat-value">{stat.value}</span>
            <span className="cs-stat-label">{stat.label}</span>
          </div>
        ))}
      </section>

      <button
        type="button"
        className="cs-quick-post-btn"
        onClick={() => {
          resetComposerState();
          setShowComposer(true);
        }}
      >
        <Plus size={18} />
        <span>Share safety update...</span>
      </button>

      {feedError && (
        <div className="cs-inline-error">
          {feedError}
          <button type="button" onClick={() => setFeedError("")}>Dismiss</button>
        </div>
      )}
      {infoMessage && <div className="cs-inline-info">{infoMessage}</div>}

      <main className="cs-feed-wrap">
        {refreshing && (
          <div className="cs-refresh-row">
            <RefreshCw size={16} className="spin" />
            <span>Refreshing feed...</span>
          </div>
        )}

        {loading ? (
          <div className="cs-empty-state">
            <span>Loading community feed...</span>
          </div>
        ) : (
          <div className="cs-feed">
            {visiblePosts.map((post, index) => {
              const likedByUser = Array.isArray(post.likedBy) && post.likedBy.includes(currentUserId);
              const postAvatarIsImage = isImageSource(post.avatar);
              return (
                <article
                  key={post.id}
                  className="cs-post-card"
                  style={{ animationDelay: `${index * 60}ms` }}
                  onClick={() => navigate(`/community/post/${post.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/community/post/${post.id}`);
                    }
                  }}
                >
                  <div className="cs-post-head">
                    <div className="cs-post-author">
                      <span className="cs-author-avatar">
                        {postAvatarIsImage ? <img src={post.avatar} alt={`${post.user} avatar`} /> : getNameInitial(post.user)}
                      </span>
                      <div>
                        <div className="cs-author-line">
                          <strong>{post.user}</strong>
                          {post.verified && <CheckCircle size={13} className="cs-verified" />}
                          <span>{post.handle}</span>
                        </div>
                        <div className="cs-post-meta">
                          <small>{formatRelativeTime(post.timeMs)}</small>
                          <span className={`cs-post-tag ${post.tag}`}>
                            {getTagIcon(post.tag)}
                            {post.tagLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cs-post-menu"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>

                  {post.text && <p className="cs-post-text">{post.text}</p>}
                  {renderPostMedia(post)}

                  <div className="cs-post-info">
                    <span>
                      <MapPin size={13} />
                      {post.location}
                    </span>
                    <span>
                      <Shield size={13} />
                      Trust {post.trusted}%
                    </span>
                  </div>

                  <div className="cs-post-actions">
                    <button
                      type="button"
                      className={`cs-action-btn ${likedByUser ? "liked" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleLike(post);
                      }}
                      disabled={pendingLikes[post.id]}
                    >
                      <Heart size={19} fill={likedByUser ? "currentColor" : "none"} />
                      <span>{post.likes}</span>
                    </button>
                    <button
                      type="button"
                      className="cs-action-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/community/post/${post.id}`);
                      }}
                    >
                      <MessageCircle size={19} />
                      <span>{post.comments}</span>
                    </button>
                    <button
                      type="button"
                      className="cs-action-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSharePost(post);
                      }}
                    >
                      <Share2 size={19} />
                    </button>
                    <button
                      type="button"
                      className={`cs-action-btn ${saved[post.id] ? "saved" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleSave(post.id);
                      }}
                      disabled={pendingSaves[post.id]}
                    >
                      <Bookmark size={19} fill={saved[post.id] ? "currentColor" : "none"} />
                    </button>
                  </div>

                  <div className="cs-comment-row" onClick={(event) => event.stopPropagation()}>
                    <span className="cs-comment-avatar">
                      {user?.photoUrl ? <img src={user.photoUrl} alt="" /> : getNameInitial(user?.name)}
                    </span>
                    <input type="text" readOnly placeholder="Open post to view/add comments..." />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {showComposer && (
        <div className="cs-composer-overlay" onClick={closeComposer}>
          <div
            className="cs-composer"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="cs-composer-head">
              <h3>Create Post</h3>
              <button type="button" className="cs-close-btn" onClick={closeComposer}>
                <X size={18} />
              </button>
            </div>

            <div className="cs-composer-user">
              <span className="cs-composer-avatar">
                {user?.photoUrl ? <img src={user.photoUrl} alt="" /> : getNameInitial(user?.name)}
              </span>
              <div>
                <strong>{user?.name || "Anonymous"}</strong>
                <span>
                  <Globe size={12} />
                  Public
                </span>
              </div>
            </div>

            <textarea
              ref={composerRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Share a safety alert, tip, or experience..."
              className="cs-composer-text"
              autoFocus
            />

            {composerImages.length > 0 && (
              <div className="cs-composer-media-grid">
                {composerImages.map((item, index) => (
                  <div key={item.id} className="cs-composer-media-cell">
                    <img src={item.url} alt={`Selected ${index + 1}`} />
                    <button type="button" className="cs-image-remove" onClick={() => removeComposerImage(item.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="cs-composer-location">
              <MapPin size={14} />
              <span>{composerLocation.label}</span>
              <button
                type="button"
                className="cs-location-refresh-btn"
                onClick={() => {
                  setComposerLocation({
                    status: "pending",
                    label: "Resolving location...",
                    lat: null,
                    lng: null,
                    accuracy_m: null,
                  });
                }}
                disabled={composerLocating}
              >
                {composerLocating ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
              </button>
            </div>

            {composerError && <div className="cs-composer-error">{composerError}</div>}

            <div className="cs-composer-cats">
              {COMPOSER_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const active = composerCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`cs-composer-cat ${active ? "active" : ""}`}
                    style={active && cat.color ? { color: cat.color, borderColor: cat.color } : undefined}
                    onClick={() => setComposerCategory(cat.id)}
                  >
                    <Icon size={15} />
                    {cat.label}
                  </button>
                );
              })}
            </div>

            <div className="cs-composer-foot">
              <div className="cs-composer-tools">
                <button
                  type="button"
                  onClick={() => composerImageInputRef.current?.click()}
                  title="Attach images"
                >
                  <Image size={18} />
                </button>
                <span className="cs-image-limit-label">{composerImages.length}/{MAX_POST_IMAGES}</span>
              </div>

              <input
                ref={composerImageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="cs-hidden-input"
                onChange={handleComposerImageChange}
              />

              <button
                type="button"
                className="cs-submit-btn"
                disabled={uploadingPost || (!text.trim() && !composerImages.length)}
                onClick={submitPost}
              >
                {uploadingPost ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
                {uploadingPost ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStoryComposer && (
        <div className="cs-story-composer-overlay" onClick={closeStoryComposer}>
          <div
            className="cs-story-composer"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="cs-story-composer-head">
              <h3>Create Story</h3>
              <button type="button" className="cs-close-btn" onClick={closeStoryComposer}>
                <X size={18} />
              </button>
            </div>

            <textarea
              value={storyText}
              onChange={(event) => setStoryText(event.target.value)}
              placeholder="Write a quick story update..."
              className="cs-story-text"
              maxLength={280}
            />
            <div className="cs-story-text-count">{storyText.length}/280</div>

            {storyImage?.previewUrl && (
              <div className="cs-story-preview-wrap">
                <img src={storyImage.previewUrl} alt="Story preview" />
                <button
                  type="button"
                  className="cs-image-remove"
                  onClick={() => {
                    setStoryImage((previous) => {
                      if (previous?.previewUrl?.startsWith("blob:")) {
                        URL.revokeObjectURL(previous.previewUrl);
                      }
                      return null;
                    });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {storyError && <div className="cs-composer-error">{storyError}</div>}

            <div className="cs-story-composer-foot">
              <button
                type="button"
                className="cs-story-media-btn"
                onClick={() => storyImageInputRef.current?.click()}
              >
                <Image size={17} />
                {storyImage ? "Change image" : "Add image"}
              </button>
              <input
                ref={storyImageInputRef}
                type="file"
                accept="image/*"
                className="cs-hidden-input"
                onChange={handleStoryImageChange}
              />
              <button
                type="button"
                className="cs-submit-btn"
                onClick={submitStory}
                disabled={uploadingStory || (!storyText.trim() && !storyImage)}
              >
                {uploadingStory ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
                {uploadingStory ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeStoryItem && activeStoryGroup && (
        <div className="cs-story-viewer" onClick={() => setStoryViewerState(null)}>
          <div className="cs-story-viewer-inner" onClick={(event) => event.stopPropagation()}>
            <div className="cs-story-progress-row">
              {activeStoryGroup.stories.map((story, index) => {
                const currentIndex = Number(storyViewerState?.index || 0);
                const isPast = index < currentIndex;
                const isCurrent = index === currentIndex;
                return (
                  <span key={story.id} className="cs-story-progress-track">
                    <span
                      className={`cs-story-progress-fill ${isCurrent ? "active" : ""}`}
                      style={{ width: isPast ? "100%" : "0%" }}
                    />
                  </span>
                );
              })}
            </div>

            <div className="cs-story-viewer-head">
              <div className="cs-story-viewer-user">
                <span className="cs-story-viewer-avatar">
                  {isImageSource(activeStoryGroup.userAvatar) ? (
                    <img src={activeStoryGroup.userAvatar} alt={`${activeStoryGroup.userName} avatar`} />
                  ) : (
                    getNameInitial(activeStoryGroup.userName)
                  )}
                </span>
                <div>
                  <strong>{activeStoryGroup.userName}</strong>
                  <small>{formatRelativeTime(activeStoryItem.createdAtMs)}</small>
                </div>
              </div>
              <button type="button" className="cs-close-btn" onClick={() => setStoryViewerState(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="cs-story-frame">
              {activeStoryItem.mediaUrl ? (
                <img src={activeStoryItem.mediaUrl} alt="Story media" className="cs-story-frame-media" />
              ) : (
                <div className="cs-story-frame-placeholder">
                  <Shield size={30} />
                </div>
              )}
              {activeStoryItem.text && (
                <p className="cs-story-frame-text">{activeStoryItem.text}</p>
              )}
            </div>

            <button
              type="button"
              className="cs-story-nav left"
              onClick={() => moveStory(-1)}
              aria-label="Previous story"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="cs-story-nav right"
              onClick={() => moveStory(1)}
              aria-label="Next story"
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
