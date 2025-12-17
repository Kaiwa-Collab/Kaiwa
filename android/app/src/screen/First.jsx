import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
  TextInput,
  Keyboard,
  ActivityIndicator,
  Image,
  Alert,
  SafeAreaView,
} from 'react-native';
import ConversationsScreen from './ConversationsScreen';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useUserData } from '../users';
import Icon from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import chatService from './chatService';
import auth from '@react-native-firebase/auth';

const Drawer = createDrawerNavigator();

const PERMISSIONs_REQUESTED_KEY='@permissions_requested'

// Platform-specific status bar height helper
const getStatusBarHeight = () => {
  return Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
};

// Helper function to deep compare arrays of objects
const arraysEqual = (a, b) => {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const bItem = b[index];
    if (!bItem) return false;
    // Compare key properties that matter for UI updates
    return item.id === bItem.id &&
           item.conversationId === bItem.conversationId &&
           item.lastMessage === bItem.lastMessage &&
           item.unreadCount === bItem.unreadCount &&
           item.isPinned === bItem.isPinned;
  });
};

// Helper function to compare request arrays
const requestsEqual = (a, b) => {
  if (a.length !== b.length) return false;
  const aIds = a.map(r => r.id || r.senderId).sort();
  const bIds = b.map(r => r.id || r.senderId).sort();
  return JSON.stringify(aIds) === JSON.stringify(bIds);
};

