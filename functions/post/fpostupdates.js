const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest, onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// ==================== AVATAR HYDRATION ====================
// Fetches fresh avatars from profile collection for a list of posts.
// Called during aggregation so the client gets fresh avatars for free —
// no extra profile reads needed on the client side for popular posts.
const hydratePostAvatars = async (posts) => {
  if (!posts || posts.length === 0) return posts;

  const uniqueUserIds = [...new Set(posts.map(p => p.userId).filter(Boolean))];
  if (uniqueUserIds.length === 0) return posts;

  // 1 read per unique user, fired in parallel
  const profileSnaps = await Promise.all(
    uniqueUserIds.map(uid =>
      admin.firestore().collection('profile').doc(uid).get()
    )
  );

  const avatarMap = {};
  profileSnaps.forEach((snap, i) => {
    if (snap.exists) {
      avatarMap[uniqueUserIds[i]] = snap.data()?.avatar || null;
    }
  });

  return posts.map(post => ({
    ...post,
    // Fresh avatar from profile takes priority over stale post-stored avatar
    userAvatar: avatarMap[post.userId] || post.userAvatar || null,
  }));
};

// ==================== HELPER: UPDATE POPULAR POSTS ====================
const updatePopularPostsLogic = async () => {
  console.log('🔄 Starting popular posts aggregation...');

  try {
    const aggregatedDoc = await admin.firestore()
      .collection('aggregated')
      .doc('popularPosts')
      .get();

    const now = admin.firestore.Timestamp.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000;
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
        const timeSinceUpdate = now.toMillis() - lastUpdated.toMillis();
        const minutesSinceUpdate = Math.round(timeSinceUpdate / 1000 / 60);
        console.log(`⏰ Last updated ${minutesSinceUpdate} minutes ago`);

        if (timeSinceUpdate > sixHoursInMs) {
          console.log('🔄 Data is older than 6 hours, updating...');
          shouldUpdate = true;
        } else {
          console.log('✅ Data is fresh, skipping update');
          return {
            success: true,
            message: `Data is fresh (updated ${minutesSinceUpdate} minutes ago)`,
            skipped: true
          };
        }
      }
    }

    if (!shouldUpdate) {
      return { success: true, message: 'No update needed', skipped: true };
    }

    // Fetch top posts
    let postsSnapshot;
    try {
      postsSnapshot = await admin.firestore()
        .collection('posts').orderBy('likes', 'desc').limit(50).get();
    } catch {
      try {
        postsSnapshot = await admin.firestore()
          .collection('posts').orderBy('likeCount', 'desc').limit(50).get();
      } catch {
        postsSnapshot = await admin.firestore()
          .collection('posts').limit(50).get();
      }
    }

    if (postsSnapshot.empty) {
      console.log('⚠️ No posts found in database');
      return { success: false, message: 'No posts found in database', error: 'NO_POSTS' };
    }

    let popularPosts = postsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        postId: doc.id,
        userId: data.userId,
        username: data.username,
        imageUrl: data.imageUrl || null,
        userAvatar: data.userAvatar || null,
        caption: data.caption || data.content || '',
        likeCount: data.likes || data.likeCount || 0,
        likes: data.likes || data.likeCount || 0,
        likedBy: data.likedBy || [],
        createdAt: data.createdAt,
      };
    });

    // Hydrate with fresh avatars from profile collection during aggregation.
    // This means clients reading this doc get fresh avatars for free —
    // no extra profile reads needed on the client for popular posts.
    console.log('🖼️ Hydrating avatars from profile collection...');
    popularPosts = await hydratePostAvatars(popularPosts);

    await admin.firestore()
      .collection('aggregated')
      .doc('popularPosts')
      .set({
        posts: popularPosts,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        totalPosts: popularPosts.length,
      });

    console.log(`✅ Successfully aggregated ${popularPosts.length} popular posts with fresh avatars`);
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

// ==================== HELPER: UPDATE POPULAR USERS ====================
const updatePopularUsersLogic = async () => {
  console.log('🔄 Starting popular users aggregation...');

  try {
    const aggregatedDoc = await admin.firestore()
      .collection('aggregated')
      .doc('popularUsers')
      .get();

    const now = admin.firestore.Timestamp.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000;
    let shouldUpdate = false;

    if (!aggregatedDoc.exists) {
      shouldUpdate = true;
    } else {
      const data = aggregatedDoc.data();
      const lastUpdated = data?.lastUpdated;

      if (!lastUpdated) {
        shouldUpdate = true;
      } else {
        const timeSinceUpdate = now.toMillis() - lastUpdated.toMillis();
        const minutesSinceUpdate = Math.round(timeSinceUpdate / 1000 / 60);
        console.log(`⏰ Last updated ${minutesSinceUpdate} minutes ago`);

        if (timeSinceUpdate > sixHoursInMs) {
          shouldUpdate = true;
        } else {
          return {
            success: true,
            message: `Data is fresh (updated ${minutesSinceUpdate} minutes ago)`,
            skipped: true
          };
        }
      }
    }

    if (!shouldUpdate) {
      return { success: true, message: 'No update needed', skipped: true };
    }

    const usersSnapshot = await admin.firestore()
      .collection('profile')
      .where('isActive', '==', true)
      .orderBy('followersCount', 'desc')
      .limit(50)
      .get();

    if (usersSnapshot.empty) {
      return { success: false, message: 'No users found in database', error: 'NO_USERS' };
    }

    // Profile collection IS the source of truth for avatars, so no hydration needed here
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

// ==================== SCHEDULED: UPDATE POPULAR POSTS ====================
exports.updatePopularPosts = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'America/New_York', memory: '512MB' },
  async (event) => {
    const result = await updatePopularPostsLogic();
    console.log('Scheduled update result:', result);
    return null;
  }
);

