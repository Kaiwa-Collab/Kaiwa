const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// ==================== SINGLE USERNAME CHECK ====================
exports.checkUsernameAvailability = onCall(async (request) => {
  const { username } = request.data || {};

  if (!username) {
    throw new HttpsError('invalid-argument', 'Username is required');
  }

  if (!USERNAME_REGEX.test(username)) {
    throw new HttpsError(
      'invalid-argument',
      'Username must be 3–20 characters and contain only letters, numbers, and underscores'
    );
  }

  const usernameLower = username.toLowerCase();

  try {
    const snap = await admin.firestore()
      .collection('profile')
      .where('usernameLower', '==', usernameLower)
      .limit(1)
      .get();

    let available = snap.empty;

    if (!available && request.auth?.uid) {
      available = snap.docs[0].id === request.auth.uid;
    }

    return {
      available,
      username,
      message: available
        ? `Username "${username}" is available`
        : `Username "${username}" is already taken`,
    };
  } catch (err) {
    console.error(err);
    throw new HttpsError('internal', 'Failed to check username');
  }
});

// ==================== MULTIPLE USERNAME CHECK ====================
exports.checkMultipleUsernames = onCall(async (request) => {
  const { usernames } = request.data || {};

  if (!Array.isArray(usernames) || usernames.length === 0) {
    throw new HttpsError('invalid-argument', 'Usernames array required');
  }

  if (usernames.length > 10) {
    throw new HttpsError('invalid-argument', 'Max 10 usernames allowed');
  }

  try {
    const results = await Promise.all(
      usernames.map(async (username) => {
        const snap = await admin.firestore()
          .collection('profile')
          .where('usernameLower', '==', username.toLowerCase())
          .limit(1)
          .get();

        return { username, available: snap.empty };
      })
    );

    return {
      results,
      availableCount: results.filter(r => r.available).length,
    };
  } catch (err) {
    console.error(err);
    throw new HttpsError('internal', 'Failed to check usernames');
  }
});

// ==================== USERNAME SUGGESTIONS ====================
exports.suggestUsernames = onCall(async (request) => {
  const { baseName } = request.data || {};

  if (!baseName) {
    throw new HttpsError('invalid-argument', 'Base name required');
  }

  const cleanBase = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 15);

  if (cleanBase.length < 3) {
    throw new HttpsError('invalid-argument', 'Base name too short');
  }

  const candidates = [
    cleanBase,
    `${cleanBase}_dev`,
    `${cleanBase}_code`,
    `${cleanBase}${Math.floor(Math.random() * 100)}`,
    `${cleanBase}${new Date().getFullYear()}`,
  ];

  try {
    const results = await Promise.all(
      candidates.map(async (u) => {
        const snap = await admin.firestore()
          .collection('profile')
          .where('usernameLower', '==', u)
          .limit(1)
          .get();

        return snap.empty ? u : null;
      })
    );

    return {
      suggestions: results.filter(Boolean).slice(0, 5),
    };
  } catch (err) {
    console.error(err);
    throw new HttpsError('internal', 'Failed to generate suggestions');
  }
});

exports.getUserProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const userId = request.data?.userId || request.auth.uid;
  const db = admin.firestore();

  try {
    // Fetch profile, posts, and following in parallel
    const [profileDoc, postsSnapshot, followingSnapshot] = await Promise.all([
      db.collection('profile').doc(userId).get(),
      db.collection('posts').where('userId', '==', userId).get(),
      db.collection('profile').doc(userId).collection('following').get(),
    ]);

    return {
      profile: profileDoc.exists ? profileDoc.data() : null,
      posts: postsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })),
      followingIds: followingSnapshot.docs.map(doc => doc.id),
      followingCount: followingSnapshot.size,
    };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw new HttpsError('internal', 'Error fetching profile');
  }
});
