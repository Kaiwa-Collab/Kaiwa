// chatService.js - Firebase service for chat functionality
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Alert } from 'react-native';

async function getUserProfile(uid) {
  const doc = await firestore().collection('profile').doc(uid).get();
  return doc.exists ? doc.data() : null;
}
// Database Collections Structure:
/*
1. chats/{chatId}
   - id: string (unique chat identifier)
   - type: 'direct' | 'group'
   - participants: string[] (array of user IDs)
   - participantsInfo: object (user info for quick access)
   - createdAt: timestamp
   - updatedAt: timestamp
   - lastMessage: object
   - isActive: boolean
   - metadata: object (group name, description, etc. for groups)

2. chats/{chatId}/messages/{messageId}
   - id: string
   - senderId: string
   - text: string
   - imageUrl?: string
   - messageType: 'text' | 'image' | 'system'
   - createdAt: timestamp
   - readBy: object (userId: timestamp)
   - edited: boolean
   - editedAt?: timestamp

3. messageRequests/{requestId}
   - id: string
   - senderId: string
   - recipientId: string
   - message: string (initial message)
   - status: 'pending' | 'accepted' | 'rejected'
   - createdAt: timestamp
   - acceptedAt?: timestamp
   - chatId?: string (created after acceptance)

4. (removed) per-user chat mapping collection (deprecated)

5. profile/{userId}/following/{followedUserId}
   - followedAt: timestamp
   - isActive: boolean
*/
// const currentUser=auth.currentUser.uid;

class chatService {
  constructor() {
    this.db = firestore();
  }

  generateGroupChatId() {
  // Generate a unique ID for group chats
  return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}


  // Generate unique chat ID for direct messages
  generateDirectChatId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
  }
  

  // Check if two users mutually follow each other
async checkMutualFollow(userId1, userId2) {
  try {
    // Validate inputs
    if (!userId1 || typeof userId1 !== 'string' || !userId2 || typeof userId2 !== 'string') {
      return false;
    }

    if (userId1 === userId2) {
      return false;
    }

  
    
    // Check both relationships simultaneously
    const [user1FollowsUser2Doc, user2FollowsUser1Doc] = await Promise.all([
      this.db.collection('profile').doc(userId1).collection('following').doc(userId2).get(),
      this.db.collection('profile').doc(userId2).collection('following').doc(userId1).get()
    ]);

    const user1Follows = user1FollowsUser2Doc.exists();
    const user2Follows = user2FollowsUser1Doc.exists();
    const result = user1Follows && user2Follows;

   
    
    return result;
  } catch (error) {
    return false;
  }
}
  // Send message request
  async sendMessageRequest(senderId, recipientId, message='Hey,i would like to connect with you!') {
    try {
      // Check if request already exists
      const existingRequest = await this.db
        .collection('messageRequests')
        .where('senderId', '==', senderId)
        .where('recipientId', '==', recipientId)
        .where('status', '==', 'pending')
        .get();

      if (!existingRequest.empty) {
        Alert.alert('Message request already sent');
      }

      // Get sender info
      const senderDoc = await this.db.collection('profile').doc(senderId).get();
      const senderInfo = senderDoc.data();

      const requestData = {
        senderId,
        recipientId,
        message,
        status: 'pending',
        createdAt: firestore.FieldValue.serverTimestamp(),
        senderInfo: {
          id: senderId,
          name: senderInfo.name || senderInfo.displayName || senderInfo.username,
          avatar: senderInfo.avatar || senderInfo.photoURL,
          username: senderInfo.username
        }
      };

      const requestRef = await this.db.collection('messageRequests').add(requestData);
      return requestRef.id;
    } catch (error) {
      throw error;
    }
  }

  // Accept message request and create chat
 // Updated acceptMessageRequest function in chatService.js
