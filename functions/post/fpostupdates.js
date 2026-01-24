const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {  onCall } = require('firebase-functions/v2/https'); 

// Don't initialize admin here - it's already initialized in index.js or will be by first import
if (!admin.apps.length) {
  admin.initializeApp();
}

// ==================== HELPER FUNCTION TO UPDATE POPULAR POSTS ====================
const updatePopularPostsLogic = async () => {
  console.log('🔄 Starting popular posts aggregation...');
  
  try {
    // Check if document exists and when it was last updated
    const aggregatedDoc = await admin.firestore()
      .collection('aggregated')
      .doc('popularPosts')
      .get();

    const now = admin.firestore.Timestamp.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    let shouldUpdate = false;

    if (!aggregatedDoc.exists) {
      console.log('📝 popularPosts document does not exist, creating...');
      shouldUpdate = true;
    } else {
      const data = aggregatedDoc.data();
      const lastUpdated = data?.lastUpdated;
      
      if (!lastUpdated) {
        console.log('⚠️ No lastUpdated timestamp found, updating...');
        shouldUpdate = true;
      } else {
        const lastUpdatedMs = lastUpdated.toMillis();
        const nowMs = now.toMillis();
        const timeSinceUpdate = nowMs - lastUpdatedMs;
        const minutesSinceUpdate = Math.round(timeSinceUpdate / 1000 / 60);
        
        console.log(`⏰ Last updated ${minutesSinceUpdate} minutes ago`);
        
        if (timeSinceUpdate > sixHoursInMs) {
          console.log('🔄 Data is older than 6 hours, updating...');
          shouldUpdate = true;
        } else {
          console.log('✅ Data is fresh (less than 6 hours old), skipping update');
          return {
            success: true,
            message: `Data is fresh (updated ${minutesSinceUpdate} minutes ago)`,
            skipped: true
          };
        }
      }
    }

    if (!shouldUpdate) {
      return {
        success: true,
        message: 'No update needed',
        skipped: true
      };
    }

    // Proceed with update
    let postsSnapshot;
    try {
      postsSnapshot = await admin.firestore()
        .collection('posts')
        .orderBy('likes', 'desc')
        .limit(50)
        .get();
    } catch (error) {
      console.log('⚠️ Trying fallback with likeCount field...');
      try {
        postsSnapshot = await admin.firestore()
          .collection('posts')
          .orderBy('likeCount', 'desc')
          .limit(50)
          .get();
      } catch (fallbackError) {
        console.log('⚠️ Getting posts without ordering...');
        postsSnapshot = await admin.firestore()
          .collection('posts')
          .limit(50)
          .get();
      }
    }

    if (postsSnapshot.empty) {
      console.log('⚠️ No posts found in database');
      return {
        success: false,
        message: 'No posts found in database',
        error: 'NO_POSTS'
      };
    }

    const popularPosts = postsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        postId: doc.id,
        userId: data.userId,
        username: data.username,
        imageUrl: data.imageUrl || null,
        avatarUrl: data.avatarUrl || null,
        userAvatar: data.userAvatar || null,
        caption: data.caption || data.content || '',
        likeCount: data.likes || data.likeCount || 0,
        likes: data.likes || data.likeCount || 0,
        likedBy: data.likedBy || [],
        createdAt: data.createdAt,
      };
    });

    await admin.firestore()
      .collection('aggregated')
      .doc('popularPosts')
      .set({
        posts: popularPosts,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        totalPosts: popularPosts.length,
      });

    console.log(`✅ Successfully aggregated ${popularPosts.length} popular posts`);
    
    return {
      success: true,
      message: `Successfully aggregated ${popularPosts.length} popular posts`,
      totalPosts: popularPosts.length
    };
  } catch (error) {
    console.error('❌ Error updating popular posts:', error);
    throw error;
  }
};

