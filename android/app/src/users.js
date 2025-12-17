import React, { createContext, useContext, useState, useEffect } from 'react';
// Updated imports for Firebase v22+ modular API
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
  const [cachedImages, setCachedImages] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [followingQuestions, setFollowingQuestions] = useState([]);
  const [followingPosts, setFollowingPosts] = useState([]);
  const [followingIds, setFollowingIds] = useState([]); // Add this state with default empty array
  const [followingUsers, setFollowingUsers] = useState([]); // Add this state with default empty array
  

  // Initialize Firebase services
  const db = getFirestore();
  const auth = getAuth();

  // Question caching utilities
  const CACHE_KEYS = {
    QUESTIONS: 'cached_following_questions',
    QUESTIONS_TIMESTAMP: 'cached_questions_timestamp',
    QUESTIONS_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    POSTS: 'cached_following_posts',
    POSTS_TIMESTAMP: 'cached_posts_timestamp',
    FOLLOWING_USERS: 'cached_following_users', // Add this
    FOLLOWING_USERS_TIMESTAMP: 'cached_following_users_timestamp', // Add this
  }

  

  const saveQuestionsToCache = async (questions) => {
    try {
      const cacheData = {
        questions: questions,
        timestamp: Date.now(),
        userId: currentUser?.uid,
      };
      
      await AsyncStorage.setItem(
        CACHE_KEYS.QUESTIONS, 
        JSON.stringify(cacheData)
      );
      
      console.log('Questions cached successfully:', questions.length);
    } catch (error) {
      console.error('Error caching questions:', error);
    }
  };

  const loadQuestionsFromCache = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEYS.QUESTIONS);
      
      if (!cachedData) {
        console.log('No cached questions found');
        return null;
      }

      const { questions, timestamp, userId } = JSON.parse(cachedData);
      
      // Check if cache is for current user
      if (userId !== currentUser?.uid) {
        console.log('Cached questions are for different user, clearing cache');
        await clearQuestionsCache();
        return null;
      }

      // Check if cache is expired
      const isExpired = Date.now() - timestamp > CACHE_KEYS.QUESTIONS_EXPIRY;
      if (isExpired) {
        console.log('Cached questions expired, clearing cache');
        await clearQuestionsCache();
        return null;
      }

      // Convert timestamp strings back to Date objects if needed
      const processedQuestions = questions.map(q => ({
        ...q,
        createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
      }));

      console.log('Loaded questions from cache:', processedQuestions.length);
      return processedQuestions;
    } catch (error) {
      console.error('Error loading cached questions:', error);
      return null;
    }
  };

  const clearQuestionsCache = async () => {
    try {
      await AsyncStorage.removeItem(CACHE_KEYS.QUESTIONS);
      console.log('Questions cache cleared');
    } catch (error) {
      console.error('Error clearing questions cache:', error);
    }
  };

  const isCacheValid = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEYS.QUESTIONS);
      if (!cachedData) return false;

      const { timestamp, userId } = JSON.parse(cachedData);
      
      return (
        userId === currentUser?.uid &&
        Date.now() - timestamp < CACHE_KEYS.QUESTIONS_EXPIRY
      );
    } catch (error) {
      return false;
    }
  };

  // Enhanced question fetching with caching
  const fetchFollowingQuestionsWithCache = async (useCache = true) => {
    if (!currentUser) {
      setFollowingQuestions([]);
      return;
    }

    // Try to load from cache first if requested
    if (useCache) {
      const cachedQuestions = await loadQuestionsFromCache();
      if (cachedQuestions) {
        setFollowingQuestions(cachedQuestions);
        console.log('Using cached questions');
        
        // Continue to fetch fresh data in background
        fetchFollowingQuestionsFromFirestore();
        return;
      }
    }

    // If no cache or cache invalid, fetch from Firestore
    await fetchFollowingQuestionsFromFirestore();
  };

  const fetchFollowingQuestionsFromFirestore = async () => {
    let unsubscribeQuestions = null;

    try {
      console.log('Fetching following for user:', currentUser.uid);
      
      // Updated to use modular API
      const followingRef = collection(doc(collection(db, 'profile'), currentUser.uid), 'following');
      const followingSnap = await getDocs(followingRef);

      if (!followingSnap || !followingSnap.docs) {
        console.log('No following snapshot or docs found');
        setFollowingQuestions([]);
        await clearQuestionsCache();
        return;
      }

      const followingIds = followingSnap.docs.map(doc => doc.id);
      console.log('Following IDs:', followingIds);

      if (followingIds.length === 0) {
        console.log('No following users found');
        setFollowingQuestions([]);
        await clearQuestionsCache();
        return;
      }

      // Firestore 'in' supports max 10 ids -> split into chunks
      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < followingIds.length; i += chunkSize) {
        chunks.push(followingIds.slice(i, i + chunkSize));
      }

      console.log('Processing chunks:', chunks.length);
      let allQuestions = [];
      const unsubscribers = [];

      chunks.forEach((ids, chunkIndex) => {
        console.log(`Setting up listener for chunk ${chunkIndex}:`, ids);
        
        // Updated to use modular API - Fixed field name
        const questionsQuery = query(
          collection(db, 'questions'),
          where('authorId', 'in', ids)
        );
        
        const unsubscribe = onSnapshot(
          questionsQuery,
          snapshot => {
            console.log(`Chunk ${chunkIndex} snapshot received:`, snapshot?.docs?.length || 0, 'questions');
            
            if (!snapshot || !snapshot.docs) {
              console.log(`Chunk ${chunkIndex} - No snapshot or docs`);
              return;
            }

            const qs = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt || data.timestamp || new Date(),
              };
            });
            
            console.log(`Chunk ${chunkIndex} questions:`, qs.length);
            
            // Clear previous questions from this chunk
            allQuestions = allQuestions.filter(q => !ids.includes(q.authorId));
            
            // Add new questions from this chunk
            allQuestions.push(...qs);
            
            // Remove duplicates
            const uniqueQuestions = allQuestions.filter((question, index, self) => 
              index === self.findIndex(q => q.id === question.id)
            );
            
            // Sort by createdAt descending
            uniqueQuestions.sort((a, b) => {
              const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
              const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
              return dateB - dateA;
            });
            
            console.log('Total unique questions:', uniqueQuestions.length);
            setFollowingQuestions(uniqueQuestions);

            // Cache the questions data
            const questionsToCache = uniqueQuestions.map(q => ({
              ...q,
              createdAt: q.createdAt?.toDate ? q.createdAt.toDate().toISOString() : q.createdAt,
            }));
            saveQuestionsToCache(questionsToCache);

            // Cache question-related images if present
            qs.forEach(q => {
              if (q.imageUrl) cacheImage(q.imageUrl);
              if (q.userAvatar || q.avatar) cacheImage(q.userAvatar || q.avatar);
            });
          },
          error => {
            console.error(`Error in chunk ${chunkIndex} listener:`, error);
          }
        );
          
        unsubscribers.push(unsubscribe);
      });

      unsubscribeQuestions = () => {
        console.log('Cleaning up question listeners');
        unsubscribers.forEach(unsub => {
          try {
            unsub();
          } catch (error) {
            console.error('Error unsubscribing:', error);
          }
        });
      };
    } catch (err) {
      console.error('Error fetching following questions:', err);
      setFollowingQuestions([]);
    }

    return unsubscribeQuestions;
  };

  const fetchTrendingQuestions = async () => {
    try {
      // Fetch recent questions (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Use default Firestore() import for compatibility with date queries
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .where('timestamp', '>=', thirtyDaysAgo)
        .orderBy('timestamp', 'desc')
        .limit(100) // Get more, then sort in-memory
        .get();
      
      const questions = questionsSnapshot.docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp instanceof Date ? data.timestamp : new Date());
        const ageInDays = (new Date() - timestamp) / (1000 * 60 * 60 * 24);
        
        // Time decay: older questions get penalized
        const decayFactor = 1 / (1 + ageInDays / 7); // Decay over weeks
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
      
      // Sort by trending score, not raw likes
      return questions
        .sort((a, b) => b.trendingScore - a.trendingScore)
        .slice(0, 10);
        
    } catch (error) {
      console.error('Error fetching trending questions:', error);
      // If index doesn't exist, return empty array instead of throwing
      return [];
    }
  };
