import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, Text, View, FlatList, ActivityIndicator, TextInput, 
  TouchableOpacity, Alert, Image, StatusBar, Platform
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from '../users'; 

const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

const getInitials = (item) => {
  const name = item.name || item.username || 'U';
  return name.charAt(0).toUpperCase();
};

const Search = () => {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]); // live search results
  const [suggestedAccounts, setSuggestedAccounts] = useState([]); // user-chosen suggestions (like Instagram recent)
  const [loading, setLoading] = useState(false);
  const [requestsCount, setRequestsCount] = useState(0);
  const [searchActive, setSearchActive] = useState(false); // controls overlay like Instagram

  const navigation = useNavigation();
  const currentUserUid = auth().currentUser.uid;

  const {
    getCachedImageUri,
  } = useUserData();

  useEffect(() => {
    // Real-time listener for follow requests count
    const unsubscribe = firestore()
      .collection('profile')
      .doc(currentUserUid)
      .collection('followRequests')
      .onSnapshot(snapshot => {
        setRequestsCount(snapshot.docs.length);
      });

    return unsubscribe;
  }, [currentUserUid]);

  // Load user-chosen search suggestions (recent accounts user tapped), like Instagram
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
          // Ignore errors for suggestions; search still works
        }
      );

    return unsubscribe;
  }, [currentUserUid]);

  const handleSearch = async (text) => {
    setSearch(text);
    
    if (text.trim().length === 0) {
      // When search is empty, do not clear user suggestions; just clear live results
      setUsers([]);
      return;
    }
    
    if (text.trim().length < 3) {
      setUsers([]);
      
      return;
    }

    setLoading(true);
    try {
      
      
      // First try searching by username
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

      // If still no results, try case-insensitive search
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

      

      // Filter out current user from results
      const filteredUsers = usersList.filter(user => user.id !== currentUserUid);
      
      setUsers(filteredUsers);
    } catch (err) {
      
      Alert.alert('Search Error', 'Could not search users. Please try again.');
      if (text==' ') setUsers([]);
    }finally{
    setLoading(false);
    }
  };

  const handleCancelSearch = () => {
    setSearch('');
    setUsers([]);
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
      // Silently ignore suggestion save errors
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
      // Ignore deletion errors
    }
  };

  const onUserPress = async (user) => {
    // Save to user-chosen suggestions list
    await saveSuggestion(user);

    const userId = user.id;
    const username = user.username;

    navigation.navigate('Profile', {
      screen: 'Profile',
      params: { userId: userId, username: username }
    });
  };

  const renderSearchBar = (showCancel = false) => (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={20} color="white" style={{ marginRight: 8 }} />

      <TextInput
        style={styles.input}
        placeholder="Search Users..."
        value={search}
        onChangeText={handleSearch}
        onClear={()=>setUsers([])}
        onFocus={() => setSearchActive(true)}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        placeholderTextColor="white"
      />

      {/* Bell icon with badge */}
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

  const renderList = () => (
    <>
      {loading && <ActivityIndicator style={{ margin: 10 }} color="#007AFF" />}

      <FlatList
        key={search}
        data={search.trim().length >= 3 ? users : suggestedAccounts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => onUserPress(item)}
            style={styles.resultItem}
          >
            <View style={styles.avatarPlaceholder}>
              {item.avatar || item.photoURL ? (
                <Image 
                  source={{ uri: getCachedImageUri(item.avatar || item.photoURL) }} 
                  style={styles.avatarImage}
                  onError={() => console.log('Error loading avatar for', item.id)}
                />
              ) : (
                <Text style={styles.avatarText}>
                  {getInitials(item)}
                </Text>
              )}
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.resultText}>{item.username || item.name}</Text>
            </View>
            {/* In suggestion mode (search empty/short), allow user to remove suggestion explicitly */}
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
        )}
        ListEmptyComponent={() =>
          !loading && (
            search.trim().length >= 3 ? (
              <Text style={styles.noResult}>No users found.</Text>
            ) : suggestedAccounts.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={64} color="#ccc" />
                <Text style={styles.emptyStateText}>
                  Search for users to connect with. Accounts you view here will appear as suggestions.
                </Text>
              </View>
            ) : null
          )
        }
        showsVerticalScrollIndicator={false}
        extraData={users.length + suggestedAccounts.length} 
      />
    </>
  );

  return (
    <View style={styles.container}>
      {/* When search is active, show overlay covering screen (Instagram-like) */}
      {searchActive ? (
        <View style={styles.overlay}>
          <View style={styles.statusBarSpacer} />
          {renderSearchBar(true)}
          {renderList()}
        </View>
      ) : (
        <>
          <View style={styles.statusBarSpacer} />
          {renderSearchBar(false)}
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
    // borderColor: '#ff6d1f',
    borderWidth: 1,
    // paddingTop: getStatusBarHeight()
  },
  input: {
    flex: 1,
    fontSize: 16,
    backgroundColor: 'transparent',
    color: 'white',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e1e1e',
    borderRadius: 30,
    borderColor: "#1e1e1e",
    borderWidth: 2,
    marginBottom: 8,
    shadowColor: '#ff6d1f',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
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
});

export default Search;
