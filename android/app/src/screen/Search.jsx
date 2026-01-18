import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, Text, View, FlatList, ActivityIndicator, TextInput, 
  TouchableOpacity, Alert, Image, StatusBar, Platform, Linking
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from '../users'; 

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const getInitials = (item) => {
  const name = item.name || item.username || 'U';
  return name.charAt(0).toUpperCase();
};

const Search = () => {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [suggestedAccounts, setSuggestedAccounts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [suggestedProjects, setSuggestedProjects] = useState([]);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [requestsCount, setRequestsCount] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [activeTab, setActiveTab] = useState('Users'); // Default to Users when searching

  const navigation = useNavigation();
  const currentUserUid = auth().currentUser.uid;

  const {
    getCachedImageUri,
  } = useUserData();

  useEffect(() => {
    const unsubscribe = firestore()
      .collection('profile')
      .doc(currentUserUid)
      .collection('followRequests')
      .onSnapshot(snapshot => {
        setRequestsCount(snapshot.docs.length);
      });

    return unsubscribe;
  }, [currentUserUid]);

  useEffect(() => {
    const unsubscribe = firestore()
      .collection('profile')
      .doc(currentUserUid)
      .collection('searchSuggestions')
      .orderBy('lastUsedAt', 'desc')
      .limit(20)
      .onSnapshot(
        snapshot => {
          const list = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
          setSuggestedAccounts(list);
        },
        () => {
          // Ignore errors
        }
      );

    return unsubscribe;
  }, [currentUserUid]);
   
  useEffect(() => {
    const unsubscribe = firestore()
      .collection('profile')
      .doc(currentUserUid)
      .collection('projectSuggestions')
      .orderBy('lastUsedAt', 'desc')
      .limit(20)
      .onSnapshot(
        snapshot => {
          const list = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
          setSuggestedProjects(list);
        },
        () => {
          // Ignore errors
        }
      );

    return unsubscribe;
  }, [currentUserUid]);

  // ✅ Load trends on mount (always visible)
  useEffect(() => {
    loadTrends();
  }, []);

  const loadTrends = async () => {
    setLoading(true);
    try {
      const fetchTrendsFunction = functions().httpsCallable('fetchTrends');
      const result = await fetchTrendsFunction({
        language: 'javascript',
        tag: 'react'
      });

      console.log('✅ Trends loaded:', result.data);

      const allTrends = [
        ...(result.data.github || []),
        ...(result.data.hackerNews || []),
        ...(result.data.devto || [])
      ];

      const shuffled = shuffleArray(allTrends);
      setTrends(shuffled.slice(0, 50));
    } catch (err) {
      console.error('❌ Error loading trends:', err);
      Alert.alert('Error', 'Could not load trends. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const searchUsers = async (text) => {
    if (text.trim().length === 0) {
      setUsers([]);
      return;
    }
    
    if (text.trim().length < 3) {
      setUsers([]);
      return;
    }

    setLoading(true);
    try {
      let querySnapshot = await firestore()
        .collection('profile')
        .orderBy('username')
        .startAt(text.toLowerCase())
        .endAt(text.toLowerCase() + '\uf8ff')
        .limit(20)
        .get();

      let usersList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (usersList.length === 0) {
        const allUsersSnapshot = await firestore()
          .collection('profile')
          .limit(100)
          .get();

        const allUsers = allUsersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        usersList = allUsers.filter(user => {
          const username = (user.username || '').toLowerCase();
          const name = (user.name || '').toLowerCase();
          const searchLower = text.toLowerCase();
          
          return username.includes(searchLower) || name.includes(searchLower);
        });
      }

      const filteredUsers = usersList.filter(user => user.id !== currentUserUid);
      setUsers(filteredUsers);
    } catch (err) {
      Alert.alert('Search Error', 'Could not search users. Please try again.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const searchproject = async (text) => {
    if (text.trim().length === 0) {
      setProjects([]);
      return;
    }
    if (text.trim().length < 3) {
      setProjects([]);
      return;
    }

    setLoading(true);
    try {
      let querySnapshot = await firestore()
        .collection('collaborations')
        .orderBy('title')
        .startAt(text.toLowerCase())
        .endAt(text.toLowerCase() + '\uf8ff')
        .limit(20)
        .get();

      let projectsList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (projectsList.length === 0) {
        const allProjectsSnapshot = await firestore()
          .collection('collaborations')
          .limit(100)
          .get();

        const allProjects = allProjectsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        projectsList = allProjects.filter(project => {
          const title = (project.title || '').toLowerCase();
          const description = (project.description || '').toLowerCase();
          const searchLower = text.toLowerCase();
          
          return title.includes(searchLower) || description.includes(searchLower);
        });
      }
      setProjects(projectsList);
    } catch (err) {
      Alert.alert('Search Error', 'Could not search projects. Please try again.');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (text) => {
    setSearch(text);

    if (activeTab === 'Users') {
      searchUsers(text);
    } else if (activeTab === 'Projects') {
      searchproject(text);
    }
  };

  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    
    if (search.trim().length >= 3) {
      if (tab === 'Users') {
        searchUsers(search);
      } else if (tab === 'Projects') {
        searchproject(search);
      }
    }
  };

  const handleCancelSearch = () => {
    setSearch('');
    setUsers([]);
    setProjects([]);
    setSearchActive(false);
  };

  const saveSuggestion = async (user) => {
    try {
      if (!user?.id) return;

      await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('searchSuggestions')
        .doc(user.id)
        .set(
          {
            username: user.username || user.name || '',
            name: user.name || '',
            avatar: user.avatar || user.photoURL || null,
            lastUsedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    } catch (e) {
      // Silently ignore
    }
  };

  const saveprojectSuggestion = async (project) => {
    try {
      if (!project?.id) return;

      await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('projectSuggestions')
        .doc(project.id)
        .set(
          {
            title: project.title || '',
            description: project.description || '',
            image: project.image || null,
            lastUsedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    } catch (e) {
      // Silently ignore
    }
  };

  const handleRemoveSuggestion = async (userId) => {
    try {
      await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('searchSuggestions')
        .doc(userId)
        .delete();
    } catch (e) {
      // Ignore
    }
  };

  const handleRemoveProjectSuggestion = async (projectId) => {
    try {
      await firestore()
        .collection('profile')
        .doc(currentUserUid)
        .collection('projectSuggestions')
        .doc(projectId)
        .delete();
    } catch (e) {
      // Ignore
    }
  };

  const onUserPress = async (user) => {
    await saveSuggestion(user);

    const userId = user.id;
    const username = user.username;

    navigation.navigate('Profile', {
      screen: 'Profile',
      params: { userId: userId, username: username }
    });
  };

  const onProjectPress = async (project) => {
    await saveprojectSuggestion(project);

    navigation.navigate('ProjectDetails', {
      projectId: project.id,
      title: project.title
    });
  };

const linknormalization=(url)=>{
  if(!url) return null;

  if(url.startsWith('http://')||url.startsWith('https://')){
    return url;
  }

  return `https://${url}`
}

  const onTrendPress = async (trend) => {

    try{
      const url=linknormalization(trend.url);

      if(!url){
        Alert.alert('Invalid URL', 'The trend item does not have a valid URL.');
        return;
      }
      await Linking.openURL(url);

    }catch(error){
      Alert.alert('Error', 'Failed to open this link');
    }
  }

  const getSourceBadgeColor = (source) => {
    const colors = {
      'GitHub': '#24292e',
      'Hacker News': '#ff6600',
      'Dev.to': '#0a0a0a',
    };
    return colors[source] || '#666';
  };

  const getSourceIcon = (source) => {
    const icons = {
      'GitHub': 'logo-github',
      'Hacker News': 'newspaper',
      'Dev.to': 'code-slash',
    };
    return icons[source] || 'trending-up';
  };

  const getTimeAgo = (timestamp) => {
    const now = new Date();
    const diff = now - new Date(timestamp);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const renderSearchBar = (showCancel = false) => (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={20} color="white" style={{ marginRight: 8 }} />

      <TextInput
        style={styles.input}
        placeholder="Search users and projects..."
        value={search}
        onChangeText={handleSearch}
        onFocus={() => setSearchActive(true)}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        placeholderTextColor="white"
        autoFocus={searchActive}
      />

      <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ marginLeft: 8 }}>
        <Ionicons
          name={requestsCount > 0 ? 'notifications' : 'notifications-outline'}
          size={24}
          color={requestsCount > 0 ? "#e67e22" : "white"}
        />
        {requestsCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{requestsCount > 99 ? '99+' : requestsCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {showCancel && (
        <TouchableOpacity onPress={handleCancelSearch} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ✅ Only show tabs when search is active
  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'Users' && styles.activeTab]}
        onPress={() => handleTabSwitch('Users')}
      >
        <Text style={[styles.tabText, activeTab === 'Users' && styles.activeTabText]}>Users</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tab, activeTab === 'Projects' && styles.activeTab]}
        onPress={() => handleTabSwitch('Projects')}
      >
        <Text style={[styles.tabText, activeTab === 'Projects' && styles.activeTabText]}>Projects</Text>
      </TouchableOpacity>
    </View>
  );

  const renderUserResult = (item) => (
    <TouchableOpacity
      onPress={() => onUserPress(item)}
      style={styles.resultItem}
    >
      <View style={styles.avatarPlaceholder}>
        {item.avatar || item.photoURL ? (
          <Image
            source={{ uri: getCachedImageUri(item.avatar || item.photoURL) }}
            style={styles.avatarImage}
          />
        ) : (
          <Text style={styles.avatarText}>
            {getInitials(item)}
          </Text>
        )}
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.resultText}>{item.username || item.name}</Text>
        <Text style={styles.resultSubText}>{item.name}</Text>
      </View>
      {search.trim().length < 3 && (
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            handleRemoveSuggestion(item.id);
          }}
          style={styles.removeSuggestionButton}
        >
          <Ionicons name="close" size={18} color="#ccc" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>   
  );

  const renderProjectResult = (item) => (
    <TouchableOpacity
      onPress={() => onProjectPress(item)}
      style={styles.resultItem}
    >
      <View style={styles.avatarPlaceholder}>
        {item.image ? (
          <Image 
            source={{ uri: getCachedImageUri(item.image) }} 
            style={styles.avatarImage}
          />
        ) : (
          <Ionicons name="folder" size={24} color="white" />
        )}
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.resultText}>{item.title}</Text>
        <Text style={styles.resultSubText} numberOfLines={1}>{item.description}</Text>
      </View>
      {search.trim().length < 3 && (
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            handleRemoveProjectSuggestion(item.id);
          }}
          style={styles.removeSuggestionButton}
        >
          <Ionicons name="close" size={18} color="#ccc" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderTrendResult = (item) => (
    <TouchableOpacity
      onPress={() => onTrendPress(item)}
      style={styles.trendItem}
    >
      <View style={[styles.sourceBadge, { backgroundColor: getSourceBadgeColor(item.source) }]}>
        <Ionicons name={getSourceIcon(item.source)} size={16} color="white" />
        <Text style={styles.sourceBadgeText}>{item.source}</Text>
      </View>

      <Text style={styles.trendTitle} numberOfLines={3}>
        {item.title}
      </Text>
    
      {item.description && (
        <Text style={styles.trendDescription} numberOfLines={2}>
          {item.description}
        </Text>
      )}

      <View style={styles.trendMetadata}>
        {item.author && (
          <Text style={styles.metadataText}>👤 {item.author}</Text>
        )}
        {item.language && (
          <Text style={styles.metadataText}>💻 {item.language}</Text>
        )}
        {item.stars !== undefined && (
          <Text style={styles.metadataText}>⭐ {item.stars.toLocaleString()}</Text>
        )}
        {item.score !== undefined && (
          <Text style={styles.metadataText}>▲ {item.score}</Text>
        )}
        {item.reactions !== undefined && (
          <Text style={styles.metadataText}>❤️ {item.reactions}</Text>
        )}
        {item.comments > 0 && (
          <Text style={styles.metadataText}>💬 {item.comments}</Text>
        )}
      </View>

      <Text style={styles.trendTimestamp}>{getTimeAgo(item.timestamp)}</Text>
    </TouchableOpacity>
  );

  // ✅ Show trends by default, search results when active
  const renderContent = () => {
    // If search is NOT active, show trends
    if (!searchActive) {
      return (
        <>
          {loading && <ActivityIndicator style={{ margin: 10 }} color="#ff6d1f" />}
          
          <FlatList
            data={trends}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderTrendResult(item)}
            ListEmptyComponent={() =>
              !loading && (
                <View style={styles.emptyState}>
                  <Ionicons name="trending-up" size={64} color="#ccc" />
                  <Text style={styles.emptyStateText}>
                    No trends available at the moment.
                  </Text>
                </View>
              )
            }
            showsVerticalScrollIndicator={false}
            scrollEnabled={true}
          />
        </>
      );
    }

    // If search IS active, show tabs and search results
    let data = [];
    let emptyMessage = '';
    let renderItem = null;

    if (activeTab === 'Users') {
      data = search.trim().length >= 3 ? users : suggestedAccounts;
      emptyMessage = 'No users found.';
      renderItem = renderUserResult;
    } else if (activeTab === 'Projects') {
      data = search.trim().length >= 3 ? projects : suggestedProjects;
      emptyMessage = 'No projects found.';
      renderItem = renderProjectResult;
    }

    return (
      <>
        {loading && <ActivityIndicator style={{ margin: 10 }} color="#ff6d1f" />}

        <FlatList
          key={`${activeTab}-${search}`}
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderItem(item)}
          ListEmptyComponent={() =>
            !loading && (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={64} color="#ccc" />
                <Text style={styles.emptyStateText}>
                  {activeTab === 'Users' 
                    ? 'Search for users to connect with.' 
                    : 'Search for projects to explore.'}
                </Text>
              </View>
            )
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
        />
      </>
    );
  };

  return (
    <View style={styles.container}>
      {searchActive ? (
        <View style={styles.overlay}>
          <View style={styles.statusBarSpacer} />
          {renderSearchBar(true)}
          {renderTabs()}
          {renderContent()}
        </View>
      ) : (
        <>
          <View style={styles.statusBarSpacer} />
          {renderSearchBar(false)}
          {renderContent()}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    padding: 16,
  },
  statusBarSpacer: { 
    height: getStatusBarHeight(), 
    backgroundColor: '#1e1e1e' 
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'gray',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 16,
    shadowColor: '#ff6d1f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 5,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    backgroundColor: 'transparent',
    color: 'white',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#2c2c32',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,  
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#1e1e1e',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
  },
  activeTabText: {
    color: '#ff6d1f',
    fontSize: 14,
    fontWeight: '700',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2c2c32',
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#ff6d1f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  trendItem: {
    padding: 16,
    backgroundColor: '#2c2c32',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#ff6d1f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
    gap: 4,
  },
  sourceBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
  },
  trendDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 8,
  },
  trendMetadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  metadataText: {
    fontSize: 12,
    color: '#ccc',
  },
  trendTimestamp: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#404040',
    marginRight: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  resultText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  resultSubText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  noResult: {
    padding: 32,
    color: '#666',
    alignSelf: 'center',
    fontSize: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyStateText: {
    color: '#666',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    right: -6,
    top: -6,
    backgroundColor: '#e74c3c',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1e1e1e',
  },
  badgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
  cancelButton: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  cancelText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1e1e1e',
    padding: 16,
    zIndex: 10,
  },
  removeSuggestionButton: {
    padding: 8,
  },
});

export default Search;