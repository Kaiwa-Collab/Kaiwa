import { StyleSheet, Text, TouchableOpacity, View, Alert, Modal,StatusBar, ActivityIndicator } from 'react-native';
import React, { useState } from 'react';
import auth from '@react-native-firebase/auth'; 
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import { useNavigation } from '@react-navigation/native';
import { CommonActions } from '@react-navigation/native';
import { Platform } from 'react-native';
import Addbio from './Addbio';
const getStatusBarHeight = () => Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
const Settings = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  



  const handleSignOut = async () => {
    try {
      const currentUser = auth().currentUser;
      if (currentUser) {
        await auth().signOut();
        
        
        // Navigate to login/auth screen after logout
      } else {
        Alert.alert('Not Logged In', 'No user is currently signed in.');
      }
    } catch (error) {
      
      Alert.alert('Error', 'Failed to logout');
    }
  };

  // 🔹 Delete Firestore Data (optimized in chunks of 500 and parallelized)
  const deleteUserFirestoreData = async (userId) => {
    const collectionsToClean = [
      'users',
      'profile', // Add this since you're creating profiles
      'questions',
      'answers',
      'comments',
      'likes',
      'follows',
      'notifications',
      'messages',
      'posts',
      'favorites',
      'user_settings',
      'user_analytics',
    ];
     

    const deleteFromCollection = async (collectionName) => {
      try {
        if (collectionName === 'users' || collectionName === 'profile') {
          // Main user doc and profile doc
          await firestore().collection(collectionName).doc(userId).delete();
         
          return;
        }

        let query = firestore().collection(collectionName).where('userId', '==', userId).limit(500);
        let snapshot;

        do {
          snapshot = await query.get();
          if (!snapshot.empty) {
            const batch = firestore().batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            
          }
        } while (!snapshot.empty);

        // Check for alternative authorId field
        query = firestore().collection(collectionName).where('authorId', '==', userId).limit(500);
        do {
          snapshot = await query.get();
          if (!snapshot.empty) {
            const batch = firestore().batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
           
          }
        } while (!snapshot.empty);

      } catch (error) {
        
      }
    };

    // Run all collection deletions in parallel
    await Promise.all(collectionsToClean.map(name => deleteFromCollection(name)));
    
  };

  // 🔹 Delete Storage Data (parallelized)
  const deleteUserStorageData = async (userId) => {
    const paths = [
      `avatars/avatar_${userId}`,
      `profile_images/${userId}`,
      `user_uploads/${userId}`,
      `documents/${userId}`,
    ];

    await Promise.all(paths.map(async (path) => {
      try {
        const ref = storage().ref(path);
        const listResult = await ref.listAll();
        await Promise.all(listResult.items.map(item => item.delete()));
        
      } catch (e) {
        
      }
    }));
  };

  const deleteUserData = async (userId) => {
    await Promise.all([
      deleteUserFirestoreData(userId),
      deleteUserStorageData(userId)
    ]);
  };

  const reauthenticateUser = async () => {
    return new Promise((resolve, reject) => {
      Alert.prompt(
        'Re-authentication Required',
        'Please enter your password to confirm account deletion:',
        [
          {
            text: 'Cancel',
            onPress: () => reject(new Error('User cancelled')),
            style: 'cancel',
          },
          {
            text: 'Confirm',
            onPress: async (password) => {
              try {
                const user = auth().currentUser;
                if (user && user.email) {
                  const credential = auth.EmailAuthProvider.credential(user.email, password);
                  await user.reauthenticateWithCredential(credential);
                  resolve();
                } else {
                  reject(new Error('No user or email found'));
                }
              } catch (error) {
                reject(error);
              }
            },
          },
        ],
        'secure-text'
      );
    });
  };

 
  const handleDeleteAccount = async () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const currentUser = auth().currentUser;
              if (!currentUser) {
                Alert.alert('Error', 'No user is currently signed in.');
                return;
              }

              setLoading(true); // Show loading modal
              const userId = currentUser.uid;
              

              try {
                
                await deleteUserData(userId);
                
               
                await currentUser.delete();
                
                setLoading(false);
                

                Alert.alert(
                  'Account Deleted',
                  'Your account and all associated data have been deleted.'
                  // Remove the onPress navigation - let auth state handle it
                );

              } catch (err) {
                
                
                if (err.code === 'auth/requires-recent-login') {
                  setLoading(false);
                  
                  
                  try {
                    await reauthenticateUser();
                    setLoading(true);
                    
                    
                    await deleteUserData(userId);
                    await currentUser.delete();
                    
                    setLoading(false);
                    

                    Alert.alert(
                      'Account Deleted', 
                      'Your account has been deleted.'
                      // Remove the onPress navigation - let auth state handle it
                    );
                  } catch (reauthErr) {
                    setLoading(false);
                    
                    Alert.alert('Authentication Failed', 'Please sign in again and try.');
                  }
                } else {
                  throw err;
                }
              }
            } catch (error) {
              setLoading(false);
              
              Alert.alert('Error', 'Failed to delete account. Try again.');
            }
          }
        }
      ]
    );
  };

  const handlegoback=()=>{
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarSpacer}></View>
      <View style={styles.containertitle}>
      <Text style={styles.title}>Account Settings</Text>
      <TouchableOpacity style={styles.backButton}
      onPress={()=>handlegoback()}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>
      
      </View>
     
      <Modal visible={loading} transparent>
        <View style={styles.modalContainer}>
          <ActivityIndicator size="large" color="#ff3b30" />
          <Text style={styles.loadingText}>Deleting account...</Text>
        </View>
      </Modal>
      
      <TouchableOpacity
      onPress={()=>navigation.navigate('Addbio')} style={styles.Addbio}>
        <Text style={styles.AddbiotextText}>Add Bio</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={handleSignOut} style={styles.signOut}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleDeleteAccount} style={styles.deleteAccount}>
        <Text style={styles.deleteText}>Delete Account</Text>
      </TouchableOpacity>

      
    </View>
  );
};

