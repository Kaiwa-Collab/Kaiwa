/**
 * Profile Cloud Functions
 * High, medium, and low priority profile-related operations (v2 callables).
 * Use request.auth and request.data; no context.auth.
 */

const { onCall,onRequest,HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');



if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------- Helpers ----------
async function ensureProfileExists(userId) {
  const profileRef = db.collection('profile').doc(userId);
  const profileDoc = await profileRef.get();
  if (!profileDoc.exists) {
    const initialProfile = {
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      questionsCount: 0,
      answersCount: 0,
      avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
      bio: '',
      location: '',
      website: '',
      joinedDate: new Date().toLocaleDateString(),
      isPrivate: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await profileRef.set(initialProfile);
    return initialProfile;
  }
  return profileDoc.data();
}

// ---------- HIGH PRIORITY ----------

/**
 * Send follow request to a user.
 * Prevents duplicate requests; creates notification server-side.
 */
exports.sendFollowRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const targetUserId = data.targetUserId;
  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new HttpsError('invalid-argument', 'targetUserId is required');
  }
  if (targetUserId === uid) {
    throw new HttpsError('invalid-argument', 'Cannot follow yourself');
  }

  try {
    await ensureProfileExists(uid);
    await ensureProfileExists(targetUserId);

    const currentUserDoc = await db.collection('users').doc(uid).get();
    const currentUsername = currentUserDoc.exists ? (currentUserDoc.data()?.username || 'User') : 'User';

    const alreadyRequestedSnap = await db
      .collection('profile')
      .doc(targetUserId)
      .collection('followRequests')
      .where('from', '==', uid)
      .limit(1)
      .get();

    if (!alreadyRequestedSnap.empty) {
      throw new HttpsError('failed-precondition', 'You have already sent a follow request.');
    }

    const followingDoc = await db.collection('profile').doc(uid).collection('following').doc(targetUserId).get();
    if (followingDoc.exists) {
      throw new HttpsError('failed-precondition', 'Already following this user.');
    }

    await db
      .collection('profile')
      .doc(targetUserId)
      .collection('followRequests')
      .add({
        from: uid,
        fromUsername: currentUsername,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    await db.collection('notifications').add({
      recipientUid: targetUserId,
      senderUid: uid,
      type: 'follow_request',
      data: { message: 'sent you a follow request', senderUsername: currentUsername },
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, message: 'Follow request sent.' };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('sendFollowRequest:', error);
    throw new HttpsError('internal', 'Could not send follow request.');
  }
});

/**
 * Unfollow a user. Updates followers/following and counts.
 */
exports.unfollow = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const targetUserId = data.targetUserId;
  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new HttpsError('invalid-argument', 'targetUserId is required');
  }
  if (targetUserId === uid) {
    throw new HttpsError('invalid-argument', 'Cannot unfollow yourself');
  }

  try {
    await ensureProfileExists(uid);
    await ensureProfileExists(targetUserId);

    const batch = db.batch();
    const followerRef = db.collection('profile').doc(targetUserId).collection('followers').doc(uid);
    const followingRef = db.collection('profile').doc(uid).collection('following').doc(targetUserId);
    batch.delete(followerRef);
    batch.delete(followingRef);
    batch.update(db.collection('profile').doc(targetUserId), {
      followersCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(db.collection('profile').doc(uid), {
      followingCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { success: true, message: 'Unfollowed.' };
  } catch (error) {
    console.error('unfollow:', error);
    throw new HttpsError('internal', 'Failed to unfollow user.');
  }
});

/**
 * Create collaboration project. Client must call createGroupChat first and pass chatId.
 * Server creates project doc and sends notifications. No GitHub token on client.
 */
exports.createCollaboration = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const { projectTitle, about, tech, githubRepo, selectedCollaborators = [], chatId, creatorUsername } = data;

  if (!projectTitle || !projectTitle.trim()) {
    throw new HttpsError('invalid-argument', 'Project title is required');
  }
  if (!about || !about.trim()) {
    throw new HttpsError('invalid-argument', 'Project description is required');
  }
  if (!githubRepo || !githubRepo.trim()) {
    throw new HttpsError('invalid-argument', 'GitHub repository URL is required');
  }
  if (!chatId || typeof chatId !== 'string') {
    throw new HttpsError('invalid-argument', 'chatId is required (call createGroupChat first)');
  }
  if (!Array.isArray(selectedCollaborators)) {
    throw new HttpsError('invalid-argument', 'selectedCollaborators must be an array');
  }

  const displayName = creatorUsername || (request.auth.token?.name) || 'User';

  try {
    const projectRef = db.collection('collaborations').doc();
    const projectId = projectRef.id;

    const projectData = {
      id: projectId,
      title: projectTitle.trim(),
      about: about.trim(),
      tech: (tech || '').trim(),
      githubRepo: githubRepo.trim(),
      creatorId: uid,
      creatorUsername: displayName,
      collaborators: [uid],
      pendingInvites: selectedCollaborators,
      pendingGitHubAcceptance: [],
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      chatId,
    };

    await projectRef.set(projectData);

    const notificationPromises = selectedCollaborators.map((userId) =>
      db.collection('notifications').add({
        recipientUid: userId,
        senderUid: uid,
        type: 'collaboration_invite',
        data: {
          message: `invited you to collaborate on "${projectTitle.trim()}"`,
          senderUsername: displayName,
          projectId,
          projectTitle: projectTitle.trim(),
          chatId,
        },
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    await Promise.all(notificationPromises);

    return { success: true, projectId, ...projectData };
  } catch (error) {
    console.error('createCollaboration:', error);
    throw new HttpsError('internal', 'Failed to create collaboration project.');
  }
});

/**
 * Update collaboration project. Caller must be creator or collaborator.
 */
exports.updateCollaboration = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const { projectId, title, about, tech, githubRepo } = data;

  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required');
  }
  if (!title || !title.trim()) {
    throw new HttpsError('invalid-argument', 'Title is required');
  }
  if (!about || !about.trim()) {
    throw new HttpsError('invalid-argument', 'Description is required');
  }

  try {
    const projectRef = db.collection('collaborations').doc(projectId);
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }
    const project = projectDoc.data();
    const isCreator = project.creatorId === uid;
    const isCollaborator = Array.isArray(project.collaborators) && project.collaborators.includes(uid);
    if (!isCreator && !isCollaborator) {
      throw new HttpsError('permission-denied', 'Only creator or collaborators can update this project');
    }

    await projectRef.update({
      title: title.trim(),
      about: about.trim(),
      name: title.trim(),           // ← add this
      displayName: title.trim(),
      tech: (tech || '').trim(),
      githubRepo: (githubRepo || '').trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

   
    // ✅ NEW: Update the group chat title so First.jsx shows the new name
    if (project.chatId) {
      await db.collection('chats').doc(project.chatId).update({
        title: title.trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ✅ NEW: Update aggregated doc for all collaborators so drawer reflects new name instantly
      const collaborators = project.collaborators || [];
      const aggUpdates = collaborators.map(async (userId) => {
        const aggRef = db.collection('aggregated').doc(`conversations_${userId}`);
        const aggDoc = await aggRef.get();
        if (!aggDoc.exists) return;

        const data = aggDoc.data() || {};
        const conversations = Array.isArray(data.conversations) ? data.conversations : [];
        let changed = false;

        const updatedConversations = conversations.map((conv) => {
  if (!conv) return conv;
  
  const matchesChat =
    conv.id === project.chatId ||
    conv.conversationId === project.chatId;

  if (!matchesChat) return conv;  // ← skip non-matching convs

  changed = true;
  return { ...conv, title: title.trim(), name: title.trim(), displayName: title.trim() };
});

        if (changed) {
          await aggRef.update({
            conversations: updatedConversations,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });

      await Promise.all(aggUpdates);
    }

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('updateCollaboration:', error);
    throw new HttpsError('internal', 'Failed to update project.');
  }
});

/**
 * Delete collaboration project. Only creator can delete.
 */
exports.deleteCollaboration = onCall(async (request) => {
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
    const projectRef = db.collection('collaborations').doc(projectId);
    const projectDoc = await projectRef.get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }
    if (projectDoc.data().creatorId !== uid) {
      throw new HttpsError('permission-denied', 'Only the creator can delete this project');
    }

    await projectRef.delete();
    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('deleteCollaboration:', error);
    throw new HttpsError('internal', 'Could not delete project.');
  }
});

/**
 * Delete a question. Verifies authorId is current user; runs delete + profile count in transaction.
 */
exports.deleteQuestion = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const questionId = data.questionId;

  if (!questionId) {
    throw new HttpsError('invalid-argument', 'questionId is required');
  }

  try {
    await db.runTransaction(async (transaction) => {
      const questionRef = db.collection('questions').doc(questionId);
      const profileRef = db.collection('profile').doc(uid);
      const questionDoc = await transaction.get(questionRef);
      if (!questionDoc.exists) {
        throw new HttpsError('not-found', 'Question not found');
      }
      if (questionDoc.data().authorId !== uid) {
        throw new HttpsError('permission-denied', 'You can only delete your own questions');
      }
      transaction.delete(questionRef);
      const profileDoc = await transaction.get(profileRef);
      if (profileDoc.exists) {
        transaction.update(profileRef, {
          questionsCount: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('deleteQuestion:', error);
    throw new HttpsError('internal', 'Could not delete question.');
  }
});

/**
 * Create a notification (server-side only; prevents spoofing sender).
 */
exports.createNotification = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const { recipientUid, type, notificationData } = data;

  if (!recipientUid || !type) {
    throw new HttpsError('invalid-argument', 'recipientUid and type are required');
  }

  try {
    await db.collection('notifications').add({
      recipientUid,
      senderUid: uid,
      type,
      data: notificationData || {},
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error('createNotification:', error);
    throw new HttpsError('internal', 'Failed to create notification.');
  }
});

// ---------- MEDIUM PRIORITY ----------

/**
 * Get profile + user data for a user (combined; optional privacy for private accounts).
 */
exports.getProfileData = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const viewerUid = request.auth.uid;
  const data = request.data || {};
  const userId = data.userId;

  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    const [userDoc, profileDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('profile').doc(userId).get(),
    ]);

    const userData = userDoc.exists ? userDoc.data() : null;
    const profileData = profileDoc.exists ? profileDoc.data() : null;

    if (!userData && userId === viewerUid) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    const isPrivate = profileData?.isPrivate === true;
    const isOwnProfile = userId === viewerUid;
    const followingDoc = await db.collection('profile').doc(viewerUid).collection('following').doc(userId).get();
    const isFollowing = followingDoc.exists;

    const canViewContent = isOwnProfile || isFollowing || !isPrivate;

    return {
      userData: userData || null,
      profileData: profileData || null,
      canViewContent,
      isOwnProfile,
      isFollowing,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('getProfileData:', error);
    throw new HttpsError('internal', 'Failed to load profile data.');
  }
});

/**
 * Get user's questions (paginated).
 */
exports.getUserQuestions = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const data = request.data || {};
  const userId = data.userId;
  const limit = Math.min(Number(data.limit) || 20, 50);
  const lastDocId = data.lastDocId;

  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    let query = db
      .collection('questions')
      .where('authorId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (lastDocId) {
      const lastDoc = await db.collection('questions').doc(lastDocId).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }

    const snapshot = await query.get();
    const questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const hasMore = snapshot.docs.length === limit;

    return { questions, hasMore };
  } catch (error) {
    console.error('getUserQuestions:', error);
    throw new HttpsError('internal', 'Failed to fetch questions.');
  }
});

/**
 * Get user's posts (paginated).
 * Mirrors getUserQuestions but for the "posts" collection.
 */
exports.getUserPosts = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const data = request.data || {};
  const userId = data.userId;
  const limit = Math.min(Number(data.limit) || 20, 60);
  const lastDocId = data.lastDocId;

  if (!userId || typeof userId !== 'string') {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    let query = db
      .collection('posts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (lastDocId) {
      const lastDoc = await db.collection('posts').doc(lastDocId).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }

    const snapshot = await query.get();
    const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const hasMore = snapshot.docs.length === limit;

    return { posts, hasMore };
  } catch (error) {
    console.error('getUserPosts:', error);
    throw new HttpsError('internal', 'Failed to fetch posts.');
  }
});

