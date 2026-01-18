import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getFirestore, collection, doc, onSnapshot, query, where, getDocs, getDoc, orderBy, limit } from '@react-native-firebase/firestore';
import Firestore from '@react-native-firebase/firestore';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const UserDataContext = createContext();

export const UserProvider = ({ children }) => {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('initial'); // 'initial' | 'profile' | 'content' | 'complete'
  const [cachedImages, setCachedImages] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [followingQuestions, setFollowingQuestions] = useState([]);
  const [followingPosts, setFollowingPosts] = useState([]);
  const [followingIds, setFollowingIds] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);

  // Refs to track fetch status and prevent duplicate requests
  const isFetchingQuestions = useRef(false);
  const isFetchingPosts = useRef(false);
  const lastProfileFetch = useRef(0);
  const lastPostsFetch = useRef(0);
  const lastQuestionsFetch = useRef(0);

  // Initialize Firebase services
  const db = getFirestore();
  const auth = getAuth();

  // Cache configuration
  const CACHE_KEYS = {
    QUESTIONS: 'cached_following_questions',
    QUESTIONS_TIMESTAMP: 'cached_questions_timestamp',
    POSTS: 'cached_following_posts',
    POSTS_TIMESTAMP: 'cached_posts_timestamp',
    FOLLOWING_USERS: 'cached_following_users',
    FOLLOWING_USERS_TIMESTAMP: 'cached_following_users_timestamp',
    LAST_PROFILE_FETCH: 'last_profile_fetch',
    LAST_POSTS_FETCH: 'last_posts_fetch',
    LAST_QUESTIONS_FETCH: 'last_questions_fetch',
  };

  const CACHE_DURATION = {
    QUESTIONS: 30 * 60 * 1000, // 30 minutes
    POSTS: 10 * 60 * 1000, // 10 minutes
    PROFILE: 5 * 60 * 1000, // 5 minutes
    FOLLOWING_USERS: 60 * 60 * 1000, // 1 hour
  };

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  const shouldFetchFresh = (cacheKey, duration) => {
    const lastFetch = lastProfileFetch.current;
    if (!lastFetch) return true;
    return Date.now() - lastFetch > duration;
  };

  const getCacheKey = (url) => {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  };

  // ============================================================================
  // CACHE MANAGEMENT - Questions
  // ============================================================================

  const saveQuestionsToCache = async (questions) => {
    try {
      const cacheData = {
        questions: questions.map(q => ({
          ...q,
          createdAt: q.createdAt?.toISOString ? q.createdAt.toISOString() : q.createdAt,
        })),
        timestamp: Date.now(),
        userId: currentUser?.uid,
      };
      await AsyncStorage.setItem(CACHE_KEYS.QUESTIONS, JSON.stringify(cacheData));
    } catch (error) {
      console.error('Error caching questions:', error);
    }
  };

  const loadQuestionsFromCache = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEYS.QUESTIONS);
      if (!cachedData) return null;

      const { questions, timestamp, userId } = JSON.parse(cachedData);
      
      if (userId !== currentUser?.uid) {
        await clearQuestionsCache();
        return null;
      }

      const isExpired = Date.now() - timestamp > CACHE_DURATION.QUESTIONS;
      if (isExpired) {
        await clearQuestionsCache();
        return null;
      }

      return questions.map(q => ({
        ...q,
        createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
      }));
    } catch (error) {
      console.error('Error loading cached questions:', error);
      return null;
    }
  };

  const clearQuestionsCache = async () => {
    try {
      await AsyncStorage.removeItem(CACHE_KEYS.QUESTIONS);
    } catch (error) {
      console.error('Error clearing questions cache:', error);
    }
  };

  // ============================================================================
  // CACHE MANAGEMENT - Posts
  // ============================================================================

  const savePostsToCache = async (posts) => {
    try {
      const cacheData = {
        posts: posts.map(p => ({
          ...p,
          createdAt: p.createdAt?.toISOString ? p.createdAt.toISOString() : p.createdAt,
        })),
        timestamp: Date.now(),
        userId: currentUser?.uid,
      };
      await AsyncStorage.setItem(CACHE_KEYS.POSTS, JSON.stringify(cacheData));
    } catch (error) {
      console.error('Error caching posts:', error);
    }
  };

  const loadPostsFromCache = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEYS.POSTS);
      if (!cachedData) return null;

      const { posts, timestamp, userId } = JSON.parse(cachedData);
      
      if (userId !== currentUser?.uid) return null;

      const isExpired = Date.now() - timestamp > CACHE_DURATION.POSTS;
      if (isExpired) return null;

      return posts.map(p => ({
        ...p,
        createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      }));
    } catch (error) {
      console.error('Error loading cached posts:', error);
      return null;
    }
  };

  // ============================================================================
  // CACHE MANAGEMENT - Following Users
  // ============================================================================

  const saveFollowingUsersToCache = async (users, ids) => {
    try {
      const cacheData = {
        users,
        ids,
        timestamp: Date.now(),
        userId: currentUser?.uid,
      };
      await AsyncStorage.setItem(CACHE_KEYS.FOLLOWING_USERS, JSON.stringify(cacheData));
    } catch (error) {
      console.error('Error caching following users:', error);
    }
  };

  const loadFollowingUsersFromCache = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEYS.FOLLOWING_USERS);
      if (!cachedData) return null;

      const { users, ids, timestamp, userId } = JSON.parse(cachedData);
      
      if (userId !== currentUser?.uid) return null;

      const isExpired = Date.now() - timestamp > CACHE_DURATION.FOLLOWING_USERS;
      if (isExpired) return null;

      return { users, ids };
    } catch (error) {
      console.error('Error loading cached following users:', error);
      return null;
    }
  };

  const clearFollowingUsersCache = async () => {
    try {
      await AsyncStorage.removeItem(CACHE_KEYS.FOLLOWING_USERS);
    } catch (error) {
      console.error('Error clearing following users cache:', error);
    }
  };

  // ============================================================================
  // IMAGE CACHING
  // ============================================================================

  const getCachedImagePath = async (imageUrl) => {
    if (!imageUrl) return null;

    const cacheKey = getCacheKey(imageUrl);
    const localPath = `${RNFS.CachesDirectoryPath}/${cacheKey}.jpg`;
    
    try {
      const exists = await RNFS.exists(localPath);
      if (exists) {
        return `file://${localPath}`;
      }
      return null;
    } catch (error) {
      console.error('Error checking cached image:', error);
      return null;
    }
  };

  const cacheImage = useCallback(async (imageUrl) => {
    if (!imageUrl || cachedImages[imageUrl]) return cachedImages[imageUrl];

    const cacheKey = getCacheKey(imageUrl);
    const localPath = `${RNFS.CachesDirectoryPath}/${cacheKey}.jpg`;
    
    try {
      const exists = await RNFS.exists(localPath);
      if (exists) {
        const cachedPath = `file://${localPath}`;
        setCachedImages(prev => ({ ...prev, [imageUrl]: cachedPath }));
        return cachedPath;
      }

      const downloadResult = await RNFS.downloadFile({
        fromUrl: imageUrl,
        toFile: localPath,
      }).promise;

      if (downloadResult.statusCode === 200) {
        const cachedPath = `file://${localPath}`;
        setCachedImages(prev => ({ ...prev, [imageUrl]: cachedPath }));
        await AsyncStorage.setItem(`cached_image_${cacheKey}`, cachedPath);
        return cachedPath;
      } else {
        return imageUrl;
      }
    } catch (error) {
      console.error('Error caching image:', error);
      return imageUrl;
    }
  }, [cachedImages]);

  const loadCachedImages = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const imageKeys = keys.filter(key => key.startsWith('cached_image_'));
      const imageEntries = await AsyncStorage.multiGet(imageKeys);
      
      const cached = {};
      for (const [key, value] of imageEntries) {
        const originalUrl = key.replace('cached_image_', '');
        const filePath = value.replace('file://', '');
        const exists = await RNFS.exists(filePath);
        if (exists) {
          cached[originalUrl] = value;
        } else {
          await AsyncStorage.removeItem(key);
        }
      }
      
      setCachedImages(cached);
    } catch (error) {
      console.error('Error loading cached images:', error);
    }
  };

  const clearImageCache = async () => {
    try {
      const cacheDir = RNFS.CachesDirectoryPath;
      const files = await RNFS.readDir(cacheDir);
      
      for (const file of files) {
        if (file.name.endsWith('.jpg') && file.name.includes('_')) {
          await RNFS.unlink(file.path);
        }
      }
      
      const keys = await AsyncStorage.getAllKeys();
      const imageKeys = keys.filter(key => key.startsWith('cached_image_'));
      await AsyncStorage.multiRemove(imageKeys);
      
      setCachedImages({});
    } catch (error) {
      console.error('Error clearing image cache:', error);
    }
  };

  const getCachedImageUri = useCallback((originalUrl) => {
    return cachedImages[originalUrl] || originalUrl;
  }, [cachedImages]);

  // ============================================================================
  // DATA FETCHING - Optimized
  // ============================================================================

  const fetchFollowingIds = async () => {
    try {
      const followingRef = collection(doc(collection(db, 'profile'), currentUser.uid), 'following');
      const followingSnap = await getDocs(followingRef);
      const ids = followingSnap.docs.map(doc => doc.id);
      setFollowingIds(ids);
      return ids;
    } catch (error) {
      console.error('Error fetching following IDs:', error);
      return [];
    }
  };

  const fetchFollowingQuestionsOptimized = async (useCache = true) => {
    if (!currentUser || isFetchingQuestions.current) return;

    // Try cache first
    if (useCache) {
      const cached = await loadQuestionsFromCache();
      if (cached && cached.length > 0) {
        setFollowingQuestions(cached);
        
        // Check if we should refresh in background
        if (shouldFetchFresh(lastQuestionsFetch.current, CACHE_DURATION.QUESTIONS)) {
          // Fetch fresh data in background without blocking
          setTimeout(() => fetchFollowingQuestionsOptimized(false), 1000);
        }
        return;
      }
    }

    isFetchingQuestions.current = true;

    try {
      // Get following IDs
      const followingRef = collection(doc(collection(db, 'profile'), currentUser.uid), 'following');
      const followingSnap = await getDocs(followingRef);
      const followingIds = followingSnap.docs.map(doc => doc.id);

      if (followingIds.length === 0) {
        setFollowingQuestions([]);
        await clearQuestionsCache();
        return;
      }

      // Split into chunks of 10 (Firestore 'in' limit)
      const chunks = [];
      for (let i = 0; i < followingIds.length; i += 10) {
        chunks.push(followingIds.slice(i, i + 10));
      }

      // Fetch all chunks in parallel
      const questionsPromises = chunks.map(ids =>
        getDocs(query(
          collection(db, 'questions'),
          where('authorId', 'in', ids),
          orderBy('timestamp', 'desc'),
          limit(20) // Limit per chunk to improve performance
        ))
      );

      const snapshots = await Promise.all(questionsPromises);

      // Combine and deduplicate
      const allQuestions = snapshots.flatMap(snapshot =>
        snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt || doc.data().timestamp || new Date(),
        }))
      );

      // Remove duplicates
      const uniqueQuestions = Array.from(
        new Map(allQuestions.map(q => [q.id, q])).values()
      );

      // Sort by date
      uniqueQuestions.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return dateB - dateA;
      });

      setFollowingQuestions(uniqueQuestions);
      await saveQuestionsToCache(uniqueQuestions);
      lastQuestionsFetch.current = Date.now();

      // Cache images in background
      uniqueQuestions.forEach(q => {
        if (q.imageUrl) setTimeout(() => cacheImage(q.imageUrl), 100);
        if (q.userAvatar || q.avatar) setTimeout(() => cacheImage(q.userAvatar || q.avatar), 100);
      });

    } catch (error) {
      console.error('Error fetching following questions:', error);
      setFollowingQuestions([]);
    } finally {
      isFetchingQuestions.current = false;
    }
  };

  const fetchFollowingPostsOptimized = async (useCache = true) => {
    if (!currentUser || isFetchingPosts.current) return;

    // Try cache first
    if (useCache) {
      const cached = await loadPostsFromCache();
      if (cached && cached.length > 0) {
        setFollowingPosts(cached);
        
        // Check if we should refresh in background
        if (shouldFetchFresh(lastPostsFetch.current, CACHE_DURATION.POSTS)) {
          setTimeout(() => fetchFollowingPostsOptimized(false), 1000);
        }
        return;
      }
    }

    isFetchingPosts.current = true;

    try {
      const followingRef = collection(doc(collection(db, 'profile'), currentUser.uid), 'following');
      const followingSnap = await getDocs(followingRef);
      const followingIds = followingSnap.docs.map(doc => doc.id);

      if (followingIds.length === 0) {
        setFollowingPosts([]);
        return;
      }

      // Split into chunks
      const chunks = [];
      for (let i = 0; i < followingIds.length; i += 10) {
        chunks.push(followingIds.slice(i, i + 10));
      }

      // Fetch all chunks in parallel
      const postsPromises = chunks.map(ids =>
        getDocs(query(
          collection(db, 'posts'),
          where('userId', 'in', ids),
          limit(30) // Limit per chunk
        ))
      );

      const snapshots = await Promise.all(postsPromises);

      // Combine results
      const allPosts = snapshots.flatMap(snapshot =>
        snapshot.docs.map(doc => ({
          id: doc.id,
          postId: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt || doc.data().timestamp || new Date(),
        }))
      );

      // Sort by date
      allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setFollowingPosts(allPosts);
      await savePostsToCache(allPosts);
      lastPostsFetch.current = Date.now();

      // Cache images in background
      allPosts.forEach(post => {
        if (post.imageUrl) setTimeout(() => cacheImage(post.imageUrl), 100);
        if (post.userImage) setTimeout(() => cacheImage(post.userImage), 100);
      });

    } catch (error) {
      console.error('Error fetching following posts:', error);
      setFollowingPosts([]);
    } finally {
      isFetchingPosts.current = false;
    }
  };

  const fetchTrendingQuestions = async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .where('timestamp', '>=', thirtyDaysAgo)
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();
      
      const questions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp instanceof Date ? data.timestamp : new Date());
        const ageInDays = (new Date() - timestamp) / (1000 * 60 * 60 * 24);
        
        const decayFactor = 1 / (1 + ageInDays / 7);
        const trendingScore = (data.likes || 0) * decayFactor;
        
        return {
          id: doc.id,
          title: data.title,
          content: data.content,
          username: data.username,
          userImage: data.userImage,
          timestamp: timestamp,
          createdAt: data.createdAt || data.timestamp || timestamp,
          answers: data.answers || [],
          tags: data.tags || [],
          authorId: data.authorId,
          likes: data.likes || 0,
          likedBy: data.likedBy || [],
          imageUrl: data.imageUrl || null,
          trendingScore: trendingScore
        };
      });
      
      return questions
        .sort((a, b) => b.trendingScore - a.trendingScore)
        .slice(0, 10);
        
    } catch (error) {
      console.error('Error fetching trending questions:', error);
      return [];
    }
  };

  // ============================================================================
  // PROGRESSIVE DATA LOADING
  // ============================================================================

  const loadDataProgressively = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    try {
      // Stage 1: Load critical profile data
      setLoadingStage('profile');
      const profileDocRef = doc(db, 'profile', currentUser.uid);
      const profileSnap = await getDoc(profileDocRef);
      
      if (profileSnap.exists()) {
        const profileData = profileSnap.data();
        setProfile(profileData);
        if (profileData.avatar) {
          cacheImage(profileData.avatar);
        }
      }

      // Stage 2: Load user's own posts
      const postsQuery = query(
        collection(db, 'posts'),
        where('userId', '==', currentUser.uid)
      );
      const postsSnap = await getDocs(postsQuery);
      const userPosts = postsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPosts(userPosts);

      // Cache post images in background
      userPosts.forEach(post => {
        if (post.imageUrl) setTimeout(() => cacheImage(post.imageUrl), 100);
      });

      // Stage 3: Load following content in parallel (non-blocking)
      setLoadingStage('content');
      
      // Don't await these - let them load in background
      fetchFollowingQuestionsOptimized(true);
      fetchFollowingPostsOptimized(true);
      
      setLoadingStage('complete');
      setLoading(false);

    } catch (error) {
      console.error('Error in progressive loading:', error);
      setLoading(false);
      setLoadingStage('complete');
    }
  }, [currentUser, db]);

  // ============================================================================
  // EFFECTS - Optimized
  // ============================================================================

  // Initialize cached images on mount
  useEffect(() => {
    loadCachedImages();
  }, []);

  // Main auth listener - triggers progressive loading
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
      
      if (user) {
        setLoading(true);
        loadDataProgressively();
      } else {
        setProfile(null);
        setPosts([]);
        setFollowingQuestions([]);
        setFollowingPosts([]);
        setFollowingUsers([]);
        setFollowingIds([]);
        setLoading(false);
        setLoadingStage('initial');
      }
    });

    return () => unsubscribeAuth();
  }, [loadDataProgressively]);

  // Auto-cache profile avatar when it changes
  useEffect(() => {
    if (profile?.avatar && !cachedImages[profile.avatar]) {
      cacheImage(profile.avatar);
    }
  }, [profile?.avatar, cachedImages, cacheImage]);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const contextValue = useMemo(() => ({
    profile,
    posts,
    setProfile,
    setPosts,
    loading,
    loadingStage,
    currentUser,
    followingQuestions,
    followingPosts,
    followingIds,
    followingUsers,
    
    // Optimized fetch methods
    fetchTrendingQuestions,
    refreshPostsFromFollowing: () => fetchFollowingPostsOptimized(false),
    refreshQuestions: (forceRefresh = false) => fetchFollowingQuestionsOptimized(!forceRefresh),
    
    // Image caching
    cacheImage,
    getCachedImageUri,
    getCachedImagePath,
    clearImageCache,
    cachedImages,
    
    // Cache management
    clearQuestionsCache,
    clearFollowingUsersCache,
    clearAllCache: async () => {
      await Promise.all([
        clearImageCache(),
        clearQuestionsCache(),
        clearFollowingUsersCache(),
      ]);
    },
    
    // Utility methods
    refreshProfile: async () => {
      if (currentUser) {
        const docRef = doc(db, 'profile', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProfile(docSnap.data());
        }
      }
    },
    
    refreshPosts: async () => {
      if (currentUser) {
        const postsQuery = query(
          collection(db, 'posts'),
          where('userId', '==', currentUser.uid)
        );
        const snapshot = await getDocs(postsQuery);
        const userPosts = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setPosts(userPosts);
      }
    },

    // Force reload all data
    reloadAllData: loadDataProgressively,
  }), [
    profile,
    posts,
    loading,
    loadingStage,
    currentUser,
    followingQuestions,
    followingPosts,
    followingIds,
    followingUsers,
    cachedImages,
    cacheImage,
    getCachedImageUri,
    loadDataProgressively,
  ]);

  return (
    <UserDataContext.Provider value={contextValue}>
      {children}
    </UserDataContext.Provider>
  );
};

export const useUserData = () => {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error('useUserData must be used within a UserProvider');
  }
  return context;
};