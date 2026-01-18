import { StyleSheet, Text, View, SafeAreaView, TextInput, StatusBar, Pressable, Alert, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import React, { useEffect } from 'react'
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import First from './First';
import { Image } from 'react-native';



const getStatusBarHeight = () => {
  return Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
};



const HomeScreen = () => {
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '686349209176-7mlrurvferkssq874oncl4dkk3ajpp0e.apps.googleusercontent.com',
    });
  }, []);

  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

 

  const handleSignIn = async () => {
    // Validate email field
    if (!email || email.trim() === '') {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    // Validate password field
    if (!password || password.trim() === '') {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    try {
      await auth().signInWithEmailAndPassword(email, password);
      const user = auth().currentUser;
      if (!user.emailVerified) {
        Alert.alert('Email Not Verified', 'Please verify your email before logging in.');
        navigation.navigate('SignUp');
        return;
      }

      Alert.alert('Success', 'Logged in');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Check if user exists in Firestore (might have signed up with Google)
        // Try both original case and lowercase since Firestore queries are case-sensitive
        const emailTrimmed = email.trim();
        const emailLower = emailTrimmed.toLowerCase();
        
        try {
          // Try to find user with exact email match first
          let userFound = false;
          
          // Check with original email
          const usersSnapshot1 = await firestore()
            .collection('users')
            .where('email', '==', emailTrimmed)
            .limit(1)
            .get();
          
          if (!usersSnapshot1.empty) {
            userFound = true;
          } else {
            // Check with lowercase email
            const usersSnapshot2 = await firestore()
              .collection('users')
              .where('email', '==', emailLower)
              .limit(1)
              .get();
            
            if (!usersSnapshot2.empty) {
              userFound = true;
            }
          }
          
          if (userFound) {
            // User exists in Firestore but signed up with Google
            Alert.alert(
              'Account Found',
              'This email is registered with Google Sign-In. Please use "Log in with Google" to sign in.',
              [
                {
                  text: 'OK',
                  style: 'default'
                }
              ]
            );
            return;
          }
        } catch (checkError) {
          console.error('Error checking user:', checkError);
        }
        Alert.alert('Error', 'No account found with this email address.');
      } else if (error.code === 'auth/wrong-password') {
        // Check if user might have signed up with Google
        const emailTrimmed = email.trim();
        const emailLower = emailTrimmed.toLowerCase();
        
        try {
          let userFound = false;
          
          // Check with original email
          const usersSnapshot1 = await firestore()
            .collection('users')
            .where('email', '==', emailTrimmed)
            .limit(1)
            .get();
          
          if (!usersSnapshot1.empty) {
            userFound = true;
          } else {
            // Check with lowercase email
            const usersSnapshot2 = await firestore()
              .collection('users')
              .where('email', '==', emailLower)
              .limit(1)
              .get();
            
            if (!usersSnapshot2.empty) {
              userFound = true;
            }
          }
          
          if (userFound) {
            // User exists in Firestore - might have signed up with Google
            Alert.alert(
              'Incorrect Sign-In Method',
              'This account was created with Google Sign-In. Please use "Log in with Google" instead of email and password.',
              [
                {
                  text: 'OK',
                  style: 'default'
                }
              ]
            );
            return;
          }
        } catch (checkError) {
          console.error('Error checking user:', checkError);
        }
        Alert.alert('Error', 'Incorrect password. Please try again.');
      } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/account-exists-with-different-credential') {
        Alert.alert(
          'Account Exists with Different Method',
          'This email is registered with Google Sign-In. Please use "Log in with Google" to sign in.',
          [
            {
              text: 'OK',
              style: 'default'
            }
          ]
        );
      } else {
        Alert.alert('Error', error.message);
      }
    }
  };

  const handleloginwithgoogle = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Sign out to force the Google account chooser to show available Gmail accounts on device
      try {
        await GoogleSignin.signOut();
      } catch (signOutError) {
        console.log('Google sign-out before picker failed (continuing):', signOutError?.code);
      }

      // Interactive sign-in will present the account picker so user can choose any available Gmail
      const signInResult = await GoogleSignin.signIn();
      console.log('Interactive Google Sign-In Result:', signInResult);
      
      const idToken = signInResult?.idToken || signInResult?.data?.idToken;
      
      if (!idToken) {
        console.error('No idToken in sign-in result:', signInResult);
        Alert.alert('Error', 'Google sign-in was cancelled or failed to get authentication token. Please try again.');
        return;
      }
      
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      const userCredential = await auth().signInWithCredential(googleCredential);

      if (!userCredential || !userCredential.user) {
        Alert.alert('Error', 'Failed to authenticate with Google');
        return;
      }

      const user = userCredential.user;

      // Wait a moment for auth state to propagate to all listeners
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check if user document exists and has username
      const userRef = firestore().collection('users').doc(user.uid);
      const userSnap = await userRef.get();
      const userExists = userSnap.exists;
      const userData = userSnap.data();
      const hasUsername = userData && userData.username;

      if (!userExists) {
        // First-time Google sign-in: create doc and send to username setup
        try {
          await userRef.set({
            email: user.email,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });
          
          // Verify the document was created
          const verifySnap = await userRef.get();
          if (!verifySnap.exists) {
            throw new Error('Failed to create user document in database');
          }
          
          console.log('User document created successfully:', user.uid);
          
          Alert.alert('Success', 'Account created successfully!', [
            {
              text: 'OK',
              onPress: () => navigation.replace('Username') // Navigate to username setup
            }
          ]);
        } catch (dbError) {
          console.error('Error creating user document:', dbError);
          Alert.alert('Error', `Failed to create user account: ${dbError.message}. Please try again.`);
          return;
        }
      } else if (hasUsername) {
        // Returning user with username: AuthWrapper will handle navigation automatically
        // Show success message - navigation happens via AuthWrapper's onAuthStateChanged
        Alert.alert('Success', 'Logged in successfully!');
        // Don't navigate manually - AuthWrapper will detect auth state change and navigate
        // This ensures the correct navigator context is used
      } else {
        // User document exists but no username: send to username setup
        Alert.alert('Success', 'Please set up your username!', [
          {
            text: 'OK',
            onPress: () => navigation.replace('Username') // Navigate to username setup
          }
        ]);
      }
      
    } catch (error) {
      // Safely log the error
      try {
        console.error('Google Sign-In Error:', error);
      } catch (logError) {
        // Ignore logging errors
      }

      // Safely extract error information
      let errorCode = null;
      let errorMessage = 'Sign-in failed. Please try again.';
      
      try {
        if (error && typeof error === 'object') {
          errorCode = error.code || null;
          errorMessage = error.message || errorMessage;
        } else if (error && typeof error === 'string') {
          errorMessage = error;
        }
      } catch (extractError) {
        // If we can't extract error info, use default message
      }
      
      // Handle specific error codes
      if (errorCode === 'ERR_CANCELED' || errorCode === 'SIGN_IN_CANCELLED' || 
          (statusCodes && errorCode === statusCodes.SIGN_IN_CANCELLED)) {
        Alert.alert('Cancelled', 'Sign-in was cancelled');
      } else if (statusCodes && errorCode === statusCodes.IN_PROGRESS) {
        Alert.alert('In Progress', 'Sign-in is already in progress');
      } else if (statusCodes && errorCode === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services not available');
      } else if (errorCode === 'auth/account-exists-with-different-credential') {
        Alert.alert('Error', 'An account already exists with the same email address but different sign-in credentials.');
      } else {
        Alert.alert('Error', errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };
  

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS === 'android') {
        StatusBar.setBarStyle('light-content', true);
        StatusBar.setBackgroundColor('#1e1e1e', true);
      }
    }, [])
  );

  return (
    <View style={styles.outerContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e1e" translucent={false} />
      <View style={styles.statusBarSpacer} />
      <View style={styles.separator} />
      
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          {/* <Text style={styles.text}>
            Kaiwa
          </Text> */}
          <Image
          source={require('../../../../assets/image/logo4.png')}
          style={{ width: 150, height: 150, marginTop: 50,borderRadius:1000,borderWidth:1,borderColor:'white' }}
        />
        </View>

      <TextInput
        style={styles.input}
        placeholder='Enter email'
        keyboardType='email-address'
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input2}
        placeholder='Enter password'
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.Pressable} onPress={handleSignIn}>
        
        <Text style={styles.text2}>
          log in
        </Text>
      </TouchableOpacity>
       <TouchableOpacity 
        style={[styles.Pressablegoogle, loading && styles.PressablegoogleDisabled]} 
        onPress={handleloginwithgoogle}
        disabled={loading}
      >
         <Image 
            source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
            style={styles.googleLogo}
          />
        {loading ? (
          <ActivityIndicator size="small" color="black" />
        ) : (
          
          <Text style={styles.text6}>
            log in with google
          </Text>
        )}
      </TouchableOpacity>
      <Text style={styles.text3}>
        or
      </Text>
      
      <View style={styles.signupcontainer}>

      <Text style={styles.text4}>
        don't have an account?</Text>
      <TouchableOpacity style={styles.Pressable1} onPress={()=>navigation.navigate('signUp_G')}>
        <Text style={styles.text5}>
         Sign up
        </Text>
      </TouchableOpacity>
      </View>
      </SafeAreaView>
    </View>
  );
};

