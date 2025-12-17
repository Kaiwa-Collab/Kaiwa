// ProfileStack.js
import { createStackNavigator } from '@react-navigation/stack';
import Profile from './screen/Profile';
import Settings from './screen/Settings';
import AskQuestion from './screen/AskQuestion';
import Post from './Post';
import SettingsStack from './settingsstack';


const Stack = createStackNavigator();

export default function ProfileStack() {
   return (
    <Stack.Navigator 
      screenOptions={{ 
        headerShown: false // Hide default headers since Profile has custom header
      }}
    >
      <Stack.Screen 
        name="Profile" 
        component={Profile}
        // Allow the Profile screen to receive params
        options={({ route }) => ({
          // You can add custom options here based on params
        })}
      />
      <Stack.Screen name="Settings" component={SettingsStack} />
      <Stack.Screen name="AskQuestion" component={AskQuestion} />
      <Stack.Screen name="PostDetail" component={Post} />
    </Stack.Navigator>
  );
}
