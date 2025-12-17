import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Qna from './Qna';
import searchStack from '../searchStack'
import Qnastack from '../Qnastack';

import Ionicons from 'react-native-vector-icons/Ionicons';
import ProfileStack from '../Profilestack';
import firstStack from '../firststack';

const Tab = createBottomTabNavigator();

export default function Tabnavigator() {
   
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#2c2c32' },
        tabBarActiveTintColor: 'white',
        tabBarInactiveTintColor: 'gray',
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'First') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          } else if (route.name === 'Qna') {
            iconName = focused ? 'chatbox-ellipses' : 'chatbox-ellipses-outline';
          }else if (route.name === 'Search') {
            iconName = focused ? 'search' : 'search-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen 
        name="First" 
        component={firstStack} 
        options={{ title: 'Chats' }} 
      />
      <Tab.Screen name="Search" component={searchStack} options={{ title: 'Search' }} />
      <Tab.Screen name="Qna" component={Qnastack} options={{ title: 'Qna' }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ title: 'Profile' }} />
      
      
    </Tab.Navigator>
  );
}