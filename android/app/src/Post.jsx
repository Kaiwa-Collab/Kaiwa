import React, {useEffect, useMemo, useState} from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Alert,  UIManager, } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { useUserData } from './users';
import Firestore from '@react-native-firebase/firestore';
import { Dimensions } from 'react-native';
import { useRef } from 'react';


if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get('window').width;


const CodeCard = ({image, codeText, imageAspectRatio}) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
 
  const lines = (codeText || '').split('\n');
  const previewLines = lines.slice(0, CODE_PREVIEW_LINES).join('\n');
  const hasMore = lines.length > CODE_PREVIEW_LINES;
  
 
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  };
 
  const handleCopy = () => {
    Clipboard.setString(codeText || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
 
  // ── Collapsed card: half image | half code preview ──
  if (!expanded) {
    return (
      <TouchableOpacity activeOpacity={0.92} onPress={toggle} style={styles.codeCard}>
        {/* Split row */}
        <View style={styles.splitRow}>
          {/* Left: image */}
          {image ? (
            <View style={styles.splitImageWrap}>
              <Image
                source={{uri: image}}
                style={styles.splitImage}
                resizeMode="cover"
              />
            </View>
          ) : (
            <View style={[styles.splitImageWrap, styles.splitImagePlaceholder]}>
              <Icon2 name="image-outline" size={28} color="#444" />
            </View>
          )}
 
          {/* Right: code preview */}
          <View style={styles.splitCodeWrap}>
            <View style={styles.codeHeaderRow}>
              <View style={styles.dot} />
              <View style={[styles.dot, {backgroundColor: '#f9c74f'}]} />
              <View style={[styles.dot, {backgroundColor: '#4ade80'}]} />
            </View>
            <ScrollView
              scrollEnabled={false}
              nestedScrollEnabled
              style={{flex: 1}}>
              <Text style={styles.codeText} numberOfLines={CODE_PREVIEW_LINES}>
                {previewLines}
              </Text>
            </ScrollView>
            {hasMore && (
              <Text style={styles.moreHint}>▼ tap to expand</Text>
            )}
          </View>
        </View>
 
        {/* Expand hint bar */}
        <View style={styles.expandBar}>
          <Icon2 name="chevron-down" size={12} color="rgba(255,255,255,0.4)" />
          <Text style={styles.expandBarText}>Tap to view full code</Text>
          <Icon2 name="chevron-down" size={12} color="rgba(255,255,255,0.4)" />
        </View>
      </TouchableOpacity>
    );
  }
 
  // ── Expanded card ──
  return (
    <TouchableOpacity activeOpacity={1} onPress={toggle} style={styles.codeCardExpanded}>
      {/* Full image on top */}
      {image && (
        <View
          style={[
            styles.expandedImageWrap,
            {
              aspectRatio:
                typeof imageAspectRatio === 'number' && imageAspectRatio > 0
                  ? imageAspectRatio
                  : 16 / 9,
            },
          ]}>
          <Image
            source={{uri: image}}
            style={{width: '100%', height: '100%'}}
            resizeMode="contain"
          />
        </View>
      )}
 
      {/* Code block */}
      <View style={styles.expandedCodeWrap}>
        {/* Top bar */}
        <View style={styles.codeTopBar}>
          <View style={styles.dotsRow}>
            <View style={styles.dot} />
            <View style={[styles.dot, {backgroundColor: '#f9c74f'}]} />
            <View style={[styles.dot, {backgroundColor: '#4ade80'}]} />
          </View>
          <TouchableOpacity
            onPress={handleCopy}
            style={styles.copyBtn}
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Icon2
              name={copied ? 'checkmark-done' : 'copy-outline'}
              size={16}
              color={copied ? '#4ade80' : '#aaa'}
            />
            <Text style={[styles.copyText, copied && {color: '#4ade80'}]}>
              {copied ? 'Copied!' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>
 
        {/* Scrollable code */}
        <ScrollView
          nestedScrollEnabled
          style={styles.codeScroll}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.codeTextFull}>{codeText}</Text>
        </ScrollView>
      </View>
 
      {/* Collapse bar */}
      <View style={styles.collapseBar}>
        <Icon2 name="chevron-up" size={12} color="rgba(255,255,255,0.4)" />
        <Text style={styles.expandBarText}>Tap to collapse</Text>
        <Icon2 name="chevron-up" size={12} color="rgba(255,255,255,0.4)" />
      </View>
    </TouchableOpacity>
  );
};
 

const Post = ({ name, image, Avatar, caption, initialLikeCount = 0, initialLikedBy = [], createdAt, postsId, userId, commentCount = 0, imageAspectRatio, imageFitMode }) => {
  const [starred, setStarred] = useState(false);
  const [starCount, setStarCount] = useState(initialLikeCount || 0);
  const [updating, setUpdating] = useState(false);
  const [liveAvatar, setLiveAvatar] = useState(Avatar);
   const [liveCommentCount, setLiveCommentCount] = useState(commentCount);
  const actualPostId = postsId;
  const navigation = useNavigation();
  const { currentUser } = useUserData();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const commentCountRef = useRef(liveCommentCount);
  // Feed uses a fixed 1:1 frame; no per-image ratio state needed.

  // Keep liveAvatar in sync when parent passes a fresh avatar
  useEffect(() => {
    if (Avatar) setLiveAvatar(Avatar);
  }, [Avatar]);

  useEffect(() => {
    commentCountRef.current = commentCount;
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
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}m ago`;
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffInSeconds / 86400);
  return `${days}d ago`;
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

  // navigation.navigate('CommentScreen', {
  //   postId: actualPostId,
  //   image: image,
  //   name: name,
  //   onCommentCountSync: (exactCount) => {
  //     commentCountRef.current = exactCount;
  //     setLiveCommentCount(exactCount);
  //   },
  // });
};

// NOTE: Avoid per-row navigation focus listeners (too expensive in lists).
// The parent feed refreshes comment counts on focus, and CommentScreen can call onCommentCountSync.

  const navigateToProfile = () => {
  if (userId) {
    navigation.navigate('Profile', { screen: 'Profile', params: { userId } });
  }
};

  const parsed = useMemo(() => {
    const raw = (caption || '').toString().trim();
    if (!raw) return { title: '', tags: '' };
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines[0] || raw;
    const rest = lines.slice(1).join(' ');
    // If the title already contains hashtags, keep it; otherwise show hashtags from rest.
    const tags = rest || (title.includes('#') ? '' : '');
    return { title, tags };
  }, [caption]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity
          onPress={navigateToProfile}
          disabled={!userId}
          activeOpacity={userId ? 0.7 : 1}
          style={styles.authorRow}
        >
          {liveAvatar ? (
            <Image source={{ uri: liveAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder} />
          )}
          <View style={styles.authorMeta}>
            <Text style={styles.authorName} numberOfLines={1}>{name}</Text>
            <Text style={styles.authorTime} numberOfLines={1}>{formatPostDate(createdAt)}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {image ? (
        <View style={[styles.mediaWrap, { aspectRatio: 1 }]}>
          <Image
            source={{ uri: image }}
            style={styles.media}
            resizeMode={imageFitMode === 'contain' ? 'contain' : 'cover'}
          />
        </View>
      ) : (
        <View style={styles.mediaPlaceholder}>
          <Text style={styles.placeholderText}>No image</Text>
        </View>
      )}

      <View style={styles.metricsRow}>
        <TouchableOpacity
          style={styles.metricPill}
          onPress={toggleStar}
          disabled={updating}
          activeOpacity={0.8}
        >
          <Icon
            name={starred ? 'rocket' : 'rocket'}
            size={14}
            color={starred ? '#FFD54A' : '#cfd6e6'}
            style={{ opacity: updating ? 0.6 : 1 }}
          />
          <Text style={styles.metricText}>{starCount}</Text>
          <Text style={styles.metricLabel}>upvote</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.metricPill}
          onPress={navigateToComments}
          activeOpacity={0.8}
        >
          <Icon name="comment-o" size={14} color="#cfd6e6" />
          <Text style={styles.metricText}>{liveCommentCount}</Text>
          <Text style={styles.metricLabel}>Comments</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {parsed.title || caption || ''}
        </Text>
        {!!parsed.tags && (
          <Text style={styles.tags} numberOfLines={2}>{parsed.tags}</Text>
        )}
      </View>
    </View>
  );
};

const MemoPost = React.memo(Post, (prev, next) => {
  return (
    prev.postsId === next.postsId &&
    prev.userId === next.userId &&
    prev.name === next.name &&
    prev.image === next.image &&
    prev.Avatar === next.Avatar &&
    prev.caption === next.caption &&
    prev.commentCount === next.commentCount &&
    prev.imageAspectRatio === next.imageAspectRatio &&
    prev.imageFitMode === next.imageFitMode &&
    prev.initialLikeCount === next.initialLikeCount &&
    // If parent passes a new array instance each time, this avoids useless rerenders.
    // Like state is still managed internally for optimistic UI.
    prev.initialLikedBy?.length === next.initialLikedBy?.length
  );
});

export default MemoPost;
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#14161b',
    borderRadius: 16,
    marginHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222836',
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorMeta: {
    marginLeft: 10,
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2f3a',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2f3a',
  },
  authorName: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  authorTime: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  mediaWrap: {
    width: '100%',
    // aspectRatio: 16 / 9,
    backgroundColor: '#0b0d12',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  mediaPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#0b0d12',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 10,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1218',
    borderWidth: 1,
    borderColor: '#232a3a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    gap: 8,
  },
  metricText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 12,
  },
  metricLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    fontSize: 12,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  title: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  tags: {
    color: '#7fb3ff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  
});