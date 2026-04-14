import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StatusBar,
  Dimensions,
  Modal,
  ActivityIndicator,
  InteractionManager
} from 'react-native';
import {
  Animated,
  PanResponder,
  ScrollView,   
} from 'react-native';
import { Image } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import EmptydP from './Emptydp';
import wsChatService from '../../service/wsChatService';
import presenceService from './presenceService';
import Icon from 'react-native-vector-icons/Ionicons';
import { requestcamerapermission, requestgallerypermission } from '../../utils/permissions';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import storage from '@react-native-firebase/storage';
import Video from 'react-native-video';
import chatService from './chatService';
import {useUserData} from '../users';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import AsyncStorage from '@react-native-async-storage/async-storage';
import chatSQLiteService from '../../service/chatSQLiteService';



const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ChatScreen({ route, navigation }) {
  const {
    chatId = 'default',
    title = 'Chat',
    avatar = '',
    userId,
    isMessageRequest = false,
    recipientInfo = null
  } = route.params || {};

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isRequestMode, setIsRequestMode] = useState(isMessageRequest);
  const [actualChatId, setActualChatId] = useState(chatId);
  const [showAcceptReject, setShowAcceptReject] = useState(false);
  const [requestData, setRequestData] = useState(null);
  const [headerTitle, setHeaderTitle] = useState(title || 'Chat');
  const [headerAvatar, setHeaderAvatar] = useState(avatar || '');
  const flatListRef = useRef(null);
  const currentUserUid = useRef(auth().currentUser?.uid).current;
  const [chatData, setChatData] = useState(null);
  const [isCreator, setIsCreator] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState('Offline');
  const statusUnsubscribeRef = useRef(null);
  const [recipientId, setRecipientId] = useState(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const PAGE_SIZE = 30;
const [oldestMessageId, setOldestMessageId] = useState(null);
const [hasMoreMessages, setHasMoreMessages] = useState(true);
const [isFetchingMore, setIsFetchingMore] = useState(false);
  const typingTimeoutRef = useRef(null);
  const [mediaViewer, setMediaViewer] = useState({ visible: false, uri: null, type: null });
  const { getCachedImageUri } = useUserData();
  const [downloadStates, setDownloadStates] = useState({}); // { [messageId]: 'idle'|'downloading'|'done' }
const localMediaPaths = useRef({});  
const [localMessageStatus, setLocalMessageStatus] = useState({}); // { [messageId]: 'sent'|'delivered'|'seen' }
  const isScreenFocused = useIsFocused();
  const oldestMessageIdRef = useRef(null);
  const chatLoadMetricsRef = useRef({
    chatOpenCount: 0,
    sqliteHydrateCount: 0,
    networkSyncCount: 0,
    networkSkippedCount: 0,
  });
  // const firestoreUnsubscribeRef = useRef(null);

const sanitizeMessage = useCallback((msg) => {
  let createdAt = null;
  try {
    const raw = msg.createdAt;
    if (raw == null) {
      createdAt = null;
    } else if (typeof raw === 'string') {
      createdAt = raw;
    } else if (typeof raw === 'number') {
      createdAt = new Date(raw).toISOString();
    } else if (raw._seconds != null) {
      createdAt = new Date(raw._seconds * 1000).toISOString();
    } else if (typeof raw.toDate === 'function') {
      createdAt = raw.toDate().toISOString();
    }
  } catch (_) {
    createdAt = null;
  }
  return {
    ...msg,
    createdAt,
    text:        msg.text        != null ? String(msg.text)        : null,
    senderId:    msg.senderId    != null ? String(msg.senderId)    : '',
    messageType: msg.messageType != null ? String(msg.messageType) : 'text',
    id:          msg.id          != null ? String(msg.id)          : '',
    status:      msg.status      != null ? String(msg.status)      : 'sent',
    imageUrl:    msg.imageUrl    != null ? String(msg.imageUrl)    : null,
    videoUrl:    msg.videoUrl    != null ? String(msg.videoUrl)    : null,
  };
}, []);

  // Keep ref in sync whenever state updates:
useEffect(() => {
  oldestMessageIdRef.current = oldestMessageId;
}, [oldestMessageId]);

useEffect(() => {
  // Load all previously downloaded paths from AsyncStorage on mount
  const loadPersistedPaths = async () => {
    try {
      const stored = await AsyncStorage.getItem('downloadedMediaPaths');
      if (stored) {
        const parsed = JSON.parse(stored);
        localMediaPaths.current = parsed;

        // Also restore downloadStates so the UI shows 'done' immediately
        // Only mark 'done' for messages that actually exist on disk still
        const verified = {};
        await Promise.all(
          Object.entries(parsed).map(async ([msgId, filePath]) => {
            try {
              const exists = await RNFS.exists(filePath);
              if (exists) {
                verified[msgId] = filePath;
              }
            } catch (_) {}
          })
        );

        // Remove stale entries (file was deleted from device)
        localMediaPaths.current = verified;
        if (Object.keys(verified).length !== Object.keys(parsed).length) {
          await AsyncStorage.setItem('downloadedMediaPaths', JSON.stringify(verified));
        }

        // Set all verified entries as 'done' in UI state
        const doneStates = Object.fromEntries(
          Object.keys(verified).map(id => [id, 'done'])
        );
        setDownloadStates(prev => ({ ...prev, ...doneStates }));
      }
    } catch (error) {
      console.error('Failed to load persisted media paths:', error);
    }
  };

  loadPersistedPaths();
}, []); // runs once on mount

  // const updateLocalStatus = useCallback((messageIds, status) => {
  //   if (!messageIds || messageIds.length === 0) return;
  //   if (status !== 'delivered' && status !== 'seen') return;

  //   setLocalMessageStatus(prev => {
  //     const next = { ...prev };
  //     messageIds.forEach(id => {
  //       // Never downgrade from 'seen'
  //       if (prev[id] === 'seen') {
  //         return;
  //       }
  //       next[id] = status;
  //     });
  //     return next;
  //   });
  // }, []);

  // ─── WebSocket connection status (connection is initiated by AuthWrapper on app open) ───
 // REMOVE the entire setInterval block. Replace with:
// useEffect(() => {
//   setIsConnected(wsChatService.isConnected);

//   const unsub = wsChatService.onConnectionChange(() => {
//     setIsConnected(wsChatService.isConnected);
//   });

//   return () => {
//     unsub();
//     if (actualChatId && !actualChatId.startsWith('temp_') && !actualChatId.startsWith('request_')) {
//       wsChatService.leaveChat(actualChatId);
//     }
//   };
// }, [actualChatId]); // ← actualChatId only, not isConnected

// ─── WebSocket connection status ────────────────────────────────────────────
// ─── WebSocket connection status ─────────────────────────────────────────────
useEffect(() => {
  setIsConnected(wsChatService.isConnected && wsChatService.isAuthenticated);

  const handleConnectionChange = (data = {}) => {  // ← add parameter
    const connected = wsChatService.isConnected && wsChatService.isAuthenticated;
    setIsConnected(connected);

    if (connected && actualChatId &&
      !actualChatId.startsWith('temp_') &&
      !actualChatId.startsWith('request_')
    ) {
      wsChatService.joinChat(actualChatId);
    }
  };

  wsChatService.addListener('connection_status', handleConnectionChange);
  wsChatService.addListener('reconnected', handleConnectionChange);

  return () => {
    wsChatService.removeListener('connection_status', handleConnectionChange);
    wsChatService.removeListener('reconnected', handleConnectionChange);
    if (actualChatId &&
      !actualChatId.startsWith('temp_') &&
      !actualChatId.startsWith('request_')
    ) {
      wsChatService.leaveChat(actualChatId);
    }
  };
}, [actualChatId]);// only re-runs if chat changes, not on every isConnected flip

  useEffect(() => {
    setActualChatId(chatId);
  }, [chatId]);

  // ─── Fetch chat data ────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchChatData = async () => {
      if (!actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
        return;
      }

      try {
        const chatDoc = await firestore().collection('chats').doc(actualChatId).get();
        if (chatDoc.exists) {
          const data = chatDoc.data();
          setChatData(data);

          if (data.type === 'direct' && data.participants) {
            const otherParticipant = data.participants.find(id => id !== currentUserUid);
            if (otherParticipant) {
              setRecipientId(otherParticipant);
            }
          }

          if (data.type === 'group' && data.createdBy === currentUserUid) {
            const projectsSnapshot = await firestore()
              .collection('collaborations')
              .where('chatId', '==', actualChatId)
              .get();

            if (!projectsSnapshot.empty) {
              const projectData = projectsSnapshot.docs[0].data();
              setIsCreator(projectData.status !== 'completed');
            } else {
              setIsCreator(true);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching chat data:', error);
      }
    };

    fetchChatData();
  }, [actualChatId, currentUserUid]);

  // ─── Fetch header info if missing ───────────────────────────────────────────
  useEffect(() => {
    const maybeFetchHeaderInfo = async () => {
      try {
        if ((!headerTitle || headerTitle === 'Chat' || headerTitle.trim().length === 0) && userId) {
          const doc = await firestore().collection('profile').doc(userId).get();
          if (doc.exists) {
            const data = doc.data();
            setHeaderTitle(data.displayName || data.name || data.username || 'Chat');
            setHeaderAvatar(getCachedImageUri(data.avatar || data.photoURL || ''));
     
          }
        }
      } catch (error) {
        console.error('Error fetching header info:', error);
      }
    };
    maybeFetchHeaderInfo();
  }, [userId, headerTitle]);

  // ─── Subscribe to online status ─────────────────────────────────────────────
  useEffect(() => {
    if (statusUnsubscribeRef.current) {
      statusUnsubscribeRef.current();
      statusUnsubscribeRef.current = null;
    }

    if (isRequestMode || !actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
      setOnlineStatus('Offline');
      return;
    }

    if (chatData?.type === 'group') {
      setOnlineStatus('Group');
      return;
    }

    if (chatData?.participants && chatData.participants.length === 2) {
      const otherUserId = chatData.participants.find(id => id !== currentUserUid);

      if (otherUserId) {
        const unsubscribe = presenceService.subscribeToUserStatus(
          otherUserId,
          (statusText, lastSeenText) => {
            setOnlineStatus(lastSeenText || statusText);
          }
        );
        statusUnsubscribeRef.current = unsubscribe;
      } else {
        setOnlineStatus('Offline');
      }
    } else if (userId) {
      const unsubscribe = presenceService.subscribeToUserStatus(
        userId,
        (statusText, lastSeenText) => {
          setOnlineStatus(lastSeenText || statusText);
        }
      );
      statusUnsubscribeRef.current = unsubscribe;
    } else {
      setOnlineStatus('Offline');
    }

    return () => {
      if (statusUnsubscribeRef.current) {
        statusUnsubscribeRef.current();
        statusUnsubscribeRef.current = null;
      }
    };
  }, [actualChatId, chatData, userId, currentUserUid, isRequestMode]);

  // ─── Load message history ───────────────────────────────────────────────────
  // Hydrate from SQLite first for instant UI, then fetch fresh in background only when needed.
useEffect(() => {
  const invalidChatId = !actualChatId ||
    actualChatId === 'default' ||
    actualChatId.startsWith('temp_') ||
    actualChatId.startsWith('request_');
  if (invalidChatId) {
    setIsLoadingMessages(false);
    return;
  }

  // ADD this block right after setIsLoadingMessages(false) inside the SQLite hydrate success block:
// if (localMessages.length > 0) {
//   // Check if wsChatService received any messages while we were away
//   // that SQLite may not have yet (race condition window)
//   const cachedMessages = wsChatService.getCachedMessages(actualChatId);
//   if (cachedMessages && cachedMessages.length > 0) {
//     const sqliteIds = new Set(localMessages.map(m => m.id));
//     const missed = cachedMessages.filter(m => m.id && !sqliteIds.has(m.id));
//     if (missed.length > 0) {
//       console.log(`🔄 Found ${missed.length} messages in memory cache not in SQLite`);
//       setMessages(prev => {
//         const prevIds = new Set(prev.map(m => m.id));
//         const newOnes = missed.filter(m => !prevIds.has(m.id)).map(sanitizeMessage);
//         if (newOnes.length === 0) return prev;
//         return [...newOnes, ...prev].sort(
//           (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
//         );
//       });
//     }
//   }
// }

  let cancelled = false;

  const toUiMessageFromSQLite = (msg) => {
    const resolvedType = msg.mediaType || 'text';
    return sanitizeMessage ( {
      id: msg.id,
      tempId: msg.tempId,
      senderId: msg.senderId,
      text: msg.text,
      messageType: resolvedType,
      imageUrl: resolvedType === 'image' ? msg.mediaUrl : null,
      videoUrl: resolvedType === 'video' ? msg.mediaUrl : null,
      createdAt: typeof msg.createdAt === 'number' ? new Date(msg.createdAt).toISOString() : msg.createdAt,
      readBy: {},
      deliveredTo: {},
      status: msg.status || 'sent',
    });
  };

  const loadMessages = async (retryCount = 0) => {
    if (retryCount === 0) {
      chatLoadMetricsRef.current.chatOpenCount += 1;
    }
    const CACHE_TTL = 5 * 60 * 1000;
    const cacheAge = wsChatService.getCacheAge(actualChatId);

    // 1) Instant hydrate from SQLite
    let localMessages = [];
    try {
      localMessages = await chatSQLiteService.getMessages(actualChatId, PAGE_SIZE);
      if (cancelled) return;

      if (localMessages.length > 0) {
        chatLoadMetricsRef.current.sqliteHydrateCount += 1;
        const hydrated = localMessages
          .map(toUiMessageFromSQLite)
          .filter(msg => {
            const deletedFor = msg.deletedFor || {};
            return !deletedFor[currentUserUid];
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

       setMessages(hydrated);
        const oldestLocal = hydrated[hydrated.length - 1];
        setOldestMessageId(oldestLocal?.id ?? null);
        setHasMoreMessages(hydrated.length === PAGE_SIZE);
        setIsLoadingMessages(false);

        // Merge any messages the WebSocket received while we were on another screen
        // that SQLite may not have written yet (narrow race window)
       const cachedMessages = wsChatService.getCachedMessages(actualChatId);
if (cachedMessages && cachedMessages.length > 0) {
  const sqliteIds = new Set(hydrated.map(m => m.id));
  const missed = cachedMessages.filter(m => m.id && !sqliteIds.has(m.id));
  if (missed.length > 0) {
    console.log(`🔄 Cache has ${missed.length} messages not yet in SQLite — merging`);
    const mergedAll = [
      ...missed.map(sanitizeMessage),
      ...hydrated,
    ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    setMessages(mergedAll);
    // Update oldest ID for pagination to reflect the true oldest message
    setOldestMessageId(mergedAll[mergedAll.length - 1]?.id ?? null);
  }
}
      } else {
        setIsLoadingMessages(true);
      }
    } catch (sqliteError) {
      console.warn('SQLite hydrate failed, falling back to network:', sqliteError?.message);
      setIsLoadingMessages(true);
    }

    // 2) Decide if fresh fetch is needed (background sync)
    const cacheIsVeryFresh = Number.isFinite(cacheAge) && cacheAge < 30 * 1000;
    const hasLocalData = localMessages.length > 0;
    // Only skip if SQLite already has the latest message the socket received
    const lastReceivedId = wsChatService.getLastReceivedMessageId(actualChatId);
    const sqliteHasLatest = !lastReceivedId ||
       localMessages.some(m => m.id === lastReceivedId);
    const shouldSkipFetch = hasLocalData && cacheIsVeryFresh && sqliteHasLatest;

if (shouldSkipFetch) {
  chatLoadMetricsRef.current.networkSkippedCount += 1;
  console.log('✅ Cache very fresh, skipping network fetch');
  return;
}

    try {
      if (retryCount === 0) {
        chatLoadMetricsRef.current.networkSyncCount += 1;
      }
      console.log(`📥 Background sync messages (attempt ${retryCount + 1})...`);
      const response = await wsChatService.fetchMessageHistory(actualChatId, PAGE_SIZE);
      if (cancelled) return;

      const historyMessages = response.messages || [];
      const filteredMessages = historyMessages.filter(msg => {
        const deletedFor = msg.deletedFor || {};
        return !deletedFor[currentUserUid];
      }).map(sanitizeMessage);

      // Persist server history in SQLite for next screen open.
      await chatSQLiteService.bulkUpsertServerMessages(
        filteredMessages.map(msg => ({
          id: msg.id,
          chatId: actualChatId,
          senderId: msg.senderId,
          text: msg.text || null,
          mediaUrl: msg.imageUrl || msg.videoUrl || msg.mediaUrl || null,
          mediaType: msg.messageType || (msg.imageUrl ? 'image' : msg.videoUrl ? 'video' : null),
          status: msg.status || 'sent',
          createdAt: msg.createdAt,
          serverTs: msg.createdAt,
          isMine: msg.senderId === currentUserUid,
        }))
      );

      // Merge server snapshot with current in-memory state to preserve local read/delivery updates.
      setMessages(prev => {
        if (prev.length === 0) return filteredMessages;
        const prevMap = new Map(prev.map(m => [m.id, m]));
        return filteredMessages.map(msg => {
          const existing = prevMap.get(msg.id);
          if (!existing) return msg;
          return {
            ...msg,
            status: existing.status === 'failed' || existing.status === 'sending' ? existing.status : (msg.status || 'sent'),
            readBy: { ...msg.readBy, ...existing.readBy },
            deliveredTo: { ...msg.deliveredTo, ...existing.deliveredTo },
          };
        });
      });

      const oldest = filteredMessages[filteredMessages.length - 1];
      setOldestMessageId(oldest?.id ?? null);
      setHasMoreMessages(response.hasMore ?? filteredMessages.length === PAGE_SIZE);

      console.log(`✅ Background sync complete: ${filteredMessages.length} messages`);
      if (__DEV__) {
        const m = chatLoadMetricsRef.current;
        console.log(
          `[ChatMetrics] opens=${m.chatOpenCount} sqliteHydrates=${m.sqliteHydrateCount} networkSyncs=${m.networkSyncCount} networkSkips=${m.networkSkippedCount}`
        );
      }

      if (wsChatService.isConnected) {
        const undeliveredIds = filteredMessages
          .filter(msg => {
            if (msg.senderId === currentUserUid) return false;
            return !msg.deliveredTo?.[currentUserUid];
          })
          .map(msg => msg.id);

        if (undeliveredIds.length > 0) {
          wsChatService.markMessagesAsDelivered(actualChatId, undeliveredIds);
        }
      }
    } catch (error) {
      if (cancelled) return;

      if (retryCount < 2) {
        const delay = (retryCount + 1) * 1500;
        console.warn(`⚠️ Background sync retry ${retryCount + 1} in ${delay}ms: ${error.message}`);
        await new Promise(r => setTimeout(r, delay));
        if (cancelled) return;
        return loadMessages(retryCount + 1);
      }

      // Keep UI on SQLite data; don't block user with error popup for background sync failures.
      console.warn('Background message sync failed:', error?.message);
    } finally {
      if (!cancelled) setIsLoadingMessages(false);
    }
  };

  loadMessages(0);
  return () => { cancelled = true; };
}, [actualChatId, currentUserUid]);

  // ─── WebSocket: Join chat + event listeners ─────────────────────────────────
 useEffect(() => {
  if (!actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
    return;
  }

 console.log('👂 [Listeners] Registering listeners for:', actualChatId);

  try {
    wsChatService.joinChat(actualChatId);
  } catch (e) {
    console.warn('Could not join chat room:', e);
  }

  const handleNewMessage = (message) => {
        console.log('📨 [Message] Received:', message.id, '|', message.text?.slice(0, 20)); // ← ADD

    const deletedFor = message.deletedFor || {};
    if (deletedFor[currentUserUid]) return;

    setMessages(prev => {
      const exists = prev.find(m => m.id === message.id);
      if (exists) return prev;
      return [message, ...prev];
    });
    wsChatService.addMessageToCache(actualChatId, message);

    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);

    wsChatService.markMessagesAsDelivered(actualChatId, [message.id]);
  };

  const handleMessageConfirmed = (data) => {
    setMessages(prev => {
      const withoutTemps = prev.filter(msg => !msg.id.startsWith('temp_'));
      const existingMsg = withoutTemps.find(m => m.id === data.message.id);
      const mergedMessage = {
        ...data.message,
        readBy: { ...data.message.readBy, ...(existingMsg?.readBy || {}) },
        deliveredTo: { ...data.message.deliveredTo, ...(existingMsg?.deliveredTo || {}) },
      };
      const existingIndex = withoutTemps.findIndex(m => m.id === data.message.id);
      if (existingIndex !== -1) {
        return withoutTemps.map((m, i) => i === existingIndex ? mergedMessage : m);
      }
      return [mergedMessage, ...withoutTemps];
    });
    wsChatService.addMessageToCache(actualChatId, data.message);
  };

  const handleMessageError = async (data) => {
    console.error('Message error:', data);
    await chatSQLiteService.markMessageFailed(data.tempId).catch(() => {});
    setMessages(prev =>
      prev.map(m => (m.id === data.tempId || m.tempId === data.tempId)
        ? { ...m, status: 'failed' }
        : m
      )
    );
  };

  // const handleMessagesDelivered = (data) => {
  //   if (!data?.messageIds || data.messageIds.length === 0) return;

  //   setMessages(prev => {
  //     return prev.map(msg => {
  //       if (data.messageIds.includes(msg.id)) {
  //         const nextMsg = {
  //           ...msg,
  //           deliveredTo: {
  //             ...msg.deliveredTo,
  //             [data.userId]: new Date().toISOString()
  //           }
  //         };
  //         wsChatService.updateMessageInCache(actualChatId, nextMsg);
  //         return nextMsg;
  //       }
  //       return msg;
  //     });
  //   });

  //   updateLocalStatus(data.messageIds, 'delivered');
  // };

  // const handleMessagesRead = (data) => {
  //   if (!data?.messageIds || data.messageIds.length === 0) return;

  //   setMessages(prev => {
  //     return prev.map(msg => {
  //       if (data.messageIds.includes(msg.id)) {
  //         const nextMsg = {
  //           ...msg,
  //           readBy: {
  //             ...msg.readBy,
  //             [data.userId]: new Date().toISOString()
  //           }
  //         };
  //         wsChatService.updateMessageInCache(actualChatId, nextMsg);
  //         return nextMsg;
  //       }
  //       return msg;
  //     });
  //   });

  //   updateLocalStatus(data.messageIds, 'seen');
  // };

  const handleUserTyping = (data) => {
    if (data.chatId === actualChatId && data.userId !== currentUserUid) {
      setOtherUserTyping(data.isTyping);
    }
  };

  const handleMessageUpdated = (data) => {
    if (data.chatId === actualChatId && data.message) {
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== data.message.id) return msg;
          return {
            ...data.message,
            readBy: { ...data.message.readBy, ...msg.readBy },
            deliveredTo: { ...data.message.deliveredTo, ...msg.deliveredTo },
          };
        })
      );
      wsChatService.updateMessageInCache(actualChatId, data.message);
    }
  };

  wsChatService.addListener('new_message', handleNewMessage);
  wsChatService.addListener('message_confirmed', handleMessageConfirmed);
  wsChatService.addListener('message_error', handleMessageError);
  // wsChatService.addListener('messages_delivered', handleMessagesDelivered);
  // wsChatService.addListener('messages_read', handleMessagesRead);
  wsChatService.addListener('user_typing', handleUserTyping);
  wsChatService.addListener('message_updated', handleMessageUpdated);

  return () => {
    console.log('🧹 [Listeners] Cleaning up for:', actualChatId);
    wsChatService.removeListener('new_message', handleNewMessage);
    wsChatService.removeListener('message_confirmed', handleMessageConfirmed);
    wsChatService.removeListener('message_error', handleMessageError);
    // wsChatService.removeListener('messages_delivered', handleMessagesDelivered);
    // wsChatService.removeListener('messages_read', handleMessagesRead);
    wsChatService.removeListener('user_typing', handleUserTyping);
    wsChatService.removeListener('message_updated', handleMessageUpdated);
    // ✅ leaveChat removed — now handled in the connection useEffect above
  };
}, [actualChatId, currentUserUid]);

  // ─── Mark messages as read when screen focused ──────────────────────────────
  const markUnreadAsRead = useCallback(() => {
    if (
      !actualChatId ||
      actualChatId === 'default' ||
      actualChatId.startsWith('temp_') ||
      actualChatId.startsWith('request_')
    ) {
      return;
    }

    const unreadMessageIds = messages
      .filter(msg => {
        if (msg.senderId === currentUserUid) return false;
        const readBy = msg.readBy || {};
        return !readBy[currentUserUid];
      })
      .map(msg => msg.id);

    if (unreadMessageIds.length === 0) {
      return;
    }

    // Fast path: send over WebSocket if connected
    if (wsChatService.isConnected) {
      wsChatService.markMessagesAsRead(actualChatId, unreadMessageIds);
    }

    // Reliable path: also tell backend via Cloud Function (fire-and-forget)
    // so sender sees "seen" even if socket was briefly disconnected.
    chatService.markMessagesAsRead(actualChatId, currentUserUid);
  }, [actualChatId, currentUserUid, messages]);

  useFocusEffect(
    React.useCallback(() => {
      markUnreadAsRead();
    }, [markUnreadAsRead])
  );

  // Also mark as read whenever new messages arrive while screen is already focused
  useEffect(() => {
    if (isScreenFocused) {
      markUnreadAsRead();
    }
  }, [isScreenFocused, messages, markUnreadAsRead]);

  // ─── Firestore fallback listener when WebSocket is not connected ─────────────
