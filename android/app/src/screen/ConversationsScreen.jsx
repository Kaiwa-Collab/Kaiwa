import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Post from '../Post';
import { useUserData } from '../users';
import { requestcamerapermission, requestgallerypermission } from '../../utils/permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Postskeleton from '../animations/postskeleton';
import firestore from '@react-native-firebase/firestore';
import Icon from 'react-native-vector-icons/Ionicons';
import functions from '@react-native-firebase/functions';
import { useFocusEffect } from '@react-navigation/native';
import storage from '@react-native-firebase/storage';
import { launchImageLibrary } from 'react-native-image-picker';

const PERMISSIONS_REQUESTED_KEY = '@permissions_requested';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const requestinitialpermissions = async () => {
  try {
    const hasrequested = await AsyncStorage.getItem(PERMISSIONS_REQUESTED_KEY);
    if (hasrequested === 'true') return;

    Alert.alert(
      'Welcome to Kaiwa!',
      'To provide you with the best experience, Kaiwa needs access to your camera and photos for sharing images in conversations.',
      [
        {
          text: 'Grant permissions',
          onPress: async () => {
            const camerapermission = await requestcamerapermission();
            const gallerypermission = await requestgallerypermission();
            await AsyncStorage.setItem(PERMISSIONS_REQUESTED_KEY, 'true');
            if (camerapermission && gallerypermission) {
              Alert.alert('All permission granted');
            } else if (!camerapermission && !gallerypermission) {
              Alert.alert('permission Denied');
            } else {
              Alert.alert('Partial permission');
            }
          }
        },
        {
          text: 'Not now',
          style: 'cancel',
          onPress: async () => {
            await AsyncStorage.setItem(PERMISSIONS_REQUESTED_KEY, 'true');
            Alert.alert('Permission skipped');
          }
        }
      ],
      { cancelable: false }
    );
  } catch (error) {
    console.error('Error requesting permissions:', error);
  }
};

const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isRetryable =
        error.code === 'unavailable' ||
        error.message?.includes('unavailable') ||
        error.message?.includes('UNAVAILABLE');
      if (!isRetryable || attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

// Fetches fresh avatars for a list of posts — only 1 read per unique user
const hydrateAvatars = async (posts) => {
  if (!posts || posts.length === 0) return posts;

  const uniqueUserIds = [...new Set(posts.map(p => p.userId).filter(Boolean))];
  if (uniqueUserIds.length === 0) return posts;

  try {
    const profileSnaps = await Promise.all(
      uniqueUserIds.map(uid => firestore().collection('profile').doc(uid).get())
    );

    const avatarMap = {};
    profileSnaps.forEach((snap, i) => {
      if (snap.exists) {
        avatarMap[uniqueUserIds[i]] = snap.data()?.avatar || null;
      }
    });

    return posts.map(post => ({
      ...post,
      userAvatar: avatarMap[post.userId] || post.userAvatar || null,
    }));
  } catch (error) {
    console.warn('[hydrateAvatars] Failed to fetch avatars:', error.message);
    return posts; // return original posts on failure, don't crash
  }
};

const getPostTimestamp = (post) => {
  const value = post?.createdAt || post?.timestamp || null;
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const toIsoIfValid = (ms) => (ms && ms > 0 ? new Date(ms).toISOString() : null);

const mergePostsByRecency = (existing = [], incoming = []) => {
  const map = new Map();

  [...existing, ...incoming].forEach((post, idx) => {
    const key = post?.id || post?.postId || `fallback_${idx}`;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, post);
      return;
    }

    // Prefer the fresher object while preserving fields from both copies.
    const next = getPostTimestamp(post) >= getPostTimestamp(previous)
      ? { ...previous, ...post }
      : { ...post, ...previous };
    map.set(key, next);
  });

  return [...map.values()].sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));
};