/**
 * Get collaboration projects for a user (creator + collaborator).
 */
exports.getUserCollaborationProjects = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const data = request.data || {};
  const userId = data.userId;

  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    const [creatorSnap, collaboratorSnap] = await Promise.all([
      db.collection('collaborations').where('creatorId', '==', userId).get(),
      db.collection('collaborations').where('collaborators', 'array-contains', userId).get(),
    ]);

    const map = new Map();
    creatorSnap.docs.forEach((doc) => map.set(doc.id, { id: doc.id, ...doc.data() }));
    collaboratorSnap.docs.forEach((doc) => {
      if (!map.has(doc.id)) map.set(doc.id, { id: doc.id, ...doc.data() });
    });
    const projects = Array.from(map.values());
    projects.sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;
      return dateB - dateA;
    });

    return { projects };
  } catch (error) {
    console.error('getUserCollaborationProjects:', error);
    throw new HttpsError('internal', 'Failed to load projects.');
  }
});

/**
 * Get following users with basic user/profile fields (avoids N+1 on client).
 */
exports.getFollowingUsers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const limit = Math.min(Number(data.limit) || 100, 200);

  try {
    const followingSnap = await db
      .collection('profile')
      .doc(uid)
      .collection('following')
      .limit(limit)
      .get();

    const userIds = followingSnap.docs.map((doc) => doc.id);
    if (userIds.length === 0) {
      return { users: [] };
    }

    const users = await Promise.all(
      userIds.map(async (id) => {
        const [userDoc, profileDoc] = await Promise.all([
          db.collection('users').doc(id).get(),
          db.collection('profile').doc(id).get(),
        ]);
        if (!userDoc.exists) return null;
        return {
          id,
          username: userDoc.data()?.username || 'User',
          email: userDoc.data()?.email || '',
          avatar: profileDoc.exists ? profileDoc.data()?.avatar : 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
        };
      })
    );

    return { users: users.filter(Boolean) };
  } catch (error) {
    console.error('getFollowingUsers:', error);
    throw new HttpsError('internal', 'Failed to fetch following users.');
  }
});

