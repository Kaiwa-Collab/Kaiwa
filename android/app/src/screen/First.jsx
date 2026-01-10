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
import presenceService from './presenceService';


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
  const [userOnlineStatus, setUserOnlineStatus] = useState({}); // Track online status for each user
  const isFocused = useIsFocused();
  
  // Refs to store previous values for change detection
  const prevConversationsRef = useRef([]);
  const prevReceivedRequestsRef = useRef([]);
  const prevPendingRequestsRef = useRef([]);
  const prevDrawerFocusedRef = useRef(false);
  const statusUnsubscribesRef = useRef({}); // Store unsubscribe functions for each user
  const queuedChatUpdatesRef = useRef(new Set()); // Track queued chat updates to prevent write loops

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
    console.log('[First.jsx] No currentUserId available');
    setLoading(false);
    setIsInitialLoad(false);
    return () => {}; // Return empty cleanup function
  }

  console.log('[First.jsx] Loading conversations for user:', currentUserId);
  setLoading(true);

  // Create real-time listener for chats collection
  const unsubscribe = firestore()
    .collection('chats')
    .where('participants', 'array-contains', currentUserId)
    .onSnapshot(
      async (chatsSnapshot) => {
        try {
          console.log('[First.jsx] onSnapshot triggered, docs count:', chatsSnapshot.docs.length);
          
          // If query returns empty, get all chats and filter manually
          // (in case participants field is missing from some documents)
          let chatsToProcess = chatsSnapshot.docs;
          
          if (chatsSnapshot.empty) {
            console.log('[First.jsx] Participants query empty, getting all chats and filtering...');
            const allChatsSnapshot = await firestore()
              .collection('chats')
              .get();
            
            console.log('[First.jsx] Total chats in database:', allChatsSnapshot.docs.length);
            
            // Filter chats where user is a participant (check participants field or extract from ID)
            const filteredChats = [];
            for (const chatDoc of allChatsSnapshot.docs) {
              const chatData = chatDoc.data();
              const chatId = chatDoc.id;
              let isParticipant = false;
              let participants = chatData.participants;
              
              // Check if participants array contains current user
              if (participants && Array.isArray(participants)) {
                isParticipant = participants.includes(currentUserId);
              } else {
                // If no participants field, try to extract from chat ID
                // Chat ID pattern: userId1_userId2 or similar
                if (chatId.includes('_') && !chatId.startsWith('group_')) {
                  const possibleUserIds = chatId.split('_').filter(id => id && id.length > 10);
                  isParticipant = possibleUserIds.includes(currentUserId);
                  
                  // CRITICAL FIX: Don't update inside onSnapshot callback to avoid write loops
                  // Instead, queue the update to be done outside the listener
                  // This prevents the listener from triggering itself repeatedly
                  if (isParticipant && possibleUserIds.length >= 2) {
                    // Use a flag to track if we've already queued this update
                    // Store in a Set to avoid duplicate updates
                    const updateKey = `chat_update_${chatId}`;
                    if (!queuedChatUpdatesRef.current.has(updateKey)) {
                      queuedChatUpdatesRef.current.add(updateKey);
                      // Schedule update outside the listener callback
                      setTimeout(async () => {
                        try {
                          // Double-check the document still needs updating
                          const chatDoc = await firestore().collection('chats').doc(chatId).get();
                          const chatData = chatDoc.data();
                          if (!chatData?.participants || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
                            await firestore().collection('chats').doc(chatId).update({
                              participants: possibleUserIds,
                              isActive: true,
                              type: 'direct',
                              updatedAt: firestore.FieldValue.serverTimestamp()
                            });
                            console.log('[First.jsx] Updated chat', chatId, 'with participants:', possibleUserIds);
                          }
                        } catch (updateError) {
                          console.log('[First.jsx] Error updating chat participants:', updateError.message);
                        } finally {
                          queuedChatUpdatesRef.current.delete(updateKey);
                        }
                      }, 1000); // Delay to avoid write loops
                    }
                  }
                } else {
                  // Check if current user ID is in the chat ID string
                  isParticipant = chatId.includes(currentUserId);
                }
              }
              
              if (isParticipant) {
                filteredChats.push(chatDoc);
              }
            }
            
            console.log('[First.jsx] Filtered chats for user:', filteredChats.length);
            chatsToProcess = filteredChats;
          }
          
          if (chatsToProcess.length === 0) {
            console.log('[First.jsx] No chats found for user');
            setActiveConversations([]);
            setLoading(false);
            if (isInitialLoad) {
              setIsInitialLoad(false);
            }
            return;
          }
          
          // Process chats directly
          try {
              // First try with participants field
              let chatsSnapshot = await firestore()
                .collection('chats')
                .where('participants', 'array-contains', currentUserId)
                .get();
              
              console.log('[First.jsx] Participants query returned:', chatsSnapshot.docs.length, 'chats');
              
              // If that returns empty, get all chats and filter manually
              // (in case participants field is missing from some documents)
              if (chatsSnapshot.empty) {
                console.log('[First.jsx] Participants query empty, getting all chats and filtering...');
                const allChatsSnapshot = await firestore()
                  .collection('chats')
                  .get();
                
                console.log('[First.jsx] Total chats in database:', allChatsSnapshot.docs.length);
                
                // Filter chats where user is a participant (check participants field or extract from ID)
                const filteredChats = [];
                for (const chatDoc of allChatsSnapshot.docs) {
                  const chatData = chatDoc.data();
                  const chatId = chatDoc.id;
                  let isParticipant = false;
                  let participants = chatData.participants;
                  
                  // Check if participants array contains current user
                  if (participants && Array.isArray(participants)) {
                    isParticipant = participants.includes(currentUserId);
                  } else {
                    // If no participants field, try to extract from chat ID
                    // Chat ID pattern: userId1_userId2 or similar
                    if (chatId.includes('_') && !chatId.startsWith('group_')) {
                      const possibleUserIds = chatId.split('_').filter(id => id && id.length > 10);
                      isParticipant = possibleUserIds.includes(currentUserId);
                      
                      // CRITICAL FIX: Don't update inside onSnapshot callback to avoid write loops
                      // Queue the update to be done outside the listener
                      if (isParticipant && possibleUserIds.length >= 2) {
                        const updateKey = `chat_update_${chatId}`;
                        if (!queuedChatUpdatesRef.current.has(updateKey)) {
                          queuedChatUpdatesRef.current.add(updateKey);
                          setTimeout(async () => {
                            try {
                              const chatDoc = await firestore().collection('chats').doc(chatId).get();
                              const chatData = chatDoc.data();
                              if (!chatData?.participants || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
                                await firestore().collection('chats').doc(chatId).update({
                                  participants: possibleUserIds,
                                  isActive: true,
                                  type: 'direct',
                                  updatedAt: firestore.FieldValue.serverTimestamp()
                                });
                                console.log('[First.jsx] Updated chat', chatId, 'with participants:', possibleUserIds);
                              }
                            } catch (updateError) {
                              console.log('[First.jsx] Error updating chat participants:', updateError.message);
                            } finally {
                              queuedChatUpdatesRef.current.delete(updateKey);
                            }
                          }, 1000);
                        }
                      }
                    } else {
                      // Check if current user ID is in the chat ID string
                      isParticipant = chatId.includes(currentUserId);
                    }
                  }
                  
                  if (isParticipant) {
                    filteredChats.push(chatDoc);
                  }
                }
                
                console.log('[First.jsx] Filtered chats for user:', filteredChats.length);
                
                // Create a new snapshot-like structure
                chatsSnapshot = {
                  docs: filteredChats,
                  empty: filteredChats.length === 0
                };
              }
              
              if (chatsSnapshot.empty) {
                console.log('[First.jsx] No chats found for user');
                setActiveConversations([]);
                setLoading(false);
                if (isInitialLoad) {
                  setIsInitialLoad(false);
                }
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
                     
                      
                      // CRITICAL FIX: Don't update inside onSnapshot callback to avoid write loops
                      // Queue the update to be done outside the listener
                      const updateKey = `chat_update_${chatId}`;
                      if (!queuedChatUpdatesRef.current.has(updateKey)) {
                        queuedChatUpdatesRef.current.add(updateKey);
                        setTimeout(async () => {
                          try {
                            const chatDoc = await firestore().collection('chats').doc(chatId).get();
                            const chatData = chatDoc.data();
                            if (!chatData?.participants || !Array.isArray(chatData.participants) || chatData.participants.length === 0) {
                              await firestore().collection('chats').doc(chatId).update({
                                participants: participants,
                                isActive: true,
                                type: 'direct',
                                updatedAt: firestore.FieldValue.serverTimestamp()
                              });
                            }
                          } catch (updateError) {
                            // Error updating chat participants
                          } finally {
                            queuedChatUpdatesRef.current.delete(updateKey);
                          }
                        }, 1000);
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
              }
              
              conversations.sort((a, b) => {
                const aTime = a.lastMessageTime?.toDate ? a.lastMessageTime.toDate() : new Date(0);
                const bTime = b.lastMessageTime?.toDate ? b.lastMessageTime.toDate() : new Date(0);
                return bTime - aTime;
              });
              
              // Only update if conversations actually changed
              console.log('[First.jsx] Processed', conversations.length, 'conversations from chats collection');
              if (!arraysEqual(conversations, prevConversationsRef.current)) {
                prevConversationsRef.current = conversations;
                setActiveConversations(conversations);
                console.log('[First.jsx] Updated activeConversations with', conversations.length, 'items');
              }
              // Always end loading
              setLoading(false);
              if (isInitialLoad) {
                setIsInitialLoad(false);
              }
            } catch (processingError) {
              console.error('[First.jsx] Error processing chats:', processingError);
              setActiveConversations([]);
              setLoading(false);
              if (isInitialLoad) {
                setIsInitialLoad(false);
              }
            }

        } catch (error) {
          console.error('[First.jsx] Error in onSnapshot callback:', error);
          // Always end loading on error
          setLoading(false);
          if (isInitialLoad) {
            setIsInitialLoad(false);
          }
          
          // Don't show alert on first load failure, just retry
          setTimeout(() => {
            console.log('[First.jsx] Retrying loadActiveConversations after error...');
            loadActiveConversations();
          }, 3000);
        }
      },
      (error) => {
        console.error('[First.jsx] onSnapshot error handler:', error);
        // Always end loading when listener errors
        setLoading(false);
        if (isInitialLoad) {
          setIsInitialLoad(false);
        }
        
        // Attempt to reconnect after error
        setTimeout(() => {
          console.log('[First.jsx] Retrying loadActiveConversations after listener error...');
          loadActiveConversations();
        }, 5000);
      }
    );

  return unsubscribe || (() => {});
};

  // Set up listeners only once when component mounts
