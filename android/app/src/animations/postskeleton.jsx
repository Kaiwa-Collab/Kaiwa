import { StyleSheet, Text, View, Animated } from 'react-native';
import React, { useRef, useEffect } from 'react';

const PostSkeleton = () => {
  const shimmeranimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmeranimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmeranimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    shimmer.start();
    return () => shimmer.stop();
  }, []);

  const shimmerStyle = {
    opacity: shimmeranimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 0.7],
    }),
  };



  return (
    <View style={styles.container}>
      {/* Header - Avatar and Username */}
      <View style={styles.header}>
        <Animated.View style={[styles.avatar, shimmerStyle]} />
        <Animated.View style={[styles.usernameLine, shimmerStyle]} />
      </View>

      {/* Post Image */}
      <Animated.View style={[styles.postImage, shimmerStyle]} />

      {/* Caption Container */}
      <View style={styles.captionContainer}>
        <View style={styles.captionContent}>
          <Animated.View style={[styles.captionUsername, shimmerStyle]} />
          <Animated.View style={[styles.captionText, shimmerStyle]} />
          <Animated.View style={[styles.captionText, styles.captionTextShort, shimmerStyle]} />
        </View>
      </View>
       {/* Actions - Star and Comment */}
      <View style={styles.actions}>
        <Animated.View style={[styles.actionIcon, shimmerStyle]} />
        <Animated.View style={[styles.starCountLine, shimmerStyle]} />
        <Animated.View style={[styles.actionIcon, styles.commentIcon, shimmerStyle]} />
      </View>

      {/* Date */}
      <View style={styles.date}>
        <Animated.View style={[styles.dateLine, shimmerStyle]} />
      </View>
    </View>
  )
}

export default PostSkeleton;

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
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  usernameLine: {
    width: 120,
    height: 17,
    backgroundColor: '#333',
    borderRadius: 4,
    marginLeft: 10,
  },
  postImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#222',
    borderBottomRadius: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  captionContainer: {
    padding: 10,
    borderTopRadius: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  captionContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  captionUsername: {
    width: 100,
    height: 14,
    backgroundColor: '#333',
    borderRadius: 4,
    marginRight: 8,
  },
   captionText: {
    width: '100%',
    height: 14,
    backgroundColor: '#333',
    borderRadius: 4,
    marginTop: 6,
  },
  captionTextShort: {
    width: '60%',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginTop: 10,
  },
  actionIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#333',
  },
  commentIcon: {
    marginLeft: 20,
  },
   starCountLine: {
    width: 30,
    height: 14,
    backgroundColor: '#333',
    borderRadius: 4,
    marginLeft: 6,
  },
  date: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 10,
  },
  dateLine: {
    width: 100,
    height: 14,
    backgroundColor: '#333',
    borderRadius: 4,
    marginLeft: 6,
  },

})