/**
 * Get project participants (avoids N+1 on client).
 */
exports.getProjectParticipants = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const data = request.data || {};
  const projectId = data.projectId;

  if (!projectId) {
    throw new HttpsError('invalid-argument', 'projectId is required');
  }

  try {
    const projectDoc = await db.collection('collaborations').doc(projectId).get();
    if (!projectDoc.exists) {
      throw new HttpsError('not-found', 'Project not found');
    }
    const collaborators = projectDoc.data().collaborators || [];
    const creatorId = projectDoc.data().creatorId;

    if (collaborators.length === 0) {
      return { participants: [] };
    }

    const participants = await Promise.all(
      collaborators.map(async (userId) => {
        const [userDoc, profileDoc] = await Promise.all([
          db.collection('users').doc(userId).get(),
          db.collection('profile').doc(userId).get(),
        ]);
        if (!userDoc.exists) return null;
        return {
          id: userId,
          username: userDoc.data()?.username || 'User',
          email: userDoc.data()?.email || '',
          avatar: profileDoc.exists ? profileDoc.data()?.avatar : 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
          isCreator: userId === creatorId,
        };
      })
    );

    return { participants: participants.filter(Boolean) };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('getProjectParticipants:', error);
    throw new HttpsError('internal', 'Failed to fetch participants.');
  }
});