// ─── Firestore fallback listener ─────────────────────────────────────────────
// useEffect(() => {
//   const invalidChatId =
//     !actualChatId ||
//     actualChatId === 'default' ||
//     actualChatId.startsWith('temp_') ||
//     actualChatId.startsWith('request_');

//   if (invalidChatId) return;

//   // Wait 2 seconds before attaching Firestore listener
//   // This gives WebSocket time to authenticate on initial mount
//   // so we don't attach the listener unnecessarily on every chat open
//   const attachDelay = setTimeout(() => {
//     if (wsChatService.isConnected && wsChatService.isAuthenticated) {
//       console.log('✅ WebSocket connected after delay check — skipping Firestore fallback');
//       return;
//     }

//     console.log('📡 WebSocket offline after delay — attaching Firestore fallback');

//     const messagesRef = firestore()
//       .collection('chats')
//       .doc(actualChatId)
//       .collection('messages')
//       .orderBy('createdAt', 'desc')
//       .limit(30);

//     const unsubscribe = messagesRef.onSnapshot(
//       (snapshot) => {
//         const filtered = snapshot.docs
//           .map(doc => ({ id: doc.id, ...doc.data() }))
//           .filter(msg => !(msg.deletedFor || {})[currentUserUid]);

//         if (filtered.length === 0) return;

