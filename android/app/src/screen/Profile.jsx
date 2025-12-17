import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
  Platform, Modal, TextInput, Alert, ActivityIndicator, Dimensions, FlatList
} from 'react-native';

import { QnaData } from './Qna';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import Firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import storage from '@react-native-firebase/storage';
import { launchImageLibrary } from 'react-native-image-picker';
import { useUserData } from '../users';
import chatService from './chatService';
import {requestcamerapermission,requestgallerypermission} from '../../utils/permissions';



const { width } = Dimensions.get('window');

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const Profile = () => {
  const route = useRoute();
  const { userId, username } = route.params || {};
  const uidToShow = userId || auth().currentUser.uid;
  const navigation = useNavigation();
  const currentUser = auth().currentUser;
  const viewedUserId = route.params?.userId || currentUser?.uid;
  const { posts, getCachedImageUri } = useUserData();

  // State variables
  const [activeTab, setActiveTab] = useState('posts');
  const [userData, setUserData] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [displayName, setDisplayName] = useState('Developer');
  const [avatarUrl, setAvatarUrl] = useState('https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg');
  const [isFollowing, setIsFollowing] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userQuestions, setUserQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Collaboration Modal States
  const [collaborationModalVisible, setCollaborationModalVisible] = useState(false);
  const [projectStatsModalVisible, setProjectStatsModalVisible] = useState(false);
  const [projectDetailsModalVisible, setProjectDetailsModalVisible] = useState(false);
  const [projectEditModalVisible, setProjectEditModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectParticipants, setProjectParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectAbout, setProjectAbout] = useState('');
  const [projectTech, setProjectTech] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  // Editable project form states
  const [editProjectTitle, setEditProjectTitle] = useState('');
  const [editProjectAbout, setEditProjectAbout] = useState('');
  const [editProjectTech, setEditProjectTech] = useState('');
  const [editGithubRepo, setEditGithubRepo] = useState('');
  const [updatingProject, setUpdatingProject] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [followingUsers, setFollowingUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [selectedCollaborators, setSelectedCollaborators] = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [collaborationProjects, setCollaborationProjects] = useState([]);

  const isOwnProfile = viewedUserId === currentUser?.uid;
  const canViewContent = isOwnProfile || isFollowing;

  // Refresh function
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadUserData();
      if (activeTab === 'questions' && viewedUserId) {
        await fetchUserQuestions(viewedUserId);
      }
    } catch (error) {
      
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, viewedUserId]);

  useFocusEffect(
    useCallback(() => {
      if (viewedUserId && isOwnProfile) {
        loadUserData();
      }
      if (activeTab === 'Collaborations' && viewedUserId) {
        fetchCollaborationProjects();
      }
    }, [viewedUserId, isOwnProfile, activeTab])
  );

  // Fetch following users for collaboration
  const fetchFollowingUsers = async () => {
    if (!currentUser?.uid) return;
    
    setLoadingFollowing(true);
    try {
      const followingSnapshot = await Firestore()
        .collection('profile')
        .doc(currentUser.uid)
        .collection('following')
        .get();

      const userIds = followingSnapshot.docs.map(doc => doc.id);
      
      if (userIds.length === 0) {
        setFollowingUsers([]);
        setFilteredUsers([]);
        setLoadingFollowing(false);
        return;
      }

      // Fetch user details
      const usersPromises = userIds.map(async (userId) => {
        const userDoc = await Firestore().collection('users').doc(userId).get();
        const profileDoc = await Firestore().collection('profile').doc(userId).get();
        
        if (userDoc.exists) {
          return {
            id: userId,
            username: userDoc.data().username || 'User',
            email: userDoc.data().email || '',
            avatar: profileDoc.exists ? profileDoc.data().avatar : 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg'
          };
        }
        return null;
      });

      const users = (await Promise.all(usersPromises)).filter(user => user !== null);
      setFollowingUsers(users);
      setFilteredUsers(users);
    } catch (error) {
      
      setFollowingUsers([]);
      setFilteredUsers([]);
    } finally {
      setLoadingFollowing(false);
    }
  };

  // Search users
  const handleSearchUsers = (query) => {
    setSearchQuery(query);
    if (query.trim() === '') {
      setFilteredUsers(followingUsers);
    } else {
      const filtered = followingUsers.filter(user =>
        user.username.toLowerCase().includes(query.toLowerCase()) ||
        user.email.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredUsers(filtered);
    }
  };

  // Toggle collaborator selection
  const toggleCollaborator = (userId) => {
    setSelectedCollaborators(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  // Open collaboration modal
  const openCollaborationModal = () => {
    setCollaborationModalVisible(true);
    fetchFollowingUsers();
  };

  // Close collaboration modal
  const closeCollaborationModal = () => {
    setCollaborationModalVisible(false);
    setProjectTitle('');
    setProjectAbout('');
    setProjectTech('');
    setGithubRepo('');
    setSearchQuery('');
    setSelectedCollaborators([]);
    setFilteredUsers([]);
  };

  // Create collaboration project
  const createCollaborationProject = async () => {
    if (!projectTitle.trim()) {
      Alert.alert('Error', 'Please enter a project title');
      return;
    }
    if (!projectAbout.trim()) {
      Alert.alert('Error', 'Please enter project description');
      return;
    }
    if(selectedCollaborators.length==0){
      Alert.alert('Error','Please select a user to collaborate')
      return;
    }

    setCreatingProject(true);
    

try{

  const projectRef = Firestore().collection('collaborations').doc();
  const projectId=projectRef.id;

     const groupchat=await chatService.createGroupChat(currentUser.uid,[],projectTitle.trim(),
    `collaboration chat for:${projectAbout.trim()}`);

     

const projectData = {
  id: projectId, // Include ID in the data
  title: projectTitle.trim(),
  about: projectAbout.trim(),
  tech: projectTech.trim(),
  githubRepo: githubRepo.trim(),
  creatorId: currentUser.uid,
  creatorUsername: displayName,
  collaborators: [currentUser.uid],
  pendingInvites:selectedCollaborators,
  status: 'pending',
  createdAt: Firestore.FieldValue.serverTimestamp(),
  chatId:null
};
 
      await projectRef.set(projectData)
      await projectRef.update({
      chatId:groupchat.id
     })

   

      // Send notifications to selected collaborators
      const notificationPromises = selectedCollaborators.map(async (userId) => {
        await Firestore().collection('notifications').add({
          recipientUid: userId,
          senderUid: currentUser.uid,
          type: 'collaboration_invite',
          data: {
            message: `invited you to collaborate on "${projectTitle}"`,
            senderUsername: displayName,
            projectId: projectId,
            projectTitle: projectTitle.trim(),
            chatId:groupchat.id
          },
          read: false,
          createdAt: Firestore.FieldValue.serverTimestamp(),
        });
      });

      await Promise.all(notificationPromises);

      Alert.alert('Success', 'Collaboration project created and invitations sent!');
      closeCollaborationModal();
    } catch (error) {
      
      Alert.alert('Error', 'Failed to create collaboration project');
    } finally {
      setCreatingProject(false);
    }
  };


  const fetchCollaborationProjects = async () => {
    if (!viewedUserId) return;

    try {
      // Fetch projects where viewed user is creator
      const creatorProjectsSnapshot = await Firestore()
        .collection('collaborations')
        .where('creatorId', '==', viewedUserId)
        .get();
      
      // Fetch projects where viewed user is collaborator
      const collaboratorProjectsSnapshot = await Firestore()
        .collection('collaborations')
        .where('collaborators', 'array-contains', viewedUserId)
        .get();
      
      // Combine both sets and remove duplicates
      const allProjects = new Map();
      
      creatorProjectsSnapshot.docs.forEach(doc => {
        allProjects.set(doc.id, { ...doc.data(), id: doc.id });
      });
      
      collaboratorProjectsSnapshot.docs.forEach(doc => {
        if (!allProjects.has(doc.id)) {
          allProjects.set(doc.id, { ...doc.data(), id: doc.id });
        }
      });
      
      const projects = Array.from(allProjects.values());
      
      // Sort locally
      projects.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });
      
      setCollaborationProjects(projects);
    } catch (error) {
      
      Alert.alert('Error', 'Failed to load projects');
    }
  };

  // Fetch project participants details
  const fetchProjectParticipants = async (project) => {
    if (!project || !project.collaborators) return [];
    
    setLoadingParticipants(true);
    try {
      const participantPromises = project.collaborators.map(async (userId) => {
        try {
          const userDoc = await Firestore().collection('users').doc(userId).get();
          const profileDoc = await Firestore().collection('profile').doc(userId).get();
          
          if (userDoc.exists) {
            return {
              id: userId,
              username: userDoc.data().username || 'User',
              email: userDoc.data().email || '',
              avatar: profileDoc.exists ? profileDoc.data().avatar : 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
              isCreator: userId === project.creatorId
            };
          }
          return null;
        } catch (error) {
          
          return null;
        }
      });
      
      const participants = (await Promise.all(participantPromises)).filter(p => p !== null);
      setProjectParticipants(participants);
      return participants;
    } catch (error) {
      
      setProjectParticipants([]);
      return [];
    } finally {
      setLoadingParticipants(false);
    }
  };

  // Open project details modal for non-creators
  const openProjectDetailsModal = async (project) => {
    setSelectedProject(project);
    await fetchProjectParticipants(project);
    setProjectDetailsModalVisible(true);
  };

  // Close project details modal
  const closeProjectDetailsModal = () => {
    setProjectDetailsModalVisible(false);
    setSelectedProject(null);
    setProjectParticipants([]);
  };

  // Open editable project modal for creators
  const openProjectEditModal = async (project) => {
    setSelectedProject(project);
    setEditProjectTitle(project.title || '');
    setEditProjectAbout(project.about || '');
    setEditProjectTech(project.tech || '');
    setEditGithubRepo(project.githubRepo || '');
    await fetchProjectParticipants(project);
    setProjectEditModalVisible(true);
  };

  // Close editable project modal
  const closeProjectEditModal = () => {
    setProjectEditModalVisible(false);
    setSelectedProject(null);
    setEditProjectTitle('');
    setEditProjectAbout('');
    setEditProjectTech('');
    setEditGithubRepo('');
    setProjectParticipants([]);
  };

  // Update project details
  const updateProject = async () => {
    if (!selectedProject || !selectedProject.id) return;
    
    if (!editProjectTitle.trim()) {
      Alert.alert('Error', 'Please enter a project title');
      return;
    }
    if (!editProjectAbout.trim()) {
      Alert.alert('Error', 'Please enter project description');
      return;
    }

    setUpdatingProject(true);
    try {
      await Firestore()
        .collection('collaborations')
        .doc(selectedProject.id)
        .update({
          title: editProjectTitle.trim(),
          about: editProjectAbout.trim(),
          tech: editProjectTech.trim(),
          githubRepo: editGithubRepo.trim(),
          updatedAt: Firestore.FieldValue.serverTimestamp(),
        });

      // Update local state
      setCollaborationProjects(prev => 
        prev.map(p => 
          p.id === selectedProject.id 
            ? { ...p, title: editProjectTitle.trim(), about: editProjectAbout.trim(), tech: editProjectTech.trim(), githubRepo: editGithubRepo.trim() }
            : p
        )
      );

      Alert.alert('Success', 'Project updated successfully!');
      closeProjectEditModal();
      // Refresh projects list
      await fetchCollaborationProjects();
    } catch (error) {
      
      Alert.alert('Error', 'Failed to update project');
    } finally {
      setUpdatingProject(false);
    }
  };


  // Fetch user's questions from Firestore
  const fetchUserQuestions = async (userId) => {
    setLoadingQuestions(true);
    try {
      const questionsSnapshot = await Firestore()
        .collection('questions')
        .where('authorId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      const questions = questionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setUserQuestions(questions);
    } catch (error) {
      
      try {
        const questionsSnapshot = await Firestore()
          .collection('questions')
          .where('authorId', '==', userId)
          .limit(10)
          .get();

        const questions = questionsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setUserQuestions(questions);
      } catch (secondError) {
        
        setUserQuestions([]);
      }
    } finally {
      setLoadingQuestions(false);
    }
  };

  const getProfileDocument = async (userId) => {
    try {
      const profileRef = Firestore().collection('profile').doc(userId);
      const profileDoc = await profileRef.get();
      
      if (profileDoc.exists) {
        return profileDoc.data();
      } else {
        
        return null;
      }
    } catch (error) {
      
      return null;
    }
  };

  const createNotification = async (recipientUid, type, data) => {
    try {
      await Firestore().collection('notifications').add({
        recipientUid,
        senderUid: currentUser.uid,
        type,
        data,
        read: false,
        createdAt: Firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      
    }
  };

  const loadUserData = async () => {
    if (!viewedUserId) {
      setLoading(false);
      return;
    }
    
    try {
      const userDoc = await Firestore().collection('users').doc(viewedUserId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        setUserData(userData);
        setDisplayName(userData.username || 'Developer');
      } else if (isOwnProfile) {
        Alert.alert('Error', 'User profile not found. Please contact support.');
        setLoading(false);
        return;
      }

      const profileData = await getProfileDocument(viewedUserId);
      if (profileData) {
        setUserProfile(profileData);
        setAvatarUrl(profileData.avatar || 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg');
      } else {
        const defaultProfile = {
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          questionsCount: 0,
          answersCount: 0,
          avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
          bio: '',
          location: '',
          website: '',
          joinedDate: new Date().toLocaleDateString()
        };
        setUserProfile(defaultProfile);
        setAvatarUrl(defaultProfile.avatar);
      }

      if (activeTab === 'questions') {
        fetchUserQuestions(viewedUserId);
      }
    } catch (error) {
      
      Alert.alert('Error', 'Failed to load profile data.');
      setUserData(null);
      setUserProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
  }, [viewedUserId, isOwnProfile]);

  useEffect(() => {
    if (activeTab === 'questions' && viewedUserId) {
      fetchUserQuestions(viewedUserId);
    }
  }, [activeTab, viewedUserId]);

  useEffect(() => {
    if (!isOwnProfile && currentUser?.uid) {
      const checkFollowing = async () => {
        try {
          const doc = await Firestore()
            .collection('profile')
            .doc(currentUser.uid)
            .collection('following')
            .doc(viewedUserId)
            .get();
          setIsFollowing(doc.exists);
        } catch {
          setIsFollowing(false);
        }
      };
      checkFollowing();

      
    }
  }, [currentUser?.uid, viewedUserId, isOwnProfile]);

  useEffect(() => {
  if (activeTab === 'Collaborations' && viewedUserId) {
    fetchCollaborationProjects();
  }
}, [activeTab, viewedUserId]);

  const ensureProfileExists = async (userId) => {
    try {
      const profileRef = Firestore().collection('profile').doc(userId);
      const profileDoc = await profileRef.get();

      if (!profileDoc.exists) {
        const initialProfile = {
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          questionsCount: 0,
          answersCount: 0,
          avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
          bio: '',
          location: '',
          website: '',
          joinedDate: new Date().toLocaleDateString(),
          createdAt: Firestore.FieldValue.serverTimestamp(),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        };

        await profileRef.set(initialProfile);
        
        return initialProfile;
      }
      return profileDoc.data();
    } catch (error) {
      
      throw error;
    }
  };

  const sendFollowRequest = async () => {
    if (isOwnProfile || !currentUser?.uid) return;
    
    try {
      const currentUserDoc = await Firestore().collection('users').doc(currentUser.uid).get();
      const currentUsername = currentUserDoc.exists ? currentUserDoc.data()?.username || 'User' : 'User';

      await ensureProfileExists(currentUser.uid);
      await ensureProfileExists(viewedUserId);

      const alreadyRequestedSnap = await Firestore()
        .collection('profile')
        .doc(viewedUserId)
        .collection('followRequests')
        .where('from', '==', currentUser.uid)
        .limit(1)
        .get();

      if (!alreadyRequestedSnap.empty) {
        Alert.alert('Request pending', 'You have already sent a follow request.');
        return;
      }

      if (isFollowing) {
        Alert.alert('Already following');
        return;
      }

      await Firestore()
        .collection('profile')
        .doc(viewedUserId)
        .collection('followRequests')
        .add({
          from: currentUser.uid,
          fromUsername: currentUsername,
          createdAt: Firestore.FieldValue.serverTimestamp(),
        });

      await createNotification(viewedUserId, 'follow_request', {
        message: 'sent you a follow request',
        senderUsername: currentUsername
      });

      Alert.alert('Success', 'Follow request sent! The user will be notified.');
    } catch (error) {
     
      Alert.alert('Error', 'Could not send follow request.');
    }
  };

  const unfollow = async () => {
    if (isOwnProfile || !currentUser?.uid) return;
    
    try {
      await ensureProfileExists(currentUser.uid);
      await ensureProfileExists(viewedUserId);

      const batch = Firestore().batch();

      const followerRef = Firestore().collection('profile').doc(viewedUserId)
        .collection('followers').doc(currentUser.uid);
      batch.delete(followerRef);

      const followingRef = Firestore().collection('profile').doc(currentUser.uid)
        .collection('following').doc(viewedUserId);
      batch.delete(followingRef);

      const viewedUserProfileRef = Firestore().collection('profile').doc(viewedUserId);
      const currentUserProfileRef = Firestore().collection('profile').doc(currentUser.uid);

      batch.update(viewedUserProfileRef, {
        followersCount: Firestore.FieldValue.increment(-1),
        updatedAt: Firestore.FieldValue.serverTimestamp()
      });
      batch.update(currentUserProfileRef, {
        followingCount: Firestore.FieldValue.increment(-1),
        updatedAt: Firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();

      setIsFollowing(false);

      setUserProfile(prev => prev ? ({
        ...prev,
        followersCount: Math.max(0, (prev.followersCount || 0) - 1)
      }) : prev);

      Alert.alert('Success', 'You are no longer following this user.');
    } catch (error) {
      
      Alert.alert('Error', 'Failed to unfollow user.');
    }
  };

  const handleFollowPress = () => {
    if (isFollowing) {
      Alert.alert(
        'Unfollow',
        `Are you sure you want to unfollow ${displayName}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Unfollow', style: 'destructive', onPress: unfollow }
        ]
      );
    } else {
      sendFollowRequest();
    }
  };

  const selectImage = async () => {
const haspermission=await requestgallerypermission();
if(!haspermission){
  return;
}

    launchImageLibrary(
      { mediaType: 'photo', quality: 0.8, includeBase64: false },
      (response) => {
        if (response.assets && response.assets.length > 0) {
          setSelectedImage(response.assets[0]);
          setUploadModalVisible(true);
        }
      }
    );
  };

  const uploadPost = async () => {
    if (!selectedImage || !currentUser) return;
    
    setUploading(true);
    try {
      await ensureProfileExists(currentUser.uid);

      const imageName = `posts/${currentUser.uid}/${Date.now()}_${selectedImage.fileName || 'image.jpg'}`;
      const reference = storage().ref(imageName);
      await reference.putFile(selectedImage.uri);
      const imageUrl = await reference.getDownloadURL();

      const postData = {
        userId: currentUser.uid,
        username: displayName,
        userAvatar: avatarUrl,
        imageUrl,
        caption,
        createdAt: Firestore.FieldValue.serverTimestamp(),
        likes: 0,
        likedBy: [],
      };

      await Firestore().collection('posts').add(postData);

      await Firestore().collection('profile').doc(currentUser.uid).update({
        postsCount: Firestore.FieldValue.increment(1),
        updatedAt: Firestore.FieldValue.serverTimestamp()
      });

      setUserProfile(prev => prev ? ({
        ...prev,
        postsCount: (prev.postsCount || 0) + 1
      }) : prev);

      setSelectedImage(null);
      setCaption('');
      setUploadModalVisible(false);
      Alert.alert('Success', 'Post uploaded successfully!');
    } catch (error) {
      
      Alert.alert('Error', 'Failed to upload post.');
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarChange = async () => {
    if (!isOwnProfile || !currentUser) return;

    const haspermission=await requestgallerypermission();
    if(!haspermission){
      return;
    }
    
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.7,
        includeBase64: false,
      });

      if (result.assets && result.assets.length > 0) {
        const image = result.assets[0];
        Alert.alert('Uploading', 'Please wait while we update your profile picture...');
        
        await ensureProfileExists(currentUser.uid);
        
        const fileName = `avatar${currentUser.uid}_${Date.now()}.jpg`;
        const reference = storage().ref(`avatars/${currentUser.uid}/${fileName}`);
        await reference.putFile(image.uri);
        const downloadUrl = await reference.getDownloadURL();

        await Firestore().collection('profile').doc(currentUser.uid).update({
          avatar: downloadUrl,
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });

        setAvatarUrl(downloadUrl);
        setUserProfile(prev => prev ? ({
          ...prev,
          avatar: downloadUrl
        }) : prev);

        Alert.alert('Success', 'Profile picture updated!');
      }
    } catch (error) {
      
      Alert.alert('Error', 'Failed to update profile picture.');
    }
  };

  const navigateToAskQuestion = () => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please log in to ask a question.');
      return;
    }
    navigation.navigate('AskQuestion');
  };

  const questionsCount = userProfile?.questionsCount || userQuestions.length || 0;
  const answersCount = userProfile?.answersCount || 0;

  const formatNumber = (num) => (num >= 1000 ? (num / 1000).toFixed(1) + 'k' : num.toString());

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    
    let date;
    if (timestamp && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else {
      date = new Date(timestamp);
    }
    
    return date.toLocaleDateString() + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const deleteQuestion = async (questionId, questionTitle) => {
    Alert.alert(
      'Delete Question',
      `Are you sure you want to delete "${questionTitle}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoadingQuestions(true);

              await Firestore().runTransaction(async (transaction) => {
                const questionRef = Firestore().collection('questions').doc(questionId);
                const profileRef = Firestore().collection('profile').doc(currentUser.uid);
                
                const profileDoc = await transaction.get(profileRef);
                
                transaction.delete(questionRef);
                
                if (profileDoc.exists) {
                  const currentCount = profileDoc.data().questionsCount || 0;
                  const newCount = Math.max(0, currentCount - 1);
                  
                  transaction.update(profileRef, {
                    questionsCount: newCount,
                    updatedAt: Firestore.FieldValue.serverTimestamp()
                  });
                }
              });

              setUserQuestions(prev => prev.filter(q => q.id !== questionId));
              setUserProfile(prev => prev ? ({
                ...prev,
                questionsCount: Math.max(0, (prev.questionsCount || 0) - 1)
              }) : prev);

              Alert.alert('Deleted', 'Your question has been deleted.');
            } catch (error) {
              
              Alert.alert('Error', 'Could not delete question. Please try again.');
            } finally {
              setLoadingQuestions(false);
            }
          }
        }
      ]
    );
  };

  const renderTabContent = () => {
    if (!canViewContent) {
      return (
        <View style={styles.privateAccountContainer}>
          <Icon name="lock-closed-outline" size={80} color="#666" />
          <Text style={styles.privateAccountTitle}>This Account is Private</Text>
          <Text style={styles.privateAccountText}>
            Follow this account to see their posts, questions, and answers
          </Text>
        </View>
      );
    }

    if (activeTab === 'posts') {
      const postsCount = userProfile?.postsCount || 0;
      if (postsCount === 0) {
        return (
          <View style={styles.tabContent}>
            <Icon name="camera-outline" size={64} color="#666" />
            <Text style={styles.emptyText}>Posts will appear here</Text>
            {isOwnProfile && (
              <TouchableOpacity style={styles.uploadButton} onPress={selectImage}>
                <Text style={styles.uploadButtonText}>Upload Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      } else {
        return (
          <ScrollView contentContainerStyle={styles.gridContainer}>
            <View style={styles.grid}>
              {posts.map((post, idx) => (
                <TouchableOpacity
                  key={post.id}
                  style={[
                    styles.gridItem,
                    { marginRight: (idx + 1) % 3 === 0 ? 0 : 8 }
                  ]}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
                >
                  <Image
                    source={{ uri: getCachedImageUri(post.imageUrl) }}
                    style={styles.gridImage}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        );
      }
    }

    if (activeTab === 'questions') {
      return (
        <View style={styles.tabContent}>
          <View style={styles.questionsHeaderRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{questionsCount}</Text>
              <Text style={styles.statLabel}>Question</Text>
            </View>
            {isOwnProfile && (
              <TouchableOpacity style={styles.askQuestionButton} onPress={navigateToAskQuestion}>
                <Icon name="add-circle-outline" size={24} color="white" />
                <Text style={styles.askQuestionButtonText}>Ask a Question</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {loadingQuestions ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
          ) : userQuestions.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="help-circle-outline" size={64} color="#666" />
              <Text style={styles.emptyText}>
                {isOwnProfile ? 'You haven\'t asked any questions yet' : 'No questions asked yet'}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.questionsContainer} showsVerticalScrollIndicator={false}>
              {userQuestions.map((question) => (
                <TouchableOpacity 
                  key={question.id} 
                  style={styles.questionCard}
                  onPress={() => {
                    navigation.navigate('Qna', { selectedQuestionId: question.id });
                  }}
                >
                  <View style={styles.questionHeader}>
                    <View style={styles.questionTitleContainer}>
                      <Text style={styles.questionTitle} numberOfLines={2}>
                        {question.title}
                      </Text>
                    </View>
                    
                    {isOwnProfile && (
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={(e) => {
                          e.stopPropagation();
                          deleteQuestion(question.id, question.title);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Icon name="trash-outline" size={18} color="#ff4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                  
                  <Text style={styles.questionDescription} numberOfLines={3}>
                    {question.content}
                  </Text>
                  
                  <View style={styles.questionMeta}>
                    <View style={styles.questionStats}>
                      <View style={styles.statItem}>
                        <Icon name="chatbubble-outline" size={16} color="#666" />
                        <Text style={styles.statText}>{question.answers?.length || 0}</Text>
                      </View>
                      <Text style={styles.questionDate}>
                        {formatDate(question.timestamp)}
                      </Text>
                    </View>
                  </View>
                  
                  {question.tags && question.tags.length > 0 && (
                    <View style={styles.tagsContainer}>
                      {question.tags.slice(0, 3).map((tag, index) => (
                        <View key={index} style={styles.tag}>
                          <Text style={styles.tagText}>#{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      );
    }
    
    if (activeTab === 'Collaborations') {
      // Calculate project stats
      const createdProjects = collaborationProjects.filter(p => p.creatorId === viewedUserId).length;
      const participatedProjects = collaborationProjects.filter(p => 
        p.collaborators?.includes(viewedUserId) && p.creatorId !== viewedUserId
      ).length;
      const ongoingProjects = collaborationProjects.filter(p => 
        p.status !== 'completed' && p.status !== 'pending'
      ).length;
      const completedProjects = collaborationProjects.filter(p => p.status === 'completed').length;
      
      return (
        <View style={styles.collaborationTabContent}>
          <View style={styles.collaborationHeader}>
            <TouchableOpacity 
              style={styles.projectStatsButton}
              onPress={() => setProjectStatsModalVisible(true)}
            >
              <Icon name="stats-chart-outline" size={20} color="white" />
              <Text style={styles.projectStatsButtonText}>Project Stats</Text>
            </TouchableOpacity>
            {isOwnProfile && (
              <TouchableOpacity 
                style={styles.createProjectButtonTop}
                onPress={openCollaborationModal}
              >
                <Icon name="add-circle-outline" size={24} color="white" />
                <Text style={styles.createProjectButtonTextTop}>Create Project</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {collaborationProjects.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="people-outline" size={64} color="#666" />
              <Text style={styles.emptyText}>
                {isOwnProfile ? 'Start collaborating on projects' : 'No collaborations yet'}
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={styles.projectsScrollView}>
              {collaborationProjects.map((project) => {
                const isCompleted = project.status === 'completed';
                const isOngoing = project.status !== 'completed' && project.status !== 'pending';
                const isCreator = project.creatorId === currentUser?.uid;
                const isParticipant = !isCreator && project.collaborators?.includes(currentUser?.uid);
                
                const projectCreatorId = project.creatorId;
                const isCurrentUserCreator = projectCreatorId === currentUser?.uid;
                
                return (
                  <TouchableOpacity
                    key={project.id}
                    style={styles.projectCard}
                    onPress={() => {
                      if (isCurrentUserCreator) {
                        // Creator sees editable form
                        openProjectEditModal(project);
                      } else {
                        // Non-creators see read-only project details
                        openProjectDetailsModal(project);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{project.title}</Text>
                      {isCompleted && (
                        <View style={styles.statusTagCompleted}>
                          <Text style={styles.statusTagTextCompleted}>Completed</Text>
                        </View>
                      )}
                      {isOngoing && (
                        <View style={styles.statusTagOngoing}>
                          <Text style={styles.statusTagTextOngoing}>Ongoing</Text>
                        </View>
                      )}
                      {!isCompleted && !isOngoing && (
                        <View style={styles.statusTagPending}>
                          <Text style={styles.statusTagTextPending}>Pending</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.cardAbout} numberOfLines={3}>
                      {project.about}
                    </Text>
                    {currentUser?.uid && (isCreator || isParticipant) && (
                      <View style={styles.roleContainer}>
                        {isCreator ? (
                          <View style={styles.roleTagCreator}>
                            <Icon name="star" size={12} color="#FFD700" />
                            <Text style={styles.roleTextCreator}>Creator</Text>
                          </View>
                        ) : isParticipant ? (
                          <View style={styles.roleTagParticipant}>
                            <Icon name="people" size={12} color="#007AFF" />
                            <Text style={styles.roleTextParticipant}>Participant</Text>
                          </View>
                        ) : null}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          
          {/* Project Stats Modal */}
          <Modal
            visible={projectStatsModalVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setProjectStatsModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.projectStatsModalContainer}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Project Statistics</Text>
                  <TouchableOpacity onPress={() => setProjectStatsModalVisible(false)}>
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                
                <View style={styles.statsFormContainer}>
                  <View style={styles.statsFormRow}>
                    <Text style={styles.statsFormLabel}>Projects Created:</Text>
                    <Text style={styles.statsFormValue}>{createdProjects}</Text>
                  </View>
                  
                  <View style={styles.statsFormRow}>
                    <Text style={styles.statsFormLabel}>Projects Participated:</Text>
                    <Text style={styles.statsFormValue}>{participatedProjects}</Text>
                  </View>
                  
                  <View style={styles.statsFormRow}>
                    <Text style={styles.statsFormLabel}>Ongoing:</Text>
                    <Text style={styles.statsFormValue}>{ongoingProjects}</Text>
                  </View>
                  
                  <View style={styles.statsFormRow}>
                    <Text style={styles.statsFormLabel}>Completed:</Text>
                    <Text style={styles.statsFormValue}>{completedProjects}</Text>
                  </View>
                </View>
              </View>
            </View>
          </Modal>
          
          {/* Project Details Modal for Non-Creators */}
          <Modal
            visible={projectDetailsModalVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={closeProjectDetailsModal}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.projectDetailsModalContainer}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Project Details</Text>
                  <TouchableOpacity onPress={closeProjectDetailsModal}>
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                
                <ScrollView 
                  style={styles.projectDetailsContent}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedProject && (
                    <>
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Project Title:</Text>
                        <Text style={styles.detailFormValue} numberOfLines={2}>
                          {selectedProject.title || 'N/A'}
                        </Text>
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>About Project:</Text>
                        <Text style={styles.detailFormValue} numberOfLines={10}>
                          {selectedProject.about || 'N/A'}
                        </Text>
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Technologies:</Text>
                        <Text style={styles.detailFormValue} numberOfLines={3}>
                          {selectedProject.tech || 'N/A'}
                        </Text>
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>GitHub Repository:</Text>
                        {selectedProject.githubRepo ? (
                          <Text style={styles.detailFormValueLink} numberOfLines={1}>
                            {selectedProject.githubRepo}
                          </Text>
                        ) : (
                          <Text style={styles.detailFormValue}>N/A</Text>
                        )}
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Status:</Text>
                        <View style={styles.statusTagContainer}>
                          {selectedProject.status === 'completed' && (
                            <View style={styles.statusTagCompleted}>
                              <Text style={styles.statusTagTextCompleted}>Completed</Text>
                            </View>
                          )}
                          {selectedProject.status !== 'completed' && selectedProject.status !== 'pending' && (
                            <View style={styles.statusTagOngoing}>
                              <Text style={styles.statusTagTextOngoing}>Ongoing</Text>
                            </View>
                          )}
                          {selectedProject.status === 'pending' && (
                            <View style={styles.statusTagPending}>
                              <Text style={styles.statusTagTextPending}>Pending</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Created By:</Text>
                        <Text style={styles.detailFormValue}>
                          {selectedProject.creatorUsername || 'Unknown'}
                        </Text>
                      </View>
                      
                      {selectedProject.createdAt && (
                        <View style={styles.detailFormRow}>
                          <Text style={styles.detailFormLabel}>Created At:</Text>
                          <Text style={styles.detailFormValue}>
                            {selectedProject.createdAt.toDate 
                              ? new Date(selectedProject.createdAt.toDate()).toLocaleDateString()
                              : 'N/A'}
                          </Text>
                        </View>
                      )}
                      
                      <View style={styles.participantsSection}>
                        <Text style={styles.participantsSectionTitle}>Active Participants</Text>
                        {loadingParticipants ? (
                          <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                        ) : projectParticipants.length === 0 ? (
                          <Text style={styles.noParticipantsText}>No participants found</Text>
                        ) : (
                          <View style={styles.participantsList}>
                            {projectParticipants.map((participant) => (
                              <View key={participant.id} style={styles.participantItem}>
                                <Image 
                                  source={{ uri: participant.avatar }} 
                                  style={styles.participantAvatar} 
                                />
                                <View style={styles.participantInfo}>
                                  <View style={styles.participantNameRow}>
                                    <Text style={styles.participantName}>{participant.username}</Text>
                                    {participant.isCreator && (
                                      <View style={styles.creatorBadge}>
                                        <Icon name="star" size={14} color="#FFD700" />
                                        <Text style={styles.creatorBadgeText}>Creator</Text>
                                      </View>
                                    )}
                                  </View>
                                  <Text style={styles.participantEmail}>{participant.email}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
          
          {/* Editable Project Details Modal for Creators */}
          <Modal
            visible={projectEditModalVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={closeProjectEditModal}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.projectDetailsModalContainer}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Project</Text>
                  <TouchableOpacity onPress={closeProjectEditModal}>
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                
                <ScrollView 
                  style={styles.projectDetailsContent}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedProject && (
                    <>
                      <View style={styles.inputSection}>
                        <Text style={styles.inputLabel}>Project Title *</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Enter project title"
                          placeholderTextColor="#666"
                          value={editProjectTitle}
                          onChangeText={setEditProjectTitle}
                          maxLength={100}
                        />
                      </View>

                      <View style={styles.inputSection}>
                        <Text style={styles.inputLabel}>About Project *</Text>
                        <TextInput
                          style={[styles.input, styles.textArea]}
                          placeholder="Describe your project..."
                          placeholderTextColor="#666"
                          value={editProjectAbout}
                          onChangeText={setEditProjectAbout}
                          multiline
                          numberOfLines={4}
                          maxLength={500}
                        />
                      </View>

                      <View style={styles.inputSection}>
                        <Text style={styles.inputLabel}>Technologies</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g., React Native, Firebase, Node.js"
                          placeholderTextColor="#666"
                          value={editProjectTech}
                          onChangeText={setEditProjectTech}
                          maxLength={200}
                        />
                      </View>

                      <View style={styles.inputSection}>
                        <Text style={styles.inputLabel}>GitHub Repository</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="https://github.com/username/repo"
                          placeholderTextColor="#666"
                          value={editGithubRepo}
                          onChangeText={setEditGithubRepo}
                          maxLength={200}
                          autoCapitalize="none"
                        />
                      </View>

                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Status:</Text>
                        <View style={styles.statusTagContainer}>
                          {selectedProject.status === 'completed' && (
                            <View style={styles.statusTagCompleted}>
                              <Text style={styles.statusTagTextCompleted}>Completed</Text>
                            </View>
                          )}
                          {selectedProject.status !== 'completed' && selectedProject.status !== 'pending' && (
                            <View style={styles.statusTagOngoing}>
                              <Text style={styles.statusTagTextOngoing}>Ongoing</Text>
                            </View>
                          )}
                          {selectedProject.status === 'pending' && (
                            <View style={styles.statusTagPending}>
                              <Text style={styles.statusTagTextPending}>Pending</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      
                      <View style={styles.detailFormRow}>
                        <Text style={styles.detailFormLabel}>Created At:</Text>
                        <Text style={styles.detailFormValue}>
                          {selectedProject.createdAt?.toDate 
                            ? new Date(selectedProject.createdAt.toDate()).toLocaleDateString()
                            : 'N/A'}
                        </Text>
                      </View>
                      
                      {selectedProject.status === 'completed' && selectedProject.completedAt && (
                        <View style={styles.detailFormRow}>
                          <Text style={styles.detailFormLabel}>Completed At:</Text>
                          <Text style={styles.detailFormValue}>
                            {selectedProject.completedAt.toDate 
                              ? new Date(selectedProject.completedAt.toDate()).toLocaleDateString()
                              : 'N/A'}
                          </Text>
                        </View>
                      )}
                      
                      <View style={styles.participantsSection}>
                        <Text style={styles.participantsSectionTitle}>Active Participants</Text>
                        {loadingParticipants ? (
                          <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                        ) : projectParticipants.length === 0 ? (
                          <Text style={styles.noParticipantsText}>No participants found</Text>
                        ) : (
                          <View style={styles.participantsList}>
                            {projectParticipants.map((participant) => (
                              <View key={participant.id} style={styles.participantItem}>
                                <Image 
                                  source={{ uri: participant.avatar }} 
                                  style={styles.participantAvatar} 
                                />
                                <View style={styles.participantInfo}>
                                  <View style={styles.participantNameRow}>
                                    <Text style={styles.participantName}>{participant.username}</Text>
                                    {participant.isCreator && (
                                      <View style={styles.creatorBadge}>
                                        <Icon name="star" size={14} color="#FFD700" />
                                        <Text style={styles.creatorBadgeText}>Creator</Text>
                                      </View>
                                    )}
                                  </View>
                                  <Text style={styles.participantEmail}>{participant.email}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>

                      <View style={styles.editProjectActions}>
                        <TouchableOpacity
                          style={[styles.saveButton, updatingProject && styles.disabledButton]}
                          onPress={updateProject}
                          disabled={updatingProject}
                        >
                          <Text style={styles.saveButtonText}>
                            {updatingProject ? 'Saving...' : 'Save Changes'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </ScrollView>
                
                {updatingProject && (
                  <View style={styles.uploadingContainer}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={styles.uploadingText}>Updating project...</Text>
                  </View>
                )}
              </View>
            </View>
          </Modal>
        </View>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ color: 'white', marginTop: 10 }}>Loading profile...</Text>
      </View>
    );
  }

  if (!userData && !userProfile && !isOwnProfile) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: 'white' }}>User not found</Text>
        <TouchableOpacity
          style={{ marginTop: 20, backgroundColor: '#007AFF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 5 }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ color: 'white' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" />

      {/* Title Bar */}
      <View style={styles.titleBar}>
        <View style={styles.sidebutton}>
          {!isOwnProfile ? (
            <TouchableOpacity
              onPress={() => navigation.navigate('Profile', { userId: currentUser.uid })}
              style={styles.backButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
        </View>

        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>Profile</Text>
        </View>

        <View style={styles.sidebutton}>
          {isOwnProfile ? (
            <>
              <TouchableOpacity onPress={selectImage} style={styles.headerButton}>
                <Icon name="add" size={24} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('Settings')} style={styles.headerButton}>
                <Icon name="settings-outline" size={24} color="white" />
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      </View>

      <ScrollView style={styles.Container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleAvatarChange} disabled={!isOwnProfile}>
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          </TouchableOpacity>

          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{formatNumber(userProfile?.postsCount || 0)}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{formatNumber(userProfile?.followersCount || 0)}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{formatNumber(userProfile?.followingCount || 0)}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.bio}>{userProfile?.bio || 'No bio available.'}</Text>
          <Text style={styles.meta}> {userProfile?.website || null}</Text>
        </View>

        {!isOwnProfile && (
          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={[styles.button, isFollowing ? styles.following : styles.follow]}
              onPress={handleFollowPress}
            >
              <Text style={[styles.buttonText, isFollowing ? styles.textDark : styles.textLight]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.buttonSecondary} onPress={() => Alert.alert('Message feature to be implemented')}>
              <Text style={styles.textDark}>Message</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'posts' && styles.activeTab]}
            onPress={() => setActiveTab('posts')}
          >
            <Icon name="grid-outline" size={20} color={activeTab === 'posts' ? '#007AFF' : '#666'} />
            <Text style={[styles.tabText, activeTab === 'posts' && styles.activeTabText]}>Posts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'questions' && styles.activeTab]}
            onPress={() => setActiveTab('questions')}
          >
            <Icon name="help-circle-outline" size={20} color={activeTab === 'questions' ? '#007AFF' : '#666'} />
            <Text style={[styles.tabText, activeTab === 'questions' && styles.activeTabText]}>Questions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'Collaborations' && styles.activeTab]}
            onPress={() => setActiveTab('Collaborations')}
          >
            <Icon name="checkmark-circle-outline" size={20} color={activeTab === 'Collaborations' ? '#007AFF' : '#666'} />
            <Text style={[styles.tabText, activeTab === 'Collaborations' && styles.activeTabText]}>Collaborations</Text>
          </TouchableOpacity>
          
        </View>

        {renderTabContent()}
      </ScrollView>

      {/* Upload Post Modal */}
      {isOwnProfile && (
        <Modal
          visible={uploadModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setUploadModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setUploadModalVisible(false)}>
                  <Icon name="close" size={24} color="white" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>New Post</Text>
                <TouchableOpacity onPress={uploadPost} disabled={uploading}>
                  <Text style={[styles.shareButton, uploading && styles.disabledButton]}>
                    {uploading ? 'Posting...' : 'Share'}
                  </Text>
                </TouchableOpacity>
              </View>
              {selectedImage && (
                <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
              )}
              <TextInput
                style={styles.captionInput}
                placeholder="Write a caption..."
                placeholderTextColor="#666"
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={500}
              />
              {uploading && (
                <View style={styles.uploadingContainer}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.uploadingText}>Uploading your post...</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Collaboration Modal */}
      <Modal
        visible={collaborationModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={closeCollaborationModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.collaborationModalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeCollaborationModal}>
                <Icon name="close" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Create Project</Text>
              <TouchableOpacity onPress={createCollaborationProject} disabled={creatingProject}>
                <Text style={[styles.shareButton, creatingProject && styles.disabledButton]}>
                  {creatingProject ? 'Creating...' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.collaborationContent} showsVerticalScrollIndicator={false}>
              {/* Project Details Section */}
              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Project Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter project title"
                  placeholderTextColor="#666"
                  value={projectTitle}
                  onChangeText={setProjectTitle}
                  maxLength={100}
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>About Project *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe your project..."
                  placeholderTextColor="#666"
                  value={projectAbout}
                  onChangeText={setProjectAbout}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Technologies</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., React Native, Firebase, Node.js"
                  placeholderTextColor="#666"
                  value={projectTech}
                  onChangeText={setProjectTech}
                  maxLength={200}
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>GitHub Repository</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://github.com/username/repo"
                  placeholderTextColor="#666"
                  value={githubRepo}
                  onChangeText={setGithubRepo}
                  maxLength={200}
                  autoCapitalize="none"
                />
              </View>

              {/* Collaborators Section */}
              <View style={styles.collaboratorsSection}>
                <Text style={styles.sectionTitle}>Invite Collaborators</Text>
                <Text style={styles.sectionNote}>
                  💡 You can only invite users you follow
                </Text>

                {/* Search Bar */}
                <View style={styles.searchContainer}>
                  <Icon name="search-outline" size={20} color="#666" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search users you follow..."
                    placeholderTextColor="#666"
                    value={searchQuery}
                    onChangeText={handleSearchUsers}
                  />
                </View>

                {/* User List */}
                {loadingFollowing ? (
                  <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                ) : filteredUsers.length === 0 ? (
                  <View style={styles.emptyUserList}>
                    <Icon name="people-outline" size={48} color="#666" />
                    <Text style={styles.emptyUserText}>
                      {followingUsers.length === 0 
                        ? "You're not following anyone yet" 
                        : "No users found"}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.userList}>
                    {filteredUsers.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.userItem}
                        onPress={() => toggleCollaborator(item.id)}
                      >
                        <Image source={{ uri: item.avatar }} style={styles.userAvatar} />
                        <View style={styles.userInfo}>
                          <Text style={styles.userName}>{item.username}</Text>
                          <Text style={styles.userEmail}>{item.email}</Text>
                        </View>
                        <View style={[
                          styles.checkbox,
                          selectedCollaborators.includes(item.id) && styles.checkboxSelected
                        ]}>
                          {selectedCollaborators.includes(item.id) && (
                            <Icon name="checkmark" size={16} color="white" />
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {selectedCollaborators.length > 0 && (
                  <View style={styles.selectedCount}>
                    <Text style={styles.selectedCountText}>
                      {selectedCollaborators.length} collaborator{selectedCollaborators.length > 1 ? 's' : ''} selected
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {creatingProject && (
              <View style={styles.uploadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.uploadingText}>Creating project...</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#1e1e1e' 
  },
  statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },
  titleBar: { 
    height: 80, 
    backgroundColor: '#1e1e1e', 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: 10, 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee',
    paddingTop: getStatusBarHeight()
  },
  backButton: {
    position: 'absolute', 
    left: 5 
  },
  sidebutton: {
    width: 70, 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  backButtonPlaceholder: {
    width: 40 
  },
  titleContainer: {
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  titleText: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: 'white' 
  },
  headerButton: { 
    marginRight: 15 
  },
  Container: {
    flex: 1, 
    backgroundColor: '#1e1e1e', 
    paddingHorizontal: 16, 
    paddingTop: 16 
  },
  header: {
    flexDirection: 'row', 
    marginBottom: 16, 
    alignItems: 'center' 
  },
  avatar: {
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    marginRight: 16 
  },
  statsContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    flex: 1 
  },
  statBox: { 
    alignItems: 'center' 
  },
  statNumber: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: 'white' 
  },
  statLabel: {
    fontSize: 12, 
    color: '#ccc' 
  },
  infoSection: {
    marginBottom: 20 
  },
  displayName: { 
    fontSize: 18, 
    fontWeight: '600', 
    color: 'white' 
  },
  bio: {
    fontSize: 14, 
    marginVertical: 8, 
    color: '#ccc' 
  },
  meta: {
    fontSize: 12, 
    color: '#ccc', 
    marginBottom: 2 
  },
  buttonsContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    gap: 10, 
    marginBottom: 20 
  },
  button: { 
    flex: 1, 
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center' 
  },
  follow: { 
    backgroundColor: '#007AFF' 
  },
  following: { 
    backgroundColor: '#333', 
    borderWidth: 1, 
    borderColor: '#555' 
  },
  buttonSecondary: { 
    flex: 1, 
    backgroundColor: '#333', 
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center' 
  },
  buttonText: { 
    fontWeight: '600' 
  },
  textLight: { 
    color: '#fff' 
  },
  textDark: { 
    color: '#fff' 
  },
  tabContainer: { 
    flexDirection: 'row', 
    borderBottomWidth: 1, 
    borderBottomColor: '#333', 
    marginBottom: 20 
  },
  tab: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 12 
  },
  activeTab: { 
    borderBottomWidth: 2, 
    borderBottomColor: '#007AFF' 
  },
  tabText: { 
    marginLeft: 8, 
    color: '#666', 
    fontSize: 14 
  },
  activeTabText: { 
    color: '#007AFF', 
    fontWeight: '600' 
  },
  tabContent: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 40 
  },
  collaborationTabContent: {
    flex: 1,
    width: '100%',
  },
  collaborationHeader: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectStatsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#555',
  },
  projectStatsButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  createProjectButtonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createProjectButtonTextTop: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  projectStatsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 24,
  },
  projectStatBox: {
    alignItems: 'center',
  },
  projectStatNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  projectStatLabel: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 4,
  },
  projectsScrollView: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 16,
  },
  statusTagCompleted: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusTagOngoing: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusTagPending: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusTagTextCompleted: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  statusTagTextOngoing: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  statusTagTextPending: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  gridContainer: {
    paddingBottom: 20,
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    width: '100%',
  },
  gridItem: {
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#222',
    width: (width - 16 * 2 - 8 * (3 - 1)) / 3,
    height: (width - 16 * 2 - 8 * (3 - 1)) / 3,
  },
  gridImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  emptyText: { 
    color: 'white', 
    fontSize: 18, 
    fontWeight: '600', 
    marginTop: 16 
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  uploadButton: { 
    backgroundColor: '#007AFF', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 8,
    marginTop: 16
  },
  uploadButtonText: { 
    color: 'white', 
    fontWeight: '600' 
  },
  askQuestionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  askQuestionButtonText: {
    color: 'black',
    fontWeight: '600',
    fontSize: 16,
  },
  questionsContainer: {
    flex: 1,
    width: '100%',
  },
  questionCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  questionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
    lineHeight: 22,
  },
  questionDescription: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    marginBottom: 12,
  },
  questionMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  statText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  questionDate: {
    fontSize: 12,
    color: '#666',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginTop: 4,
  },
  tagText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '500',
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.9)', 
    justifyContent: 'flex-end' 
  },
  modalContainer: { 
    backgroundColor: '#1e1e1e', 
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    maxHeight: '80%' 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 16, 
    borderBottomWidth: 1, 
    borderBottomColor: '#333' 
  },
  modalTitle: { 
    color: 'white', 
    fontSize: 18, 
    fontWeight: '600' 
  },
  shareButton: { 
    color: '#007AFF', 
    fontSize: 16, 
    fontWeight: '600' 
  },
  disabledButton: { 
    color: '#666' 
  },
  previewImage: { 
    width: '100%', 
    height: 300, 
    backgroundColor: '#333' 
  },
  captionInput: { 
    color: 'white', 
    fontSize: 16, 
    padding: 16, 
    minHeight: 100, 
    textAlignVertical: 'top' 
  },
  uploadingContainer: { 
    alignItems: 'center', 
    padding: 20 
  },
  uploadingText: { 
    color: '#666', 
    marginTop: 10 
  },
  privateAccountContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  privateAccountTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
    marginTop: 20,
    marginBottom: 12,
  },
  privateAccountText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  deleteButton: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    alignSelf: 'flex-start',
  },
  questionTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  questionsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  askCollaborationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  askCollaborationButtonText: {
    color: 'black',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  // Collaboration Modal Styles
  collaborationModalContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    height: '90%',
  },
  collaborationContent: {
    flex: 1,
    padding: 16,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  collaboratorsSection: {
    marginTop: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionNote: {
    color: '#999',
    fontSize: 12,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    paddingVertical: 12,
  },
  userList: {
    maxHeight: 300,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  userEmail: {
    color: '#999',
    fontSize: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  emptyUserList: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyUserText: {
    color: '#999',
    fontSize: 14,
    marginTop: 12,
  },
  selectedCount: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'center',
    marginTop: 12,
  },
  selectedCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  projectsList: {
  flex: 1,
  padding: 16,
},
projectCard: {
  backgroundColor: '#2a2a2a',
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
  borderWidth: 1,
  borderColor: '#333',
},
cardHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
},
cardTitle: {
  fontSize: 18,
  fontWeight: 'bold',
  color: 'white',
  flex: 1,
},
cardAbout: {
  fontSize: 14,
  color: '#ccc',
  marginBottom: 8,
  lineHeight: 20,
},
cardTech: {
  fontSize: 12,
  color: '#007AFF',
  marginBottom: 8,
},
cardFooter: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 8,
  paddingTop: 8,
  borderTopWidth: 1,
  borderTopColor: '#f0f0f0',
},
collaboratorCount: {
  fontSize: 12,
  color: '#666',
  marginLeft: 4,
},
roleContainer: {
  marginTop: 8,
  flexDirection: 'row',
  alignItems: 'center',
},
roleTagCreator: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: 'rgba(255, 215, 0, 0.2)',
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#FFD700',
},
roleTextCreator: {
  color: '#FFD700',
  fontSize: 11,
  fontWeight: '600',
  marginLeft: 4,
},
roleTagParticipant: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: 'rgba(0, 122, 255, 0.2)',
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#007AFF',
},
  roleTextParticipant: {
    color: '#007AFF',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  projectStatsModalContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 20,
  },
  statsFormContainer: {
    padding: 20,
  },
  statsFormRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statsFormLabel: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '500',
  },
  statsFormValue: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  projectDetailsModalContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    height: '90%',
  },
  projectDetailsContent: {
    flex: 1,
    padding: 20,
  },
  detailFormRow: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  detailFormLabel: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailFormValue: {
    color: 'white',
    fontSize: 16,
    lineHeight: 24,
  },
  detailFormValueLink: {
    color: '#007AFF',
    fontSize: 16,
    lineHeight: 24,
  },
  statusTagContainer: {
    marginTop: 4,
  },
  participantsSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 2,
    borderTopColor: '#333',
  },
  participantsSectionTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  participantsList: {
    // gap property handled by marginBottom in participantItem
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  participantAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  participantInfo: {
    flex: 1,
  },
  participantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  participantName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  creatorBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  participantEmail: {
    color: '#999',
    fontSize: 12,
  },
  noParticipantsText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  editProjectActions: {
    marginTop: 24,
    marginBottom: 20,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default Profile;