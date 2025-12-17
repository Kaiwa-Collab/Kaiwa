

import { StyleSheet, Text, View, Pressable, Alert, ActivityIndicator } from 'react-native';
import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

const Username = () => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();

  // Simplified and fixed profile creation function
  const createUserProfile = async (userId, username) => {
    try {
    
      
      const profileRef = firestore().collection('profile').doc(userId);
      
      
      // Check if profile already exists
      
      const profileDoc = await profileRef.get();
      

      // Check if profile document exists AND has meaningful data
      const existingData = profileDoc.exists ? profileDoc.data() : null;
      const hasValidData = existingData && existingData.username && typeof existingData.followersCount === 'number';
      
      if (!profileDoc.exists || !hasValidData) {
        if (profileDoc.exists && !hasValidData) {
         
        } else {
          
        }
        
        // Use simpler data structure without serverTimestamp for now
        const initialProfile = {
          username: username,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
          bio: '',
          location: '',
          website: '',
          joinedDate: new Date().toLocaleDateString('en-US'),
          createdAt: new Date().toISOString(), // Use ISO string instead of serverTimestamp
          updatedAt: new Date().toISOString()
        };

        
        // Force overwrite the document (don't merge)
        
        
        try {
          await profileRef.set(initialProfile, { merge: false }); // Explicitly don't merge
          
        } catch (writeError) {
         
          throw writeError;
        }
        
        // Wait longer for Firestore to process
        
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
        
        // Verify the document was created with data
        
        let verifyDoc;
        let attempts = 0;
        const maxAttempts = 5;
        
        // Retry verification multiple times
        while (attempts < maxAttempts) {
          try {
            verifyDoc = await profileRef.get();
            
            
            if (verifyDoc.exists) {
              const data = verifyDoc.data();
              
              
              if (data && Object.keys(data).length > 0) {
               
                return { success: true, data: data };
              } else {
                
              }
            } else {
              
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between attempts
            }
          } catch (verifyError) {
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }
        
        // If we get here, verification failed
        
        throw new Error('Profile document was created but data verification failed');
        
      } else if (hasValidData) {
        
        const existingData = profileDoc.data();
      
        
        // Update the existing profile with new username if different
        if (existingData.username !== username) {
          
          await profileRef.update({
            username: username,
            updatedAt: new Date().toISOString()
          });
          
        }
        
        return { success: true, data: existingData, existed: true };
      }
    } catch (error) {
     
      
      // Check for specific Firebase errors
      if (error.code === 'permission-denied') {
      
        throw new Error('Permission denied. Check Firestore security rules for the profile collection.');
      } else if (error.code === 'network-request-failed') {
        
        throw new Error('Network error. Please check your internet connection.');
      } else if (error.code === 'unavailable') {
        
        throw new Error('Firestore service is temporarily unavailable. Please try again.');
      }
      
      throw error;
    } finally {
      
    }
  };

  // Function to force recreate profile (for debugging)
  const forceRecreateProfile = async (userId, username) => {
    try {
      
      
      // Delete existing profile document first
      await firestore().collection('profile').doc(userId).delete();
      
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create new profile with complete data
      const newProfile = {
        username: username,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
        bio: '',
        location: '',
        website: '',
        joinedDate: new Date().toLocaleDateString('en-US'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await firestore().collection('profile').doc(userId).set(newProfile);
     
      
      // Verify
      const doc = await firestore().collection('profile').doc(userId).get();
      
      
      return { success: doc.exists && doc.data(), data: doc.data() };
    } catch (error) {
      
      throw error;
    }
  };

  const handleSaveUsername = async () => {
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }

    if (username.trim().length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters long');
      return;
    }

    setLoading(true);

    try {
      
      const currentUser = auth().currentUser;
      
      if (!currentUser || !currentUser.uid) {
        Alert.alert('Error', 'User not found. Please try logging in again.');
        setLoading(false);
        return;
      }

    

      
      
      

      // Update username in users collection
      
      await firestore().collection('users').doc(currentUser.uid).set({
        username: username.trim(),
        email: currentUser.email,
        updatedAt: firestore.FieldValue.serverTimestamp()
      }, { merge: true });

     

      // Create full profile document (try force recreate first if there's an empty document)
      
      
      // First try force recreating to ensure clean slate
      let profileResult;
      try {
        profileResult = await forceRecreateProfile(currentUser.uid, username.trim());
      } catch (recreateError) {
        
        profileResult = await createUserProfile(currentUser.uid, username.trim());
      }
      
      if (profileResult.success) {
        
        
        Alert.alert(
          'Success', 
          profileResult.existed 
            ? 'Username updated successfully!' 
            : 'Username and profile created successfully!', 
          [{
            text: 'OK',
            onPress: () => navigation.replace('Tabnavigator')
          }]
        );
      } else {
        throw new Error('Profile creation failed');
      }
      
    } catch (error) {
      
      Alert.alert(
        'Error', 
        `Failed to save username and profile: ${error.message}\n\nPlease check the console for detailed error information.`
      );
    } finally {
      setLoading(false);
      
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Choose Your Username</Text>
      
      <TextInput 
        style={styles.userInput}
        placeholder="Enter Username"
        value={username}
        onChangeText={setUsername}
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      
      <Pressable 
        style={[styles.button, loading && styles.buttonDisabled]} 
        onPress={handleSaveUsername}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </Pressable>

      {loading && (
        <Text style={styles.loadingText}>Setting up your profile...</Text>
      )}
    </SafeAreaView>
  );
};

export default Username;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 30,
  },
  userInput: {
    height: 50,
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'black',
    paddingHorizontal: 15,
    fontSize: 16,
    marginBottom: 30,
  },
  button: {
    backgroundColor: 'green',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  loadingText: {
    color: 'white',
    fontSize: 14,
    marginTop: 15,
    textAlign: 'center',
  },
});