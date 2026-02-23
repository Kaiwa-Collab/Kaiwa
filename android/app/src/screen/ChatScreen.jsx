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
import { useFocusEffect } from '@react-navigation/native';
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
  const currentUserUid = auth().currentUser?.uid;
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
  const typingTimeoutRef = useRef(null);
  const [mediaViewer, setMediaViewer] = useState({ visible: false, uri: null, type: null });
  const { getCachedImageUri } = useUserData();

  // ─── WebSocket connection status (connection is initiated by AuthWrapper on app open) ───
  useEffect(() => {
    setIsConnected(wsChatService.isConnected);

    const connectionCheckInterval = setInterval(() => {
      const currentStatus = wsChatService.isConnected;
      if (currentStatus !== isConnected) {
        setIsConnected(currentStatus);
      }
    }, 2000);

    return () => {
      clearInterval(connectionCheckInterval);
      if (actualChatId && !actualChatId.startsWith('temp_') && !actualChatId.startsWith('request_')) {
        wsChatService.leaveChat(actualChatId);
        console.log('👋 Left chat room:', actualChatId);
      }
    };
  }, [actualChatId]);

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
  // FIX: Added proper auth waiting + up to 4 retries with increasing backoff
  useEffect(() => {
    const invalidChatId = !actualChatId ||
      actualChatId === 'default' ||
      actualChatId.startsWith('temp_') ||
      actualChatId.startsWith('request_');
    if (invalidChatId) {
      setIsLoadingMessages(false);
      return;
    }

    let cancelled = false;

    const loadMessages = async (retryCount = 0) => {
      // Show cached messages immediately (instant display)
      const cached = wsChatService.getCachedMessages(actualChatId);
      if (cached && cached.length > 0) {
        const filteredCached = cached.filter(msg => {
          const deletedFor = msg.deletedFor || {};
          return !deletedFor[currentUserUid];
        });
        setMessages(filteredCached);
        setIsLoadingMessages(false);
      } else {
        setIsLoadingMessages(true);
      }

      try {
        // FIX: Wait for auth before attempting to fetch — critical for APK builds
        // where Firebase auth initialises slower than in dev.
        const authReady = await wsChatService.waitForAuth();
        if (cancelled) return;

        if (!authReady) {
          // auth still not ready after waitForAuth timeout
          if (retryCount < 3) {
            const delay = (retryCount + 1) * 1500;
            console.warn(`⚠️ Auth not ready yet (attempt ${retryCount + 1}), retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            if (cancelled) return;
            return loadMessages(retryCount + 1);
          }
          throw new Error('Authentication timed out');
        }

        console.log(`📥 Loading messages (attempt ${retryCount + 1})...`);
        const { messages: historyMessages } = await wsChatService.fetchMessageHistory(actualChatId, 50);
        if (cancelled) return;

        const filteredMessages = (historyMessages || []).filter(msg => {
          const deletedFor = msg.deletedFor || {};
          return !deletedFor[currentUserUid];
        });
        setMessages(filteredMessages);
        console.log(`✅ Messages loaded: ${filteredMessages.length} messages`);

        // Mark undelivered messages as delivered
        if (wsChatService.isConnected) {
          const undeliveredMessageIds = filteredMessages
            .filter(msg => {
              if (msg.senderId === currentUserUid) return false;
              const deliveredTo = msg.deliveredTo || {};
              return !deliveredTo[currentUserUid];
            })
            .map(msg => msg.id);
          if (undeliveredMessageIds.length > 0) {
            wsChatService.markMessagesAsDelivered(actualChatId, undeliveredMessageIds);
          }
        }
      } catch (error) {
        if (cancelled) return;

        // FIX: Retry up to 3 more times with increasing delay
        if (retryCount < 3) {
          const delay = (retryCount + 1) * 1500; // 1.5s → 3s → 4.5s
          console.warn(`⚠️ Load messages failed (attempt ${retryCount + 1}), retrying in ${delay}ms... Error: ${error.message}`);
          await new Promise(r => setTimeout(r, delay));
          if (cancelled) return;
          return loadMessages(retryCount + 1);
        }

        console.error('Error loading messages after all retries:', error);
        Alert.alert(
          'Loading Error',
          'Failed to load messages. Please try again.',
          [{ text: 'OK' }]
        );
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

    if (!isConnected) {
      return;
    }

    try {
      wsChatService.joinChat(actualChatId);
    } catch (e) {
      console.warn('Could not join chat room:', e);
    }

    const handleNewMessage = (message) => {
      console.log('New message received:', message);

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
        const existingIndex = withoutTemps.findIndex(m => m.id === data.message.id);
        if (existingIndex !== -1) {
          return withoutTemps.map((m, i) =>
            i === existingIndex ? data.message : m
          );
        }
        return [data.message, ...withoutTemps];
      });
      wsChatService.addMessageToCache(actualChatId, data.message);
    };

    const handleMessageError = (data) => {
      console.error('Message error:', data);
      setMessages(prev => prev.filter(msg => msg.id !== data.tempId));
      Alert.alert('Error', data.error || 'Failed to send message');
    };

    const handleMessagesDelivered = (data) => {
      setMessages(prev =>
        prev.map(msg => {
          if (data.messageIds.includes(msg.id)) {
            return {
              ...msg,
              deliveredTo: {
                ...msg.deliveredTo,
                [data.userId]: new Date().toISOString()
              }
            };
          }
          return msg;
        })
      );
    };

    const handleMessagesRead = (data) => {
      setMessages(prev =>
        prev.map(msg => {
          if (data.messageIds.includes(msg.id)) {
            return {
              ...msg,
              readBy: {
                ...msg.readBy,
                [data.userId]: new Date().toISOString()
              }
            };
          }
          return msg;
        })
      );
    };

    const handleUserTyping = (data) => {
      if (data.chatId === actualChatId && data.userId !== currentUserUid) {
        setOtherUserTyping(data.isTyping);
      }
    };

    const handleMessageUpdated = (data) => {
      if (data.chatId === actualChatId && data.message) {
        setMessages(prev =>
          prev.map(msg => msg.id === data.message.id ? data.message : msg)
        );
        wsChatService.updateMessageInCache(actualChatId, data.message);
      }
    };

    wsChatService.addListener('new_message', handleNewMessage);
    wsChatService.addListener('message_confirmed', handleMessageConfirmed);
    wsChatService.addListener('message_error', handleMessageError);
    wsChatService.addListener('messages_delivered', handleMessagesDelivered);
    wsChatService.addListener('messages_read', handleMessagesRead);
    wsChatService.addListener('user_typing', handleUserTyping);
    wsChatService.addListener('message_updated', handleMessageUpdated);

    return () => {
      wsChatService.removeListener('new_message', handleNewMessage);
      wsChatService.removeListener('message_confirmed', handleMessageConfirmed);
      wsChatService.removeListener('message_error', handleMessageError);
      wsChatService.removeListener('messages_delivered', handleMessagesDelivered);
      wsChatService.removeListener('messages_read', handleMessagesRead);
      wsChatService.removeListener('user_typing', handleUserTyping);
      wsChatService.removeListener('message_updated', handleMessageUpdated);
      wsChatService.leaveChat(actualChatId);
    };
  }, [actualChatId, currentUserUid, isConnected]);

  // ─── Mark messages as read on focus ─────────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      if (actualChatId && !actualChatId.startsWith('temp_') && !actualChatId.startsWith('request_') && isConnected) {
        const unreadMessageIds = messages
          .filter(msg => {
            if (msg.senderId === currentUserUid) return false;
            const readBy = msg.readBy || {};
            return !readBy[currentUserUid];
          })
          .map(msg => msg.id);

        if (unreadMessageIds.length > 0) {
          wsChatService.markMessagesAsRead(actualChatId, unreadMessageIds);
        }
      }
    }, [actualChatId, currentUserUid, messages, isConnected])
  );

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

    const tempId = `temp_${Date.now()}_${Math.random()}`;
    const optimisticMessage = {
      id: tempId,
      senderId: currentUserUid,
      text: text,
      messageType: 'text',
      createdAt: new Date().toISOString(),
      readBy: { [currentUserUid]: new Date().toISOString() },
      deliveredTo: {},
      edited: false,
      status: 'sending',
    };

    setMessages(prevMessages => [optimisticMessage, ...prevMessages]);
    setInput('');

    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 50);

    try {
      const result = await wsChatService.sendMessage(actualChatId, currentUserUid, text);
      console.log('Message sent successfully:', result);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempId));
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

          await wsChatService.sendMessage(
            actualChatId,
            currentUserUid,
            type === 'video' ? '📹 Video' : '📷 Photo',
            mediaUrl,
            type === 'video' ? 'video' : 'image'
          );

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

          await wsChatService.sendMessage(
            actualChatId,
            currentUserUid,
            '📷 Photo',
            mediaUrl,
            'image'
          );

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

  // ─── Message status ─────────────────────────────────────────────────────────
  const getMessageStatus = (message) => {
    if (message.senderId !== currentUserUid || message.isRequestMessage) {
      return null;
    }

    if (message.status === 'sending') {
      return 'sending';
    }

    const targetRecipientId = recipientId || userId;

    if (!targetRecipientId && chatData?.participants) {
      const otherParticipant = chatData.participants.find(id => id !== currentUserUid);
      if (otherParticipant) {
        const readBy = message.readBy || {};
        const deliveredTo = message.deliveredTo || {};

        if (readBy[otherParticipant]) return 'seen';
        if (deliveredTo[otherParticipant]) return 'delivered';
        if (message.id && !message.id.startsWith('temp_')) return 'sent';
      }
    }

    if (!targetRecipientId) {
      if (message.id && !message.id.startsWith('temp_')) return 'sent';
      return 'sending';
    }

    const readBy = message.readBy || {};
    const deliveredTo = message.deliveredTo || {};

    if (readBy[targetRecipientId]) return 'seen';
    if (deliveredTo[targetRecipientId]) return 'delivered';
    if (message.id && !message.id.startsWith('temp_')) return 'sent';

    return 'sending';
  };

  const renderTicks = (status) => {
    if (!status) return null;

    const tickColor = 'rgba(0, 0, 0, 0.7)';

    try {
      if (status === 'sending') {
        return <Icon name="time-outline" size={14} color="rgba(0, 0, 0, 0.5)" style={styles.tickIcon} />;
      } else if (status === 'seen') {
        return <Icon name="checkmark-done" size={14} color={tickColor} style={styles.tickIcon} />;
      } else if (status === 'delivered') {
        return <Icon name="checkmark-done-outline" size={14} color={tickColor} style={styles.tickIcon} />;
      } else {
        return <Icon name="checkmark-outline" size={14} color={tickColor} style={styles.tickIcon} />;
      }
    } catch (error) {
      console.error('Error rendering ticks:', error);
      return (
        <Text style={styles.tickText}>
          {status === 'seen' ? '✓✓' : status === 'delivered' ? '✓✓' : '✓'}
        </Text>
      );
    }
  };

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

  // ─── Render message item ────────────────────────────────────────────────────
  const renderItem = ({ item }) => {
    if (item.isSystemMessage || item.senderId === 'system' || item.senderId === 'github') {
      const isGitHubEvent = item.senderId === 'github' || item.type === 'github_event';

      return (
        <View style={[styles.systemMessageContainer, isGitHubEvent && styles.githubMessageContainer]}>
          <View style={styles.systemMessageContent}>
            <Icon
              name={isGitHubEvent ? "logo-github" : "information-circle-outline"}
              size={16}
              color={isGitHubEvent ? "#6e5494" : "#007AFF"}
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

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => handleLongPressMessage(item)}
        style={[
          styles.messageContainer,
          isUserMessage ? styles.userMessage : styles.botMessage,
          item.isRequestMessage && styles.requestMessage,
          item.messageType === 'text' ? styles.textMessage : styles.mediaMessage,
          isDeleted && styles.deletedMessage,
        ]}
      >
        {isDeleted ? (
          <View style={styles.deletedMessageContent}>
            <Icon name="ban-outline" size={14} color="rgba(255,255,255,0.5)" />
            <Text style={styles.deletedMessageText}>
              {item.text || 'This message was deleted for everyone'}
            </Text>
          </View>
        ) : (
          <>
            {item.messageType === 'image' && item.imageUrl && (
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.messageImage}
                resizeMode="cover"
              />
            )}

            {item.messageType === 'video' && item.videoUrl && (
              <Video
                source={{ uri: item.videoUrl }}
                style={styles.messageVideo}
                controls
                resizeMode="cover"
                paused
              />
            )}

            {item.messageType === 'text' && (
              <Text style={styles.messageText}>{item.text}</Text>
            )}
          </>
        )}

        <View style={styles.messageFooter}>
          <Text style={styles.messageTime}>
            {item.createdAt
              ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''}
          </Text>
          {isUserMessage && !isDeleted && messageStatus && renderTicks(messageStatus)}
        </View>
      </TouchableOpacity>
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
          />
        )}
        {renderAcceptRejectButtons()}
        {renderUploadProgress()}

        <View style={styles.inputContainer}>
          <TouchableOpacity
            onPress={() => setShowMediaPicker(true)}
            style={styles.attachButton}
            disabled={showAcceptReject || uploading || !isConnected}
          >
            <Icon
              name="attach-outline"
              size={24}
              color={showAcceptReject || uploading || !isConnected ? "#666" : "#FF6D1F"}
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
            editable={!showAcceptReject && isConnected}
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
              { opacity: input.trim() && !showAcceptReject && !uploading && isConnected ? 1 : 0.5 }
            ]}
            disabled={!input.trim() || showAcceptReject || uploading || !isConnected}
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
    maxWidth: '80%',
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
    paddingRight: 65,
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
});