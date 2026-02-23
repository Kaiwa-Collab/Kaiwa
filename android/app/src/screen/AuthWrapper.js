// AuthWrapper.js - UPDATED with WebSocket Connection Management
import React, { useState, useEffect,useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import signUp_G from './signUp_G';
import presenceService from './presenceService';
import wsChatService from '../../service/wsChatService';// ADD THIS IMPORT

import HomeScreen from './HomeScreen';
import SignUp from './SignUp';
import Tabnavigator from './Tabnavigator';
import ChatScreen from './ChatScreen';
import CommentScreen from './CommentScreen';
import Settings from './Settings';
import Username from './Username';
import { KeyboardProvider } from 'react-native-keyboard-controller';
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
  const wsInitializedRef = useRef(false);
  
const wsRetryCount = useRef(0);
const MAX_WS_RETRIES = 3;


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
            
            // ========================================
            // NEW: Initialize WebSocket Connection
            // ========================================
           // Initialize WebSocket Connection (ONLY ONCE)

if (userData && userData.username && !wsInitializedRef.current) {
  if (wsRetryCount.current >= MAX_WS_RETRIES) {
    console.error('Max WebSocket retry attempts reached');
    return;
  }
  
  wsInitializedRef.current = true;
  wsRetryCount.current++;
  
  try {
    await wsChatService.connect();
    wsRetryCount.current = 0; // Reset on success
  } catch (error) {
    console.error('❌ Failed to connect WebSocket:', error);
    wsInitializedRef.current = false;
  }
}

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
        
        // ========================================
        // NEW: Disconnect WebSocket on logout
        // ========================================
        if (wsChatService.isConnected) {
  console.log('🔌 Disconnecting WebSocket...');
  wsChatService.disconnect();
  wsInitializedRef.current = false; // ✅ reset guard
  console.log('✅ WebSocket disconnected');
}

      }
    });
    
    return () => {
      unsubscribe();
      // Cleanup presence service on unmount
      presenceService.cleanup();
      // Note: Don't disconnect WebSocket here - only on logout
    };
  }, [initializing]);

  if (initializing || checkingUsername) return null;

  return (
    <>
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