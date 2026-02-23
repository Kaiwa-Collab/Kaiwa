/**
 * Search Cloud Functions
 * Search page: users, projects, suggestions, follow-requests count (v2 callables).
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Search users (for Search page). Profile by username/name; excludes current user.
 * Requires Firestore index on profile: username (ascending).
 */
exports.searchPageUsers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const query = (data.query || '').trim().toLowerCase();
  const limit = Math.min(Number(data.limit) || 20, 50);

  if (query.length < 3) {
    return { users: [], query };
  }

  try {
    let snapshot = await db
      .collection('profile')
      .orderBy('username')
      .startAt(query)
      .endAt(query + '\uf8ff')
      .limit(limit)
      .get();

    let users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (users.length === 0) {
      snapshot = await db.collection('profile').limit(100).get();
      users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      users = users.filter(u => {
        const username = (u.username || '').toLowerCase();
        const name = (u.name || '').toLowerCase();
        return username.includes(query) || name.includes(query);
      });
    }

    users = users.filter(u => u.id !== uid);
    return { users, query };
  } catch (error) {
    console.error('searchPageUsers:', error);
    throw new HttpsError('internal', 'Could not search users.');
  }
});

/**
 * Search collaboration projects by title/description.
 * Requires Firestore index on collaborations: title (ascending).
 */
exports.searchProjects = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const data = request.data || {};
  const query = (data.query || '').trim().toLowerCase();
  const limit = Math.min(Number(data.limit) || 20, 50);

  if (query.length < 3) {
    return { projects: [], query };
  }

  try {
    let snapshot = await db
      .collection('collaborations')
      .orderBy('title')
      .startAt(query)
      .endAt(query + '\uf8ff')
      .limit(limit)
      .get();

    let projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (projects.length === 0) {
      snapshot = await db.collection('collaborations').limit(100).get();
      projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      projects = projects.filter(p => {
        const title = (p.title || '').toLowerCase();
        const description = (p.description || p.about || '').toLowerCase();
        return title.includes(query) || description.includes(query);
      });
    }

    return { projects, query };
  } catch (error) {
    console.error('searchProjects:', error);
    throw new HttpsError('internal', 'Could not search projects.');
  }
});

/**
 * Get follow requests count for current user.
 */
exports.getFollowRequestsCount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  try {
    const snapshot = await db
      .collection('profile')
      .doc(uid)
      .collection('followRequests')
      .get();
    return { count: snapshot.size };
  } catch (error) {
    console.error('getFollowRequestsCount:', error);
    throw new HttpsError('internal', 'Could not get follow requests count.');
  }
});

/**
 * Get search suggestions (recently searched users) for current user.
 */
exports.getSearchSuggestions = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const limit = Math.min(Number(data.limit) || 20, 50);
  try {
    const snapshot = await db
      .collection('profile')
      .doc(uid)
      .collection('searchSuggestions')
      .orderBy('lastUsedAt', 'desc')
      .limit(limit)
      .get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return { suggestions: list };
  } catch (error) {
    console.error('getSearchSuggestions:', error);
    throw new HttpsError('internal', 'Could not get search suggestions.');
  }
});

/**
 * Get project suggestions (recently viewed projects) for current user.
 */
exports.getProjectSuggestions = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const limit = Math.min(Number(data.limit) || 20, 50);
  try {
    const snapshot = await db
      .collection('profile')
      .doc(uid)
      .collection('projectSuggestions')
      .orderBy('lastUsedAt', 'desc')
      .limit(limit)
      .get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return { suggestions: list };
  } catch (error) {
    console.error('getProjectSuggestions:', error);
    throw new HttpsError('internal', 'Could not get project suggestions.');
  }
});

/**
 * Save a user to current user's search suggestions.
 */
exports.saveSearchSuggestion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const userId = data.userId;
  const userData = data.userData || {};

  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    await db
      .collection('profile')
      .doc(uid)
      .collection('searchSuggestions')
      .doc(userId)
      .set(
        {
          username: userData.username || userData.name || '',
          name: userData.name || '',
          avatar: userData.avatar || userData.photoURL || null,
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return { success: true };
  } catch (error) {
    console.error('saveSearchSuggestion:', error);
    throw new HttpsError('internal', 'Could not save suggestion.');
  }
});

/**
 * Save a project to current user's project suggestions.
 */
exports.saveProjectSuggestion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const projectId = data.projectId;
  const projectData = data.projectData || {};

  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required');
  }

  try {
    await db
      .collection('profile')
      .doc(uid)
      .collection('projectSuggestions')
      .doc(projectId)
      .set(
        {
          title: projectData.title || '',
          description: projectData.description || projectData.about || '',
          image: projectData.image || null,
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return { success: true };
  } catch (error) {
    console.error('saveProjectSuggestion:', error);
    throw new HttpsError('internal', 'Could not save project suggestion.');
  }
});

/**
 * Remove a user from current user's search suggestions.
 */
exports.removeSearchSuggestion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const userId = data.userId;
  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }
  try {
    await db
      .collection('profile')
      .doc(uid)
      .collection('searchSuggestions')
      .doc(userId)
      .delete();
    return { success: true };
  } catch (error) {
    console.error('removeSearchSuggestion:', error);
    throw new HttpsError('internal', 'Could not remove suggestion.');
  }
});

/**
 * Remove a project from current user's project suggestions.
 */
exports.removeProjectSuggestion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const projectId = data.projectId;
  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required');
  }
  try {
    await db
      .collection('profile')
      .doc(uid)
      .collection('projectSuggestions')
      .doc(projectId)
      .delete();
    return { success: true };
  } catch (error) {
    console.error('removeProjectSuggestion:', error);
    throw new HttpsError('internal', 'Could not remove project suggestion.');
  }
});
