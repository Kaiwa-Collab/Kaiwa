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
} from 'react-native';
import { Image } from 'react-native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import EmptydP from './Emptydp';
import chatService from './chatService';
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

  useEffect(() => {
    // Set the header
    <View style={styles.statusBarSpacer} />,
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
              {isCreator && chatData?.type === 'group' && (
                <TouchableOpacity
                  onPress={async () => {
                    Alert.alert(
                      'Mark Project as Completed',
                      'Are you sure you want to mark this project as completed?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Done',
                          onPress: async () => {
                            try {
                              // Find the project associated with this chatId
                              const projectsSnapshot = await firestore()
                                .collection('collaborations')
                                .where('chatId', '==', actualChatId)
                                .get();
                              
                              if (!projectsSnapshot.empty) {
                                const projectDoc = projectsSnapshot.docs[0];
                                await projectDoc.ref.update({
                                  status: 'completed',
                                  completedAt: firestore.FieldValue.serverTimestamp()
                                });
                                
                                Alert.alert('Success', 'Project marked as completed!');
                                setIsCreator(false); // Hide the button after completion
                              } else {
                                Alert.alert('Error', 'Project not found for this chat.');
                              }
                            } catch (e) {
                              Alert.alert('Error', 'Failed to mark project as completed.');
                            }
                          }
                        }
                      ]
                    );
                  }}
                  style={{ paddingHorizontal: 12, marginRight: 8 }}
                >
                  <Text style={{ color: '#4e9bde', fontWeight: 'bold' }}>Done</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    'Delete Chat',
                    'This will delete the conversation for all participants. This action cannot be undone.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await chatService.deleteChatPermanently(actualChatId);
                            navigation.goBack();
                          } catch (e) {
                            Alert.alert('Error', 'Failed to delete chat. Please try again.');
                          }
                        }
                      }
                    ]
                  );
                }}
                style={{ paddingHorizontal: 12 }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          )
        : undefined,
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={[styles.headerTitleText, { color: 'white' }]}>{headerTitle || 'Chat'}</Text>
          <Text style={[styles.headerSubtitle, { color: 'white' }]}>
            {isRequestMode ? 'Message Request' : 'Online'}
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
  }, [chatId, headerTitle, headerAvatar, navigation, isMessageRequest, isRequestMode, isCreator, chatData, actualChatId]);

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
      .onSnapshot(snapshot => {
        const msgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setMessages(msgs);
      });

    return () => unsubscribe();
  };

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
    if (!input.trim()) return;

    // If in request mode, send message request instead
    if (isRequestMode && actualChatId.startsWith('temp_request_')) {
      await sendMessageRequest();
      return;
    }

    const newMessage = {
      text: input.trim(),
      senderId: currentUserUid,
      createdAt: firestore.FieldValue.serverTimestamp(),
    };

    await firestore()
      .collection('chats')
      .doc(actualChatId)
      .collection('messages')
      .add(newMessage);

    setInput('');

    // Auto scroll to bottom after sending
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);

    // Also update chat metadata (for chat list preview)
    await firestore()
      .collection('chats')
      .doc(actualChatId)
      .set(
        {
          lastMessage: newMessage.text,
          lastMessageTime: firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  };

  const handleAcceptRequest = async () => {
    try {
      if (!requestData) return;

      // Accept the message request using chatService
      const chatResult = await chatService.acceptMessageRequest(requestData.id, currentUserUid);

      Alert.alert(
        'Request Accepted',
        'You can now chat with this person.',
        [{
          text: 'Continue Chatting',
          onPress: () => {
            // Navigate to the new chat with the actual chat ID
            navigation.navigate('ChatScreen', {
              chatId: chatResult.id,
              title: requestData.senderInfo?.name || requestData.senderInfo?.displayName || 'Unknown User',
              avatar: requestData.senderInfo?.avatar || '',
              userId: requestData.senderId,
              isMessageRequest: false
            });
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

  const renderItem = ({ item }) => (
    
    <View
      style={[
        styles.messageContainer,
        item.senderId === currentUserUid ? styles.userMessage : styles.botMessage,
        item.isRequestMessage && styles.requestMessage
      ]}
    >
      <Text style={[
        styles.messageText,
        item.isRequestMessage && styles.requestMessageText
      ]}>
        {item.text}
      </Text>
      <Text style={styles.messageTime}>
        {item.createdAt?.toDate
          ? item.createdAt.toDate().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''}
      </Text>
    </View>
  );

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

  return (
    // Platform.OS === 'ios' ? (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
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
            onContentSizeChange={() => {
              if (!showAcceptReject) {
                flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
              }
            }}
          />
          {renderAcceptRejectButtons()}
        </SafeAreaView>
        <View style={styles.inputContainer}>
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
              { opacity: input.trim() && !showAcceptReject ? 1 : 0.5 }
            ]}
            disabled={!input.trim() || showAcceptReject}
          >
            <Text style={styles.sendButtonText}>
              {isRequestMode && actualChatId.startsWith('temp_request_') ? 'Send Request' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
  )}
//     ) }: (
//       <View style={styles.container}>
//         <SafeAreaView style={styles.safeArea}>
//           <FlatList
//             ref={flatListRef}
//             data={messages}
//             keyExtractor={(item) => item.id}
//             renderItem={renderItem}
//             inverted={!showAcceptReject}
//             contentContainerStyle={styles.messagesList}
//             showsVerticalScrollIndicator={false}
//             keyboardShouldPersistTaps="handled"
//             onContentSizeChange={() => {
//               if (!showAcceptReject) {
//                 flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
//               }
//             }}
//           />
//           {renderAcceptRejectButtons()}
//         </SafeAreaView>
//         <View style={[styles.inputContainer, { paddingBottom: keyboardHeight > 0 ? keyboardHeight  : 10 }]}>
//           <TextInput
//             style={styles.input}
//             value={input}
//             onChangeText={setInput}
//             placeholder={
//               isRequestMode && actualChatId.startsWith('temp_request_')
//                 ? "Write a message request..."
//                 : "Type your message..."
//             }
//             placeholderTextColor="#aaa"
//             multiline
//             maxLength={500}
//             editable={!showAcceptReject}
//             onFocus={() => {
//               setTimeout(() => {
//                 if (!showAcceptReject) {
//                   flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
//                 }
//               }, 100);
//             }}
//           />
//           <TouchableOpacity
//             onPress={sendMessage}
//             style={[
//               styles.sendButton, 
//               { opacity: input.trim() && !showAcceptReject ? 1 : 0.5 }
//             ]}
//             disabled={!input.trim() || showAcceptReject}
//           >
//             <Text style={styles.sendButtonText}>
//               {isRequestMode && actualChatId.startsWith('temp_request_') ? 'Send Request' : 'Send'}
//             </Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     )
//   );
// }

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
    marginVertical: 4,
    padding: 12,
    borderRadius: 15,
    maxWidth: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#000',
    borderBottomRightRadius: 4,
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
    lineHeight: 20,
  },
  requestMessageText: {
    color: '#007AFF',
    fontWeight: '500',
  },
  messageTime: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
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
});