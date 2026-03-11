import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { app, db, storage } from "./firebase";

const POSTS_COLLECTION = "CommunityPosts";
const STORIES_COLLECTION = "CommunityStories";
const SAVED_COLLECTION = "SavedPosts";
export const MAX_POST_IMAGES = 5;
const MAX_POST_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORY_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;
const STORAGE_DISABLED_KEY = "aegisher_community_storage_upload_disabled";
const COMMUNITY_MEDIA_UPLOAD_MODE = String(import.meta.env.VITE_COMMUNITY_MEDIA_UPLOAD_MODE || "auto").toLowerCase();

function shouldSkipStorageUpload() {
  if (COMMUNITY_MEDIA_UPLOAD_MODE === "firestore") return true;
  if (typeof window === "undefined") return false;
  if (COMMUNITY_MEDIA_UPLOAD_MODE !== "storage" && import.meta.env.DEV) return true;
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

async function compressImageToDataUrl(file, options = {}) {
  const image = await loadImageFile(file);
  const maxDimension = Math.max(120, Number(options.maxDimension || 720));
  const quality = Math.min(0.92, Math.max(0.5, Number(options.quality || 0.78)));
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
  return canvas.toDataURL("image/jpeg", quality);
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

function toMillis(value) {
  if (!value) return Date.now();
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toRoundedCoord(value, decimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(decimals));
}

function toAccuracyBucket(accuracyM) {
  const value = Number(accuracyM);
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value <= 25) return "high";
  if (value <= 80) return "medium";
  return "low";
}

function buildHandle(name = "user") {
  const normalized = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `@${normalized || "user"}`;
}

function normalizeLegacyMedia(data) {
  if (Array.isArray(data?.media) && data.media.length) {
    return data.media
      .map((item, index) => {
        const url = String(item?.url || "").trim();
        if (!url) return null;
        return {
          id: String(item.id || `media-${index}`),
          url,
          source: item.source || "storage",
          mime_type: item.mime_type || "",
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }

  const imageUrl = String(data?.image_url || "").trim();
  if (!imageUrl) return [];
  return [
    {
      id: "legacy-image-0",
      url: imageUrl,
      source: data?.image_source || "legacy",
      mime_type: "",
      order: 0,
    },
  ];
}

function mapPostDoc(docSnap) {
  const data = docSnap.data() || {};
  const createdAtMs = toMillis(data.created_at || data.created_at_ms);
  const media = normalizeLegacyMedia(data);
  return {
    id: docSnap.id,
    user: data.user_name || "User",
    avatar: data.user_avatar || "👤",
    handle: data.user_handle || "@user",
    timeMs: createdAtMs,
    tag: data.tag || "alert",
    tagLabel: data.tag_label || "ALERT",
    text: data.text || "",
    location: data.location || "Current Location",
    locationMeta: data.location_meta || null,
    modelMeta: data.model_meta || null,
    likes: Number(data.likes_count || 0),
    comments: Number(data.comments_count || 0),
    verified: Boolean(data.verified),
    trusted: Number(data.trusted_score ?? 50),
    imageUrl: media[0]?.url || "",
    imageSource: media[0]?.source || "",
    media,
    mediaCount: media.length,
    likedBy: Array.isArray(data.liked_by) ? data.liked_by : [],
    createdBy: data.user_id || "",
  };
}

function mapCommentDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    text: String(data.text || ""),
    userId: String(data.user_id || ""),
    userName: String(data.user_name || "Anonymous"),
    userAvatar: String(data.user_avatar || "👤"),
    createdAtMs: toMillis(data.created_at || data.created_at_ms),
  };
}

function mapStoryDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    userId: String(data.user_id || ""),
    userName: String(data.user_name || "User"),
    userAvatar: String(data.user_avatar || "👤"),
    text: String(data.text || "").trim(),
    mediaUrl: String(data.media_url || ""),
    mediaSource: String(data.media_source || ""),
    createdAtMs: toMillis(data.created_at || data.created_at_ms),
    expiresAtMs: Number(data.expires_at_ms || 0),
    seenBy: Array.isArray(data.seen_by) ? data.seen_by : [],
  };
}

function validateImageFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Only image files are supported.");
  }
  if (file.size > MAX_POST_IMAGE_SIZE_BYTES) {
    throw new Error("Each image must be 8 MB or smaller.");
  }
}