//         setMessages(prev => {
//           if (prev.length === 0) {
//             filtered.forEach(m => wsChatService.addMessageToCache(actualChatId, m));
//             return filtered;
//           }
//           const prevMap = new Map(prev.map(m => [m.id, m]));
//           const merged = filtered.map(m => {
//             const existing = prevMap.get(m.id);
//             if (!existing) return m;
//             return {
//               ...m,
//               readBy: { ...m.readBy, ...existing.readBy },
//               deliveredTo: { ...m.deliveredTo, ...existing.deliveredTo },
//             };
//           });
//           const mergedIds = new Set(merged.map(m => m.id));
//           const result = [...merged, ...prev.filter(m => !mergedIds.has(m.id) && m.id.startsWith('temp_'))];
//           result.forEach(m => wsChatService.addMessageToCache(actualChatId, m));
//           return result;
//         });
//       },
//       (error) => console.error('Firestore listener error:', error)
//     );

//     // Store unsubscribe so we can clean it up
//     firestoreUnsubscribeRef.current = unsubscribe;
//   }, 2000); // 2 second delay

//   return () => {
//     clearTimeout(attachDelay);
//     if (firestoreUnsubscribeRef.current) {
//       firestoreUnsubscribeRef.current();
//       firestoreUnsubscribeRef.current = null;
//     }
//   };
// }, [actualChatId, currentUserUid, isConnected]);

  // ─── Set header ─────────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: '#1e1e1e' },
      headerTitleAlign: 'center',
      headerLeft: () => (
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          {headerAvatar ? (
            <Image source={{ uri: getCachedImageUri(headerAvatar) }} style={styles.headerAvatar} />
          ) : (
            <EmptydP size={36} initials={(headerTitle && headerTitle[0]) ? headerTitle[0] : '?'} />
          )}
        </View>
      ),
      headerRight: !isRequestMode && actualChatId && !actualChatId.startsWith('temp_') && !actualChatId.startsWith('request_')
        ? () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => {
                  navigation.navigate('Chatinfo', {
                    chatId: actualChatId,
                    chatType: chatData?.type,
                    chatTitle: headerTitle ?? title,
                    chatData: chatData || null,
                  });
                }}
                style={{ paddingHorizontal: 12, marginRight: 8 }}
              >
                <Text style={{ color: '#4e9bde', fontWeight: 'bold' }}>Info</Text>
              </TouchableOpacity>
            </View>
          )
        : undefined,
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={[styles.headerTitleText, { color: 'white' }]}>{headerTitle || 'Chat'}</Text>
          <Text style={[styles.headerSubtitle, { color: 'white' }]}>
            {isRequestMode ? 'Message Request' : otherUserTyping ? 'typing...' : onlineStatus}
          </Text>
        </View>
      ),
    });
  }, [headerTitle, headerAvatar, navigation, isRequestMode, isCreator, chatData, actualChatId, onlineStatus, otherUserTyping]);

  useEffect(() => {
    if (recipientInfo) {
      if ((!headerTitle || headerTitle === 'Chat') && (recipientInfo.name && recipientInfo.name.length > 0)) {
        setHeaderTitle(recipientInfo.name);
      }
      if (!headerAvatar && recipientInfo.avatar) {
        setHeaderAvatar(recipientInfo.avatar);
      }
    }
  }, [recipientInfo]);

  // ─── Typing indicator ───────────────────────────────────────────────────────
  const handleInputChange = (text) => {
    setInput(text);

    if (!isConnected || !actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
      return;
    }

    if (text.length > 0 && !isTyping) {
      setIsTyping(true);
      wsChatService.startTyping(actualChatId);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      wsChatService.stopTyping(actualChatId);
    }, 2000);
  };

  // ─── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;

    if (isTyping) {
      setIsTyping(false);
      wsChatService.stopTyping(actualChatId);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }

    if (isRequestMode && actualChatId.startsWith('temp_request_')) {
      await sendMessageRequest();
      return;
    }

    try {
      // Step 1: SQLite optimistic insert happens inside wsChatService first
      // Step 2: UI renders immediately using the optimisticMessage it returns.
      const { optimisticMessage, ackPromise } = await wsChatService.sendMessage(
        actualChatId,
        currentUserUid,
        text
      );

      setMessages(prevMessages => [optimisticMessage, ...prevMessages]);
      setInput('');

      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 50);

       await chatSQLiteService.debugDumpMessages(actualChatId);
      ackPromise.catch((error) => {
  const msg = (error?.message || '').toLowerCase();

  // Not real failures — message stays with clock icon
  if (msg.includes('timeout') || msg.includes('offline') || msg.includes('queued')) {
    return;
  }

  // Real server rejection — show retry icon
  console.error('Message send failed:', error.message);
  setMessages(prev =>
    prev.map(m => m.id === optimisticMessage.id
      ? { ...m, status: 'failed' }
      : m
    )
  );
});
    } catch (error) {
      console.error('Error sending message:', error);
      setInput(text);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  };

  

  // ─── Send message request ───────────────────────────────────────────────────
  const sendMessageRequest = async () => {
    if (!input.trim() || !recipientInfo) return;

    try {
      await chatService.sendMessageRequest(currentUserUid, recipientInfo.id, input.trim());
      setInput('');
      Alert.alert(
        'Message Request Sent',
        'Your message request has been sent successfully.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to send message request');
    }
  };

  // ─── Media upload ───────────────────────────────────────────────────────────
  const uploadMediaToStorage = async (uri, type) => {
    try {
      const extension = type === 'video' ? 'mp4' : 'jpg';
      const fileName = `${currentUserUid}_${Date.now()}.${extension}`;
      const reference = storage().ref(`chat_media/${actualChatId}/${fileName}`);

      const task = reference.putFile(uri);

      task.on('state_changed', (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      });

      await task;
      const downloadURL = await reference.getDownloadURL();
      return downloadURL;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  };

  const handleMediaSelection = async (type) => {
    setShowMediaPicker(false);

    const galleryPermission = await requestgallerypermission();
    if (!galleryPermission) {
      Alert.alert('Permission Denied', 'Gallery permission is required to select media');
      return;
    }

    const options = {
      mediaType: type,
      quality: 0.8,
      includeBase64: false,
      videoQuality: 'medium',
    };

    launchImageLibrary(options, async (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Error', response.errorMessage || 'Failed to select media');
        return;
      }

      if (response.assets && response.assets.length > 0) {
        const asset = response.assets[0];

        try {
          setUploading(true);
          setUploadProgress(0);

          const mediaUrl = await uploadMediaToStorage(
            asset.uri,
            type === 'video' ? 'video' : 'image'
          );

          const { optimisticMessage, ackPromise } = await wsChatService.sendMessage(
            actualChatId,
            currentUserUid,
            type === 'video' ? '📹 Video' : '📷 Photo',
            mediaUrl,
            type === 'video' ? 'video' : 'image'
          );

          setMessages(prevMessages => [optimisticMessage, ...prevMessages]);

         ackPromise.catch((error) => {
  const msg = (error?.message || '').toLowerCase();

  // Not real failures — message stays with clock icon
  if (msg.includes('timeout') || msg.includes('offline') || msg.includes('queued')) {
    return;
  }

  // Real server rejection — show retry icon
  console.error('Message send failed:', error.message);
  setMessages(prev =>
    prev.map(m => m.id === optimisticMessage.id
      ? { ...m, status: 'failed' }
      : m
    )
  );
});

          setUploading(false);
          setUploadProgress(0);

          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          }, 100);

        } catch (error) {
          setUploading(false);
          setUploadProgress(0);
          Alert.alert('Error', 'Failed to upload media');
          console.error('Media upload error:', error);
        }
      }
    });
  };

  const handleCameraCapture = async () => {
    setShowMediaPicker(false);

    const cameraPermission = await requestcamerapermission();
    if (!cameraPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required to take photos');
      return;
    }

    const options = {
      mediaType: 'photo',
      quality: 0.8,
      includeBase64: false,
      saveToPhotos: true,
    };

    launchCamera(options, async (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Error', response.errorMessage || 'Failed to capture photo');
        return;
      }

      if (response.assets && response.assets.length > 0) {
        const asset = response.assets[0];

        try {
          setUploading(true);
          setUploadProgress(0);

          const mediaUrl = await uploadMediaToStorage(asset.uri, 'image');

          const { optimisticMessage, ackPromise } = await wsChatService.sendMessage(
            actualChatId,
            currentUserUid,
            '📷 Photo',
            mediaUrl,
            'image'
          );

          setMessages(prevMessages => [optimisticMessage, ...prevMessages]);

          ackPromise.catch((error) => {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('offline') || msg.includes('queued')) return;
  console.error('Photo send failed:', error.message);
  setMessages(prev =>
    prev.map(m => m.id === optimisticMessage.id ? { ...m, status: 'failed' } : m)
  );
});

          setUploading(false);
          setUploadProgress(0);

          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          }, 100);

        } catch (error) {
          setUploading(false);
          setUploadProgress(0);
          Alert.alert('Error', 'Failed to upload photo');
          console.error('Camera upload error:', error);
        }
      }
    });
  };

  // ─── Accept / Reject request ────────────────────────────────────────────────
  const handleAcceptRequest = async () => {
    try {
      if (!requestData) return;
      await chatService.acceptMessageRequest(requestData.id, currentUserUid);
      Alert.alert(
        'Request Accepted',
        'You can now chat with this person. The chat has been added to your conversations.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to accept request');
    }
  };

  const handleRejectRequest = async () => {
    Alert.alert(
      'Reject Request',
      'Are you sure you want to reject this message request?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!requestData) return;
              await chatService.rejectMessageRequest(requestData.id, currentUserUid);
              Alert.alert('Request Rejected', 'The message request has been rejected.', [
                { text: 'OK', onPress: () => navigation.goBack() }
              ]);
            } catch (error) {
              Alert.alert('Error', 'Failed to reject request');
            }
          }
        }
      ]
    );
  };


   const loadMoreMessages = useCallback(async () => {
     const currentOldest = oldestMessageIdRef.current;
    if (
      isFetchingMore ||
      !hasMoreMessages ||
      !currentOldest||

      !actualChatId ||
      actualChatId.startsWith('temp_') ||
      actualChatId.startsWith('request_')
    ) return;

    setIsFetchingMore(true);
    try {
      const response = await wsChatService.fetchMessageHistory(
        actualChatId,
        PAGE_SIZE,
        currentOldest
      );

      const olderMessages = response.messages || [];

      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      const filtered = olderMessages.filter(msg => {
        const deletedFor = msg.deletedFor || {};
        return !deletedFor[currentUserUid];
      });

      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newOnes = filtered.filter(m => !existingIds.has(m.id));
        return [...prev, ...newOnes];
      });

      wsChatService.appendOlderMessagesToCache(actualChatId, filtered);

      const oldest = filtered[filtered.length - 1];
      setOldestMessageId(oldest?.id ?? null);
      setHasMoreMessages(response.hasMore ?? filtered.length === PAGE_SIZE);

    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setIsFetchingMore(false);
    }
  }, [isFetchingMore, hasMoreMessages, actualChatId, currentUserUid]);

  // ─── Message status for direct chats ─────────────────────────────────────────────────────────