export default HomeScreen;

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    
  },
  text: {
    color: "white",
    fontSize: 25,
    fontWeight: "bold",
    marginTop: 10,
    shadowOpacity: 50
  },
  separator: {
    height: 0.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: '100%',
  },
  // card: {
  //   backgroundColor: '#FF6D1F',
  //   width: 350,
  //   height: 50,
  //   borderColor: 'black',
  //   borderRadius: 200,
  //   shadowColor: '#000',
  //   shadowOffset: { width: 0, height: 2 },
  //   shadowOpacity: 1,
  //   shadowRadius: 5,
  //   elevation: 15,
  //   marginRight: 30,
  //   marginLeft: 30,
  //   marginVertical: 2,
  //   alignItems: "center",
  //   marginTop: 20
  // },
  statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#1e1e1e',
  },
  input: {
    width: 350,
    height: 55,
    backgroundColor: 'white',
    borderColor: 'black',
    marginTop: 80,
    fontWeight: 'bold',
    paddingHorizontal: 15,
    borderBottomWidth:1,
    borderBottomColor:'#FF6D1F',
    borderBottomRadius:5,
    shadowColor:'#FF6D1F',
    ShadowOffset:{width:0,height:2},
    elevation:10,
    shadowOpacity:0.1,
    shadowRadius:4,
  },
  input2: {
    width: 350,
    height: 55,
    backgroundColor: 'white',
    borderColor: 'black',
    marginTop: 10,
    fontWeight: 'bold',
    shadowOpacity: 0.1,
    paddingHorizontal: 15,
    elevation:10,
    shadowRadius:4,
    borderBottomColor:'#FF6D1F',
    borderBottomRadius:5,
    shadowColor:'#FF6D1F',
    ShadowOffset:{width:0,height:2},
    elevation:10,
    borderBottomWidth:1,
  },
  text3: {
    marginTop: 2,
    fontWeight: 'bold',
    color: 'white',
    fontSize: 15,
  },
  Pressable: {
    height: 40,
    width: 350,
    backgroundColor: "green",
    alignItems: 'center',
    borderRadius: 10,
    marginTop: 10,
    
  },
   Pressablegoogle: {
    height: 40,
    width: 350,
    backgroundColor: "white",
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginTop: 10,
    flexDirection: 'row',
  },
  PressablegoogleDisabled: {
    opacity: 0.6,
  },
  
  text2: {
    marginTop: 7,
    fontWeight: 'bold',
    marginBottom: 4,
    color: 'white'
  },
  text4: {
    marginTop: 7,
    fontWeight: 'bold',
    marginBottom: 4,
    color: 'white'
  },
  text5: {
    marginTop: 7,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#FF6D1F'
  },
   text6: {
    marginTop: 7,
    fontWeight: 'bold',
    marginBottom: 4,
    color: 'black'
  },
  signupcontainer:{
    flexDirection: 'row',
    alignContent: 'center',
  },
    
  googleLogo: {
  width: 18,
  height: 18,
  marginRight: 12,
  
},


  
});