// Custom Drawer Content
function CustomDrawerContent({ navigation }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [activeConversations, setActiveConversations] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [drawerWasClosed, setDrawerWasClosed] = useState(false);
  const isFocused = useIsFocused();
  
  // Refs to store previous values for change detection
  const prevConversationsRef = useRef([]);
  const prevReceivedRequestsRef = useRef([]);
  const prevPendingRequestsRef = useRef([]);
  const prevDrawerFocusedRef = useRef(false);

  // Track when drawer is closed
  useEffect(() => {
    if (!isFocused) {
      setDrawerWasClosed(true);
    }
  }, [isFocused]);

  // Get data from UserDataContext
  const {
    loading: contextLoading,
    getCachedImageUri,
    currentUser,
  } = useUserData();

  // Enhanced error handling for conversations loading
 const loadActiveConversations = () => {
  const currentUserId = currentUser?.uid || auth().currentUser?.uid;
  if (!currentUserId) {
    
    return;
  }

  setLoading(true);

  // First, let's check if the userChats document exists
  const userChatsDocRef = firestore().collection('userChats').doc(currentUserId);
  userChatsDocRef.get().then(doc => {
    
    // if (doc.exists) {
    //   console.log('UserChats document data:', doc.data());
    // }
  });

  // Also check the chats subcollection directly
  firestore()
    .collection('userChats')
    .doc(currentUserId)
    .collection('chats')
    .get()
    .then(snapshot => {
     
      snapshot.docs.forEach(doc => {
       
      });
      
      // If no userChats exist, log it but don't auto-create
      if (snapshot.empty) {
       
      }
    })
    .catch(error => {
      // Error querying userChats subcollection
    });

  // Create real-time listener for user's chats with enhanced error handling
  const unsubscribe = firestore()
    .collection('userChats')
    .doc(currentUserId)
    .collection('chats')
    .orderBy('joinedAt', 'desc') // Changed from lastReadAt to joinedAt for persistence
    .onSnapshot(
      async (userChatsSnapshot) => {
        try {
         
          
          if (userChatsSnapshot.empty) {
           
            // Fallback: Load conversations directly from chats collection
            try {
              
              
              const chatsSnapshot = await firestore()
                .collection('chats')
                .where('participants', 'array-contains', currentUserId)
                .get();
              
             
              
              // Also check all chats to see what's available
              const allChatsSnapshot = await firestore()
                .collection('chats')
                .get();
              
            
              allChatsSnapshot.docs.forEach(doc => {
                const chatData = doc.data();
              
              });
              
              if (chatsSnapshot.empty) {
               
                setActiveConversations([]);
                setLoading(false);
                return;
              }
              
              // Process chats directly
              const conversations = [];
              for (const chatDoc of chatsSnapshot.docs) {
                const chatData = chatDoc.data();
                const chatId = chatDoc.id;
                const chatType = chatData.type || 'direct';
                
               
                
                // Skip inactive chats
                if (chatData.isActive === false) {
                 
                  continue;
                }
                
                let conversationItem;
                
                // Handle group chats differently from direct chats
                if (chatType === 'group') {
                  // For group chats, use chatId as the unique identifier
                  conversationItem = {
                    id: chatId, // Use chatId for groups to ensure uniqueness
                    conversationId: chatId,
                    type: 'group',
                    name: chatData.metadata?.name || 'Group Chat',
                    displayName: chatData.metadata?.name || 'Group Chat',
                    avatar: chatData.metadata?.avatar || null,
                    username: 'group',
                    lastMessage: chatData.lastMessage?.text || '',
                    lastMessageTime: chatData.lastMessage?.createdAt || chatData.updatedAt || chatData.createdAt,
                    unreadCount: 0,
                    isPinned: false,
                    isArchived: false,
                    joinedAt: chatData.createdAt,
                    participants: chatData.participants || [],
                    participantsInfo: chatData.participantsInfo || {}
                  };
                } else {
                  // Handle direct chats - find other participant
                  let participants = chatData.participants;
                  if (!participants || !Array.isArray(participants) || participants.length === 0) {
                   
                    
                    // Try to extract participants from chat ID (common pattern: userId1_userId2)
                    if (chatId.includes('_') && !chatId.startsWith('group_')) {
                      const possibleUserIds = chatId.split('_');
                      participants = possibleUserIds.filter(id => id && id.length > 10); // Filter out short IDs
                     
                      
                      // Update the chat document with the extracted participants
                      try {
                        await firestore().collection('chats').doc(chatId).update({
                          participants: participants,
                          isActive: true,
                          type: 'direct',
                          updatedAt: firestore.FieldValue.serverTimestamp()
                        });
                       
                      } catch (updateError) {
                        // Error updating chat participants
                      }
                    } else {
                     
                      continue;
                    }
                  }
                  
                  const otherParticipantId = participants.find(id => id !== currentUserId);
                  if (!otherParticipantId) {
                   
                    continue;
                  }
                  
                  let participantInfo = chatData.participantsInfo?.[otherParticipantId];
                  
                  if (!participantInfo || !participantInfo.name) {
                    try {
                      const userDoc = await firestore()
                        .collection('profile')
                        .doc(otherParticipantId)
                        .get();
                      
                      if (userDoc.exists) {
                        const userData = userDoc.data();
                        participantInfo = {
                          id: otherParticipantId,
                          name: userData.name || userData.displayName || userData.username || 'Unknown User',
                          displayName: userData.displayName || userData.name || userData.username || 'Unknown User',
                          avatar: userData.avatar || userData.photoURL || null,
                          username: userData.username || 'unknown'
                        };
                      } else {
                        participantInfo = {
                          id: otherParticipantId,
                          name: 'Unknown User',
                          displayName: 'Unknown User',
                          avatar: null,
                          username: 'unknown'
                        };
                      }
                    } catch (profileError) {
                      participantInfo = {
                        id: otherParticipantId,
                        name: 'Unknown User',
                        displayName: 'Unknown User',
                        avatar: null,
                        username: 'unknown'
                      };
                    }
                  }
                  
                  // For direct chats, use conversationId as unique identifier to avoid duplicates
                  conversationItem = {
                    id: `direct_${chatId}`, // Prefix with direct_ to ensure uniqueness
                    conversationId: chatId,
                    type: 'direct',
                    ...participantInfo,
                    lastMessage: chatData.lastMessage?.text || '',
                    lastMessageTime: chatData.lastMessage?.createdAt || chatData.updatedAt || chatData.createdAt,
                    unreadCount: 0,
                    isPinned: false,
                    isArchived: false,
                    joinedAt: chatData.createdAt
                  };
                }
                
                conversations.push(conversationItem);
                
                // Create userChats entry for this chat if it doesn't exist
                try {
                  const userChatRef = firestore()
                    .collection('userChats')
                    .doc(currentUserId)
                    .collection('chats')
                    .doc(chatId);
                  
                  const userChatDoc = await userChatRef.get();
                  if (!userChatDoc.exists) {
                  
                    await userChatRef.set({
                      chatId,
                      lastReadAt: firestore.FieldValue.serverTimestamp(),
                      unreadCount: 0,
                      isPinned: false,
                      isArchived: false,
                      joinedAt: chatData.createdAt || firestore.FieldValue.serverTimestamp()
                    });
                  }
                } catch (userChatError) {
                  // Error creating userChat entry
                }
              }
              
              conversations.sort((a, b) => {
                const aTime = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
                const bTime = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
                return bTime - aTime;
              });
              
              // Only update if conversations actually changed
              if (!arraysEqual(conversations, prevConversationsRef.current)) {
                prevConversationsRef.current = conversations;
                setActiveConversations(conversations);
              }
              if (isInitialLoad) {
                setLoading(false);
                setIsInitialLoad(false);
              }
              return;
              
            } catch (fallbackError) {
              setActiveConversations([]);
              if (isInitialLoad) {
                setLoading(false);
                setIsInitialLoad(false);
              }
              return;
            }
          }

          const chatIds = userChatsSnapshot.docs.map(doc => doc.data().chatId);
      
          
          const conversations = [];

          // Process chats in smaller batches to avoid overwhelming Firestore
          const batchSize = 10;
          for (let i = 0; i < chatIds.length; i += batchSize) {
            const batch = chatIds.slice(i, i + batchSize);
            
            // Use Promise.allSettled to handle individual chat failures gracefully
            const chatPromises = batch.map(async (chatId) => {
              try {
               
                
                const chatDoc = await firestore()
                  .collection('chats')
                  .doc(chatId)
                  .get();
                
                if (!chatDoc.exists) {
                  
                  return null;
                }

                const chatData = chatDoc.data();
              
                
                // Enhanced validation of chat data
                if (!chatData) {
                  return null;
                }
                
                // Handle missing participants by extracting from chat ID
                let participants = chatData.participants;
                if (!participants || !Array.isArray(participants) || participants.length === 0) {
                 
                  
                  // Try to extract participants from chat ID (common pattern: userId1_userId2)
                  if (chatId.includes('_')) {
                    const possibleUserIds = chatId.split('_');
                    participants = possibleUserIds.filter(id => id && id.length > 10); // Filter out short IDs
                   
                    // Update the chat document with the extracted participants
                    try {
                      await firestore().collection('chats').doc(chatId).update({
                        participants: participants,
                        isActive: true,
                        type: 'direct',
                        updatedAt: firestore.FieldValue.serverTimestamp()
                      });
                     
                    } catch (updateError) {
                      // Error updating chat participants
                    }
                  } else {
                   
                    return null;
                  }
                }

                // Only show active chats
                if (chatData.isActive === false) {
                  
                  return null;
                }

                const otherParticipantId = participants.find(id => id !== currentUserId);
                if (!otherParticipantId) {
                 
                  return null;
                }

                // Try to get participant info from chat data first
                let participantInfo = chatData.participantsInfo?.[otherParticipantId];
                
                // If not available, fetch from profile collection and cache it
                if (!participantInfo || !participantInfo.name) {
                 
                  
                  try {
                    const userDoc = await firestore()
                      .collection('profile')
                      .doc(otherParticipantId)
                      .get();
                    
                    if (userDoc.exists) {
                      const userData = userDoc.data();
                      participantInfo = {
                        id: otherParticipantId,
                        name: userData.name || userData.displayName || userData.username || 'Unknown User',
                        displayName: userData.displayName || userData.name || userData.username || 'Unknown User',
                        avatar: userData.avatar || userData.photoURL || null,
                        username: userData.username || 'unknown'
                      };
                      
                      // Cache participant info in chat document for future use
                      try {
                        await firestore().collection('chats').doc(chatId).update({
                          [`participantsInfo.${otherParticipantId}`]: participantInfo,
                          updatedAt: firestore.FieldValue.serverTimestamp()
                        });
                      
                      } catch (updateError) {
                        // Continue without caching
                      }
                    } else {
                      participantInfo = {
                        id: otherParticipantId,
                        name: 'Unknown User',
                        displayName: 'Unknown User',
                        avatar: null,
                        username: 'unknown'
                      };
                    }
                  } catch (profileError) {
                    participantInfo = {
                      id: otherParticipantId,
                      name: 'Unknown User',
                      displayName: 'Unknown User',
                      avatar: null,
                      username: 'unknown'
                    };
                  }
                }

                // Get user chat data for unread count
                const userChatData = userChatsSnapshot.docs
                  .find(doc => doc.data().chatId === chatId)?.data();

                // For direct chats, use conversationId as unique identifier to avoid duplicates
                const conversationItem = {
                  id: `direct_${chatId}`, // Prefix with direct_ to ensure uniqueness
                  conversationId: chatId,
                  type: 'direct',
                  ...participantInfo,
                  lastMessage: chatData.lastMessage?.text || '',
                  lastMessageTime: chatData.lastMessage?.createdAt || chatData.updatedAt || chatData.createdAt,
                  unreadCount: userChatData?.unreadCount || 0,
                  isPinned: userChatData?.isPinned || false,
                  isArchived: userChatData?.isArchived || false,
                  joinedAt: userChatData?.joinedAt || chatData.createdAt
                };

               
                
                // Ensure userChats entry exists for this chat
                if (!userChatData) {
                  try {
                    const userChatRef = firestore()
                      .collection('userChats')
                      .doc(currentUserId)
                      .collection('chats')
                      .doc(chatId);
                    
                    const userChatDoc = await userChatRef.get();
                    if (!userChatDoc.exists) {
                     
                      await userChatRef.set({
                        chatId,
                        lastReadAt: firestore.FieldValue.serverTimestamp(),
                        unreadCount: 0,
                        isPinned: false,
                        isArchived: false,
                        joinedAt: chatData.createdAt || firestore.FieldValue.serverTimestamp()
                      });
                    }
                  } catch (userChatError) {
                    // Error creating userChat entry
                  }
                }
                
                return conversationItem;
                
              } catch (error) {
                return null;
              }
            });

            const batchResults = await Promise.allSettled(chatPromises);
            
            batchResults.forEach((result, index) => {
              if (result.status === 'fulfilled' && result.value) {
                conversations.push(result.value);
              } else if (result.status === 'rejected') {
                // Chat processing failed
              }
            });
          }

          // Sort conversations: pinned first, then by last message time
          conversations.sort((a, b) => {
            // Pinned items first
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            
            // Then by last message time (most recent first)
            const aTime = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
            const bTime = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
            return bTime - aTime;
          });

          // Only update if conversations actually changed
          if (!arraysEqual(conversations, prevConversationsRef.current)) {
            prevConversationsRef.current = conversations;
            setActiveConversations(conversations);
          }
          if (isInitialLoad) {
            setLoading(false);
            setIsInitialLoad(false);
          }
          
        } catch (error) {
          if (isInitialLoad) {
            setLoading(false);
            setIsInitialLoad(false);
          }
          
          // Don't show alert on first load failure, just retry
          setTimeout(() => {
            
            loadActiveConversations();
          }, 3000);
        }
      },
      (error) => {
        if (isInitialLoad) {
          setLoading(false);
          setIsInitialLoad(false);
        }
        
        // Attempt to reconnect after error
        setTimeout(() => {
         
          loadActiveConversations();
        }, 5000);
      }
    );

  return unsubscribe;
};

  // Set up listeners only once when component mounts
useEffect(() => {
  let unsubscribeConversations = null;
  let unsubscribeRequests = null;
  
  if (currentUser) {
    
    unsubscribeConversations = loadActiveConversations();
    unsubscribeRequests = loadMessageRequests();
  }
  
  return () => {
   
    if (unsubscribeConversations) {
      unsubscribeConversations();
    }
    if (unsubscribeRequests) {
      unsubscribeRequests();
    }
  };
}, [currentUser?.uid]); // Only depend on user ID, not the entire user object

// Add a function to manually refresh conversations (useful for when returning from chat)
const refreshConversations = React.useCallback(() => {
  if (currentUser) {
    
    loadActiveConversations();
  }
}, [currentUser]);

  // Load and listen to message requests
  const loadMessageRequests = () => {
    const currentUserId = currentUser?.uid || auth().currentUser?.uid;
    if (!currentUserId) return;

    // Listen to received requests
    const unsubscribeReceived = chatService.subscribeToMessageRequests(
      currentUserId,
      (requests) => {
        // Only update if requests actually changed
        if (!requestsEqual(requests, prevReceivedRequestsRef.current)) {
          prevReceivedRequestsRef.current = requests;
          setReceivedRequests(requests);
        }
      },
      (error) => {
        // Error loading message requests
      }
    );

    // Listen to sent requests
    const unsubscribeSent = firestore()
      .collection('messageRequests')
      .where('senderId', '==', currentUserId)
      .where('status', '==', 'pending')
      .onSnapshot(
        (snapshot) => {
          const requests = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          // Only update if requests actually changed
          if (!requestsEqual(requests, prevPendingRequestsRef.current)) {
            prevPendingRequestsRef.current = requests;
            setPendingRequests(requests);
          }
        },
        (error) => {
          // Error loading sent requests
        }
      );

    return () => {
      if (unsubscribeReceived) unsubscribeReceived();
      if (unsubscribeSent) unsubscribeSent();
    };
  };


  // Only refresh when drawer is actually reopened (not on every focus)
  useFocusEffect(
    React.useCallback(() => {
      if (currentUser) {
        // Only refresh if drawer was previously closed and is now opened
        const wasClosed = prevDrawerFocusedRef.current === false && isFocused === true;
        prevDrawerFocusedRef.current = isFocused;
        
        if (wasClosed && drawerWasClosed) {
          // Drawer was closed and is now reopened - refresh message requests
          // The real-time listener on userChats already handles conversation updates
          loadMessageRequests();
          setDrawerWasClosed(false);
        }
      }
    }, [currentUser, isFocused, drawerWasClosed])
  );

  // Memoize the combined list to prevent unnecessary recalculations
  const combinedList = useMemo(() => {
    return [...activeConversations, ...receivedRequests.map(req => ({
      id: req.senderId,
      name: req.senderInfo?.name || req.senderInfo?.displayName || 'Unknown User',
      displayName: req.senderInfo?.name || req.senderInfo?.displayName || 'Unknown User',
      avatar: req.senderInfo?.avatar || null,
      username: req.senderInfo?.username || 'unknown',
      isMessageRequest: true,
      requestMessage: req.message
    }))];
  }, [activeConversations, receivedRequests]);

  // Ref to store previous combined list for comparison
  const prevCombinedListRef = useRef([]);

  // Only update users list when combined list actually changes
  useEffect(() => {
    // Only update if the list actually changed
    if (!arraysEqual(combinedList, prevCombinedListRef.current)) {
      prevCombinedListRef.current = combinedList;
      setUsers(combinedList);
    }
  }, [combinedList]);

  // Enhanced search with better validation
  const handleSearch = async (text) => {
    setSearch(text);
    
    // When search is empty or less than 3 characters, show active conversations and received requests
    if (text.trim().length === 0 || text.trim().length < 3) {
      // Clear search suggestions and show chats
      const combinedList = [...activeConversations, ...receivedRequests.map(req => ({
        id: req.senderId,
        name: req.senderInfo?.name || req.senderInfo?.displayName || 'Unknown User',
        displayName: req.senderInfo?.name || req.senderInfo?.displayName || 'Unknown User',
        avatar: req.senderInfo?.avatar || null,
        username: req.senderInfo?.username || 'unknown',
        isMessageRequest: true,
        requestMessage: req.message
      }))];
      setUsers(combinedList);
      setLoading(false);
      
      // If no conversations are loaded yet, trigger a refresh
      if (activeConversations.length === 0 && !loading) {
        loadActiveConversations();
      }
      return;
    }

    setLoading(true);
    try {
      // Input validation and sanitization
      const sanitizedText = text.toLowerCase().trim().replace(/[^\w\s]/gi, '');
      if (sanitizedText.length === 0) {
        setUsers([]);
        setLoading(false);
        return;
      }
      
      let querySnapshot = await firestore()
        .collection('profile')
        .orderBy('username')
        .startAt(sanitizedText)
        .endAt(sanitizedText + '\uf8ff')
        .limit(20)
        .get();

      let usersList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Fallback search if no results
      if (usersList.length === 0) {
        const allUsersSnapshot = await firestore()
          .collection('profile')
          .limit(100)
          .get();

        const allUsers = allUsersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        usersList = allUsers.filter(user => {
          const username = (user.username || '').toLowerCase();
          const name = (user.name || '').toLowerCase();
          const displayName = (user.displayName || '').toLowerCase();
          const searchLower = sanitizedText;
          
          return username.includes(searchLower) || 
                 name.includes(searchLower) ||
                 displayName.includes(searchLower);
        });
      }
      
      const filteredUsers = usersList.filter(user => user.id !== currentUser);
      
      // Check mutual follow status for each user
      const usersWithFollowStatus = await Promise.all(
        filteredUsers.map(async (user) => {
          try {
            const isMutualFollow = await chatService.checkMutualFollow(currentUser.uid, user.id);
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
      
      // Sort: active conversations first, then mutual followers, then others
      const sortedFiltered = usersWithFollowStatus.sort((a, b) => {
        const aHasConversation = activeConversations.some(conv => conv.id === a.id);
        const bHasConversation = activeConversations.some(conv => conv.id === b.id);
        
        if (aHasConversation && !bHasConversation) return -1;
        if (!aHasConversation && bHasConversation) return 1;
        
        // Then sort by mutual follow status
        if (a.isMutualFollow && !b.isMutualFollow) return -1;
        if (!a.isMutualFollow && b.isMutualFollow) return 1;
        
        return 0;
      });
      
      setUsers(sortedFiltered);
    } catch (err) {
      Alert.alert('Search Error', 'Could not search users. Please try again.');
      setUsers([]);
    }
    setLoading(false);
  };

  // Enhanced chat press handler with validation
  const handleChatPress = async (item) => {
    Keyboard.dismiss();

    try {
      const currentUserId = currentUser?.uid || auth().currentUser?.uid;
      if (!currentUserId) {
        Alert.alert('Error', 'You must be logged in to send messages');
        return;
      }
      
      // Input validation
      if (!item || !item.id) {
        Alert.alert('Error', 'Invalid user selected');
        return;
      }

      const hasActiveChat = activeConversations.some(conv => conv.id === item.id);
      
      if (hasActiveChat) {
        const conversation = activeConversations.find(conv => conv.id === item.id);
        
        navigation.getParent().navigate('ChatScreen', {
          chatId: conversation.conversationId || item.id,
          title: item.displayName || item.name || item.username || 'Unknown User',
          avatar: getCachedImageUri(item.avatar || item.photoURL || ''),
          userId: item.id,
        });
        return;
      }

      // Check for existing chat before checking mutual follow
      const existingChatCheck = await chatService.checkExistingChat(currentUserId, item.id);
      if (existingChatCheck.exists) {
        // Ensure userChats entry exists for this chat
        await chatService.ensureUserChatEntries(existingChatCheck.chatId, [currentUserId, item.id]);
        // Ensure participants are present immediately
        await chatService.ensureChatParticipants(existingChatCheck.chatId, currentUserId, item.id);
        
        navigation.getParent().navigate('ChatScreen', {
          chatId: existingChatCheck.chatId,
          title: item.displayName || item.name || item.username || 'Unknown User',
          avatar: getCachedImageUri(item.avatar || item.photoURL || ''),
          userId: item.id,
        });
        return;
      }

      // Check mutual follow status
      const areMutualFollowers = await chatService.checkMutualFollow(currentUserId, item.id);

      if (areMutualFollowers) {
        const conversationData = await chatService.createDirectChat(currentUserId, item.id);
        const conversationId = conversationData.id;

        // Ensure participants and participantsInfo are set immediately
        await chatService.ensureChatParticipants(conversationId, currentUserId, item.id);

        navigation.getParent().navigate('ChatScreen', {
          chatId: conversationId || item.id,
          title: item.displayName || item.name || item.username || 'Unknown User',
          avatar: getCachedImageUri(item.avatar || item.photoURL || ''),
          userId: item.id,
          isDirectMessage: true,
        });
      } else {
        // Navigate to ChatScreen in message request mode
        navigation.getParent().navigate('ChatScreen', {
          chatId: `temp_request_${item.id}`,
          title: item.displayName || item.name || item.username || 'Unknown User',
          avatar: getCachedImageUri(item.avatar || item.photoURL || ''),
          userId: item.id,
          isMessageRequest: true,
          recipientInfo: {
            id: item.id,
            name: item.displayName || item.name || item.username || 'Unknown User',
            avatar: item.avatar || item.photoURL || '',
            username: item.username || ''
          }
        });
      }
    } catch (error) {
      Alert.alert("Error", `Something went wrong: ${error.message || 'Please try again.'}`);
    }
  };

  const clearSearch = () => {
    setSearch('');
    handleSearch('');
    Keyboard.dismiss();
  };

  // Function to automatically create userChats for existing chats (Instagram-like)
  const autoCreateUserChats = async () => {
    try {
      
      
      const currentUserId = currentUser?.uid || auth().currentUser?.uid;
      if (!currentUserId) {
        return;
      }

      // First, check and fix any chats with missing participants
      const allChatsSnapshot = await firestore()
        .collection('chats')
        .get();

    
      
      let fixedParticipants = 0;
      for (const chatDoc of allChatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const chatId = chatDoc.id;
        
        // Check if participants field is missing or undefined
        if (!chatData.participants || chatData.participants === undefined) {
          
          
          // Try to determine participants from the chat ID or other data
          let participants = [currentUserId]; // Add current user
          
          // Check if chat ID contains user IDs (common pattern: userId1_userId2)
          if (chatId.includes('_')) {
            const possibleUserIds = chatId.split('_');
            // Filter out the current user and add the other user
            const otherUserId = possibleUserIds.find(id => id !== currentUserId && id.length > 10);
            if (otherUserId) {
              participants = [currentUserId, otherUserId];
             
            }
          }
          
          // If we still only have one participant, try to find from profile collection
          if (participants.length === 1) {
            try {
              // Get a random user from profile collection as the other participant
              const profileSnapshot = await firestore()
                .collection('profile')
                .limit(1)
                .get();
              
              if (!profileSnapshot.empty) {
                const otherUser = profileSnapshot.docs[0];
                if (otherUser.id !== currentUserId) {
                  participants = [currentUserId, otherUser.id];
                 
                }
              }
            } catch (profileError) {
              console.log('Could not determine other participant, using current user only');
            }
          }
          
          // Update the chat document
          await firestore()
            .collection('chats')
            .doc(chatId)
            .update({
              participants: participants,
              isActive: true,
              type: 'direct'
            });
          
         
          fixedParticipants++;
        }
      }

      if (fixedParticipants > 0) {
      
      }

      // Now get all chats where the current user is a participant
      const chatsSnapshot = await firestore()
        .collection('chats')
        .where('participants', 'array-contains', currentUserId)
        .get();

      

      if (chatsSnapshot.empty) {
        
        return;
      }

      const batch = firestore().batch();
      const now = firestore.FieldValue.serverTimestamp();
      let createdCount = 0;

      for (const chatDoc of chatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const chatId = chatDoc.id;

        // Check if userChat entry already exists
        const userChatRef = firestore()
          .collection('userChats')
          .doc(currentUserId)
          .collection('chats')
          .doc(chatId);

        const userChatDoc = await userChatRef.get();

        if (!userChatDoc.exists) {
          
          
          batch.set(userChatRef, {
            chatId,
            lastReadAt: now,
            unreadCount: 0,
            isPinned: false,
            isArchived: false,
            joinedAt: chatData.createdAt || now
          });
          createdCount++;
        }
      }

      if (createdCount > 0) {
        await batch.commit();
        
        // Don't auto-refresh, let real-time listeners handle it
      } else {
        console.log('All userChats entries already exist');
        // Don't auto-refresh, let real-time listeners handle it
      }
    } catch (error) {
      // Error in auto-create userChats
    }
  };

  // Function to manually create userChats for existing chats
  const handleCreateUserChats = async () => {
    try {
      
      
      const currentUserId = currentUser?.uid || auth().currentUser?.uid;
      if (!currentUserId) {
        throw new Error('No current user found');
      }

      // Get all chats where the current user is a participant
     
      
      const chatsSnapshot = await firestore()
        .collection('chats')
        .where('participants', 'array-contains', currentUserId)
        .get();

      
      
      // Also get ALL chats to see what's in the database
      const allChatsSnapshot = await firestore()
        .collection('chats')
        .get();
      
      
      allChatsSnapshot.docs.forEach(doc => {
        const chatData = doc.data();
        
      });

      if (chatsSnapshot.empty) {
        Alert.alert('Info', 'No chats found for this user');
        return;
      }

      const batch = firestore().batch();
      const now = firestore.FieldValue.serverTimestamp();
      let createdCount = 0;

      for (const chatDoc of chatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const chatId = chatDoc.id;

        // Check if userChat entry already exists
        const userChatRef = firestore()
          .collection('userChats')
          .doc(currentUserId)
          .collection('chats')
          .doc(chatId);

        const userChatDoc = await userChatRef.get();

        if (!userChatDoc.exists) {
          
          
          batch.set(userChatRef, {
            chatId,
            lastReadAt: now,
            unreadCount: 0,
            isPinned: false,
            isArchived: false,
            joinedAt: chatData.createdAt || now
          });
          createdCount++;
        }
      }

      if (createdCount > 0) {
        await batch.commit();
       
        Alert.alert('Success', `Created ${createdCount} userChats entries for existing chats`);
        // Refresh the conversations list
        setTimeout(() => {
          loadActiveConversations();
        }, 1000);
      } else {
       
        Alert.alert('Info', 'All userChats entries already exist');
      }
    } catch (error) {
      Alert.alert('Error', `Failed to create userChats: ${error.message}`);
    }
  };

  // Function to fix all chats with missing participants
  const handleFixChatParticipants = async () => {
    try {
      
      
      const currentUserId = currentUser?.uid || auth().currentUser?.uid;
      if (!currentUserId) {
        throw new Error('No current user found');
      }

      // Get all chats
      const allChatsSnapshot = await firestore()
        .collection('chats')
        .get();
      
      
      
      let fixedCount = 0;
      const batch = firestore().batch();

      for (const chatDoc of allChatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const chatId = chatDoc.id;
        
        // Check if participants are missing or undefined
        if (!chatData.participants || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
         
          
          // Try to extract participants from chat ID
          if (chatId.includes('_')) {
            const possibleUserIds = chatId.split('_');
            const participants = possibleUserIds.filter(id => id && id.length > 10);
            
            if (participants.length >= 2) {
              console.log('Extracted participants from chat ID:', participants);
              
              batch.update(firestore().collection('chats').doc(chatId), {
                participants: participants,
                isActive: true,
                type: 'direct',
                updatedAt: firestore.FieldValue.serverTimestamp()
              });
              fixedCount++;
            }
          }
        }
      }

      if (fixedCount > 0) {
        await batch.commit();
       
        Alert.alert('Success', `Fixed ${fixedCount} chats with missing participants`);
        // Refresh the conversations list
        setTimeout(() => {
          loadActiveConversations();
        }, 1000);
      } else {
        console.log('No chats needed fixing');
        Alert.alert('Info', 'No chats needed fixing');
      }
    } catch (error) {
      Alert.alert('Error', `Failed to fix chat participants: ${error.message}`);
    }
  };

  const getDisplayName = (user) => {
    return user.displayName || user.name || user.username || 'Unknown User';
  };

  const getInitials = (user) => {
    const name = getDisplayName(user);
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const isActiveConversation = (userId) => {
    return activeConversations.some(conv => conv.id === userId);
  };

  const hasPendingRequest = (userId) => {
    return pendingRequests.some(req => req.recipientId === userId);
  };

  const isReceivedRequest = (userId) => {
    return receivedRequests.some(req => req.senderInfo?.id === userId || req.senderId === userId);
  };

  const getLastMessagePreview = (user) => {
    const hasActiveChat = isActiveConversation(user.id);
    const hasPending = hasPendingRequest(user.id);
    const isRequest = isReceivedRequest(user.id) || user.isMessageRequest;
    
    if (hasActiveChat) {
      return user.lastMessage || user.bio || user.status || 'Tap to continue conversation...';
    }
    
    if (hasPending) {
      return 'Message request sent';
    }
    
    if (isRequest) {
      return user.requestMessage || 'Wants to send you a message';
    }
    
    // Show different messages based on mutual follow status
    if (search.trim().length >= 3) {
      return user.isMutualFollow
        ? 'Tap to continue conversation'
        : 'Send a message request to connect';
    }
    
    return user.bio || user.status || 'Start a conversation...';
  };

  const getChatItemStatus = (user) => {
    if (isActiveConversation(user.id)) {
      return 'active';
    }
    if (hasPendingRequest(user.id)) {
      return 'pending';
    }
    if (isReceivedRequest(user.id) || user.isMessageRequest) {
      return 'request';
    }
    return 'new';
  };

  const renderChatItem = ({ item }) => {
    const status = getChatItemStatus(item);
    // If searching with 3+ characters, and we already know follow status, suppress showing both states
    // We just render one clear CTA based on item.isMutualFollow
    const showSingleCta = search.trim().length >= 3;
    
    return (
      <TouchableOpacity
        style={[
          styles.chatItem,
          status === 'new' && search.trim().length >= 3 && styles.newChatItem,
          status === 'pending' && styles.pendingChatItem,
          status === 'request' && styles.requestChatItem
        ]}
        onPress={() => handleChatPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarPlaceholder}>
          {item.avatar || item.photoURL ? (
            <Image 
              source={{ uri: getCachedImageUri(item.avatar || item.photoURL) }} 
              style={styles.avatarImage}
              onError={() => {}}
            />
          ) : (
            <Text style={styles.avatarText}>
              {getInitials(item)}
            </Text>
          )}
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.nameContainer}>
            <Text style={styles.chatName}>{getDisplayName(item)}</Text>
            {status === 'new' && search.trim().length >= 3 && (
              <Text style={styles.newChatBadge}>
                {item.isMutualFollow ? 'Tap' : 'Request'}
              </Text>
            )}
            {status === 'pending' && (
              <Text style={styles.pendingBadge}>Sent</Text>
            )}
            {status === 'request' && (
              <Text style={styles.requestBadge}>Request</Text>
            )}
          </View>
          <Text 
            style={[
              styles.lastMessage,
              status === 'pending' && styles.pendingMessageText,
              status === 'request' && styles.requestMessageText
            ]} 
            numberOfLines={1}
          >
            {showSingleCta
              ? (item.isMutualFollow ? 'Tap to continue conversation' : 'Send a message request to connect')
              : getLastMessagePreview(item)}
          </Text>
        </View>
        <View style={[
          styles.onlineIndicator,
          status === 'new' && search.trim().length >= 3 && styles.newChatIndicator,
          status === 'pending' && styles.pendingIndicator,
          status === 'request' && styles.requestIndicator
        ]} />
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    const isLoading = contextLoading || loading;

    if (isLoading && users.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="white" />
          <Text style={styles.loadingText}>
            {search.trim().length >= 3 ? 'Searching...' : 'Loading conversations...'}
          </Text>
        </View>
      );
    }

  // When searching with 3+ characters, show search results or no results message
  if (search.trim().length >= 3) {
    if (users.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.noResultsText}>
            No users found for "{search}"
          </Text>
          <Text style={styles.noResultsSubText}>
            Try searching with a different name
          </Text>
        </View>
      );
    }

    // Show search results
    return (
      <FlatList
        data={users}
        keyExtractor={(item, index) => {
          // Use unique identifier: prefer uniqueKey, then id, then conversationId, fallback to index
          if (item.uniqueKey) return item.uniqueKey;
          if (item.id) return item.id;
          if (item.conversationId) return item.conversationId;
          return `item_${index}`;
        }}
        renderItem={renderChatItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={loading}
        onRefresh={() => {
          handleSearch(search);
        }}
      />
    );
  }

  // When search is empty, show conversations or empty state
  if (activeConversations.length === 0 && receivedRequests.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.noResultsText}>
          No conversations yet
        </Text>
        <Text style={styles.noResultsSubText}>
          Search for someone to start chatting
        </Text>
      </View>
    );
  }

  // Show conversations when search is empty
  return (
    <FlatList
      data={users}
      keyExtractor={(item, index) => {
        // Use unique identifier: prefer uniqueKey, then id, then conversationId, fallback to index
        if (item.uniqueKey) return item.uniqueKey;
        if (item.id) return item.id;
        if (item.conversationId) return item.conversationId;
        return `item_${index}`;
      }}
      renderItem={renderChatItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshing={loading}
      onRefresh={() => {
        setActiveConversations([]);
        setReceivedRequests([]);
        const unsubscribe = loadActiveConversations();
        const unsubscribeRequests = loadMessageRequests();
      }}
    />
  );
  };

  return (
    <View style={styles.drawerContainer}>
      {/* Drawer Header */}
      <View style={styles.drawerHeader}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Conversations</Text>
          <View style={styles.headerActions}>
            {/* Show counts in header */}
            {receivedRequests.length > 0 && (
              <View style={styles.requestBadgeContainer}>
                <Text style={styles.requestCount}>{receivedRequests.length}</Text>
              </View>
            )}
            <TouchableOpacity 
              style={styles.iconButton} 
              onPress={() => navigation.navigate('MessageRequestsScreen')}
            >
              <Icon name="mail-outline" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.separator} />
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations..."
            placeholderTextColor="rgba(255, 255, 255, 0.5)"
            value={search}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            editable={!contextLoading && !loading}
          />
          {search.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearSearch}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Chat List */}
      <View style={styles.chatListContainer}>
        {renderContent()}
      </View>
    </View>
  );
}