// Minimal acceptMessageRequest function - Just accept the request, don't send initial message
async acceptMessageRequest(requestId, recipientId) {
  try {
 
    
    // Step 1: Get and validate request
    const requestRef = this.db.collection('messageRequests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new Error('Message request not found');
    }

    const requestData = requestDoc.data();
    

    if (requestData.recipientId !== recipientId) {
      throw new Error('Unauthorized to accept this request');
    }

    if (requestData.status !== 'pending') {
      throw new Error(`Request has already been ${requestData.status}`);
    }

    // Step 2: Generate chat ID
    const chatId = this.generateDirectChatId(requestData.senderId, recipientId);
    

    // Step 3: Create basic chat document (minimal data)
    const chatRef = this.db.collection('chats').doc(chatId);
    const existingChat = await chatRef.get();
    
    if (!existingChat.exists) {
      
      
      const basicChatData = {
        type: 'direct',
        participants: [requestData.senderId, recipientId],
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
        isActive: true,
        lastMessage: null
      };

      await chatRef.set(basicChatData);
      
      
    } else {
      console.log('Chat already exists');
    }

    // Step 4: Update request status
    await requestRef.update({
      status: 'accepted',
      acceptedAt: firestore.FieldValue.serverTimestamp(),
      chatId
    });
    
  
    // Return basic chat data
    return {
      id: chatId,
      type: 'direct',
      participants: [requestData.senderId, recipientId],
      isActive: true
    };

  } catch (error) {
    throw error;
  }
}

