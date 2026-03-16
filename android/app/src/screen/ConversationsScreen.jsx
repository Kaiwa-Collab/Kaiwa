import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View, Alert, TouchableOpacity, RefreshControl } from 'react-native';
import Post from '../Post';
import { useUserData } from '../users';
import { requestcamerapermission, requestgallerypermission } from '../../utils/permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Postskeleton from '../animations/postskeleton';
import firestore from '@react-native-firebase/firestore';
import Icon from 'react-native-vector-icons/Ionicons';
import functions from '@react-native-firebase/functions';

const PERMISSIONS_REQUESTED_KEY = '@permissions_requested';

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

const ConversationsScreen = () => {
  const { loading, followingPosts, getCachedImageUri, currentUser, followingIds } = useUserData();
  const [popularPosts, setPopularPosts] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [combinedPosts, setCombinedPosts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    if (currentUser) requestinitialpermissions();
  }, [currentUser?.uid]);

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
          const updateFunction = functions().httpsCallable('triggerPopularPostsUpdate');
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

  const loadPopularPosts = useCallback(async () => {
    try {
      setLoadingPopular(true);
      setError(null);

      let posts = await retryWithBackoff(async () => {
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
            }));

            if (followingIds && followingIds.length > 0) {
              normalized = normalized.filter(post => !followingIds.includes(post.userId));
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
        return fallbackPosts;
      }, 3, 1000);

      // Hydrate with fresh avatars from profile docs (1 read per unique user, not per post)
      posts = await hydrateAvatars(posts);

      setPopularPosts(posts);
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

  // Combine following posts and popular posts, hydrating following posts avatars too
  useEffect(() => {
    const following = followingPosts || [];
    const popular = popularPosts || [];

    if (following.length === 0 && popular.length === 0) {
      setCombinedPosts([]);
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
        const uniquePopular = popular.filter(p => !seenIds.has(p.id || p.postId));
        setCombinedPosts([...hydratedFollowing, ...uniquePopular]);
      } else {
        setCombinedPosts(popular);
      }

      if (initialLoad && (following.length > 0 || popular.length > 0)) {
        setInitialLoad(false);
      }
    };

    buildCombined();
  }, [followingPosts, popularPosts, initialLoad]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPopularPosts();
    setRefreshing(false);
  };

  if (initialLoad || loading || loadingPopular) {
    return (
      <ScrollView contentContainerStyle={styles.feed}>
        {[...Array(3)].map((_, index) => (
          <Postskeleton key={`skeleton-${index}`} />
        ))}
      </ScrollView>
    );
  }

  if (error && combinedPosts.length === 0) {
    return (
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
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.feed}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
    >
      {combinedPosts.map((item, index) => {
        const isFirstPopular = followingPosts?.length > 0 && index === followingPosts.length;

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
              image={item.imageUrl || item.avatarUrl || null}
              Avatar={item.userAvatar || null}
              caption={item.caption || item.content || ''}
              initialLikeCount={item.likeCount || item.likes || 0}
              initialLikedBy={item.likedBy || []}
              createdAt={item.createdAt}
              userId={item.userId}  
            />
          </React.Fragment>
        );
      })}
    </ScrollView>
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
});