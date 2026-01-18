import React, { useState, useEffect, useRef } from 'react';
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
  Keyboard,
  Dimensions,
  Modal,
  Linking,
  ActivityIndicator
} from 'react-native';
import { Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import EmptydP from './Emptydp';
import chatService from './chatService';
import presenceService from './presenceService';
import Icon from 'react-native-vector-icons/Ionicons';
import {requestcamerapermission,requestgallerypermission} from '../../utils/permissions';
import { launchImageLibrary,launchCamera } from 'react-native-image-picker';
import storage from '@react-native-firebase/storage';
import Video from 'react-native-video';
import { Animated } from 'react-native';


const { width: SCREEN_WIDTH } = Dimensions.get('window');
const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0: 0;

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
  const currentUserUid = auth().currentUser.uid;
  const [chatData, setChatData] = useState(null);
  const [isCreator, setIsCreator] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState('Offline');
  const statusUnsubscribeRef = useRef(null);
  const [recipientId, setRecipientId] = useState(null);

   const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Keep actualChatId in sync when navigation params change
  useEffect(() => {
    setActualChatId(chatId);
  }, [chatId]);

  // Fetch chat data to check if it's a group chat and if user is creator
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
          
          // Get recipient ID for direct chats
          if (data.type === 'direct' && data.participants) {
            const otherParticipant = data.participants.find(id => id !== currentUserUid);
            if (otherParticipant) {
              setRecipientId(otherParticipant);
            }
          } else if (data.type === 'direct' && actualChatId.includes('_')) {
            // Fallback: extract from chat ID
            const participants = actualChatId.split('_').filter(id => id && id.length > 10);
            const otherParticipant = participants.find(id => id !== currentUserUid);
            if (otherParticipant) {
              setRecipientId(otherParticipant);
            }
          }
          
          // Check if it's a group chat and if current user is the creator
          if (data.type === 'group' && data.createdBy === currentUserUid) {
            // Also check if project is not already completed
            const projectsSnapshot = await firestore()
              .collection('collaborations')
              .where('chatId', '==', actualChatId)
              .get();
            
            if (!projectsSnapshot.empty) {
              const projectData = projectsSnapshot.docs[0].data();
              // Only show button if project is not completed
              setIsCreator(projectData.status !== 'completed');
            } else {
              setIsCreator(true); // Show button if project not found (edge case)
            }
          } else {
            setIsCreator(false);
          }
        }
      } catch (error) {
        // Error fetching chat data
      }
    };
    
    fetchChatData();
  }, [actualChatId, currentUserUid]);

  // If header data is missing, try to fetch from profile
  useEffect(() => {
    const maybeFetchHeaderInfo = async () => {
      try {
        if ((!headerTitle || headerTitle === 'Chat' || headerTitle.trim().length === 0) && userId) {
          const doc = await firestore().collection('profile').doc(userId).get();
          if (doc.exists) {
            const data = doc.data();
            setHeaderTitle(data.displayName || data.name || data.username || 'Chat');
            setHeaderAvatar(data.avatar || data.photoURL || '');
          }
        }
      } catch (_) {}
    };
    maybeFetchHeaderInfo();
  }, [userId, headerTitle]);

  // Subscribe to online status for direct chats
  useEffect(() => {
    // Cleanup previous subscription
    if (statusUnsubscribeRef.current) {
      statusUnsubscribeRef.current();
      statusUnsubscribeRef.current = null;
    }

    // Don't track status for message requests or temp chats
    if (isRequestMode || !actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
      setOnlineStatus('Offline');
      return;
    }

    // For group chats, show "Group" status
    if (chatData?.type === 'group') {
      setOnlineStatus('Group');
      return;
    }

    // For direct chats, find the other user's ID and subscribe to their status
    if (chatData?.participants && chatData.participants.length === 2) {
      const otherUserId = chatData.participants.find(id => id !== currentUserUid);
      
      if (otherUserId) {
        // Subscribe to the other user's online status
        const unsubscribe = presenceService.subscribeToUserStatus(
          otherUserId,
          (statusText) => {
            setOnlineStatus(statusText);
          }
        );
        statusUnsubscribeRef.current = unsubscribe;
      } else {
        setOnlineStatus('Offline');
      }
    } else if (userId) {
      // Fallback: use userId from route params if available
      const unsubscribe = presenceService.subscribeToUserStatus(
        userId,
        (statusText) => {
          setOnlineStatus(statusText);
        }
      );
      statusUnsubscribeRef.current = unsubscribe;
    } else {
      setOnlineStatus('Offline');
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (statusUnsubscribeRef.current) {
        statusUnsubscribeRef.current();
        statusUnsubscribeRef.current = null;
      }
    };
  }, [actualChatId, chatData, userId, currentUserUid, isRequestMode]);

  useEffect(() => {
    // Set the header
    navigation.setOptions({
      headerStyle: { backgroundColor: '#1e1e1e' },
      headerTitleAlign: 'center',
      headerLeft: () => (
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          {headerAvatar ? (
            <Image source={{ uri: headerAvatar }} style={styles.headerAvatar} />
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
            {isRequestMode ? 'Message Request' : onlineStatus}
          </Text>
        </View>
      ),
    });

    // Handle different chat modes
    if (isMessageRequest && chatId.startsWith('temp_request_')) {
      // This is a new message request being created
      setIsRequestMode(true);
      setMessages([]);
    } else if (chatId.startsWith('request_')) {
      // This is viewing an existing message request
      loadMessageRequest();
    } else {
      // This is a regular chat
      subscribeToMessages();
    }

    return () => {
      // Cleanup will be handled by individual functions
    };
  }, [chatId, headerTitle, headerAvatar, navigation, isMessageRequest, isRequestMode, isCreator, chatData, actualChatId, onlineStatus]);

  // If we still don't have header info but we do have recipientInfo from navigation, use it immediately
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

  // Handle keyboard show/hide events for Android
  useEffect(() => {
    if (Platform.OS === 'android') {
      const keyboardWillShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      });
      const keyboardWillHideListener = Keyboard.addListener('keyboardDidHide', () => {
        setKeyboardHeight(0);
      });

      return () => {
        keyboardWillShowListener.remove();
        keyboardWillHideListener.remove();
      };
    }
  }, []);

  const loadMessageRequest = async () => {
    try {
      // Extract request ID from chatId (format: request_[requestId])
      const requestId = chatId.replace('request_', '');
      
      const requestDoc = await firestore()
        .collection('messageRequests')
        .doc(requestId)
        .get();

      if (requestDoc.exists) {
        const data = requestDoc.data();
        setRequestData({ id: requestDoc.id, ...data });
        
        // Show accept/reject buttons only if current user is the recipient
        if (data.recipientId === currentUserUid && data.status === 'pending') {
          setShowAcceptReject(true);
        }

        // Create a mock message array to display the request message
        setMessages([{
          id: 'request_message',
          text: data.message,
          senderId: data.senderId,
          createdAt: data.createdAt,
          isRequestMessage: true
        }]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load message request');
    }
  };

  const subscribeToMessages = () => {
    if (!actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
      return;
    }

    const unsubscribe = firestore()
      .collection('chats')
      .doc(actualChatId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .onSnapshot(async snapshot => {
        const msgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }))

        .filter(msg => {
          // Hide message if deleted for this user
          const deletedFor = msg.deletedFor || {};
          return !deletedFor[currentUserUid];
        });
      
        setMessages(msgs);

        // Mark messages as delivered when received (for messages sent by others)
        const batch = firestore().batch();
        let hasUpdates = false;

        snapshot.docs.forEach(doc => {
          const messageData = doc.data();
          // Only mark as delivered if message is from someone else and not already delivered
          if (messageData.senderId !== currentUserUid) {
            const deliveredTo = messageData.deliveredTo || {};
            if (!deliveredTo[currentUserUid]) {
              batch.update(doc.ref, {
                [`deliveredTo.${currentUserUid}`]: firestore.FieldValue.serverTimestamp()
              });
              hasUpdates = true;
            }
          }
        });

        if (hasUpdates) {
          try {
            await batch.commit();
          } catch (error) {
            console.error('Error marking messages as delivered:', error);
          }
        }

        // Mark messages as read when chat is viewed
        markMessagesAsRead();
      });

    return () => unsubscribe();
  };

  // Mark messages as read
  const markMessagesAsRead = async () => {
    if (!actualChatId || actualChatId.startsWith('temp_') || actualChatId.startsWith('request_')) {
      return;
    }

    try {
      await chatService.markMessagesAsRead(actualChatId, currentUserUid);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

  // Mark messages as read when chat screen is focused
  useFocusEffect(
    React.useCallback(() => {
      // Mark messages as read when screen is focused
      if (actualChatId && !actualChatId.startsWith('temp_') && !actualChatId.startsWith('request_')) {
        markMessagesAsRead();
      }
    }, [actualChatId, currentUserUid])
  );

  const sendMessageRequest = async () => {
    if (!input.trim() || !recipientInfo) return;

    try {
      // Use chatService to send message request
      await chatService.sendMessageRequest(currentUserUid, recipientInfo.id, input.trim());

      setInput('');
      Alert.alert(
        'Message Request Sent',
        'Your message request has been sent successfully.',
        [{
          text: 'OK',
          onPress: () => navigation.goBack()
        }]
      );

    } catch (error) {
      Alert.alert('Error', 'Failed to send message request');
    }
  };

  const sendMessage = async () => {
  const text = input.trim();
  if (!text) return;

  // If in request mode, send message request instead
  if (isRequestMode && actualChatId.startsWith('temp_request_')) {
    await sendMessageRequest();
    return;
  }

  // Create optimistic message immediately
  const tempId = `temp_${Date.now()}_${Math.random()}`;
  const optimisticMessage = {
    id: tempId,
    senderId: currentUserUid,
    text: text,
    messageType: 'text',
    createdAt: { toDate: () => new Date() }, // Mock Firestore timestamp
    readBy: { [currentUserUid]: new Date() },
    deliveredTo: {},
    edited: false,
    isOptimistic: true, // Flag to identify optimistic messages
  };

  // Add message to UI immediately
  setMessages(prevMessages => [optimisticMessage, ...prevMessages]);

  // Clear input immediately
  setInput('');

  // Dismiss keyboard smoothly
  // Keyboard.dismiss();

  // Scroll to bottom smoothly after a small delay to let the message render
  setTimeout(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, 50);

  // Send message to Firebase in background
  try {
    const sentMessage = await chatService.sendMessage(actualChatId, currentUserUid, text);
    
    // Replace optimistic message with real one from Firebase
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.id === tempId 
          ? { ...sentMessage, id: sentMessage.id, createdAt: sentMessage.createdAt || { toDate: () => new Date() } }
          : msg
      )
    );
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Remove optimistic message on failure
    setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempId));
    
    // Restore the message to input
    setInput(text);
    
    Alert.alert('Error', 'Failed to send message. Please try again.');
  }
};