// ```

// // **Formula:**
// // ```
// Trending Score = Likes × (1 / (1 + age_in_days / 7))

// Examples:
// - 100 likes, 1 day old:  100 × 0.875 = 87.5
// - 100 likes, 7 days old: 100 × 0.5 = 50
// - 100 likes, 30 days old: 100 × 0.19 = 19
// - 50 likes, 1 day old:   50 × 0.875 = 43.75 ✅ Wins!

  const savePostsToCache = async (posts) => {
    try {
      const cacheData = {
        posts,
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

      const expired = Date.now() - timestamp > CACHE_KEYS.QUESTIONS_EXPIRY;
      if (expired) return null;

      return posts.map(p => ({
        ...p,
        createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      }));
    } catch (error) {
      console.error('Error loading cached posts:', error);
      return null;
    }
  };

  const fetchFollowingPostsFromFirestore = async () => {
    try {
      const followingRef = collection(doc(collection(db, 'profile'), currentUser.uid), 'following');
      const followingSnap = await getDocs(followingRef);

      if (!followingSnap || !followingSnap.docs.length) {
        setFollowingPosts([]);
        await AsyncStorage.removeItem(CACHE_KEYS.POSTS);
        return;
      }

      const followingIds = followingSnap.docs.map(doc => doc.id);

      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < followingIds.length; i += chunkSize) {
        chunks.push(followingIds.slice(i, i + chunkSize));
      }

      let allPosts = [];

      for (const ids of chunks) {
        const postsQuery = query(
          collection(db, 'posts'),
          where('userId', 'in', ids)
        );
        const snapshot = await getDocs(postsQuery);

        const posts = snapshot.docs.map(doc => ({
          id: doc.id,
          postId: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt || doc.data().timestamp || new Date(),
        }));

        allPosts.push(...posts);
      }

      // sort posts
      allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setFollowingPosts(allPosts);
      savePostsToCache(allPosts);

      // cache images too
      allPosts.forEach(post => {
        if (post.imageUrl) cacheImage(post.imageUrl);
        if (post.userImage) cacheImage(post.userImage);
      });
    } catch (error) {
      console.error('Error fetching following posts:', error);
      setFollowingPosts([]);
    }
  };

  // Effect to fetch following users data when currentUser changes
  useEffect(() => {
    if (!currentUser) {
      setFollowingUsers([]);
      setFollowingIds([]);
      return;
    }

    const initFollowingUsers = async () => {
      await fetchFollowingUsersData(true);
    };

    initFollowingUsers();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setFollowingPosts([]);
      return;
    }

    const initPosts = async () => {
      const cached = await loadPostsFromCache();
      if (cached) {
        setFollowingPosts(cached);
        // also fetch fresh in background
        fetchFollowingPostsFromFirestore();
      } else {
        await fetchFollowingPostsFromFirestore();
      }
    };

    initPosts();
  }, [currentUser]);

  // Image caching utilities (existing code)
  const getCacheKey = (url) => {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  };

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

  const cacheImage = async (imageUrl) => {
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
        
        console.log('Image cached successfully at:', localPath);
        return cachedPath;
      } else {
        console.error('Failed to download image, status:', downloadResult.statusCode);
        return imageUrl;
      }
    } catch (error) {
      console.error('Error caching image:', error);
      return imageUrl;
    }
  };

  const loadCachedImages = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const imageKeys = keys.filter(key => key.startsWith('cached_image_'));
      const imageEntries = await AsyncStorage.multiGet(imageKeys);
      
      const cached = {};
      for (const [key, value] of imageEntries) {
        const originalUrl = key.replace('cached_image_', '');
        const exists = await RNFS.exists(value.replace('file://', ''));
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
      console.log('Image cache cleared');
    } catch (error) {
      console.error('Error clearing image cache:', error);
    }
  };

  const clearAllCache = async () => {
    await clearImageCache();
    await clearQuestionsCache();
    await clearFollowingUsersCache();
    console.log('All cache cleared');
  };

  const getCachedImageUri = (originalUrl) => {
    return cachedImages[originalUrl] || originalUrl;
  };

  // Auto-cache profile avatar when profile changes
  useEffect(() => {
    if (profile?.avatar && !cachedImages[profile.avatar]) {
      cacheImage(profile.avatar);
    }
  }, [profile?.avatar]);

  // Auto-cache post images
  useEffect(() => {
    posts.forEach(post => {
      if (post.imageUrl && !cachedImages[post.imageUrl]) {
        cacheImage(post.imageUrl);
      }
      if (post.userAvatar && !cachedImages[post.userAvatar]) {
        cacheImage(post.userAvatar);
      }
    });
  }, [posts]);

  // Enhanced following questions effect with caching
  useEffect(() => {
    if (!currentUser) {
      setFollowingQuestions([]);
      return;
    }

    let unsubscribeQuestions = null;

    const initializeQuestions = async () => {
      unsubscribeQuestions = await fetchFollowingQuestionsWithCache(true);
    };

    initializeQuestions();

    return () => {
      if (unsubscribeQuestions) {
        unsubscribeQuestions();
      }
    };
  }, [currentUser]);

  useEffect(() => {
    let unsubscribeProfile = null;
    let unsubscribePosts = null;

    loadCachedImages();

    // Updated to use modular API
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
      
      if (user) {
        setLoading(true);

        // Updated profile listener to use modular API
        const profileDocRef = doc(db, 'profile', user.uid);
        unsubscribeProfile = onSnapshot(
          profileDocRef,
          doc => {
            console.log('Profile snapshot received:', doc.exists());
            if (doc.exists()) {
              const profileData = doc.data();
              console.log('Profile data:', profileData?.username);
              setProfile(profileData);
              
              if (profileData.avatar) {
                cacheImage(profileData.avatar);
              }
            } else {
              console.log('Profile document does not exist');
              setProfile(null);
            }
            setLoading(false);
          },
          error => {
            console.error('Error fetching profile:', error);
            setProfile(null);
            setLoading(false);
          }
        );

        // Updated posts listener to use modular API
        const postsQuery = query(
          collection(db, 'posts'),
          where('userId', '==', user.uid)
        );
        
        unsubscribePosts = onSnapshot(
          postsQuery,
          snapshot => {
            console.log('Posts snapshot received:', snapshot?.docs?.length || 0, 'posts');
            
            if (!snapshot || !snapshot.docs) {
              console.log('No posts snapshot or docs');
              setPosts([]);
              return;
            }

            const userPosts = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data(),
            }));
            setPosts(userPosts);
            
            userPosts.forEach(post => {
              if (post.imageUrl) cacheImage(post.imageUrl);
              if (post.userAvatar) cacheImage(post.userAvatar);
            });
          },
          error => {
            console.error('Error fetching posts:', error);
            setPosts([]);
          }
        );
      } else {
        setProfile(null);
        setPosts([]);
        setFollowingQuestions([]);
        setFollowingUsers([]);
        setFollowingIds([]);
        setLoading(false);
        

        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }
        if (unsubscribePosts) {
          unsubscribePosts();
          unsubscribePosts = null;
        }
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribePosts) unsubscribePosts();
    };
  }, []);

  const contextValue = {
    profile,
    posts,
    setProfile,
    setPosts,
    loading,
    currentUser,
    followingQuestions,
    fetchTrendingQuestions,
    followingPosts,
    followingIds, // Add this to context
    followingUsers, // Add this to context
    refreshPostsFromFollowing: fetchFollowingPostsFromFirestore,
    
    // Image caching methods
    cacheImage,
    getCachedImageUri,
    getCachedImagePath,
    clearImageCache,
    cachedImages,
    
    // Question caching methods
    saveQuestionsToCache,
    loadQuestionsFromCache,
    clearQuestionsCache,
    fetchFollowingQuestionsWithCache,
    isCacheValid,
    clearAllCache,
    
    // Following users methods
    // fetchFollowingUsersData,
    // saveFollowingUsersToCache,
    // loadFollowingUsersFromCache,
    // clearFollowingUsersCache,
    
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

    // Refresh questions with option to force fetch from server
    refreshQuestions: async (forceRefresh = false) => {
      await fetchFollowingQuestionsWithCache(!forceRefresh);
    },

    // Refresh following users with option to force fetch from server
    refreshFollowingUsers: async (forceRefresh = false) => {
      await fetchFollowingUsersData(!forceRefresh);
    }
  };

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