//   const getMessageStatus = (message) => {
//   if (message.senderId !== currentUserUid || message.isRequestMessage) return null;

//   const override = localMessageStatus[message.id];
//   if (override) return override;

//   if (message.status === 'sending') return 'sending';
//   if (message.status === 'failed') return 'failed';

//   // ✅ FIX: If chat metadata hasn't loaded yet, show clock instead of single tick
//   const targetRecipientId = recipientId || userId;
//   const participantsLoaded = chatData?.participants?.length > 0 || targetRecipientId;
  
//   if (!participantsLoaded) {
//     // Don't show a tick at all until we know who the recipient is
//     if (message.id && !message.id.startsWith('temp_')) return 'sent';
//     return 'sending';
//   }

//   // resolve actual recipient
//   const resolvedRecipient = targetRecipientId || 
//     chatData?.participants?.find(id => id !== currentUserUid);

//   if (!resolvedRecipient) {
//     return message.id && !message.id.startsWith('temp_') ? 'sent' : 'sending';
//   }

//   const readBy = message.readBy || {};
//   const deliveredTo = message.deliveredTo || {};

//   if (readBy[resolvedRecipient]) return 'seen';
//   if (deliveredTo[resolvedRecipient]) return 'delivered';
//   if (message.id && !message.id.startsWith('temp_')) return 'sent';
//   return 'sending';
// };