/**
 * Ensure profile document exists for a user (server-only profile creation).
 */
exports.ensureProfileExists = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const data = request.data || {};
  const userId = data.userId || request.auth.uid;

  try {
    const profile = await ensureProfileExists(userId);
    return { success: true, profile };
  } catch (error) {
    console.error('ensureProfileExists:', error);
    throw new HttpsError('internal', 'Failed to ensure profile exists.');
  }
});

// ---------- LOW PRIORITY ----------

/**
 * Create post (client uploads image and passes imageUrl). Server creates post doc and updates postsCount.
 */
exports.createPost = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const { imageUrl, caption, username, userAvatar } = data;

  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new HttpsError('invalid-argument', 'imageUrl is required');
  }

  try {
    await ensureProfileExists(uid);

    const postData = {
      userId: uid,
      username: username || 'User',
      userAvatar: userAvatar || 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
      imageUrl,
      caption: caption || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      likes: 0,
      likedBy: [],
    };

    const postRef = await db.collection('posts').add(postData);
    await db.collection('profile').doc(uid).update({
      postsCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, postId: postRef.id };
  } catch (error) {
    console.error('createPost:', error);
    throw new HttpsError('internal', 'Failed to create post.');
  }
});

/**
 * Update profile avatar URL (client uploads image, then calls this with downloadUrl).
 */
