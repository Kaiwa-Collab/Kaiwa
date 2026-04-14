import React from 'react';
import { ScrollView, StyleSheet, View, StatusBar,TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Post from '../Post'; // adjust path as needed
import Icon from 'react-native-vector-icons/Ionicons';
import { useRef } from 'react';
import { FlatList } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { Dimensions } from 'react-native';


const { height } = Dimensions.get('window');
const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
const TITLE_BAR_HEIGHT = 80;
const ITEM_HEIGHT = height - TITLE_BAR_HEIGHT - getStatusBarHeight();

const PostDetail = () => {
  const route = useRoute();
  const { postData,allPosts,  initialIndex} = route.params || {};
  const navigation=useNavigation();

  const normalizePosts = (rawPosts) =>
    (rawPosts || []).map(post => ({
      ...post,
      id: post.id ?? post.postsId ?? post.postId,
      name: post.username ?? post.name ?? 'Anonymous',
      image: post.imageUrl ?? post.image ?? null,
      Avatar: post.userAvatar ?? post.Avatar ?? null,
      caption: post.caption ?? post.content ?? '',
      initialLikeCount: post.likeCount ?? post.likes ?? post.initialLikeCount ?? 0,
      initialLikedBy: post.likedBy ?? post.initialLikedBy ?? [],
      commentCount: post.commentCount ?? 0,
    }));

  const rawPosts = allPosts && allPosts.length > 0 ? allPosts : (postData ? [postData] : []);
  const posts = normalizePosts(rawPosts);
  const startIndex=initialIndex??0;
  const flatlistref=useRef(null);
  const scrollRef = useRef(null);

  if (!postData) return null;

  const renderItem=({item})=>(
 <Post
        postsId={item.id?? item.postsId}
        name={item.username}
        image={item.imageUrl ?? item.image}
        Avatar={item.userAvatar}
        caption={item.caption}
        initialLikeCount={item.likeCount || item.likes || 0}
              initialLikedBy={item.likedBy || []}
        createdAt={item.createdAt}
        userId={item.userId}
        commentCount={item.commentCount}
      />
  )

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      {/* <ScrollView style={styles.container} contentContainerStyle={styles.content}> */}
       <View style={styles.titleBar}>
                <View style={styles.sidebutton}>
                  
                    <TouchableOpacity
                      onPress={() => navigation.goBack()}
                      style={styles.backButton}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Icon name="arrow-back" size={24} color="white" />
                    </TouchableOpacity>
                  
                    <View style={styles.backButtonPlaceholder} />
                  
                </View>
                </View>
       <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        // Scroll to the tapped post after layout
        onLayout={() => {
          if (startIndex > 0) {
            scrollRef.current?.scrollTo({
              y: startIndex * 10, // small nudge — real offset computed below
              animated: false,
            });
          }
        }}
        contentContainerStyle={styles.scrollContent}
      >
        {posts.map((item, index) => (
          <View
            key={item.id ?? index}
            onLayout={(e) => {
              // On first render of the target post, scroll to it
              if (index === startIndex) {
                scrollRef.current?.scrollTo({
                  y: e.nativeEvent.layout.y,
                  animated: false,
                });
              }
            }}
          >
            <Post
              postsId={item.id}
              name={item.name}
              image={item.image}
              Avatar={item.Avatar}
              caption={item.caption}
              initialLikeCount={item.initialLikeCount}
              initialLikedBy={item.initialLikedBy}
              createdAt={item.createdAt}
              userId={item.userId}
              commentCount={item.commentCount}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  // content: {
  //   paddingVertical: 5,
  // },
  statusBarSpacer: { 
      height: getStatusBarHeight(), 
      backgroundColor: '#1e1e1e' 
    },
    titleBar: { 
      height: 80, 
      backgroundColor: '#1e1e1e', 
      flexDirection: 'row', 
      // justifyContent: 'center', 
      alignItems: 'center', 
      paddingHorizontal: 10, 
      borderBottomWidth: 1, 
      borderBottomColor: '#eee',
      paddingTop: getStatusBarHeight()
    },
    backButton: {
      position: 'absolute', 
      left: 10
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
});

export default PostDetail;