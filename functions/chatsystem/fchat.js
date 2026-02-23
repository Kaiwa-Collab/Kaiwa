// functions/index.js
// V2 IMPORTS - CRITICAL: DO NOT MIX WITH V1
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();

// IMPORTANT: Your package.json must have:
// "firebase-functions": "^5.0.0" or higher for v2 support

// Set global options for all functions (optional)
setGlobalOptions({
  region: 'us-central1', // Change to your preferred region
  maxInstances: 10,
});

const db = admin.firestore();

// Helper: Generate direct chat ID
function generateDirectChatId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

// Helper: Get user profile
async function getUserProfile(userId) {
  try {
    const doc = await db.collection('profile').doc(userId).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    return null;
  }
}

// 1. CREATE DIRECT CHAT (v2)
exports.createDirectChat = onCall(async (request) => {
  // Verify authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId1, userId2, customChatId } = request.data;

  if (!userId1 || !userId2) {
    throw new HttpsError('invalid-argument', 'Both user IDs required');
  }

  const chatId = customChatId || generateDirectChatId(userId1, userId2);

  try {
    // Use transaction for consistency
    const result = await db.runTransaction(async (t) => {
      const chatRef = db.collection('chats').doc(chatId);
      const chatDoc = await t.get(chatRef);

      // If chat exists, return it
      if (chatDoc.exists) {
        return { id: chatId, ...chatDoc.data(), alreadyExists: true };
      }

      // Fetch both users' profiles in parallel
      const [user1Data, user2Data] = await Promise.all([
        getUserProfile(userId1),
        getUserProfile(userId2)
      ]);

      const participantsInfo = {
        [userId1]: {
          id: userId1,
          name: user1Data?.name || user1Data?.displayName || user1Data?.username || 'Unknown User',
          displayName: user1Data?.displayName || user1Data?.name || user1Data?.username || 'Unknown User',
          avatar: user1Data?.avatar || user1Data?.photoURL || null,
          username: user1Data?.username || 'unknown'
        },
        [userId2]: {
          id: userId2,
          name: user2Data?.name || user2Data?.displayName || user2Data?.username || 'Unknown User',
          displayName: user2Data?.displayName || user2Data?.name || user2Data?.username || 'Unknown User',
          avatar: user2Data?.avatar || user2Data?.photoURL || null,
          username: user2Data?.username || 'unknown'
        }
      };

      const chatData = {
        id: chatId,
        type: 'direct',
        participants: [userId1, userId2],
        participantsInfo,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        lastMessage: null
      };

      t.set(chatRef, chatData);

      return { 
        id: chatId, 
        ...chatData,
        alreadyExists: false 
      };
    });

    return result;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw new HttpsError('internal', 'Failed to create chat');
  }
});

// 2. ACCEPT MESSAGE REQUEST (v2)
exports.acceptMessageRequest = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { requestId, recipientId } = request.data;

  if (!requestId || !recipientId) {
    throw new HttpsError('invalid-argument', 'Request ID and recipient ID required');
  }

  try {
    const result = await db.runTransaction(async (t) => {
      // Step 1: Get request
      const requestRef = db.collection('messageRequests').doc(requestId);
      const requestDoc = await t.get(requestRef);

      if (!requestDoc.exists) {
        throw new HttpsError('not-found', 'Message request not found');
      }

      const requestData = requestDoc.data();

      if (requestData.recipientId !== recipientId) {
        throw new HttpsError('permission-denied', 'Unauthorized to accept this request');
      }

      if (requestData.status !== 'pending') {
        throw new HttpsError('failed-precondition', `Request already ${requestData.status}`);
      }

      // Step 2: Generate chat ID
      const chatId = generateDirectChatId(requestData.senderId, recipientId);
      const chatRef = db.collection('chats').doc(chatId);
      const existingChat = await t.get(chatRef);

      // Step 3: Create chat if doesn't exist
      let participantsInfo = {};
      
      if (!existingChat.exists) {
        const [senderData, recipientData] = await Promise.all([
          getUserProfile(requestData.senderId),
          getUserProfile(recipientId)
        ]);

        participantsInfo = {
          [requestData.senderId]: {
            id: requestData.senderId,
            name: senderData?.name || senderData?.displayName || senderData?.username || 'Unknown User',
            displayName: senderData?.displayName || senderData?.name || senderData?.username || 'Unknown User',
            avatar: senderData?.avatar || senderData?.photoURL || null,
            username: senderData?.username || 'unknown'
          },
          [recipientId]: {
            id: recipientId,
            name: recipientData?.name || recipientData?.displayName || recipientData?.username || 'Unknown User',
            displayName: recipientData?.displayName || recipientData?.name || recipientData?.username || 'Unknown User',
            avatar: recipientData?.avatar || recipientData?.photoURL || null,
            username: recipientData?.username || 'unknown'
          }
        };

        const chatData = {
          id: chatId,
          type: 'direct',
          participants: [requestData.senderId, recipientId],
          participantsInfo,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          isActive: true,
          lastMessage: null
        };

        t.set(chatRef, chatData);
      } else {
        participantsInfo = existingChat.data().participantsInfo || {};
      }

      // Step 4: Update request status
      t.update(requestRef, {
        status: 'accepted',
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        chatId
      });

      // Step 5: Send initial message if exists
      if (requestData.message && requestData.message.trim()) {
        const messageRef = chatRef.collection('messages').doc();
        const messageData = {
          senderId: requestData.senderId,
          text: requestData.message,
          messageType: 'text',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          readBy: { [requestData.senderId]: admin.firestore.FieldValue.serverTimestamp() },
          deliveredTo: {},
          edited: false
        };

        t.set(messageRef, messageData);

        // Update last message
        t.update(chatRef, {
          lastMessage: {
            id: messageRef.id,
            senderId: requestData.senderId,
            text: requestData.message,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return {
        id: chatId,
        type: 'direct',
        participants: [requestData.senderId, recipientId],
        participantsInfo,
        isActive: true,
        lastMessage: requestData.message ? {
          text: requestData.message,
          senderId: requestData.senderId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        } : null
      };
    });

    return result;
  } catch (error) {
    console.error('Error accepting request:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to accept message request');
  }
});

// 3. MARK MESSAGES AS READ (v2)
exports.markMessagesAsRead = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { chatId, userId } = request.data;

  if (!chatId || !userId) {
    throw new HttpsError('invalid-argument', 'Chat ID and user ID required');
  }

  try {
    const messagesRef = db.collection('chats').doc(chatId).collection('messages');
    const snapshot = await messagesRef
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const batch = db.batch();
    let hasUpdates = false;

    snapshot.docs.forEach(doc => {
      const messageData = doc.data();
      if (!messageData.readBy || !messageData.readBy[userId]) {
        batch.update(doc.ref, {
          [`readBy.${userId}`]: admin.firestore.FieldValue.serverTimestamp()
        });
        hasUpdates = true;
      }
    });

    if (hasUpdates) {
      await batch.commit();
    }

    return { success: true, messagesUpdated: hasUpdates };
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw new HttpsError('internal', 'Failed to mark messages as read');
  }
});