const uploadMediaToStorage=async (uri,type)=>{
  try{
    const extension =type==='video'?'mp4':'jpg';
    const fileName=`${currentUserUid}_${Date.now()}.${extension}`;
    const reference=storage().ref(`chat_media/${actualChatId}/${fileName}`);

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
      if (response.didCancel) {
        return;
      }

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

          // Send message with media
          await chatService.sendMessage(
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

   // Handle camera capture
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
      if (response.didCancel) {
        return;
      }

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

          // Send message with photo
          await chatService.sendMessage(
            actualChatId,
            currentUserUid,
            '',
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

  const handleAcceptRequest = async () => {
    try {
      if (!requestData) return;

      // Accept the message request using chatService
      await chatService.acceptMessageRequest(requestData.id, currentUserUid);

      Alert.alert(
        'Request Accepted',
        'You can now chat with this person. The chat has been added to your conversations.',
        [{
          text: 'OK',
          onPress: () => {
            // Just go back - chat will appear in First.jsx automatically
            navigation.goBack();
          }
        }]
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
              
              Alert.alert('Request Rejected', 'The message request has been rejected.', [{
                text: 'OK',
                onPress: () => navigation.goBack()
              }]);

            } catch (error) {
              Alert.alert('Error', 'Failed to reject request');
            }
          }
        }
      ]
    );
  };

  // Get message status for read receipts
  const getMessageStatus = (message) => {
    // Only show ticks for messages sent by current user
    if (message.senderId !== currentUserUid || message.isRequestMessage) {
      return null;
    }

    // Get recipient ID (use recipientId from state, or userId from route params, or extract from chat)
    const targetRecipientId = recipientId || userId;
    
    // If we still don't have recipient ID, try to extract from chat data
    if (!targetRecipientId && chatData?.participants) {
      const otherParticipant = chatData.participants.find(id => id !== currentUserUid);
      if (otherParticipant) {
        // Use the found participant ID for this check
        const readBy = message.readBy || {};
        const deliveredTo = message.deliveredTo || {};
        
        if (readBy[otherParticipant]) {
          return 'seen';
        }
        if (deliveredTo[otherParticipant]) {
          return 'delivered';
        }
        return 'sent';
      }
    }

    // If recipientId is not set yet, still show sent status
    if (!targetRecipientId) {
      return 'sent'; // Show single tick while loading
    }

    const readBy = message.readBy || {};
    const deliveredTo = message.deliveredTo || {};
    
    // Check if message is read by recipient
    if (readBy[targetRecipientId]) {
      return 'seen'; // Double tick filled (orange)
    }
    
    // Check if message is delivered to recipient
    if (deliveredTo[targetRecipientId]) {
      return 'delivered'; // Double tick (orange outline)
    }
    
    // Message is sent but not delivered yet
    return 'sent'; // Single tick (orange outline)
  };

  // Render tick icon based on status
  const renderTicks = (status) => {
    if (!status) return null;

    // Use a darker color that's visible on orange background
    const tickColor = 'rgba(0, 0, 0, 0.7)'; // Semi-transparent black for better visibility
    
    try {
      if (status === 'seen') {
        // Double tick filled - message has been read
        return (
          <Icon name="checkmark-done" size={14} color={tickColor} style={styles.tickIcon} />
        );
      } else if (status === 'delivered') {
        // Double tick outline - message delivered but not read
        return (
          <Icon name="checkmark-done-outline" size={14} color={tickColor} style={styles.tickIcon} />
        );
      } else {
        // Single tick - sent but not delivered
        return (
          <Icon name="checkmark-outline" size={14} color={tickColor} style={styles.tickIcon} />
        );
      }
    } catch (error) {
      console.error('Error rendering ticks:', error);
      // Fallback: show simple text indicator
      return (
        <Text style={styles.tickText}>
          {status === 'seen' ? '✓✓' : status === 'delivered' ? '✓✓' : '✓'}
        </Text>
      );
    }
  };


const handleLongPressMessage = (item) => {
  // Only allow deletion of own messages
  if (item.senderId !== currentUserUid) {
    return;
  }

  Alert.alert(
    'Delete Message',
    'Are you sure you want to delete this message?',
    [
      {
        text: 'Cancel',
        style: 'cancel'
      },
      {
        text: 'Delete for Me',
        onPress: () => deleteMessageForMe(item.id),
        style: 'destructive'
      },
      {
        text: 'Delete for Everyone',
        onPress: () => deleteMessageForEveryone(item),
        style: 'destructive'
      }
    ]
  );
};

const deleteMessageForMe = async (messageId) => {
  try {
    // Add the message to user's deleted messages list
    await firestore()
      .collection('chats')
      .doc(actualChatId)
      .collection('messages')
      .doc(messageId)
      .update({
        [`deletedFor.${currentUserUid}`]: true
      });

    // Update local state to hide the message
    setMessages(prevMessages => 
      prevMessages.filter(msg => msg.id !== messageId)
    );

    Alert.alert('Success', 'Message deleted for you');
  } catch (error) {
    console.error('Error deleting message for me:', error);
    Alert.alert('Error', 'Failed to delete message');
  }
};

const deleteMessageForEveryone = async (item) => {
  try {
    // Check if message is older than 1 hour (optional time limit like WhatsApp)
    // const messageTime = item.createdAt?.toDate();
    // const now = new Date();
    // const hourInMs = 60 * 60 * 1000;
    
    // if (messageTime && (now - messageTime) > hourInMs) {
    //   Alert.alert(
    //     'Cannot Delete',
    //     'Messages can only be deleted for everyone within 1 hour of sending'
    //   );
    //   return;
    // }

    // Delete media files if they exist
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

    // Update the message to show it was deleted
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

    Alert.alert('Success', 'Message deleted for everyone');
  } catch (error) {
    console.error('Error deleting message for everyone:', error);
    Alert.alert('Error', 'Failed to delete message');
  }
};


 const renderItem = ({ item }) => {
  // Handle system messages (project updates and GitHub events)
  if (item.isSystemMessage || item.senderId === 'system' || item.senderId === 'github') {
    const isGitHubEvent = item.senderId === 'github' || item.type === 'github_event';
    
    return (
      <View style={[
        styles.systemMessageContainer,
        isGitHubEvent && styles.githubMessageContainer
      ]}>
        <View style={styles.systemMessageContent}>
          <Icon 
            name={isGitHubEvent ? "logo-github" : "information-circle-outline"} 
            size={16} 
            color={isGitHubEvent ? "#6e5494" : "#007AFF"} 
          />
          <Text style={[
            styles.systemMessageText,
            isGitHubEvent && styles.githubMessageText
          ]}>
            {item.text}
          </Text>
        </View>
        <Text style={[
          styles.systemMessageTime,
          isGitHubEvent && styles.githubMessageTime
        ]}>
          {item.createdAt?.toDate
            ? item.createdAt.toDate().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </Text>
      </View>
    );
  }

  // Regular user messages
  const messageStatus = getMessageStatus(item);
  const isUserMessage = item.senderId === currentUserUid;
  const isDeleted = item.messageType === 'deleted' || item.deletedForEveryone;
  const isOptimistic = item.isOptimistic; // Check if this is an optimistic message
  
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onLongPress={() => !isOptimistic && handleLongPressMessage(item)}
      style={[
        styles.messageContainer,
        isUserMessage ? styles.userMessage : styles.botMessage,
        item.isRequestMessage && styles.requestMessage,
        item.messageType === 'text' ? styles.textMessage : styles.mediaMessage,
        isDeleted && styles.deletedMessage,
        isOptimistic && styles.optimisticMessage, // Add subtle style for optimistic messages
      ]}
    >
      {/* Show deleted message indicator */}
      {isDeleted ? (
        <View style={styles.deletedMessageContent}>
          <Icon name="ban-outline" size={14} color="rgba(255,255,255,0.5)" />
          <Text style={styles.deletedMessageText}>
            {item.text || 'This message was deleted for everyone'}
          </Text>
        </View>
      ) : (
        <>
          {/* Render media based on type */}
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
            <Text style={styles.messageText}>
              {item.text}
            </Text>
          )}
        </>
      )}
      
      <View style={styles.messageFooter}>
        <Text style={styles.messageTime}>
          {item.createdAt?.toDate
            ? item.createdAt.toDate().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </Text>
        {isUserMessage && !isDeleted ? (
          isOptimistic ? (
            // Show clock icon for pending messages
            <Icon name="time-outline" size={14} color="rgba(0, 0, 0, 0.5)" style={styles.tickIcon} />
          ) : (
            messageStatus && renderTicks(messageStatus)
          )
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

  const renderAcceptRejectButtons = () => {
    if (!showAcceptReject) return null;

    return (
      <View style={styles.acceptRejectContainer}>
        <TouchableOpacity
          style={styles.rejectButton}
          onPress={handleRejectRequest}
        >
          <Text style={styles.rejectButtonText}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={handleAcceptRequest}
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    );
  };

   // Media Picker Modal
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
          
          <TouchableOpacity
            style={styles.mediaOption}
            onPress={handleCameraCapture}
          >
            <Icon name="camera-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mediaOption}
            onPress={() => handleMediaSelection('photo')}
          >
            <Icon name="image-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mediaOption}
            onPress={() => handleMediaSelection('video')}
          >
            <Icon name="videocam-outline" size={24} color="#FF6D1F" />
            <Text style={styles.mediaOptionText}>Video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setShowMediaPicker(false)}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
  // Upload Progress Indicator
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

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? undefined : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 100}
    >
      <SafeAreaView style={styles.safeArea}>
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
  onContentSizeChange={(contentWidth, contentHeight) => {
    // Only auto-scroll when new messages arrive, not when deleting
    // This prevents unwanted scrolling on deletion
  }}
        />
        {renderAcceptRejectButtons()}
        {renderUploadProgress()}
     
        <View style={styles.inputContainer}>
           <TouchableOpacity
            onPress={() => setShowMediaPicker(true)}
            style={styles.attachButton}
            disabled={showAcceptReject || uploading}
          >
            <Icon name="attach-outline" size={24} color={showAcceptReject || uploading ? "#666" : "#FF6D1F"} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={
              isRequestMode && actualChatId.startsWith('temp_request_')
                ? "Write a message request..."
                : "Type your message..."
            }
            placeholderTextColor="#aaa"
            multiline
            maxLength={500}
            editable={!showAcceptReject}
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
              { opacity: input.trim() && !showAcceptReject  && !uploading ? 1 : 0.5 }
            ]}
            disabled={!input.trim() || showAcceptReject|| uploading}
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
    borderTopWidth:1,
    borderTopColor:'white'
  },
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  backButton: {
    marginRight: 10,
    padding: 5,
    color: 'white',
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
  padding: 10, // Increased from 6
  borderRadius: 16, // Slightly more rounded
  maxWidth: '80%',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 3,
  elevation: 3,
},
  mediaMessage: {
  padding: 6,
  overflow: 'hidden', // Ensures images stay within rounded corners
  // backgroundColor:'pink'
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.4,
  shadowRadius: 4,
  elevation: 4,
  paddingBottom:24,
  
},
 userMessage: {
  alignSelf: 'flex-end',
  backgroundColor: '#ED7117',
  borderBottomRightRadius: 4,
  // Add gradient-like effect with shadow
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
  lineHeight: 22, // Improved readability
  letterSpacing: 0.2, // Slight letter spacing
},
  requestMessageText: {
    color: '#007AFF',
    fontWeight: '500',
  },

   messageImage: {
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_WIDTH * 0.6,
    borderRadius: 2,
    marginBottom: 4,
    backgroundColor:'#000',
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
  tickContainer: {
    marginLeft: 4,
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
  // System message styles (GitHub events and project updates)
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
    paddingTop:10,
    paddingBottom: Platform.OS === 'ios' ? 10: 10,
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
  infoButton: {
paddingHorizontal: 10,
paddingVertical: 6,
marginRight: 6,
borderRadius: 18,
backgroundColor: 'transparent',
},
infoButtonText: {
color: 'white',
fontSize: 16,
fontWeight: '600',
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
  paddingHorizontal:15,
  // paddingTop: 5,
  // paddingBottom:10,
  // paddingRight:65
},

deletedMessageText: {
  alignSelf: 'flex-end',
  // backgroundColor: '#ED7117',
  borderBottomRightRadius: 4,
  // Add gradient-like effect with shadow
  // shadowColor: '#FDA172',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.4,
  shadowRadius: 4,
  // elevation: 4,
},
optimisticMessage: {
  opacity: 0.7, // Slightly transparent while sending
},
});