// Separate function to send initial message after chat is established
async sendInitialMessageFromRequest(chatId, senderId, message) {
  try {
  
    
    if (!chatId || !senderId || !message) {
      throw new Error('Missing required parameters');
    }

    // Wait a bit to ensure chat is fully established
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify chat exists and is valid
    const chatRef = this.db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();
    
    if (!chatDoc.exists) {
      throw new Error('Chat document not found');
    }
    
    let chatData = chatDoc.data();
    

    // Harden: if chat data missing or participants invalid, reconstruct from chatId
    if (!chatData || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
      const partsFromId = chatId.includes('_') ? chatId.split('_').filter(Boolean) : [senderId];
      const participants = Array.from(new Set([...partsFromId, senderId]));
      await chatRef.set({
        participants,
        isActive: true,
        type: 'direct',
        updatedAt: firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      chatData = { ...(chatData || {}), participants };
    }
    
    if (!chatData.participants.includes(senderId)) {
      // Add sender as participant if somehow missing
      const participants = Array.from(new Set([...(chatData.participants || []), senderId]));
      await chatRef.set({
        participants,
        updatedAt: firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      chatData.participants = participants;
    }
    
    // Create and send message
    const messageData = {
      senderId,
      text: message,
      messageType: 'text',
      createdAt: firestore.FieldValue.serverTimestamp(),
      readBy: { [senderId]: firestore.FieldValue.serverTimestamp() },
      edited: false
    };

    const messageRef = await this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .add(messageData);

    // Update chat's last message
    await chatRef.update({
      lastMessage: {
        id: messageRef.id,
        senderId,
        text: message,
        createdAt: firestore.FieldValue.serverTimestamp()
      },
      updatedAt: firestore.FieldValue.serverTimestamp()
    });

   
    return { id: messageRef.id, ...messageData };
    
  } catch (error) {
    throw error;
  }
}
  // Reject message request
  async rejectMessageRequest(requestId, recipientId) {
    try {
      const requestRef = this.db.collection('messageRequests').doc(requestId);
      const requestDoc = await requestRef.get();

      if (!requestDoc.exists) {
        throw new Error('Message request not found');
      }

      const requestData = requestDoc.data();
      
      if (requestData.recipientId !== recipientId) {
        throw new Error('Unauthorized to reject this request');
      }

      await requestRef.update({
        status: 'rejected',
        rejectedAt: firestore.FieldValue.serverTimestamp()
      });

      return true;
    } catch (error) {
      throw error;
    }
  }

  // Create direct chat between two users
 // Updated createDirectChat function in chatService.js
async createDirectChat(userId1, userId2, customChatId = null) {
  try {
    const chatId = customChatId || this.generateDirectChatId(userId1, userId2);
   

    // Check if chat already exists
    const chatRef = this.db.collection('chats').doc(chatId);
    const existingChat = await chatRef.get();
    
    if (existingChat.exists) {
     
      const chatData = existingChat.data();

      return { id: chatId, ...chatData };
    }

    // Get both users' info with error handling
    const [user1Doc, user2Doc] = await Promise.all([
      this.db.collection('profile').doc(userId1).get().catch(error => {
        return null;
      }),
      this.db.collection('profile').doc(userId2).get().catch(error => {
        return null;
      })
    ]);

    const user1Info = user1Doc?.exists ? user1Doc.data() : {};
    const user2Info = user2Doc?.exists ? user2Doc.data() : {};

    const chatData = {
      id: chatId,
      type: 'direct',
      participants: [userId1, userId2],
      participantsInfo: {
        [userId1]: {
          id: userId1,
          name: user1Info.name || user1Info.displayName || user1Info.username || 'Unknown User',
          displayName: user1Info.displayName || user1Info.name || user1Info.username || 'Unknown User',
          avatar: user1Info.avatar || user1Info.photoURL || null,
          username: user1Info.username || 'unknown'
        },
        [userId2]: {
          id: userId2,
          name: user2Info.name || user2Info.displayName || user2Info.username || 'Unknown User',
          displayName: user2Info.displayName || user2Info.name || user2Info.username || 'Unknown User',
          avatar: user2Info.avatar || user2Info.photoURL || null,
          username: user2Info.username || 'unknown'
        }
      },
      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
      isActive: true,
      lastMessage: null
    };

    // Use transaction to ensure consistency
    try {
      await this.db.runTransaction(async (transaction) => {
        // Double-check chat doesn't exist in transaction
        const chatSnapshot = await transaction.get(chatRef);
        if (chatSnapshot.exists) {
          
          return; // Chat was created by another process
        }

       
        // Create chat document
        transaction.set(chatRef, chatData);
        
       
      });
      // Transaction completed successfully
    } catch (transactionError) {
      throw transactionError;
    }

    
    
    // Return the chat data with proper structure for the drawer
    return { 
      id: chatId, 
      type: 'direct',
      participants: [userId1, userId2],
      participantsInfo: chatData.participantsInfo,
      createdAt: chatData.createdAt,
      updatedAt: chatData.updatedAt,
      isActive: true,
      lastMessage: null
    };
    
  } catch (error) {
    throw error;
  }
}

// (removed) ensureUserChatEntries

// (removed) createUserChatEntriesDirectly

// Ensure chat document has both participants and participantsInfo populated
async ensureChatParticipants(chatId, userId1, userId2) {
  try {
    if (!chatId || !userId1 || !userId2) {
      return false;
    }

    const chatRef = this.db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      // If chat doesn't exist, create it via createDirectChat
      await this.createDirectChat(userId1, userId2, chatId);
      return true;
    }

    const chatData = chatDoc.data() || {};
    const existingParticipants = Array.isArray(chatData.participants) ? chatData.participants : [];

    // If both participants already present, optionally backfill participantsInfo and exit
    const hasUser1 = existingParticipants.includes(userId1);
    const hasUser2 = existingParticipants.includes(userId2);

    // Build updated participants
    const updatedParticipants = Array.from(new Set([...existingParticipants, userId1, userId2]));

    // Prepare participantsInfo if missing entries
    const participantsInfo = chatData.participantsInfo || {};
    const missingInfoIds = [userId1, userId2].filter(
      uid => !participantsInfo[uid] || !participantsInfo[uid].name
    );

    let updatedParticipantsInfo = participantsInfo;
    if (missingInfoIds.length > 0) {
      const profiles = await Promise.all(
        missingInfoIds.map(uid => this.db.collection('profile').doc(uid).get().catch(() => null))
      );
      updatedParticipantsInfo = { ...participantsInfo };
      profiles.forEach((docSnap, idx) => {
        const uid = missingInfoIds[idx];
        const data = docSnap && docSnap.exists ? docSnap.data() : {};
        updatedParticipantsInfo[uid] = {
          id: uid,
          name: data.name || data.displayName || data.username || 'Unknown User',
          displayName: data.displayName || data.name || data.username || 'Unknown User',
          avatar: data.avatar || data.photoURL || null,
          username: data.username || 'unknown'
        };
      });
    }

    // If nothing to update, return early
    if (hasUser1 && hasUser2 && missingInfoIds.length === 0) {
      return true;
    }

    await chatRef.set(
      {
        participants: updatedParticipants,
        participantsInfo: updatedParticipantsInfo,
        isActive: true,
        updatedAt: firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    
    return true;
  } catch (error) {
    return false;
  }
}

// Updated acceptMessageRequest function
async acceptMessageRequest(requestId, recipientId) {
  try {
    
    
    // Step 1: Get and validate request
    const requestRef = this.db.collection('messageRequests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new Error('Message request not found');
    }

    const requestData = requestDoc.data();
   

    if (requestData.recipientId !== recipientId) {
      throw new Error('Unauthorized to accept this request');
    }

    if (requestData.status !== 'pending') {
      throw new Error(`Request has already been ${requestData.status}`);
    }

    // Step 2: Create the chat properly using createDirectChat
    const chatResult = await this.createDirectChat(requestData.senderId, recipientId);
    const chatId = chatResult.id;
    
    

    // Step 3: Update request status
    await requestRef.update({
      status: 'accepted',
      acceptedAt: firestore.FieldValue.serverTimestamp(),
      chatId
    });
    
  

    // Ensure participants are present before sending the initial message
    try {
      await this.ensureChatParticipants(chatId, requestData.senderId, recipientId);
    } catch (e) {
      // ensureChatParticipants failed (will continue)
    }

    // Step 4: Send the initial message if there was one in the request
    if (requestData.message && requestData.message.trim() !== '') {
      await this.sendInitialMessageFromRequest(chatId, requestData.senderId, requestData.message);
    }

    // Return the chat data with proper structure for the drawer
    return {
      id: chatId,
      type: 'direct',
      participants: [requestData.senderId, recipientId],
      participantsInfo: chatResult.participantsInfo,
      createdAt: chatResult.createdAt,
      updatedAt: chatResult.updatedAt,
      isActive: true,
      lastMessage: requestData.message ? {
        text: requestData.message,
        senderId: requestData.senderId,
        createdAt: requestData.createdAt
      } : null
    };

  } catch (error) {
    throw error;
  }
}




  // Create group chat
 async createGroupChat(creatorId, participantIds, groupName, groupDescription = '') {
  try {
    

    // Generate chat ID first
    const chatId = this.generateGroupChatId();
    

    const allParticipants = [creatorId, ...participantIds.filter(id => id !== creatorId)];
    
    
    // Get all participants' info with error handling
    const participantDocs = await Promise.all(
      allParticipants.map(id => 
        this.db.collection('profile').doc(id).get().catch(error => {
          return null;
        })
      )
    );

    const participantsInfo = {};
    participantDocs.forEach((doc, index) => {
      const userId = allParticipants[index];
      const data = doc?.exists ? doc.data() : {};
      
      participantsInfo[userId] = {
        id: userId,
        name: data.name || data.displayName || data.username || 'Unknown User',
        avatar: data.avatar || data.photoURL || null,
        username: data.username || 'unknown',
        role: userId === creatorId ? 'admin' : 'member',
        joinedAt: firestore.FieldValue.serverTimestamp()
      };
    });

    const chatData = {
      id: chatId,
      type: 'group',
      participants: allParticipants,
      participantsInfo,
      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
      createdBy: creatorId,
      isActive: true,
      lastMessage: null,
      metadata: {
        name: groupName,
        description: groupDescription,
        avatar: null
      }
    };

    // Use transaction to ensure consistency (similar to createDirectChat)
    const chatRef = this.db.collection('chats').doc(chatId);
    
    try {
      await this.db.runTransaction(async (transaction) => {
       
        
        // Create chat document
        transaction.set(chatRef, chatData);
        
        
      });
      
      
      
    } catch (transactionError) {
      throw transactionError;
    }

    

    // Return the chat data with proper structure
    return { 
      id: chatId, 
      type: 'group',
      participants: allParticipants,
      participantsInfo,
      createdAt: chatData.createdAt,
      updatedAt: chatData.updatedAt,
      createdBy: creatorId,
      isActive: true,
      lastMessage: null,
      metadata: chatData.metadata
    };
    
  } catch (error) {
    throw error;
  }
}

  // Send message
  

async sendMessage(chatId, senderId, text, imageUrl = null) {
  try {
    

    // Validate inputs
    if (!chatId || !senderId) {
      throw new Error('Chat ID and sender ID are required');
    }

    if (!text && !imageUrl) {
      throw new Error('Message must have text or image');
    }

    // Verify the chat exists and get its data
    const chatRef = this.db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();
    
    if (!chatDoc.exists) {
      throw new Error('Chat not found');
    }

    const chatData = chatDoc.data();
   
    
    // Verify chat data is valid
    if (!chatData) {
      throw new Error('Chat data is corrupted or incomplete');
    }
    
    if (!chatData.participants || !Array.isArray(chatData.participants)) {
      throw new Error('Chat participants data is missing or invalid');
    }
    
    // Verify sender is a participant
    if (!chatData.participants.includes(senderId)) {
      throw new Error('Sender is not a participant in this chat');
    }

    

    // Create message data
    const messageData = {
      senderId,
      text: text || '',
      imageUrl,
      messageType: imageUrl ? 'image' : 'text',
      createdAt: firestore.FieldValue.serverTimestamp(),
      readBy: {
        [senderId]: firestore.FieldValue.serverTimestamp()
      },
      edited: false
    };

    // Add message to chat
    const messageRef = await this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .add(messageData);

   

    // Update chat's last message
    const lastMessageData = {
      id: messageRef.id,
      senderId,
      text: text || (imageUrl ? '📷 Image' : ''),
      createdAt: firestore.FieldValue.serverTimestamp()
    };

    await chatRef.update({
      lastMessage: lastMessageData,
      updatedAt: firestore.FieldValue.serverTimestamp()
    });

   
    return { id: messageRef.id, ...messageData };

  } catch (error) {
    throw error;
  }
}
  // Mark messages as read
  async markMessagesAsRead(chatId, userId) {
    try {
      // Update readBy for recent messages
      const messagesRef = this.db
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(50);

      const messagesSnapshot = await messagesRef.get();
      const batch = this.db.batch();

      messagesSnapshot.docs.forEach(doc => {
        const messageData = doc.data();
        if (!messageData.readBy || !messageData.readBy[userId]) {
          batch.update(doc.ref, {
            [`readBy.${userId}`]: firestore.FieldValue.serverTimestamp()
          });
        }
      });

      await batch.commit();
    } catch (error) {
      throw error;
    }
  }

  // Permanently delete a chat: removes messages and the chat document
  async deleteChatPermanently(chatId) {
    try {
      if (!chatId) throw new Error('Chat ID is required');

      const chatRef = this.db.collection('chats').doc(chatId);
      const chatDoc = await chatRef.get();
      const participants = chatDoc.exists && chatDoc.data() && Array.isArray(chatDoc.data().participants)
        ? chatDoc.data().participants
        : [];

      // 1) Delete all messages in batches
      const messagesRef = chatRef.collection('messages');
      let lastDoc = null;
      // Use paginated deletion to avoid loading too many docs
      // Loop until no more messages
      // Note: mobile clients should keep batch sizes modest
      while (true) {
        let query = messagesRef.orderBy('createdAt').limit(200);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snap = await query.get();
        if (snap.empty) break;
        const batch = this.db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 200) break;
      }

      // 2) Delete the chat document itself
      await chatRef.delete();

      return true;
    } catch (error) {
      throw error;
    }
  }

  // Get user's chats (participants-based)
  async getUserChats(userId) {
    try {
      const chatsSnapshot = await this.db
        .collection('chats')
        .where('participants', 'array-contains', userId)
        .orderBy('updatedAt', 'desc')
        .get();

      return chatsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      return [];
    }
  }

  // Get pending message requests for user
async getPendingMessageRequestsSent(userId) {
  try {
    const snapshot = await this.db
      .collection('messageRequests')
      .where('senderId', '==', userId)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();

    // Fetch recipient info for each request
    const requests = await Promise.all(snapshot.docs.map(async doc => {
      const data = doc.data();
      const recipientInfo = await getUserProfile(data.recipientId);
      return {
        id: doc.id,
        ...data,
        recipientInfo,
        recipientName: recipientInfo?.displayName || recipientInfo?.username || recipientInfo?.name || 'Unknown',
      };
    }));

    return requests;
  } catch (error) {
    return [];
  }
}
  // Get received message requests
  async getReceivedMessageRequests(userId) {
    try {
      const snapshot = await this.db
        .collection('messageRequests')
        .where('recipientId', '==', userId)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      return [];
    }
  }

  // Listen to chat messages
  subscribeToMessages(chatId, callback) {
    return this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(callback);
  }

  // Listen to user's chats (participants-based)
  subscribeToUserChats(userId, callback) {
    return this.db
      .collection('chats')
      .where('participants', 'array-contains', userId)
      .onSnapshot((snapshot) => {
        const chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(chats);
      });
  }

  // Listen to message requests
  subscribeToMessageRequests(userId, callback, errorCallback = null) {
  if (!userId) {
    return () => {};
  }

  try {
    return this.db
      .collection('messageRequests')
      .where('recipientId', '==', userId)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        async (snapshot) => {
          try {
            if (!snapshot || !snapshot.docs) {
              callback([]);
              return;
            }

           

            // Fetch sender info for each request
            const requests = await Promise.all(snapshot.docs.map(async doc => {
              try {
                const data = doc.data();
               
                
                // Use cached sender info if available, otherwise fetch fresh
                let senderInfo = data.senderInfo;
                if (!senderInfo || !senderInfo.name) {
                  const senderProfile = await getUserProfile(data.senderId);
                  senderInfo = {
                    id: data.senderId,
                    name: senderProfile?.name || senderProfile?.displayName || senderProfile?.username || 'Unknown',
                    avatar: senderProfile?.avatar || senderProfile?.photoURL || null,
                    username: senderProfile?.username || 'unknown'
                  };
                }
                
                return {
                  id: doc.id,
                  ...data,
                  senderInfo
                };
              } catch (error) {
                // Return partial data even if sender info fails
                return {
                  id: doc.id,
                  ...doc.data(),
                  senderInfo: {
                    id: doc.data().senderId,
                    name: 'Unknown',
                    avatar: null,
                    username: 'unknown'
                  }
                };
              }
            }));

            callback(requests);
          } catch (error) {
            if (errorCallback) errorCallback(error);
          }
        },
        (error) => {
          if (errorCallback) errorCallback(error);
        }
      );
  } catch (error) {
    if (errorCallback) errorCallback(error);
    return () => {};
  }
}

 deleteMessageRequest = async (requestId) => {
  try {
    if (!requestId) {
      throw new Error('Request ID is required');
    }

    // Delete the message request document from Firestore
    await firestore()
      .collection('messageRequests')
      .doc(requestId)
      .delete();

    
    return true;
  } catch (error) {
    throw error;
  }
};
async checkExistingChat(userId1, userId2) {
  try {
    const chatId = this.generateDirectChatId(userId1, userId2);
    const chatDoc = await this.db.collection('chats').doc(chatId).get();
    
    // First check if document exists
    if (chatDoc.exists) {
      const chatData = chatDoc.data();
      
      // Then check if data is valid before accessing properties
      if (chatData) {
        return {
          exists: chatData.isActive !== false, // Default to true if isActive is undefined
          chatId: chatId,
          chatData: chatData
        };
      }
    }
    
    return { exists: false, chatId: null };
    
  } catch (error) {
    return { exists: false, chatId: null };
  }
}
  
}

const chatServiceInstance = new chatService();
export default chatServiceInstance;