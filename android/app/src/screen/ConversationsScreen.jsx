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
    if (hasrequested === 'true') {
      return;
    }
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

// Retry helper function with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if it's a retryable error
      const isRetryable = 
        error.code === 'unavailable' || 
        error.message?.includes('unavailable') ||
        error.message?.includes('UNAVAILABLE');
      
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
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
    if (currentUser) {
      requestinitialpermissions();
    }
  }, [currentUser?.uid]);

  // Trigger server-side aggregation if needed
  const initializeAggregatedData = useCallback(async () => {
    try {
      console.log('[ConversationsScreen] Checking aggregated data...');
      
      // Check if document exists
      const aggregatedDoc = await firestore()
        .collection('aggregated')
        .doc('popularPosts')
        .get();

      let shouldTriggerUpdate = false;

      if (!aggregatedDoc.exists) {
        console.log('[ConversationsScreen] popularPosts document does not exist, need to create...');
        shouldTriggerUpdate = true;
      } else {
        const data = aggregatedDoc.data();
        const lastUpdated = data?.lastUpdated?.toDate();
        const hasPosts = data?.posts && Array.isArray(data.posts) && data.posts.length > 0;
        
        if (!lastUpdated) {
          console.log('[ConversationsScreen] No timestamp found, data is invalid, need to recreate...');
          shouldTriggerUpdate = true;
        } else if (!hasPosts) {
          console.log('[ConversationsScreen] No posts found in aggregated data, need to update...');
          shouldTriggerUpdate = true;
        } else {
          const minutesAgo = Math.round((new Date() - lastUpdated) / 1000 / 60);
          console.log(`[ConversationsScreen] Data is valid, last updated ${minutesAgo} minutes ago`);
        }
      }

      if (shouldTriggerUpdate) {
        console.log('[ConversationsScreen] Triggering server update...');
        
        // Call cloud function to create/update it
        try {
          const updateFunction = functions().httpsCallable('triggerPopularPostsUpdate');
          const result = await updateFunction();
          console.log('[ConversationsScreen] Server update result:', result.data);
          
          // Wait a moment for the document to be created
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (funcError) {
          console.log('[ConversationsScreen] Cloud function call failed, will use fallback:', funcError.message);
        }
      }
      
      console.log('[ConversationsScreen] Aggregated data check complete');
    } catch (error) {
      console.log('[ConversationsScreen] Initialization check failed (will use fallback):', error.message);
      // Don't throw - we'll use fallback if this fails
    }
  }, []);
  

  // Load popular posts with retry logic
  const loadPopularPosts = useCallback(async () => {
    try {
      setLoadingPopular(true);
      setError(null);

      const result = await retryWithBackoff(async () => {
        // Try to get from pre-aggregated collection first (ONLY 1 READ)
        const aggregatedDoc = await firestore()
          .collection('aggregated')
          .doc('popularPosts')
          .get();

        if (aggregatedDoc.exists) {
          console.log('[ConversationsScreen] Loading from aggregated collection');
          const data = aggregatedDoc.data();
          console.log('[ConversationsScreen] Aggregated data structure:', {
            hasPosts: !!data?.posts,
            postsIsArray: Array.isArray(data?.posts),
            postsLength: data?.posts?.length || 0,
            totalPosts: data?.totalPosts,
            lastUpdated: data?.lastUpdated?.toDate ? data.lastUpdated.toDate().toISOString() : data?.lastUpdated,
          });
          
          // Check if data and posts exist
          if (data && data.posts && Array.isArray(data.posts) && data.posts.length > 0) {
            console.log(`[ConversationsScreen] Found ${data.posts.length} posts in aggregated collection`);
            // Normalize posts to ensure all required fields are present
            let posts = data.posts.map(post => ({
              ...post,
              imageUrl: post.imageUrl || post.avatarUrl || null,
              userAvatar: post.userAvatar || post.avatarUrl || null,
              likeCount: post.likeCount || post.likes || 0,
              likes: post.likes || post.likeCount || 0,
            }));

            // Debug: Log first post structure
            if (posts.length > 0) {
              console.log('[ConversationsScreen] Sample post structure:', {
                id: posts[0].id,
                imageUrl: posts[0].imageUrl,
                userAvatar: posts[0].userAvatar,
                avatarUrl: posts[0].avatarUrl,
              });
            }

            // Filter out posts from users the current user is already following
            if (followingIds && followingIds.length > 0) {
              posts = posts.filter(post => !followingIds.includes(post.userId));
              console.log(`[ConversationsScreen] Filtered to ${posts.length} posts after removing following users`);
            }

            return posts;
          } else {
            console.log('[ConversationsScreen] Aggregated data is invalid or empty, using fallback');
          }
        } else {
          console.log('[ConversationsScreen] Aggregated document not found, using fallback');
        }
        
        // Fallback: fetch directly if aggregated doesn't exist or is invalid
        console.log('[ConversationsScreen] Using fallback query');
        let postsSnapshot;
        try {
          // Try 'likes' field first (actual field name in posts collection)
          postsSnapshot = await firestore()
            .collection('posts')
            .orderBy('likes', 'desc')
            .limit(20)
            .get();
        } catch (error) {
          // Fallback to 'likeCount' if 'likes' doesn't exist
          console.log('[ConversationsScreen] Trying fallback with likeCount field...');
          try {
            postsSnapshot = await firestore()
              .collection('posts')
              .orderBy('likeCount', 'desc')
              .limit(20)
              .get();
          } catch (fallbackError) {
            // If both fail, just get posts without ordering
            console.log('[ConversationsScreen] Getting posts without ordering...');
            postsSnapshot = await firestore()
              .collection('posts')
              .limit(20)
              .get();
          }
        }

        let posts = postsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            postId: doc.id,
            ...data,
            // Normalize field names
            likeCount: data.likes || data.likeCount || 0,
            likes: data.likes || data.likeCount || 0,
          };
        });

        console.log(`[ConversationsScreen] Fallback query returned ${posts.length} posts`);
        if (posts.length > 0) {
          console.log('[ConversationsScreen] Sample fallback post:', {
            id: posts[0].id,
            imageUrl: posts[0].imageUrl,
            userAvatar: posts[0].userAvatar,
            likes: posts[0].likes,
            likeCount: posts[0].likeCount,
          });
        }

        // Filter out following users
        if (followingIds && followingIds.length > 0) {
          posts = posts.filter(post => !followingIds.includes(post.userId));
          console.log(`[ConversationsScreen] Filtered to ${posts.length} posts after removing following users`);
        }

        return posts;
      }, 3, 1000); // 3 retries with 1 second base delay

      setPopularPosts(result);
      setLoadingPopular(false);
    } catch (error) {
      console.error('[ConversationsScreen] Error loading popular posts:', error);
      setError(error);
      setLoadingPopular(false);
      
      // Show user-friendly error message
      if (error.code === 'unavailable' || error.message?.includes('unavailable')) {
        Alert.alert(
          'Connection Issue',
          'Unable to load posts. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [followingIds]);

  // Initialize on mount - ensure aggregate exists
  useEffect(() => {
    if (currentUser) {
      initializeAggregatedData();
    }
  }, [currentUser?.uid, initializeAggregatedData]);

  // Load popular posts when component mounts or when following changes
  useEffect(() => {
    if (!loading && currentUser) {
      loadPopularPosts();
    }
  }, [loading, followingIds?.length, currentUser?.uid, loadPopularPosts]);

  // Combine following posts and popular posts
  useEffect(() => {
    const following = followingPosts || [];
    const popular = popularPosts || [];

    if (following.length === 0 && popular.length === 0) {
      setCombinedPosts([]);
      return;
    }

    // If user follows people, show their posts first, then popular posts
    if (following.length > 0) {
      // Remove duplicates by post ID
      const seenIds = new Set(following.map(p => p.id || p.postId));
      const uniquePopular = popular.filter(p => !seenIds.has(p.id || p.postId));

      // Combine: following posts first, then popular posts
      setCombinedPosts([...following, ...uniquePopular]);
    } else {
      // If not following anyone, show only popular posts
      setCombinedPosts(popular);
    }

    // Mark initial load as complete when we have data
    if (initialLoad && (following.length > 0 || popular.length > 0)) {
      setInitialLoad(false);
    }
  }, [followingPosts, popularPosts, initialLoad]);

  // Pull to refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    await loadPopularPosts();
    setRefreshing(false);
  };

  // Show loading state - ensure we show loading during initial load or when explicitly loading
  if (initialLoad || loading || loadingPopular) {
    return (
      <ScrollView contentContainerStyle={styles.feed}>
        {[...Array(3)].map((_, index) => (
          <Postskeleton key={`skeleton-${index}`} />
        ))}
      </ScrollView>
    );
  }

  // Show error state with retry option
  if (error && combinedPosts.length === 0) {
    return (
      <ScrollView 
        contentContainerStyle={styles.emptyContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        <Icon name="cloud-offline-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
        <Text style={styles.emptyTitle}>Connection Issue</Text>
        <Text style={styles.emptySubtitle}>
          Unable to load posts. Please check your connection.
        </Text>
        
        <TouchableOpacity 
          style={styles.exploreButton}
          onPress={loadPopularPosts}
        >
          <Icon name="refresh-outline" size={20} color="#fff" />
          <Text style={styles.exploreButtonText}>Retry</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // // Show empty state for new users
  // if (combinedPosts.length === 0) {
  //   return (
  //     <ScrollView 
  //       contentContainerStyle={styles.emptyContainer}
  //       refreshControl={
  //         <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
  //       }
  //     >
  //       <Icon name="images-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
  //       <Text style={styles.emptyTitle}>Welcome to DevLink!</Text>
  //       <Text style={styles.emptySubtitle}>
  //         {followingIds?.length === 0 
  //           ? "Start following developers to see their posts here"
  //           : "No posts available yet"}
  //       </Text>
        
  //       <TouchableOpacity 
  //         style={styles.exploreButton}
  //         onPress={() => {
  //           // Navigate to explore/discover screen
  //           // navigation.navigate('Explore');
  //         }}
  //       >
  //         <Icon name="compass-outline" size={20} color="#fff" />
  //         <Text style={styles.exploreButtonText}>Discover Developers</Text>
  //       </TouchableOpacity>

  //       {followingIds?.length === 0 && (
  //         <View style={styles.tipsContainer}>
  //           <Text style={styles.tipsTitle}>Getting Started:</Text>
  //           <View style={styles.tipItem}>
  //             <Icon name="people-outline" size={20} color="#007AFF" />
  //             <Text style={styles.tipText}>Follow developers to see their posts</Text>
  //           </View>
  //           <View style={styles.tipItem}>
  //             <Icon name="heart-outline" size={20} color="#007AFF" />
  //             <Text style={styles.tipText}>Like and comment on posts</Text>
  //           </View>
  //           <View style={styles.tipItem}>
  //             <Icon name="create-outline" size={20} color="#007AFF" />
  //             <Text style={styles.tipText}>Share your own projects</Text>
  //           </View>
  //         </View>
  //       )}
  //     </ScrollView>
  //   );
  // }

  // Render posts feed
  return (
    <ScrollView 
      contentContainerStyle={styles.feed}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      {combinedPosts.map((item, index) => {
        // Show divider before popular posts start
        const isFirstPopular = followingPosts?.length > 0 && 
                              index === followingPosts.length;

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
              Avatar={item.userAvatar || item.avatarUrl || null}
              caption={item.caption || item.content || ''}
              initialLikeCount={item.likeCount || item.likes || 0}
              initialLikedBy={item.likedBy || []}
              createdAt={item.createdAt}
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