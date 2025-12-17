import React from 'react';
import { ScrollView, StyleSheet, Text, View,Alert } from 'react-native';
import Post from '../Post';
import { useUserData } from '../users'; // <-- use context for cached posts and user data
import {requestcamerapermission,requestgallerypermission} from '../../utils/permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import Postskeleton from '../animations/postskeleton';

const PERMISSIONS_REQUESTED_KEY='@permissions_requested'
const requestinitialpermissions=async()=>{
  try{
  const hasrequested=await AsyncStorage.getItem(PERMISSIONS_REQUESTED_KEY);
  if(hasrequested==='true'){
    return; 
   
  }
   Alert.alert(
    'Welcome to DevLink!',
    'To provide you with the best experience, DevLink needs access to your camera and photos for sharing images in conversations.',
   [
    {text:'Grant permissions',
      onPress:async ()=>{
        const camerapermission=await requestcamerapermission();
        const gallerypermission=await requestgallerypermission();

        await AsyncStorage.setItem(PERMISSIONS_REQUESTED_KEY,'true');

        if(camerapermission&&gallerypermission){
          Alert.alert('All permission granted')
        }else if(!camerapermission&&!gallerypermission){
          Alert.alert('permission Denied')
        }else{
          Alert.alert('Partial permission')
        }


      }
    },
    {
      text:'Not now',
      style:'cancel',
      onPress:async()=>{
        await AsyncStorage.setItem(PERMISSIONS_REQUESTED_KEY,'true');
        Alert.alert('Permission skipped')
      }
    }

   ],
   {cancelable:false}
  );
}catch(error){

}
}




const ConversationsScreen = () => {
  const { loading, followingPosts,getCachedImageUri,currentUser}= useUserData();

   useEffect(() => {
    if (currentUser) {
      // Request permissions when user is logged in
     requestinitialpermissions();
    }
  }, [currentUser?.uid]);
  
  if (loading) {
    return (
      <ScrollView contentContainerStyle={styles.feed}>
        {[...Array(3)].map((_, index) => (
          <Postskeleton key={`skeleton-${index}`} />
        ))}
      </ScrollView>
    );
  }

  if (!followingPosts || followingPosts.length === 0) {
    return (
      <View style={styles.loaderContainer}>
        <Text style={{ color: 'white' }}>Loading conversations...</Text>
      </View>
    );
  }


  // Handle case when there are no posts yet
  if (!followingPosts || followingPosts.length === 0) {
    return (
      <View style={styles.loaderContainer}>
        <Text style={{ color: 'white' }}>No posts available.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.feed}>
      {followingPosts.map((item, index) => (
        
        <Post
          key={item.id || item.postId || index}
          postsId={item.id || item.postId} // If Firestore posts have id use it, else index fallback
          name={item.username || 'Anonymous'}
          image={item.imageUrl || item.avatarUrl}
          Avatar={item.userAvatar} // adjust depending on your schema
          caption={item.caption || item.content}
          initialLikeCount={item.likeCount || 0}
          initialLikedBy={item.likedBy|| []} 
          createdAt={item.createdAt}

        />
      ))}
    </ScrollView>
  );
};

export default ConversationsScreen;

const styles = StyleSheet.create({
  feed: {
    paddingVertical: 10,
    backgroundColor: '#000',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
});