export default Settings;

const styles = StyleSheet.create({

backButton: {
    paddingVertical: 8,
    position: 'absolute',
    left: 16, 
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
  },

  container: { flex: 1, 
    backgroundColor: '#1e1e1e'
   },
  containertitle: {
    height: 50,
    backgroundColor: '#1e1e1e',
    // flexDirection: 'row', 
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  Addbio:{
    width:'100%',
     marginBottom: 2,
     borderWidth:1,
     borderBottomColor:'white',
    marginTop: 20,
     backgroundColor: '#333',
      padding: 15, 
      borderBottomColor:'white',
      borderRadius: 1,
       alignItems: 'center', 
       shadowColor: 'white',
    shadowOffset: { width: 0,
       height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  

  },
  AddbiotextText:{
     color: '#fff',
     fontWeight: '600', 
     fontSize: 16 

  },
  title: {
     fontSize: 20,
     fontWeight: 'bold',
      textAlign: 'center',
       color: 'white' },
  signOut: {
    width:'100%',
    // marginBottom: 2,
    marginTop: 4,
    borderBottomColor:'white',
     backgroundColor: '#333',
      padding: 15, 
      borderRadius: 1,
       alignItems: 'center',
       borderWidth: 1,  
       shadowColor: 'white',
    shadowOffset: { width: 0,
       height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  },
  logoutText: {
     color: '#fff',
     fontWeight: '600', 
     fontSize: 16 },

  deleteAccount: {
    width:'100%',
    marginBottom:2,
    marginTop: 4,
     backgroundColor: '#333',
     borderBottomColor:'white', 
    padding: 15,
     borderRadius: 1,
      alignItems: 'center',
       borderWidth: 1, 
        shadowColor: 'white',
    shadowOffset: { width: 0, 
      height: 1 },
    shadowOpacity: 1,
    shadowRadius: 1,
    elevation: 1.5,
  },
  deleteText: { 
    color: '#fff',
     fontWeight: '700', 
     fontSize: 16 },
  warningText: { 
    marginTop: 30, 
    textAlign: 'center', 
    color: '#333', 
    fontSize: 14,
     fontStyle: 'italic' },

  modalContainer: { 
    flex: 1,
     justifyContent: 'center', 
     alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)' },
  loadingText: { 
    color: '#fff',
     fontSize: 18,
      marginTop: 10 },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e'
  },
});