// for group chats
const getMessageStatus = (message) => {
  if (message.senderId !== currentUserUid || message.isRequestMessage) return null;

  if (message.status === 'sending') return 'sending';
  if (message.status === 'failed') return 'failed';
  if (message.id?.startsWith('temp_')) return 'sending';

  // For both direct and group — just show sent once server confirms
  return 'sent';
};

// for group chats tick render
const renderTicks = (status, item) => {
  if (!status) return null;

  if (status === 'failed') {
    return (
      <TouchableOpacity onPress={() => item && retryFailedMessage(item)}>
        <Icon name="alert-circle-outline" size={14} color="#FF3B30" style={styles.tickIcon} />
      </TouchableOpacity>
    );
  }
  if (status === 'sending') {
    return <Icon name="time-outline" size={14} color="rgba(255,255,255,0.5)" style={styles.tickIcon} />;
  }
  // sent
  return <Icon name="checkmark-outline" size={14} color="rgba(255,255,255,0.7)" style={styles.tickIcon} />;
};


// for directchats
//   const renderTicks = (status) => {
//     if (!status) return null;

//     const tickColor = 'rgba(0, 0, 0, 0.7)';
//     const tickseenColor = 'rgba(201, 241, 23, 0.91)';
//     const tickdeliveredColor = 'rgba(0, 0, 0, 0.7)';

