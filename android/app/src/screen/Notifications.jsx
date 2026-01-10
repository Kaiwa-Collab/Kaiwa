import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
  StatusBar,
  Platform
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import chatService from './chatService';
import functions from '@react-native-firebase/functions';
import { getGitHubStatus } from '../../service/getGitHubStatus';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const Notifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followRequests, setFollowRequests] = useState([]);
  const [showRequests, setShowRequests] = useState(false);
  const [selectedCollaboration, setSelectedCollaboration] = useState(null);
  const [showCollaborationDetails, setShowCollaborationDetails] = useState(false);
  const [loadingCollabDetails, setLoadingCollabDetails] = useState(false);
  const currentUserUid = auth().currentUser?.uid;
  const navigation = useNavigation();

  useEffect(() => {
    if (!currentUserUid) return;

    const unsubscribeNotifications = firestore()
      .collection('notifications')
      .where('recipientUid', '==', currentUserUid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        const notificationsList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setNotifications(notificationsList);
        setLoading(false);
      });

    const unsubscribeFollowRequests = firestore()
      .collection('profile')
      .doc(currentUserUid)
      .collection('followRequests')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        const reqs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setFollowRequests(reqs);
      });

    return () => {
      unsubscribeNotifications();
      unsubscribeFollowRequests();
    };
  }, [currentUserUid]);

  const markAsRead = async (notificationId) => {
    try {
      await firestore()
        .collection('notifications')
        .doc(notificationId)
        .update({ read: true });
    } catch (error) {
      
    }
  };

  const markAllAsRead = async () => {
    try {
      const batch = firestore().batch();
      const unreadNotifications = notifications.filter(n => !n.read);
      
      unreadNotifications.forEach(notification => {
        const notificationRef = firestore().collection('notifications').doc(notification.id);
        batch.update(notificationRef, { read: true });
      });
      
      await batch.commit();
    } catch (error) {
      
    }
  };

  const deleteNotification = async (notificationId) => {
    try {
      await firestore()
        .collection('notifications')
        .doc(notificationId)
        .delete();
    } catch (error) {
      
    }
  };

  const createNotification = async (recipientUid, type, data) => {
    try {
      await firestore().collection('notifications').add({
        recipientUid,
        senderUid: currentUserUid,
        type,
        data,
        read: false,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      
    }
  };

  // Accept follow request
  const handleAccept = async (request) => {
    try {
      const myUid = currentUserUid;
      const senderUid = request.from;

      const myUserDoc = await firestore().collection('profile').doc(myUid).get();
      const myUsername = myUserDoc.exists ? myUserDoc.data()?.username || 'User' : 'User';

      await firestore().collection('profile').doc(myUid)
        .collection('followers').doc(senderUid).set({ 
          followedAt: firestore.FieldValue.serverTimestamp(),
          username: request.fromUsername 
        });
      
      await firestore().collection('profile').doc(senderUid)
        .collection('following').doc(myUid).set({ 
          followedAt: firestore.FieldValue.serverTimestamp(),
          username: myUsername
        });

      const myProfileRef = firestore().collection('profile').doc(myUid);
      const senderProfileRef = firestore().collection('profile').doc(senderUid);
      
      const myProfileDoc = await myProfileRef.get();
      const senderProfileDoc = await senderProfileRef.get();
      
      if (!myProfileDoc.exists) {
        await myProfileRef.set({
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          createdAt: firestore.FieldValue.serverTimestamp(),
          updatedAt: firestore.FieldValue.serverTimestamp()
        });
      }
      
      if (!senderProfileDoc.exists) {
        await senderProfileRef.set({
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          createdAt: firestore.FieldValue.serverTimestamp(),
          updatedAt: firestore.FieldValue.serverTimestamp()
        });
      }

      await myProfileRef.update({
        followersCount: firestore.FieldValue.increment(1),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });
      
      await senderProfileRef.update({
        followingCount: firestore.FieldValue.increment(1),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });

      await firestore().collection('profile').doc(myUid)
        .collection('followRequests').doc(request.id).delete();

      await createNotification(senderUid, 'follow_accepted', {
        message: 'accepted your follow request',
        senderUsername: myUsername
      });

      Alert.alert('Success', 'Follow request accepted');
    } catch (e) {
      
      Alert.alert('Error', `Could not accept request: ${e.message}`);
    }
  };

  // Reject follow request
  const handleReject = async (request) => {
    try {
      await firestore().collection('profile').doc(currentUserUid)
        .collection('followRequests').doc(request.id).delete();
      
      Alert.alert('Success', 'Follow request rejected');
    } catch (e) {
      
      Alert.alert('Error', `Could not reject request: ${e.message}`);
    }
  };

  // Fetch collaboration details
  const fetchCollaborationDetails = async (projectId) => {
    setLoadingCollabDetails(true);
    try {
      const projectDoc = await firestore().collection('collaborations').doc(projectId).get();
      
      if (projectDoc.exists) {
        const projectData = projectDoc.data();
        setSelectedCollaboration({
          id: projectDoc.id,
          ...projectData
        });
        setShowCollaborationDetails(true);
      } else {
        Alert.alert('Error', 'Collaboration project not found');
      }
    } catch (error) {
      
      Alert.alert('Error', 'Failed to load collaboration details');
    } finally {
      setLoadingCollabDetails(false);
    }
  };

  // Accept collaboration invite
// Accept collaboration invite
const acceptCollaborationInvite = async (notification) => {
  try {
    const { projectId, chatId } = notification.data;

    // Step 1: Check if user has GitHub connected
    const status = await getGitHubStatus(currentUserUid);

    if (!status.connected) {
      Alert.alert(
        'GitHub Connection Required',
        'You need to connect your GitHub account to join this collaboration.\n\nSteps:\n1. Connect GitHub account\n2. Accept GitHub repository invitation (via email)\n\nLet\'s start with Step 1:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Connect GitHub',
            onPress: () => {
              setShowCollaborationDetails(false);
              navigation.navigate('Settings'); // Navigate to GitHub connection
            },
          },
        ]
      );
      return;
    }

    // Step 2: Verify chat exists
    const chatRef = firestore().collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      Alert.alert('Error', 'Chat not found. Please contact the project creator.');
      return;
    }

    // Step 3: Get project data
    const projectRef = firestore().collection('collaborations').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      Alert.alert('Error', 'Project not found.');
      return;
    }

    const projectData = projectDoc.data();

    // Step 4: Get user info
    const userDoc = await firestore().collection('users').doc(currentUserUid).get();
    const profileDoc = await firestore().collection('profile').doc(currentUserUid).get();

    if (!userDoc.exists) {
      Alert.alert('Error', 'User profile not found.');
      return;
    }

    const userData = userDoc.data();
    const profileData = profileDoc.exists ? profileDoc.data() : {};

    // Step 5: Call Cloud Function to add user to GitHub repo
    Alert.alert('Processing', 'Adding you to the GitHub repository...');

    const addCollaborator = functions().httpsCallable('addGitHubCollaborator');
    const result = await addCollaborator({
      projectId: projectId,
      githubUsername: status.username,
    });

    if (!result.data.success) {
      throw new Error('Failed to add to GitHub repository');
    }

    // Step 6: Update project in Firestore
    await projectRef.update({
      collaborators: firestore.FieldValue.arrayUnion(currentUserUid),
      pendingInvites: firestore.FieldValue.arrayRemove(currentUserUid),
      pendingGitHubAcceptance: firestore.FieldValue.arrayUnion(currentUserUid),
    });

    // Step 7: Add user to group chat
    await chatRef.update({
      participants: firestore.FieldValue.arrayUnion(currentUserUid),
      [`participantsInfo.${currentUserUid}`]: {
        id: currentUserUid,
        name: userData.username || 'User',
        avatar: profileData.avatar || null,
        username: userData.username,
        role: 'member',
        joinedAt: firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });

    // Step 8: Delete the notification
    await deleteNotification(notification.id);

    // Step 9: Notify project creator
    const creatorId = projectData.creatorId;
    await createNotification(creatorId, 'collaboration_accepted', {
      message: `@${status.username} has joined your project "${projectData.title}"`,
      senderUsername: userData.username || 'User',
      projectId: projectId,
      projectTitle: projectData.title,
      chatId: chatId,
    });

    // Step 10: Check if all invites have been accepted
    const updatedPendingInvites = (projectData.pendingInvites || []).filter(
      uid => uid !== currentUserUid
    );

    if (updatedPendingInvites.length === 0) {
      // All collaborators have accepted in the app
      await projectRef.update({
        status: 'active',
      });

      // Notify all collaborators
      const allCollaborators = [...(projectData.collaborators || []), currentUserUid];

      for (const collaboratorId of allCollaborators) {
        if (collaboratorId !== currentUserUid) {
          await createNotification(collaboratorId, 'collaboration_active', {
            message: `The collaboration "${projectData.title}" is now active! All members have joined.`,
            projectId: projectId,
            projectTitle: projectData.title,
            chatId: chatId,
          });
        }
      }
    }

    setShowCollaborationDetails(false);

    Alert.alert(
      '✅ Almost There!',
      `You've joined the project chat!\n\n📧 Next Step: Check your email from GitHub and accept the repository invitation to start coding.\n\nRepo: ${projectData.githubRepo}`,
      [
        {
          text: 'Check Email Now',
          onPress: () => {
            const { Linking } = require('react-native');
            Linking.openURL('https://github.com/notifications');
          },
        },
        {
          text: 'OK',
          onPress: () => {
            // Navigate to chat
            navigation.navigate('ChatScreen', {
              chatId: chatId,
              title: projectData.title,
              isGroupChat: true,
              groupChatData: {
                name: projectData.title,
                participants: chatDoc.data().participants || [],
                participantsInfo: chatDoc.data().participantsInfo || {},
              },
            });
          },
        },
      ]
    );
  } catch (error) {
    console.error('Error accepting collaboration:', error);

    if (error.code === 'functions/already-exists') {
      Alert.alert(
        '❌ Account Already Connected',
        error.message + '\n\nPlease:\n1. Logout from GitHub in your browser\n2. Connect with a different GitHub account\n\nOr contact the other user to disconnect first.',
        [
          {
            text: 'Logout from GitHub',
            onPress: () => {
              const { Linking } = require('react-native');
              Linking.openURL('https://github.com/logout');
            },
          },
          { text: 'OK', style: 'cancel' },
        ]
      );
    } else {
      Alert.alert('Error', `Failed to accept collaboration: ${error.message}`);
    }
  }
};
  // Reject collaboration invite
  const rejectCollaborationInvite = async (notification) => {
    try {
      const { projectId } = notification.data;

      // Remove from pending invites
      await firestore().collection('collaborations').doc(projectId).update({
        pendingInvites: firestore.FieldValue.arrayRemove(currentUserUid)
      });

      // Delete the notification
      await deleteNotification(notification.id);

      setShowCollaborationDetails(false);
      Alert.alert('Success', 'Collaboration invite rejected');
    } catch (error) {
      
      Alert.alert('Error', 'Failed to reject collaboration invite');
    }
  };

 const handleNotificationPress = async (notification) => {
  // Don't auto-mark follow requests and messages as read - they should remain until manually removed
  const persistentTypes = ['follow_request', 'message', 'message_request'];
  if (!notification.read && !persistentTypes.includes(notification.type)) {
    await markAsRead(notification.id);
  }

  switch (notification.type) {
    case 'follow_request':
      setShowRequests(true);
      break;
    case 'follow_accepted':
    case 'new_follower':
      navigation.navigate('Profile', { userId: notification.senderUid });
      break;
    case 'collaboration_invite':
      await fetchCollaborationDetails(notification.data.projectId);
      break;
    case 'collaboration_accepted':
    case 'collaboration_active':
      // Navigate to the collaboration project chat
      if (notification.data?.chatId) {
        try {
          // Fetch the chat data first to ensure it exists
          const chatDoc = await firestore()
            .collection('chats')
            .doc(notification.data.chatId)
            .get();
          
          if (!chatDoc.exists) {
            Alert.alert('Error', 'Chat not found. The collaboration may have been deleted.');
            return;
          }
          
          const chatData = chatDoc.data();
          
          // Navigate to chat screen with proper data
          navigation.navigate('ChatScreen', { 
            chatId: notification.data.chatId,
            title: chatData.name || notification.data.projectTitle || 'Collaboration Chat',
            avatar: null, // Group chats typically don't have avatars
            userId: null, // Not applicable for group chats
            isGroupChat: true,
            groupChatData: {
              name: chatData.name || notification.data.projectTitle,
              participants: chatData.participants || [],
              participantsInfo: chatData.participantsInfo || {}
            }
          });
        } catch (error) {
          
          Alert.alert('Error', 'Failed to open collaboration chat. Please try again.');
        }
      } else if (notification.data?.projectId) {
        // Fallback: fetch project to get chatId
        try {
          const projectDoc = await firestore()
            .collection('collaborations')
            .doc(notification.data.projectId)
            .get();
          
          if (projectDoc.exists && projectDoc.data().chatId) {
            const chatId = projectDoc.data().chatId;
            const chatDoc = await firestore()
              .collection('chats')
              .doc(chatId)
              .get();
            
            if (chatDoc.exists) {
              const chatData = chatDoc.data();
              navigation.navigate('ChatScreen', { 
                chatId: chatId,
                title: chatData.name || notification.data.projectTitle || 'Collaboration Chat',
                avatar: null,
                userId: null,
                isGroupChat: true,
                groupChatData: {
                  name: chatData.name || notification.data.projectTitle,
                  participants: chatData.participants || [],
                  participantsInfo: chatData.participantsInfo || {}
                }
              });
            } else {
              Alert.alert('Error', 'Chat not found.');
            }
          } else {
            Alert.alert('Error', 'Project or chat not found.');
          }
        } catch (error) {
          
          Alert.alert('Error', 'Failed to open chat.');
        }
      } else {
        Alert.alert('Error', 'Chat information not found in notification.');
      }
      break;
    default:
      break;
  }
};

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'follow_request':
        return 'person-add-outline';
      case 'follow_accepted':
        return 'checkmark-circle-outline';
      case 'new_follower':
        return 'people-outline';
      case 'post_like':
        return 'heart-outline';
      case 'post_comment':
        return 'chatbubble-outline';
      case 'collaboration_invite':
        return 'git-branch-outline';
      case 'collaboration_accepted':
      return 'checkmark-done-outline';
    case 'collaboration_active':
      return 'rocket-outline';
      default:
        return 'notifications-outline';
      
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'follow_request':
        return '#3498db';
      case 'follow_accepted':
        return '#27ae60';
      case 'new_follower':
        return '#9b59b6';
      case 'post_like':
        return '#e74c3c';
      case 'post_comment':
        return '#f39c12';
      case 'collaboration_invite':
        return '#8e44ad';
       case 'collaboration_accepted':
      return '#27ae60';
    case 'collaboration_active':
      return '#16a085'; // New case
      default:
        return '#95a5a6';
    }
  };

  const formatNotificationText = (notification) => {
    const senderName = notification.data?.senderUsername || 'Someone';
    
     switch (notification.type) {
    case 'follow_request':
      return `${senderName} sent you a follow request`;
    case 'follow_accepted':
      return `${senderName} accepted your follow request`;
    case 'new_follower':
      return `${senderName} started following you`;
    case 'post_like':
      return `${senderName} liked your post`;
    case 'post_comment':
      return `${senderName} commented on your post`;
    case 'collaboration_invite':
      const projectTitle = notification.data?.projectTitle || 'a project';
      return `${senderName} invited you to collaborate on "${projectTitle}"`;
    case 'collaboration_accepted':
      return notification.data?.message || `${senderName} accepted your collaboration invite`;
    case 'collaboration_active':
      return notification.data?.message || 'Your collaboration project is now active!'; // New case
    default:
      return notification.data?.message || 'You have a new notification';
  }
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Recently';
    
    const now = new Date();
    const notificationTime = timestamp.toDate();
    const diffInMinutes = Math.floor((now - notificationTime) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    
    return notificationTime.toLocaleDateString();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };
  const handlegoback=()=>{
    navigation.goBack()
  }

  const renderNotificationActions = (item) => {
    if (item.type === 'collaboration_invite') {
      return (
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.acceptButtonSmall}
            onPress={(e) => {
              e.stopPropagation();
              acceptCollaborationInvite(item);
            }}
          >
            <Text style={styles.actionButtonText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectButtonSmall}
            onPress={(e) => {
              e.stopPropagation();
              rejectCollaborationInvite(item);
            }}
          >
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  const renderNotification = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !item.read && styles.unreadNotification
      ]}
      onPress={() => handleNotificationPress(item)}
    >
      <View style={styles.notificationContent}>
        <View style={[styles.iconContainer, { backgroundColor: getNotificationColor(item.type) + '20' }]}>
          <Ionicons
            name={getNotificationIcon(item.type)}
            size={24}
            color={getNotificationColor(item.type)}
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={[styles.notificationText, !item.read && styles.unreadText]}>
            {formatNotificationText(item)}
          </Text>
          <Text style={styles.timeText}>
            {formatTimeAgo(item.createdAt)}
          </Text>
          {renderNotificationActions(item)}
        </View>
        
        {!item.read && <View style={styles.unreadDot} />}
      </View>
      
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={(e) => {
          e.stopPropagation();
          deleteNotification(item.id);
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={20} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading notifications...</Text>
      </View>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backbutton} onPress={()=>handlegoback()}>
          <Text style={styles.backbuttontext}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.headerActions}>
          {followRequests.length > 0 && (
            <TouchableOpacity 
              onPress={() => setShowRequests(true)} 
              style={styles.requestsButton}
            >
              <Ionicons name="people" size={20} color="#007AFF" />
              <View style={styles.requestsBadge}>
                <Text style={styles.requestsBadgeText}>
                  {followRequests.length > 99 ? '99+' : followRequests.length}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No notifications yet</Text>
            <Text style={styles.emptyStateText}>
              When you get notifications, they'll show up here
            </Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : null}
      />

      {/* Follow Requests Modal */}
      <Modal
        visible={showRequests}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRequests(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1}
          onPress={() => setShowRequests(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Follow Requests</Text>
              <TouchableOpacity onPress={() => setShowRequests(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {followRequests.length === 0 ? (
              <View style={styles.emptyRequests}>
                <Ionicons name="people-outline" size={48} color="#ccc" />
                <Text style={styles.emptyRequestsText}>No new requests</Text>
              </View>
            ) : (
              <FlatList
                data={followRequests}
                keyExtractor={(item) => item.id}
                renderItem={({ item: req }) => (
                  <View style={styles.requestItem}>
                    <View style={styles.requestInfo}>
                      <Text style={styles.requestUsername}>{req.fromUsername || req.from}</Text>
                      <Text style={styles.requestTime}>
                        {req.createdAt ? new Date(req.createdAt.toDate()).toLocaleDateString() : 'Recently'}
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      <TouchableOpacity 
                        style={styles.acceptButton}
                        onPress={() => handleAccept(req)}
                      >
                        <Text style={styles.acceptBtn}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.rejectButton}
                        onPress={() => handleReject(req)}
                      >
                        <Text style={styles.rejectBtn}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Collaboration Details Modal */}
      <Modal
        visible={showCollaborationDetails}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCollaborationDetails(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.collaborationModal}>
            {loadingCollabDetails ? (
              <ActivityIndicator size="large" color="#007AFF" />
            ) : selectedCollaboration ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Collaboration Details</Text>
                  <TouchableOpacity onPress={() => setShowCollaborationDetails(false)}>
                    <Ionicons name="close" size={24} color="#666" />
                  </TouchableOpacity>
                </View>

                <View style={styles.collabDetailsContainer}>
                  <View style={styles.detailSection}>
                    <Ionicons name="document-text" size={20} color="#8e44ad" />
                    <Text style={styles.detailLabel}>Project Title</Text>
                  </View>
                  <Text style={styles.detailValue}>{selectedCollaboration.title}</Text>

                  <View style={styles.detailSection}>
                    <Ionicons name="information-circle" size={20} color="#8e44ad" />
                    <Text style={styles.detailLabel}>About</Text>
                  </View>
                  <Text style={styles.detailValue}>{selectedCollaboration.about}</Text>

                  {selectedCollaboration.tech && (
                    <>
                      <View style={styles.detailSection}>
                        <Ionicons name="code-slash" size={20} color="#8e44ad" />
                        <Text style={styles.detailLabel}>Technologies</Text>
                      </View>
                      <Text style={styles.detailValue}>{selectedCollaboration.tech}</Text>
                    </>
                  )}

                  {selectedCollaboration.githubRepo && (
                    <>
                      <View style={styles.detailSection}>
                        <Ionicons name="logo-github" size={20} color="#8e44ad" />
                        <Text style={styles.detailLabel}>GitHub Repository</Text>
                      </View>
                      <Text style={styles.detailValueLink}>{selectedCollaboration.githubRepo}</Text>
                    </>
                  )}

                  <View style={styles.detailSection}>
                    <Ionicons name="person" size={20} color="#8e44ad" />
                    <Text style={styles.detailLabel}>Creator</Text>
                  </View>
                  <Text style={styles.detailValue}>{selectedCollaboration.creatorUsername}</Text>

                  <View style={styles.detailSection}>
                    <Ionicons name="time" size={20} color="#8e44ad" />
                    <Text style={styles.detailLabel}>Created</Text>
                  </View>
                  <Text style={styles.detailValue}>
                    {selectedCollaboration.createdAt 
                      ? new Date(selectedCollaboration.createdAt.toDate()).toLocaleDateString()
                      : 'Recently'}
                  </Text>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.acceptButtonLarge}
                    onPress={() => {
                      const notification = notifications.find(
                        n => n.data?.projectId === selectedCollaboration.id
                      );
                      if (notification) acceptCollaborationInvite(notification);
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.actionButtonTextLarge}>Accept Invitation</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.rejectButtonLarge}
                    onPress={() => {
                      const notification = notifications.find(
                        n => n.data?.projectId === selectedCollaboration.id
                      );
                      if (notification) rejectCollaborationInvite(notification);
                    }}
                  >
                    <Ionicons name="close-circle" size={20} color="#fff" />
                    <Text style={styles.actionButtonTextLarge}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
  },
  loadingText: {
    marginTop: 16,
    color: '#666',
    fontSize: 16,
  },
  header: {
    height:80,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical:5,
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: 'white',
    paddingTop: getStatusBarHeight()
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    // position:'absolute',
    // left:'0',
    // right:'0',
    // textAlign:'center',
    marginTop:15,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // gap: 10,
  },
  requestsButton: {
    position: 'relative',
    padding: 8,
  },
  requestsBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: '#e74c3c',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  requestsBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
  markAllButton: {
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'white',
    // alignSelf:'center'
    marginTop:14
  },
  markAllText: {
    color: '#1e1e1e',
    fontSize: 14,
    fontWeight: '600',
  },
  notificationItem: {
    backgroundColor: '#333',
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    borderBottomColor:'white',
    borderBottomWidth:1
  },
  unreadNotification: {
    backgroundColor: '#f0f8ff',
    borderLeftWidth: 4,
    borderLeftColor: '#FF6D1F',
  },
  notificationContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  notificationText: {
    fontSize: 16,
    color: 'black',
    lineHeight: 20,
  },
  unreadText: {
    fontWeight: '600',
  },
  timeText: {
    fontSize: 12,
    color: 'white',
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 8,
  },
  acceptButtonSmall: {
    backgroundColor: '#27ae60',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  rejectButtonSmall: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
    marginLeft: 8,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  emptyRequests: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyRequestsText: {
    color: '#666',
    fontSize: 16,
    marginTop: 12,
  },
  requestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  requestInfo: {
    flex: 1,
  },
  requestUsername: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  requestTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
  },
  acceptButton: {
    backgroundColor: '#27ae60',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
  },
  rejectButton: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  acceptBtn: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
backbutton:{
  paddingVertical:6,
  // position:'absolute',
  // left:16,
  // zIndex:10
},
backbuttontext:{
  color:'white',
  fontSize:25,
  fontWeight:'bold'

},

  rejectBtn: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  collaborationModal: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
    minHeight: '50%',
  },
  collabDetailsContainer: {
    paddingVertical: 10,
  },
  detailSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8e44ad',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    paddingLeft: 28,
  },
  detailValueLink: {
    fontSize: 16,
    color: '#007AFF',
    lineHeight: 24,
    paddingLeft: 28,
    textDecorationLine: 'underline',
  },
  modalActions: {
    marginTop: 24,
    gap: 12,
  },
  acceptButtonLarge: {
    backgroundColor: '#27ae60',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rejectButtonLarge: {
    backgroundColor: '#e74c3c',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonTextLarge: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },
});

export default Notifications;