useEffect(() => {
  console.log('[First.jsx] useEffect triggered, currentUser?.uid:', currentUser?.uid);
  let unsubscribeConversations = null;
  let unsubscribeRequests = null;
  
  const currentUserId = currentUser?.uid || auth().currentUser?.uid;
  if (currentUserId) {
    console.log('[First.jsx] Setting up listeners for user:', currentUserId);
    unsubscribeConversations = loadActiveConversations();
    unsubscribeRequests = loadMessageRequests();
  } else {
    console.log('[First.jsx] No currentUserId, resetting loading state');
    setLoading(false);
    setIsInitialLoad(false);
  }
  
  return () => {
    console.log('[First.jsx] Cleaning up listeners');
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

  
const handleRefresh = React.useCallback(() => {
  if (currentUser && !loading) {
    setLoading(true);
    // The existing listeners will automatically update the state
    // Just trigger a manual reload if needed
    loadMessageRequests();
  }
}, [currentUser, loading]);


  // Only refresh when drawer is actually reopened (not on every focus)
  useFocusEffect(
    React.useCallback(() => {
      if (currentUser) {
        // Only refresh if drawer was previously closed and is now opened
        const wasClosed = prevDrawerFocusedRef.current === false && isFocused === true;
        prevDrawerFocusedRef.current = isFocused;
        
        if (wasClosed && drawerWasClosed) {
          // Drawer was closed and is now reopened - refresh message requests
          // The real-time listener on chats collection already handles conversation updates
          loadMessageRequests();
          setDrawerWasClosed(false);
        }
      }
    }, [currentUser, isFocused, drawerWasClosed])
  );

  // Memoize the combined list to prevent unnecessary recalculations
  // Note: Message requests are NOT included here - they only appear in MessageRequestsScreen
  const combinedList = useMemo(() => {
    return [...activeConversations];
  }, [activeConversations]);

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

    // Subscribe to online status for each user in active conversations
  useEffect(() => {
    // Cleanup previous subscriptions
    Object.values(statusUnsubscribesRef.current).forEach(unsubscribe => {
      if (unsubscribe) unsubscribe();
    });
    statusUnsubscribesRef.current = {};

    // Subscribe to online status for each direct chat user
    activeConversations.forEach(conversation => {
      // Only track status for direct chats (not group chats)
      if (conversation.type === 'direct') {
        const currentUserId = currentUser?.uid || auth().currentUser?.uid;
        let userId = null;
        
        // Extract user ID from conversationId (format: userId1_userId2)
        if (conversation.conversationId && conversation.conversationId.includes('_')) {
          const participants = conversation.conversationId.split('_').filter(id => id && id.length > 10);
          userId = participants.find(id => id !== currentUserId);
        }

        // If we have a valid userId, subscribe to their status
        if (userId && userId.length > 10) {
          const unsubscribe = presenceService.subscribeToUserStatus(
            userId,
            (statusText) => {
              setUserOnlineStatus(prev => ({
                ...prev,
                [userId]: statusText
              }));
            }
          );
          statusUnsubscribesRef.current[userId] = unsubscribe;
        }
      }
    });

    // Cleanup on unmount
    return () => {
      Object.values(statusUnsubscribesRef.current).forEach(unsubscribe => {
        if (unsubscribe) unsubscribe();
      });
      statusUnsubscribesRef.current = {};
    };
  }, [activeConversations, currentUser]);

  // Enhanced search with better validation
  const handleSearch = async (text) => {
    setSearch(text);
    
    // When search is empty or less than 3 characters, show active conversations only
    // Note: Message requests are NOT shown here - they only appear in MessageRequestsScreen
    if (text.trim().length === 0 || text.trim().length < 3) {
      // Clear search suggestions and show chats only (no message requests)
      setUsers([...activeConversations]);
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
    
    // Get user ID for online status check (for direct chats only)
    let userId = null;
    if (item.type === 'direct') {
      const currentUserId = currentUser?.uid || auth().currentUser?.uid;
      // Try to get user ID from conversationId (chatId format: userId1_userId2)
      if (item.conversationId && item.conversationId.includes('_')) {
        const participants = item.conversationId.split('_').filter(id => id && id.length > 10);
        userId = participants.find(id => id !== currentUserId);
      }
      // Fallback: check if item has an id field that's a valid user ID
      if (!userId && item.id && !item.id.startsWith('direct_') && item.id.length > 10) {
        userId = item.id;
      }
    }
    
    // Get online status for this user (only for direct chats, not groups)
    const isOnline = item.type === 'direct' && userId && userOnlineStatus[userId] === 'Online';
    const isOffline = item.type === 'direct' && userId && userOnlineStatus[userId] === 'Offline';
    const showOnlineIndicator = item.type === 'direct' && (isOnline || isOffline);
    
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
        {/* Show orange dot for online/offline status (only for direct chats) */}
        {showOnlineIndicator ? (
        <View style={[
          styles.onlineIndicator,
            isOnline ? styles.onlineIndicatorActive : styles.onlineIndicatorInactive
          ]} />
        ) : status === 'new' && search.trim().length >= 3 ? (
          <View style={[styles.onlineIndicator, styles.newChatIndicator]} />
        ) : status === 'pending' ? (
          <View style={[styles.onlineIndicator, styles.pendingIndicator]} />
        ) : status === 'request' ? (
          <View style={[styles.onlineIndicator, styles.requestIndicator]} />
        ) : null}
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
  // Note: Message requests are NOT considered here - they only appear in MessageRequestsScreen
  if (activeConversations.length === 0) {
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
  if (!loading) {
    setLoading(true);
    // Don't clear conversations immediately - let the listener update them
    loadActiveConversations();
    loadMessageRequests();
  }
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
    backgroundColor: '#FF6D1F', // Orange color for online/offline
    marginLeft: 10,
  },
  onlineIndicatorActive: {
    backgroundColor: '#FF6D1F', // Orange for online
  },
  onlineIndicatorInactive: {
    backgroundColor: '#FF6D1F', // Orange for offline (same color, but could be made slightly different if needed)
    opacity: 0.5, // Slightly dimmed for offline
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