//  try {
//     // ← ADD THIS
//     if (status === 'failed') {
//       return (
//         <TouchableOpacity onPress={() => item && retryFailedMessage(item)}>
//           <Icon name="alert-circle-outline" size={14} color="#FF3B30" style={styles.tickIcon} />
//         </TouchableOpacity>
//       );
//     }

    
//       if (status === 'sending') {
//         return <Icon name="time-outline" size={14} color="rgba(0, 0, 0, 0.5)" style={styles.tickIcon} />;
//       } else if (status === 'seen') {
//         return <Icon name="checkmark-done" size={14} color={tickseenColor} style={styles.tickIcon} />;
//       } else if (status === 'delivered') {
//         return <Icon name="checkmark-done-outline" size={14} color={tickdeliveredColor} style={styles.tickIcon} />;
//       } else {
//         return <Icon name="checkmark-outline" size={14} color={tickColor} style={styles.tickIcon} />;
//       }
//     } catch (error) {
//       console.error('Error rendering ticks:', error);
//       return (
//         <Text style={styles.tickText}>
//           {status === 'seen' ? '✓✓' : status === 'delivered' ? '✓✓' : '✓'}
//         </Text>
//       );
//     }
//   };

const getSenderInfo = (senderId) => {
  if (!senderId || senderId === currentUserUid) return null;
  const info = chatData?.participantsInfo?.[senderId];
  return {
    name: info?.displayName || info?.name || info?.username || 'Unknown',
    avatar: info?.avatar || null,
  };
}

  // ─── Delete message ─────────────────────────────────────────────────────────
  const handleLongPressMessage = (item) => {
    if (item.senderId !== currentUserUid) return;
    if (item.messageType === 'deleted' || item.deletedForEveryone) return;

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message for everyone?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', onPress: () => deleteMessageForEveryone(item), style: 'destructive' }
      ]
    );
  };

const retryFailedMessage = useCallback(async (item) => {
  if (item.status !== 'failed') return;

  setMessages(prev =>
    prev.map(m => m.tempId === item.tempId ? { ...m, status: 'sending' } : m)
  );

  try {
    const { ackPromise } = await wsChatService.sendMessage(
      actualChatId, currentUserUid, item.text
    );
    ackPromise.catch(() => {
      setMessages(prev =>
        prev.map(m => m.tempId === item.tempId ? { ...m, status: 'failed' } : m)
      );
    });
  } catch (error) {
    setMessages(prev =>
      prev.map(m => m.tempId === item.tempId ? { ...m, status: 'failed' } : m)
    );
  }
}, [actualChatId, currentUserUid]);

  const deleteMessageForEveryone = async (item) => {
    const deletedPlaceholder = {
      ...item,
      text: 'This message was deleted',
      messageType: 'deleted',
      deletedForEveryone: true,
      imageUrl: null,
      videoUrl: null
    };

    // Optimistic update
    setMessages(prevMessages =>
      prevMessages.map(msg => msg.id === item.id ? deletedPlaceholder : msg)
    );
    wsChatService.updateMessageInCache(actualChatId, deletedPlaceholder);

    try {
      if (item.imageUrl) {
        try {
          const imageRef = storage().refFromURL(item.imageUrl);
          await imageRef.delete();
        } catch (error) {
          console.error('Error deleting image:', error);
        }
      }

      if (item.videoUrl) {
        try {
          const videoRef = storage().refFromURL(item.videoUrl);
          await videoRef.delete();
        } catch (error) {
          console.error('Error deleting video:', error);
        }
      }

      await firestore()
        .collection('chats')
        .doc(actualChatId)
        .collection('messages')
        .doc(item.id)
        .update({
          text: 'This message was deleted',
          messageType: 'deleted',
          deletedForEveryone: true,
          deletedAt: firestore.FieldValue.serverTimestamp(),
          imageUrl: firestore.FieldValue.delete(),
          videoUrl: firestore.FieldValue.delete()
        });

      // Update lastMessage if we deleted the most recent one
      const isLastMessage = messages[0]?.id === item.id;
      if (isLastMessage) {
        const previousMessage = messages[1];
        const chatRef = firestore().collection('chats').doc(actualChatId);
        if (previousMessage) {
          await chatRef.update({
            lastMessage: {
              id: previousMessage.id,
              senderId: previousMessage.senderId,
              text: previousMessage.text || (previousMessage.messageType === 'image' ? '📷 Photo' : previousMessage.messageType === 'video' ? '📹 Video' : 'Media'),
              createdAt: previousMessage.createdAt
            },
            updatedAt: firestore.FieldValue.serverTimestamp()
          });
        } else {
          await chatRef.update({
            lastMessage: null,
            updatedAt: firestore.FieldValue.serverTimestamp()
          });
        }
      }

      wsChatService.notifyMessageUpdated(actualChatId, {
        ...deletedPlaceholder,
        createdAt: item.createdAt
      });

      InteractionManager.runAfterInteractions(() => {
        Alert.alert('Success', 'Message deleted for everyone');
      });
    } catch (error) {
      console.error('Error deleting message for everyone:', error);
      // Rollback optimistic update
      setMessages(prevMessages =>
        prevMessages.map(msg => (msg.id === item.id ? item : msg))
      );
      wsChatService.updateMessageInCache(actualChatId, item);
      InteractionManager.runAfterInteractions(() => {
        Alert.alert('Error', 'Failed to delete message');
      });
    }
  };


  
