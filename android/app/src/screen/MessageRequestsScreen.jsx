// MessageRequestsScreen.js
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import auth from '@react-native-firebase/auth';
import chatService from './chatService';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0: 0;
const MessageRequestsScreen = ({ navigation }) => {
  const [activeTab, setActiveTab] = useState('received'); // 'received' or 'sent'
  const [loading, setLoading] = useState(true);
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  // Set up real-time listeners and fetch data [web:76][web:77]
  useEffect(() => {
  const user = auth().currentUser;
  if (!user) {
    navigation.goBack();
    return;
  }
  
  setCurrentUser(user);

  // Set up real-time listeners with error handling
 // In the useEffect where you set up the listener:
const unsubscribeReceived = chatService.subscribeToMessageRequests(
  user.uid,
  (requests) => {
    try {
      // The requests now come with complete senderInfo
      setReceivedRequests(requests || []);
      setLoading(false);
    } catch (error) {
      
      setReceivedRequests([]);
      setLoading(false);
    }
  },
  (error) => {
    
    setLoading(false);
    Alert.alert('Error', 'Failed to load message requests. Please try again.');
  }
);

  // Load sent requests
  const loadSentRequests = async () => {
    try {
      const sentData = await chatService.getPendingMessageRequestsSent(user.uid);
      setSentRequests(sentData || []); // Ensure it's always an array
    } catch (error) {
     
      setSentRequests([]); // Set empty array on error
    }
  };

  loadSentRequests();

  // Cleanup function
  return () => {
    if (unsubscribeReceived && typeof unsubscribeReceived === 'function') {
      unsubscribeReceived();
    }
  };
}, [navigation]);

  const handleAcceptRequest = async (request) => {
  try {
    // Add validation
    if (!request?.id) {
      Alert.alert('Error', 'Invalid request ID');
      return;
    }

    if (!currentUser?.uid) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setLoading(true);
    await chatService.acceptMessageRequest(request.id, currentUser.uid);
    
    // Chat will automatically appear in First.jsx - no need to navigate
    Alert.alert(
      'Request Accepted',
      'You can now chat with this person. The chat has been added to your conversations.',
      [{ text: 'OK' }]
    );
    
    setLoading(false);
  } catch (error) {
    setLoading(false);
    // More specific error messages
    let errorMessage = 'Failed to accept request. Please try again.';
    if (error.code === 'firestore/not-found') {
      errorMessage = 'This message request no longer exists.';
    } else if (error.code === 'firestore/permission-denied') {
      errorMessage = 'You do not have permission to accept this request.';
    }
    
    Alert.alert('Error', errorMessage);
  } finally {
    setLoading(false);
  }
};

  const handleRejectRequest = async (requestId) => {
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
              setLoading(true);
              await chatService.rejectMessageRequest(requestId, currentUser?.uid);
            } catch (error) {
              
              Alert.alert('Error', 'Failed to reject request. Please try again.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleDeleteSentRequest = async (requestId, recipientName) => {
    Alert.alert(
      'Delete Message Request',
      `Are you sure you want to delete this message request to ${recipientName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await chatService.deleteMessageRequest(requestId);
              
              // Remove from local state immediately
              setSentRequests(prevRequests => 
                prevRequests.filter(request => request.id !== requestId)
              );
              
              Alert.alert('Deleted', 'Message request has been deleted.');
            } catch (error) {
             
              Alert.alert('Error', 'Failed to delete request. Please try again.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };


  const getDisplayName = (user) => {
    return user?.name || user?.displayName || user?.username || 'Unknown User';
  };

  const getInitials = (user) => {
    const name = getDisplayName(user);
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    
    const now = new Date();
    const time = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffInSeconds = Math.floor((now - time) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return time.toLocaleDateString();
  };

  const getCachedImageUri = (uri) => {
    // You can implement image caching logic here or just return the URI
    return uri || null;
  };

  const renderReceivedRequest = ({ item }) => (
    <View style={styles.requestItem}>
      <View style={styles.requestHeader}>
        <View style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            {item.senderInfo?.avatar ? (
              <Image
                source={{ uri: getCachedImageUri(item.senderInfo.avatar) }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {getInitials(item.senderInfo)}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>
              {getDisplayName(item.senderInfo)}
            </Text>
            <Text style={styles.username}>
              @{item.senderInfo?.username || 'unknown'}
            </Text>
            <Text style={styles.timeAgo}>
              {formatTimeAgo(item.createdAt)}
            </Text>
          </View>
        </View>
      </View>
      
      <Text style={styles.messageText}>"{item.message}"</Text>
      
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.actionButton, styles.rejectButton]}
          onPress={() => handleRejectRequest(item.id)}
          disabled={loading}
        >
          <Text style={styles.rejectButtonText}>Reject</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.acceptButton]}
          onPress={() => handleAcceptRequest(item)}
          disabled={loading}
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSentRequest = ({ item }) => (
    <View style={styles.requestItem}>
      <View style={styles.requestHeader}>
        <View style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            {item.recipientInfo?.avatar ? (
              <Image
                source={{ uri: getCachedImageUri(item.recipientInfo.avatar) }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {getInitials({ name: item.recipientName || 'Unknown' })}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>
              {item.recipientName || getDisplayName(item.recipientInfo) || 'Unknown User'}
            </Text>
            <Text style={styles.timeAgo}>
              Sent {formatTimeAgo(item.createdAt)}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, 
          item.status === 'accepted' && styles.acceptedBadge,
          item.status === 'rejected' && styles.rejectedBadge
        ]}>
          <Text style={[styles.statusText,
            item.status === 'accepted' && styles.acceptedText,
            item.status === 'rejected' && styles.rejectedText
          ]}>
            {item.status === 'pending' ? 'Pending' : 
             item.status === 'accepted' ? 'Accepted' : 'Rejected'}
          </Text>
        </View>
      </View>
      
      <Text style={styles.messageText}>"{item.message}"</Text>

       {item.status === 'pending' && (
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.actionButton, styles.rejectButton]}
          onPress={() => handleDeleteSentRequest(item.id, item.recipientName)}
          disabled={loading}
        >
          <Text style={styles.rejectButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
    
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon 
        name={activeTab === 'received' ? 'mail-outline' : 'paper-plane-outline'} 
        size={64} 
        color="rgba(255, 255, 255, 0.3)" 
      />
      <Text style={styles.emptyTitle}>
        {activeTab === 'received' ? 'No message requests' : 'No sent requests'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {activeTab === 'received' 
          ? 'When people send you message requests, they\'ll appear here'
          : 'Message requests you\'ve sent will appear here'
        }
      </Text>
    </View>
  );

  const currentData = activeTab === 'received' ? receivedRequests : sentRequests;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.statusBarSpacer} />
        <Text style={styles.title}>Message Requests</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'received' && styles.activeTab
          ]}
          onPress={() => setActiveTab('received')}
        >
          <Text style={[
            styles.tabText,
            activeTab === 'received' && styles.activeTabText
          ]}>
            Received ({receivedRequests?.length || 0})
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'sent' && styles.activeTab
          ]}
          onPress={() => setActiveTab('sent')}
        >
          <Text style={[
            styles.tabText,
            activeTab === 'sent' && styles.activeTabText
          ]}>
            Sent ({sentRequests?.length || 0})
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {loading && currentData?.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="white" />
            <Text style={styles.loadingText}>Loading requests...</Text>
          </View>
        ) : currentData?.length === 0 ? (
          renderEmptyState()
        ) : (
          <FlatList
            data={currentData}
            keyExtractor={(item) => item.id}
            renderItem={activeTab === 'received' ? renderReceivedRequest : renderSentRequest}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
            refreshing={loading}
            onRefresh={async () => {
              if (activeTab === 'sent') {
                setLoading(true);
                try {
                  const sentData = await chatService.getPendingMessageRequestsSent(currentUser.uid);
                  setSentRequests(sentData);
                } catch (error) {
                  
                } finally {
                  setLoading(false);
                }
              }
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
    statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },

  header: {
    height:80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
    paddingTop:getStatusBarHeight()
    
  },
  backButton: {
    width: 40,
    height: 40,
    // alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  placeholder: {
    width: 40,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#2c2c32',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    backgroundColor: '#2c2c32',
  },
  listContainer: {
    padding: 16,
  },
  requestItem: {
    backgroundColor: '#404040',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    flex: 1,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 2,
  },
  username: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  timeAgo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  statusBadge: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  acceptedBadge: {
    backgroundColor: '#28A745',
  },
  rejectedBadge: {
    backgroundColor: '#DC3545',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  acceptedText: {
    color: 'white',
  },
  rejectedText: {
    color: 'white',
  },
  messageText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    fontStyle: 'italic',
    marginBottom: 16,
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  rejectButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  acceptButton: {
    backgroundColor: '#007AFF',
  },
  rejectButtonText: {
    color: '#FF3B30',
    fontWeight: 'bold',
  },
  acceptButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 20,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 10,
    fontSize: 16,
  },
});

export default MessageRequestsScreen;