// 4. CREATE GROUP CHAT (v2)
exports.createGroupChat = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { creatorId, participantIds, groupName, groupDescription = '' } = request.data;

  if (!creatorId || !participantIds || !groupName) {
    throw new HttpsError('invalid-argument', 'Creator ID, participants, and group name required');
  }

  const chatId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const allParticipants = [creatorId, ...participantIds.filter(id => id !== creatorId)];

    // Fetch all participants' info in parallel
    const participantDocs = await Promise.all(
      allParticipants.map(id => getUserProfile(id))
    );

    const participantsInfo = {};
    participantDocs.forEach((data, index) => {
      const userId = allParticipants[index];
      participantsInfo[userId] = {
        id: userId,
        name: data?.name || data?.displayName || data?.username || 'Unknown User',
        avatar: data?.avatar || data?.photoURL || null,
        username: data?.username || 'unknown',
        role: userId === creatorId ? 'admin' : 'member',
        joinedAt: admin.firestore.FieldValue.serverTimestamp()
      };
    });

    const chatData = {
      id: chatId,
      type: 'group',
      participants: allParticipants,
      participantsInfo,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: creatorId,
      isActive: true,
      lastMessage: null,
      metadata: {
        name: groupName,
        description: groupDescription,
        avatar: null
      }
    };

    await db.collection('chats').doc(chatId).set(chatData);

    return { 
      id: chatId, 
      ...chatData 
    };
  } catch (error) {
    console.error('Error creating group chat:', error);
    throw new HttpsError('internal', 'Failed to create group chat');
  }
});

// 5. DELETE CHAT PERMANENTLY (v2)
exports.deleteChatPermanently = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { chatId } = request.data;

  if (!chatId) {
    throw new HttpsError('invalid-argument', 'Chat ID required');
  }

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const messagesRef = chatRef.collection('messages');

    // Delete messages in batches
    let lastDoc = null;
    let deletedCount = 0;

    while (true) {
      let query = messagesRef.orderBy('createdAt').limit(100);
      if (lastDoc) query = query.startAfter(lastDoc);
      
      const snapshot = await query.get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += snapshot.size;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < 100) break;
    }

    // Delete chat document
    await chatRef.delete();

    return { success: true, messagesDeleted: deletedCount };
  } catch (error) {
    console.error('Error deleting chat:', error);
    throw new HttpsError('internal', 'Failed to delete chat');
  }
});

// 6. AUTO-UPDATE DELIVERY STATUS (v2 Firestore Trigger)
exports.onMessageCreated = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const messageData = event.data.data();
  const chatId = event.params.chatId;
  const messageId = event.params.messageId;

  try {
    // Update chat's lastMessage
    await db.collection('chats').doc(chatId).update({
      lastMessage: {
        id: messageId,
        senderId: messageData.senderId,
        text: messageData.text || (messageData.messageType === 'image' ? '📷 Photo' : messageData.messageType === 'video' ? '📹 Video' : 'Media'),
        createdAt: messageData.createdAt || admin.firestore.FieldValue.serverTimestamp()
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // TODO: Send push notification to other participants
    
  } catch (error) {
    console.error('Error in onMessageCreated:', error);
  }
});