exports.updateAvatar = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const avatarUrl = data.avatarUrl;

  if (!avatarUrl || typeof avatarUrl !== 'string') {
    throw new HttpsError('invalid-argument', 'avatarUrl is required');
  }

  try {
    await db.collection('profile').doc(uid).update({
      avatar: avatarUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error('updateAvatar:', error);
    throw new HttpsError('internal', 'Failed to update avatar.');
  }
});

/**
 * Check if current user is following target user.
 */
exports.isFollowing = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const targetUserId = data.targetUserId;

  if (!targetUserId) {
    throw new HttpsError('invalid-argument', 'targetUserId is required');
  }

  try {
    const doc = await db
      .collection('profile')
      .doc(uid)
      .collection('following')
      .doc(targetUserId)
      .get();
    return { isFollowing: doc.exists };
  } catch (error) {
    console.error('isFollowing:', error);
    throw new HttpsError('internal', 'Failed to check follow status.');
  }
});

exports.onProfileAvatarUpdate = onDocumentUpdated('profile/{userId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  if (!after || before?.avatar === after?.avatar) return;

  const userId = event.params.userId;
  const newAvatar = after.avatar || null;
  const firestore = admin.firestore();

  console.log(`[onProfileAvatarUpdate] Avatar changed for: ${userId}`);

  // 1) Read all chats where this user participates (single query).
  const chatsSnap = await firestore
    .collection('chats')
    .where('participants', 'array-contains', userId)
    .get();

  if (chatsSnap.empty) {
    console.log('[onProfileAvatarUpdate] No chats found for user');
    return;
  }

  const chatUpdates = [];
  const affectedUsersToChatIds = new Map();

  for (const chatDoc of chatsSnap.docs) {
    const chatData = chatDoc.data() || {};
    const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
    const currentAvatar = chatData.participantsInfo?.[userId]?.avatar || null;

    // Keep source chat participant cache in sync, but skip no-op writes.
    if (currentAvatar !== newAvatar) {
      chatUpdates.push({
        ref: chatDoc.ref,
        data: { [`participantsInfo.${userId}.avatar`]: newAvatar },
      });
    }

    // Track which users' aggregated docs may contain this direct chat row.
    for (const participantId of participants) {
      if (!participantId || participantId === userId) continue;
      if (!affectedUsersToChatIds.has(participantId)) {
        affectedUsersToChatIds.set(participantId, new Set());
      }
      affectedUsersToChatIds.get(participantId).add(chatDoc.id);
    }
  }

  // Helper: commit in chunks to stay under Firestore batch limits.
  const commitUpdates = async (updates) => {
    const chunkSize = 450;
    let commits = 0;

    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const batch = firestore.batch();
      for (const op of chunk) {
        batch.update(op.ref, op.data);
      }
      await batch.commit();
      commits += 1;
    }
    return commits;
  };

  const chatCommitCount = chatUpdates.length > 0 ? await commitUpdates(chatUpdates) : 0;

  // 2) Read each affected aggregated doc once, update only changed rows.
  const affectedEntries = Array.from(affectedUsersToChatIds.entries());
  const aggUpdates = [];
  const readChunkSize = 200;

  for (let i = 0; i < affectedEntries.length; i += readChunkSize) {
    const chunk = affectedEntries.slice(i, i + readChunkSize);
    const refs = chunk.map(([otherUserId]) =>
      firestore.collection('aggregated').doc(`conversations_${otherUserId}`)
    );

    const docs = refs.length > 0 ? await firestore.getAll(...refs) : [];

    for (let j = 0; j < chunk.length; j += 1) {
      const [, chatIds] = chunk[j];
      const aggDoc = docs[j];
      if (!aggDoc?.exists) continue;

      const data = aggDoc.data() || {};
      const conversations = Array.isArray(data.conversations) ? data.conversations : [];
      let changed = false;

      const updatedConversations = conversations.map((conv) => {
        if (!conv || conv.type !== 'direct') return conv;

        const sameDirectChat =
          (conv.conversationId && chatIds.has(conv.conversationId)) ||
          conv.id === userId ||
          conv.userId === userId;

        if (!sameDirectChat || conv.avatar === newAvatar) return conv;

        changed = true;
        return { ...conv, avatar: newAvatar };
      });

      if (changed) {
        aggUpdates.push({
          ref: aggDoc.ref,
          data: {
            conversations: updatedConversations,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }
    }
  }

  const aggCommitCount = aggUpdates.length > 0 ? await commitUpdates(aggUpdates) : 0;

  console.log('[onProfileAvatarUpdate] Completed avatar propagation', {
    userId,
    chatsMatched: chatsSnap.size,
    chatDocsUpdated: chatUpdates.length,
    aggregatedUsersChecked: affectedUsersToChatIds.size,
    aggregatedDocsUpdated: aggUpdates.length,
    batchCommits: chatCommitCount + aggCommitCount,
  });
});

// ==================== SHARED ACCOUNT DELETION HELPER ====================
async function performAccountDeletion(uid) {
  const firestore = admin.firestore();

  // Helper to commit in chunks of 500
  const commitInChunks = async (operations) => {
    const chunkSize = 500;
    for (let i = 0; i < operations.length; i += chunkSize) {
      const batch = firestore.batch();
      operations.slice(i, i + chunkSize).forEach(op => op(batch));
      await batch.commit();
    }
  };

  // 1. Fix follower/following counts on other users before deleting
  const [followingSnap, followersSnap] = await Promise.all([
    firestore.collection('profile').doc(uid).collection('following').get(),
    firestore.collection('profile').doc(uid).collection('followers').get(),
  ]);

  // For each user this user followed → decrement their followersCount
  if (!followingSnap.empty) {
    const operations = followingSnap.docs.flatMap(doc => {
      const followedUserId = doc.id;
      return [
        (batch) => batch.update(
          firestore.collection('profile').doc(followedUserId),
          {
            followersCount: admin.firestore.FieldValue.increment(-1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }
        ),
        (batch) => batch.delete(
          firestore.collection('profile').doc(followedUserId).collection('followers').doc(uid)
        ),
      ];
    });
    await commitInChunks(operations);
  }

  // For each user who followed this user → decrement their followingCount
  if (!followersSnap.empty) {
    const operations = followersSnap.docs.flatMap(doc => {
      const followerUserId = doc.id;
      return [
        (batch) => batch.update(
          firestore.collection('profile').doc(followerUserId),
          {
            followingCount: admin.firestore.FieldValue.increment(-1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }
        ),
        (batch) => batch.delete(
          firestore.collection('profile').doc(followerUserId).collection('following').doc(uid)
        ),
      ];
    });
    await commitInChunks(operations);
  }

  // 2. Delete subcollections under profile
  const subcollections = ['followers', 'following', 'followRequests'];
  await Promise.all(subcollections.map(async (sub) => {
    const snap = await firestore.collection('profile').doc(uid).collection(sub).get();
    if (!snap.empty) {
      const operations = snap.docs.map(doc => (batch) => batch.delete(doc.ref));
      await commitInChunks(operations);
    }
  }));

  // 3. Delete profile and users docs
  await firestore.collection('profile').doc(uid).delete();
  await firestore.collection('users').doc(uid).delete();

  // 4. Delete from other collections
  const fieldCollections = [
    'questions', 'answers', 'comments', 'likes',
    'follows', 'notifications', 'messages',
    'posts', 'favorites', 'user_settings', 'user_analytics',
  ];

  await Promise.all(fieldCollections.flatMap(col => [
    firestore.collection(col).where('userId', '==', uid).get()
      .then(async snap => {
        if (snap.empty) return;
        const operations = snap.docs.map(d => (batch) => batch.delete(d.ref));
        await commitInChunks(operations);
      }),
    firestore.collection(col).where('authorId', '==', uid).get()
      .then(async snap => {
        if (snap.empty) return;
        const operations = snap.docs.map(d => (batch) => batch.delete(d.ref));
        await commitInChunks(operations);
      }),
  ]));

  // 5. Delete aggregated doc
  await firestore.collection('aggregated').doc(`conversations_${uid}`).delete().catch(() => {});

  // 6. Delete Auth user last
  await admin.auth().deleteUser(uid);
}

exports.deleteAccountCallable = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await performAccountDeletion(request.auth.uid);
    return { success: true };
  } catch (error) {
    console.error('deleteAccountCallable error:', error);
    throw new HttpsError('internal', `Failed to delete account: ${error.message}`);
  }
});