// ==================== HELPER FUNCTION TO UPDATE POPULAR USERS ====================
const updatePopularUsersLogic = async () => {
  console.log('🔄 Starting popular users aggregation...');
  
  try {
    // Check if document exists and when it was last updated
    const aggregatedDoc = await admin.firestore()
      .collection('aggregated')
      .doc('popularUsers')
      .get();

    const now = admin.firestore.Timestamp.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    let shouldUpdate = false;

    if (!aggregatedDoc.exists) {
      console.log('📝 popularUsers document does not exist, creating...');
      shouldUpdate = true;
    } else {
      const data = aggregatedDoc.data();
      const lastUpdated = data?.lastUpdated;
      
      if (!lastUpdated) {
        console.log('⚠️ No lastUpdated timestamp found, updating...');
        shouldUpdate = true;
      } else {
        const lastUpdatedMs = lastUpdated.toMillis();
        const nowMs = now.toMillis();
        const timeSinceUpdate = nowMs - lastUpdatedMs;
        const minutesSinceUpdate = Math.round(timeSinceUpdate / 1000 / 60);
        
        console.log(`⏰ Last updated ${minutesSinceUpdate} minutes ago`);
        
        if (timeSinceUpdate > sixHoursInMs) {
          console.log('🔄 Data is older than 6 hours, updating...');
          shouldUpdate = true;
        } else {
          console.log('✅ Data is fresh (less than 6 hours old), skipping update');
          return {
            success: true,
            message: `Data is fresh (updated ${minutesSinceUpdate} minutes ago)`,
            skipped: true
          };
        }
      }
    }

    if (!shouldUpdate) {
      return {
        success: true,
        message: 'No update needed',
        skipped: true
      };
    }

    // Proceed with update
    const usersSnapshot = await admin.firestore()
      .collection('profile')
      .where('isActive', '==', true)
      .orderBy('followersCount', 'desc')
      .limit(50)
      .get();

    if (usersSnapshot.empty) {
      console.log('⚠️ No users found in database');
      return {
        success: false,
        message: 'No users found in database',
        error: 'NO_USERS'
      };
    }

    const popularUsers = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || data.displayName,
        username: data.username,
        avatar: data.avatar || data.photoURL,
        bio: data.bio || '',
        followersCount: data.followersCount || 0,
        isVerified: data.isVerified || false,
        skills: (data.skills || []).slice(0, 3),
      };
    });

    await admin.firestore()
      .collection('aggregated')
      .doc('popularUsers')
      .set({
        users: popularUsers,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        totalUsers: popularUsers.length,
      });

    console.log(`✅ Successfully aggregated ${popularUsers.length} popular users`);
    
    return {
      success: true,
      message: `Successfully aggregated ${popularUsers.length} popular users`,
      totalUsers: popularUsers.length
    };
  } catch (error) {
    console.error('❌ Error updating popular users:', error);
    throw error;
  }
};

// ==================== SCHEDULED FUNCTION: UPDATE POPULAR POSTS ====================
// This runs every 3 hours but only updates if data is older than 6 hours
exports.updatePopularPosts = onSchedule(
  {
    schedule: 'every 3 hours',
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
    try {
      const result = await updatePopularPostsLogic();
      console.log('Scheduled update result:', result);
      return null;
    } catch (error) {
      console.error('Scheduled update failed:', error);
      throw error;
    }
  }
);

// ==================== SCHEDULED FUNCTION: UPDATE POPULAR USERS ====================
// This runs every 3 hours but only updates if data is older than 6 hours
exports.updatePopularUsers = onSchedule(
  {
    schedule: 'every 3 hours',
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
    try {
      const result = await updatePopularUsersLogic();
      console.log('Scheduled update result:', result);
      return null;
    } catch (error) {
      console.error('Scheduled update failed:', error);
      throw error;
    }
  }
);

