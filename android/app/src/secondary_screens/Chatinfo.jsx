import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native'
import React, { useState, useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import firestore from '@react-native-firebase/firestore';
import chatService from '../screen/chatService';
import auth from '@react-native-firebase/auth';
import { Image } from 'react-native';
import EmptydP from '../screen/Emptydp';
import { SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useUserData } from '../users';
import storage from '@react-native-firebase/storage'
import { launchImageLibrary } from 'react-native-image-picker';
import { requestcamerapermission, requestgallerypermission } from '../../utils/permissions';
import functions from '@react-native-firebase/functions';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

export default function ChatInfo({ route, navigation }) {
  const {
    chatId = 'default',
    chatTitle = 'Chat',
    userId,
    chatData = null,
    chatType = null,
  } = route.params || {};

  const [projectcompleted, setprojectcompleted] = useState(false);
  const [projectStartDate, setProjectStartDate] = useState(null);
  const [projectCompletionDate, setProjectCompletionDate] = useState(null);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [participantsList, setParticipantsList] = useState([]);
  const [pendingGithubUsers, setPendingGithubUsers] = useState([]);
const [resendingMail, setResendingMail] = useState({});
const [resendCooldowns, setResendCooldowns] = useState({});

  // Normalize both casing variants: groupAvatar (camelCase) and groupavatar (lowercase)
  const [groupAvatar, setGroupAvatar] = useState(
    chatData?.groupAvatar || chatData?.groupavatar || null
  );
  const [uploadingAvatar, setuploadingavatar] = useState(false);

  const currentUserUid = auth().currentUser.uid;
  const { getCachedImageUri, cacheImage } = useUserData();

  const isCreator = 
  chatData?.createdBy === currentUserUid || 
  chatData?.creatorId === currentUserUid;
  const showdonebutton = isCreator && !projectcompleted;
  const displaytitle = chatTitle || 'Chat';

  // Fetch group avatar from Firestore on mount — normalize field name
  useEffect(() => {
    if (chatData?.type === 'group' && chatId) {
      firestore()
        .collection('chats')
        .doc(chatId)
        .get()
        .then(doc => {
          if (doc.exists) {
            const data = doc.data();
            // Check both field name variants
            const avatar = data?.groupAvatar || data?.groupavatar || null;
            if (avatar) {
              setGroupAvatar(avatar);
              cacheImage(avatar);
            }
          }
        })
        .catch(error => {
          console.error('Error fetching chat data:', error);
        });
    }
  }, [chatId]);

  // Build participants list from chatData, then hydrate avatars fresh from profile collection
  // This ensures we always show the latest profile picture, not the stale cached one
  useEffect(() => {
    if (chatData?.type === 'group' && chatData?.participantsInfo) {
      const participants = Object.values(chatData.participantsInfo).map(participant => ({
        id: participant.id,
        name: participant.name || participant.displayName || 'Unknown User',
        // username: participant.username || '',
        avatar: participant.avatar || participant.photoURL || null,
      }));

      const hydrateParticipantAvatars = async () => {
        try {
          const ids = participants.map(p => p.id).filter(Boolean);
          if (ids.length === 0) {
            setParticipantsList(participants);
            return;
          }

          // 1 read per unique participant — fetch all in parallel
          const profileSnaps = await Promise.all(
            ids.map(uid => firestore().collection('profile').doc(uid).get())
          );

          const avatarMap = {};
          profileSnaps.forEach((snap, i) => {
            if (snap.exists) {
              avatarMap[ids[i]] = snap.data()?.avatar || null;
            }
          });

          const hydrated = participants.map(p => ({
            ...p,
            // fresh avatar from profile takes priority over stale participantsInfo avatar
            avatar: avatarMap[p.id] || p.avatar || null,
          }));

          setParticipantsList(hydrated);
        } catch (error) {
          console.warn('Failed to hydrate participant avatars:', error.message);
          setParticipantsList(participants); // fallback to whatever participantsInfo has
        }
      };

      hydrateParticipantAvatars();
    }
  }, [chatData]);

  const uploadgroupavatar = async () => {
    if (!isCreator) return;

    const haspermission = await requestgallerypermission();
    if (!haspermission) return;

    launchImageLibrary(
      { mediaType: 'photo', quality: 0.8, selectionLimit: 1 },
      async (response) => {
        if (response.didCancel || response.errorCode) return;

        const asset = response.assets?.[0];
        if (!asset?.uri) return;

        setuploadingavatar(true);
        try {
          const filename = `chat_media/${chatId}/groupAvatar_${Date.now()}.jpg`;
          const ref = storage().ref(filename);
          await ref.putFile(asset.uri);
          const downloadURL = await ref.getDownloadURL();

          // Save with consistent lowercase field name
          await firestore().collection('chats').doc(chatId).update({
            groupavatar: downloadURL,
          });

          // Update aggregated cache for all participants
          const chatDoc = await firestore().collection('chats').doc(chatId).get();
          const participants = chatDoc.data()?.participants || [];

          const batch = firestore().batch();
          for (const participantId of participants) {
            const aggRef = firestore()
              .collection('aggregated')
              .doc(`conversations_${participantId}`);

            const aggDoc = await aggRef.get();
            if (aggDoc.exists) {
              const conversations = (aggDoc.data()?.conversations || []).map(conv => {
                if (conv.conversationId === chatId || conv.id === chatId) {
                  return { ...conv, groupavatar: downloadURL };
                }
                return conv;
              });
              batch.update(aggRef, { conversations });
            }
          }
          await batch.commit();

          setGroupAvatar(downloadURL);
          Alert.alert('Profile picture updated');
        } catch (e) {
          console.error('Avatar upload error:', e);
          Alert.alert('Error', e.message || 'Failed to update profile picture');
        } finally {
          setuploadingavatar(false);
        }
      }
    );
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getInitials = (participant) => {
    const name = participant.name || participant.displayName || participant.username || 'U';
    return name.charAt(0).toUpperCase();
  };

  const handleParticipantPress = (participant) => {
    navigation.navigate('Profile', {
      screen: 'Profile',
      params: {
        userId: participant.id,
        username: participant.username
      }
    });
  };

  const checkProjectStatus = async () => {
    if (chatData?.type === 'group' && chatId) {
      try {
        const projectsSnapshot = await firestore()
          .collection('collaborations')
          .where('chatId', '==', chatId)
          .get();

        if (!projectsSnapshot.empty) {
          const projectData = projectsSnapshot.docs[0].data();
          if (projectData.status === 'completed') {
            setprojectcompleted(true);
            if (projectData.completedAt) setProjectCompletionDate(projectData.completedAt);
          } else {
            setprojectcompleted(false);
            setProjectCompletionDate(null);
          }
          if (projectData.createdAt) {
            setProjectStartDate(projectData.createdAt);
          } else if (projectData.startDate) {
            setProjectStartDate(projectData.startDate);
          }
        }
      } catch (error) {
        // silent
      }
    }
  };

  const handleResendGithubInvite = async (user) => {
  setResendingMail(prev => ({ ...prev, [user.id]: true }));
  try {
    await functions()
      .httpsCallable('resendGithubInvite')({ userId: user.id, chatId });
    setResendCooldowns(prev => ({ ...prev, [user.id]: Date.now() + 10 * 60 * 1000 }));
    Alert.alert('Sent', `GitHub invite resent to ${user.name}`);
  } catch (error) {
    const msg = error?.message || 'Failed to resend invite';
    if (msg.includes('not connected')) {
      Alert.alert('Error', `${user.name} has not connected their GitHub account yet`);
    } else {
      Alert.alert('Error', msg);
    }
  } finally {
    setResendingMail(prev => ({ ...prev, [user.id]: false }));
  }
};
  useEffect(() => {
    checkProjectStatus();
  }, [chatId, chatData?.type]);

  useFocusEffect(
    React.useCallback(() => {
      checkProjectStatus();
    }, [chatId, chatData?.type])
  );

  useEffect(() => {
  if (chatData?.type !== 'group' || !isCreator || !chatId) return;

  const fetchPendingGithubUsers = async () => {
    try {
      const projectsSnapshot = await firestore()
        .collection('collaborations')
        .where('chatId', '==', chatId)
        .get();

      if (projectsSnapshot.empty) return;

      const projectData = projectsSnapshot.docs[0].data();
      const pendingIds = projectData.pendingGitHubAcceptance || [];

      if (pendingIds.length === 0) {
        setPendingGithubUsers([]);
        return;
      }

      // Fetch profiles for pending users in parallel
      const profileSnaps = await Promise.all(
        pendingIds.map(uid => firestore().collection('profile').doc(uid).get())
      );

      

      const pendingUsers = profileSnaps.map((snap, i) => ({
        id: pendingIds[i],
        name: snap.exists
          ? (snap.data()?.name || snap.data()?.displayName || snap.data()?.username || 'Unknown')
          : 'Unknown',
        avatar: snap.exists ? (snap.data()?.avatar || null) : null,
      }));

      setPendingGithubUsers(pendingUsers);
    } catch (error) {
      console.error('Error fetching pending github users:', error);
    }
  };

  fetchPendingGithubUsers();
}, [chatId, isCreator, chatData?.type]);



  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.statusBarSpacer} />
      <View style={styles.customHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitleText}>{displaytitle}</Text>
        </View>
        <View style={styles.headerRightPlaceholder} />
      </View>

      {chatData?.type === 'group' && (
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={isCreator ? uploadgroupavatar : undefined}
            activeOpacity={isCreator ? 0.7 : 1}
            style={styles.avatarWrapper}
          >
            {groupAvatar ? (
              <Image
                source={{ uri: getCachedImageUri(groupAvatar) }}
                style={styles.groupAvatar}
              />
            ) : (
              <EmptydP size={90} initials={displaytitle.charAt(0).toUpperCase()} />
            )}
            {isCreator && (
              <View style={styles.cameraOverlay}>
                {uploadingAvatar ? (
                  <Text style={styles.uploadingText}>...</Text>
                ) : (
                  <Ionicons name="camera" size={18} color="white" />
                )}
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.avatarLabel}>
            {isCreator ? 'Tap to change group photo' : displaytitle}
          </Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {showdonebutton && chatData?.type === 'group' && (
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                'Declare Project as Completed',
                'Are you sure you want to declare this project as completed?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Done',
                    onPress: async () => {
                      try {
                        const projectsSnapshot = await firestore()
                          .collection('collaborations')
                          .where('chatId', '==', chatId)
                          .get();

                        if (!projectsSnapshot.empty) {
                          const projectDoc = projectsSnapshot.docs[0];
                          await projectDoc.ref.update({
                            status: 'completed',
                            completedAt: firestore.FieldValue.serverTimestamp()
                          });
                          const updatedDoc = await projectDoc.ref.get();
                          const updatedData = updatedDoc.data();
                          if (updatedData.completedAt) {
                            setProjectCompletionDate(updatedData.completedAt);
                          }
                          Alert.alert('Success', 'Project declared as completed!');
                          setprojectcompleted(true);
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
            style={styles.doneButton}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        )}

        {projectcompleted && chatData?.type === 'group' && projectCompletionDate && (
          <View style={styles.completionDateContainer}>
            <Text style={styles.completionDateText}>
              Completed on: {formatDate(projectCompletionDate)}
            </Text>
          </View>
        )}

        {chatData?.type === 'group' && projectStartDate && (
          <View style={styles.startDateContainer}>
            <Text style={styles.startDateText}>
              Started on: {formatDate(projectStartDate)}
            </Text>
          </View>
        )}

        {chatData?.type === 'group' && participantsList.length > 0 && (
          <View style={styles.participantsSection}>
            <TouchableOpacity
              onPress={() => setParticipantsExpanded(!participantsExpanded)}
              style={styles.participantsHeader}
            >
              <Text style={styles.participantsHeaderText}>
                Participants ({participantsList.length})
              </Text>
              <Ionicons
                name={participantsExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color="white"
              />
            </TouchableOpacity>

            {participantsExpanded && (
              <View style={styles.participantsList}>
                {participantsList.map((participant) => (
                  <TouchableOpacity
                    key={participant.id}
                    onPress={() => handleParticipantPress(participant)}
                    style={styles.participantItem}
                  >
                    <View style={styles.participantAvatarContainer}>
                      {participant.avatar ? (
                        <Image
                          source={{ uri: getCachedImageUri(participant.avatar) }}
                          style={styles.participantAvatar}
                        />
                      ) : (
                        <EmptydP size={40} initials={getInitials(participant)} />
                      )}
                    </View>
                    <View style={styles.participantInfo}>
                      <Text style={styles.participantName}>{participant.name}</Text>
                      {participant.username ? (
                        <Text style={styles.participantUsername}>@{participant.username}</Text>
                      ) : null}
                      {chatData?.createdBy === participant.id && (
                        <View style={styles.creatorTag}>
                          <Text style={styles.creatorTagText}>Creator</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.5)" />
                  </TouchableOpacity>
                ))}
              </View>
            )}

      

          </View>
        )}

              {isCreator && pendingGithubUsers.length > 0 && (
  <View style={styles.pendingGithubSection}>
    <Text style={styles.pendingGithubTitle}>
      Pending GitHub Acceptance ({pendingGithubUsers.length})
    </Text>
    {pendingGithubUsers.map(user => (
      <View key={user.id} style={styles.pendingGithubItem}>
        <View style={styles.participantAvatarContainer}>
          {user.avatar ? (
            <Image
              source={{ uri: getCachedImageUri(user.avatar) }}
              style={styles.participantAvatar}
            />
          ) : (
            <EmptydP size={40} initials={user.name.charAt(0).toUpperCase()} />
          )}
        </View>
        <View style={styles.pendingGithubInfo}>
          <Text style={styles.participantName}>{user.name}</Text>
          <Text style={styles.pendingGithubStatus}>GitHub invite pending</Text>
        </View>
        <TouchableOpacity
  style={[
    styles.resendButton,
    (resendingMail[user.id] || resendCooldowns[user.id] > Date.now()) && styles.resendButtonDisabled
  ]}
  onPress={() => handleResendGithubInvite(user)}
  disabled={resendingMail[user.id] || resendCooldowns[user.id] > Date.now()}
>
  <Text style={styles.resendButtonText}>
    {resendingMail[user.id] ? 'Sending...' : 'Resend'}
  </Text>
</TouchableOpacity>
      </View>
    ))}
  </View>
)}

        {(chatData?.type === 'group' ? isCreator : true) && (
          <TouchableOpacity
            onPress={() => {
              const isGroupChat = chatData?.type === 'group';
              Alert.alert(
                'Delete Chat',
                isGroupChat
                  ? 'This will delete the conversation for all participants. This action cannot be undone.'
                  : 'This will delete the conversation from your account only. The other user will still see the chat.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        if (isGroupChat) {
                          await chatService.deleteChatPermanently(chatId);
                        } else {
                          await chatService.deleteChatForUser(chatId, currentUserUid);
                        }
                        navigation.goBack();
                      } catch (e) {
                        Alert.alert('Error', 'Failed to delete chat. Please try again.');
                      }
                    }
                  }
                ]
              );
            }}
            style={styles.deleteButton}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  backButton: {
    padding: 5,
    minWidth: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: 'white',
    fontSize: 30,
    fontWeight: 'bold',
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 10,
  },
  groupAvatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: '#4e9bde',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#4e9bde',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#121212',
  },
  uploadingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  avatarLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 4,
  },
  buttonContainer: {
    padding: 10,
  },
  doneButton: {
    width: '100%',
    marginBottom: 2,
    marginTop: 4,
    backgroundColor: '#333',
    borderBottomColor: 'white',
    padding: 15,
    borderRadius: 1,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: 'white',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  },
  doneButtonText: {
    color: '#4e9bde',
    fontWeight: 'bold',
  },
  deleteButton: {
    width: '100%',
    marginBottom: 2,
    marginTop: 4,
    backgroundColor: '#333',
    borderBottomColor: 'white',
    padding: 15,
    borderRadius: 1,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: 'white',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  },
  deleteButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  completionDateContainer: {
    width: '100%',
    marginBottom: 2,
    marginTop: 4,
    backgroundColor: '#333',
    borderBottomColor: 'white',
    padding: 15,
    borderRadius: 1,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: 'white',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  },
  completionDateText: {
    color: '#4e9bde',
    fontWeight: 'bold',
    fontSize: 14,
  },
  startDateContainer: {
    width: '100%',
    marginTop: 8,
    padding: 12,
    alignItems: 'center',
  },
  startDateText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  participantsSection: {
    width: '100%',
    marginTop: 8,
    marginBottom: 8,
  },
  participantsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 1,
    borderWidth: 1,
    borderColor: 'white',
    marginBottom: 2,
  },
  participantsHeaderText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  participantsList: {
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderTopWidth: 0,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  participantAvatarContainer: {
    marginRight: 12,
  },
  participantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  participantUsername: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    marginTop: 2,
  },
  creatorTag: {
    backgroundColor: '#4e9bde',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  creatorTagText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerRightPlaceholder: {
    minWidth: 40,
  },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e',
  },

  pendingGithubSection: {
  width: '100%',
  marginTop: 8,
  marginBottom: 8,
  backgroundColor: '#1e1e1e',
  borderWidth: 1,
  borderColor: 'rgba(255, 193, 7, 0.4)',
  borderRadius: 1,
},
pendingGithubTitle: {
  color: '#FFC107',
  fontWeight: 'bold',
  fontSize: 14,
  padding: 15,
  borderBottomWidth: 0.5,
  borderBottomColor: 'rgba(255, 193, 7, 0.3)',
},
pendingGithubItem: {
  flexDirection: 'row',
  alignItems: 'center',
  padding: 12,
  borderBottomWidth: 0.5,
  borderBottomColor: 'rgba(255, 255, 255, 0.1)',
},
pendingGithubInfo: {
  flex: 1,
},
pendingGithubStatus: {
  color: '#FFC107',
  fontSize: 12,
  marginTop: 2,
},
resendButton: {
  backgroundColor: '#4e9bde',
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 6,
},
resendButtonDisabled: {
  opacity: 0.5,
},
resendButtonText: {
  color: 'white',
  fontSize: 12,
  fontWeight: '600',
},
});