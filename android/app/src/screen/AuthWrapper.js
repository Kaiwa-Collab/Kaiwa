import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'react-native'; // Added StatusBar import
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import signUp_G from './signUp_G';
import presenceService from './presenceService';

import HomeScreen from './HomeScreen';
import SignUp from './SignUp';
import Tabnavigator from './Tabnavigator';
import ChatScreen from './ChatScreen';
import CommentScreen from './CommentScreen';
import Settings from './Settings';
import Username from './Username';
import { KeyboardProvider } from 'react-native-keyboard-controller';
// import ChatScreen from './ChatScreen';
import MessageRequestsScreen from './MessageRequestsScreen';

const Stack = createNativeStackNavigator();

function AppNavigator({ user, hasUsername }) {
  // Determine initial route based on user state
  const getInitialRouteName = () => {
    if (user && user.emailVerified) {
      return hasUsername ? 'Tabnavigator' : 'Username';
    }
    if (user && !user.emailVerified) {
      return 'SignUp';
    }
    return 'Home';
  };

  return (
    
    <Stack.Navigator 
      screenOptions={{ headerShown: false }}
      initialRouteName={getInitialRouteName()}
    >
      {user ? (
        user.emailVerified ? (
          <>
            {hasUsername ? (
              <>
                <Stack.Screen name="Tabnavigator" component={Tabnavigator} />
                <Stack.Screen name="Username" component={Username} />
              </>
            ) : (
              <>
                <Stack.Screen name="Username" component={Username} />
                <Stack.Screen name="Tabnavigator" component={Tabnavigator} />
              </>
            )}
            <Stack.Screen name="ChatScreen" component={ChatScreen} />
            
          
            <Stack.Screen name="Settings" component={Settings} />
            <Stack.Screen
              name="CommentScreen"
              component={CommentScreen}
              options={{
                headerShown: true,
                headerStyle: {
                  backgroundColor: '#1e1e1e' },
                headerTintColor: '#fff',
            headerTitleStyle: {fontWeight: 'bold' },
              }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="SignUp" component={SignUp} />
            <Stack.Screen name="Tabnavigator" component={Tabnavigator} />
            <Stack.Screen name="Username" component={Username} />
          </>
        )
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="SignUp" component={SignUp} />
          <Stack.Screen name="signUp_G" component={signUp_G} />
          <Stack.Screen name="Username" component={Username} />
        </>
      )}

    </Stack.Navigator>
  );
}

export default function AuthWrapper() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);
  const [hasUsername, setHasUsername] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(true);

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (user) => {
      setUser(user);
      if (initializing) setInitializing(false);
      
      // Check if user has username
      if (user && user.emailVerified) {
        setCheckingUsername(true);
        try {
          const userDoc = await firestore().collection('users').doc(user.uid).get();
          const userData = userDoc.data();
          setHasUsername(!!(userData && userData.username));
          
          // Initialize presence tracking for authenticated users
          if (userData && userData.username) {
            presenceService.initialize(user.uid);
          }
        } catch (error) {
          console.error('Error checking username:', error);
          setHasUsername(false);
        } finally {
          setCheckingUsername(false);
        }
      } else {
        setHasUsername(false);
        setCheckingUsername(false);
        // Cleanup presence tracking when user logs out
        presenceService.cleanup();
      }
    });
    
    return () => {
      unsubscribe();
      // Cleanup presence service on unmount
      presenceService.cleanup();
    };
  }, [initializing]);

  if (initializing || checkingUsername) return null;

  return (
    <>
      {/* StatusBar configuration for dark content on light background */}
      <StatusBar 
        barStyle="dark-content" 
        backgroundColor="#ffffff" 
        translucent={false}
        hidden={false}
      />
      <NavigationContainer key={user ? 'user' : 'guest'}>
        <AppNavigator user={user} hasUsername={hasUsername} />
      </NavigationContainer>
    </>
  );
}
//do not add navigation back to home page after logout or deletions as authcjange will handle it 