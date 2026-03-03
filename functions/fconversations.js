
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

if (!admin.apps.length) {
  admin.initializeApp();
}

// ==================== GET USER CONVERSATIONS (OPTIMIZED) ====================
// This replaces the client-side loadActiveConversations function
// Reduces reads from 100+ to just 1-3 per user
exports.getUserConversations = onCall(async (request) => {
  try {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    console.log(`[getUserConversations] Loading for user: ${userId}`);

    // Get user's conversation list from aggregated collection (1 READ)
    const userConversationsDoc = await admin.firestore()
      .collection('aggregated')
      .doc(`conversations_${userId}`)
      .get();

    if (userConversationsDoc.exists) {
      const data = userConversationsDoc.data();
      console.log(`[getUserConversations] Found cached data:`, {
        conversations: data.conversations?.length || 0,
        messageRequests: data.messageRequests
      });
      
      // FIXED: Ensure consistent structure
      return {
        conversations: data.conversations || [],
        messageRequests: {
          received: data.messageRequests?.received || [],
          sent: data.messageRequests?.sent || []
        },
        lastUpdated: data.lastUpdated,
        cached: true
      };
    }

    // If no cached data, build it now (fallback)
    console.log(`[getUserConversations] No cache found, building fresh data`);
    const result = await buildUserConversations(userId);
    
    // Cache the result
    await admin.firestore()
      .collection('aggregated')
      .doc(`conversations_${userId}`)
      .set({
        conversations: result.conversations,
        messageRequests: result.messageRequests,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

    // FIXED: Return consistent structure
    return {
      conversations: result.conversations || [],
      messageRequests: {
        received: result.messageRequests?.received || [],
        sent: result.messageRequests?.sent || []
      },
      cached: false
    };
  } catch (error) {
    console.error('[getUserConversations] Error:', error);
    
    // FIXED: Return empty data structure instead of throwing
    // This prevents the client from crashing
    return {
      conversations: [],
      messageRequests: {
        received: [],
        sent: []
      },
      error: error.message
    };
  }
});
//===== GET EFFECTIVE LAST MESSAGE (promote previous if last is deleted for user) =====
async function getEffectiveLastMessage(db, chatId, lastMessage, userId) {
  if (!lastMessage?.id) return lastMessage;
  try {
    const msgDoc = await db.collection('chats').doc(chatId).collection('messages').doc(lastMessage.id).get();
    if (!msgDoc.exists) return lastMessage;
    const msgData = msgDoc.data();
    const deletedForMe = msgData.deletedFor && msgData.deletedFor[userId];
    const deletedForEveryone = msgData.messageType === 'deleted' || msgData.deletedForEveryone;
    if (!deletedForMe && !deletedForEveryone) return lastMessage;
    const prevSnapshot = await db.collection('chats').doc(chatId).collection('messages')
      .orderBy('createdAt', 'desc').limit(2).get();
    const docs = prevSnapshot.docs;
    if (docs.length < 2 || docs[0].id !== lastMessage.id) return lastMessage;
    const prevDoc = docs[1];
    const prevData = prevDoc.data();
    return {
      id: prevDoc.id,
      text: prevData.text || (prevData.messageType === 'image' ? '📷 Photo' : prevData.messageType === 'video' ? '📹 Video' : 'Media'),
      createdAt: prevData.createdAt
    };
  } catch (e) {
    return lastMessage;
  }
}

//===== BUILD USER CONVERSATIONS (HELPER) ====================
async function buildUserConversations(userId) {
  const conversations = [];
  
  try {
    console.log('=== buildUserConversations START ===');
    console.log('User ID:', userId);
    
    const chatsSnapshot = await admin.firestore()
      .collection('chats')
      .where('participants', 'array-contains', userId)
      .where('isActive', '==', true)
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get();

    console.log(`Query completed. Found ${chatsSnapshot.docs.length} documents`);
    
    if (chatsSnapshot.empty) {
      console.log('WARNING: No chats found for user');
      return {
        conversations: [],
        messageRequests: { received: [], sent: [] }
      };
    }

    // Collect all unique other participant IDs for direct chats
    // so we can batch fetch all profiles in ONE read instead of N reads
    const otherParticipantIds = [];
    for (const chatDoc of chatsSnapshot.docs) {
      const chatData = chatDoc.data();
      const chatType = chatData.type || 'direct';
      if (chatType === 'direct') {
        const participants = chatData.participants || [];
        const otherParticipantId = participants.find(id => id !== userId);
        // Only fetch if not already cached in the chat doc
        if (otherParticipantId && !chatData.participantsInfo?.[otherParticipantId]?.name) {
          otherParticipantIds.push(otherParticipantId);
        }
      }
    }

    // Batch fetch all missing profiles in parallel (1 read per unique user)
    const uniqueOtherIds = [...new Set(otherParticipantIds)];
    const profileMap = {};
    if (uniqueOtherIds.length > 0) {
      const profileSnaps = await Promise.all(
        uniqueOtherIds.map(uid =>
          admin.firestore().collection('profile').doc(uid).get()
        )
      );
      profileSnaps.forEach((snap, i) => {
        if (snap.exists) {
          const userData = snap.data();
          profileMap[uniqueOtherIds[i]] = {
            id: uniqueOtherIds[i],
            name: userData.name || userData.displayName || userData.username || 'Unknown User',
            displayName: userData.displayName || userData.name || userData.username || 'Unknown User',
            avatar: userData.avatar || userData.photoURL || null,
            username: userData.username || 'unknown'
          };
        } else {
          profileMap[uniqueOtherIds[i]] = {
            id: uniqueOtherIds[i],
            name: 'Unknown User',
            displayName: 'Unknown User',
            avatar: null,
            username: 'unknown'
          };
        }
      });
    }

    // Now build conversations using cached profiles — no more per-chat reads
    for (const chatDoc of chatsSnapshot.docs) {
      const chatData = chatDoc.data();
      const chatId = chatDoc.id;
      const chatType = chatData.type || 'direct';

      const effectiveLast = await getEffectiveLastMessage(
        admin.firestore(), chatId, chatData.lastMessage, userId
      );

      if (chatType === 'group') {
        conversations.push({
          id: chatId,
          conversationId: chatId,
          type: 'group',
          name: chatData.metadata?.name || chatData.name || 'Group Chat',
          displayName: chatData.metadata?.name || chatData.name || 'Group Chat',
          avatar: chatData.metadata?.avatar || null,
          groupavatar: chatData.groupavatar || null,
          username: 'group',
          lastMessage: effectiveLast?.text || '',
          lastMessageTime: effectiveLast?.createdAt || chatData.updatedAt || admin.firestore.Timestamp.now(),
          unreadCount: 0,
          isPinned: false,
          participants: chatData.participants || []
        });
      } else {
        const participants = chatData.participants || [];
        const otherParticipantId = participants.find(id => id !== userId);
        
        if (!otherParticipantId) {
          console.log(`ERROR: Could not find other participant in chat ${chatId}`);
          continue;
        }

        // Use cached participantsInfo from chat doc first, then fall back to profileMap
        const participantInfo = 
          (chatData.participantsInfo?.[otherParticipantId]?.name 
            ? chatData.participantsInfo[otherParticipantId] 
            : null) || 
          profileMap[otherParticipantId] || {
            id: otherParticipantId,
            name: 'Unknown User',
            displayName: 'Unknown User',
            avatar: null,
            username: 'unknown'
          };

        conversations.push({
          id: otherParticipantId,
          conversationId: chatId,
          type: 'direct',
          ...participantInfo,
          lastMessage: effectiveLast?.text || '',
          lastMessageTime: effectiveLast?.createdAt || chatData.updatedAt || admin.firestore.Timestamp.now(),
          unreadCount: 0,
          isPinned: false
        });
      }
    }

    // Deduplicate by conversationId — prevents duplicates from appearing in drawer
    const seen = new Set();
    const uniqueConversations = conversations.filter(conv => {
      if (seen.has(conv.conversationId)) {
        console.log(`Duplicate found and removed: ${conv.conversationId}`);
        return false;
      }
      seen.add(conv.conversationId);
      return true;
    });

    // Sort by latest message
    uniqueConversations.sort((a, b) => {
      const aTime = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
      const bTime = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
      return bTime - aTime;
    });

    console.log(`Total unique conversations built: ${uniqueConversations.length}`);

    // Get message requests in parallel
    const [receivedRequests, sentRequests] = await Promise.all([
      admin.firestore()
        .collection('messageRequests')
        .where('recipientId', '==', userId)
        .where('status', '==', 'pending')
        .get(),
      admin.firestore()
        .collection('messageRequests')
        .where('senderId', '==', userId)
        .where('status', '==', 'pending')
        .get()
    ]);

    console.log(`Message requests - Received: ${receivedRequests.size}, Sent: ${sentRequests.size}`);
    console.log('=== buildUserConversations END ===');

    return {
      conversations: uniqueConversations,
      messageRequests: {
        received: receivedRequests.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        sent: sentRequests.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      }
    };

  } catch (error) {
    console.error('=== buildUserConversations ERROR ===', error.message);
    return {
      conversations: [],
      messageRequests: { received: [], sent: [] }
    };
  }
}

// ==================== UPDATE USER CONVERSATIONS ON CHAT CHANGE ====================
exports.updateUserConversationsOnChatChange = onDocumentWritten('chats/{chatId}', async (event) => {
  try {
    const chatData = event.data?.after?.data();
    const chatId = event.params.chatId;

    // Chat was deleted
    if (!chatData) {
      console.log(`[updateUserConversations] Chat ${chatId} was deleted`);
      return;
    }

    const participants = chatData.participants || [];
    if (participants.length === 0) {
      console.log(`[updateUserConversations] No participants found in chat ${chatId}`);
      return;
    }

    console.log(`[updateUserConversations] Chat ${chatId} changed, updating ${participants.length} participants`);

    for (const userId of participants) {
      try {
        const aggRef = admin.firestore()
          .collection('aggregated')
          .doc(`conversations_${userId}`);

        const aggDoc = await aggRef.get();

        // No cache yet — do a full build
        if (!aggDoc.exists) {
          console.log(`[updateUserConversations] No cache for ${userId}, doing full build`);
          const result = await buildUserConversations(userId);
          await aggRef.set({
            conversations: result.conversations,
            messageRequests: result.messageRequests,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          continue;
        }

        const existing = aggDoc.data();
        let conversations = existing.conversations || [];

        const index = conversations.findIndex(c => c.conversationId === chatId);

        if (index !== -1) {
          // Conversation exists — patch only the fields that changed
          console.log(`[updateUserConversations] Patching existing conversation ${chatId} for user ${userId}`);
          
          const lastMessageText = chatData.lastMessage?.text || conversations[index].lastMessage || '';
          const lastMessageTime = chatData.updatedAt || conversations[index].lastMessageTime;

          conversations[index] = {
            ...conversations[index],
            lastMessage: lastMessageText,
            lastMessageTime: lastMessageTime,
          };

        } else {
          // New conversation for this user — build just this one
          console.log(`[updateUserConversations] New conversation ${chatId} for user ${userId}, fetching details`);
          const result = await buildUserConversations(userId);
          const newConv = result.conversations.find(c => c.conversationId === chatId);
          if (newConv) {
            conversations.push(newConv);
          } else {
            console.log(`[updateUserConversations] Could not find new conversation ${chatId} in build result`);
            continue;
          }
        }

        // Always deduplicate before writing
        const seen = new Set();
        conversations = conversations.filter(conv => {
          if (seen.has(conv.conversationId)) return false;
          seen.add(conv.conversationId);
          return true;
        });

        // Re-sort by latest message time
        conversations.sort((a, b) => {
          const aTime = a.lastMessageTime?.toDate 
            ? a.lastMessageTime.toDate() 
            : new Date(a.lastMessageTime || 0);
          const bTime = b.lastMessageTime?.toDate 
            ? b.lastMessageTime.toDate() 
            : new Date(b.lastMessageTime || 0);
          return bTime - aTime;
        });

        await aggRef.update({
          conversations,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[updateUserConversations] Successfully updated cache for user ${userId}`);

      } catch (error) {
        console.error(`[updateUserConversations] Error updating user ${userId}:`, error);
      }
    }

  } catch (error) {
    console.error('[updateUserConversationsOnChatChange] Error:', error);
  }
});

// ==================== SEARCH USERS (SERVER-SIDE) ====================
exports.searchUsers = onCall(async (request) => {
  try {
    const { query, limit = 20 } = request.data || {};
    const currentUserId = request.auth?.uid;
    
    if (!currentUserId) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    if (!query || query.trim().length < 3) {
      throw new HttpsError('invalid-argument', 'Query must be at least 3 characters');
    }

    const sanitizedQuery = query.toLowerCase().trim().replace(/[^\w\s]/gi, '');

    // Search by username
    const usernameResults = await admin.firestore()
      .collection('profile')
      .orderBy('usernameLower')
      .startAt(sanitizedQuery)
      .endAt(sanitizedQuery + '\uf8ff')
      .limit(limit)
      .get();

    let users = usernameResults.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Filter out current user
    users = users.filter(user => user.id !== currentUserId);

    // Check mutual follow status for each user
    const usersWithFollowStatus = await Promise.all(
      users.map(async (user) => {
        try {
          // Check if both users follow each other
          const [currentUserDoc, otherUserDoc] = await Promise.all([
            admin.firestore().collection('profile').doc(currentUserId).get(),
            admin.firestore().collection('profile').doc(user.id).get()
          ]);

          const currentUserFollowing = currentUserDoc.data()?.following || [];
          const otherUserFollowing = otherUserDoc.data()?.following || [];

          const isMutualFollow = 
            currentUserFollowing.includes(user.id) && 
            otherUserFollowing.includes(currentUserId);

          return {
            ...user,
            isMutualFollow,
            canDM: isMutualFollow
          };
        } catch (error) {
          return {
            ...user,
            isMutualFollow: false,
            canDM: false
          };
        }
      })
    );

    // Sort: mutual followers first
    usersWithFollowStatus.sort((a, b) => {
      if (a.isMutualFollow && !b.isMutualFollow) return -1;
      if (!a.isMutualFollow && b.isMutualFollow) return 1;
      return 0;
    });

    return {
      users: usersWithFollowStatus,
      query: sanitizedQuery
    };
  } catch (error) {
    console.error('[searchUsers] Error:', error);
    throw new HttpsError('internal', 'Failed to search users');
  }
});

// ==================== FIX CHAT PARTICIPANTS (SCHEDULED) ====================
// Run daily to fix any chats with missing participants field
exports.fixChatParticipants = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/New_York',
    memory: '512MB',
  },
  async (event) => {
    try {
      console.log('[fixChatParticipants] Starting daily fix...');
      
      const allChatsSnapshot = await admin.firestore()
        .collection('chats')
        .get();
      
      let fixedCount = 0;
      const batch = admin.firestore().batch();
      let batchCount = 0;

      for (const chatDoc of allChatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const chatId = chatDoc.id;
        
        // Check if participants are missing
        if (!chatData.participants || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
          // Try to extract from chat ID
          if (chatId.includes('_') && !chatId.startsWith('group_')) {
            const possibleUserIds = chatId.split('_').filter(id => id && id.length > 10);
            
            if (possibleUserIds.length >= 2) {
              batch.update(admin.firestore().collection('chats').doc(chatId), {
                participants: possibleUserIds,
                isActive: true,
                type: 'direct',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              
              fixedCount++;
              batchCount++;
              
              // Commit batch every 500 operations
              if (batchCount >= 500) {
                await batch.commit();
                batchCount = 0;
              }
            }
          }
        }
      }

      // Commit remaining batch
      if (batchCount > 0) {
        await batch.commit();
      }

      console.log(`[fixChatParticipants] Fixed ${fixedCount} chats`);
      
      return {
        success: true,
        fixedCount
      };
    } catch (error) {
      console.error('[fixChatParticipants] Error:', error);
      throw error;
    }
  }
);