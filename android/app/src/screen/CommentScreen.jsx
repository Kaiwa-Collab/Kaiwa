import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, View, Image, TouchableOpacity, FlatList, TextInput, SafeAreaView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation, useRoute } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import Post from '../Post';
import { useUserData } from '../users';

const CommentScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { postId, image, name,username,avatar } = route.params || {};
  const [comments, setComments] = useState([]);
  const [commentInput, setCommentInput] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  
  // Get cached user data from context
  const { profile, getCachedImageUri } = useUserData();
  

  // Debug route params
  useEffect(() => {
    
    
    if (!postId) {
      
      Alert.alert(
        'Error',
        'Post ID is missing. Cannot load comments.',
        [
          {
            text: 'Go Back',
            onPress: () => navigation.goBack(),
          }
        ]
      );
    }
  }, [postId, navigation, route.params,profile]);

  // Use postId or fallback for testing
  // const effectivePostId = postId; // Remove this line once you fix the navigation

  // ----------- REAL-TIME COMMENTS LOADING -----------
  useEffect(() => {
    const effectivePostId = postId;
    
    if (!effectivePostId) {
      return;
    }
    
    
    
    const unsubscribe = firestore()
      .collection('posts')
      .doc(effectivePostId)
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .onSnapshot(
        (snapshot) => {
          
          const commentList = [];
          snapshot.forEach(doc => {
            const data = doc.data();
           
            commentList.push({ 
              id: doc.id, 
              ...data,
              // Format timestamp for display
              timestamp: data.createdAt ? formatTimestamp(data.createdAt) : 'now'
            });
          });
         
          setComments(commentList);
        },
        (error) => {
          // Only show alert for serious errors, not permission issues
          if (error.code !== 'permission-denied') {
            Alert.alert('Error', 'Failed to load comments: ' + error.message);
          }
        }
      );
    
    
   
    
    
    
    return unsubscribe;
  }, [postId]);

  // ----------- TIMESTAMP FORMATTING -----------
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'now';
    
    const now = new Date();
    const commentTime = timestamp.toDate();
    const diffMs = now - commentTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return commentTime.toLocaleDateString();
  };

  // ----------- COMMENT OR REPLY POSTING -----------
  const addComment = async () => {
  const currentUser = auth().currentUser;
  
  // console.log('AddComment called with:', {
  //   currentUser: currentUser?.uid,
  //   commentInput: commentInput.trim(),
  //   postId,
  //   replyingTo: replyingTo?.id
  // });
  
  if (!currentUser) {
    Alert.alert('Error', 'Please log in to comment');
    return;
  }
  
  if (!commentInput.trim()) {
    Alert.alert('Error', 'Please enter a comment');
    return;
  }
  
  if (!postId) {
    Alert.alert('Error', 'Post ID is missing');
    return;
  }

  setLoading(true);
  
  try {

    const currentusername = profile?.username || currentUser.displayName || currentUser.email?.split('@')[0] || "user";
    const currentuseravatar = profile?.avatar || currentUser.photoURL || null;
    if (replyingTo) {
      
      
      // Check if the comment still exists before adding reply
      const commentDocRef = firestore()
        .collection('posts')
        .doc(postId)
        .collection('comments')
        .doc(replyingTo.id);
      
      const commentDoc = await commentDocRef.get();
      
      if (!commentDoc.exists) {
        
        Alert.alert('Error', 'The comment you are replying to no longer exists');
        setReplyingTo(null);
        setCommentInput('');
        return;
      }

      // Add as reply to existing comment - Use client timestamp instead of server timestamp
      const newReply = {
        id: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: commentInput.trim(),
        userId: currentUser.uid,
        username: currentusername,
        avatar: currentuseravatar,
        likes: 0,
        liked: false,
        likedBy: [],
        createdAt: new Date(), // Use client timestamp instead of serverTimestamp
        timestamp: 'now',
      };

      

      await commentDocRef.update({
        replies: firestore.FieldValue.arrayUnion(newReply),
      });
      
     
      setReplyingTo(null);
      
    } else {
      console.log('Adding new comment to post:', postId);
      
      // Create the comment document reference first
      const commentRef = firestore()
        .collection('posts')
        .doc(postId)
        .collection('comments')
        .doc(); // This creates a new document reference with auto-generated ID

      // Add as top-level comment - create initial document without serverTimestamp
      const newComment = {
        text: commentInput.trim(),
        userId: currentUser.uid,
        username: currentusername,
        avatar: currentuseravatar,
        likes: 0,
        liked: false,
        likedBy: [],
        replies: [],
      };

      

      // Use set() instead of add() so we can use serverTimestamp
      await commentRef.set({
        ...newComment,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
      
      

      // Try to update post's comment count
      try {
        await firestore()
          .collection('posts')
          .doc(postId)
          .update({
            commentCount: firestore.FieldValue.increment(1),
            lastCommentAt: firestore.FieldValue.serverTimestamp(),
          });
      
      } catch (updateError) {
        
      }
    }
    
    setCommentInput('');
    
    // Auto-scroll to bottom after posting
    setTimeout(() => {
      try {
        flatListRef.current?.scrollToEnd({ animated: true });
      } catch (scrollError) {
        
      }
    }, 500);
    
  } catch (error) {
    let errorMessage = "Could not post comment. Please try again.";
    
    if (error.code === 'permission-denied') {
      errorMessage = "You don't have permission to comment on this post.";
    } else if (error.code === 'not-found') {
      errorMessage = "The post you are trying to comment on was not found.";
    } else if (error.code === 'unauthenticated') {
      errorMessage = "Please log in to comment.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    Alert.alert("Error", errorMessage);
  } finally {
    setLoading(false);
  }
};
  // ----------- IMPROVED LIKE TOGGLE -----------
  const toggleLike = async (commentId, isReply = false, parentId = null) => {
    const currentUser = auth().currentUser;
    if (!currentUser) return;

    try {
      if (isReply && parentId) {
        // Handle reply like - check if parent comment exists first
        const commentDocRef = firestore()
          .collection('posts')
          .doc(postId)
          .collection('comments')
          .doc(parentId);
        
        const commentDoc = await commentDocRef.get();
        
        if (!commentDoc.exists) {
          Alert.alert('Error', 'Comment no longer exists');
          return;
        }
        
        const replies = commentDoc.data()?.replies || [];
        const replyExists = replies.find(reply => reply.id === commentId);
        
        if (!replyExists) {
          Alert.alert('Error', 'Reply no longer exists');
          return;
        }
        
        const updatedReplies = replies.map(reply => {
          if (reply.id === commentId) {
            const likedBy = reply.likedBy || [];
            const hasLiked = likedBy.includes(currentUser.uid);
            
            return {
              ...reply,
              liked: !hasLiked,
              likes: hasLiked ? Math.max(0, reply.likes - 1) : reply.likes + 1,
              likedBy: hasLiked 
                ? likedBy.filter(uid => uid !== currentUser.uid)
                : [...likedBy, currentUser.uid]
            };
          }
          return reply;
        });

        await commentDocRef.update({ replies: updatedReplies });
        
      } else {
        // Handle comment like - check if comment exists first
        const commentDocRef = firestore()
          .collection('posts')
          .doc(postId)
          .collection('comments')
          .doc(commentId);
        
        const commentDoc = await commentDocRef.get();
        
        if (!commentDoc.exists) {
          Alert.alert('Error', 'Comment no longer exists');
          return;
        }
        
        const commentData = commentDoc.data();
        const likedBy = commentData?.likedBy || [];
        const hasLiked = likedBy.includes(currentUser.uid);

        await commentDocRef.update({
          liked: !hasLiked,
          likes: hasLiked ? Math.max(0, commentData.likes - 1) : commentData.likes + 1,
          likedBy: hasLiked 
            ? firestore.FieldValue.arrayRemove(currentUser.uid)
            : firestore.FieldValue.arrayUnion(currentUser.uid)
        });
      }
    } catch (error) {
      if (error.code === 'not-found') {
        Alert.alert('Error', 'The comment or reply you are trying to like was not found');
      } else {
        Alert.alert('Error', 'Failed to update like');
      }
    }
  };

  // ----------- DELETE COMMENT (Optional Enhancement) -----------
  const deleteComment = async (commentId) => {
    const currentUser = auth().currentUser;
    if (!currentUser) return;

    Alert.alert(
      'Delete Comment',
      'Are you sure you want to delete this comment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Check if comment exists first
              const commentDocRef = firestore()
                .collection('posts')
                .doc(postId)
                .collection('comments')
                .doc(commentId);
              
              const commentDoc = await commentDocRef.get();
              
              if (!commentDoc.exists) {
                Alert.alert('Error', 'Comment no longer exists');
                return;
              }
              
              // Verify user owns the comment
              if (commentDoc.data()?.userId !== currentUser.uid) {
                Alert.alert('Error', 'You can only delete your own comments');
                return;
              }
              
              await commentDocRef.delete();
              
              // Update post comment count (optional)
              try {
                await firestore()
                  .collection('posts')
                  .doc(postId)
                  .update({
                    commentCount: firestore.FieldValue.increment(-1),
                  });
              } catch (updateError) {
                
              }
              
            } catch (error) {
              if (error.code === 'not-found') {
                Alert.alert('Error', 'Comment was not found');
              } else {
                Alert.alert('Error', 'Failed to delete comment');
              }
            }
          }
        }
      ]
    );
  };

  // ----------- REPLY STARTER -----------
  const startReply = (comment) => {
    setReplyingTo(comment);
    setCommentInput(`@${comment.username} `);
    inputRef.current?.focus();
  };

  // ----------- RENDER REPLY -----------
  const renderReply = ({ item: reply, parentId }) => {
    const currentUser = auth().currentUser;
    const isMyReply = currentUser?.uid === reply.userId;
    const hasLiked = reply.likedBy?.includes(currentUser?.uid) || false;

    // Handle timestamp formatting for replies
    const formatReplyTimestamp = (timestamp) => {
      if (!timestamp) return 'now';
      
      // Handle both Date objects and Firestore timestamps
      let replyTime;
      if (timestamp.toDate) {
        replyTime = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        replyTime = timestamp;
      } else {
        return 'now';
      }
      
      const now = new Date();
      const diffMs = now - replyTime;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'now';
      if (diffMins < 60) return `${diffMins}m`;
      if (diffHours < 24) return `${diffHours}h`;
      if (diffDays < 7) return `${diffDays}d`;
      return replyTime.toLocaleDateString();
    };

    return (
      <View style={styles.replyContainer}>
        <Image 
          source={{ uri: reply.avatar || 'https://randomuser.me/api/portraits/lego/0.jpg' }} 
          style={styles.replyAvatar} 
        />
        <View style={styles.replyContent}>
          <Text style={styles.commentText}>
            <Text style={styles.username}>{reply.username}</Text> {reply.text}
          </Text>
          <View style={styles.replyActions}>
            <Text style={styles.timestamp}>
              {formatReplyTimestamp(reply.createdAt)}
            </Text>
            {reply.likes > 0 && (
              <Text style={styles.likes}>{reply.likes} like{reply.likes !== 1 ? 's' : ''}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => toggleLike(reply.id, true, parentId)}
          style={styles.likeButton}
        >
          <Icon 
            name={hasLiked ? 'heart' : 'heart-o'} 
            size={12} 
            color={hasLiked ? '#ff3040' : '#8e8e8e'} 
          />
        </TouchableOpacity>
      </View>
    );
  };

  // ----------- RENDER COMMENT -----------
  const renderComment = ({ item: comment }) => {
    const currentUser = auth().currentUser;
    const isMyComment = currentUser?.uid === comment.userId;
    const hasLiked = comment.likedBy?.includes(currentUser?.uid) || false;

    return (
      <View style={styles.commentContainer}>
        <Image 
          source={{ uri: getCachedImageUri(comment.avatar) || comment.avatar || 'https://randomuser.me/api/portraits/lego/0.jpg' }} 
          style={styles.avatar} 
        />
        <View style={styles.commentContent}>
          <Text style={styles.commentText}>
            <Text style={styles.username}>{comment.username}</Text> {comment.text}
          </Text>
          <View style={styles.commentActions}>
            <Text style={styles.timestamp}>{comment.timestamp}</Text>
            {comment.likes > 0 && (
              <Text style={styles.likes}>{comment.likes} like{comment.likes !== 1 ? 's' : ''}</Text>
            )}
            <TouchableOpacity onPress={() => startReply(comment)}>
              <Text style={styles.replyButton}>Reply</Text>
            </TouchableOpacity>
            {isMyComment && (
              <TouchableOpacity onPress={() => deleteComment(comment.id)}>
                <Text style={styles.deleteButton}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {/* Render replies */}
          {comment.replies && comment.replies.length > 0 && (
            <View style={styles.repliesContainer}>
              {comment.replies.map(reply => (
                <View key={reply.id}>
                  {renderReply({ item: reply, parentId: comment.id })}
                </View>
              ))}
            </View>
          )}
        </View>
        
        <TouchableOpacity
          onPress={() => toggleLike(comment.id)}
          style={styles.likeButton}
        >
          <Icon 
            name={hasLiked ? 'heart' : 'heart-o'} 
            size={14} 
            color={hasLiked ? '#ff3040' : '#8e8e8e'} 
          />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Comments</Text>
        <TouchableOpacity>
          <Icon name="share" size={20} color="white" />
        </TouchableOpacity>
      </View>
      
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          ref={flatListRef}
          data={comments}
          keyExtractor={item => item.id}
          renderItem={renderComment}
          style={styles.commentsList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.commentsContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No comments yet</Text>
              <Text style={styles.emptySubtext}>Be the first to comment!</Text>
            </View>
          }
        />
        
        {replyingTo && (
          <View style={styles.replyIndicator}>
            <Text style={styles.replyIndicatorText}>Replying to @{replyingTo.username}</Text>
            <TouchableOpacity onPress={() => { setReplyingTo(null); setCommentInput(''); }}>
              <Icon name="times" size={16} color="#8e8e8e" />
            </TouchableOpacity>
          </View>
        )}
        
        <View style={styles.inputContainer}>
          <Image 
            source={{ uri: getCachedImageUri(profile?.avatar) || profile?.avatar || auth().currentUser?.photoURL || 'https://randomuser.me/api/portraits/lego/0.jpg' }} 
            style={styles.inputAvatar} 
          />
          <TextInput
            ref={inputRef}
            value={commentInput}
            onChangeText={setCommentInput}
            placeholder="Add a comment..."
            placeholderTextColor="#8e8e8e"
            style={styles.textInput}
            multiline
            maxLength={2200}
            editable={!loading}
          />
          <TouchableOpacity 
            onPress={addComment} 
            disabled={commentInput.trim() === '' || loading}
            style={[
              styles.postButton, 
              { opacity: commentInput.trim() === '' || loading ? 0.5 : 1 }
            ]}
          >
            <Text style={styles.postButtonText}>
              {loading ? 'Posting...' : 'Post'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  commentsList: {
    flex: 1,
  },
  commentsContent: {
    paddingBottom: 20,
  },
  commentContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  commentContent: {
    flex: 1,
  },
  commentText: {
    color: 'white',
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 8,
  },
  username: {
    fontWeight: '600',
    color: 'white',
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timestamp: {
    color: '#8e8e8e',
    fontSize: 12,
    marginRight: 16,
  },
  likes: {
    color: '#8e8e8e',
    fontSize: 12,
    marginRight: 16,
  },
  replyButton: {
    color: '#8e8e8e',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 16,
  },
  deleteButton: {
    color: '#ff3040',
    fontSize: 12,
    fontWeight: '600',
  },
  likeButton: {
    padding: 8,
    marginLeft: 8,
  },
  repliesContainer: {
    marginTop: 12,
    marginLeft: 12,
  },
  replyContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  replyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  replyContent: {
    flex: 1,
  },
  replyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 0.5,
    borderTopColor: '#333',
  },
  replyIndicatorText: {
    color: '#8e8e8e',
    fontSize: 13,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#333',
    backgroundColor: '#000',
  },
  inputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  textInput: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    maxHeight: 100,
    paddingVertical: 8,
  },
  postButton: {
    marginLeft: 12,
    paddingVertical: 8,
  },
  postButtonText: {
    color: '#0095f6',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#8e8e8e',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
});

export default CommentScreen;