const chunk = (arr = [], size = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const ConversationsScreen = ({ navigation }) => {
  const { loading, followingPosts, getCachedImageUri, currentUser, followingIds, refreshPostsFromFollowing } = useUserData();
  const [popularPosts, setPopularPosts] = useState([]);
  const [mergedFollowingPosts, setMergedFollowingPosts] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [combinedPosts, setCombinedPosts] = useState([]);
  const [popularSectionStartIndex, setPopularSectionStartIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);

  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false); // fit (contain) vs fill (cover) within original frame

  const resolveAspectRatio = useCallback(() => {
    // Original frame only (Instagram-like); no alternate crops.
    const w = selectedImage?.width;
    const h = selectedImage?.height;
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) return w / h;
    return 1; // square fallback when picker doesn't provide dimensions
  }, [selectedImage?.height, selectedImage?.width]);

  const refreshCommentCountsFor = useCallback(async (posts = []) => {
    const ids = [...new Set(posts.map(p => p?.id || p?.postId).filter(Boolean))];
    if (ids.length === 0) return;

    try {
      const countsMap = {};

      // Firestore "in" queries are limited (commonly 10 values).
      const batches = chunk(ids, 10);
      const snaps = await Promise.all(
        batches.map(group =>
          firestore()
            .collection('posts')
            .where(firestore.FieldPath.documentId(), 'in', group)
            .get()
        )
      );

      snaps.forEach(snap => {
        snap.forEach(doc => {
          const data = doc.data() || {};
          if (typeof data.commentCount === 'number') countsMap[doc.id] = data.commentCount;
        });
      });

      if (Object.keys(countsMap).length === 0) return;

      setCombinedPosts(prev =>
        prev.map(p => {
          const key = p?.id || p?.postId;
          const nextCount = countsMap[key];
          return nextCount === undefined ? p : { ...p, commentCount: nextCount };
        })
      );
    } catch (e) {
      // Non-fatal; we fall back to aggregated/cached counts.
      console.log('[ConversationsScreen] refreshCommentCountsFor failed:', e.message);
    }
  }, []);

  useEffect(() => {
    if (currentUser) requestinitialpermissions();
  }, [currentUser?.uid]);

  const ensureProfileExists = useCallback(async (userId) => {
    await functions().httpsCallable('ensureProfileExists')({ userId });
  }, []);

  const selectImage = useCallback(async () => {
    const haspermission = await requestgallerypermission();
    if (!haspermission) return;

    launchImageLibrary(
      { mediaType: 'photo', quality: 0.8, includeBase64: false },
      (response) => {
        if (response?.assets && response.assets.length > 0) {
          setSelectedImage(response.assets[0]);
          setPreviewExpanded(false);
          setUploadModalVisible(true);
        }
      }
    );
  }, []);

  const uploadPost = useCallback(async () => {
    if (!selectedImage || !currentUser?.uid) return;
    setUploading(true);
    try {
      await ensureProfileExists(currentUser.uid);

      const imageName = `posts/${currentUser.uid}/${Date.now()}_${selectedImage.fileName || 'image.jpg'}`;
      const reference = storage().ref(imageName);
      await reference.putFile(selectedImage.uri);
      const imageUrl = await reference.getDownloadURL();

      const profileSnap = await firestore().collection('profile').doc(currentUser.uid).get();
      const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
      const username = profile.name || profile.displayName || profile.username || 'User';
      const userAvatar = profile.avatar || null;

      await functions().httpsCallable('createPost')({
        imageUrl,
        caption,
        username,
        userAvatar,
        imageAspectRatio: resolveAspectRatio(),
        imageFitMode: previewExpanded ? 'cover' : 'contain',
      });

      setSelectedImage(null);
      setCaption('');
      setPreviewExpanded(false);
      setUploadModalVisible(false);
      Alert.alert('Success', 'Post uploaded successfully!');
    } catch (e) {
      Alert.alert('Error', 'Failed to upload post.');
    } finally {
      setUploading(false);
    }
  }, [caption, currentUser?.uid, ensureProfileExists, resolveAspectRatio, selectedImage]);

  useLayoutEffect(() => {
    if (!navigation?.setOptions) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={selectImage}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="add" size={26} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, selectImage]);

  const uploadModal = (
    <Modal
      visible={uploadModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        if (uploading) return;
        setUploadModalVisible(false);
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                if (uploading) return;
                setUploadModalVisible(false);
              }}
            >
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Post</Text>
            <TouchableOpacity onPress={uploadPost} disabled={uploading}>
              <Text style={[styles.shareButton, uploading && styles.disabledButton]}>
                {uploading ? 'Posting...' : 'Share'}
              </Text>
            </TouchableOpacity>
          </View>

          {selectedImage ? (
            <>
              <View style={[styles.frameWrap, { height: Math.min(SCREEN_WIDTH, 520) }]}>
                <Image
                  source={{ uri: selectedImage.uri }}
                  style={styles.framedImage}
                  resizeMode={previewExpanded ? 'cover' : 'contain'}
                />
                <TouchableOpacity
                  style={styles.expandToggle}
                  onPress={() => setPreviewExpanded((v) => !v)}
                  disabled={uploading}
                  activeOpacity={0.85}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon
                    name={previewExpanded ? 'contract-outline' : 'expand-outline'}
                    size={18}
                    color="white"
                  />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.previewPlaceholderText}>Pick an image to post</Text>
            </View>
          )}

          <TextInput
            style={styles.captionInput}
            placeholder="Write a caption..."
            placeholderTextColor="#666"
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={500}
          />

          {uploading && (
            <View style={styles.uploadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.uploadingText}>Uploading your post...</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );

  const initializeAggregatedData = useCallback(async () => {
    try {
      console.log('[ConversationsScreen] Checking aggregated data...');
      const aggregatedDoc = await firestore().collection('aggregated').doc('popularPosts').get();

      let shouldTriggerUpdate = false;

      if (!aggregatedDoc.exists) {
        shouldTriggerUpdate = true;
      } else {
        const data = aggregatedDoc.data();
        const lastUpdated = data?.lastUpdated?.toDate();
        const hasPosts = data?.posts && Array.isArray(data.posts) && data.posts.length > 0;
        if (!lastUpdated || !hasPosts) shouldTriggerUpdate = true;
      }

      if (shouldTriggerUpdate) {
        try {
          const updateFunction = functions().httpsCallable('triggerPopularPostsUpdateCallable');
          await updateFunction();
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (funcError) {
          console.log('[ConversationsScreen] Cloud function call failed, will use fallback:', funcError.message);
        }
      }
    } catch (error) {
      console.log('[ConversationsScreen] Initialization check failed (will use fallback):', error.message);
    }
  }, []);

  const loadPopularPosts = useCallback(async (options = {}) => {
    const { sinceTimestamp = null, forceRecompute = false } = options;
    try {
      setLoadingPopular(true);
      setError(null);

      if (forceRecompute) {
        try {
          const updateFunction = functions().httpsCallable('triggerPopularPostsUpdateCallable');
          await updateFunction();
        } catch (recomputeError) {
          // Keep refresh usable even when recompute endpoint is unavailable.
          console.log('[ConversationsScreen] Recompute popular posts failed, using latest available data:', recomputeError.message);
        }
      }

      let posts = await retryWithBackoff(async () => {
        if (sinceTimestamp) {
          const getPopularPostsSince = functions().httpsCallable('getPopularPostsSince');
          const response = await getPopularPostsSince({
            sinceTimestamp,
            excludeUserIds: followingIds || [],
            limit: 50,
          });
          return Array.isArray(response?.data?.items) ? response.data.items : [];
        }

        const aggregatedDoc = await firestore().collection('aggregated').doc('popularPosts').get();

        if (aggregatedDoc.exists) {
          const data = aggregatedDoc.data();
          if (data?.posts && Array.isArray(data.posts) && data.posts.length > 0) {
            let normalized = data.posts.map(post => ({
              ...post,
              imageUrl: post.imageUrl || post.avatarUrl || null,
              userAvatar: post.userAvatar || post.avatarUrl || null,
              likeCount: post.likeCount || post.likes || 0,
              likes: post.likes || post.likeCount || 0,
              commentCount: post.commentCount || 0,
            }));

            if (followingIds && followingIds.length > 0) {
              normalized = normalized.filter(post => !followingIds.includes(post.userId));
            }
            if (sinceTimestamp) {
              const sinceMs = new Date(sinceTimestamp).getTime();
              normalized = normalized.filter(post => getPostTimestamp(post) > sinceMs);
            }
            return normalized;
          }
        }

        // Fallback: direct query
        let postsSnapshot;
        try {
          postsSnapshot = await firestore().collection('posts').orderBy('likes', 'desc').limit(20).get();
        } catch {
          try {
            postsSnapshot = await firestore().collection('posts').orderBy('likeCount', 'desc').limit(20).get();
          } catch {
            postsSnapshot = await firestore().collection('posts').limit(20).get();
          }
        }

        let fallbackPosts = postsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            postId: doc.id,
            ...data,
            likeCount: data.likes || data.likeCount || 0,
            likes: data.likes || data.likeCount || 0,
          };
        });

        if (followingIds && followingIds.length > 0) {
          fallbackPosts = fallbackPosts.filter(post => !followingIds.includes(post.userId));
        }
        if (sinceTimestamp) {
          const sinceMs = new Date(sinceTimestamp).getTime();
          fallbackPosts = fallbackPosts.filter(post => getPostTimestamp(post) > sinceMs);
        }
        return fallbackPosts;
      }, 3, 1000);

      // For incremental callable path avatars are already hydrated in aggregated data;
      // for Firestore fallback path keep hydration as safety.
      posts = sinceTimestamp ? posts : await hydrateAvatars(posts);

      setPopularPosts(prev => mergePostsByRecency(prev, posts));
      setLoadingPopular(false);
    } catch (error) {
      console.error('[ConversationsScreen] Error loading popular posts:', error);
      setError(error);
      setLoadingPopular(false);
      if (error.code === 'unavailable' || error.message?.includes('unavailable')) {
        Alert.alert('Connection Issue', 'Unable to load posts. Please check your internet connection and try again.', [{ text: 'OK' }]);
      }
    }
  }, [followingIds]);

  useEffect(() => {
    if (currentUser) initializeAggregatedData();
  }, [currentUser?.uid, initializeAggregatedData]);

  useEffect(() => {
    if (!loading && currentUser) loadPopularPosts();
  }, [loading, followingIds?.length, currentUser?.uid, loadPopularPosts]);

  useEffect(() => {
    setMergedFollowingPosts(prev => mergePostsByRecency(prev, followingPosts || []));
  }, [followingPosts]);

  // Combine following posts and popular posts, hydrating following posts avatars too
  // If a followed user's post appears in popular payload, force it into following section.
  useEffect(() => {
    const popular = popularPosts || [];
    const followingFromPopular = (followingIds && followingIds.length > 0)
      ? popular.filter(p => followingIds.includes(p.userId))
      : [];
    const following = mergePostsByRecency(mergedFollowingPosts || [], followingFromPopular);
    const followingIdsSet = new Set(following.map(p => p.id || p.postId));
    const nonFollowingPopular = popular.filter(p => !followingIdsSet.has(p.id || p.postId));

    if (following.length === 0 && nonFollowingPopular.length === 0) {
      setCombinedPosts([]);
      setPopularSectionStartIndex(0);
      return;
    }

    const buildCombined = async () => {
      let hydratedFollowing = following;

      // Hydrate following posts avatars too (cheap — same unique-user approach)
      if (following.length > 0) {
        hydratedFollowing = await hydrateAvatars(following);
      }

      if (hydratedFollowing.length > 0) {
        const seenIds = new Set(hydratedFollowing.map(p => p.id || p.postId));
        const uniquePopular = nonFollowingPopular.filter(p => !seenIds.has(p.id || p.postId));
        const next = [...hydratedFollowing, ...uniquePopular];
        setCombinedPosts(next);
        setPopularSectionStartIndex(hydratedFollowing.length);
        refreshCommentCountsFor(next);
      } else {
        setCombinedPosts(nonFollowingPopular);
        setPopularSectionStartIndex(0);
        refreshCommentCountsFor(nonFollowingPopular);
      }

      if (initialLoad && (following.length > 0 || nonFollowingPopular.length > 0)) {
        setInitialLoad(false);
      }
    };

    buildCombined();
  }, [mergedFollowingPosts, popularPosts, initialLoad, followingIds, refreshCommentCountsFor]);

  // When the user returns to this screen (including cold start -> first focus),
  // refresh comment counts from the canonical posts collection.
  useFocusEffect(
    useCallback(() => {
      refreshCommentCountsFor(combinedPosts);
    }, [combinedPosts, refreshCommentCountsFor])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const latestFollowingTs = toIsoIfValid(Math.max(...(mergedFollowingPosts || []).map(getPostTimestamp), 0));
      const latestPopularTs = toIsoIfValid(Math.max(...(popularPosts || []).map(getPostTimestamp), 0));
      await Promise.all([
        loadPopularPosts({ sinceTimestamp: latestPopularTs, forceRecompute: true }),
        refreshPostsFromFollowing
          ? refreshPostsFromFollowing({ sinceTimestamp: latestFollowingTs })
          : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const renderFeedItem = useCallback(({ item, index }) => {
    const isFirstPopular = index === popularSectionStartIndex && popularSectionStartIndex > 0;
    return (
      <React.Fragment key={item.id || item.postId || index}>
        {isFirstPopular && (
          <View style={styles.sectionDivider}>
            <View style={styles.dividerLine} />
            <Text style={styles.sectionText}>🔥 Trending on Kaiwa</Text>
            <View style={styles.dividerLine} />
          </View>
        )}
        <Post
          postsId={item.id || item.postId}
          name={item.username || 'Anonymous'}
          // Be tolerant of different payload shapes so post images always render.
          image={item.imageUrl || item.image || item.mediaUrl || item.photoUrl || item.avatarUrl || null}
          Avatar={item.userAvatar || null}
          caption={item.caption || item.content || ''}
          initialLikeCount={item.likeCount || item.likes || 0}
          initialLikedBy={item.likedBy || []}
          createdAt={item.createdAt}
          userId={item.userId}
          commentCount={item.commentCount || 0}
          imageAspectRatio={item.imageAspectRatio}
          imageFitMode={item.imageFitMode}
        />
      </React.Fragment>
    );
  }, [popularSectionStartIndex]);

  if (initialLoad || loading || loadingPopular) {
    return (
      <>
        <ScrollView contentContainerStyle={styles.feed}>
          {[...Array(3)].map((_, index) => (
            <Postskeleton key={`skeleton-${index}`} />
          ))}
        </ScrollView>
        {uploadModal}
      </>
    );
  }

  if (error && combinedPosts.length === 0) {
    return (
      <>
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          <Icon name="cloud-offline-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
          <Text style={styles.emptyTitle}>Connection Issue</Text>
          <Text style={styles.emptySubtitle}>Unable to load posts. Please check your connection.</Text>
          <TouchableOpacity style={styles.exploreButton} onPress={loadPopularPosts}>
            <Icon name="refresh-outline" size={20} color="#fff" />
            <Text style={styles.exploreButtonText}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
        {uploadModal}
      </>
    );
  }

  return (
    <>
      <FlatList
        data={combinedPosts}
        keyExtractor={(item, index) => String(item?.id || item?.postId || index)}
        renderItem={renderFeedItem}
        contentContainerStyle={styles.feed}
        showsVerticalScrollIndicator={false}
        // Avoid blank flashes (common on Android with heavy rows)
        removeClippedSubviews={Platform.OS === 'ios'}
        initialNumToRender={5}
        maxToRenderPerBatch={8}
        windowSize={11}
        updateCellsBatchingPeriod={30}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      />
      {uploadModal}
    </>
  );
};

export default ConversationsScreen;

const styles = StyleSheet.create({
  feed: {
    paddingVertical: 10,
    backgroundColor: '#000',
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },
  emptySubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
  },
  exploreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    marginBottom: 40,
  },
  exploreButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  tipsContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 20,
  },
  tipsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  tipText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sectionText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 15,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    alignSelf: 'stretch',
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  shareButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    color: '#666',
  },
  previewImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#333',
  },
  aspectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  aspectLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 6,
  },
  aspectChip: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  aspectChipActive: {
    backgroundColor: '#0b2b4f',
    borderColor: '#007AFF',
  },
  aspectChipText: {
    color: '#bbb',
    fontSize: 12,
    fontWeight: '700',
  },
  aspectChipTextActive: {
    color: 'white',
  },
  frameWrap: {
    width: '100%',
    backgroundColor: '#0b0d12',
    borderTopWidth: 1,
    borderTopColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    overflow: 'hidden',
    borderRadius: 12,
    marginHorizontal: 12,
  },
  framedImage: {
    width: '100%',
    height: '100%',
  },
  expandToggle: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholder: {
    width: '100%',
    height: 300,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  previewPlaceholderText: {
    color: '#777',
    fontSize: 14,
  },
  captionInput: {
    color: 'white',
    fontSize: 16,
    padding: 16,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  uploadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  uploadingText: {
    color: '#666',
    marginTop: 10,
  },
});