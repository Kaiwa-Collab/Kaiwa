import { StyleSheet, Text, View, Pressable, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import React, { useState, useEffect, useCallback } from 'react';
import { TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

// Debounce utility function
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const Username = () => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(null);
  const [validationMessage, setValidationMessage] = useState('');
  const navigation = useNavigation();

 const cancelaccountcreation = async () => {
  Alert.alert(
    'Cancel Account Creation',
    'Are you sure you want to cancel? you will need to sign up again.',
    [
      {
        text: 'No, Continue Setup',
        style: 'cancel'
      },
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          try {
            const currentUser = auth().currentUser;
            
            if (currentUser) {
              // Delete user document from Firestore if it exists
              try {
                await firestore().collection('users').doc(currentUser.uid).delete();
              } catch (firestoreError) {
                console.log('Firestore deletion error (continuing):', firestoreError);
              }

              // Delete profile document if it exists
              try {
                await firestore().collection('profile').doc(currentUser.uid).delete();
              } catch (profileError) {
                console.log('Profile deletion error (continuing):', profileError);
              }
              
              // Delete the Firebase Auth account
              await currentUser.delete();
              
              // The AuthWrapper's onAuthStateChanged listener will automatically
              // navigate back to the unauthenticated flow (Home screen)
            }
          } catch (error) {
            console.error('Error deleting account:', error);
            
            // Handle the case where re-authentication is required
            if (error.code === 'auth/requires-recent-login') {
              Alert.alert(
                'Error', 
                'For security reasons, please sign in again to delete your account.',
                [
                  {
                    text: 'OK',
                    onPress: async () => {
                      // Sign out and let them start over
                      await auth().signOut();
                    }
                  }
                ]
              );
            } else {
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          }
        }
      }
    ]
  );
};
  // Debounced username check
  const checkUsernameAvailability = useCallback(
    debounce(async (usernameToCheck) => {
      if (!usernameToCheck || usernameToCheck.length < 3) {
        setAvailable(null);
        setValidationMessage('Username must be at least 3 characters');
        return;
      }

      // Validate format
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(usernameToCheck)) {
        setAvailable(false);
        setValidationMessage('Only letters, numbers, and underscores allowed');
        return;
      }

      setChecking(true);
      setValidationMessage('Checking availability...');

      try {
        const result = await functions()
          .httpsCallable('checkUsernameAvailability')({ username: usernameToCheck });

        setAvailable(result.data.available);
        setValidationMessage(result.data.message);
      } catch (error) {
        console.error('Error checking username:', error);
        setValidationMessage('Error checking username');
        setAvailable(null);
      } finally {
        setChecking(false);
      }
    }, 500),
    []
  );

  // Check username whenever it changes
  useEffect(() => {
    if (username) {
      checkUsernameAvailability(username);
    } else {
      setAvailable(null);
      setValidationMessage('');
    }
  }, [username, checkUsernameAvailability]);

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
        // Use simpler data structure without serverTimestamp for now
        const initialProfile = {
          username: username,
          usernameLower: username.toLowerCase(), // Add lowercase field for case-insensitive search
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
          bio: '',
          location: '',
          website: '',
          joinedDate: new Date().toLocaleDateString('en-US'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true, // Add isActive field
        };

        // Force overwrite the document (don't merge)
        try {
          await profileRef.set(initialProfile, { merge: false });
        } catch (writeError) {
          throw writeError;
        }
        
        // Wait for Firestore to process
        await new Promise(resolve => setTimeout(resolve, 3000));
        
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
              }
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 2000));
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
            usernameLower: username.toLowerCase(),
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
        usernameLower: username.toLowerCase(),
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        avatar: 'https://cdn.britannica.com/84/232784-050-1769B477/Siberian-Husky-dog.jpg',
        bio: '',
        location: '',
        website: '',
        joinedDate: new Date().toLocaleDateString('en-US'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
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

    // Check if username is available before saving
    if (available !== true) {
      Alert.alert('Error', 'Please choose an available username');
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
        usernameLower: username.trim().toLowerCase(),
        email: currentUser.email,
        updatedAt: firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Create full profile document
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

  const getStatusColor = () => {
    if (!username || username.length < 3) return '#999';
    if (checking) return '#007AFF';
    if (available === true) return '#4CAF50';
    if (available === false) return '#F44336';
    return '#999';
  };

  const getStatusIcon = () => {
    if (checking) return '';
    if (available === true) return '✓';
    if (available === false) return '✗';
    return '';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.containertitle}>
        <Text style={styles.title}>Choose Username</Text>
        <TouchableOpacity style={styles.backButton} onPress={cancelaccountcreation}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.contentContainer}>
        <View style={styles.inputContainer}>
        <TextInput 
          style={[styles.userInput, { borderColor: getStatusColor() }]}
          placeholder="Enter Username"
          value={username}
          onChangeText={setUsername}
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
          maxLength={20}
        />
        {checking && (
          <ActivityIndicator
            size="small"
            color="#007AFF"
            style={styles.checkingIndicator}
          />
        )}
        {!checking && username.length >= 3 && (
          <Text style={[styles.statusIcon, { color: getStatusColor() }]}>
            {getStatusIcon()}
          </Text>
        )}
      </View>

      {/* Status Message */}
      {validationMessage && (
        <Text style={[styles.validationMessage, { color: getStatusColor() }]}>
          {validationMessage}
        </Text>
      )}

      {/* Character Count */}
      <Text style={styles.charCount}>
        {username.length}/20 characters
      </Text>

      {/* Guidelines */}
      <View style={styles.guidelinesBox}>
        <Text style={styles.guidelinesTitle}>Username Guidelines:</Text>
        <Text style={styles.guidelineItem}>• 3-20 characters long</Text>
        <Text style={styles.guidelineItem}>• Letters, numbers, and underscores only</Text>
        <Text style={styles.guidelineItem}>• Cannot be changed later</Text>
      </View>
      
      <Pressable 
        style={[
          styles.button, 
          (loading || available !== true) && styles.buttonDisabled
        ]} 
        onPress={handleSaveUsername}
        disabled={loading || available !== true}
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
      </View>
    </SafeAreaView>
  );
};

export default Username;

const styles = StyleSheet.create({
  backButton: {
    paddingVertical: 25,
    position: 'absolute',
    left: 20,
  },
  backButtonText: {
    color: 'white',
    fontSize: 35,
  },
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  containertitle: {
    height: 50,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    width: '100%',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'white',
  },
  inputContainer: {
    position: 'relative',
    width: '80%',
    marginBottom: 10,
  },
  userInput: {
    height: 50,
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#999',
    paddingHorizontal: 15,
    paddingRight: 45,
    fontSize: 16,
  },
  checkingIndicator: {
    position: 'absolute',
    right: 15,
    top: 13,
  },
  statusIcon: {
    position: 'absolute',
    right: 15,
    top: 12,
    fontSize: 24,
    fontWeight: 'bold',
  },
  validationMessage: {
    fontSize: 14,
    marginTop: 5,
    marginBottom: 5,
    width: '80%',
    textAlign: 'left',
  },
  charCount: {
    fontSize: 12,
    color: '#999',
    marginBottom: 20,
    width: '80%',
    textAlign: 'left',
  },
  guidelinesBox: {
    width: '80%',
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  guidelinesTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  guidelineItem: {
    color: '#999',
    fontSize: 13,
    marginBottom: 5,
  },
  button: {
    backgroundColor: 'green',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
    width: '80%',
    alignItems: 'center',
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