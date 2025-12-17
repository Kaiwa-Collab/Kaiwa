// ProfileStack.js
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import First from './screen/First';
import MessageRequestsScreen from './screen/MessageRequestsScreen';
import ChatScreen from './screen/ChatScreen';
import ConversationsScreen from './screen/ConversationsScreen';




const Stack = createStackNavigator();

export default function firstStack() {
 


   return (
   <Stack.Navigator 
      screenOptions={{ 
        headerShown: false, // Hide default headers since Profile has custom header
      }}
    >
      <Stack.Screen 
        name="first" 
        component={First}
        // Allow the Profile screen to receive params
        options={({ route }) => ({
          // You can add custom options here based on params
        })}
      />
      <Stack.Screen name="MessageRequestsScreen" component={MessageRequestsScreen} />
      <Stack.Screen name="ConversationsScreen" component={ConversationsScreen}/>
      <Stack.Screen
              name="ChatScreen"
              component={ChatScreen}
              options={{
                headerShown: true,
                headerStyle: {
                  backgroundColor: '#1e1e1e' },
                headerTintColor: '#fff',
                headerTitleStyle: {fontWeight: 'bold' },
                presentation: 'card',
                // Custom slide animation - slide from right to left when opening
                cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
                transitionSpec: {
                  open: {
                    animation: 'timing',
                    config: {
                      duration: 300,
                    },
                  },
                  close: {
                    animation: 'timing',
                    config: {
                      duration: 250,
                    },
                  },
                },
                // Alternative animation options (uncomment to use):
                // Fade + Scale animation:
                // cardStyleInterpolator: ({ current, next, layouts }) => {
                //   return {
                //     cardStyle: {
                //       opacity: current.progress.interpolate({
                //         inputRange: [0, 1],
                //         outputRange: [0, 1],
                //       }),
                //       transform: [
                //         {
                //           scale: current.progress.interpolate({
                //             inputRange: [0, 1],
                //             outputRange: [0.9, 1],
                //           }),
                //         },
                //       ],
                //     },
                //   };
                // },
                // Modal slide up animation:
                // cardStyleInterpolator: CardStyleInterpolators.forModalPresentationIOS,
              }}
            />
      
    </Stack.Navigator>
  );
}
