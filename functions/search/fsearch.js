/**
 * Search Cloud Functions
 * Search page: users, projects, suggestions, follow-requests count (v2 callables).
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const axios = require('axios');

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
    // ✅ Count all unread notifications, not just follow requests
    const snapshot = await db
      .collection('notifications')
      .where('recipientUid', '==', uid)
      .where('read', '==', false)
      .get();
    return { count: snapshot.size };
  } catch (error) {
    console.error('getFollowRequestsCount:', error);
    throw new HttpsError('internal', 'Could not get notifications count.');
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

// In your Cloud Functions index.js
exports.sendProjectJoinRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const { projectId } = request.data || {};

  if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required');

  const projectRef = db.collection('collaborations').doc(projectId);
  const projectSnap = await projectRef.get();

  if (!projectSnap.exists) throw new HttpsError('not-found', 'Project not found');

  const project = projectSnap.data();
  const creatorId = project.creatorId;

  // Prevent creator from applying to their own project
  if (creatorId === uid) {
    throw new HttpsError('failed-precondition', 'You are the creator of this project');
  }

  // Prevent duplicate requests
  const existingReq = await db
    .collection('collaborations')
    .doc(projectId)
    .collection('joinRequests')
    .doc(uid)
    .get();

  if (existingReq.exists) {
    throw new HttpsError('failed-precondition', 'already-requested');
  }

  // Check if already a collaborator
  if ((project.collaborators || []).includes(uid)) {
    throw new HttpsError('failed-precondition', 'already-collaborator');
  }

  const userSnap = await db.collection('users').doc(uid).get();
const githubUsername = userSnap.data()?.githubUsername;

if (!githubUsername) {
  throw new HttpsError(
    'failed-precondition',
    'github-not-connected'
  );
}

  // Get applicant profile
  const profileSnap = await db.collection('profile').doc(uid).get();
  const profile = profileSnap.data() || {};

  // Save join request under the project
  await db
    .collection('collaborations')
    .doc(projectId)
    .collection('joinRequests')
    .doc(uid)
    .set({
      userId: uid,
      username: profile.username || '',
      avatar: profile.avatar || '',
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });

  // Notify the project creator
 await db.collection('notifications').add({
  recipientUid: creatorId,        
  type: 'project_join_request',
  fromUserId: uid,
  fromUsername: profile.username || '',
  fromAvatar: profile.avatar || '',
  projectId,
  projectTitle: project.title || '',
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  read: false,
});

  return { success: true };
});

exports.acceptProjectJoinRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { notificationId, projectId, applicantId } = request.data || {};

  if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required');
  if (!applicantId) throw new HttpsError('invalid-argument', 'applicantId is required');

  // Step 1: Get project data
  const projectRef = db.collection('collaborations').doc(projectId);
  const projectSnap = await projectRef.get();

  if (!projectSnap.exists) throw new HttpsError('not-found', 'Project not found');

  const project = projectSnap.data();

  if (project.creatorId !== uid) {
    throw new HttpsError('permission-denied', 'Only the project creator can accept join requests');
  }

  const chatId = project.chatId;
  if (!chatId) throw new HttpsError('not-found', 'Project chat not found');

  // Step 2: Get applicant user + profile data
  const userSnap = await db.collection('users').doc(applicantId).get();
  const profileSnap = await db.collection('profile').doc(applicantId).get();

  if (!userSnap.exists) throw new HttpsError('not-found', 'Applicant user not found');

  const userData = userSnap.data();
  const profileData = profileSnap.exists ? profileSnap.data() : {};

  // Step 3: Add applicant to project collaborators
  await projectRef.update({
    collaborators: admin.firestore.FieldValue.arrayUnion(applicantId),
    pendingGitHubAcceptance: admin.firestore.FieldValue.arrayUnion(applicantId),
  });

  // Step 4: Add applicant to group chat
  const chatRef = db.collection('chats').doc(chatId);
  await chatRef.update({
    participants: admin.firestore.FieldValue.arrayUnion(applicantId),
    [`participantsInfo.${applicantId}`]: {
      id: applicantId,
      name: userData.username || 'User',
      avatar: profileData.avatar || null,
      username: userData.username || '',
      role: 'member',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Step 5: Update join request status
  await db
    .collection('collaborations')
    .doc(projectId)
    .collection('joinRequests')
    .doc(applicantId)
    .update({ status: 'accepted' });

  // Step 6: Send GitHub repo invitation if both parties have GitHub connected
 // Step 6: Send GitHub repo invitation using same logic as addGitHubCollaborator
  const applicantGithubUsername = userData?.githubUsername;
  const creatorUserSnap = await db.collection('users').doc(project.creatorId).get();
  const creatorData = creatorUserSnap.data();
  const creatorGithubToken = creatorData?.githubAccessToken;

  console.log('🔍 GitHub invite check:', {
    applicantGithubUsername,
    hasCreatorToken: !!creatorGithubToken,
    githubRepo: project.githubRepo,
  });

  if (!applicantGithubUsername) {
    console.warn('⚠️ Applicant has no githubUsername — skipping GitHub invite');
  } else if (!creatorGithubToken) {
    console.warn('⚠️ Creator has no githubAccessToken — skipping GitHub invite');
  } else if (!project.githubRepo) {
    console.warn('⚠️ Project has no githubRepo — skipping GitHub invite');
  } else {
    const repoMatch = project.githubRepo.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
    if (!repoMatch) {
      console.error('❌ Could not parse GitHub repo URL:', project.githubRepo);
    } else {
      const owner = repoMatch[1];
      const repo = repoMatch[2].replace(/\.git$/, '').trim();

      console.log(`📨 Sending GitHub invite to @${applicantGithubUsername} for ${owner}/${repo}`);

      try {
        const ghResponse = await axios.put(
          `https://api.github.com/repos/${owner}/${repo}/collaborators/${applicantGithubUsername}`,
          { permission: 'push' },
          {
            headers: {
              Authorization: `Bearer ${creatorGithubToken}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'YourAppName',
            },
          }
        );

        if (ghResponse.status === 201) {
          console.log(`✅ GitHub invitation email sent to @${applicantGithubUsername}`);
        } else if (ghResponse.status === 204) {
          console.log(`ℹ️ @${applicantGithubUsername} is already a collaborator`);
        }
      } catch (githubError) {
        const status = githubError.response?.status;
        const msg = githubError.response?.data?.message || githubError.message;

        if (status === 422) {
          console.log(`ℹ️ @${applicantGithubUsername} already a collaborator (422)`);
        } else if (status === 401) {
          console.error('❌ Creator GitHub token invalid/expired — needs to reconnect GitHub');
        } else if (status === 403) {
          console.error('❌ Creator token lacks repo scope — needs "repo" OAuth scope');
        } else if (status === 404) {
          console.error(`❌ Repo not found or inaccessible: ${project.githubRepo}`);
        } else {
          console.error(`❌ GitHub invite failed (${status}): ${msg}`);
        }
        // Don't throw — user is already added to chat/project, GitHub invite is best-effort
      }
    }
  }
  // Step 7: Delete the notification
  if (notificationId) {
    await db.collection('notifications').doc(notificationId).delete();
  }

  // Step 8: Notify the applicant
  // Step 8: Notify the applicant
 await db.collection('notifications').add({
  recipientUid: applicantId,
  type: 'join_request_accepted',
  data: {
    message: `✅ Your request to join "${project.title}" was accepted!\n\n📧 Check your GitHub email (${applicantGithubUsername ? '@' + applicantGithubUsername : 'your GitHub account'}) and accept the repository invitation to start contributing.`,
    projectId,
    projectTitle: project.title,
    chatId,
    githubUsername: applicantGithubUsername || null,
    requiresGitHubAcceptance: true,
  },
  read: false,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
  
  // Step 9: Post system message in chat
  await db
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .add({
      text: `🎉 ${userData.username || 'A new member'} has joined the project!`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      senderId: 'system',
      isSystemMessage: true,
      type: 'member_joined',
    });

  return { success: true };
});


exports.rejectProjectJoinRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { notificationId, projectId, applicantId, projectTitle } = request.data || {};

  if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required');
  if (!applicantId) throw new HttpsError('invalid-argument', 'applicantId is required');

  // Verify requester is the project creator
  const projectSnap = await db.collection('collaborations').doc(projectId).get();
  if (!projectSnap.exists) throw new HttpsError('not-found', 'Project not found');
  if (projectSnap.data().creatorId !== uid) {
    throw new HttpsError('permission-denied', 'Only the project creator can reject join requests');
  }

  // Update join request status
  await db
    .collection('collaborations')
    .doc(projectId)
    .collection('joinRequests')
    .doc(applicantId)
    .update({ status: 'rejected' });

  // Delete the notification
  if (notificationId) {
    await db.collection('notifications').doc(notificationId).delete();
  }

  // Notify the applicant
  await db.collection('notifications').add({
    recipientUid: applicantId,
    type: 'join_request_rejected',
    data: {
      message: `Your request to join "${projectTitle || projectSnap.data().title}" was declined.`,
      projectId,
      projectTitle: projectTitle || projectSnap.data().title,
    },
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
