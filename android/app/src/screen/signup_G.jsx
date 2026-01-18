import { StyleSheet, Text, View,StatusBar, SafeAreaView, TextInput, Pressable, Alert, TouchableOpacity, Platform  } from 'react-native'
import React from 'react'
import { useNavigation } from '@react-navigation/native';
import { useState,useEffect} from 'react';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { GoogleSignin,statusCodes} from '@react-native-google-signin/google-signin';
import First from './First';
import Username from './Username';
import { Image } from 'react-native';


const getStatusBarHeight = () => {
  return Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
};





const signUp_G = () => {
  useEffect(()=>{
    GoogleSignin.configure({
  webClientId: '686349209176-7mlrurvferkssq874oncl4dkk3ajpp0e.apps.googleusercontent.com',
});
  },[])
const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

 const handleSignUp = async () => {
  if(!email || !password){
    Alert.alert('Error', 'Please enter email and password');
    return;
}

    try {
      const userCredential = await auth().createUserWithEmailAndPassword(email, password);

      await firestore().collection('users').doc(userCredential.user.uid).set({
        email: email,
      });
      await userCredential.user.sendEmailVerification();
      Alert.alert('Success', 'Verification email sent. Please verify before continuing.');
      navigation.navigate('SignUp');
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        Alert.alert('Error', 'Email already in use');
      } else if (error.code === 'auth/invalid-email') {
        Alert.alert('Error', 'Invalid email address');
      } else if (error.code === 'auth/weak-password') {
        Alert.alert('Error', 'Password should be at least 6 characters');
      } else {
        Alert.alert('Error', error.message);
      }
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    try{
        await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog:true});

        // Sign out to force the Google account chooser to show available Gmail accounts on device
        try {
          await GoogleSignin.signOut();
        } catch(signOutError) {
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
      

        // Decide destination based on whether a Firestore user doc exists and has username
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
          // Returning user with username: go to main app
          Alert.alert('Success', 'Signed in successfully!', [
            {
              text: 'OK',
              onPress: () => navigation.replace('Tabnavigator') // Navigate to main app
            }
          ]);
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
      setGoogleLoading(false);
    }

    };
  


return(
      <View style={styles.outerContainer}>
          <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
          <View style={styles.statusBarSpacer} />
          <View style={styles.separator} />
          <SafeAreaView style={styles.container}>
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
          <TouchableOpacity style={styles.Pressable} onPress={handleSignUp}>
          
                  <Text style={styles.text2}>
                    sign up
                  </Text>
                </TouchableOpacity>

                <Text style={styles.text3}>
                        or
                      </Text>
                <TouchableOpacity style={styles.Pressablegoogle} onPress={handleGoogleSignUp}>
                    <Image 
              source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
              style={styles.googleLogo}
              />
                  <Text style={styles.text4}>
                    signup with Google
                  </Text>
                </TouchableOpacity>

          </SafeAreaView>
          </View>
)


}




export default signUp_G

const styles = StyleSheet.create({
 outerContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    alignItems: 'center'
  },

 statusBarSpacer: {
    height: getStatusBarHeight(),
    backgroundColor: '#ffffff',
  },
  input: {
    width: 350,
    height: 55,
    backgroundColor: 'white',
    borderColor: 'black',
    marginTop: 150,
    fontWeight: 'bold',
    shadowOpacity: 1,
    paddingHorizontal: 15,
  },
  input2: {
    width: 350,
    height: 55,
    backgroundColor: 'white',
    borderColor: 'black',
    marginTop: 10,
    fontWeight: 'bold',
    shadowOpacity: 1,
    paddingHorizontal: 15,
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
    flexDirection: 'row',
    height: 40,
    width: 350,
    backgroundColor: "white",
    alignItems: 'center',
    borderRadius: 10,
    marginTop: 10,
    borderColor: '#dadce0',      
    justifyContent: 'center',
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
    color: 'black'
  },
  text5: {
    marginTop: 7,
    fontWeight: 'bold',
    marginBottom: 4,
    color: 'blue'
  },

  googleLogo: {
  width: 18,
  height: 18,
  marginRight: 12,
  
},

  signupcontainer:{
    flexDirection: 'row',
    alignContent: 'center',


  }


})