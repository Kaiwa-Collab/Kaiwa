import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNotifications } from '../NotificationsContext';
import Qna from './Qna';
import searchStack from '../searchStack'
import Qnastack from '../Qnastack';

import Ionicons from 'react-native-vector-icons/Ionicons';
import ProfileStack from '../Profilestack';
import firstStack from '../firststack';

const Tab = createBottomTabNavigator();

export default function Tabnavigator() {
  const { hasUnreadNotifications } = useNotifications();

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
          } else if (route.name === 'Search') {
            iconName = focused ? 'search' : 'search-outline';
          }

          if (route.name === 'Search' && hasUnreadNotifications) {
            return (
              <View style={styles.iconWithBadge}>
                <Ionicons name={iconName} size={size} color={color} />
                <View style={styles.orangeDot} />
              </View>
            );
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

const styles = StyleSheet.create({
  iconWithBadge: {
    position: 'relative',
  },
  orangeDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF6D1F',
  },
});