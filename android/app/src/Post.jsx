import React, {useEffect, useState} from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, FlatList, TextInput, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from './users';
import Firestore from '@react-native-firebase/firestore';
import { Dimensions } from 'react-native';


const SCREEN_WIDTH = Dimensions.get('window').width;

const Post = ({ name, image, Avatar, caption, initialLikeCount = 0, initialLikedBy = [], createdAt, postsId,userId,commentCount = 0  }) => {
  const [starred, setStarred] = useState(false);
  const [starCount, setStarCount] = useState(initialLikeCount || 0);
  const [updating, setUpdating] = useState(false);
  const [liveAvatar, setLiveAvatar] = useState(Avatar);
   const [liveCommentCount, setLiveCommentCount] = useState(commentCount);
  const actualPostId = postsId;
  const navigation = useNavigation();
  const { currentUser } = useUserData();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });

  // Keep liveAvatar in sync when parent passes a fresh avatar
  useEffect(() => {
    if (Avatar) setLiveAvatar(Avatar);
  }, [Avatar]);

  useEffect(() => {
  setLiveCommentCount(commentCount);
}, [commentCount]);
  // ONE-TIME read on mount — no persistent listener
  // Eliminates 400 snapshot listeners for 20 users x 20 posts
  // useEffect(() => {
  //   if (!actualPostId || !currentUser) return;

  //   Firestore().collection('posts').doc(actualPostId).get().then(doc => {
  //     if (doc.exists) {
  //       const postData = doc.data();
  //       setStarCount(postData.likes || 0);
  //       setStarred((postData.likedBy || []).includes(currentUser.uid));
  //     }
  //   }).catch(error => {
  //     console.error('Error fetching post data:', error);
  //   });
  // }, [actualPostId, currentUser]);

  // Initial starred state from prop (shown immediately before get() resolves)
  useEffect(() => {
    if (currentUser && initialLikedBy.includes(currentUser.uid)) {
      setStarred(true);
    }
  }, [currentUser, initialLikedBy]);

  const formatPostDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diffInSeconds = Math.max(0, Math.floor((now - date) / 1000));
    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
    if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }
    if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  };

  const toggleStar = async () => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please log in to star posts.');
      return;
    }
    if (updating) return;
    setUpdating(true);

    // Optimistic update — feels instant to the user
    const wasStarred = starred;
    setStarred(!wasStarred);
    setStarCount(prev => wasStarred ? Math.max(0, prev - 1) : prev + 1);

    try {
      let postRef;
      if (actualPostId) {
        postRef = Firestore().collection('posts').doc(actualPostId);
      } else {
        const postQuery = await Firestore().collection('posts').where('imageUrl', '==', image).limit(1).get();
        if (postQuery.empty) {
          Alert.alert('Error', 'Post not found.');
          setStarred(wasStarred);
          setStarCount(prev => wasStarred ? prev + 1 : Math.max(0, prev - 1));
          return;
        }
        postRef = postQuery.docs[0].ref;
      }

      const batch = Firestore().batch();
      if (wasStarred) {
        batch.update(postRef, {
          likes: Firestore.FieldValue.increment(-1),
          likedBy: Firestore.FieldValue.arrayRemove(currentUser.uid),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
      } else {
        batch.update(postRef, {
          likes: Firestore.FieldValue.increment(1),
          likedBy: Firestore.FieldValue.arrayUnion(currentUser.uid),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
      }
      await batch.commit();

    } catch (error) {
      console.error('Error updating star:', error);
      Alert.alert('Error', 'Failed to update star. Please try again.');
      // Revert on failure
      setStarred(wasStarred);
      setStarCount(prev => wasStarred ? prev + 1 : Math.max(0, prev - 1));
    } finally {
      setUpdating(false);
    }
  };

  const navigateToComments = () => {
    if (!actualPostId) {
      Alert.alert('Error', 'Post ID not available. Please try again.');
      return;
    }
    navigation.navigate('CommentScreen', {
      postId: actualPostId,
      image: image,
      name: name,
      // Count is driven only by onCommentCountSync (Firestore snapshot length).
      // Avoid optimistic +/-1 here — it races the snapshot and can show e.g. 2 then 1.
      onCommentCountSync: (exactCount) => setLiveCommentCount(exactCount),
    });
  };

  const navigateToProfile = () => {
  if (userId) {
    navigation.navigate('Profile', { screen: 'Profile', params: { userId } });
  }
};

// Add this effect inside Post component
useEffect(() => {
  const unsubscribe = navigation.addListener('focus', () => {
    // When returning from CommentScreen, pick up the synced count
    const state = navigation.getState();
    const commentScreenRoute = state?.routes?.find(
      r => r.name === 'CommentScreen' && r.params?.postId === actualPostId
    );
    if (commentScreenRoute?.params?.syncedCommentCount !== undefined) {
      setLiveCommentCount(commentScreenRoute.params.syncedCommentCount);
    }
  });
  return unsubscribe;
}, [navigation, actualPostId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
    onPress={navigateToProfile} 
    disabled={!userId} 
    activeOpacity={userId ? 0.7 : 1}
  >
        {liveAvatar ? (
          <Image source={{ uri: liveAvatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder} />
        )}
        </TouchableOpacity>
        <Text style={styles.username}>{name}</Text>
      </View>

      {image ? (
       <View style={styles.imageFrame}>
  <Image
    source={{ uri: image }}
    style={styles.postImage}
    resizeMode="cover"
  />
</View>
      ) : (
        <View style={styles.postImagePlaceholder}>
          <Text style={styles.placeholderText}>No image</Text>
        </View>
      )}

      <View style={styles.captionContainer}>
        <Text style={styles.caption}>
          <Text style={styles.username}>{name}</Text> {caption}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity onPress={toggleStar} disabled={updating}>
          <Icon
            name={starred ? 'star' : 'star-o'}
            size={24}
            color={starred ? '#fdd835' : 'white'}
            style={{ opacity: updating ? 0.6 : 1 }}
          />
        </TouchableOpacity>
        <Text style={styles.starCount}>{starCount}</Text>
        <TouchableOpacity onPress={navigateToComments} style={{ marginLeft: 20 }}>
          <Icon name="comment-o" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.starCount}> {liveCommentCount > 0 ? liveCommentCount : ''}</Text> 
      </View>

      <View style={styles.date}>
        <Text style={styles.create}>{formatPostDate(createdAt)}</Text>
      </View>
    </View>
  );
};

export default Post;
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    paddingBottom: 10,
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#555',
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#555',
  },
  create: {
    color: 'white',
    fontSize: 14,
    marginLeft: 6,
  },
  username: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 10,
    fontSize: 17,
  },
 imageFrame: {
  width: '100%',
  aspectRatio: 4 / 5,   // fixed Instagram frame
  backgroundColor: '#000',
  overflow: 'hidden',
},

postImage: {
  width: '100%',
  height: '100%',
},
  postImagePlaceholder: {
    width: '100%',
    height: 300,
    backgroundColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginTop: 10,
  },
  date: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  starCount: {
    color: 'white',
    marginLeft: 6,
    fontSize: 14,
  },
  commentSection: {
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  commentItem: {
    color: 'white',
    fontSize: 13,
    paddingVertical: 2,
  },
  commentInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  commentInput: {
    flex: 1,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 6,
    color: 'white',
    marginRight: 10,
  },
  sendButton: {
    color: '#4e9bde',
    fontWeight: 'bold',
  },
  captionContainer: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'white',
  },
  caption: {
    color: 'white',
    fontSize: 14,
  },
});