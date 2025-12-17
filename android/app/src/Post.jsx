import React, {useEffect, useState} from 'react';
import { StyleSheet, Text, View, Image,TouchableOpacity,FlatList,TextInput,Alert } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from './users';
import Firestore from '@react-native-firebase/firestore';

const Post = ({ name, image, Avatar, caption, initialLikeCount = 0, initialLikedBy = [], createdAt, postsId }) => {
  const [starred, setStarred] = useState(false);
  const [starCount, setStarCount] = useState(initialLikeCount || 0);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState([]);
  const [updating, setUpdating] = useState(false);
  // const [actualPostId, setActualPostId] = useState(postsId);
  const actualPostId = postsId; // 

  const navigation = useNavigation();
  const { currentUser, current } = useUserData();

  const formatPostDate = (timestamp) => {
    if (!timestamp) return '';

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) {
      return `${diffInSeconds} seconds ago`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} day${days !== 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };


  // Set up real-time listener for post data
  useEffect(() => {
    let unsubscribe = null;

    const setupPostListener = async () => {
      if (!actualPostId) return;

      try {
        const postRef = Firestore().collection('posts').doc(actualPostId);
        
        unsubscribe = postRef.onSnapshot((doc) => {
          if (doc.exists) {
            const postData = doc.data();
            const likedBy = postData.likedBy || [];
            const likes = postData.likes || 0;
            
            // Update like count from Firestore
            setStarCount(likes);
            
            // Update starred status based on current user
            if (currentUser) {
              setStarred(likedBy.includes(currentUser.uid));
            }
          }
        }, (error) => {
          console.error('Error listening to post updates:', error);
        });
      } catch (error) {
        console.error('Error setting up post listener:', error);
      }
    };

    if (actualPostId && currentUser) {
      setupPostListener();
    }

    // Cleanup listener on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [actualPostId, currentUser]);

  // Initial setup for starred state based on initialLikedBy
  useEffect(() => {
    if (currentUser && initialLikedBy.includes(currentUser.uid)) {
      setStarred(true);
    }
  }, [currentUser, initialLikedBy]);

  const toggleStar = async () => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please log in to star posts.');
      return;
    }
    if (updating) return;
    setUpdating(true);

    try {
      let postRef;
      
      if (actualPostId) {
        // Use the postId directly
        postRef = Firestore().collection('posts').doc(actualPostId);
      } else {
        // Fallback to finding by image URL
        const postQuery = await Firestore().collection('posts').where('imageUrl', '==', image).limit(1).get();
        
        if (postQuery.empty) {
          console.warn('No post found for image:', image);
          Alert.alert('Error', 'Post not found.');
          return;
        }
        
        const postDoc = postQuery.docs[0];
        postRef = postDoc.ref;
        // setActualPostId(postDoc.id); // Cache the postId for future use
      }

      const batch = Firestore().batch();
      
      // To unlike
      if (starred) {
        batch.update(postRef, {
          likes: Firestore.FieldValue.increment(-1),
          likedBy: Firestore.FieldValue.arrayRemove(currentUser.uid),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
        
        // Optimistic update - will be overridden by real-time listener
        setStarred(false);
        setStarCount(prev => Math.max(0, prev - 1));
      } else {
        // To like
        batch.update(postRef, {
          likes: Firestore.FieldValue.increment(1),
          likedBy: Firestore.FieldValue.arrayUnion(currentUser.uid),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        });
        
        // Optimistic update - will be overridden by real-time listener
        setStarred(true);
        setStarCount(prev => prev + 1);
      }
      
      await batch.commit();
      console.log('Successfully updated likes for user:', name);
      
    } catch (error) {
      console.error('Error updating star:', error);
      Alert.alert('Error', 'Failed to update star. Please try again.');
      
      // Revert optimistic updates on error
      setStarred(!starred);
      setStarCount(prev => starred ? prev + 1 : Math.max(0, prev - 1));
    } finally {
      setUpdating(false);
    }
  };

  const navigateToComments = () => {
    console.log('Navigating to comments with postId:', actualPostId);
    
    if (!actualPostId) {
      Alert.alert('Error', 'Post ID not available. Please try again.');
      return;
    }
    
    navigation.navigate('CommentScreen', {
      postId: actualPostId,
      image: image,
      name: name
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Image source={{ uri: Avatar }} style={styles.avatar} />
        <Text style={styles.username}>{name}</Text>
      </View>

      {/* Post Image */}
      <Image source={{ uri: image }} style={styles.postImage} resizeMode="cover" />

      {/* Caption */}
      <View style={styles.captionContainer}>
        <Text style={styles.caption}>
          <Text style={styles.username}>{name}</Text> {caption}
        </Text>
      </View>

      {/* Star & Comment Controls */}
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

        <TouchableOpacity
          onPress={navigateToComments}
          style={{ marginLeft: 20 }}
        >
          <Icon name="comment-o" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.date}>
        <Text style={styles.create}>{formatPostDate(createdAt)}</Text>
      </View>

      {/* Comment Section */}
      {commentsVisible && (
        <View style={styles.commentSection}>
          <FlatList
            data={comments}
            keyExtractor={(item, index) => index.toString()}
            renderItem={({ item }) => (
              <Text style={styles.commentItem}>💬 {item}</Text>
            )}
          />

          <View style={styles.commentInputBox}>
            <TextInput
              value={commentInput}
              onChangeText={setCommentInput}
              placeholder="Add a comment..."
              placeholderTextColor="#aaa"
              style={styles.commentInput}
            />
            <TouchableOpacity onPress={() => console.log('Add comment functionality moved to CommentScreen')}>
              <Text style={styles.sendButton}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
    borderBottomRadius: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
  },
  avatar: {
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
  postImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#222',
    borderBottomRadius: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'white',
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
    borderTopRadius: 2,
    borderTopWidth: 1,
    borderTopColor: 'white',
  },
  caption: {
    color: 'white',
    fontSize: 14,
  },
});