// Main Drawer Screen
export default function First() {
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS === 'android') {
        StatusBar.setBarStyle('light-content', true);
        StatusBar.setBackgroundColor('#1e1e1e', true);
      }
    }, [])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1e1e1e' }}>
      <View style={styles.outerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" translucent={false} />

        <Drawer.Navigator
          screenOptions={{
            drawerType: 'slide',
            headerStyle: {
              backgroundColor: '#1e1e1e',
              elevation: 15,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 1,
              shadowRadius: 5,
              borderBottomWidth: 0.5,
              borderBottomColor: 'white',
              height: 60,
              justifyContent: 'center',
            },
            headerTintColor: 'white',
            drawerStyle: {
              backgroundColor: '#2c2c32',
              width: '85%',
              marginTop: StatusBar.currentHeight || 0,
            },
            drawerActiveTintColor: 'white',
            drawerInactiveTintColor: 'gray',
            overlayColor: 'rgba(0, 0, 0, 0.5)',
          }}
          drawerContent={(props) => <CustomDrawerContent {...props} />}
        >
          <Drawer.Screen
            name="ConversationsScreen"
            component={ConversationsScreen}
            options={{
              title: 'DevLink',
              headerTitleAlign: 'center',
              headerTitleStyle: {
                fontWeight: 'bold',
                fontSize: 24,
                color: 'white',
                textAlignVertical: 'center',
                includeFontPadding: false,
                lineHeight: 28,
                
                
              },
              headerStyle: {
                backgroundColor: '#1e1e1e',
                elevation: 15,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 1,
                shadowRadius: 5,
                borderBottomWidth: 0.5,
                borderBottomColor: 'white',
                height: 80,
                justifyContent: 'center',
                // paddingTop:getStatusBarHeight()
              },
            }}
          />
        </Drawer.Navigator>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  statusBarSpacerDark: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e',
  },
  topSeparatorDark: {
    height: 0.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: '100%',
  },
  drawerContainer: {
    flex: 1,
    backgroundColor: '#2c2c32',
  },
  drawerHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#1e1e1e',
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  requestsButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  requestsButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: 0.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#2c2c32',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#404040',
    borderRadius: 20,
    paddingHorizontal: 15,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: 'white',
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: 8,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: 'bold',
  },
  chatListContainer: {
    flex: 1,
    backgroundColor: '#2c2c32',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    marginTop: 10,
  },
  noResultsText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  noResultsSubText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    textAlign: 'center',
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#2c2c32',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  newChatItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  pendingChatItem: {
    backgroundColor: 'rgba(255, 193, 7, 0.05)',
  },
  requestChatItem: {
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#404040',
    marginRight: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  chatInfo: {
    flex: 1,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  chatName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  newChatBadge: {
    backgroundColor: '#007AFF',
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  pendingBadge: {
    backgroundColor: '#FFC107',
    color: '#333',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  requestBadge: {
    backgroundColor: '#007AFF',
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  lastMessage: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  pendingMessageText: {
    color: 'rgba(255, 193, 7, 0.8)',
    fontStyle: 'italic',
  },
  requestMessageText: {
    color: 'rgba(0, 122, 255, 0.9)',
    fontWeight: '500',
  },
  onlineIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginLeft: 10,
  },
  newChatIndicator: {
    backgroundColor: '#007AFF',
  },
  pendingIndicator: {
    backgroundColor: '#FFC107',
  },
  requestIndicator: {
    backgroundColor: '#007AFF',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  requestBadgeContainer: {
    backgroundColor: '#FF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  requestCount: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  iconButton: {
    padding: 0,
  },
  mailIcon: {
    fontSize: 20,
    color: 'white',
  },
});