// ==================== HTTP FUNCTION: MANUAL TRIGGER FOR POPULAR POSTS ====================
// Call this endpoint to manually trigger an update (useful for testing)
exports.triggerPopularPostsUpdate = onRequest(
  {
    memory: '512MB',
  },
  async (req, res) => {
    try {
      const result = await updatePopularPostsLogic();
      res.status(200).json(result);
    } catch (error) {
      console.error('Manual trigger failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// ==================== HTTP FUNCTION: MANUAL TRIGGER FOR POPULAR USERS ====================
// Call this endpoint to manually trigger an update (useful for testing)
exports.triggerPopularUsersUpdate = onRequest(
  {
    memory: '512MB',
  },
  async (req, res) => {
    try {
      const result = await updatePopularUsersLogic();
      res.status(200).json(result);
    } catch (error) {
      console.error('Manual trigger failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// ==================== HTTP FUNCTION: CHECK AGGREGATED DATA STATUS ====================
// Call this endpoint to check the status of aggregated data
exports.checkAggregatedStatus = onRequest(
  {
    memory: '256MB',
  },
  async (req, res) => {
    try {
      const [postsDoc, usersDoc] = await Promise.all([
        admin.firestore().collection('aggregated').doc('popularPosts').get(),
        admin.firestore().collection('aggregated').doc('popularUsers').get(),
      ]);

      const now = admin.firestore.Timestamp.now().toMillis();

      const getStatus = (doc, docName) => {
        if (!doc.exists) {
          return {
            exists: false,
            message: `${docName} does not exist`
          };
        }

        const data = doc.data();
        const lastUpdated = data?.lastUpdated;
        
        if (!lastUpdated) {
          return {
            exists: true,
            hasTimestamp: false,
            message: 'No timestamp found',
            totalItems: data?.totalPosts || data?.totalUsers || 0
          };
        }

        const lastUpdatedMs = lastUpdated.toMillis();
        const timeSinceUpdate = now - lastUpdatedMs;
        const minutesSinceUpdate = Math.round(timeSinceUpdate / 1000 / 60);
        const hoursSinceUpdate = (timeSinceUpdate / 1000 / 60 / 60).toFixed(2);

        return {
          exists: true,
          hasTimestamp: true,
          lastUpdated: lastUpdated.toDate().toISOString(),
          minutesSinceUpdate,
          hoursSinceUpdate: parseFloat(hoursSinceUpdate),
          isStale: timeSinceUpdate > (6 * 60 * 60 * 1000),
          totalItems: data?.totalPosts || data?.totalUsers || 0
        };
      };

      res.status(200).json({
        popularPosts: getStatus(postsDoc, 'popularPosts'),
        popularUsers: getStatus(usersDoc, 'popularUsers'),
        checkTime: new Date().toISOString()
      });
    } catch (error) {
      console.error('Status check failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

exports.getFollowingpost = onCall(
  {
    memory: '512MB',
  },
  async (request) => {
    // ✅ FIXED: In v2, context is accessed via request.auth
    if (!request.auth) {
      throw new Error('Must be authenticated');
    }
    
    const userId = request.auth.uid;
    const { type, lastTimestamp, limit = 50 } = request.data; // ✅ FIXED: data is accessed via request.data
    const db = admin.firestore();
    
    try {
      // Get following IDs
      const followingSnapshot = await db
        .collection('profile')
        .doc(userId)
        .collection('following')
        .get();
      
      const followingIds = followingSnapshot.docs.map(doc => doc.id);
      
      if (followingIds.length === 0) {
        return { items: [], hasMore: false };
      }
      
      // Split into chunks of 10 (Firestore 'in' limit)
      const chunks = [];
      for (let i = 0; i < followingIds.length; i += 10) {
        chunks.push(followingIds.slice(i, i + 10));
      }
      
      // Fetch in parallel
      const collectionName = type === 'posts' ? 'posts' : 'questions';
      const userField = type === 'posts' ? 'userId' : 'authorId';
      
      const promises = chunks.map(ids => {
        let query = db.collection(collectionName)
          .where(userField, 'in', ids)
          .orderBy('timestamp', 'desc')
          .limit(limit);
        
        if (lastTimestamp) {
          query = query.startAfter(admin.firestore.Timestamp.fromDate(new Date(lastTimestamp)));
        }
        
        return query.get();
      });
      
      const snapshots = await Promise.all(promises);
      
      // Combine and deduplicate
      const allItems = snapshots.flatMap(snapshot =>
        snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString()
          };
        })
      );
      
      // Remove duplicates and sort
      const uniqueItems = Array.from(
        new Map(allItems.map(item => [item.id, item])).values()
      ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return {
        items: uniqueItems.slice(0, limit),
        hasMore: uniqueItems.length === limit,
        lastTimestamp: uniqueItems.length > 0 ? uniqueItems[uniqueItems.length - 1].timestamp : null
      };
      
    } catch (error) {
      console.error('Error fetching following feed:', error);
      throw new Error('Error fetching feed');
    }
  }
);