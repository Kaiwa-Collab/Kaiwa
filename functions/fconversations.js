
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

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
//===== BUILD USER CONVERSATIONS (HELPER) ====================
async function buildUserConversations(userId) {
  const conversations = [];
  
  try {
    console.log('=== buildUserConversations START ===');
    console.log('User ID:', userId);
    
    // Get chats where user is participant
    console.log('Executing Firestore query...');
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
      console.log('=== buildUserConversations END (empty) ===');
      return {
        conversations: [],
        messageRequests: { received: [], sent: [] }
      };
    }

    // Log all chat IDs
    const chatIds = chatsSnapshot.docs.map(d => d.id);
    console.log('Chat IDs found:', chatIds);

    for (const chatDoc of chatsSnapshot.docs) {
      const chatData = chatDoc.data();
      const chatId = chatDoc.id;
      const chatType = chatData.type || 'direct';

      console.log(`\n--- Processing chat: ${chatId} ---`);
      console.log('Chat type:', chatType);
      console.log('Participants:', chatData.participants);
      console.log('isActive:', chatData.isActive);
      console.log('Has lastMessage:', !!chatData.lastMessage);
      console.log('lastMessage text:', chatData.lastMessage?.text);
      console.log('updatedAt:', chatData.updatedAt?.toDate?.());

      if (chatType === 'group') {
        const groupConv = {
          id: chatId,
          conversationId: chatId,
          type: 'group',
          name: chatData.metadata?.name || 'Group Chat',
          displayName: chatData.metadata?.name || 'Group Chat',
          avatar: chatData.metadata?.avatar || null,
          username: 'group',
          lastMessage: chatData.lastMessage?.text || '',
          lastMessageTime: chatData.lastMessage?.createdAt || chatData.updatedAt || admin.firestore.Timestamp.now(),
          unreadCount: 0,
          isPinned: false,
          participants: chatData.participants || []
        };
        console.log('Created group conversation:', groupConv);
        conversations.push(groupConv);
      } else {
        // Direct chat
        const participants = chatData.participants || [];
        console.log('All participants:', participants);
        
        const otherParticipantId = participants.find(id => id !== userId);
        console.log('Other participant ID:', otherParticipantId);
        
        if (!otherParticipantId) {
          console.log('ERROR: Could not find other participant');
          continue;
        }

        let participantInfo = chatData.participantsInfo?.[otherParticipantId];
        console.log('Cached participantInfo:', participantInfo);
        
        // If participant info not cached in chat, fetch it
        if (!participantInfo || !participantInfo.name) {
          console.log(`Fetching profile for ${otherParticipantId}...`);
          const userDoc = await admin.firestore()
            .collection('profile')
            .doc(otherParticipantId)
            .get();
          
          console.log('Profile doc exists:', userDoc.exists);
          
          if (userDoc.exists) {
            const userData = userDoc.data();
            console.log('Profile data:', {
              name: userData.name,
              displayName: userData.displayName,
              username: userData.username,
              avatar: userData.avatar
            });
            
            participantInfo = {
              id: otherParticipantId,
              name: userData.name || userData.displayName || userData.username || 'Unknown User',
              displayName: userData.displayName || userData.name || userData.username,
              avatar: userData.avatar || userData.photoURL || null,
              username: userData.username || 'unknown'
            };
          } else {
            console.log('Profile not found, using defaults');
            participantInfo = {
              id: otherParticipantId,
              name: 'Unknown User',
              displayName: 'Unknown User',
              avatar: null,
              username: 'unknown'
            };
          }
        }

        const directConv = {
          id: otherParticipantId,
          conversationId: chatId,
          type: 'direct',
          ...participantInfo,
          lastMessage: chatData.lastMessage?.text || '',
          lastMessageTime: chatData.lastMessage?.createdAt || chatData.updatedAt || admin.firestore.Timestamp.now(),
          unreadCount: 0,
          isPinned: false
        };
        
        console.log('Created direct conversation:', directConv);
        conversations.push(directConv);
      }
    }

    // Sort conversations
    conversations.sort((a, b) => {
      const aTime = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
      const bTime = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
      return bTime - aTime;
    });

    console.log(`\n=== FINAL RESULT ===`);
    console.log(`Total conversations built: ${conversations.length}`);
    console.log('Conversation IDs:', conversations.map(c => c.conversationId));

    // Get message requests
    const receivedRequests = await admin.firestore()
      .collection('messageRequests')
      .where('recipientId', '==', userId)
      .where('status', '==', 'pending')
      .get();

    const sentRequests = await admin.firestore()
      .collection('messageRequests')
      .where('senderId', '==', userId)
      .where('status', '==', 'pending')
      .get();

    console.log(`Message requests - Received: ${receivedRequests.size}, Sent: ${sentRequests.size}`);
    console.log('=== buildUserConversations END ===\n');

    return {
      conversations,
      messageRequests: {
        received: receivedRequests.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        sent: sentRequests.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      }
    };
  } catch (error) {
    console.error('=== buildUserConversations ERROR ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    console.error('=== buildUserConversations END (error) ===');
    
    return {
      conversations: [],
      messageRequests: {
        received: [],
        sent: []
      }
    };
  }
}
// ==================== UPDATE USER CONVERSATIONS ON CHAT CHANGE ====================
// Trigger: When any chat is created/updated
exports.updateUserConversationsOnChatChange = require('firebase-functions/v2/firestore')
  .onDocumentWritten('chats/{chatId}', async (event) => {
    try {
      const chatData = event.data?.after?.data();
      if (!chatData) return;

      const participants = chatData.participants || [];
      
      // Update conversation cache for each participant
      for (const userId of participants) {
        try {
          const result = await buildUserConversations(userId);
          
          await admin.firestore()
            .collection('aggregated')
            .doc(`conversations_${userId}`)
            .set({
              conversations: result.conversations,
              messageRequests: result.messageRequests,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
          
          console.log(`[updateUserConversations] Updated cache for user: ${userId}`);
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
      .orderBy('username')
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