const downloadMedia = async (item) => {
   if (item.senderId === currentUserUid) return;
  const messageId = item.id;
  const isVideo = item.messageType === 'video';
  const remoteUrl = isVideo ? item.videoUrl : item.imageUrl;

  if (!remoteUrl) return;
  if (localMediaPaths.current[messageId]) return;

  setDownloadStates(prev => ({ ...prev, [messageId]: 'downloading' }));

  try {
    const extension = isVideo ? 'mp4' : 'jpg';
    const fileName = `chat_${messageId}.${extension}`;

    const destDir = Platform.OS === 'android'
      ? RNFS.DownloadDirectoryPath
      : RNFS.DocumentDirectoryPath;
     
    const destPath = `${destDir}/${fileName}`;

    // Reuse if already on disk
    const exists = await RNFS.exists(destPath);
    if (exists) {
      localMediaPaths.current[messageId] = destPath;
      // ✅ Persist to AsyncStorage
      await AsyncStorage.setItem(
        'downloadedMediaPaths',
        JSON.stringify(localMediaPaths.current)
      );
      setDownloadStates(prev => ({ ...prev, [messageId]: 'done' }));
      return;
    }

    await RNFS.downloadFile({
      fromUrl: remoteUrl,
      toFile: destPath,
      background: true,
      discretionary: true,
    }).promise;

    localMediaPaths.current[messageId] = destPath;

    // ✅ Persist to AsyncStorage so it survives app restarts
    await AsyncStorage.setItem(
      'downloadedMediaPaths',
      JSON.stringify(localMediaPaths.current)
    );

    setDownloadStates(prev => ({ ...prev, [messageId]: 'done' }));

    if (Platform.OS === 'android') {
      await RNFS.scanFile(destPath);
    }

    if (Platform.OS === 'ios') {
      await CameraRoll.save(`file://${destPath}`, {
        type: isVideo ? 'video' : 'photo',
        album: 'Chat Media',
      });
    }

    Alert.alert('Saved', isVideo ? 'Video saved to gallery.' : 'Image saved to gallery.');
  } catch (error) {
    console.error('Download error:', error);
    setDownloadStates(prev => ({ ...prev, [messageId]: 'idle' }));
    Alert.alert('Error', 'Failed to download. Please try again.');
  }
};



  // ─── Render message item ────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
  // ── System / GitHub messages (unchanged) ──────────────────────────────────
  if (item.isSystemMessage || item.senderId === 'system' || item.senderId === 'github') {
    const isGitHubEvent = item.senderId === 'github' || item.type === 'github_event';
    return (
      <View style={[styles.systemMessageContainer, isGitHubEvent && styles.githubMessageContainer]}>
        <View style={styles.systemMessageContent}>
          <Icon
            name={isGitHubEvent ? 'logo-github' : 'information-circle-outline'}
            size={16}
            color={isGitHubEvent ? '#6e5494' : '#007AFF'}
          />
          <Text style={[styles.systemMessageText, isGitHubEvent && styles.githubMessageText]}>
            {item.text}
          </Text>
        </View>
        <Text style={[styles.systemMessageTime, isGitHubEvent && styles.githubMessageTime]}>
          {item.createdAt
            ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : ''}
        </Text>
      </View>
    );
  }

  const messageStatus = getMessageStatus(item);
  const isUserMessage = item.senderId === currentUserUid;
  const isDeleted = item.messageType === 'deleted' || item.deletedForEveryone;

  // ── Download state for this message ───────────────────────────────────────
  const dlState   = downloadStates[item.id] || 'idle';
  const localPath = localMediaPaths.current[item.id];
  const isGroup = chatData?.type === 'group';