// ==================== SCHEDULED: UPDATE POPULAR USERS ====================
exports.updatePopularUsers = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'America/New_York', memory: '512MB' },
  async (event) => {
    const result = await updatePopularUsersLogic();
    console.log('Scheduled update result:', result);
    return null;
  }
);

// ==================== HTTP: MANUAL TRIGGER FOR POPULAR POSTS ====================
exports.triggerPopularPostsUpdate = onRequest(
  { memory: '512MB' },
  async (req, res) => {
    try {
      const result = await updatePopularPostsLogic();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ==================== HTTP: MANUAL TRIGGER FOR POPULAR USERS ====================
exports.triggerPopularUsersUpdate = onRequest(
  { memory: '512MB' },
  async (req, res) => {
    try {
      const result = await updatePopularUsersLogic();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ==================== HTTP: CHECK AGGREGATED DATA STATUS ====================
exports.checkAggregatedStatus = onRequest(
  { memory: '256MB' },
  async (req, res) => {
    try {
      const [postsDoc, usersDoc] = await Promise.all([
        admin.firestore().collection('aggregated').doc('popularPosts').get(),
        admin.firestore().collection('aggregated').doc('popularUsers').get(),
      ]);

      const now = admin.firestore.Timestamp.now().toMillis();

      const getStatus = (doc, docName) => {
        if (!doc.exists) return { exists: false, message: `${docName} does not exist` };
        const data = doc.data();
        const lastUpdated = data?.lastUpdated;
        if (!lastUpdated) return { exists: true, hasTimestamp: false, message: 'No timestamp found', totalItems: data?.totalPosts || data?.totalUsers || 0 };
        const timeSinceUpdate = now - lastUpdated.toMillis();
        return {
          exists: true,
          hasTimestamp: true,
          lastUpdated: lastUpdated.toDate().toISOString(),
          minutesSinceUpdate: Math.round(timeSinceUpdate / 1000 / 60),
          hoursSinceUpdate: parseFloat((timeSinceUpdate / 1000 / 60 / 60).toFixed(2)),
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
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ==================== CALLABLE: GET FOLLOWING POSTS ====================
exports.getFollowingpost = onCall(
  { memory: '512MB' },
  async (request) => {
    if (!request.auth) throw new Error('Must be authenticated');

    const userId = request.auth.uid;
    const { type, lastTimestamp, limit = 50 } = request.data;
    const db = admin.firestore();

    try {
      const followingSnapshot = await db
        .collection('profile').doc(userId).collection('following').get();

      const followingIds = followingSnapshot.docs.map(doc => doc.id);
      if (followingIds.length === 0) return { items: [], hasMore: false };

      const chunks = [];
      for (let i = 0; i < followingIds.length; i += 10) {
        chunks.push(followingIds.slice(i, i + 10));
      }

      const collectionName = type === 'posts' ? 'posts' : 'questions';
      const userField = type === 'posts' ? 'userId' : 'authorId';

      const promises = chunks.map(ids => {
        let query = db.collection(collectionName)
          .where(userField, 'in', ids)
          .orderBy('timestamp', 'desc')
          .limit(limit);
        if (lastTimestamp) {
          query = query.startAfter(
            admin.firestore.Timestamp.fromDate(new Date(lastTimestamp))
          );
        }
        return query.get();
      });

      const snapshots = await Promise.all(promises);

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

      const uniqueItems = Array.from(
        new Map(allItems.map(item => [item.id, item])).values()
      ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Hydrate avatars server-side — client gets fresh avatars for free
      const uniqueUserIds = [...new Set(uniqueItems.map(item => item.userId).filter(Boolean))];
      const profileDocs = await Promise.all(
        uniqueUserIds.map(uid => db.collection('profile').doc(uid).get())
      );

      const avatarMap = {};
      profileDocs.forEach((doc, i) => {
        if (doc.exists) avatarMap[uniqueUserIds[i]] = doc.data()?.avatar || null;
      });

      const enrichedItems = uniqueItems.slice(0, limit).map(item => ({
        ...item,
        userAvatar: avatarMap[item.userId] || item.userAvatar || null,
      }));

      return {
        items: enrichedItems,
        hasMore: uniqueItems.length === limit,
        lastTimestamp: enrichedItems.length > 0
          ? enrichedItems[enrichedItems.length - 1].timestamp
          : null
      };
    } catch (error) {
      console.error('Error fetching following feed:', error);
      throw new Error('Error fetching feed');
    }
  }
);