// ==================== WEB DELETE (onRequest) ====================
exports.deleteAccountWeb = onRequest(
  { cors: ["https://kaiwa-collab.github.io"],
     invoker: "public",
     secrets: ["WEB_API_KEY"],
   }, // ✅ Firebase handles CORS — no manual check needed
  async (req, res) => {
    

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { email, password } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    try {
      let uid;

      if (password) {
        // Email + password user — verify credentials first
        const apiKey =  process.env.WEB_API_KEY;;
        const signInResponse = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
        );
        const signInData = await signInResponse.json();
        if (!signInResponse.ok || !signInData.localId) {
          return res.status(401).json({ error: "Invalid email or password." });
        }
        uid = signInData.localId;
      } else {
        // Google user — look up by email (no password needed)
        const userRecord = await admin.auth().getUserByEmail(email);
        uid = userRecord.uid;
      }

      // ✅ Calls the shared helper — same logic as in-app delete
      await performAccountDeletion(uid);

      return res.status(200).json({ success: true, message: "Account deleted successfully." });

    } catch (error) {
      console.error("[deleteAccountWeb]", error);
      if (error.code === "auth/user-not-found") {
        return res.status(404).json({ error: "User not found." });
      }
      return res.status(500).json({ error: "Failed to delete account. Please try again." });
    }
  }
);