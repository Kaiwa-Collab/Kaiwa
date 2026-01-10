import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, ActivityIndicator } from 'react-native';
import React, { useState, useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from '../users';
import EmptydP from '../screen/Emptydp';

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const FollowersFollowing = () => {
  const navigation = useNavigation();
  const currentUserUid = auth().currentUser.uid;
  const { getCachedImageUri } = useUserData();
  
  const [activeTab, setActiveTab] = useState('followers'); // 'followers' or 'following'
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);

  // Helper function to get initials
  const getInitials = (user) => {
    const name = user.name || user.displayName || user.username || 'U';
    return name.charAt(0).toUpperCase();
  };

  // Fetch followers
  const fetchFollowers = async () => {
    try {
      setLoading(true);
      const followersSnapshot = await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('followers')
        .get();

      const followerIds = followersSnapshot.docs.map(doc => doc.id);
      
      if (followerIds.length === 0) {
        setFollowers([]);
        setLoading(false);
        return;
      }

      // Fetch user details for each follower
      const followersData = await Promise.all(
        followerIds.map(async (userId) => {
          try {
            const profileDoc = await firestore()
              .collection('profile')
              .doc(userId)
              .get();
            
            if (profileDoc.exists) {
              const data = profileDoc.data();
              return {
                id: userId,
                name: data.name || data.displayName || 'Unknown User',
                username: data.username || '',
                avatar: data.avatar || data.photoURL || null,
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        })
      );

      setFollowers(followersData.filter(user => user !== null));
    } catch (error) {
      setFollowers([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch following
  const fetchFollowing = async () => {
    try {
      setLoading(true);
      const followingSnapshot = await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('following')
        .get();

      const followingIds = followingSnapshot.docs.map(doc => doc.id);
      
      if (followingIds.length === 0) {
        setFollowing([]);
        setLoading(false);
        return;
      }

      // Fetch user details for each following
      const followingData = await Promise.all(
        followingIds.map(async (userId) => {
          try {
            const profileDoc = await firestore()
              .collection('profile')
              .doc(userId)
              .get();
            
            if (profileDoc.exists) {
              const data = profileDoc.data();
              return {
                id: userId,
                name: data.name || data.displayName || 'Unknown User',
                username: data.username || '',
                avatar: data.avatar || data.photoURL || null,
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        })
      );

      setFollowing(followingData.filter(user => user !== null));
    } catch (error) {
      setFollowing([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFollowers();
    fetchFollowing();
  }, []);

  // Handle user press - navigate to Profile
  const handleUserPress = (user) => {
    navigation.navigate('Profile', {
      screen: 'Profile',
      params: { 
        userId: user.id, 
        username: user.username 
      }
    });
  };

  // Render user item
  const renderUserItem = ({ item }) => (
    <TouchableOpacity
      onPress={() => handleUserPress(item)}
      style={styles.userItem}
    >
      <View style={styles.avatarContainer}>
        {item.avatar ? (
          <Image 
            source={{ uri: getCachedImageUri(item.avatar) }} 
            style={styles.avatarImage}
          />
        ) : (
          <EmptydP 
            size={50} 
            initials={getInitials(item)} 
          />
        )}
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name}</Text>
        {item.username && (
          <Text style={styles.userUsername}>@{item.username}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const currentData = activeTab === 'followers' ? followers : following;
  const currentCount = activeTab === 'followers' ? followers.length : following.length;

  return (
    <View style={styles.container}>
      <View style={styles.statusBarSpacer} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Followers & Following</Text>
        </View>
        <View style={styles.headerRightPlaceholder} />
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          onPress={() => setActiveTab('followers')}
          style={[styles.tab, activeTab === 'followers' && styles.activeTab]}
        >
          <Text style={[styles.tabText, activeTab === 'followers' && styles.activeTabText]}>
            Followers ({followers.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('following')}
          style={[styles.tab, activeTab === 'following' && styles.activeTab]}
        >
          <Text style={[styles.tabText, activeTab === 'following' && styles.activeTabText]}>
            Following ({following.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4e9bde" />
        </View>
      ) : currentData.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {activeTab === 'followers' 
              ? 'No followers yet' 
              : 'Not following anyone yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={currentData}
          renderItem={renderUserItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

export default FollowersFollowing;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
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
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerRightPlaceholder: {
    minWidth: 40,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#4e9bde',
  },
  tabText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#4e9bde',
    fontWeight: 'bold',
  },
  listContainer: {
    paddingVertical: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#1e1e1e',
  },
  avatarContainer: {
    marginRight: 15,
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  userUsername: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 16,
  },
});










