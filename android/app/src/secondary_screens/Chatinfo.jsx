  import { StyleSheet, Text, View,TouchableOpacity,Alert } from 'react-native'
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

  const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0: 0;
  export default function ChatInfo({route,navigation }) {
    const { 
      chatId = 'default', 
      chatTitle = 'Chat', 
      userId,
      chatData=null,
      chatType=null,
    } = route.params || {};

      const [projectcompleted,setprojectcompleted]=useState(false);
      const [projectStartDate, setProjectStartDate] = useState(null);
      const [projectCompletionDate, setProjectCompletionDate] = useState(null);
      const [participantsExpanded, setParticipantsExpanded] = useState(false);
      const [participantsList, setParticipantsList] = useState([]);

      const currentUserUid=auth().currentUser.uid;
      const { getCachedImageUri } = useUserData();

      const isCreator= chatData?.createdBy===currentUserUid;

      const showdonebutton= isCreator && !projectcompleted

      const displaytitle=chatTitle || 'Chat';

      // Helper function to format date
      const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      };

      // Helper function to get initials
      const getInitials = (participant) => {
        const name = participant.name || participant.displayName || participant.username || 'U';
        return name.charAt(0).toUpperCase();
      };

      // Get participants list from chatData
      useEffect(() => {
        if (chatData?.type === 'group' && chatData?.participantsInfo) {
          const participants = Object.values(chatData.participantsInfo).map(participant => ({
            id: participant.id,
            name: participant.name || participant.displayName || 'Unknown User',
            username: participant.username || '',
            avatar: participant.avatar || participant.photoURL || null,
          }));
          setParticipantsList(participants);
        }
      }, [chatData]);

      // Handle participant click - navigate to Profile
      const handleParticipantPress = (participant) => {
        navigation.navigate('Profile', {
          screen: 'Profile',
          params: { 
            userId: participant.id, 
            username: participant.username 
          }
        });
      };


      // Check if project is already completed when component mounts or chatId changes
      // Fetch for all users so everyone can see dates
      useEffect(() => {
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
                  if (projectData.completedAt) {
                    setProjectCompletionDate(projectData.completedAt);
                  }
                } else {
                  setprojectcompleted(false);
                  setProjectCompletionDate(null);
                }
                // Set start date if available (visible to all users)
                if (projectData.createdAt) {
                  setProjectStartDate(projectData.createdAt);
                } else if (projectData.startDate) {
                  setProjectStartDate(projectData.startDate);
                }
              }
            } catch (error) {
              // Error checking project status
            }
          }
        };
        
        checkProjectStatus();
      }, [chatId, chatData?.type]);

      // Also check project status when screen is focused
      // Fetch for all users so everyone can see dates
      useFocusEffect(
        React.useCallback(() => {
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
                    if (projectData.completedAt) {
                      setProjectCompletionDate(projectData.completedAt);
                    }
                  } else {
                    setprojectcompleted(false);
                    setProjectCompletionDate(null);
                  }
                  // Set start date if available (visible to all users)
                  if (projectData.createdAt) {
                    setProjectStartDate(projectData.createdAt);
                  } else if (projectData.startDate) {
                    setProjectStartDate(projectData.startDate);
                  }
                }
              } catch (error) {
                // Error checking project status
              }
            }
          };
          
          checkProjectStatus();
        }, [chatId, chatData?.type])
      );

    return (
      
              
              <SafeAreaView style={styles.container}>
                <View style={styles.statusBarSpacer} />
                <View style={styles.customHeader}>
                  {/* Back button on the left */}
                  <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.backButton}>
                    <Text style={styles.backButtonText}>←</Text>
                  </TouchableOpacity>
                  
                  {/* Title in the middle */}
                  <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitleText}>{displaytitle}</Text>
                  </View>
                  
                  {/* Placeholder on the right for balance */}
                  <View style={styles.headerRightPlaceholder} />
                </View>
            
          
              
              <View style={styles.buttonContainer}>
              {/* <View style={{ flexDirection: 'row', alignItems: 'center' }}> */}
                {showdonebutton && chatData?.type === 'group' && (
                  <TouchableOpacity
                    onPress={async () => {
                      Alert.alert(
                        'Declare  Project as Completed',
                        'Are you sure you want to declare this project as completed?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Done',
                            onPress: async () => {
                              try {
                                // Find the project associated with this chatId
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
                                  
                                  // Refetch the document to get the server timestamp
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
                    style={ styles.doneButton }
                  >
                    <Text style={ styles.doneButtonText }>Done</Text>
                  </TouchableOpacity>
                )}
                
                {/* Show completion date if project is completed */}
                {projectcompleted && chatData?.type === 'group' && projectCompletionDate && (
                  <View style={styles.completionDateContainer}>
                    <Text style={styles.completionDateText}>
                      Completed on: {formatDate(projectCompletionDate)}
                    </Text>
                  </View>
                )}
                
                {/* Show start date below the button/completion date */}
                {chatData?.type === 'group' && projectStartDate && (
                  <View style={styles.startDateContainer}>
                    <Text style={styles.startDateText}>
                      Started on: {formatDate(projectStartDate)}
                    </Text>
                  </View>
                )}

                {/* Participants dropdown for group chats */}
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
                                <EmptydP 
                                  size={40} 
                                  initials={getInitials(participant)} 
                                />
                              )}
                            </View>
                            <View style={styles.participantInfo}>
                              <Text style={styles.participantName}>
                                {participant.name}
                              </Text>
                              {participant.username && (
                                <Text style={styles.participantUsername}>
                                  @{participant.username}
                                </Text>
                              )}
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

                {/* Delete button
                    - Group chats: only creator can delete (for everyone)
                    - Direct/other chats: both users can delete (only from their own view)
                */}
                {(chatData?.type === 'group' ? isCreator : true) && (
                  <TouchableOpacity
                    onPress={() => {
                      // For group chats, only creator can delete for everyone
                      // For non-group chats, delete only from current user's side
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
                                  // Group: delete the entire chat
                                  await chatService.deleteChatPermanently(chatId);
                                } else {
                                  // Direct/other: delete only for current user
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
                    style={ styles.deleteButton }
                  >
                    <Text style={ styles.deleteButtonText }>Delete</Text>
                  </TouchableOpacity>
                )}

                
              
              </View>
              {/* </View> */}
              </SafeAreaView>
          
    )
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
    // paddingVertical: 12,
    // minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
   
    buttonContainer: {
      padding: 10,
    },
    doneButton: {
      width:'100%',
    marginBottom:2,
    marginTop: 4,
     backgroundColor: '#333',
     borderBottomColor:'white', 
    padding: 15,
     borderRadius: 1,
      alignItems: 'center',
       borderWidth: 1, 
        shadowColor: 'white',
    shadowOffset: { width: 0, 
      height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
    },
    doneButtonText: {
      color: '#4e9bde',
      fontWeight: 'bold',
    },
    deleteButton: {
      width:'100%',
    marginBottom:2,
    marginTop: 4,
     backgroundColor: '#333',
     borderBottomColor:'white', 
    padding: 15,
     borderRadius: 1,
      alignItems: 'center',
       borderWidth: 1, 
        shadowColor: 'white',
    shadowOffset: { width: 0, 
      height: 1 },
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
      minWidth: 40, // Same width as back button to keep title centered
    },
    statusBarSpacer: { 
      height: getStatusBarHeight(), 
      backgroundColor: '#1e1e1e' 
    },
  });