const senderInfo = (!isUserMessage && isGroup) ? getSenderInfo(item.senderId) : null;

  // Use local file URI if downloaded, otherwise stream from Firebase
  const getDisplayUri = (remoteUrl, messageId) => {
  const path = localMediaPaths.current[messageId];
  if (!path) return remoteUrl;
  return Platform.OS === 'android' ? `file://${path}` : path;
};

  return (
     <View style={{ alignSelf: isUserMessage ? 'flex-end' : 'flex-start', marginVertical: 6, maxWidth: '80%' }}>

    {!!senderInfo && (
      <Text style={styles.senderName}>{senderInfo.name}</Text>
    )}

    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>

      {!!senderInfo && (
        senderInfo.avatar
          ? <Image source={{ uri: getCachedImageUri(senderInfo.avatar) }} style={styles.senderAvatar} />
          : <EmptydP size={28} initials={senderInfo.name?.[0] || '?'} />
      )}

      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => handleLongPressMessage(item)}
        style={[
          styles.messageContainer,
          isUserMessage ? styles.userMessage : styles.botMessage,
          item.isRequestMessage && styles.requestMessage,
          item.messageType === 'text' ? styles.textMessage : styles.mediaMessage,
          isDeleted && styles.deletedMessage,
          !!senderInfo && { marginLeft: 6 },
        ]}
      >
      {isDeleted ? (
        // ── Deleted message ────────────────────────────────────────────────
        <View style={styles.deletedMessageContent}>
          <Icon name="ban-outline" size={14} color="rgba(255,255,255,0.5)" />
          <Text style={styles.deletedMessageText}>
            {item.text || 'This message was deleted for everyone'}
          </Text>
        </View>
      ) : (
        <>
          {/* ── Image message ──────────────────────────────────────────────── */}
          {item.messageType === 'image' && item.imageUrl && (
            <View style={styles.mediaWrapper}>
              <Image
                source={{ uri: getDisplayUri(item.imageUrl,item.id) }}
                blurRadius={(!localPath && !isUserMessage) ? 50 : 0}
                style={[
                styles.messageImage,
                 (!localPath && !isUserMessage) && { opacity: 0.8 }
                  ]}
                resizeMode="cover"
                
              />

              {/* Download overlay — hidden once downloaded */}
              {!isUserMessage && dlState !== 'done' && (
                <TouchableOpacity
                  style={styles.downloadOverlay}
                  onPress={() => downloadMedia(item)}
                  disabled={dlState === 'downloading'}
                  activeOpacity={0.8}
                >
                  {dlState === 'downloading' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <View style={styles.downloadButton}>
                      <Icon name="arrow-down-outline" size={20} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* Green tick badge once saved */}
              {!isUserMessage && dlState === 'done' &&  (
                <View style={styles.savedBadge}>
                  <Icon name="checkmark-circle" size={10} color="#4CAF50" />
                </View>
              )}
            </View>
          )}

          {/* ── Video message ──────────────────────────────────────────────── */}
          {item.messageType === 'video' && item.videoUrl && (
            <View style={styles.mediaWrapper}>
              <Video
                source={{ uri: getDisplayUri(item.videoUrl,item.id) }}
                style={styles.messageVideo}
                controls
                resizeMode="cover"
                paused
              />

              {/* Download overlay — hidden once downloaded */}
              {dlState !== 'done' && (
                <TouchableOpacity
                  style={styles.downloadOverlay}
                  onPress={() => downloadMedia(item)}
                  disabled={dlState === 'downloading'}
                  activeOpacity={0.8}
                >
                  {dlState === 'downloading' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <View style={styles.downloadButton}>
                      <Icon name="arrow-down-outline" size={20} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* Green tick badge once saved */}
              {!isUserMessage && dlState === 'done' && (
                <View style={styles.savedBadge}>
                  <Icon name="checkmark-circle" size={10} color="#4CAF50" />
                </View>
              )}
            </View>
          )}

          {/* ── Text message (unchanged) ────────────────────────────────────── */}
          {item.messageType === 'text' && (
            <Text style={styles.messageText}>{item.text}</Text>
          )}
        </>
      )}

      {/* ── Timestamp + read ticks (unchanged) ─────────────────────────────── */}
      <View style={styles.messageFooter}>
        <Text style={styles.messageTime}>
          {item.createdAt
            ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : ''}
        </Text>
        {isUserMessage && !isDeleted && messageStatus && renderTicks(messageStatus,item)}
      </View>
    </TouchableOpacity>
     </View>
  </View>
  );
};

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const renderAcceptRejectButtons = () => {
    if (!showAcceptReject) return null;

    return (
      <View style={styles.acceptRejectContainer}>
        <TouchableOpacity style={styles.rejectButton} onPress={handleRejectRequest}>
          <Text style={styles.rejectButtonText}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptButton} onPress={handleAcceptRequest}>
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderMediaPicker = () => (
    <Modal
      visible={showMediaPicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowMediaPicker(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowMediaPicker(false)}
      >
        <View style={styles.mediaPickerContainer}>
          <Text style={styles.mediaPickerTitle}>Select Media Type</Text>

          <TouchableOpacity style={styles.mediaOption} onPress={handleCameraCapture}>
            <Icon name="camera-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.mediaOption} onPress={() => handleMediaSelection('photo')}>
            <Icon name="image-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.mediaOption} onPress={() => handleMediaSelection('video')}>
            <Icon name="videocam-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Video</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowMediaPicker(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  const renderUploadProgress = () => {
    if (!uploading) return null;

    return (
      <View style={styles.uploadProgressContainer}>
        <ActivityIndicator size="small" color="#FF6D1F" />
        <Text style={styles.uploadProgressText}>
          Uploading... {Math.round(uploadProgress)}%
        </Text>
      </View>
    );
  };

  const renderConnectionStatus = () => {
    if (isConnected) return null;

    return (
      <View style={styles.connectionStatusContainer}>
        <Icon name="cloud-offline-outline" size={16} color="#FF3B30" />
        <Text style={styles.connectionStatusText}>Connecting...</Text>
      </View>
    );
  };

  // ─── Main render ────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? undefined : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 100}
    >
      <SafeAreaView style={styles.safeArea}>
        {renderConnectionStatus()}
        {isLoadingMessages && messages.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF6D1F" />
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        ) : (
          <FlatList
  ref={flatListRef}
  data={messages}
  keyExtractor={(item) => item.id}
  renderItem={renderItem}
  inverted={!showAcceptReject}
  contentContainerStyle={styles.messagesList}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="handled"
  maintainVisibleContentPosition={{
    minIndexForVisible: 0,
    autoscrollToTopThreshold: 10,
  }}
  onEndReached={loadMoreMessages}
  onEndReachedThreshold={0.3}
  ListFooterComponent={
    isFetchingMore ? (
      <View style={styles.paginationLoader}>
        <ActivityIndicator size="small" color="#FF6D1F" />
        <Text style={styles.paginationLoaderText}>Loading older messages...</Text>
      </View>
    ) : null
  }
/>
        )}
        {renderAcceptRejectButtons()}
        {renderUploadProgress()}

        <View style={styles.inputContainer}>
          <TouchableOpacity
            onPress={() => setShowMediaPicker(true)}
            style={styles.attachButton}
            disabled={showAcceptReject || uploading }
          >
            <Icon
              name="attach-outline"
              size={24}
              color={showAcceptReject || uploading  ? "#666" : "#FF6D1F"}
            />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={handleInputChange}
            placeholder={
              isRequestMode && actualChatId.startsWith('temp_request_')
                ? "Write a message request..."
                : "Type your message..."
            }
            placeholderTextColor="#aaa"
            multiline
            maxLength={500}
            editable={!showAcceptReject }
            onFocus={() => {
              setTimeout(() => {
                if (!showAcceptReject) {
                  flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
                }
              }, 100);
            }}
          />
          <TouchableOpacity
            onPress={sendMessage}
            style={[
              styles.sendButton,
              { opacity: input.trim() && !showAcceptReject && !uploading   ? 1 : 0.5 }
            ]}
            disabled={!input.trim() || showAcceptReject || uploading  }
          >
            <Text style={styles.sendButtonText}>
              {isRequestMode && actualChatId.startsWith('temp_request_') ? 'Send Request' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      {renderMediaPicker()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: 'white'
  },
  safeArea: {
    flex: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  backButton: {
    marginRight: 10,
    padding: 5,
  },
  backButtonText: {
    color: 'white',
    fontSize: 30,
    fontWeight: 'bold',
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  headerTitle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: 'white',
    fontSize: 12,
  },
  messagesList: {
    padding: 15,
    paddingBottom: 10,
  },
  messageContainer: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 16,
    // maxWidth: '80%',
    alignSelf:'stretch',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  mediaMessage: {
    padding: 6,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
    paddingBottom: 24,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#ED7117',
    borderBottomRightRadius: 4,
    shadowColor: '#FDA172',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  botMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#000',
    borderBottomLeftRadius: 4,
  },
  requestMessage: {
    borderWidth: 2,
    borderColor: '#007AFF',
    backgroundColor: '#1a1a2e',
  },
  messageText: {
    color: 'white',
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  messageImage: {
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_WIDTH * 0.6,
    borderRadius: 2,
    marginBottom: 4,
    backgroundColor: '#000',
  },
  messageVideo: {
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_WIDTH * 0.6 * 0.75,
    borderRadius: 2,
    marginBottom: 2,
    backgroundColor: '#000',
  },
  messageTime: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  textMessage: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 20,
    paddingRight: 20,
    minWidth: 80, 
  },
  messageFooter: {
    position: 'absolute',
    bottom: 2,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tickIcon: {
    marginLeft: 2,
    opacity: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1,
  },
  tickText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.75)',
    marginLeft: 2,
    opacity: 0.85,
  },
  systemMessageContainer: {
    alignSelf: 'center',
    marginVertical: 8,
    maxWidth: '85%',
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  githubMessageContainer: {
    backgroundColor: 'rgba(110, 84, 148, 0.1)',
    borderColor: 'rgba(110, 84, 148, 0.3)',
  },
  systemMessageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  systemMessageText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  githubMessageText: {
    color: '#6e5494',
  },
  systemMessageTime: {
    color: 'rgba(0, 122, 255, 0.6)',
    fontSize: 10,
    textAlign: 'center',
  },
  githubMessageTime: {
    color: 'rgba(110, 84, 148, 0.6)',
  },
  acceptRejectContainer: {
    flexDirection: 'row',
    padding: 15,
    gap: 10,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 25,
    alignItems: 'center',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: 12,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  acceptButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  rejectButtonText: {
    color: '#FF3B30',
    fontWeight: 'bold',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 10,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'flex-end',
  },
  attachButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: 'white',
    fontSize: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    backgroundColor: '#2b2b2b',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#444',
    maxHeight: 100,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: '#1e1e1e',
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  sendButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  mediaPickerContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  mediaPickerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  mediaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2b2b2b',
    borderRadius: 12,
    marginBottom: 12,
  },
  mediaOptionText: {
    color: 'white',
    fontSize: 16,
    marginLeft: 16,
    fontWeight: '500',
  },
  cancelButton: {
    padding: 16,
    backgroundColor: '#333',
    borderRadius: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  uploadProgressText: {
    color: '#FF6D1F',
    fontSize: 14,
    marginLeft: 10,
    fontWeight: '500',
  },
  deletedMessage: {
    opacity: 0.7,
  },
  deletedMessageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 15,
  },
  deletedMessageText: {
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 12,
  },
  connectionStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#FF3B30',
  },
  connectionStatusText: {
    color: 'white',
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
  },
  paginationLoader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: 14,
  gap: 8,
},
paginationLoaderText: {
  color: 'rgba(255,255,255,0.5)',
  fontSize: 12,
  fontWeight: '500',
},

 mediaWrapper: {
    position: 'relative',       // lets the overlay sit on top of the image/video
  },
  downloadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
  },
  downloadButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  savedBadge: {
    position: 'absolute',
    bottom: 3,
    left: 2,
  },
  senderName: {
  color: '#FF6D1F',        // use your brand orange, or pick per-user with a hash fn
  fontSize: 11,
  fontWeight: '600',
  marginBottom: 2,
  marginLeft: 34,          // align with bubble (past the avatar width)
},
senderAvatar: {
  width: 28,
  height: 28,
  borderRadius: 14,
  marginBottom: 2,         // sits at bottom of avatar, aligning with bubble base
},

});