async function uploadPostImageToStorage(uid, file, index) {
  const safeName = (file.name || `post-${index + 1}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  const bucketCandidates = deriveBucketFallbacks();
  const storageClients = [storage];
  for (const bucket of bucketCandidates) {
    storageClients.push(getStorage(app, `gs://${bucket}`));
  }

  let lastError = null;
  for (const storageClient of storageClients) {
    try {
      const imageRef = ref(storageClient, `community_posts/${uid}/${Date.now()}-${index}-${safeName}`);
      await uploadBytes(imageRef, file, { contentType: file.type });
      const url = await getDownloadURL(imageRef);
      return {
        id: `${Date.now()}-${index}`,
        url,
        source: "storage",
        mime_type: file.type || "",
        size_bytes: Number(file.size || 0),
        order: index,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Image upload failed.");
}

async function uploadStoryImageToStorage(uid, file) {
  const safeName = (file.name || "story")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  const bucketCandidates = deriveBucketFallbacks();
  const storageClients = [storage];
  for (const bucket of bucketCandidates) {
    storageClients.push(getStorage(app, `gs://${bucket}`));
  }

  let lastError = null;
  for (const storageClient of storageClients) {
    try {
      const imageRef = ref(storageClient, `community_stories/${uid}/${Date.now()}-${safeName}`);
      await uploadBytes(imageRef, file, { contentType: file.type });
      return await getDownloadURL(imageRef);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Story upload failed.");
}

async function buildInlineMediaEntries(files) {
  return Promise.all(
    files.map(async (file, index) => {
      const dataUrl = await compressImageToDataUrl(file, { maxDimension: 640, quality: 0.72 });
      return {
        id: `${Date.now()}-${index}`,
        url: dataUrl,
        source: "firestore_inline",
        mime_type: "image/jpeg",
        size_bytes: Number(file.size || 0),
        order: index,
      };
    }),
  );
}

async function preparePostMedia(uid, imageFiles) {
  const files = Array.isArray(imageFiles) ? imageFiles : [];
  if (!files.length) return [];
  if (files.length > MAX_POST_IMAGES) {
    throw new Error(`You can upload up to ${MAX_POST_IMAGES} images per post.`);
  }

  files.forEach(validateImageFile);
  if (shouldSkipStorageUpload()) {
    return buildInlineMediaEntries(files);
  }

  try {
    return await Promise.all(files.map((file, index) => uploadPostImageToStorage(uid, file, index)));
  } catch {
    markStorageUploadFailed();
    try {
      return await buildInlineMediaEntries(files);
    } catch {
      throw new Error("Could not process images for upload.");
    }
  }
}

export function subscribeToCommunityPosts(onPosts, onError) {
  const postsQuery = query(collection(db, POSTS_COLLECTION), orderBy("created_at", "desc"), limit(200));
  return onSnapshot(
    postsQuery,
    (snapshot) => {
      const next = snapshot.docs.map(mapPostDoc);
      onPosts(next);
    },
    (error) => {
      onError?.(error);
    },
  );
}

export function subscribeToCommunityPost(postId, onPost, onError) {
  if (!postId) {
    onPost?.(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, POSTS_COLLECTION, postId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onPost?.(null);
        return;
      }
      onPost?.(mapPostDoc(snapshot));
    },
    (error) => onError?.(error),
  );
}

export function subscribeToCommunityComments(postId, onComments, onError, options = {}) {
  if (!postId) {
    onComments?.([]);
    return () => {};
  }

  const commentsLimit = Math.max(1, Math.min(Number(options.limit || 300), 1000));
  const commentsQuery = query(
    collection(db, POSTS_COLLECTION, postId, "Comments"),
    orderBy("created_at_ms", "asc"),
    limit(commentsLimit),
  );

  return onSnapshot(
    commentsQuery,
    (snapshot) => {
      onComments?.(snapshot.docs.map(mapCommentDoc));
    },
    (error) => onError?.(error),
  );
}

export function subscribeToCommunityStories(currentUserId, onStories, onError) {
  const storiesQuery = query(collection(db, STORIES_COLLECTION), orderBy("created_at", "desc"), limit(300));
  return onSnapshot(
    storiesQuery,
    (snapshot) => {
      const now = Date.now();
      const rawStories = snapshot.docs
        .map(mapStoryDoc)
        .filter((story) => story.expiresAtMs > now && story.userId);

      const bucketsByUser = new Map();
      rawStories.forEach((story) => {
        if (!bucketsByUser.has(story.userId)) {
          bucketsByUser.set(story.userId, {
            id: story.userId,
            userId: story.userId,
            userName: story.userName,
            userAvatar: story.userAvatar,
            stories: [],
          });
        }
        bucketsByUser.get(story.userId).stories.push(story);
      });

      const grouped = Array.from(bucketsByUser.values()).map((bucket) => {
        const stories = bucket.stories.sort((a, b) => a.createdAtMs - b.createdAtMs);
        const hasUnseen = stories.some((item) => !item.seenBy.includes(currentUserId));
        const latest = stories[stories.length - 1];
        return {
          ...bucket,
          stories,
          latestCreatedAtMs: latest?.createdAtMs || 0,
          hasUnseen,
          isOwn: bucket.userId === currentUserId,
        };
      });

      grouped.sort((a, b) => {
        if (a.isOwn && !b.isOwn) return -1;
        if (!a.isOwn && b.isOwn) return 1;
        if (a.hasUnseen && !b.hasUnseen) return -1;
        if (!a.hasUnseen && b.hasUnseen) return 1;
        return b.latestCreatedAtMs - a.latestCreatedAtMs;
      });

      onStories(grouped);
    },
    (error) => onError?.(error),
  );
}

export async function createCommunityStory({ user, text, imageFile }) {
  const uid = user?.user_id || user?.id;
  if (!uid) throw new Error("Please log in again.");

  const normalizedText = String(text || "").trim();
  if (!normalizedText && !imageFile) {
    throw new Error("Add story text or an image.");
  }

  let mediaUrl = "";
  let mediaSource = "";
  if (imageFile) {
    if (!imageFile.type?.startsWith("image/")) {
      throw new Error("Only image files are supported.");
    }
    if (imageFile.size > MAX_STORY_IMAGE_SIZE_BYTES) {
      throw new Error("Story image must be 6 MB or smaller.");
    }

    if (!shouldSkipStorageUpload()) {
      try {
        mediaUrl = await uploadStoryImageToStorage(uid, imageFile);
        mediaSource = "storage";
      } catch {
        markStorageUploadFailed();
      }
    }

    if (!mediaUrl) {
      try {
        mediaUrl = await compressImageToDataUrl(imageFile, { maxDimension: 720, quality: 0.8 });
        mediaSource = "firestore_inline";
      } catch {
        throw new Error("Could not process story image.");
      }
    }
  }

  const createdAtMs = Date.now();
  await addDoc(collection(db, STORIES_COLLECTION), {
    user_id: uid,
    user_name: user?.name || "Anonymous",
    user_avatar: user?.photoUrl || "👤",
    text: normalizedText,
    media_url: mediaUrl,
    media_source: mediaSource,
    seen_by: [uid],
    viewers_count: 0,
    created_at: serverTimestamp(),
    created_at_ms: createdAtMs,
    expires_at_ms: createdAtMs + STORY_TTL_MS,
  });
}

export async function markCommunityStorySeen(storyId, userId) {
  if (!storyId || !userId) return;
  const storyRef = doc(db, STORIES_COLLECTION, storyId);
  const snap = await getDoc(storyRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const seenBy = Array.isArray(data.seen_by) ? data.seen_by : [];
  if (seenBy.includes(userId)) return;

  await updateDoc(storyRef, {
    seen_by: arrayUnion(userId),
    viewers_count: increment(1),
  });
}

export function subscribeToSavedPostIds(userId, onSavedIds, onError) {
  if (!userId) {
    onSavedIds([]);
    return () => {};
  }
  const savedRef = collection(db, "Users", userId, SAVED_COLLECTION);
  return onSnapshot(
    savedRef,
    (snapshot) => {
      onSavedIds(snapshot.docs.map((docSnap) => docSnap.id));
    },
    (error) => onError?.(error),
  );
}

export async function createCommunityPost({ user, text, tag, location, locationMeta, imageFiles }) {
  const uid = user?.user_id || user?.id;
  if (!uid) throw new Error("Please log in again.");

  const normalizedText = String(text || "").trim();
  const files = Array.isArray(imageFiles) ? imageFiles : [];
  if (!normalizedText && !files.length) {
    throw new Error("Add text or at least one image before posting.");
  }

  const userName = user?.name || "Anonymous";
  const nextTag = tag || "alert";
  const media = await preparePostMedia(uid, files);
  const createdAtMs = Date.now();
  const createdAtDate = new Date(createdAtMs);

  const approxLat = toRoundedCoord(locationMeta?.lat ?? locationMeta?.latitude);
  const approxLng = toRoundedCoord(locationMeta?.lng ?? locationMeta?.longitude);
  const accuracyM = Number(locationMeta?.accuracy_m);
  const locationStatus = locationMeta?.status || (approxLat != null && approxLng != null ? "available" : "unavailable");
  const locationLabel = String(location?.label || location?.display_name || location || "").trim() || "Location unavailable";

  const metadata = {
    category: nextTag,
    text_length: normalizedText.length,
    image_count: media.length,
    has_image: media.length > 0,
    local_hour: createdAtDate.getHours(),
    local_day_of_week: createdAtDate.getDay(),
    local_is_weekend: createdAtDate.getDay() === 0 || createdAtDate.getDay() === 6,
    approx_lat: approxLat,
    approx_lng: approxLng,
    location_available: locationStatus === "available",
    location_accuracy_bucket: toAccuracyBucket(accuracyM),
    likes_count_snapshot: 0,
    comments_count_snapshot: 0,
  };

  const locationPayload = {
    status: locationStatus,
    label: locationLabel,
    approx_lat: approxLat,
    approx_lng: approxLng,
    accuracy_m: Number.isFinite(accuracyM) ? Math.round(accuracyM) : null,
    accuracy_bucket: toAccuracyBucket(accuracyM),
  };

  await addDoc(collection(db, POSTS_COLLECTION), {
    user_id: uid,
    user_name: userName,
    user_handle: buildHandle(userName),
    user_avatar: user?.photoUrl || "👤",
    text: normalizedText,
    tag: nextTag,
    tag_label: nextTag === "tip" ? "SAFETY TIP" : nextTag === "info" ? "INFO" : "ALERT",
    location: locationLabel,
    location_meta: locationPayload,
    model_meta: metadata,
    likes_count: 0,
    comments_count: 0,
    liked_by: [],
    trusted_score: 50,
    verified: false,
    media,
    media_count: media.length,
    image_url: media[0]?.url || "",
    image_source: media[0]?.source || "",
    created_at: serverTimestamp(),
    created_at_ms: createdAtMs,
  });
}

export async function toggleCommunityLike(postId, userId, isLiked) {
  if (!postId || !userId) throw new Error("Missing post/user data.");
  const postRef = doc(db, POSTS_COLLECTION, postId);
  if (isLiked) {
    await updateDoc(postRef, {
      likes_count: increment(-1),
      liked_by: arrayRemove(userId),
      "model_meta.likes_count_snapshot": increment(-1),
    });
    return;
  }
  await updateDoc(postRef, {
    likes_count: increment(1),
    liked_by: arrayUnion(userId),
    "model_meta.likes_count_snapshot": increment(1),
  });
}

export async function toggleCommunitySavedPost(userId, postId, shouldSave) {
  if (!userId || !postId) throw new Error("Missing post/user data.");
  const savedDocRef = doc(db, "Users", userId, SAVED_COLLECTION, postId);
  if (shouldSave) {
    await setDoc(savedDocRef, { saved_at: serverTimestamp() }, { merge: true });
    return;
  }
  await deleteDoc(savedDocRef);
}

export async function addCommunityComment(postId, user, text) {
  const uid = user?.user_id || user?.id;
  if (!uid || !postId) throw new Error("Missing post/user data.");
  const normalized = String(text || "").trim();
  if (!normalized) throw new Error("Comment cannot be empty.");

  const commentsRef = collection(db, POSTS_COLLECTION, postId, "Comments");
  await addDoc(commentsRef, {
    user_id: uid,
    user_name: user?.name || "Anonymous",
    user_avatar: user?.photoUrl || "👤",
    user_handle: buildHandle(user?.name || "Anonymous"),
    text: normalized,
    created_at: serverTimestamp(),
    created_at_ms: Date.now(),
  });

  await updateDoc(doc(db, POSTS_COLLECTION, postId), {
    comments_count: increment(1),
    "model_meta.comments_count_snapshot": increment(1),
  });
}

async function deleteCommentsForPost(postId) {
  const commentsRef = collection(db, POSTS_COLLECTION, postId, "Comments");
  while (true) {
    const page = await getDocs(query(commentsRef, limit(200)));
    if (page.empty) break;
    const batch = writeBatch(db);
    page.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    if (page.size < 200) break;
  }
}

async function deleteMediaFiles(mediaItems) {
  const targets = (Array.isArray(mediaItems) ? mediaItems : []).filter(
    (item) => item?.source === "storage" && String(item?.url || "").trim(),
  );
  await Promise.allSettled(
    targets.map((item) => deleteObject(ref(storage, item.url))),
  );
}

export async function deleteCommunityPost(postId, userId) {
  if (!postId || !userId) throw new Error("Missing post/user data.");

  const postRef = doc(db, POSTS_COLLECTION, postId);
  const snap = await getDoc(postRef);
  if (!snap.exists()) throw new Error("Post does not exist.");

  const data = snap.data() || {};
  const ownerId = String(data.user_id || "");
  if (!ownerId || ownerId !== String(userId)) {
    throw new Error("Only the post creator can delete this post.");
  }

  const media = normalizeLegacyMedia(data);
  await deleteCommentsForPost(postId);
  await deleteDoc(postRef);
  await deleteMediaFiles(media);
}
