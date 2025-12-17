import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert, Button } from 'react-native';
import auth from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import Username from './Username';
import firestore from '@react-native-firebase/firestore';

export default function SignUp() {
  const navigation = useNavigation();
  const [checking, setChecking] = useState(true);

  // Profile creation will be handled in Username.js after username is set

  useEffect(() => {
    const interval = setInterval(async () => {
      const user = auth().currentUser;
      if (user) {
        await user.reload(); // 🔄 Refresh Firebase user data
        if (user.emailVerified) {
          clearInterval(interval);
          setChecking(false);
          Alert.alert('Success', 'Email verified!');
          
          try {
            const userDoc = await firestore().collection('users').doc(user.uid).get();
            const userData = userDoc.data();

            if (userData?.username) {
              navigation.replace('Tabnavigator');
            } else {
              navigation.replace('Username');
            }
          } catch (error) {
            
            Alert.alert('Error', 'Something went wrong. Please try again.');
          }
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const resendVerification = async () => {
    const user = auth().currentUser;
    try {
      await user.sendEmailVerification();
      Alert.alert('Verification Email Sent Again', 'Check your inbox or spam folder.');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Email</Text>
      <Text style={styles.message}>
        A verification link has been sent to your email address. Please click it and come back here.
      </Text>
      <ActivityIndicator size="large" color="green" style={{ marginTop: 30 }} />
      <Text style={styles.waitingText}>Waiting for confirmation...</Text>

      <Button title="Resend Verification Email" onPress={resendVerification} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFEAD8',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    color: '#444',
  },
  waitingText: {
    marginTop: 15,
    fontSize: 14,
    color: 'gray',
  },
});