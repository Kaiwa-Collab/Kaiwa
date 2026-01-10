import { createStackNavigator } from "@react-navigation/stack";
import Settings from "./screen/Settings";
import Addbio from "./screen/Addbio";
import FollowersFollowing from "./secondary_screens/FollowersFollowing";
import githubConnection from "./githubservices/githubConnection";


const Stack = createStackNavigator();

export default function SettingsStack() {
    return (
        <Stack.Navigator
screenOptions={{
  headerShown: false
}}
>
    <Stack.Screen name="Settings"
     component={Settings}
     options={({route})=>({


     })} 
     />
    <Stack.Screen name="Addbio" component={Addbio} />
    <Stack.Screen name="FollowersFollowing" component={FollowersFollowing} />
    <Stack.Screen name="githubConnection" component={githubConnection} />
</Stack.Navigator>
    );
}
