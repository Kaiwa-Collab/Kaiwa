import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';
import { Alert } from 'react-native';
// import functions from '@react-native-firebase/functions';

async function getUserProfile(uid) {
  const doc = await firestore().collection('profile').doc(uid).get();
  return doc.exists ? doc.data() : null;
}

class chatService {
  constructor() {
    this.db = firestore();
    this.functions = functions();
  }

  generateGroupChatId() {
    return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateDirectChatId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
  }

   async ensureAuthenticated() {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User must be authenticated');
    }
    return currentUser;
  }

  // Check mutual follow (kept client-side - it's fast)
  async checkMutualFollow(userId1, userId2) {
    try {
      if (!userId1 || typeof userId1 !== 'string' || !userId2 || typeof userId2 !== 'string') {
        return false;
      }

      if (userId1 === userId2) {
        return false;
      }

      const [user1FollowsUser2Doc, user2FollowsUser1Doc] = await Promise.all([
        this.db.collection('profile').doc(userId1).collection('following').doc(userId2).get(),
        this.db.collection('profile').doc(userId2).collection('following').doc(userId1).get()
      ]);

      return user1FollowsUser2Doc.exists() && user2FollowsUser1Doc.exists();
    } catch (error) {
      return false;
    }
  }

  // Send message request (kept client-side - it's simple)
  async sendMessageRequest(senderId, recipientId, message='Hey, I would like to connect with you!') {
    try {
      const existingRequest = await this.db
        .collection('messageRequests')
        .where('senderId', '==', senderId)
        .where('recipientId', '==', recipientId)
        .where('status', '==', 'pending')
        .get();

      if (!existingRequest.empty) {
        Alert.alert('Message request already sent');
        return;
      }

       // Fetch both profiles in parallel
    const [senderDoc, recipientDoc] = await Promise.all([
      this.db.collection('profile').doc(senderId).get(),
      this.db.collection('profile').doc(recipientId).get()
    ]);

    if (!senderDoc.exists) {
      throw new Error('Sender profile not found');
    }

    const senderInfo = senderDoc.data();
    const recipientInfo = recipientDoc.exists ? recipientDoc.data() : null;

    const requestData = {
      senderId,
      recipientId,
      message,
      status: 'pending',
      createdAt: firestore.FieldValue.serverTimestamp(),
      senderInfo: {
        id: senderId,
        name: senderInfo.name || senderInfo.displayName || senderInfo.username || 'Unknown',
        avatar: senderInfo.avatar || senderInfo.photoURL || null,
        username: senderInfo.username || 'unknown'
      },
      // ← this was missing entirely
      recipientInfo: {
        id: recipientId,
        name: recipientInfo?.name || recipientInfo?.displayName || recipientInfo?.username || 'Unknown',
        avatar: recipientInfo?.avatar || recipientInfo?.photoURL || null,
        username: recipientInfo?.username || 'unknown'
      },
      recipientName: recipientInfo?.name || recipientInfo?.displayName || recipientInfo?.username || 'Unknown'
    };

    const requestRef = await this.db.collection('messageRequests').add(requestData);
    return requestRef.id;
  } catch (error) {
    throw error;
  }
}

  // MOVED TO SERVER: Accept message request
  async acceptMessageRequest(requestId, recipientId) {
    try {
      const result = await this.functions.httpsCallable('acceptMessageRequest')({
        requestId,
        recipientId
      });

      return result.data;
    } catch (error) {
      console.error('Error accepting request:', error);
      throw new Error(error.message || 'Failed to accept message request');
    }
  }

  // Reject message request (kept client-side - simple update)
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

  // MOVED TO SERVER: Create direct chat
  async createDirectChat(userId1, userId2, customChatId = null) {
    try {
      const result = await this.functions.httpsCallable('createDirectChat')({
        userId1,
        userId2,
        customChatId
      });

      return result.data;
    } catch (error) {
      console.error('Error creating direct chat:', error);
      throw new Error(error.message || 'Failed to create chat');
    }
  }

  // Ensure chat participants (simplified - mainly for edge cases)
  async ensureChatParticipants(chatId, userId1, userId2) {
    try {
      if (!chatId || !userId1 || !userId2) {
        return false;
      }

      const chatRef = this.db.collection('chats').doc(chatId);
      const chatDoc = await chatRef.get();

      if (!chatDoc.exists) {
        await this.createDirectChat(userId1, userId2, chatId);
        return true;
      }

      const chatData = chatDoc.data() || {};
      const existingParticipants = Array.isArray(chatData.participants) ? chatData.participants : [];

      const hasUser1 = existingParticipants.includes(userId1);
      const hasUser2 = existingParticipants.includes(userId2);

      if (hasUser1 && hasUser2) {
        return true;
      }

      const updatedParticipants = Array.from(new Set([...existingParticipants, userId1, userId2]));

      await chatRef.set(
        {
          participants: updatedParticipants,
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

  // MOVED TO SERVER: Create group chat
  async createGroupChat(creatorId, participantIds, groupName, groupDescription = '') {
    try {
      const result = await this.functions.httpsCallable('createGroupChat')({
        creatorId,
        participantIds,
        groupName,
        groupDescription
      });

      return result.data;
    } catch (error) {
      console.error('Error creating group chat:', error);
      throw new Error(error.message || 'Failed to create group chat');
    }
  }

  // Send message (kept client-side for instant feedback)
  async sendMessage(chatId, senderId, text, mediaUrl = null, mediaType = null) {
    try {
      if (!chatId || !senderId) {
        throw new Error('Chat ID and sender ID are required');
      }

      if (!text && !mediaUrl) {
        throw new Error('Message must have text or media');
      }

      // Verify chat exists
      const chatRef = this.db.collection('chats').doc(chatId);
      const chatDoc = await chatRef.get();
      
      if (!chatDoc.exists) {
        throw new Error('Chat not found');
      }

      const chatData = chatDoc.data();
      
      if (!chatData || !chatData.participants || !Array.isArray(chatData.participants)) {
        throw new Error('Chat data is invalid');
      }
      
      if (!chatData.participants.includes(senderId)) {
        throw new Error('Sender is not a participant in this chat');
      }

      let finalMessageType = 'text';
      if (mediaUrl && mediaType) {
        finalMessageType = mediaType;
      } else if (mediaUrl) {
        if (mediaUrl.includes('.mp4') || mediaUrl.includes('.mov')) {
          finalMessageType = 'video';
        } else if (mediaUrl.includes('.jpg') || mediaUrl.includes('.png') || mediaUrl.includes('.jpeg') || mediaUrl.includes('.gif')) {
          finalMessageType = 'image';
        }
      }

      const messageData = {
        senderId,
        text: text || '',
        imageUrl: finalMessageType === 'image' ? mediaUrl : null,
        videoUrl: finalMessageType === 'video' ? mediaUrl : null,
        messageType: finalMessageType,
        createdAt: firestore.FieldValue.serverTimestamp(),
        readBy: {
          [senderId]: firestore.FieldValue.serverTimestamp()
        },
        deliveredTo: {},
        edited: false
      };

      const messageRef = await this.db
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .add(messageData);

      // Update handled by Cloud Function trigger now
      // But we'll keep this for redundancy
      const lastMessageText = text || (mediaType === 'image' ? '📷 Photo' : mediaType === 'video' ? '📹 Video' : 'Media');
      
      await chatRef.update({
        lastMessage: {
          id: messageRef.id,
          senderId,
          text: lastMessageText,
          createdAt: firestore.FieldValue.serverTimestamp()
        },
        updatedAt: firestore.FieldValue.serverTimestamp()
      });

      return { id: messageRef.id, ...messageData };
    } catch (error) {
      throw error;
    }
  }

  // MOVED TO SERVER: Mark messages as read
  async markMessagesAsRead(chatId, userId) {
    try {
      // Ensure user is authenticated
      const currentUser = await this.ensureAuthenticated();
      
      // Verify the userId matches the authenticated user
      if (currentUser.uid !== userId) {
        console.warn('User ID mismatch. Using authenticated user ID.');
      }

      const markMessagesAsReadFn = this.functions.httpsCallable('markMessagesAsRead');
      const result = await markMessagesAsReadFn({
        chatId,
        userId: currentUser.uid // Always use the authenticated user's ID
      });

      return result.data;
    } catch (error) {
      console.error('Error marking messages as read:', error);
      // Don't throw - this is a background operation
      return { success: false };
    }
  }
  // MOVED TO SERVER: Delete chat permanently
  async deleteChatPermanently(chatId) {
    try {
      const result = await this.functions.httpsCallable('deleteChatPermanently')({
        chatId
      });

      return result.data;
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw new Error(error.message || 'Failed to delete chat');
    }
  }

  // Get user's chats (kept client-side - uses Firestore indexing)
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

  // Delete chat for user (kept client-side)
  async deleteChatForUser(chatId, userId) {
    try {
      if (!chatId || !userId) {
        throw new Error('Chat ID and user ID are required');
      }

      const chatRef = this.db.collection('chats').doc(chatId);

      await chatRef.set(
        {
          deletedFor: {
            [userId]: true,
          },
        },
        { merge: true }
      );

      const userChatRef = this.db
        .collection('userChats')
        .doc(userId)
        .collection('chats')
        .doc(chatId);

      await userChatRef.delete();

      // Check if all participants deleted
      const updatedChatDoc = await chatRef.get();
      if (updatedChatDoc.exists) {
        const chatData = updatedChatDoc.data() || {};
        const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
        const deletedFor = chatData.deletedFor || {};

        if (participants.length > 0) {
          const allDeleted = participants.every(id => deletedFor[id]);

          if (allDeleted) {
            await this.deleteChatPermanently(chatId);
          }
        }
      }

      return true;
    } catch (error) {
      throw error;
    }
  }

  // Get pending message requests sent (kept client-side)
  async getPendingMessageRequestsSent(userId) {
    try {
      const snapshot = await this.db
        .collection('messageRequests')
        .where('senderId', '==', userId)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .get();

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

  // Get received message requests (kept client-side)
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

  // Subscribe to messages (kept client-side - real-time)
  subscribeToMessages(chatId, callback) {
    return this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(callback);
  }

  // Subscribe to user's chats (kept client-side - real-time)
  subscribeToUserChats(userId, callback) {
    return this.db
      .collection('chats')
      .where('participants', 'array-contains', userId)
      .onSnapshot((snapshot) => {
        const chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(chats);
      });
  }

  // Subscribe to message requests (kept client-side - real-time)
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

              const requests = await Promise.all(snapshot.docs.map(async doc => {
                try {
                  const data = doc.data();
                  
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

  // Delete message request (kept client-side)
  deleteMessageRequest = async (requestId) => {
    try {
      if (!requestId) {
        throw new Error('Request ID is required');
      }

      await firestore()
        .collection('messageRequests')
        .doc(requestId)
        .delete();

      return true;
    } catch (error) {
      throw error;
    }
  };

  // Check existing chat (kept client-side)
  async checkExistingChat(userId1, userId2) {
    try {
      const chatId = this.generateDirectChatId(userId1, userId2);
      const chatDoc = await this.db.collection('chats').doc(chatId).get();
      
      if (chatDoc.exists) {
        const chatData = chatDoc.data();
        
        if (chatData) {
          return {
            exists: chatData.isActive !== false,
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